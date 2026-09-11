import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import mongoose from "mongoose";
import {
  impressionsBodySchema,
  onboardingBodySchema,
  scheduleStreamBodySchema,
  streamIdParamsSchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import {
  GiftTransaction,
  Impression,
  Stream,
  StreamReminder,
  User,
  WatchSession,
} from "../models.js";
import { alsoWatchedLive, buildHomePage, toItem } from "../discovery.js";
import { thumbnailUrlFor } from "../stream-service.js";

async function callerId(request: Parameters<typeof getOptionalAuthUserId>[0]) {
  const authUserId = getOptionalAuthUserId(request);
  if (!authUserId) return null;
  const user = await User.findOne({ authUserId }).select("_id").lean();
  return user?._id ?? null;
}

export const discoveryRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/home",
    {
      schema: {
        tags: ["Discovery"],
        summary:
          "The home page as an ordered list of rows, each owned by one rule, plus up to three leads",
      },
    },
    async (request) => {
      const userId = await callerId(request);
      const page = await buildHomePage(userId);
      return { success: true, data: page };
    },
  );

  const SEVEN_DAYS_MS = 7 * 86_400_000;
  const FOURTEEN_DAYS_MS = 14 * 86_400_000;
  const STREAMER_FIELDS = "username displayName avatar isLive verified";

  app.get(
    "/gifts/leaderboard",
    {
      schema: {
        tags: ["Discovery"],
        summary: "Top gifters across the platform over the last seven days",
      },
    },
    async () => {
      // A rolling week, platform-wide: the rail's leaderboard is about the
      // community's biggest supporters right now, not one stream's.
      const top = await GiftTransaction.aggregate<{
        _id: mongoose.Types.ObjectId;
        totalUsdMinor: number;
        count: number;
      }>([
        { $match: { createdAt: { $gte: new Date(Date.now() - SEVEN_DAYS_MS) } } },
        { $group: { _id: "$senderId", totalUsdMinor: { $sum: "$grossUsdMinor" }, count: { $sum: 1 } } },
        { $sort: { totalUsdMinor: -1 } },
        { $limit: 5 },
      ]);
      const users = await User.find({ _id: { $in: top.map((t) => t._id) } })
        .select("username displayName avatar verified")
        .lean();
      const byId = new Map(users.map((u) => [String(u._id), u]));
      return {
        success: true,
        data: {
          days: 7,
          top: top.map((t) => {
            const u = byId.get(String(t._id));
            return {
              userId: String(t._id),
              username: u?.username ?? "someone",
              displayName: u?.displayName ?? u?.username ?? "Someone",
              avatar: u?.avatar ?? "",
              verified: Boolean(u?.verified),
              totalUsdMinor: t.totalUsdMinor,
              count: t.count,
            };
          }),
        },
      };
    },
  );

  app.get(
    "/user/me/continue",
    {
      schema: {
        tags: ["Discovery"],
        summary:
          "Pick up where you left off: channels you watched recently, live again if they are, otherwise the broadcast you were in",
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      // Most recent session per stream, last fortnight.
      const sessions = await WatchSession.aggregate<{
        _id: mongoose.Types.ObjectId;
        streamerId: mongoose.Types.ObjectId;
        lastAt: Date;
      }>([
        { $match: { userId: dbUser._id, joinedAt: { $gte: new Date(Date.now() - FOURTEEN_DAYS_MS) } } },
        { $group: { _id: "$streamId", streamerId: { $first: "$streamerId" }, lastAt: { $max: "$joinedAt" } } },
        { $sort: { lastAt: -1 } },
        { $limit: 12 },
      ]);
      if (sessions.length === 0) return { success: true, data: { items: [] } };

      const streamerIds = [...new Set(sessions.map((s) => String(s.streamerId)))].map(
        (id) => new mongoose.Types.ObjectId(id),
      );
      const [watched, liveNow] = await Promise.all([
        Stream.find({ _id: { $in: sessions.map((s) => s._id) } })
          .select("-thumbnail")
          .populate("streamerId", STREAMER_FIELDS)
          .lean(),
        Stream.find({ streamerId: { $in: streamerIds }, isLive: true })
          .select("-thumbnail")
          .populate("streamerId", STREAMER_FIELDS)
          .lean(),
      ]);
      const watchedById = new Map(watched.map((s) => [String(s._id), s]));
      const liveByStreamer = new Map(
        liveNow.map((s) => [String((s.streamerId as { _id: unknown })._id), s]),
      );

      // One entry per streamer: their live room if they're on, else the
      // broadcast you were in. Skip a stream you're already caught up on
      // only when it's the same live room you just left.
      const seen = new Set<string>();
      const items: { item: ReturnType<typeof toItem>; watchedAt: Date; live: boolean }[] = [];
      for (const s of sessions) {
        const key = String(s.streamerId);
        if (seen.has(key)) continue;
        const live = liveByStreamer.get(key);
        const source = live ?? watchedById.get(String(s._id));
        if (!source) continue;
        seen.add(key);
        items.push({ item: toItem(source as unknown as Parameters<typeof toItem>[0]), watchedAt: s.lastAt, live: Boolean(live) });
        if (items.length >= 4) break;
      }
      return { success: true, data: { items } };
    },
  );

  app.get(
    "/streams/:id/also-watched",
    {
      schema: {
        tags: ["Discovery"],
        summary:
          "Live streams from channels the audience of this stream's host also watches",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id)
        .select("streamerId")
        .lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");

      const streams = await alsoWatchedLive(
        stream.streamerId as mongoose.Types.ObjectId,
      );
      return { success: true, data: { streams } };
    },
  );

  app.post(
    "/impressions",
    {
      schema: {
        tags: ["Discovery"],
        summary: "Record what a viewer was shown, where, and in which slot",
        body: impressionsBodySchema,
      },
      // A page load legitimately reports a whole grid at once.
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request) => {
      const userId = await callerId(request);
      const { viewerKey, items } = request.body;

      const validIds = items.filter((i) =>
        mongoose.Types.ObjectId.isValid(i.streamId),
      );
      if (validIds.length > 0) {
        await Impression.insertMany(
          validIds.map((i) => ({
            userId,
            viewerKey,
            streamId: new mongoose.Types.ObjectId(i.streamId),
            surface: i.surface,
            row: i.row ?? "",
            slot: i.slot,
            explore: i.explore ?? false,
          })),
          { ordered: false },
        );
      }
      return { success: true, data: { recorded: validIds.length } };
    },
  );

  app.post(
    "/streams/schedule",
    {
      schema: {
        tags: ["Streams"],
        summary: "Schedule a stream so it can be discovered before it airs",
        security: [{ bearerAuth: [] }],
        body: scheduleStreamBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const scheduledStartAt = new Date(request.body.scheduledStartAt);

      const stream = await Stream.create({
        streamerId: dbUser._id,
        title: request.body.title,
        category: request.body.category,
        tags: request.body.tags,
        thumbnail: request.body.thumbnail,
        thumbnailVersion: request.body.thumbnail ? Date.now() : 0,
        status: "upcoming",
        isLive: false,
        scheduledStartAt,
        // Sorting and duration code read startedAt; until it goes live, the
        // planned time is the only honest value.
        startedAt: scheduledStartAt,
        // The real room is minted when the stream starts. This placeholder
        // satisfies the unique index without reserving a LiveKit room.
        livekitRoomName: `upcoming-${dbUser._id}-${Date.now()}`,
        notifyFollowers: request.body.notifyFollowers,
      });

      return {
        success: true,
        message: "Stream scheduled",
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            category: stream.category,
            scheduledStartAt: stream.scheduledStartAt,
            thumbnailUrl: thumbnailUrlFor(stream),
          },
        },
      };
    },
  );

  app.delete(
    "/streams/:id/schedule",
    {
      schema: {
        tags: ["Streams"],
        summary: "Cancel a scheduled stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findOne({
        _id: request.params.id,
        status: "upcoming",
      });
      if (!stream) {
        throw new ApiError(404, "Scheduled stream not found", "STREAM_NOT_FOUND");
      }
      if (!stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(403, "Not your stream", "FORBIDDEN");
      }

      await Promise.all([
        stream.deleteOne(),
        StreamReminder.deleteMany({ streamId: stream._id }),
      ]);
      return { success: true, message: "Schedule cancelled" };
    },
  );

  app.post(
    "/streams/:id/remind",
    {
      schema: {
        tags: ["Streams"],
        summary: "Ask to be notified when a scheduled stream goes live",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findOne({
        _id: request.params.id,
        status: "upcoming",
      })
        .select("_id")
        .lean();
      if (!stream) {
        throw new ApiError(404, "Scheduled stream not found", "STREAM_NOT_FOUND");
      }

      await StreamReminder.updateOne(
        { userId: dbUser._id, streamId: stream._id },
        { $setOnInsert: { userId: dbUser._id, streamId: stream._id } },
        { upsert: true },
      );
      return { success: true, message: "We'll let you know when it starts" };
    },
  );

  app.delete(
    "/streams/:id/remind",
    {
      schema: {
        tags: ["Streams"],
        summary: "Remove a reminder",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await StreamReminder.deleteOne({
        userId: dbUser._id,
        streamId: request.params.id,
      });
      return { success: true, message: "Reminder removed" };
    },
  );

  app.post(
    "/user/me/onboarding",
    {
      schema: {
        tags: ["Users"],
        summary: "Save the cold-start picker choices",
        security: [{ bearerAuth: [] }],
        body: onboardingBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await User.updateOne(
        { _id: dbUser._id },
        {
          $set: {
            "onboarding.completedAt": new Date(),
            "onboarding.categories": request.body.categories,
            ...(request.body.language
              ? { "onboarding.language": request.body.language }
              : {}),
          },
        },
      );
      return { success: true, message: "Saved" };
    },
  );
};
