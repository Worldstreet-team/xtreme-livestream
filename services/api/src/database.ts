import mongoose from "mongoose";
import { config } from "./config.js";
import { Report, Stream } from "./models.js";

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
    // Mongoose 9 requires opting in before it will forward an aggregation
    // pipeline as the update; without it the array is rejected outright and
    // the API cannot boot.
    { updatePipeline: true },
  );

  return result.modifiedCount;
}

/**
 * Reports used to be unique per (stream, reporter); chat lines can be
 * reported now too, so the key gains the message. The old index would
 * refuse someone's second report on a stream, so it goes. Idempotent.
 */
async function migrateReportIndex() {
  try {
    await Report.collection.dropIndex("streamId_1_reporterId_1");
    console.info("[database] dropped the old stream-only report index");
  } catch {
    // Already gone, or the collection doesn't exist yet.
  }
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
  await migrateReportIndex();

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
