import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { healthBodySchema, MAX_HEALTH_WINDOWS, streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { ingressReading } from "../livekit.js";
import { Stream } from "../models.js";

type EncoderReading = NonNullable<Awaited<ReturnType<typeof ingressReading>>>;
/** A few seconds per stream: the studio polls, LiveKit's API needn't hear every poll. */
const ENCODER_CACHE_MS = 4_000;
const encoderCache = new Map<string, { at: number; reading: EncoderReading | null }>();

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
    "/streams/:id/encoder",
    {
      schema: {
        tags: ["Streams"],
        summary: "What the host's encoder (OBS and the like) is sending right now, as LiveKit's ingress sees it",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findOne({ _id: request.params.id, streamerId: dbUser._id, isLive: true }).select("_id");
      if (!stream) throw new ApiError(404, "No live broadcast of yours by that id", "NOT_YOUR_LIVE_STREAM");

      const key = String(stream._id);
      const hit = encoderCache.get(key);
      if (hit && Date.now() - hit.at < ENCODER_CACHE_MS) return { success: true, data: { reading: hit.reading } };

      // The account's encoder keys — RTMP, WHIP, or both. The one sending
      // wins; else the one connecting; else whatever LiveKit says.
      const keys = [
        ["rtmp", dbUser.obsIngress?.ingressId],
        ["whip", dbUser.whipIngress?.ingressId],
      ] as const;
      const readings = await Promise.all(
        keys.filter(([, id]) => Boolean(id)).map(([protocol, id]) => ingressReading(id!, protocol).catch(() => null)),
      );
      const reading =
        readings.find((r) => r?.status === "publishing") ?? readings.find((r) => r?.status === "buffering") ?? readings.find(Boolean) ?? null;
      if (encoderCache.size > 500) encoderCache.clear();
      encoderCache.set(key, { at: Date.now(), reading });
      return { success: true, data: { reading } };
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
