import mongoose from "mongoose";
import { countsInGiftFilter } from "@xtreme/contracts";
import {
  Battle,
  BattleQueue,
  GiftTransaction,
  Notification,
  Stream,
  User,
  type BattleMode,
  type IBattle,
  type IGiftTransaction,
  type IStream,
} from "./models.js";
import { sendRoomData } from "./livekit.js";
import { audit, payBattleBonus } from "./rewards.js";
import { relayBattleResult } from "./socials-relay.js";
import { fireRules } from "./rules.js";
import {
  PRACTICE_BATTLE_SEC,
  PRACTICE_FIRST_MOVE_MS,
  PRACTICE_GIFTS_KEPT,
  SPARRING_NAME,
  practiceMove,
  type PracticeGiftDef,
} from "./practice-battle.js";

/**
 * Live battles: two creators, one clock, the audience decides with gifts.
 * Or two pairs (2v2): each side is a stream and the partner on its stage,
 * and a winning pair splits the bonus.
 *
 * Everything that matters is decided here, on the server: when the clock
 * starts and ends, how much a gift counts (double in the closing window),
 * whether there is overtime, who won and what they get. Clients render the
 * view this module fans out and never compute a result themselves.
 *
 * A practice battle (practice-battle.ts) runs through all of it too —
 * against a stand-in, with simulated gifts, and with every payout, list
 * and notification skipped.
 */

/** Share of the platform's commission on battle gifts paid to the winner. */
const BONUS_SHARE = 0.25;
/** A tie at the clock earns one extra minute, once. */
const OVERTIME_SEC = 60;
/** An invite nobody answers dies after this. */
const INVITE_TTL_MS = 90_000;
/** Accounts younger than this can't move the score (they can still gift). */
const MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;
/** A counting gift with this little left resets the clock to LATE_RESET_SEC — once a battle. */
const LATE_WINDOW_SEC = 10;
const LATE_RESET_SEC = 15;
/** How long a quick-match request waits for an opponent. */
const QUEUE_TTL_MS = 120_000;
/** How many backers each side shows. */
const TOP_BACKERS = 3;
/** The victory lap: how long a win's result stays up (the loser does the forfeit). Either host can end it early. */
export const VICTORY_LAP_SEC = 180;
/** A draw has no lap: the result shows this long, then the stage goes back to normal. */
export const DRAW_RESULT_SEC = 8;
/** A result settled before laps existed shows this long after the clock. */
const LEGACY_RESULT_MS = 120_000;
/** How far back a streak is counted — a run longer than this reads as this. */
const STREAK_LOOKBACK = 50;

export interface BattleView {
  id: string;
  status: IBattle["status"];
  scheduledAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  durationSec: number;
  multiplierWindowSec: number;
  multiplier: number;
  host: BattleSideView;
  challenger: BattleSideView;
  winnerId: string | null;
  bonusUsdMinor: number;
  overtimeUsed: boolean;
  lateResetUsed: boolean;
  /** What the loser does on the victory lap; "" for none. */
  forfeit: string;
  mode: BattleMode;
  /** Catalog ids of the gifts that count toward the score; [] for every gift. */
  giftFilter: string[];
  endedReason: string | null;
  /** A practice battle: the challenger is the stand-in, and the scores are simulated — never money. */
  practice: boolean;
  /** When the result stops showing (the victory lap, or a draw's few seconds); null before it's settled. */
  lapEndsAt: string | null;
}
interface PartnerView {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
}
interface BattleSideView {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  streamId: string;
  usdMinor: number;
  /** The side's biggest backers, by what their gifts scored. */
  top: Array<{ userId: string; username: string; displayName: string; avatar: string; usdMinor: number }>;
  /** A 2v2's partner on this side's stage; null in a 1v1 (or if they'd left before the clock). */
  partner: PartnerView | null;
  /**
   * Straight wins in a row: the run going in, and — once this battle is
   * settled — one more for the winner, nothing for a loss or a draw.
   */
  streak: number;
}

const USER_FIELDS = "username displayName avatar";

/** Each side's top backers, by what their gifts scored for it. Only a battle that has run has any. */
async function topBackers(b: IBattle) {
  const empty = { host: [] as BattleSideView["top"], challenger: [] as BattleSideView["top"] };
  if (!["live", "overtime", "ended"].includes(b.status)) return empty;
  const rows = await GiftTransaction.aggregate<{ _id: { side: "host" | "challenger"; u: mongoose.Types.ObjectId }; usd: number }>([
    { $match: { battleId: b._id, battleScoreUsdMinor: { $gt: 0 } } },
    { $group: { _id: { side: "$battleSide", u: "$senderId" }, usd: { $sum: "$battleScoreUsdMinor" } } },
    { $sort: { usd: -1 } },
  ]);
  const pick = (side: "host" | "challenger") => rows.filter((r) => r._id.side === side).slice(0, TOP_BACKERS);
  const chosen = [...pick("host"), ...pick("challenger")];
  if (chosen.length === 0) return empty;
  const users = await User.find({ _id: { $in: chosen.map((r) => r._id.u) } }).select(USER_FIELDS).lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const view = (side: "host" | "challenger") =>
    pick(side).map((r) => {
      const u = byId.get(String(r._id.u));
      return { userId: String(r._id.u), username: u?.username ?? "", displayName: u?.displayName || u?.username || "Someone", avatar: u?.avatar ?? "", usdMinor: r.usd };
    });
  return { host: view("host"), challenger: view("challenger") };
}

/** A practice battle's top backers: the made-up names its simulated gifts came from. */
function practiceBackers(b: IBattle) {
  const sums = new Map<string, { side: "host" | "challenger"; sender: string; usd: number }>();
  for (const g of b.practiceGifts ?? []) {
    const key = `${g.side}|${g.sender}`;
    const row = sums.get(key) ?? { side: g.side, sender: g.sender, usd: 0 };
    row.usd += g.usdMinor;
    sums.set(key, row);
  }
  const rows = [...sums.values()].sort((x, y) => y.usd - x.usd);
  const view = (side: "host" | "challenger") =>
    rows
      .filter((r) => r.side === side)
      .slice(0, TOP_BACKERS)
      .map((r) => ({ userId: `practice:${r.sender}`, username: "", displayName: r.sender, avatar: "", usdMinor: r.usd }));
  return { host: view("host"), challenger: view("challenger") };
}

export async function toBattleView(b: IBattle): Promise<BattleView> {
  const partnerIds = [b.hostPartnerId, b.challengerPartnerId].filter((id): id is mongoose.Types.ObjectId => Boolean(id));
  const practice = Boolean(b.practice);
  const [host, challenger, top, partners] = await Promise.all([
    User.findById(b.hostId).select(USER_FIELDS).lean(),
    // The sparring partner is nobody: there's no one to look up.
    practice ? Promise.resolve(null) : User.findById(b.challengerId).select(USER_FIELDS).lean(),
    practice ? practiceBackers(b) : topBackers(b),
    partnerIds.length ? User.find({ _id: { $in: partnerIds } }).select(USER_FIELDS).lean() : Promise.resolve([]),
  ]);
  const partnerView = (id: mongoose.Types.ObjectId | null | undefined): PartnerView | null => {
    if (!id) return null;
    const u = partners.find((p) => String(p._id) === String(id));
    return { userId: String(id), username: u?.username ?? "", displayName: u?.displayName || u?.username || "Partner", avatar: u?.avatar ?? "" };
  };
  const side = (
    u: typeof host,
    id: mongoose.Types.ObjectId,
    streamId: mongoose.Types.ObjectId,
    usd: number,
    backers: BattleSideView["top"],
    partner: PartnerView | null,
    streak: number,
  ): BattleSideView => ({
    userId: String(id),
    username: u?.username ?? "",
    displayName: u?.displayName || u?.username || "Streamer",
    avatar: u?.avatar ?? "",
    streamId: String(streamId),
    usdMinor: usd,
    top: backers,
    partner,
    streak,
  });
  return {
    id: String(b._id),
    status: b.status,
    scheduledAt: b.scheduledAt ? b.scheduledAt.toISOString() : null,
    startsAt: b.startsAt ? b.startsAt.toISOString() : null,
    endsAt: b.endsAt ? b.endsAt.toISOString() : null,
    durationSec: b.durationSec,
    multiplierWindowSec: b.multiplierWindowSec,
    multiplier: b.multiplier,
    host: side(host, b.hostId, b.hostStreamId, b.hostUsdMinor, top.host, partnerView(b.hostPartnerId), streakShown(b, "host")),
    challenger: practice
      ? {
          ...side(null, b.challengerId, b.challengerStreamId, b.challengerUsdMinor, top.challenger, null, 0),
          displayName: SPARRING_NAME,
        }
      : side(challenger, b.challengerId, b.challengerStreamId, b.challengerUsdMinor, top.challenger, partnerView(b.challengerPartnerId), streakShown(b, "challenger")),
    winnerId: b.winnerId ? String(b.winnerId) : null,
    bonusUsdMinor: b.bonusUsdMinor,
    overtimeUsed: b.overtimeUsed,
    lateResetUsed: Boolean(b.lateResetUsed),
    forfeit: b.forfeit ?? "",
    mode: b.mode ?? "1v1",
    giftFilter: [...(b.giftFilter ?? [])],
    endedReason: b.endedReason,
    practice,
    lapEndsAt: b.lapEndsAt ? b.lapEndsAt.toISOString() : null,
  };
}

/**
 * A side's streak as the view shows it — from the battle alone, no query
 * (the view is built on every gift's fan-out). Going in, the run stored at
 * the start; settled, the winner's run plus this win, and nothing for a
 * loss or a draw, which end a run. Practice battles have no streaks.
 */
export function streakShown(
  b: Pick<IBattle, "status" | "winnerId" | "hostId" | "challengerId" | "hostStreak" | "challengerStreak" | "practice">,
  which: "host" | "challenger",
) {
  if (b.practice) return 0;
  const before = Math.max(0, (which === "host" ? b.hostStreak : b.challengerStreak) ?? 0);
  if (b.status !== "ended") return before;
  const id = which === "host" ? b.hostId : b.challengerId;
  return b.winnerId && String(b.winnerId) === String(id) ? before + 1 : 0;
}

/**
 * A creator's straight wins going into their next battle: their settled
 * real battles, newest first, counted until the first that wasn't a win (a
 * loss or a draw). Cancelled and practice battles never count either way.
 */
export async function creatorStreak(userId: mongoose.Types.ObjectId) {
  const recent = await Battle.find({ status: "ended", practice: { $ne: true }, $or: [{ hostId: userId }, { challengerId: userId }] })
    .sort({ endsAt: -1 })
    .limit(STREAK_LOOKBACK)
    .select("winnerId")
    .lean();
  let run = 0;
  for (const b of recent) {
    if (!b.winnerId || String(b.winnerId) !== String(userId)) break;
    run += 1;
  }
  return run;
}

/** One gift that moved a battle's score, as the clash view animates it. */
export interface BattleGiftView {
  id: string;
  side: "host" | "challenger";
  /** What it added to the side's score (the ×2 window already applied), USD cents. */
  usdMinor: number;
  giftName: string;
  emoji: string;
  sender: { userId: string; displayName: string };
  at: string;
}

/** How many recent gifts the activity feed hands back at most. */
export const ACTIVITY_LIMIT = 24;

/**
 * The gifts that counted toward a battle, newest first — only the ones
 * after `since`, when given, so a viewer polling the clash view gets just
 * what's new. Senders by display name only: the feed is public and polled
 * every few seconds, so it stays light (no avatars).
 */
export async function battleActivity(battleId: mongoose.Types.ObjectId, since: Date | null, limit = ACTIVITY_LIMIT): Promise<BattleGiftView[]> {
  const filter: Record<string, unknown> = { battleId, battleScoreUsdMinor: { $gt: 0 } };
  if (since) filter.createdAt = { $gt: since };
  const rows = await GiftTransaction.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(limit, ACTIVITY_LIMIT)))
    .select("senderId giftName emoji battleSide battleScoreUsdMinor createdAt")
    .lean();
  if (rows.length === 0) return [];
  const senders = await User.find({ _id: { $in: [...new Set(rows.map((r) => String(r.senderId)))] } })
    .select("username displayName")
    .lean();
  const byId = new Map(senders.map((u) => [String(u._id), u]));
  return rows
    .filter((r) => r.battleSide === "host" || r.battleSide === "challenger")
    .map((r) => {
      const u = byId.get(String(r.senderId));
      return {
        id: String(r._id),
        side: r.battleSide as "host" | "challenger",
        usdMinor: r.battleScoreUsdMinor,
        giftName: r.giftName ?? "",
        emoji: r.emoji ?? "",
        sender: { userId: String(r.senderId), displayName: u?.displayName || u?.username || "Someone" },
        at: new Date(r.createdAt).toISOString(),
      };
    });
}

/** A practice battle's simulated gifts, as the same feed: newest first, only after `since` when given. */
export function practiceActivity(b: IBattle, since: Date | null, limit = ACTIVITY_LIMIT): BattleGiftView[] {
  return [...(b.practiceGifts ?? [])]
    .filter((g) => !since || new Date(g.at).getTime() > since.getTime())
    .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
    .slice(0, Math.max(1, Math.min(limit, ACTIVITY_LIMIT)))
    .map((g) => ({
      id: String(g._id),
      side: g.side,
      usdMinor: g.usdMinor,
      giftName: g.giftName,
      emoji: g.emoji,
      sender: { userId: `practice:${g.sender}`, displayName: g.sender },
      at: new Date(g.at).toISOString(),
    }));
}

/**
 * The partner a 2v2 side brings: the first guest live on its stage (a
 * viewer brought up, or a creator who came over by co-live). Null when the
 * stage is empty.
 */
export async function stagePartner(streamId: mongoose.Types.ObjectId | string) {
  const stream = await Stream.findById(streamId).select("guests").lean();
  const guest = stream?.guests?.find((g) => g.status === "live");
  return guest ? (guest.userId as mongoose.Types.ObjectId) : null;
}

/**
 * Who the bonus goes to: the winner, or — in a 2v2 — the winner and their
 * partner, half each (the winner keeps the odd cent). The partner earns no
 * gifts on someone else's stream, so this is their share of the win.
 */
export function bonusShares(b: Pick<IBattle, "winnerId" | "bonusUsdMinor" | "hostId" | "hostPartnerId" | "challengerPartnerId">) {
  if (!b.winnerId || b.bonusUsdMinor <= 0) return [];
  const partner = partnerOf(b, b.winnerId);
  if (!partner) return [{ userId: b.winnerId, usdMinor: b.bonusUsdMinor }];
  const half = Math.floor(b.bonusUsdMinor / 2);
  return [
    { userId: b.winnerId, usdMinor: b.bonusUsdMinor - half },
    ...(half > 0 ? [{ userId: partner, usdMinor: half }] : []),
  ];
}

/** The partner who shares a side's result with this creator, in a 2v2. */
export function partnerOf(b: Pick<IBattle, "hostId" | "hostPartnerId" | "challengerPartnerId">, userId: mongoose.Types.ObjectId) {
  return userId.equals(b.hostId) ? (b.hostPartnerId ?? null) : (b.challengerPartnerId ?? null);
}

/** The battle a stream is in right now (live or overtime), from either side. */
export async function currentBattleForStream(streamId: mongoose.Types.ObjectId | string) {
  const id = new mongoose.Types.ObjectId(String(streamId));
  return Battle.findOne({
    status: { $in: ["live", "overtime"] },
    $or: [{ hostStreamId: id }, { challengerStreamId: id }],
  });
}

/**
 * The battle a stream just finished, while its result is still up: through
 * the victory lap (or a draw's few seconds) — and, for one settled before
 * laps existed, two minutes after the clock.
 */
export async function recentResultForStream(streamId: mongoose.Types.ObjectId | string, now = Date.now()) {
  const id = new mongoose.Types.ObjectId(String(streamId));
  return Battle.findOne({
    status: "ended",
    $and: [
      { $or: [{ hostStreamId: id }, { challengerStreamId: id }] },
      { $or: [{ lapEndsAt: { $gt: new Date(now) } }, { lapEndsAt: null, endsAt: { $gte: new Date(now - LEGACY_RESULT_MS) } }] },
    ],
  }).sort({ endsAt: -1 });
}

/** When a settled battle's result stops showing: the victory lap after a win, a few seconds after a draw. */
export function lapEndFor(b: Pick<IBattle, "winnerId" | "endsAt">, now = Date.now()) {
  const end = b.endsAt ? Math.min(b.endsAt.getTime(), now) : now;
  return new Date(end + (b.winnerId ? VICTORY_LAP_SEC : DRAW_RESULT_SEC) * 1000);
}

/** Whether a settled battle's result (its lap) is still up. */
export function lapOpen(b: Pick<IBattle, "status" | "lapEndsAt">, now = Date.now()) {
  return b.status === "ended" && Boolean(b.lapEndsAt) && b.lapEndsAt!.getTime() > now;
}

/** End the victory lap now: the result comes down in both rooms. */
export async function endLap(battle: IBattle, now = Date.now()) {
  battle.lapEndsAt = new Date(now);
  await battle.save();
  await fanOutBattle(battle);
  return battle;
}

/** Push the current view to both rooms. Fire-and-forget: a dropped frame is re-synced by the next one. */
export async function fanOutBattle(b: IBattle) {
  const view = await toBattleView(b);
  const streams = await Stream.find({ _id: { $in: [b.hostStreamId, b.challengerStreamId] } })
    .select("livekitRoomName")
    .lean();
  await Promise.all(
    streams.map((s) => sendRoomData(s.livekitRoomName, { __evt: "battle", battle: view }).catch(() => {})),
  );
  return view;
}

async function notify(userId: mongoose.Types.ObjectId, type: "battle_invite" | "battle_result", actor: { _id: mongoose.Types.ObjectId; username: string; displayName?: string }, stream: Pick<IStream, "_id" | "title">) {
  try {
    await Notification.create({
      userId,
      type,
      actorId: actor._id,
      actorName: actor.displayName || actor.username,
      streamId: stream._id,
      streamTitle: stream.title,
      read: false,
    });
  } catch (error) {
    console.error("battle notification failed:", error);
  }
}

/**
 * Create an invite from a live host to a live challenger, with what the
 * loser does and which gifts count, if they say so. The challenger sees
 * both on the invite before they accept.
 */
export async function inviteToBattle(
  host: { _id: mongoose.Types.ObjectId; username: string; displayName?: string },
  hostStream: IStream,
  challengerStream: IStream,
  forfeit = "",
  mode: BattleMode = "1v1",
  giftFilter: string[] = [],
  /** The clock's length; the model's five minutes when unset. A rematch keeps the last battle's. */
  durationSec?: number,
) {
  const battle = await Battle.create({
    hostId: host._id,
    challengerId: challengerStream.streamerId,
    hostStreamId: hostStream._id,
    challengerStreamId: challengerStream._id,
    status: "invited",
    invitedAt: new Date(),
    forfeit,
    mode,
    giftFilter,
    ...(durationSec ? { durationSec } : {}),
  });
  await notify(challengerStream.streamerId as mongoose.Types.ObjectId, "battle_invite", host, hostStream);
  // The challenger's room hears it too, so the studio shows the invite at once.
  const view = await toBattleView(battle);
  await sendRoomData(challengerStream.livekitRoomName, { __evt: "battle_invite", battle: view }).catch(() => {});
  return battle;
}

/** Accept: the clock starts now. A 2v2 takes each side's partner off its stage as it starts. */
export async function startBattle(battle: IBattle) {
  const now = new Date();
  if (battle.mode === "2v2") {
    const [hp, cp] = await Promise.all([stagePartner(battle.hostStreamId), stagePartner(battle.challengerStreamId)]);
    battle.hostPartnerId = hp;
    battle.challengerPartnerId = cp;
  }
  // Each side's run of wins going in — counted once here, so the view never has to.
  if (!battle.practice) {
    const [hs, cs] = await Promise.all([creatorStreak(battle.hostId), creatorStreak(battle.challengerId)]);
    battle.hostStreak = hs;
    battle.challengerStreak = cs;
  }
  battle.status = "live";
  battle.startsAt = now;
  battle.endsAt = new Date(now.getTime() + battle.durationSec * 1000);
  await battle.save();
  await fanOutBattle(battle);
  return battle;
}

/**
 * A gift landed on a stream. If that stream is in a live battle, count it
 * toward its side (double inside the closing window), stamp the gift, and
 * push the new score to both rooms. A battle with a gift filter scores only
 * the gifts it names; the rest are stamped with a score of nothing (they
 * are still the host's money, like any gift).
 */
export async function applyBattleGift(stream: IStream, gift: IGiftTransaction, sender: { _id: mongoose.Types.ObjectId; createdAt?: Date }) {
  const battle = await currentBattleForStream(stream._id);
  // A practice battle scores simulated gifts only (recordPracticeGift) — never money.
  if (!battle || !battle.endsAt || battle.practice) return null;
  const side: "host" | "challenger" = battle.hostStreamId.equals(stream._id) ? "host" : "challenger";

  // Self-backing and brand-new accounts don't move the score.
  const receiver = side === "host" ? battle.hostId : battle.challengerId;
  const tooYoung = sender.createdAt ? Date.now() - sender.createdAt.getTime() < MIN_ACCOUNT_AGE_MS : false;
  const counts = !receiver.equals(sender._id) && !tooYoung && countsInGiftFilter(battle.giftFilter, gift);

  const now = Date.now();
  const inWindow = battle.endsAt.getTime() - now <= battle.multiplierWindowSec * 1000;
  const score = counts ? gift.grossUsdMinor * (inWindow ? battle.multiplier : 1) : 0;

  await GiftTransaction.updateOne(
    { _id: gift._id },
    { $set: { battleId: battle._id, battleSide: side, battleScoreUsdMinor: score } },
  );
  const inc: Record<string, number> = { commissionUsdMinor: gift.commissionUsdMinor };
  if (score > 0) inc[side === "host" ? "hostUsdMinor" : "challengerUsdMinor"] = score;
  let updated = await Battle.findByIdAndUpdate(battle._id, { $inc: inc }, { new: true });
  if (score > 0) updated = (await lateReset(battle, now)) ?? updated;
  if (updated) await fanOutBattle(updated);
  return updated;
}

/**
 * A gift that counts in the last seconds resets the clock — once a battle,
 * decided by the write itself so two late gifts can't both reset it. The
 * battle as reset, or null when it didn't.
 */
async function lateReset(battle: IBattle, now: number) {
  if (!battle.endsAt || battle.endsAt.getTime() - now > LATE_WINDOW_SEC * 1000) return null;
  return Battle.findOneAndUpdate(
    { _id: battle._id, status: { $in: ["live", "overtime"] }, lateResetUsed: { $ne: true } },
    { $set: { lateResetUsed: true, endsAt: new Date(now + LATE_RESET_SEC * 1000) } },
    { new: true },
  );
}

/**
 * Start a practice battle for a host in a practice run: the clock starts
 * at once, against the sparring partner. Nobody is invited or told; the
 * challenger's ids are fresh and point at no user and no stream.
 */
export async function startPracticeBattle(host: { _id: mongoose.Types.ObjectId }, stream: IStream) {
  const now = new Date();
  const battle = await Battle.create({
    hostId: host._id,
    challengerId: new mongoose.Types.ObjectId(),
    hostStreamId: stream._id,
    challengerStreamId: new mongoose.Types.ObjectId(),
    status: "live",
    invitedAt: now,
    startsAt: now,
    durationSec: PRACTICE_BATTLE_SEC,
    endsAt: new Date(now.getTime() + PRACTICE_BATTLE_SEC * 1000),
    mode: "1v1",
    practice: true,
    practiceGifts: [],
    practiceNextAt: new Date(now.getTime() + PRACTICE_FIRST_MOVE_MS),
  });
  await fanOutBattle(battle);
  return battle;
}

/**
 * A simulated gift in a practice battle: scored by the same rules as a real
 * one (×2 in the closing window, the late reset), kept on the battle, and
 * fanned out the same way. Nothing is charged, and no gift ledger row is
 * written. Null when the battle isn't running any more.
 */
export async function recordPracticeGift(battle: IBattle, side: "host" | "challenger", gift: Pick<PracticeGiftDef, "name" | "emoji" | "usdMinor">, sender: string, now = Date.now()) {
  if (!battle.practice || !battle.endsAt) return null;
  const inWindow = battle.endsAt.getTime() - now <= battle.multiplierWindowSec * 1000;
  const score = gift.usdMinor * (inWindow ? battle.multiplier : 1);
  const row = { _id: new mongoose.Types.ObjectId(), side, usdMinor: score, giftName: gift.name, emoji: gift.emoji, sender, at: new Date(now) };
  let updated = await Battle.findOneAndUpdate(
    { _id: battle._id, practice: true, status: { $in: ["live", "overtime"] } },
    {
      $inc: { [side === "host" ? "hostUsdMinor" : "challengerUsdMinor"]: score },
      $push: { practiceGifts: { $each: [row], $slice: -PRACTICE_GIFTS_KEPT } },
    },
    { new: true },
  );
  if (!updated) return null;
  updated = (await lateReset(updated, now)) ?? updated;
  await fanOutBattle(updated);
  return updated;
}

/**
 * The sparring partner's turn, once a second from the sweep: for each
 * running practice battle whose next move is due, claim the move (a
 * conditional write on `practiceNextAt`, so two sweeps never both make it)
 * and play it.
 */
export async function playPracticeBattles(now = Date.now(), rand: () => number = Math.random) {
  const running = await Battle.find({ practice: true, status: { $in: ["live", "overtime"] }, practiceNextAt: { $lte: new Date(now) } });
  for (const b of running) {
    if (!b.endsAt || !b.practiceNextAt || b.endsAt.getTime() <= now) continue;
    try {
      const move = practiceMove(
        {
          now,
          endsAt: b.endsAt.getTime(),
          hostUsdMinor: b.hostUsdMinor,
          challengerUsdMinor: b.challengerUsdMinor,
          multiplier: b.multiplier,
          multiplierWindowSec: b.multiplierWindowSec,
          lateResetUsed: Boolean(b.lateResetUsed),
        },
        rand,
      );
      const claimed = await Battle.findOneAndUpdate(
        { _id: b._id, practiceNextAt: b.practiceNextAt },
        { $set: { practiceNextAt: new Date(move.nextAt) } },
        { new: true },
      );
      if (!claimed) continue;
      await recordPracticeGift(claimed, move.side, move.gift, move.sender, now);
    } catch (error) {
      console.error("practice battle move failed:", error);
    }
  }
}

/** A live stream that isn't already in a battle or holding an open invite. */
async function streamIsFree(streamId: mongoose.Types.ObjectId) {
  return !(await Battle.exists({
    status: { $in: ["invited", "live", "overtime"] },
    $or: [{ hostStreamId: streamId }, { challengerStreamId: streamId }],
  }));
}

/**
 * Quick match: pair with whoever has waited longest, or wait for the next
 * host to ask. Both asked for a battle, so it starts at once — no invite to
 * answer. Someone whose stream ended while waiting is passed over. Every
 * gift counts in a quick match: nobody agreed to a filter, and one would
 * split the queue into pools too small to meet in.
 */
export async function quickMatch(me: { _id: mongoose.Types.ObjectId }, myStream: IStream, mode: BattleMode = "1v1") {
  const since = new Date(Date.now() - QUEUE_TTL_MS);
  // Pairs with pairs, singles with singles (an entry from before modes is a single).
  const sameMode = mode === "2v2" ? { mode: "2v2" } : { mode: { $ne: "2v2" } };
  for (let tries = 0; tries < 3; tries++) {
    const other = await BattleQueue.findOneAndDelete({ userId: { $ne: me._id }, at: { $gte: since }, ...sameMode }, { sort: { at: 1 } });
    if (!other) break;
    const theirs = await Stream.findOne({ _id: other.streamId, isLive: true, practice: { $ne: true } }).select("_id streamerId livekitRoomName");
    if (!theirs || !(await streamIsFree(theirs._id as mongoose.Types.ObjectId))) continue;
    await BattleQueue.deleteOne({ userId: me._id });
    const battle = await Battle.create({
      hostId: other.userId,
      challengerId: me._id,
      hostStreamId: theirs._id,
      challengerStreamId: myStream._id,
      status: "invited",
      invitedAt: new Date(),
      mode,
    });
    return { battle: await startBattle(battle), queued: false as const };
  }
  await BattleQueue.updateOne({ userId: me._id }, { $set: { streamId: myStream._id, mode, at: new Date() } }, { upsert: true });
  return { battle: null, queued: true as const };
}

/** Stop waiting for a quick match. */
export async function leaveQuickMatch(userId: mongoose.Types.ObjectId) {
  await BattleQueue.deleteOne({ userId });
}

/** Whether this host is waiting for a quick match right now. */
export async function inQuickMatch(userId: mongoose.Types.ObjectId) {
  return Boolean(await BattleQueue.exists({ userId, at: { $gte: new Date(Date.now() - QUEUE_TTL_MS) } }));
}

/**
 * The clock ran out: overtime once on a tie, otherwise settle and pay. Or a
 * host conceded (`conceded` names their side): the other side wins, on the
 * same bonus rules as a battle that ran its clock.
 */
export async function settleBattle(
  battle: IBattle,
  reason: NonNullable<IBattle["endedReason"]> = "clock",
  opts: { conceded?: "host" | "challenger" } = {},
) {
  if (reason === "clock" && battle.hostUsdMinor === battle.challengerUsdMinor && !battle.overtimeUsed) {
    battle.status = "overtime";
    battle.overtimeUsed = true;
    battle.endsAt = new Date(Date.now() + OVERTIME_SEC * 1000);
    await battle.save();
    await fanOutBattle(battle);
    return battle;
  }

  const conceded = reason === "conceded" ? (opts.conceded ?? "host") : null;
  battle.status = reason === "clock" || conceded ? "ended" : "cancelled";
  battle.endedReason = reason;
  if (!battle.endsAt || battle.endsAt.getTime() > Date.now()) battle.endsAt = new Date();

  // Practice: a result for the host to see, and nothing else — no bonus,
  // no earnings, no payout or audit row, no relay, no notifications.
  if (battle.practice) return settlePracticeBattle(battle, conceded);

  if (battle.status === "ended") {
    // Conceding hands the other side the win, whatever the score said.
    const hostWins = conceded ? conceded === "challenger" : battle.hostUsdMinor > battle.challengerUsdMinor;
    const tie = !conceded && battle.hostUsdMinor === battle.challengerUsdMinor;
    battle.winnerId = tie ? null : hostWins ? battle.hostId : battle.challengerId;
    battle.bonusUsdMinor = tie ? 0 : Math.floor(battle.commissionUsdMinor * BONUS_SHARE);
    // The bonus is booked to the winner's earnings here — split down the
    // middle with their partner in a 2v2; payBattleBonus pays it out.
    if (battle.winnerId && battle.bonusUsdMinor > 0) {
      for (const share of bonusShares(battle)) {
        await User.updateOne({ _id: share.userId }, { $inc: { earningsUsdMinor: share.usdMinor } });
      }
    }
    battle.lapEndsAt = lapEndFor(battle);
  }
  await battle.save();
  await fanOutBattle(battle);
  await audit(null, battle.status === "ended" ? "battle.settle" : "battle.cancel", "battle", battle._id as mongoose.Types.ObjectId, {
    reason,
    hostUsdMinor: battle.hostUsdMinor,
    challengerUsdMinor: battle.challengerUsdMinor,
    winnerId: battle.winnerId ? String(battle.winnerId) : null,
    bonusUsdMinor: battle.bonusUsdMinor,
  });
  if (battle.status === "ended") {
    // The bonus as money: a payout row, then the wallet. Best-effort here;
    // the payout sweep finishes anything the wallet couldn't take now.
    await payBattleBonus(battle, bonusShares(battle)).catch((e) => console.error("battle bonus payout failed:", e));
    // The Wolf race hears about it — best-effort, the socials side decides scoring.
    void relayBattleResult(battle).catch(() => {});
  }

  if (battle.status === "ended") {
    const [host, challenger, hostStream] = await Promise.all([
      User.findById(battle.hostId).select("username displayName").lean(),
      User.findById(battle.challengerId).select("username displayName").lean(),
      Stream.findById(battle.hostStreamId).select("title").lean(),
    ]);
    if (host && challenger && hostStream) {
      const actorFor = (winner: boolean) => (winner ? host : challenger);
      const winnerIsHost = battle.winnerId ? battle.winnerId.equals(battle.hostId) : false;
      const actor = { _id: (winnerIsHost ? host : challenger)._id as mongoose.Types.ObjectId, username: actorFor(winnerIsHost).username, displayName: actorFor(winnerIsHost).displayName };
      // A 2v2's partners hear how it went too.
      const everyone = [battle.hostId, battle.challengerId, battle.hostPartnerId, battle.challengerPartnerId].filter(
        (id): id is mongoose.Types.ObjectId => Boolean(id),
      );
      await Promise.all(everyone.map((id) => notify(id, "battle_result", actor, hostStream as Pick<IStream, "_id" | "title">)));
      // Each side's show rules for winning or losing (rules.ts) — a tie fires neither.
      if (battle.winnerId) {
        const hostWon = battle.winnerId.equals(battle.hostId);
        void fireRules({ _id: battle.hostStreamId, streamerId: battle.hostId }, { kind: hostWon ? "battle_won" : "battle_lost", opponent: challenger.displayName || challenger.username });
        void fireRules({ _id: battle.challengerStreamId, streamerId: battle.challengerId }, { kind: hostWon ? "battle_lost" : "battle_won", opponent: host.displayName || host.username });
      }
    }
  }
  return battle;
}

/** The end of a practice battle: the winner is named, nothing is paid, and only the host's own show rules hear of it. */
async function settlePracticeBattle(battle: IBattle, conceded: "host" | "challenger" | null = null) {
  battle.bonusUsdMinor = 0;
  if (battle.status === "ended") {
    const tie = !conceded && battle.hostUsdMinor === battle.challengerUsdMinor;
    const hostWins = conceded ? conceded === "challenger" : battle.hostUsdMinor > battle.challengerUsdMinor;
    battle.winnerId = tie ? null : hostWins ? battle.hostId : battle.challengerId;
    // A practice lap too, so the host rehearses the whole thing.
    battle.lapEndsAt = lapEndFor(battle);
  }
  await battle.save();
  await fanOutBattle(battle);
  // The host's "when I win a battle" rules rehearse too, like the practice
  // run's simulated gifts do. The sparring partner has no stream to tell.
  if (battle.status === "ended" && battle.winnerId) {
    const won = battle.winnerId.equals(battle.hostId);
    void fireRules({ _id: battle.hostStreamId, streamerId: battle.hostId }, { kind: won ? "battle_won" : "battle_lost", opponent: SPARRING_NAME });
  }
  return battle;
}

/** A scheduled battle waits past its time this long for both to be live before it lapses. */
const SCHEDULE_GRACE_MS = 15 * 60_000;

/**
 * Book a battle ahead of time. It starts by itself the moment both creators
 * are live at or after the time; nobody has to accept anything on the day.
 * The stream ids are filled in when it starts.
 */
export async function scheduleBattle(
  host: { _id: mongoose.Types.ObjectId; username: string; displayName?: string },
  challenger: { _id: mongoose.Types.ObjectId; username: string; displayName?: string },
  at: Date,
  forfeit = "",
  mode: BattleMode = "1v1",
  giftFilter: string[] = [],
) {
  const placeholder = new mongoose.Types.ObjectId();
  const battle = await Battle.create({
    hostId: host._id,
    challengerId: challenger._id,
    hostStreamId: placeholder,
    challengerStreamId: placeholder,
    status: "scheduled",
    invitedAt: new Date(),
    scheduledAt: at,
    forfeit,
    mode,
    giftFilter,
  });
  const fake = { _id: placeholder, title: `Battle: ${host.displayName || host.username} vs ${challenger.displayName || challenger.username}` } as Pick<IStream, "_id" | "title">;
  await notify(challenger._id, "battle_invite", host, fake);
  return battle;
}

/** Booked battles, soonest first. */
export async function upcomingBattles(limit = 12) {
  return Battle.find({ status: "scheduled", practice: { $ne: true }, scheduledAt: { $gte: new Date(Date.now() - SCHEDULE_GRACE_MS) } })
    .sort({ scheduledAt: 1 })
    .limit(limit);
}

/**
 * Once a second: end battles past their clock, expire unanswered invites,
 * start booked battles whose time has come, cancel battles whose
 * streams have gone offline — and play the sparring partner's moves in
 * practice battles.
 */
export function startBattleSweep() {
  const tick = async () => {
    const now = new Date();

    // Booked battles: both live → start; too long overdue → lapse.
    const booked = await Battle.find({ status: "scheduled", scheduledAt: { $lte: now } });
    for (const b of booked) {
      try {
        const [hs, cs] = await Promise.all([
          Stream.findOne({ streamerId: b.hostId, isLive: true, practice: { $ne: true } }).select("_id"),
          Stream.findOne({ streamerId: b.challengerId, isLive: true, practice: { $ne: true } }).select("_id"),
        ]);
        // A booked 2v2 waits for both partners to be on stage, too.
        const pairsReady =
          b.mode !== "2v2" ||
          Boolean(hs && cs && (await stagePartner(hs._id as mongoose.Types.ObjectId)) && (await stagePartner(cs._id as mongoose.Types.ObjectId)));
        if (hs && cs && pairsReady) {
          b.hostStreamId = hs._id as mongoose.Types.ObjectId;
          b.challengerStreamId = cs._id as mongoose.Types.ObjectId;
          await startBattle(b);
        } else if (b.scheduledAt && now.getTime() - b.scheduledAt.getTime() > SCHEDULE_GRACE_MS) {
          b.status = "cancelled";
          b.endedReason = "expired";
          await b.save();
        }
      } catch (error) {
        console.error("scheduled battle start failed:", error);
      }
    }
    const due = await Battle.find({ status: { $in: ["live", "overtime"] }, endsAt: { $lte: now } });
    for (const b of due) {
      try {
        // Both streams still live? Otherwise the battle doesn't count. A
        // practice battle has one stream: the host's practice run.
        const live = await Stream.countDocuments({ _id: { $in: [b.hostStreamId, b.challengerStreamId] }, isLive: true });
        await settleBattle(b, live === (b.practice ? 1 : 2) ? "clock" : "disconnect");
      } catch (error) {
        console.error("battle settle failed:", error);
      }
    }
    await Battle.updateMany(
      { status: "invited", invitedAt: { $lte: new Date(now.getTime() - INVITE_TTL_MS) } },
      { $set: { status: "cancelled", endedReason: "expired" } },
    );
    await playPracticeBattles(now.getTime());
  };
  setInterval(() => void tick().catch((e) => console.error("battle sweep failed:", e)), 1000);
}
