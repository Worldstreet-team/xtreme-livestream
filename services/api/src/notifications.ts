import type mongoose from "mongoose";
import {
  Follow,
  Notification,
  StreamReminder,
  type IStream,
} from "./models.js";

/**
 * Fan a "went live" notification out to every follower.
 *
 * Fire-and-forget from the go-live path — a stream must never fail to start
 * because notifications didn't write. Rows are denormalized (actor name,
 * stream title) so the bell renders without populates, and a TTL index on
 * the collection reaps them after 30 days.
 */
export async function notifyFollowersOfLive(
  stream: IStream,
  streamer: {
    _id: mongoose.Types.ObjectId | string;
    username: string;
    displayName?: string;
  },
) {
  try {
    const followers = await Follow.find({ followingId: streamer._id })
      .select("followerId")
      .lean();
    if (followers.length === 0) return;

    const rows = followers.map((f) => ({
      userId: f.followerId,
      type: "live" as const,
      actorId: streamer._id,
      actorName: streamer.displayName || streamer.username,
      streamId: stream._id,
      streamTitle: stream.title,
      read: false,
    }));

    // Chunked inserts bound memory and one bad row doesn't sink the batch.
    for (let i = 0; i < rows.length; i += 1000) {
      await Notification.insertMany(rows.slice(i, i + 1000), {
        ordered: false,
      });
    }
  } catch (error) {
    console.error("go-live notification fan-out failed:", error);
  }
}

/**
 * The other half of the upcoming state: everyone who tapped "remind me" on
 * the scheduled card hears that it started. Reminders are consumed — a
 * stream goes live once, and a second ping for the same broadcast would be
 * noise.
 */
export async function notifyRemindersOfLive(
  stream: IStream,
  streamer: {
    _id: mongoose.Types.ObjectId | string;
    username: string;
    displayName?: string;
  },
) {
  try {
    const reminders = await StreamReminder.find({ streamId: stream._id })
      .select("userId")
      .lean();
    if (reminders.length === 0) return;

    await Notification.insertMany(
      reminders.map((r) => ({
        userId: r.userId,
        type: "reminder" as const,
        actorId: streamer._id,
        actorName: streamer.displayName || streamer.username,
        streamId: stream._id,
        streamTitle: stream.title,
        read: false,
      })),
      { ordered: false },
    );
    await StreamReminder.deleteMany({ streamId: stream._id });
  } catch (error) {
    console.error("reminder notification fan-out failed:", error);
  }
}
