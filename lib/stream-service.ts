import { Stream, User, IStream } from "@/lib/models";
import { isBroadcasterConnected } from "@/lib/livekit";

/**
 * Grace period after a stream is created before we'll consider it "stale".
 * When a streamer goes live, the DB record is created a few seconds before
 * their LiveKit room/publisher actually exists. Without this window, a brand
 * new stream would be reconciled away before the broadcaster finishes
 * connecting.
 */
export const STREAM_GRACE_MS = 90_000;

/**
 * Format an elapsed duration (since `startedAt`) as "m:ss" or "h:mm:ss".
 */
export function formatDuration(startedAt?: Date | null): string {
  const secs = startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
    : 0;
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  return hh > 0
    ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${mm}:${String(ss).padStart(2, "0")}`;
}

/**
 * Bank the viewer-seconds accrued since the last sample, then reopen the
 * window at `now`. Call this *before* overwriting `stream.viewers` — the
 * elapsed window belongs to the count that was in effect during it.
 */
export function accrueViewerSeconds(stream: IStream, now = Date.now()): void {
  const windowStart = stream.viewerSampledAt ?? stream.startedAt;
  const elapsed = Math.max(0, now - new Date(windowStart).getTime()) / 1000;

  stream.viewerSeconds += stream.viewers * elapsed;
  stream.viewerSampledAt = new Date(now);
}

/** Shape needed to derive an average — satisfied by hydrated and lean docs alike. */
interface ViewerAverageInput {
  viewerSeconds?: number;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
}

/**
 * Mean concurrent viewers over the stream's lifetime. Returns 0 for streams
 * that predate viewer-second tracking (no accrued seconds recorded).
 */
export function averageViewers(stream: ViewerAverageInput): number {
  if (!stream.viewerSeconds || !stream.startedAt) return 0;

  const end = stream.endedAt ? new Date(stream.endedAt).getTime() : Date.now();
  const seconds = (end - new Date(stream.startedAt).getTime()) / 1000;
  if (seconds <= 0) return 0;

  return Math.round(stream.viewerSeconds / seconds);
}

/**
 * Mark a stream (and its streamer) as no longer live. Idempotent — safe to
 * call from the webhook, the explicit "end" route, and reconciliation.
 */
export async function markStreamEnded(stream: IStream): Promise<void> {
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

/**
 * Reconcile a single stream against LiveKit's actual room state. If the
 * broadcaster is no longer connected (tab closed, crash, network drop), the
 * stream is ended. This is the fallback for anything the webhook misses.
 *
 * Returns `true` if the stream is (still) genuinely live, `false` otherwise.
 */
export async function reconcileStream(stream: IStream): Promise<boolean> {
  if (!stream.isLive) return false;

  // Don't kill a stream that just started — the publisher may still be
  // connecting.
  const age = Date.now() - new Date(stream.startedAt).getTime();
  if (age < STREAM_GRACE_MS) return true;

  const live = await isBroadcasterConnected(
    stream.livekitRoomName,
    stream.streamerId.toString()
  );

  if (!live) {
    await markStreamEnded(stream);
    return false;
  }
  return true;
}

/** Minimal shape of a lean stream row we need for reconciliation. */
interface LeanStreamRow {
  _id: unknown;
  isLive?: boolean;
  startedAt?: Date | string;
  livekitRoomName?: string;
  streamerId?: unknown;
}

/**
 * Bulk-reconcile a page of lean stream rows (as returned by `.lean()` with a
 * populated `streamerId`). Stale streams are ended in the DB and their ids are
 * returned so callers can drop them from the response.
 *
 * Checks run in parallel; brand-new streams (within the grace window) are
 * skipped without a LiveKit round-trip.
 */
export async function reconcileLeanStreams(
  streams: LeanStreamRow[]
): Promise<Set<string>> {
  const staleIds = new Set<string>();

  await Promise.all(
    streams.map(async (s) => {
      if (!s.isLive || !s.livekitRoomName) return;

      const age = Date.now() - new Date(s.startedAt ?? 0).getTime();
      if (age < STREAM_GRACE_MS) return;

      // streamerId may be populated (object with _id) or a raw ObjectId
      const streamer = s.streamerId;
      const broadcasterId =
        streamer && typeof streamer === "object" && "_id" in streamer
          ? String((streamer as { _id: unknown })._id)
          : String(streamer);

      const live = await isBroadcasterConnected(s.livekitRoomName, broadcasterId);

      if (!live) staleIds.add(String(s._id));
    })
  );

  if (staleIds.size > 0) {
    const ids = [...staleIds];
    const stale = await Stream.find({ _id: { $in: ids }, isLive: true });
    // End each individually so duration is computed per-stream.
    await Promise.all(stale.map((doc) => markStreamEnded(doc)));
  }

  return staleIds;
}
