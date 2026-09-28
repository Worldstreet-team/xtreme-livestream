import crypto from "node:crypto";
import { ApiError } from "./errors.js";
import { roomService } from "./livekit.js";
import { Stream, User, type IStream } from "./models.js";
import { atLeast, roleIn } from "./safety/roles.js";

/**
 * Practice previews: a secret link to a practice run (practice.ts), so the
 * host can show a rehearsal to someone before the night — watch-only.
 *
 * - The key is 192 random bits, handed to the host once. The stream keeps
 *   only its SHA-256 (`previewKeyHash`, select: false), so no list, page or
 *   log ever carries a working link.
 * - Holding the key gets a subscribe-only room token under a hidden
 *   `pv-<generation>-<uuid>` identity: no publishing, no data, no place in
 *   the participant list, no join line, no watch session (the identity is
 *   no user's), whoever is signed in.
 * - Everything a viewer can do to a room — chat, gifts, likes, games,
 *   requests, the stage — is refused on a practice stream for anyone but
 *   the host and their producers (assertMayInteract).
 * - The link dies when the run ends (markStreamEnded) or the host stops
 *   sharing; a new link replaces the old one. Either way everyone watching
 *   on the old one is taken out of the room, and the webhook turns away a
 *   `pv-` identity from a generation that's no longer current.
 */

/** A preview viewer's room identity starts with this. */
export const PREVIEW_IDENTITY_PREFIX = "pv-";
/**
 * A preview token admits a join for this long. The watch page asks for a
 * fresh one on every (re)join, which a dead link can't get.
 */
export const PREVIEW_TOKEN_TTL = "15m";
/** What a key looks like: base64url, as newPreviewKey makes them (32 characters). */
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,128}$/;

/** A URL as it's logged: any preview key in it replaced, so no log line carries a working link. */
export function redactPreviewKey(url: string) {
  return url.replace(/([?&]previewKey=)[^&#]*/gi, "$1[REDACTED]");
}

/** A fresh key: 24 random bytes (192 bits), base64url. */
export function newPreviewKey() {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashPreviewKey(key: string) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

/** Where the link goes on the web app (the page reads `?preview=`). */
export function previewPath(streamId: unknown, key: string) {
  return `/stream/${String(streamId)}?preview=${encodeURIComponent(key)}`;
}

/** Which link a viewer came in on: a new link is a new generation. */
function generationOf(sharedAt: Date | string) {
  return new Date(sharedAt).getTime().toString(36);
}

export function previewIdentity(generation: string) {
  return `${PREVIEW_IDENTITY_PREFIX}${generation}-${crypto.randomUUID()}`;
}

export function isPreviewIdentity(identity: string) {
  return identity.startsWith(PREVIEW_IDENTITY_PREFIX);
}

type PreviewRow = { practice?: boolean; isLive?: boolean; previewKeyHash?: string | null; previewSharedAt?: Date | null };

async function loadPreview(streamId: unknown) {
  return (await Stream.findById(streamId)
    .select("+previewKeyHash +previewSharedAt practice isLive livekitRoomName streamerId")
    .lean()) as (PreviewRow & { livekitRoomName: string }) | null;
}

/**
 * Does this key open this stream's preview right now? The link's
 * generation when it does; null for anything else — a wrong key, no key, a
 * stream that isn't a live practice run, a link stopped or replaced. The
 * comparison is constant-time.
 */
export async function previewAccess(streamId: unknown, key: unknown): Promise<{ generation: string } | null> {
  if (typeof key !== "string" || !KEY_SHAPE.test(key)) return null;
  const row = await loadPreview(streamId);
  if (!row || row.practice !== true || !row.isLive || !row.previewKeyHash || !row.previewSharedAt) return null;
  const given = Buffer.from(hashPreviewKey(key), "hex");
  const stored = Buffer.from(row.previewKeyHash, "hex");
  if (given.length !== stored.length || !crypto.timingSafeEqual(given, stored)) return null;
  return { generation: generationOf(row.previewSharedAt) };
}

/** The preview viewers in the room right now (null when LiveKit can't say). */
async function previewParticipants(roomName: string) {
  try {
    const list = await roomService.listParticipants(roomName);
    return list.filter((p) => isPreviewIdentity(p.identity));
  } catch {
    return null;
  }
}

/** How many are watching the preview: a number for the host's studio, never who. */
export async function previewWatching(roomName: string) {
  return (await previewParticipants(roomName))?.length ?? null;
}

/**
 * Take preview viewers out of the room — all of them, or everyone but the
 * current link's. Best-effort: a viewer LiveKit can't reach is gone anyway
 * or turned away on their next join.
 */
export async function removePreviewViewers(roomName: string, keepGeneration?: string) {
  const viewers = await previewParticipants(roomName);
  if (!viewers?.length) return 0;
  const keep = keepGeneration ? `${PREVIEW_IDENTITY_PREFIX}${keepGeneration}-` : null;
  const gone = viewers.filter((p) => !keep || !p.identity.startsWith(keep));
  await Promise.all(gone.map((p) => roomService.removeParticipant(roomName, p.identity).catch(() => {})));
  return gone.length;
}

/**
 * A new link for a live practice run — replacing any link out there. The
 * plaintext key is returned here and nowhere else, ever.
 */
export async function sharePreview(stream: Pick<IStream, "_id" | "livekitRoomName">) {
  const key = newPreviewKey();
  const sharedAt = new Date();
  const updated = await Stream.findOneAndUpdate(
    { _id: stream._id, practice: true, isLive: true },
    { $set: { previewKeyHash: hashPreviewKey(key), previewSharedAt: sharedAt } },
    { new: true, select: "_id" },
  );
  if (!updated) {
    throw new ApiError(409, "Only a practice run that's on can be shared", "NOT_PRACTICE");
  }
  // Whoever watched on the old link is out: a new link is a new audience.
  void removePreviewViewers(stream.livekitRoomName, generationOf(sharedAt)).catch(() => {});
  return { key, path: previewPath(stream._id, key), sharedAt };
}

/** The link stops working, and whoever's watching on it is taken out. */
export async function stopPreview(stream: Pick<IStream, "_id" | "livekitRoomName">) {
  await Stream.updateOne({ _id: stream._id }, { $set: { previewKeyHash: null, previewSharedAt: null } });
  await removePreviewViewers(stream.livekitRoomName).catch(() => 0);
}

/** Is a link out for this stream, and since when? For the host. */
export async function previewStatus(streamId: unknown) {
  const row = await loadPreview(streamId);
  const shared = Boolean(row?.practice && row.isLive && row.previewKeyHash && row.previewSharedAt);
  return {
    shared,
    sharedAt: shared ? new Date(row!.previewSharedAt!).toISOString() : null,
    watching: shared ? await previewWatching(row!.livekitRoomName) : 0,
  };
}

/**
 * A `pv-` identity just joined: out it goes unless its link is the current
 * one on a practice run that's still on. Catches a token kept from a link
 * that has since been stopped or replaced.
 */
export async function evictStalePreview(stream: Pick<IStream, "_id" | "livekitRoomName">, identity: string) {
  if (!isPreviewIdentity(identity)) return false;
  const row = await loadPreview(stream._id);
  const current =
    row?.practice === true && row.isLive && row.previewKeyHash && row.previewSharedAt
      ? `${PREVIEW_IDENTITY_PREFIX}${generationOf(row.previewSharedAt)}-`
      : null;
  if (current && identity.startsWith(current)) return false;
  await roomService.removeParticipant(stream.livekitRoomName, identity).catch(() => {});
  return true;
}

/**
 * A practice run is watch-only for everyone but its host and their
 * producers: chat, gifts, likes, games, requests and the stage all stop
 * here. A real stream passes straight through.
 */
export async function assertMayInteract(stream: Pick<IStream, "streamerId"> & { practice?: boolean | null }, userId: unknown) {
  if (stream.practice !== true) return;
  if (String(stream.streamerId) === String(userId)) return;
  const streamer = await User.findById(stream.streamerId).select("safety").lean();
  if (streamer && atLeast(roleIn(streamer, userId), "producer")) return;
  throw new ApiError(403, "This is a practice run — you can watch, but not join in", "PRACTICE_WATCH_ONLY");
}
