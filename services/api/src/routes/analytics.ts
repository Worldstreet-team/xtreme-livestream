import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { streamIdParamsSchema, type StreamAnalytics } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { streamAnalytics } from "../analytics.js";
import { Stream } from "../models.js";
import { requireChannelRole } from "../safety/roles.js";

/**
 * Live analytics (Phase 3): a broadcast minute by minute, for its host and
 * their producers — polled by the studio while live, read as the recap
 * afterwards. A live stream's is kept a few seconds, so a studio and a
 * console or two polling together read chat once.
 */

const LIVE_CACHE_MS = 15_000;
/** Live ones for a few seconds; ended ones for good, since nothing about them changes. Oldest out first past the cap. */
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; live: boolean; data: StreamAnalytics }>();

export const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams/:id/analytics",
    {
      schema: {
        tags: ["Analytics"],
        summary: "A broadcast minute by minute — viewers, chat and gifts — with its moments, falls and totals",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id)
        .select("+viewersByMinute +moments streamerId startedAt endedAt isLive peakViewers viewerSeconds")
        .lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      await requireChannelRole(stream, dbUser._id, "producer");

      const key = String(stream._id);
      const hit = cache.get(key);
      const now = Date.now();
      if (hit && (!hit.live || now - hit.at < LIVE_CACHE_MS) && hit.live === Boolean(stream.isLive)) {
        return { success: true, data: { analytics: hit.data } };
      }

      const analytics = await streamAnalytics(stream, now);
      if (!analytics) throw new ApiError(409, "This stream never went on air", "NEVER_LIVE");
      cache.delete(key);
      cache.set(key, { at: now, live: Boolean(stream.isLive), data: analytics });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      return { success: true, data: { analytics } };
    },
  );
};
