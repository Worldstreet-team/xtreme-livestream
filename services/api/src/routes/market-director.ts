import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { suggestionsFor } from "../market-alerts.js";
import { knownMarkets } from "../market-list.js";
import { Stream } from "../models.js";
import { requireChannelRole } from "../safety/roles.js";

/**
 * The market as director and market questions (Phase 4): what a studio
 * reloading mid-show needs back — the market moments it was told about —
 * and the markets a question can be asked about, for the host's search.
 */
export const marketDirectorRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/market/known",
    {
      schema: {
        tags: ["Market"],
        summary: "Every US-dollar market Coinbase trades — what a market question can be asked about",
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (_request, reply) => {
      const symbols = [...(await knownMarkets())].sort();
      reply.header("Cache-Control", "public, max-age=3600");
      return { success: true, data: { symbols } };
    },
  );

  app.get(
    "/streams/:id/suggestions",
    {
      schema: {
        tags: ["Market"],
        summary: "The market moments this stream's host was last told about (newest first), for the host and their producers",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("streamerId").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      await requireChannelRole(stream, dbUser._id, "producer");
      return { success: true, data: { suggestions: suggestionsFor(stream._id) } };
    },
  );
};
