import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Stream, StreamRating } from "../models.js";
import { buildStreamReport } from "../stream-report.js";

/**
 * The post-live report (stream-report.ts) and its one question — "How
 * likely are you to recommend Xtream to a friend?" — both the host's alone:
 * the report carries their level, quests and earnings, and the answer is
 * theirs to give. One answer per stream; a second tap changes it.
 */

const ratingBodySchema = z.object({ score: z.number().int().min(0).max(10) });

async function hostStream(request: Parameters<typeof authenticate>[0], id: string, select: string) {
  const { dbUser } = await authenticate(request);
  const stream = await Stream.findById(id).select(select).lean();
  if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
  if (String(stream.streamerId) !== String(dbUser._id)) {
    throw new ApiError(403, "Only the stream's host can see this", "FORBIDDEN");
  }
  return { stream, dbUser };
}

export const streamReportRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams/:id/report",
    {
      schema: {
        tags: ["Analytics"],
        summary: "The post-live report for a broadcast — its numbers, best minute, earnings, and the host's progress (the host)",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { stream, dbUser } = await hostStream(
        request,
        request.params.id,
        "+viewersByMinute +moments streamerId title category practice isLive startedAt endedAt peakViewers viewerSeconds thumbnailVersion",
      );
      if (!stream.startedAt) throw new ApiError(409, "This stream never went on air", "NEVER_LIVE");
      const report = await buildStreamReport(stream, dbUser._id);
      return { success: true, data: { report } };
    },
  );

  app.put(
    "/streams/:id/rating",
    {
      schema: {
        tags: ["Analytics"],
        summary: "The host's 0–10 answer to “How likely are you to recommend Xtream to a friend?” for one broadcast",
        params: streamIdParamsSchema,
        body: ratingBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { stream, dbUser } = await hostStream(request, request.params.id, "streamerId startedAt");
      if (!stream.startedAt) throw new ApiError(409, "This stream never went on air", "NEVER_LIVE");
      const { score } = request.body;
      const write = () =>
        StreamRating.findOneAndUpdate(
          { streamId: stream._id },
          { $set: { score, userId: dbUser._id } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean();
      let row;
      try {
        row = await write();
      } catch (error) {
        // Two taps racing to make the row: the second updates the first's.
        if ((error as { code?: number }).code !== 11000) throw error;
        row = await write();
      }
      return { success: true, data: { score: row?.score ?? score } };
    },
  );
};
