import mongoose from "mongoose";
import { WatchSession, type IStream } from "./models.js";

// The LiveKit webhook hands us every join and leave with the participant's
// identity. For a signed-in viewer that identity is their user id; guests
// carry a `guest-<uuid>` identity and stage encoders `obs-<id>`, neither of
// which is a person we can learn anything durable about.

const OBJECT_ID = /^[a-f\d]{24}$/i;

function viewerId(stream: IStream, identity: string) {
  if (!OBJECT_ID.test(identity)) return null;
  const bid = stream.streamerId.toString();
  if (identity === bid) return null;
  return new mongoose.Types.ObjectId(identity);
}

export async function openWatchSession(stream: IStream, identity: string) {
  const userId = viewerId(stream, identity);
  if (!userId) return;

  const now = new Date();
  // A reconnect can arrive before the previous leave did; one open session
  // per viewer per stream keeps the durations honest.
  await WatchSession.updateMany(
    { userId, streamId: stream._id, leftAt: null },
    { $set: { leftAt: now } },
  );
  await WatchSession.create({
    userId,
    streamId: stream._id,
    streamerId: stream.streamerId,
    category: stream.category,
    joinedAt: now,
  });
}

export async function closeWatchSession(stream: IStream, identity: string) {
  const userId = viewerId(stream, identity);
  if (!userId) return;

  await WatchSession.updateMany(
    { userId, streamId: stream._id, leftAt: null },
    { $set: { leftAt: new Date() } },
  );
}

/** When the broadcast ends nobody is watching, whatever the room said last. */
export async function closeAllWatchSessions(streamId: mongoose.Types.ObjectId) {
  await WatchSession.updateMany(
    { streamId, leftAt: null },
    { $set: { leftAt: new Date() } },
  );
}
