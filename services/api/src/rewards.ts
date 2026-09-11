import mongoose from "mongoose";
import { AuditLog, Payout, User, type IBattle, type IPayout, type PayoutKind } from "./models.js";
import { awardPoints, InsufficientPointsError } from "./points.js";
import { creditWallet, isTreasuryConfigured } from "./wallet.js";

/**
 * Rewards that become money: points redeemed to the wallet, and battle
 * bonuses. Every payout is a row first and a wallet call second, so nothing
 * can be paid twice and nothing can be lost between the two. When the
 * treasury isn't configured the rows wait, and the sweep pays them the
 * moment it is.
 */

/** 1,000 points = $1. */
export const POINTS_PER_USD = 1000;
export const MIN_REDEEM_POINTS = 5000;
/** Per user, per rolling day. */
export const DAILY_REDEEM_CAP_POINTS = 20_000;
export const MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;

export class RedeemError extends Error {
  constructor(
    public code: "TOO_FEW" | "NOT_MULTIPLE" | "DAILY_CAP" | "ACCOUNT_TOO_NEW" | "INSUFFICIENT",
    message: string,
  ) {
    super(message);
    this.name = "RedeemError";
  }
}

export async function audit(actorId: mongoose.Types.ObjectId | null, action: string, targetType: string, targetId: mongoose.Types.ObjectId | null, meta: Record<string, unknown> = {}) {
  try {
    await AuditLog.create({ actorId, action, targetType, targetId, meta });
  } catch (error) {
    console.error("audit write failed:", error);
  }
}

/** Try the wallet for one payout row; records the outcome either way. */
export async function attemptPayout(payout: IPayout) {
  const user = await User.findById(payout.userId).select("authUserId username").lean();
  if (!user?.authUserId) {
    payout.status = "failed";
    payout.lastError = "user has no auth id";
    await payout.save();
    return payout;
  }
  payout.attempts += 1;
  const result = await creditWallet({
    recipientClerkUserId: user.authUserId,
    amountUsdMinor: payout.usdMinor,
    description: payout.kind === "points_redemption" ? `Xtreme points redemption (${payout.points} pts)` : "Xtreme battle bonus",
    idempotencyKey: `livestream:payout:${String(payout._id)}`,
    metadata: { payoutId: String(payout._id), kind: payout.kind, username: user.username },
  });
  if (result.ok) {
    payout.status = "paid";
    payout.walletChargeId = result.data.charge?.id ?? "";
    payout.paidAt = new Date();
    payout.lastError = "";
  } else {
    // Not configured or unreachable: stays pending for the sweep. Anything
    // else the wallet refuses outright is a hard failure to look at.
    payout.status = result.code === "NOT_CONFIGURED" || result.code === "UNREACHABLE" ? "pending" : "failed";
    payout.lastError = `${result.code}: ${result.message}`;
  }
  await payout.save();
  return payout;
}

async function createPayout(userId: mongoose.Types.ObjectId, kind: PayoutKind, usdMinor: number, points: number, refId: mongoose.Types.ObjectId | null) {
  const payout = await Payout.create({ userId, kind, usdMinor, points, refId, status: "pending" });
  return attemptPayout(payout);
}

/**
 * Turn points into wallet money. Rules: whole thousands, at least the
 * minimum, within the daily cap, account at least a week old. The points
 * leave the balance first (atomically), then the payout row is created and
 * the wallet tried.
 */
export async function redeemPoints(user: { _id: mongoose.Types.ObjectId; createdAt?: Date }, points: number) {
  if (points < MIN_REDEEM_POINTS) throw new RedeemError("TOO_FEW", `Redeem at least ${MIN_REDEEM_POINTS} points`);
  if (points % POINTS_PER_USD !== 0) throw new RedeemError("NOT_MULTIPLE", `Redeem in multiples of ${POINTS_PER_USD} points`);
  if (user.createdAt && Date.now() - user.createdAt.getTime() < MIN_ACCOUNT_AGE_MS) {
    throw new RedeemError("ACCOUNT_TOO_NEW", "Accounts can redeem after their first week");
  }
  const since = new Date(Date.now() - 86_400_000);
  const today = await Payout.aggregate<{ _id: null; points: number }>([
    { $match: { userId: user._id, kind: "points_redemption", status: { $ne: "failed" }, createdAt: { $gte: since } } },
    { $group: { _id: null, points: { $sum: "$points" } } },
  ]);
  if ((today[0]?.points ?? 0) + points > DAILY_REDEEM_CAP_POINTS) {
    throw new RedeemError("DAILY_CAP", `Up to ${DAILY_REDEEM_CAP_POINTS} points a day`);
  }

  try {
    await awardPoints(user._id, -points, "redeem");
  } catch (error) {
    if (error instanceof InsufficientPointsError) throw new RedeemError("INSUFFICIENT", "Not enough points");
    throw error;
  }
  const usdMinor = Math.floor((points / POINTS_PER_USD) * 100);
  const payout = await createPayout(user._id, "points_redemption", usdMinor, points, null);
  await audit(user._id, "points.redeem", "payout", payout._id as mongoose.Types.ObjectId, { points, usdMinor, status: payout.status });
  return payout;
}

/** The winner's bonus, as a payout row plus the wallet attempt. */
export async function payBattleBonus(battle: IBattle) {
  if (!battle.winnerId || battle.bonusUsdMinor <= 0) return null;
  const existing = await Payout.findOne({ kind: "battle_bonus", refId: battle._id });
  if (existing) return existing;
  const payout = await createPayout(battle.winnerId, "battle_bonus", battle.bonusUsdMinor, 0, battle._id as mongoose.Types.ObjectId);
  await audit(null, "battle.bonus", "battle", battle._id as mongoose.Types.ObjectId, { winnerId: String(battle.winnerId), usdMinor: battle.bonusUsdMinor, status: payout.status });
  return payout;
}

/** Every five minutes: pay whatever is still pending, once the treasury is there. */
export function startPayoutSweep() {
  const tick = async () => {
    if (!isTreasuryConfigured()) return;
    const pending = await Payout.find({ status: "pending", attempts: { $lt: 20 } }).sort({ createdAt: 1 }).limit(50);
    for (const p of pending) {
      await attemptPayout(p).catch((e) => console.error("payout retry failed:", e));
    }
  };
  setInterval(() => void tick().catch((e) => console.error("payout sweep failed:", e)), 5 * 60_000);
}
