import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { goalBodySchema, streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { cachedStreamFans, fanStatus } from "../fans.js";
import { endGoal, setGoal } from "../goals.js";
import { Stream, User } from "../models.js";

/**
 * Goals and status (Phase 2): the host puts a goal up and takes it down;
 * gifts, likes and follows move it (goals.ts, from their routes). And the
 * status that isn't pay-only — a stream's top fans and your level with the
 * channel (fans.ts).
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

  app.get(
    "/streams/:id/fans",
    {
      schema: {
        tags: ["Streams"],
        summary: "This stream's top fans — watch time and chat count, not only gifts — and where you stand",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id).select("_id streamerId");
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      const fans = await cachedStreamFans(stream);
      // Signed in: your own level with the channel, for the chat's header.
      let me = null;
      const authUserId = getOptionalAuthUserId(request);
      if (authUserId) {
        const caller = await User.findOne({ authUserId }).select("_id").lean();
        if (caller) me = await fanStatus(stream.streamerId, caller._id).catch(() => null);
      }
      return { success: true, data: { fans, me } };
    },
  );
};
