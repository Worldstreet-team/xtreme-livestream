import mongoose from "mongoose";
import type { MarketOracleView } from "@xtreme/contracts";
import { ChatMessage, Game, GameEntry, Stream, User, WatchSession, type GameType, type IGame, type IStream } from "./models.js";
import { sendRoomData } from "./livekit.js";
import { ORACLE_GIVE_UP_MS, ORACLE_READY_MS, ORACLE_RETRY_MS, priceAt } from "./market-oracle.js";
import { awardPoints } from "./points.js";
import { audit } from "./rewards.js";

/**
 * Games run inside a stream, on one engine:
 *
 *  - prediction  viewers stake points on an outcome; the pool splits pro-rata
 *                among whoever called it when the host settles.
 *  - raffle      viewers enter (free, or a ticket in points); the host draws
 *                N winners who split the tickets plus a prize.
 *  - quiz        viewers pick an answer, no stake; when the window closes the
 *                right answer is revealed and every correct entry is paid.
 *
 * Plus drops: every so often a random viewer who has been watching a while
 * gets points, announced in chat. The server locks windows, holds stakes,
 * draws, reveals and pays; the client renders the view it's sent.
 */

export const MIN_STAKE = 10;
export const MAX_STAKE = 5000;
export const DROP_POINTS = 50;
export const DROP_EVERY_MS = 20 * 60_000;
export const DROP_MIN_WATCH_MS = 20 * 60_000;
/**
 * A game its host never settles gives every stake and ticket back after
 * this long — held points are never stuck (Twitch and Kick both refund an
 * unsettled prediction after 24 hours).
 */
export const STALE_REFUND_MS = 24 * 60 * 60_000;

export interface GameView {
  id: string;
  streamId: string;
  type: GameType;
  status: IGame["status"];
  question: string;
  outcomes: { id: string; label: string; points: number; entries: number }[];
  closesAt: string;
  poolPoints: number;
  entries: number;
  winningOutcome: string | null;
  ticketPoints: number;
  winnersCount: number;
  prizePoints: number;
  /** Only once settled — never leaks the quiz answer early. */
  correctOutcome: string | null;
  winners: { userId: string; username: string; displayName: string; avatar: string }[];
  settledAt: string | null;
  /** A vote, not a bet: no stakes, no payouts. */
  voteOnly: boolean;
  /** A market question: what settles it, and — once it has — the price it settled on. */
  oracle: MarketOracleView | null;
  /** The caller's own entry, when they have one. */
  mine?: { outcome: string; stakePoints: number; wonPoints: number } | null;
}

/**
 * Market questions are votes, always: nothing is staked on one and nothing
 * is paid out, until the legal footing for points on a market outcome is
 * settled — a prize on where a price lands is too close to a bet to switch
 * on by default. Enforced here, on entry and at creation, whatever the
 * stored flag says.
 */
export function isVote(g: Pick<IGame, "type" | "voteOnly" | "oracle">) {
  return g.type === "prediction" && (Boolean(g.voteOnly) || Boolean(g.oracle));
}

export async function toGameView(g: IGame, mine?: { outcome: string; stakePoints: number; wonPoints: number } | null): Promise<GameView> {
  const winners =
    g.winners.length > 0
      ? await User.find({ _id: { $in: g.winners } }).select("username displayName avatar").lean()
      : [];
  return {
    id: String(g._id),
    streamId: String(g.streamId),
    type: g.type,
    status: g.status,
    question: g.question,
    outcomes: g.outcomes.map((o) => ({ id: o.id, label: o.label, points: o.points, entries: o.entries })),
    closesAt: g.closesAt.toISOString(),
    poolPoints: g.poolPoints,
    entries: g.entries,
    winningOutcome: g.winningOutcome,
    ticketPoints: g.ticketPoints,
    winnersCount: g.winnersCount,
    prizePoints: g.prizePoints,
    correctOutcome: g.status === "settled" ? g.correctOutcome : null,
    winners: winners.map((u) => ({ userId: String(u._id), username: u.username, displayName: u.displayName || u.username, avatar: u.avatar })),
    settledAt: g.settledAt ? g.settledAt.toISOString() : null,
    voteOnly: isVote(g),
    oracle: g.oracle
      ? {
          symbol: g.oracle.symbol,
          above: g.oracle.above,
          at: new Date(g.oracle.at).toISOString(),
          source: "Coinbase",
          price: g.oracle.price ?? null,
          failed: g.oracle.failed ?? null,
        }
      : null,
    ...(mine !== undefined ? { mine } : {}),
  };
}

/**
 * The game a stream is running now (open or locked), or the one it settled
 * in the last two minutes — or a market question the feed let down, called
 * off in the last two, so the room reads why.
 */
export async function currentGameForStream(streamId: mongoose.Types.ObjectId | string) {
  const id = new mongoose.Types.ObjectId(String(streamId));
  return (
    (await Game.findOne({ streamId: id, status: { $in: ["open", "locked"] } }).sort({ createdAt: -1 })) ??
    (await Game.findOne({
      streamId: id,
      $or: [{ status: "settled" }, { status: "cancelled", "oracle.failed": { $type: "string" } }],
      settledAt: { $gte: new Date(Date.now() - 120_000) },
    }).sort({ settledAt: -1 }))
  );
}

/** Every game with an open or locked window, newest first — for discovery. */
export async function liveGames(limit = 12) {
  return Game.find({ status: { $in: ["open", "locked"] } }).sort({ createdAt: -1 }).limit(limit);
}

export async function fanOutGame(g: IGame, stream?: Pick<IStream, "livekitRoomName"> | null) {
  const s = stream ?? (await Stream.findById(g.streamId).select("livekitRoomName").lean());
  if (s) await sendRoomData(s.livekitRoomName, { __evt: "game", game: await toGameView(g) }).catch(() => {});
}

export interface CreateGameInput {
  type: GameType;
  question: string;
  outcomes: string[];
  durationSec: number;
  ticketPoints: number;
  winnersCount: number;
  prizePoints: number;
  /** Quiz: index into outcomes. */
  correctIndex: number | null;
  /** Prediction: run it as a vote — no stakes, no payouts. */
  voteOnly?: boolean;
  /**
   * A market question (market-oracle.ts `prepareMarketQuestion`): its
   * oracle, and when its votes close — which replaces `durationSec`.
   */
  market?: { oracle: { symbol: string; above: number; at: Date }; closesAt: Date } | null;
}

export async function createGame(stream: IStream, hostId: mongoose.Types.ObjectId, input: CreateGameInput) {
  // Outcome ids are a, b, c, d — what the viewer taps and what the quiz's
  // answer is stored as.
  const idAt = (i: number) => String.fromCharCode(97 + i);
  const outcomes =
    input.type === "raffle"
      ? [{ id: "ticket", label: "Ticket", points: 0, entries: 0 }]
      : input.outcomes.map((label, i) => ({ id: idAt(i), label, points: 0, entries: 0 }));
  const game = await Game.create({
    streamId: stream._id,
    hostId,
    type: input.type,
    status: "open",
    question: input.question,
    outcomes,
    closesAt: input.market?.closesAt ?? new Date(Date.now() + input.durationSec * 1000),
    ticketPoints: input.type === "raffle" ? input.ticketPoints : 0,
    winnersCount: input.type === "raffle" ? Math.max(1, input.winnersCount) : 1,
    prizePoints: input.market ? 0 : input.prizePoints,
    correctOutcome:
      input.type === "quiz" && input.correctIndex !== null && input.correctIndex < input.outcomes.length ? idAt(input.correctIndex) : null,
    // A market question is a vote whatever the body asked for (see isVote).
    voteOnly: input.type === "prediction" && (Boolean(input.voteOnly) || Boolean(input.market)),
    oracle: input.type === "prediction" && input.market ? { ...input.market.oracle, price: null, failed: null } : null,
  });
  await fanOutGame(game, stream);
  return game;
}

/** Enter a game. Every path is guarded: no double entries, no overdraft, no late entries. */
export async function enterGame(game: IGame, userId: mongoose.Types.ObjectId, outcome: string, stake: number) {
  if (game.status !== "open" || game.closesAt.getTime() <= Date.now()) throw new Error("CLOSED");
  const pick = game.type === "raffle" ? "ticket" : outcome;
  if (!game.outcomes.some((o) => o.id === pick)) throw new Error("BAD_OUTCOME");
  if (await GameEntry.exists({ gameId: game._id, userId })) throw new Error("ALREADY_IN");

  // A vote-only prediction — every market question among them — takes the pick and nothing else.
  const cost = game.type === "prediction" ? (isVote(game) ? 0 : stake) : game.type === "raffle" ? game.ticketPoints : 0;
  const reason = game.type === "raffle" ? "raffle_ticket" : "game_stake";
  if (cost > 0) await awardPoints(userId, -cost, reason, game._id as mongoose.Types.ObjectId); // throws InsufficientPointsError
  try {
    const entry = await GameEntry.create({ gameId: game._id, streamId: game.streamId, userId, outcome: pick, stakePoints: Math.max(cost, game.type === "quiz" ? 0 : cost) });
    const updated = await Game.findOneAndUpdate(
      { _id: game._id, "outcomes.id": pick },
      { $inc: { poolPoints: cost, entries: 1, "outcomes.$.points": cost, "outcomes.$.entries": 1 } },
      { new: true },
    );
    if (updated) await fanOutGame(updated);
    return entry;
  } catch (error) {
    if (cost > 0) await awardPoints(userId, cost, "game_refund", game._id as mongoose.Types.ObjectId).catch(() => {});
    throw error;
  }
}

/**
 * Settle, by type. Prediction: pro-rata split of the pool among the winning
 * outcome's entries (all refunded if nobody backed it; a vote pays nothing).
 * Raffle: draw N distinct tickets, split tickets + prize equally. Quiz: every
 * correct entry gets the prize.
 *
 * `settlerId` is whoever is declaring the outcome. Someone with points in a
 * game never settles it — the host can't enter their own games, and the same
 * rule holds for anyone else ever given the button.
 *
 * A market question is settled by the market alone (`via: "market"`, the
 * game sweep): not the host, not a moderator, not any caller added later.
 */
export async function settleGame(game: IGame, winningOutcome: string | null, settlerId?: mongoose.Types.ObjectId, via?: "market") {
  if (!["open", "locked"].includes(game.status)) throw new Error("NOT_SETTLEABLE");
  if (game.oracle && via !== "market") throw new Error("SETTLES_ITSELF");
  if (settlerId && (await GameEntry.exists({ gameId: game._id, userId: settlerId }))) throw new Error("SETTLER_ENTERED");
  const ref = game._id as mongoose.Types.ObjectId;

  if (game.type === "prediction") {
    if (!winningOutcome || !game.outcomes.some((o) => o.id === winningOutcome)) throw new Error("BAD_OUTCOME");
    const winners = await GameEntry.find({ gameId: game._id, outcome: winningOutcome });
    const winnersStake = winners.reduce((n, e) => n + e.stakePoints, 0);
    for (const e of winners) {
      const won = winnersStake > 0 ? Math.floor((game.poolPoints * e.stakePoints) / winnersStake) : 0;
      if (won > 0) {
        await awardPoints(e.userId, won, "game_win", ref);
        await GameEntry.updateOne({ _id: e._id }, { $set: { wonPoints: won } });
      }
    }
    if (winners.length === 0) {
      for (const e of await GameEntry.find({ gameId: game._id })) {
        if (e.stakePoints > 0) await awardPoints(e.userId, e.stakePoints, "game_refund", ref).catch(() => {});
      }
    }
    game.winningOutcome = winningOutcome;
    game.winners = winners.map((e) => e.userId).slice(0, 5);
  } else if (game.type === "raffle") {
    const entries = await GameEntry.find({ gameId: game._id });
    // Fisher–Yates on the entry list, take N.
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const a = entries[i];
      const b = entries[j];
      if (a && b) {
        entries[i] = b;
        entries[j] = a;
      }
    }
    const drawn = entries.slice(0, Math.min(game.winnersCount, entries.length));
    const prize = drawn.length > 0 ? Math.floor((game.poolPoints + game.prizePoints) / drawn.length) : 0;
    for (const e of drawn) {
      if (prize > 0) {
        await awardPoints(e.userId, prize, "raffle_win", ref);
        await GameEntry.updateOne({ _id: e._id }, { $set: { wonPoints: prize } });
      }
    }
    game.winners = drawn.map((e) => e.userId);
    game.winningOutcome = "ticket";
  } else {
    const correct = game.correctOutcome;
    if (!correct) throw new Error("BAD_OUTCOME");
    const right = await GameEntry.find({ gameId: game._id, outcome: correct });
    for (const e of right) {
      if (game.prizePoints > 0) {
        await awardPoints(e.userId, game.prizePoints, "quiz_win", ref);
        await GameEntry.updateOne({ _id: e._id }, { $set: { wonPoints: game.prizePoints } });
      }
    }
    game.winningOutcome = correct;
    game.winners = right.map((e) => e.userId).slice(0, 5);
  }

  game.status = "settled";
  game.settledAt = new Date();
  await game.save();
  await fanOutGame(game);
  return game;
}

export async function cancelGame(game: IGame) {
  if (!["open", "locked"].includes(game.status)) throw new Error("NOT_CANCELLABLE");
  for (const e of await GameEntry.find({ gameId: game._id })) {
    if (e.stakePoints > 0) await awardPoints(e.userId, e.stakePoints, "game_refund", game._id as mongoose.Types.ObjectId).catch(() => {});
  }
  game.status = "cancelled";
  game.settledAt = new Date();
  await game.save();
  await fanOutGame(game);
  return game;
}

/**
 * Every game whose window closed more than STALE_REFUND_MS ago and was
 * never settled: cancelled, every stake and ticket refunded, and the
 * auto-refund written to the audit log. Returns how many it closed out.
 */
export async function refundStaleGames(now = Date.now()) {
  const stale = await Game.find({
    status: { $in: ["open", "locked"] },
    closesAt: { $lte: new Date(now - STALE_REFUND_MS) },
  });
  let refunded = 0;
  for (const g of stale) {
    try {
      await cancelGame(g);
      await audit(null, "game.auto_refund", "game", g._id as mongoose.Types.ObjectId, {
        type: g.type,
        entries: g.entries,
        poolPoints: g.poolPoints,
        closedAt: g.closesAt,
      });
      refunded += 1;
    } catch (error) {
      console.error("stale game refund failed:", error);
    }
  }
  return refunded;
}

const oracleTries = new Map<string, number>();

/** "SOL-USD" → "SOL". */
const baseOf = (symbol: string) => symbol.split("-")[0] ?? symbol;

/**
 * Market questions whose minute is over: settled from Coinbase's price at
 * that minute (Yes when it closed above the line), retried every quarter of
 * a minute while the candle isn't out, and called off — with the reason on
 * the game — when the feed still hasn't answered half an hour on. Returns
 * how many it settled or called off.
 */
export async function settleMarketQuestions(now = Date.now()) {
  const due = await Game.find({
    status: { $in: ["open", "locked"] },
    "oracle.at": { $lte: new Date(now - ORACLE_READY_MS) },
  });
  let done = 0;
  for (const g of due) {
    const o = g.oracle;
    if (!o) continue;
    const key = String(g._id);
    if (now - (oracleTries.get(key) ?? -Infinity) < ORACLE_RETRY_MS) continue;
    oracleTries.set(key, now);
    if (oracleTries.size > 1000) oracleTries.delete(oracleTries.keys().next().value!);
    try {
      const price = await priceAt(o.symbol, o.at, now);
      if (price !== null) {
        o.price = price;
        await settleGame(g, price > o.above ? "a" : "b", undefined, "market");
        await audit(null, "game.market_settle", "game", g._id as mongoose.Types.ObjectId, { symbol: o.symbol, above: o.above, at: o.at, price, entries: g.entries });
        oracleTries.delete(key);
        done += 1;
      } else if (now - new Date(o.at).getTime() >= ORACLE_GIVE_UP_MS) {
        o.failed = `Coinbase never gave ${baseOf(o.symbol)}'s price for that minute`;
        await cancelGame(g);
        await audit(null, "game.market_called_off", "game", g._id as mongoose.Types.ObjectId, { symbol: o.symbol, above: o.above, at: o.at, entries: g.entries });
        oracleTries.delete(key);
        done += 1;
      }
    } catch (error) {
      console.error("market question settle failed:", error);
    }
  }
  return done;
}

/** For tests: forget when each market question was last tried. */
export function clearMarketQuestionTries() {
  oracleTries.clear();
}

/**
 * Once a second: close windows that ran out; quizzes settle themselves the
 * moment they close. Every ten seconds: settle the market questions whose
 * minute is over. Once a minute: refund games nobody settled in a day.
 */
export function startGameSweep() {
  const tick = async () => {
    const due = await Game.find({ status: "open", closesAt: { $lte: new Date() } });
    for (const g of due) {
      if (g.type === "quiz") {
        await settleGame(g, null).catch((e) => console.error("quiz auto-settle failed:", e));
        continue;
      }
      g.status = "locked";
      await g.save();
      await fanOutGame(g);
    }
  };
  setInterval(() => void tick().catch((e) => console.error("game sweep failed:", e)), 1000);
  setInterval(() => void settleMarketQuestions().catch((e) => console.error("market question sweep failed:", e)), 10_000);
  setInterval(() => void refundStaleGames().catch((e) => console.error("stale game sweep failed:", e)), 60_000);
}

/**
 * Drops: every twenty minutes, in every live room, one viewer who has been
 * there at least twenty minutes gets points — paid, written into chat so
 * the room sees it, and pushed as an event for the on-player moment.
 */
export function startDropSweep() {
  const tick = async () => {
    const live = await Stream.find({ isLive: true, practice: { $ne: true } }).select("_id livekitRoomName").lean();
    for (const s of live) {
      const eligible = await WatchSession.aggregate<{ _id: mongoose.Types.ObjectId }>([
        { $match: { streamId: s._id, leftAt: null, joinedAt: { $lte: new Date(Date.now() - DROP_MIN_WATCH_MS) } } },
        { $group: { _id: "$userId" } },
        { $sample: { size: 1 } },
      ]);
      const winnerId = eligible[0]?._id;
      if (!winnerId) continue;
      const winner = await User.findById(winnerId).select("username avatar").lean();
      if (!winner) continue;
      try {
        await awardPoints(winnerId, DROP_POINTS, "drop", s._id as mongoose.Types.ObjectId);
        const message = await ChatMessage.create({
          streamId: s._id,
          userId: winnerId,
          username: winner.username,
          avatar: winner.avatar,
          isMod: false,
          content: "caught a drop",
          type: "tip",
          tipAmount: String(DROP_POINTS),
          tipCurrency: "PTS",
          emoji: "🎁",
          platform: "xstream",
        });
        await sendRoomData(s.livekitRoomName, {
          __evt: "drop",
          id: String(message._id),
          userId: String(winnerId),
          username: winner.username,
          avatar: winner.avatar,
          points: DROP_POINTS,
        }).catch(() => {});
      } catch (error) {
        console.error("drop failed:", error);
      }
    }
  };
  setInterval(() => void tick().catch((e) => console.error("drop sweep failed:", e)), DROP_EVERY_MS);
}
