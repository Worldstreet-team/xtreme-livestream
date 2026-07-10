import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  chatQuerySchema,
  createChatMessageBodySchema,
  streamIdParamsSchema,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { createToken } from "../livekit.js";
import { ChatMessage, Stream } from "../models.js";
import { markStreamEnded, reconcileStream } from "../stream-service.js";

export const streamActionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams/:id/token",
    {
      schema: {
        tags: ["Streams"],
        summary: "Create a LiveKit viewer token",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!(await reconcileStream(stream))) {
        throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      }

      const token = await createToken(
        stream.livekitRoomName,
        dbUser._id.toString(),
        dbUser.displayName,
        {
          canPublish: false,
          canSubscribe: true,
          canPublishData: true,
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
