import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Stream } from "../models.js";
import { previewStatus, sharePreview, stopPreview } from "../preview.js";
import { reconcileStream } from "../stream-service.js";

/**
 * The host's side of a practice preview (preview.ts): is a link out and how
 * many are watching, make a new one, stop sharing. The host's alone — the
 * same ownership check as ending the stream.
 */
export const previewRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  async function hostStream(request: Parameters<typeof authenticate>[0], id: string) {
    const { dbUser } = await authenticate(request);
    const stream = await Stream.findById(id);
    if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
    if (!stream.streamerId.equals(dbUser._id)) throw new ApiError(403, "Not authorized", "FORBIDDEN");
    return stream;
  }

  app.get(
    "/streams/:id/preview",
    {
      schema: {
        tags: ["Streams"],
        summary: "Whether a practice run's preview link is out, and how many are watching on it (the host)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await hostStream(request, request.params.id);
      return { success: true, data: await previewStatus(stream._id) };
    },
  );

  app.post(
    "/streams/:id/preview",
    {
      schema: {
        tags: ["Streams"],
        summary: "Make a watch-only preview link for a live practice run (replaces any link already out)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const stream = await hostStream(request, request.params.id);
      if (!stream.practice) {
        throw new ApiError(409, "Only a practice run gets a preview link — a live stream has its own", "NOT_PRACTICE");
      }
      if (!(await reconcileStream(stream))) {
        throw new ApiError(409, "Start the practice run first", "NOT_LIVE");
      }
      const { key, path, sharedAt } = await sharePreview(stream);
      // The only time the key leaves the API. It is never logged.
      return { success: true, data: { key, path, sharedAt: sharedAt.toISOString(), watching: 0 } };
    },
  );

  app.delete(
    "/streams/:id/preview",
    {
      schema: {
        tags: ["Streams"],
        summary: "Stop sharing a practice run's preview: the link stops working and its viewers leave",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const stream = await hostStream(request, request.params.id);
      await stopPreview(stream);
      return { success: true, data: { shared: false, sharedAt: null, watching: 0 } };
    },
  );
};
