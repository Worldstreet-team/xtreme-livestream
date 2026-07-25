import mongoose from "mongoose";
import { config } from "./config.js";
import { Stream } from "./models.js";

/**
 * Give pre-existing thumbnails a non-zero `thumbnailVersion`.
 *
 * List endpoints project the thumbnail blob out and decide whether a stream
 * has one from `thumbnailVersion` alone. Streams written before that field
 * existed default to 0, so without this their thumbnails would silently stop
 * appearing on Explore and the dashboard.
 *
 * Idempotent and self-limiting: after the first run nothing matches the
 * filter, so subsequent boots are a single indexed-miss query.
 */
async function backfillThumbnailVersions() {
  const result = await Stream.updateMany(
    { thumbnail: { $nin: ["", null] }, thumbnailVersion: 0 },
    [{ $set: { thumbnailVersion: { $toLong: "$createdAt" } } }],
  );

  return result.modifiedCount;
}

export async function connectDatabase() {
  if (mongoose.connection.readyState === 1) return mongoose;

  const connection = await mongoose.connect(config.MONGODB_URI, {
    dbName: config.MONGODB_DB_NAME,
    bufferCommands: false,
    serverSelectionTimeoutMS: 10_000,
  });

  const backfilled = await backfillThumbnailVersions();
  if (backfilled > 0) {
    console.info(
      `[database] backfilled thumbnailVersion on ${backfilled} stream(s)`,
    );
  }

  return connection;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}
