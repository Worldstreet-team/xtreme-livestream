import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  callBodySchema,
  callHideBodySchema,
  callIdParamsSchema,
  callsQuerySchema,
  streamIdParamsSchema,
  usernameParamsSchema,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { assertCallsOn, callLayerOf, callView, callsEnabled, channelSummary, listCalls, makeCall, setCallHidden } from "../calls.js";
import { ApiError } from "../errors.js";
import { knownMarkets } from "../market-list.js";
import { Call, Stream, User } from "../models.js";
import { requireChannelRole } from "../safety/roles.js";
import { isPlatformAdmin } from "./admin.js";

/**
 * Call receipts (calls.ts): making a call on air, a channel's public
 * record, one call on its own, and — for platform admins — hiding one.
 * There's no edit and no delete: a call is a receipt. With the switch off,
 * making one is refused (CALLS_OFF) and the reads answer `enabled: false`.
 */

async function requireAdmin(request: FastifyRequest) {
  const { dbUser } = await authenticate(request);
  if (!isPlatformAdmin(dbUser)) throw new ApiError(403, "Admins only", "FORBIDDEN");
  return dbUser;
}

export const callRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/calls/enabled",
    { schema: { tags: ["Calls"], summary: "Whether call receipts are switched on — the web hides every surface of them when they aren't" } },
    async (_request, reply) => {
      reply.header("Cache-Control", "public, max-age=60");
      return { success: true, data: { enabled: callsEnabled() } };
    },
  );

  app.get(
    "/calls/markets",
    { schema: { tags: ["Calls"], summary: "The markets a call can be made on: every USD market Coinbase trades" } },
    async (_request, reply) => {
      if (!callsEnabled()) return { success: true, data: { enabled: false, markets: [] as string[] } };
      const markets = [...(await knownMarkets())].filter((m) => m.endsWith("-USD")).sort();
      reply.header("Cache-Control", "public, max-age=600");
      return { success: true, data: { enabled: true, markets } };
    },
  );

  app.post(
    "/streams/:id/calls",
    {
      schema: {
        tags: ["Calls"],
        summary: "Make a call on air: the API records the market, the direction, the price and the time itself",
        params: streamIdParamsSchema,
        body: callBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      assertCallsOn();
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("streamerId isLive practice").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      // The host, or a producer running the show: it's the channel's call either way.
      const { streamer } = await requireChannelRole(stream, dbUser._id, "producer");
      const { symbol, direction, note } = request.body;
      const call = await makeCall({ stream, streamer, by: dbUser._id, symbol, direction, note });
      reply.code(201);
      return { success: true, data: { call: callView(call), layer: callLayerOf(call) } };
    },
  );

  app.get(
    "/users/:username/calls",
    {
      schema: {
        tags: ["Calls"],
        summary: "A channel's calls, newest first, with how each went — and, on the first page, its record",
        params: usernameParamsSchema,
        querystring: callsQuerySchema,
      },
    },
    async (request) => {
      if (!callsEnabled()) return { success: true, data: { enabled: false as const } };
      const user = await User.findOne({ username: request.params.username }).select("_id").lean();
      if (!user) throw new ApiError(404, "User not found", "USER_NOT_FOUND");
      const { calls, next } = await listCalls(user._id, request.query);
      const summary = request.query.cursor ? null : await channelSummary(user._id);
      return { success: true, data: { enabled: true as const, calls: calls.map(callView), next, summary } };
    },
  );

  app.get(
    "/calls/:id",
    { schema: { tags: ["Calls"], summary: "One call and how it went", params: callIdParamsSchema } },
    async (request) => {
      if (!callsEnabled()) return { success: true, data: { enabled: false as const } };
      const call = await Call.findById(request.params.id).lean();
      if (!call) throw new ApiError(404, "There's no such call", "CALL_NOT_FOUND");
      // Said, not pretended away: the record shows a call was hidden.
      if (call.hidden) throw new ApiError(410, "Xtream's moderators hid this call", "CALL_HIDDEN");
      return { success: true, data: { enabled: true as const, call: callView(call) } };
    },
  );

  app.post(
    "/admin/calls/:id/hide",
    {
      schema: {
        tags: ["Admin"],
        summary: "Hide a call from its channel's record and the screen, saying why (audited)",
        params: callIdParamsSchema,
        body: callHideBodySchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const call = await setCallHidden(request.params.id, admin._id, true, request.body.reason);
      return { success: true, data: { call: callView(call), hidden: { at: call.hidden!.at.toISOString(), reason: call.hidden!.reason } } };
    },
  );

  app.post(
    "/admin/calls/:id/unhide",
    {
      schema: {
        tags: ["Admin"],
        summary: "Put a hidden call back on its channel's record, saying why (audited)",
        params: callIdParamsSchema,
        body: callHideBodySchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const call = await setCallHidden(request.params.id, admin._id, false, request.body.reason);
      return { success: true, data: { call: callView(call), hidden: null } };
    },
  );
};
