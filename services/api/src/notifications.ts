import type mongoose from "mongoose";
import { Follow, Notification, type IStream } from "./models.js";

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
