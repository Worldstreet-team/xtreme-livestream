import crypto from "node:crypto";
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
import { createToken } from "../livekit.js";
import { ChatMessage, Report, Stream, StreamLike } from "../models.js";
import { markStreamEnded, reconcileStream } from "../stream-service.js";

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

      const token = await createToken(
        stream.livekitRoomName,
        viewer ? viewer.dbUser._id.toString() : `guest-${crypto.randomUUID()}`,
        viewer ? viewer.dbUser.displayName : "Guest",
        {
          canPublish: false,
          canSubscribe: true,
          canPublishData: viewer !== null,
        },
      );

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
          { new: true, select: "likes" },
        );
        likes = updated?.likes ?? likes + 1;
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
          { new: true, select: "likes" },
        );
        likes = updated?.likes ?? Math.max(0, likes - 1);
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

      const message = await ChatMessage.create({
        streamId: stream._id,
        userId: dbUser._id,
        username: dbUser.username,
        avatar: dbUser.avatar,
        isMod: stream.streamerId.equals(dbUser._id),
        content: body.content,
        type: body.type,
        tipAmount: body.tipAmount ?? null,
        tipCurrency: body.tipCurrency ?? null,
        emoji: body.emoji ?? null,
      });

      return { success: true, data: { message } };
    },
  );
};
