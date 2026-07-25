import { isBroadcasterConnected } from "./livekit.js";
import { Stream, User, type IStream } from "./models.js";

export const STREAM_GRACE_MS = 90_000;

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
  stream.endedAt = endedAt;
  stream.duration = formatDuration(stream.startedAt);
  await stream.save();
  await User.updateOne({ _id: stream.streamerId }, { isLive: false });
}

export async function reconcileStream(stream: IStream) {
  if (!stream.isLive) return false;

  const age = Date.now() - new Date(stream.startedAt).getTime();
  if (age < STREAM_GRACE_MS) return true;

  const live = await isBroadcasterConnected(
    stream.livekitRoomName,
    stream.streamerId.toString(),
  );

  if (!live) {
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
    await Promise.all(staleStreams.map(markStreamEnded));
  }

  return staleIds;
}
