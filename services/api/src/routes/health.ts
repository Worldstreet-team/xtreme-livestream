import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { healthBodySchema, MAX_HEALTH_WINDOWS, streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Stream } from "../models.js";

/**
 * Stream health (Phase 1): the host's studio sends a 30-second summary of
 * how its broadcast is going; the run of them is the report afterwards
 * (lib/stream-health.ts reads it). The host's own business — nobody else
 * sees a broadcast's health.
 */
export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/streams/:id/health",
    {
      schema: {
        tags: ["Streams"],
        summary: "Record 30 seconds of the broadcast's health (the host's studio)",
        params: streamIdParamsSchema,
        body: healthBodySchema,
        security: [{ bearerAuth: [] }],
      },
      // Two a minute is the rate; a little slack for a reconnect's catch-up.
      config: { rateLimit: { max: 6, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      // One conditional write: the host's own live stream, capped at six hours.
      const result = await Stream.updateOne(
        { _id: request.params.id, streamerId: dbUser._id, isLive: true },
        { $push: { health: { $each: [request.body.window], $slice: -MAX_HEALTH_WINDOWS } } },
      );
      if (result.matchedCount === 0) {
        throw new ApiError(404, "No live broadcast of yours by that id", "NOT_YOUR_LIVE_STREAM");
      }
      return { success: true };
    },
  );

  app.get(
    "/streams/:id/health",
    {
      schema: {
        tags: ["Streams"],
        summary: "A broadcast's health, 30 seconds at a time (the host only)",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("+health streamerId startedAt endedAt").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      if (String(stream.streamerId) !== String(dbUser._id)) throw new ApiError(403, "Only the host sees a broadcast's health", "NOT_HOST");
      return {
        success: true,
        data: { windows: stream.health ?? [], startedAt: stream.startedAt, endedAt: stream.endedAt },
      };
    },
  );
};
