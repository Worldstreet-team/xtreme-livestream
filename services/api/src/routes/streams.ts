import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createStreamBodySchema,
  listStreamsQuerySchema,
  streamIdParamsSchema,
  updateStreamBodySchema,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { createToken } from "../livekit.js";
import { Stream } from "../models.js";
import {
  markStreamEnded,
  reconcileLeanStreams,
} from "../stream-service.js";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const streamRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams",
    {
      schema: {
        tags: ["Streams"],
        summary: "List streams",
        querystring: listStreamsQuerySchema,
      },
    },
    async (request) => {
      const { live, category, search, sort, limit, page } = request.query;
      const skip = (page - 1) * limit;
      const filter: Record<string, unknown> = {};

      if (live !== undefined) filter.isLive = live === "true";
      if (category && category !== "All") filter.category = category;
      if (search) {
        filter.title = { $regex: escapeRegex(search), $options: "i" };
      }

      let sortObject: Record<string, 1 | -1> = { viewers: -1 };
      if (sort === "recent") sortObject = { startedAt: -1 };
      if (sort === "trending") {
        sortObject = { viewers: -1, startedAt: -1 };
      }

      const [streams, total] = await Promise.all([
        Stream.find(filter)
          .sort(sortObject)
          .skip(skip)
          .limit(limit)
          .populate("streamerId", "username displayName avatar isLive")
          .lean(),
        Stream.countDocuments(filter),
      ]);

      const staleIds = await reconcileLeanStreams(streams);
      const visible =
        live === "true" && staleIds.size > 0
          ? streams.filter((stream) => !staleIds.has(String(stream._id)))
          : streams.map((stream) =>
              staleIds.has(String(stream._id))
                ? { ...stream, isLive: false }
                : stream,
            );
      const adjustedTotal =
        live === "true" ? Math.max(0, total - staleIds.size) : total;

      return {
        success: true,
        data: {
          streams: visible,
          pagination: {
            page,
            limit,
            total: adjustedTotal,
            pages: Math.ceil(adjustedTotal / limit),
          },
        },
      };
    },
  );

  app.post(
    "/streams",
    {
      schema: {
        tags: ["Streams"],
        summary: "Start a stream and receive a publisher token",
        security: [{ bearerAuth: [] }],
        body: createStreamBodySchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);

      const existing = await Stream.findOne({
        streamerId: dbUser._id,
        isLive: true,
      });
      if (existing) await markStreamEnded(existing);

      const roomName = `stream-${dbUser._id}-${Date.now()}`;
      const livekitToken = await createToken(
        roomName,
        dbUser._id.toString(),
        dbUser.displayName,
        {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          roomCreate: true,
        },
      );

      const stream = await Stream.create({
        streamerId: dbUser._id,
        ...request.body,
        livekitRoomName: roomName,
        isLive: true,
        startedAt: new Date(),
      });

      dbUser.isLive = true;
      await dbUser.save();

      return {
        success: true,
        message: "Stream started",
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            category: stream.category,
            livekitRoomName: roomName,
            startedAt: stream.startedAt,
          },
          livekitToken,
          livekitUrl: config.LIVEKIT_URL,
        },
      };
    },
  );

  app.get(
    "/streams/:id",
    {
      schema: {
        tags: ["Streams"],
        summary: "Get stream details",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id)
        .populate(
          "streamerId",
          "username displayName avatar bio followers isLive",
        )
        .lean();

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      return { success: true, data: { stream } };
    },
  );

  app.patch(
    "/streams/:id",
    {
      schema: {
        tags: ["Streams"],
        summary: "Update a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: updateStreamBodySchema,
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

      Object.assign(stream, request.body);
      await stream.save();

      return {
        success: true,
        message: "Stream updated",
        data: { stream },
      };
    },
  );
};
