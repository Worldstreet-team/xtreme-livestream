import mongoose from "mongoose";
import { ChatMessage, Game, GameEntry, Stream, User, WatchSession, type GameType, type IGame, type IStream } from "./models.js";
import { sendRoomData } from "./livekit.js";
import { awardPoints } from "./points.js";

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
  /** The caller's own entry, when they have one. */
  mine?: { outcome: string; stakePoints: number; wonPoints: number } | null;
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
    ...(mine !== undefined ? { mine } : {}),
  };
}

/** The game a stream is running now (open or locked), or the one it settled in the last two minutes. */
export async function currentGameForStream(streamId: mongoose.Types.ObjectId | string) {
  const id = new mongoose.Types.ObjectId(String(streamId));
  return (
    (await Game.findOne({ streamId: id, status: { $in: ["open", "locked"] } }).sort({ createdAt: -1 })) ??
    (await Game.findOne({ streamId: id, status: "settled", settledAt: { $gte: new Date(Date.now() - 120_000) } }).sort({ settledAt: -1 }))
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
    closesAt: new Date(Date.now() + input.durationSec * 1000),
    ticketPoints: input.type === "raffle" ? input.ticketPoints : 0,
    winnersCount: input.type === "raffle" ? Math.max(1, input.winnersCount) : 1,
    prizePoints: input.prizePoints,
    correctOutcome:
      input.type === "quiz" && input.correctIndex !== null && input.correctIndex < input.outcomes.length ? idAt(input.correctIndex) : null,
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

  const cost = game.type === "prediction" ? stake : game.type === "raffle" ? game.ticketPoints : 0;
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
 * outcome's entries (all refunded if nobody backed it). Raffle: draw N
 * distinct tickets, split tickets + prize equally. Quiz: every correct entry
 * gets the prize.
 */
export async function settleGame(game: IGame, winningOutcome: string | null) {
  if (!["open", "locked"].includes(game.status)) throw new Error("NOT_SETTLEABLE");
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
      for (const e of await GameEntry.find({ gameId: game._id })) await awardPoints(e.userId, e.stakePoints, "game_refund", ref).catch(() => {});
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

/** Once a second: close windows that ran out; quizzes settle themselves the moment they close. */
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
}

/**
 * Drops: every twenty minutes, in every live room, one viewer who has been
 * there at least twenty minutes gets points — paid, written into chat so
 * the room sees it, and pushed as an event for the on-player moment.
 */
export function startDropSweep() {
  const tick = async () => {
    const live = await Stream.find({ isLive: true }).select("_id livekitRoomName").lean();
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
