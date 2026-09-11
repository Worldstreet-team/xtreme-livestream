import mongoose from "mongoose";
import { PointsLedger, User, WatchSession, type PointsReason } from "./models.js";

/**
 * Points: the reward currency. Earned by watching and by winning games,
 * spent on stakes, never bought. Every movement is one atomic balance
 * update guarded against going negative, plus a ledger row that records
 * the balance it left behind — so a balance can always be rebuilt.
 */

export const WELCOME_POINTS = 200;
/** Paid to every viewer with an open session on a live stream, per drip. */
export const DRIP_POINTS = 5;
export const DRIP_EVERY_MS = 10 * 60_000;
/** First watch of the day, growing with consecutive days (capped). */
export const STREAK_BASE = 20;
export const STREAK_STEP = 5;
export const STREAK_CAP = 60;

export class InsufficientPointsError extends Error {
  constructor() {
    super("Not enough points");
    this.name = "InsufficientPointsError";
  }
}

/**
 * Move points on a balance. A debit that would overdraw fails atomically
 * (no partial write). Returns the balance after the change.
 */
export async function awardPoints(
  userId: mongoose.Types.ObjectId,
  delta: number,
  reason: PointsReason,
  refId: mongoose.Types.ObjectId | null = null,
) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta must be a non-zero integer");
  const filter = delta < 0 ? { _id: userId, pointsBalance: { $gte: -delta } } : { _id: userId };
  const updated = await User.findOneAndUpdate(filter, { $inc: { pointsBalance: delta } }, { new: true })
    .select("pointsBalance")
    .lean();
  if (!updated) {
    if (delta < 0) throw new InsufficientPointsError();
    throw new Error("User not found");
  }
  await PointsLedger.create({ userId, delta, balanceAfter: updated.pointsBalance, reason, refId });
  return updated.pointsBalance;
}

/** The first time a balance is read, it gets its welcome grant. */
export async function ensureWelcomeGrant(userId: mongoose.Types.ObjectId) {
  const any = await PointsLedger.exists({ userId });
  if (any) return null;
  return awardPoints(userId, WELCOME_POINTS, "welcome");
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/**
 * Every ten minutes, everyone still in a live room earns a little; the
 * first drip of a day also pays the streak bonus. One drip per person per
 * tick however many rooms they have open.
 */
export function startWatchDrip() {
  const tick = async () => {
    const open = await WatchSession.aggregate<{ _id: mongoose.Types.ObjectId }>([
      { $match: { leftAt: null, joinedAt: { $gte: new Date(Date.now() - 6 * 3_600_000) } } },
      { $group: { _id: "$userId" } },
      { $limit: 5000 },
    ]);
    if (open.length === 0) return;
    const today = dayKey();
    const yesterday = dayKey(new Date(Date.now() - 86_400_000));
    const users = await User.find({ _id: { $in: open.map((o) => o._id) } })
      .select("lastWatchDay watchStreakDays")
      .lean();
    for (const u of users) {
      try {
        await awardPoints(u._id as mongoose.Types.ObjectId, DRIP_POINTS, "watch");
        if (u.lastWatchDay !== today) {
          const streak = u.lastWatchDay === yesterday ? (u.watchStreakDays ?? 0) + 1 : 1;
          const bonus = Math.min(STREAK_CAP, STREAK_BASE + (streak - 1) * STREAK_STEP);
          await User.updateOne({ _id: u._id }, { $set: { lastWatchDay: today, watchStreakDays: streak } });
          await awardPoints(u._id as mongoose.Types.ObjectId, bonus, "streak");
        }
      } catch (error) {
        console.error("watch drip failed for", String(u._id), error);
      }
    }
  };
  setInterval(() => void tick().catch((e) => console.error("watch drip sweep failed:", e)), DRIP_EVERY_MS);
}
