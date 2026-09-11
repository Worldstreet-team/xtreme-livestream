import mongoose from "mongoose";
import {
  Battle,
  GiftTransaction,
  Notification,
  Stream,
  User,
  type IBattle,
  type IGiftTransaction,
  type IStream,
} from "./models.js";
import { sendRoomData } from "./livekit.js";
import { audit, payBattleBonus } from "./rewards.js";
import { relayBattleResult } from "./socials-relay.js";

/**
 * Live battles: two creators, one clock, the audience decides with gifts.
 *
 * Everything that matters is decided here, on the server: when the clock
 * starts and ends, how much a gift counts (double in the closing window),
 * whether there is overtime, who won and what they get. Clients render the
 * view this module fans out and never compute a result themselves.
 */

/** Share of the platform's commission on battle gifts paid to the winner. */
const BONUS_SHARE = 0.25;
/** A tie at the clock earns one extra minute, once. */
const OVERTIME_SEC = 60;
/** An invite nobody answers dies after this. */
const INVITE_TTL_MS = 90_000;
/** Accounts younger than this can't move the score (they can still gift). */
const MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;

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
  endedReason: string | null;
}
interface BattleSideView {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  streamId: string;
  usdMinor: number;
}

const USER_FIELDS = "username displayName avatar";

export async function toBattleView(b: IBattle): Promise<BattleView> {
  const [host, challenger] = await Promise.all([
    User.findById(b.hostId).select(USER_FIELDS).lean(),
    User.findById(b.challengerId).select(USER_FIELDS).lean(),
  ]);
  const side = (u: typeof host, id: mongoose.Types.ObjectId, streamId: mongoose.Types.ObjectId, usd: number): BattleSideView => ({
    userId: String(id),
    username: u?.username ?? "",
    displayName: u?.displayName || u?.username || "Streamer",
    avatar: u?.avatar ?? "",
    streamId: String(streamId),
    usdMinor: usd,
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
    host: side(host, b.hostId, b.hostStreamId, b.hostUsdMinor),
    challenger: side(challenger, b.challengerId, b.challengerStreamId, b.challengerUsdMinor),
    winnerId: b.winnerId ? String(b.winnerId) : null,
    bonusUsdMinor: b.bonusUsdMinor,
    overtimeUsed: b.overtimeUsed,
    endedReason: b.endedReason,
  };
}

/** The battle a stream is in right now (live or overtime), from either side. */
export async function currentBattleForStream(streamId: mongoose.Types.ObjectId | string) {
  const id = new mongoose.Types.ObjectId(String(streamId));
  return Battle.findOne({
    status: { $in: ["live", "overtime"] },
    $or: [{ hostStreamId: id }, { challengerStreamId: id }],
  });
}

/** Most recent battle a stream took part in that ended in the last two minutes — the result card. */
export async function recentResultForStream(streamId: mongoose.Types.ObjectId | string) {
  const id = new mongoose.Types.ObjectId(String(streamId));
  return Battle.findOne({
    status: "ended",
    endsAt: { $gte: new Date(Date.now() - 120_000) },
    $or: [{ hostStreamId: id }, { challengerStreamId: id }],
  }).sort({ endsAt: -1 });
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

/** Create an invite from a live host to a live challenger. */
export async function inviteToBattle(host: { _id: mongoose.Types.ObjectId; username: string; displayName?: string }, hostStream: IStream, challengerStream: IStream) {
  const battle = await Battle.create({
    hostId: host._id,
    challengerId: challengerStream.streamerId,
    hostStreamId: hostStream._id,
    challengerStreamId: challengerStream._id,
    status: "invited",
    invitedAt: new Date(),
  });
  await notify(challengerStream.streamerId as mongoose.Types.ObjectId, "battle_invite", host, hostStream);
  // The challenger's room hears it too, so the studio shows the invite at once.
  const view = await toBattleView(battle);
  await sendRoomData(challengerStream.livekitRoomName, { __evt: "battle_invite", battle: view }).catch(() => {});
  return battle;
}

/** Accept: the clock starts now. */
export async function startBattle(battle: IBattle) {
  const now = new Date();
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
 * push the new score to both rooms.
 */
export async function applyBattleGift(stream: IStream, gift: IGiftTransaction, sender: { _id: mongoose.Types.ObjectId; createdAt?: Date }) {
  const battle = await currentBattleForStream(stream._id);
  if (!battle || !battle.endsAt) return null;
  const side: "host" | "challenger" = battle.hostStreamId.equals(stream._id) ? "host" : "challenger";

  // Self-backing and brand-new accounts don't move the score.
  const receiver = side === "host" ? battle.hostId : battle.challengerId;
  const tooYoung = sender.createdAt ? Date.now() - sender.createdAt.getTime() < MIN_ACCOUNT_AGE_MS : false;
  const counts = !receiver.equals(sender._id) && !tooYoung;

  const now = Date.now();
  const inWindow = battle.endsAt.getTime() - now <= battle.multiplierWindowSec * 1000;
  const score = counts ? gift.grossUsdMinor * (inWindow ? battle.multiplier : 1) : 0;

  await GiftTransaction.updateOne(
    { _id: gift._id },
    { $set: { battleId: battle._id, battleSide: side, battleScoreUsdMinor: score } },
  );
  const inc: Record<string, number> = { commissionUsdMinor: gift.commissionUsdMinor };
  if (score > 0) inc[side === "host" ? "hostUsdMinor" : "challengerUsdMinor"] = score;
  const updated = await Battle.findByIdAndUpdate(battle._id, { $inc: inc }, { new: true });
  if (updated) await fanOutBattle(updated);
  return updated;
}

/** The clock ran out: overtime once on a tie, otherwise settle and pay. */
export async function settleBattle(battle: IBattle, reason: NonNullable<IBattle["endedReason"]> = "clock") {
  if (reason === "clock" && battle.hostUsdMinor === battle.challengerUsdMinor && !battle.overtimeUsed) {
    battle.status = "overtime";
    battle.overtimeUsed = true;
    battle.endsAt = new Date(Date.now() + OVERTIME_SEC * 1000);
    await battle.save();
    await fanOutBattle(battle);
    return battle;
  }

  battle.status = reason === "clock" ? "ended" : "cancelled";
  battle.endedReason = reason;
  if (!battle.endsAt || battle.endsAt.getTime() > Date.now()) battle.endsAt = new Date();

  if (battle.status === "ended") {
    const hostWins = battle.hostUsdMinor > battle.challengerUsdMinor;
    const tie = battle.hostUsdMinor === battle.challengerUsdMinor;
    battle.winnerId = tie ? null : hostWins ? battle.hostId : battle.challengerId;
    battle.bonusUsdMinor = tie ? 0 : Math.floor(battle.commissionUsdMinor * BONUS_SHARE);
    // The bonus is booked to the winner's earnings here; the central wallet
    // credit is a follow-up once the wallet service exposes a credit call
    // (today it only charges with a split).
    if (battle.winnerId && battle.bonusUsdMinor > 0) {
      await User.updateOne({ _id: battle.winnerId }, { $inc: { earningsUsdMinor: battle.bonusUsdMinor } });
    }
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
    await payBattleBonus(battle).catch((e) => console.error("battle bonus payout failed:", e));
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
      await Promise.all([
        notify(battle.hostId, "battle_result", actor, hostStream as Pick<IStream, "_id" | "title">),
        notify(battle.challengerId, "battle_result", actor, hostStream as Pick<IStream, "_id" | "title">),
      ]);
    }
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
  });
  const fake = { _id: placeholder, title: `Battle: ${host.displayName || host.username} vs ${challenger.displayName || challenger.username}` } as Pick<IStream, "_id" | "title">;
  await notify(challenger._id, "battle_invite", host, fake);
  return battle;
}

/** Booked battles, soonest first. */
export async function upcomingBattles(limit = 12) {
  return Battle.find({ status: "scheduled", scheduledAt: { $gte: new Date(Date.now() - SCHEDULE_GRACE_MS) } })
    .sort({ scheduledAt: 1 })
    .limit(limit);
}

/**
 * Once a second: end battles past their clock, expire unanswered invites,
 * start booked battles whose time has come, and cancel battles whose
 * streams have gone offline.
 */
export function startBattleSweep() {
  const tick = async () => {
    const now = new Date();

    // Booked battles: both live → start; too long overdue → lapse.
    const booked = await Battle.find({ status: "scheduled", scheduledAt: { $lte: now } });
    for (const b of booked) {
      try {
        const [hs, cs] = await Promise.all([
          Stream.findOne({ streamerId: b.hostId, isLive: true }).select("_id"),
          Stream.findOne({ streamerId: b.challengerId, isLive: true }).select("_id"),
        ]);
        if (hs && cs) {
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
        // Both streams still live? Otherwise the battle doesn't count.
        const live = await Stream.countDocuments({ _id: { $in: [b.hostStreamId, b.challengerStreamId] }, isLive: true });
        await settleBattle(b, live === 2 ? "clock" : "disconnect");
      } catch (error) {
        console.error("battle settle failed:", error);
      }
    }
    await Battle.updateMany(
      { status: "invited", invitedAt: { $lte: new Date(now.getTime() - INVITE_TTL_MS) } },
      { $set: { status: "cancelled", endedReason: "expired" } },
    );
  };
  setInterval(() => void tick().catch((e) => console.error("battle sweep failed:", e)), 1000);
}
