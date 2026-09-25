import type mongoose from "mongoose";
import type { ChannelRole } from "@xtreme/contracts";
import { ApiError } from "../errors.js";
import { User, type IStream, type IUser } from "../models.js";

/**
 * Moderator roles (safety kit). A channel is its creator; its moderators
 * live on the creator's `safety.mods`. The host can do everything; a lead
 * moderator can also manage the other moderators and raise Shield; a
 * moderator keeps the chat — deletes, timeouts, bans, pins, held lines.
 *
 * Moderation only ever acts on viewers: nobody moderates the host, and a
 * moderator is removed as a moderator before anything else is done to them.
 */

type Streamer = Pick<IUser, "_id"> & { safety?: Pick<NonNullable<IUser["safety"]>, "mods"> };

/** Who this person is in the channel, if anyone special. */
export function roleIn(streamer: Streamer, userId: unknown): ChannelRole | null {
  const id = String(userId);
  if (String(streamer._id) === id) return "host";
  const mod = streamer.safety?.mods?.find((m) => String(m.userId) === id);
  return mod ? mod.role : null;
}

const POWER: Record<ChannelRole, number> = { mod: 1, lead: 2, host: 3 };

/** Does `role` reach `need`? */
export function atLeast(role: ChannelRole | null, need: ChannelRole) {
  return role !== null && POWER[role] >= POWER[need];
}

/**
 * The stream's creator and the caller's role in their channel — or a 403
 * when the caller's role doesn't reach `need`.
 */
export async function requireChannelRole(
  stream: Pick<IStream, "streamerId">,
  userId: mongoose.Types.ObjectId | string,
  need: ChannelRole = "mod",
) {
  const streamer = await User.findById(stream.streamerId).select("username displayName safety settings");
  if (!streamer) {
    throw new ApiError(404, "Streamer not found", "USER_NOT_FOUND");
  }
  const role = roleIn(streamer, userId);
  if (!atLeast(role, need)) {
    throw new ApiError(
      403,
      need === "host"
        ? "Only the host can do that"
        : need === "lead"
          ? "Only the host and lead moderators can do that"
          : "Only the host and moderators can do that",
      "FORBIDDEN",
    );
  }
  return { streamer, role: role! };
}

/** Moderation acts on viewers — never on the host or the room's moderators. */
export function assertActionable(streamer: Streamer, targetUserId: unknown) {
  const role = roleIn(streamer, targetUserId);
  if (role === "host") {
    throw new ApiError(403, "That's the host", "TARGET_IS_HOST");
  }
  if (role) {
    throw new ApiError(403, "That's one of your moderators — remove them as a moderator first", "TARGET_IS_MOD");
  }
}

/**
 * The room identities that moderate it: the host (and their studio's
 * monitor connection) and every moderator. Held lines go only to them.
 */
export function moderatorIdentities(streamer: Streamer) {
  const host = String(streamer._id);
  return [host, `mon-${host}`, ...(streamer.safety?.mods ?? []).map((m) => String(m.userId))];
}
