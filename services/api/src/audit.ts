import type mongoose from "mongoose";
import { AuditLog } from "./models.js";

/**
 * The audit trail: who did what to what, for payouts, games, and every
 * moderation action (safety kit). Never lets a failed write fail the thing
 * it records.
 */
export async function audit(
  actorId: mongoose.Types.ObjectId | null,
  action: string,
  targetType: string,
  targetId: mongoose.Types.ObjectId | null,
  meta: Record<string, unknown> = {},
) {
  try {
    await AuditLog.create({ actorId, action, targetType, targetId, meta });
  } catch (error) {
    console.error("audit write failed:", error);
  }
}
