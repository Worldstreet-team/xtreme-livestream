import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { goalBodySchema, streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { endGoal, setGoal } from "../goals.js";
import { Stream } from "../models.js";

/**
 * The goal bar (Phase 2, goals and status): the host puts one up and takes
 * it down; gifts, likes and follows move it (goals.ts, from their routes).
 */
export const goalRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** The host's stream, live — or why not. */
  async function hostStream(streamId: string, userId: import("mongoose").Types.ObjectId) {
    const stream = await Stream.findById(streamId).select("streamerId isLive");
    if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
    if (!stream.streamerId.equals(userId)) throw new ApiError(403, "Only the host sets the goal", "NOT_HOST");
    if (!stream.isLive) throw new ApiError(409, "Go live first", "NOT_LIVE");
    return stream;
  }

  app.put(
    "/streams/:id/goal",
    {
      schema: {
        tags: ["Streams"],
        summary: "Put a goal up — gifts, likes or allies — starting from zero",
        params: streamIdParamsSchema,
        body: goalBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await hostStream(request.params.id, dbUser._id);
      const goal = await setGoal(stream._id, request.body);
      if (!goal) throw new ApiError(409, "Go live first", "NOT_LIVE");
      return { success: true, data: { goal } };
    },
  );

  app.delete(
    "/streams/:id/goal",
    {
      schema: {
        tags: ["Streams"],
        summary: "Take the goal down",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await hostStream(request.params.id, dbUser._id);
      // Nothing up is already the state asked for.
      const goal = await endGoal(stream._id);
      return { success: true, data: { goal } };
    },
  );
};
