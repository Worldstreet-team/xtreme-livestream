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

export async function markStreamEnded(stream: IStream) {
  if (!stream.isLive) return;

  stream.isLive = false;
  stream.endedAt = new Date();
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
