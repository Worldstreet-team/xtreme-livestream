import type mongoose from "mongoose";
import type { FeaturedItem } from "@xtreme/contracts";
import { sendRoomData, setRoomScene } from "./livekit.js";
import { Stream, type IChatMessage, type IStream, type IUser } from "./models.js";

/**
 * Comments on screen (Phase 2): a chat line or a gift the host puts over the
 * program, drawn by every viewer's SceneRenderer.
 *
 * `scene.featured` is written only here, each time with one conditional,
 * atomic update that touches nothing else in the scene — so a gift landing
 * mid-charge and the host changing layout at the same moment can't overwrite
 * one another, and a guard ("only if it's still the one on screen") is
 * checked by the same write that acts on it. Every write moves the scene's
 * version on and reaches the room both ways: metadata for whoever joins
 * later, a data event for everyone already in.
 */

/** How long a gift the tier put up stays, when the host keeps comments up until they say. */
const AUTO_GIFT_SECONDS = 20;

type FeaturableMessage = Pick<
  IChatMessage,
  "_id" | "userId" | "username" | "avatar" | "content" | "type" | "tipAmount" | "tipCurrency" | "emoji"
>;

/** A drop is the room sweep paying out, not something anyone said. */
export function isDropMessage(message: Pick<IChatMessage, "type" | "tipCurrency">) {
  return message.type === "tip" && message.tipCurrency === "PTS";
}

/** The chat row as it goes on screen: its own words and amounts, never the client's. */
export function featuredFrom(
  message: FeaturableMessage,
  seconds: number | null,
  auto = false,
  now = Date.now(),
): FeaturedItem {
  const gift = message.type === "tip";
  return {
    id: String(message._id),
    kind: gift ? "gift" : "chat",
    userId: String(message.userId),
    username: message.username,
    avatar: message.avatar ?? "",
    text: message.content,
    emoji: message.emoji ?? null,
    amount: gift ? (message.tipAmount ?? null) : null,
    currency: gift ? (message.tipCurrency ?? null) : null,
    at: new Date(now).toISOString(),
    until: seconds ? new Date(now + seconds * 1000).toISOString() : null,
    auto,
  };
}

/** The scene as clients read it, from what's stored. */
export function sceneView(scene: Partial<IStream["scene"]> | undefined | null) {
  return {
    layout: scene?.layout ?? "auto",
    card: scene?.card ?? null,
    cardNote: scene?.cardNote ?? "",
    layers: scene?.layers ?? [],
    featured: scene?.featured ?? null,
    version: scene?.version ?? 0,
  };
}

/**
 * Put an item on screen (null takes it down) on a live stream, provided
 * `match` still holds when the write lands. Resolves to the new scene, or
 * null when nothing matched — the stream isn't live, or the guard failed.
 */
export async function writeFeatured(
  streamId: mongoose.Types.ObjectId | string,
  featured: FeaturedItem | null,
  match: Record<string, unknown> = {},
) {
  const updated = await Stream.findOneAndUpdate(
    { _id: streamId, isLive: true, ...match },
    { $set: { "scene.featured": featured }, $inc: { "scene.version": 1 } },
    { new: true, select: "scene livekitRoomName" },
  ).lean();
  if (!updated) return null;
  const scene = sceneView(updated.scene);
  await setRoomScene(updated.livekitRoomName, scene);
  void sendRoomData(updated.livekitRoomName, { __evt: "scene", scene });
  return scene;
}

/** Take down whatever's on screen if it came from this chat row. */
export function unfeatureMessage(streamId: mongoose.Types.ObjectId | string, messageId: string) {
  return writeFeatured(streamId, null, { "scene.featured.id": messageId });
}

/** Take down whatever's on screen if this person wrote or sent it (they've just been banned). */
export function unfeatureUser(streamId: mongoose.Types.ObjectId | string, userId: string) {
  return writeFeatured(streamId, null, { "scene.featured.userId": userId });
}

/**
 * A gift at or above the host's tier goes on screen by itself — unless the
 * host has put something up by hand that's still showing: their pick wins.
 * Another gift the tier put up gives way to the newer one.
 */
export async function autoFeatureGift(
  streamId: mongoose.Types.ObjectId | string,
  streamer: Pick<IUser, "settings">,
  message: FeaturableMessage,
  grossUsdMinor: number,
  now = Date.now(),
) {
  const from = streamer.settings?.featureGiftsFromMinor ?? 0;
  if (!from || grossUsdMinor < from) return null;
  const seconds = streamer.settings?.featureSeconds || AUTO_GIFT_SECONDS;
  return writeFeatured(streamId, featuredFrom(message, seconds, true, now), {
    $or: [
      { "scene.featured": null },
      { "scene.featured.auto": true },
      { "scene.featured.until": { $lt: new Date(now).toISOString() } },
    ],
  });
}
