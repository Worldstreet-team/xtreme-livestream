import { isBroadcasterConnected } from "./livekit.js";
import { config } from "./config.js";
import { Stream, User, type IStream } from "./models.js";
import { relayLiveEvent, socialsRelayEnabled } from "./socials-relay.js";
import { closeAllWatchSessions } from "./watch-sessions.js";

export const STREAM_GRACE_MS = 90_000;

/**
 * Local dev with seeded streams: nothing is actually publishing into LiveKit,
 * so the liveness check would end every seeded stream on the first request.
 * Never honored in production, where a stale "live" row is the bug this
 * reconciler exists to fix.
 */
function skipLivenessCheck() {
  return (
    config.DEV_ASSUME_STREAMS_LIVE && config.NODE_ENV !== "production"
  );
}

/** Matches the inline images clients upload (see `imageSourceSchema`). */
const DATA_URI_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

export function parseImageDataUri(value: string) {
  const match = DATA_URI_RE.exec(value);
  const [, contentType, base64] = match ?? [];
  if (!contentType || !base64) return null;

  return { contentType, body: Buffer.from(base64, "base64") };
}

/**
 * Path clients should load a stream's thumbnail from, or `null` when there
 * isn't one. Versioned so it can be cached indefinitely: a replaced thumbnail
 * bumps `thumbnailVersion`, which changes the URL.
 *
 * Relative on purpose — the API has no reliable knowledge of its own public
 * origin, so the web client prefixes it with NEXT_PUBLIC_API_URL.
 */
export function thumbnailUrlFor(stream: {
  _id: unknown;
  thumbnail?: string;
  thumbnailVersion?: number;
}) {
  // A lean doc with `thumbnail` projected out still has `thumbnailVersion`,
  // which is enough to know one exists — so callers don't have to fetch the
  // blob just to build the link.
  const hasThumbnail =
    stream.thumbnail !== undefined
      ? Boolean(stream.thumbnail)
      : (stream.thumbnailVersion ?? 0) > 0;

  if (!hasThumbnail) return null;

  return `/api/streams/${String(stream._id)}/thumbnail?v=${stream.thumbnailVersion ?? 0}`;
}

export function formatDuration(startedAt?: Date | null) {
  const seconds = startedAt
    ? Math.max(
        0,
        Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
      )
    : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

/**
 * Bank the viewer-seconds accrued since the last sample, then reopen the
 * window at `now`. Call this *before* overwriting `stream.viewers` — the
 * elapsed window belongs to the count that was in effect during it.
 */
export function accrueViewerSeconds(stream: IStream, now = Date.now()) {
  const windowStart = stream.viewerSampledAt ?? stream.startedAt;
  const elapsed = Math.max(0, now - new Date(windowStart).getTime()) / 1000;

  stream.viewerSeconds += stream.viewers * elapsed;
  stream.viewerSampledAt = new Date(now);
}

/** Shape needed to derive an average — satisfied by both hydrated and lean docs. */
interface ViewerAverageInput {
  viewerSeconds?: number;
  viewers?: number;
  isLive?: boolean;
  viewerSampledAt?: Date | string | null;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
}

/**
 * Wall-clock seconds the stream has run: to `endedAt`, or to now while live.
 *
 * Read-side counterpart to the fields the webhook maintains. Anything
 * averaging over a stream's lifetime must use this as the denominator —
 * measuring a live stream against zero elapsed time is what made a
 * first-time streamer's dashboard read "0 avg viewers" mid-broadcast.
 */
export function streamSeconds(stream: ViewerAverageInput) {
  if (!stream.startedAt) return 0;

  const end = stream.endedAt ? new Date(stream.endedAt).getTime() : Date.now();
  return Math.max(0, (end - new Date(stream.startedAt).getTime()) / 1000);
}

/**
 * Viewer-seconds *including* the accrual window still open on a live stream.
 *
 * `viewerSeconds` is only banked when a LiveKit webhook fires, so for a live
 * stream everything since the last participant event is missing from the
 * stored value. This adds it back without writing to the document — reads
 * shouldn't have side effects, and the next webhook banks it properly.
 */
export function accruedViewerSeconds(stream: ViewerAverageInput) {
  const banked = stream.viewerSeconds ?? 0;
  if (!stream.isLive || !stream.startedAt) return banked;

  const windowStart = stream.viewerSampledAt ?? stream.startedAt;
  const open = Math.max(0, Date.now() - new Date(windowStart).getTime()) / 1000;

  return banked + (stream.viewers ?? 0) * open;
}

/**
 * Mean concurrent viewers over the stream's lifetime. Returns 0 for streams
 * that predate viewer-second tracking (no accrued seconds recorded).
 */
export function averageViewers(stream: ViewerAverageInput) {
  const viewerSeconds = accruedViewerSeconds(stream);
  if (!viewerSeconds) return 0;

  const seconds = streamSeconds(stream);
  if (seconds <= 0) return 0;

  return Math.round(viewerSeconds / seconds);
}

export async function markStreamEnded(stream: IStream) {
  if (!stream.isLive) return;

  const endedAt = new Date();
  // Bank the final window before the stream stops accruing.
  accrueViewerSeconds(stream, endedAt.getTime());
  stream.isLive = false;
  stream.status = "ended";
  stream.velocity = 0;
  stream.endedAt = endedAt;
  stream.duration = formatDuration(stream.startedAt);
  // Flagged in the same save that ends the stream, so even a crash right
  // after leaves the sweep enough to re-relay "ended" to the socials feed.
  if (socialsRelayEnabled() && stream.postToWorldSpace) {
    stream.socialsRelayPending = true;
  }
  await stream.save();
  await User.updateOne({ _id: stream.streamerId }, { isLive: false });
  // The ingress is the account's, not the stream's — it lives on, so the
  // key in the encoder keeps working for the next broadcast.
  // A stream that was never posted to WorldSpace has no post to close out.
  if (stream.postToWorldSpace) void relayLiveEvent("ended", stream);
  void closeAllWatchSessions(stream._id).catch((error) =>
    console.error("watch session close-all failed:", error),
  );
}

/**
 * An OBS/RTMP stream whose encoder is not in the room right now: keep it
 * live for the reconnect grace window, ending it only once the encoder has
 * been gone longer than that. The first sighting of the drop stamps
 * `feedDroppedAt` (the webhook usually gets there first, but a missed event
 * must not turn into an instant end). Browser-fed streams have no encoder
 * to wait for, so they are never held. Returns whether the stream is still
 * live afterwards.
 */
export async function holdForReconnect(stream: IStream): Promise<boolean> {
  if (stream.source !== "obs") return false;
  const droppedAt = stream.feedDroppedAt
    ? new Date(stream.feedDroppedAt).getTime()
    : null;
  if (droppedAt === null) {
    stream.feedDroppedAt = new Date();
    await stream.save();
    return true;
  }
  return Date.now() - droppedAt < config.OBS_RECONNECT_GRACE_MS;
}

export async function reconcileStream(stream: IStream) {
  if (!stream.isLive) return false;
  if (skipLivenessCheck()) return true;

  const age = Date.now() - new Date(stream.startedAt).getTime();
  if (age < STREAM_GRACE_MS) return true;

  const live = await isBroadcasterConnected(
    stream.livekitRoomName,
    stream.streamerId.toString(),
  );

  if (!live) {
    if (await holdForReconnect(stream)) return true;
    await markStreamEnded(stream);
    return false;
  }

  return true;
}

interface LeanStreamRow {
  _id: unknown;
  isLive?: boolean;
  startedAt?: Date | string;
  livekitRoomName?: string;
  streamerId?: unknown;
}

export async function reconcileLeanStreams(streams: LeanStreamRow[]) {
  const staleIds = new Set<string>();
  if (skipLivenessCheck()) return staleIds;

  await Promise.all(
    streams.map(async (stream) => {
      if (!stream.isLive || !stream.livekitRoomName) return;

      const age = Date.now() - new Date(stream.startedAt ?? 0).getTime();
      if (age < STREAM_GRACE_MS) return;

      const streamer = stream.streamerId;
      const broadcasterId =
        streamer && typeof streamer === "object" && "_id" in streamer
          ? String((streamer as { _id: unknown })._id)
          : String(streamer);

      const live = await isBroadcasterConnected(
        stream.livekitRoomName,
        broadcasterId,
      );

      if (!live) staleIds.add(String(stream._id));
    }),
  );

  if (staleIds.size > 0) {
    const staleStreams = await Stream.find({
      _id: { $in: [...staleIds] },
      isLive: true,
    });
    await Promise.all(
      staleStreams.map(async (stream) => {
        // An encoder inside its reconnect window is not stale.
        if (await holdForReconnect(stream)) {
          staleIds.delete(String(stream._id));
          return;
        }
        await markStreamEnded(stream);
      }),
    );
  }

  return staleIds;
}
