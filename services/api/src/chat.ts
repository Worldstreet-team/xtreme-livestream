import type { IChatMessage } from "./models.js";

/** Seconds between messages while slow mode (or Shield) is on. */
export const CHAT_SLOW_MODE_SECONDS = 30;

/**
 * A chat row as the room receives it. One shape for a fresh message, an
 * approved held one, and anything else the API fans in — clients dedupe
 * on `id`.
 */
export function chatPayload(
  message: Pick<
    IChatMessage,
    "_id" | "userId" | "username" | "avatar" | "isMod" | "content" | "type" | "tipAmount" | "tipCurrency" | "emoji" | "platform"
  >,
) {
  return {
    id: String(message._id),
    // Moderation acts on users, not usernames — clients keep this so the
    // host's ban/timeout buttons know whom to target.
    userId: String(message.userId),
    username: message.username,
    avatar: message.avatar,
    isMod: message.isMod,
    content: message.content,
    type: message.type,
    tipAmount: message.tipAmount ?? undefined,
    tipCurrency: message.tipCurrency ?? undefined,
    emoji: message.emoji ?? undefined,
    platform: message.platform,
  };
}
