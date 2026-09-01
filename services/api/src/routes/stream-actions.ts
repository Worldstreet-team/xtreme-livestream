import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  chatQuerySchema,
  createChatMessageBodySchema,
  createReportBodySchema,
  streamIdParamsSchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { createToken, sendRoomData } from "../livekit.js";
import { assertNotBanned } from "./moderation.js";
import {
  ChatMessage,
  Follow,
  Report,
  Stream,
  StreamLike,
  User,
} from "../models.js";
import {
  markStreamEnded,
  parseImageDataUri,
  reconcileStream,
} from "../stream-service.js";

/**
 * Cooldown between messages when the streamer has slow mode on.
 * Mirrored client-side as SLOW_MODE_SECONDS in components/app/live-chat.tsx —
 * keep the two in step so the countdown matches what the server enforces.
 */
const CHAT_SLOW_MODE_SECONDS = 30;

export const streamActionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams/:id/token",
    {
      schema: {
        tags: ["Streams"],
        summary:
          "Create a LiveKit viewer token (anonymous viewers get a read-only guest token)",
        params: streamIdParamsSchema,
        querystring: z.object({
          /** Which surface the viewer is on — badged on the join row. */
          platform: z
            .enum(["xstream", "socials", "worldspace"])
            .default("xstream"),
          /**
           * Owner-as-viewer: join under a distinct mon-<id> identity with no
           * publish rights. Without this, a host opening their own stream
           * page reuses the broadcaster identity and LiveKit kicks the
           * actual broadcast (their phone app or studio tab) off the air.
           */
          monitor: z.enum(["1"]).optional(),
        }),
      },
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      // Signed-in viewers join under their identity; anonymous visitors get a
      // guest identity that can watch but cannot broadcast data messages.
      const viewer = getOptionalAuthUserId(request)
        ? await authenticate(request)
        : null;
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!(await reconcileStream(stream))) {
        throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      }

      // The stream's owner gets a publisher token: this is how a broadcaster
      // whose page reloaded reclaims their own live stream instead of being
      // locked out of it while it stays live.
      const isOwner =
        viewer !== null && stream.streamerId.equals(viewer.dbUser._id);
      const monitoring = isOwner && request.query.monitor === "1";
      const token = await createToken(
        stream.livekitRoomName,
        monitoring
          ? `mon-${viewer!.dbUser._id.toString()}`
          : viewer
            ? viewer.dbUser._id.toString()
            : `guest-${crypto.randomUUID()}`,
        viewer ? viewer.dbUser.displayName : "Guest",
        {
          canPublish: isOwner && !monitoring,
          canSubscribe: true,
          canPublishData: viewer !== null,
        },
      );

      // "X joined" — the handshake viewers actually see. Announced for
      // named viewers only: a guest row would just say "someone", and the
      // broadcaster reclaiming their own room is not an arrival.
      if (viewer && !isOwner) {
        void sendRoomData(stream.livekitRoomName, {
          __evt: "join",
          username: viewer.dbUser.username,
          platform: request.query.platform,
        });
      }

      return {
        success: true,
        data: {
          token,
          livekitUrl: config.LIVEKIT_URL,
          roomName: stream.livekitRoomName,
        },
      };
    },
  );

  app.post(
    "/streams/:id/end",
    {
      schema: {
        tags: ["Streams"],
        summary: "End a live stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(403, "Not authorized", "FORBIDDEN");
      }
      if (!stream.isLive) {
        throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      }

      await markStreamEnded(stream);

      return {
        success: true,
        message: "Stream ended",
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            duration: stream.duration,
            viewers: stream.viewers,
            peakViewers: stream.peakViewers,
          },
        },
      };
    },
  );

  app.get(
    "/streams/:id/thumbnail",
    {
      schema: {
        tags: ["Streams"],
        summary: "Stream thumbnail as an image (long-lived, versioned cache)",
        params: streamIdParamsSchema,
      },
      // Cacheable static-ish bytes; the rate limiter would only punish a
      // first page load, which legitimately fetches a whole grid at once.
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const stream = await Stream.findById(request.params.id)
        .select("thumbnail thumbnailVersion")
        .lean();

      if (!stream?.thumbnail) {
        throw new ApiError(404, "No thumbnail for this stream", "NO_THUMBNAIL");
      }

      // `imageSourceSchema` also permits a plain http(s) URL — hand those
      // straight back rather than proxying someone else's bytes.
      if (!stream.thumbnail.startsWith("data:")) {
        return reply.redirect(stream.thumbnail, 302);
      }

      const image = parseImageDataUri(stream.thumbnail);
      if (!image) {
        throw new ApiError(
          415,
          "Stored thumbnail is not a readable image",
          "THUMBNAIL_UNREADABLE",
        );
      }

      // Version-based rather than content-hashed so the list endpoint can
      // build the URL without loading the blob, and so we skip hashing on
      // every request.
      const etag = `"thumb-${stream.thumbnailVersion ?? 0}"`;
      if (request.headers["if-none-match"] === etag) {
        return reply.code(304).send();
      }

      return reply
        .header("Content-Type", image.contentType)
        .header("ETag", etag)
        // The URL carries ?v=<thumbnailVersion>, so a replaced thumbnail is a
        // different URL — this response can be kept indefinitely.
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .send(image.body);
    },
  );

  app.get(
    "/streams/:id/like",
    {
      schema: {
        tags: ["Streams"],
        summary: "Get like count and whether the caller liked the stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("likes");

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const liked = Boolean(
        await StreamLike.exists({ streamId: stream._id, userId: dbUser._id }),
      );

      return { success: true, data: { likes: stream.likes, liked } };
    },
  );

  app.post(
    "/streams/:id/like",
    {
      schema: {
        tags: ["Streams"],
        summary: "Like a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("likes");

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const result = await StreamLike.updateOne(
        { streamId: stream._id, userId: dbUser._id },
        { $setOnInsert: { streamId: stream._id, userId: dbUser._id } },
        { upsert: true },
      );

      let likes = stream.likes;
      if (result.upsertedCount > 0) {
        const updated = await Stream.findByIdAndUpdate(
          stream._id,
          { $inc: { likes: 1 } },
          { new: true, select: "likes livekitRoomName" },
        );
        likes = updated?.likes ?? likes + 1;
        // Everyone watching sees the count move — likes were REST-only and
        // never reached the room, on either platform.
        void sendRoomData(updated?.livekitRoomName ?? "", {
          __evt: "like",
          likes,
          username: dbUser.username,
        });
      }

      return { success: true, data: { likes, liked: true } };
    },
  );

  app.delete(
    "/streams/:id/like",
    {
      schema: {
        tags: ["Streams"],
        summary: "Remove a like from a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("likes");

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const deleted = await StreamLike.findOneAndDelete({
        streamId: stream._id,
        userId: dbUser._id,
      });

      let likes = stream.likes;
      if (deleted) {
        const updated = await Stream.findOneAndUpdate(
          { _id: stream._id, likes: { $gt: 0 } },
          { $inc: { likes: -1 } },
          { new: true, select: "likes livekitRoomName" },
        );
        likes = updated?.likes ?? Math.max(0, likes - 1);
        void sendRoomData(updated?.livekitRoomName ?? "", {
          __evt: "like",
          likes,
        });
      }

      return { success: true, data: { likes, liked: false } };
    },
  );

  app.post(
    "/streams/:id/report",
    {
      schema: {
        tags: ["Streams"],
        summary: "Report a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: createReportBodySchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select(
        "streamerId",
      );

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(
          400,
          "You cannot report your own stream",
          "SELF_REPORT",
        );
      }

      await Report.updateOne(
        { streamId: stream._id, reporterId: dbUser._id },
        {
          $set: {
            reason: request.body.reason,
            details: request.body.details ?? "",
            status: "open",
          },
          $setOnInsert: {
            streamId: stream._id,
            streamerId: stream.streamerId,
            reporterId: dbUser._id,
          },
        },
        { upsert: true },
      );

      return {
        success: true,
        message: "Report submitted. Our moderation team will review it.",
      };
    },
  );

  app.get(
    "/streams/:id/chat",
    {
      schema: {
        tags: ["Chat"],
        summary: "Get persisted chat history",
        params: streamIdParamsSchema,
        querystring: chatQuerySchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id).select("_id");
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const filter: Record<string, unknown> = { streamId: stream._id };
      if (request.query.before) {
        filter._id = { $lt: request.query.before };
      }

      const messages = await ChatMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(request.query.limit)
        .lean();

      messages.reverse();
      return { success: true, data: { messages } };
    },
  );

  app.post(
    "/streams/:id/chat",
    {
      schema: {
        tags: ["Chat"],
        summary: "Persist a chat message",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: createChatMessageBodySchema,
      },
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!(await reconcileStream(stream))) {
        throw new ApiError(
          400,
          "Stream is not live - chat is disabled",
          "STREAM_OFFLINE",
        );
      }

      const body = request.body;
      if (body.type === "tip") {
        // Tip announcements are only written by the gifts route after a
        // successful wallet charge — never directly by clients.
        throw new ApiError(
          400,
          "Tips are sent via the gifts endpoint",
          "TIP_VIA_GIFTS",
        );
      }

      // The streamer's moderation settings were being collected in Settings
      // and saved to the profile, but nothing ever read them — slow mode was
      // enforced only by client-side state (trivially bypassed by posting
      // directly) and subscriber-only chat did nothing at all. The host is
      // exempt from their own restrictions.
      const isHost = stream.streamerId.equals(dbUser._id);
      if (!isHost) {
        // Ban check first: a banned user's message must not slip through on
        // a stream with no other restrictions enabled.
        await assertNotBanned(stream._id, dbUser._id);

        const streamer = await User.findById(stream.streamerId).select(
          "settings",
        );

        if (streamer?.settings.subscriberOnly) {
          const follows = await Follow.exists({
            followerId: dbUser._id,
            followingId: stream.streamerId,
          });
          if (!follows) {
            throw new ApiError(
              403,
              "This chat is for allies only — ally with the streamer to join in",
              "FOLLOWERS_ONLY",
            );
          }
        }

        if (streamer?.settings.slowMode) {
          const since = new Date(Date.now() - CHAT_SLOW_MODE_SECONDS * 1000);
          const recent = await ChatMessage.exists({
            streamId: stream._id,
            userId: dbUser._id,
            createdAt: { $gt: since },
          });
          if (recent) {
            throw new ApiError(
              429,
              `Slow mode is on — wait ${CHAT_SLOW_MODE_SECONDS}s between messages`,
              "SLOW_MODE",
            );
          }
        }
      }

      const message = await ChatMessage.create({
        streamId: stream._id,
        userId: dbUser._id,
        username: dbUser.username,
        avatar: dbUser.avatar,
        isMod: isHost,
        content: body.content,
        type: body.type,
        tipAmount: body.tipAmount ?? null,
        tipCurrency: body.tipCurrency ?? null,
        emoji: body.emoji ?? null,
        platform: body.platform,
      });

      // The API fans the message into the live room. Delivery used to
      // depend on the sender's own client republishing over WebRTC, which
      // was silence for anyone whose token lacked canPublishData — the
      // usual state of cross-platform viewers. Clients dedupe on `id`.
      void sendRoomData(stream.livekitRoomName, {
        id: String(message._id),
        // Moderation acts on users, not usernames — clients keep this so the
        // host's ban/timeout buttons know whom to target.
        userId: String(dbUser._id),
        username: dbUser.username,
        avatar: dbUser.avatar,
        isMod: isHost,
        content: body.content,
        type: body.type,
        tipAmount: body.tipAmount,
        tipCurrency: body.tipCurrency,
        emoji: body.emoji,
        platform: body.platform,
      });

      return { success: true, data: { message } };
    },
  );
};
