import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { rundownBodySchema, rundownPositionBodySchema, streamIdParamsSchema, type RundownPosition } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Rundown, Stream, type IStream } from "../models.js";
import { sendRoomDataTo } from "../livekit.js";
import { consoleIdentities, moderatorIdentities, requireChannelRole } from "../safety/roles.js";

/**
 * Run of show (Phase 3). The rundown is the creator's — segments, lengths,
 * the prompter's script and each segment's cues — and saves as they edit
 * it, before a show or during one. The live stream keeps only where the
 * show is, so a reload or a second device picks the timers up where they
 * were. None of it is public: the scene changes cues make go through the
 * scene route like any other.
 */

type StoredPosition = NonNullable<IStream["rundown"]>;

export function positionView(p: StoredPosition | null | undefined): RundownPosition {
  return {
    segmentId: p?.segmentId ?? null,
    startedAt: p?.startedAt ? new Date(p.startedAt).toISOString() : null,
    showStartedAt: p?.showStartedAt ? new Date(p.showStartedAt).toISOString() : null,
  };
}

export const rundownRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/users/me/rundown",
    { schema: { tags: ["Run of show"], summary: "Your run of show", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const rundown = await Rundown.findOne({ ownerId: dbUser._id }).lean();
      return {
        success: true,
        data: { rundown: { segments: rundown?.segments ?? [], updatedAt: rundown?.updatedAt ? new Date(rundown.updatedAt).toISOString() : null } },
      };
    },
  );

  app.put(
    "/users/me/rundown",
    {
      schema: { tags: ["Run of show"], summary: "Save your run of show", body: rundownBodySchema, security: [{ bearerAuth: [] }] },
      // It saves as you type (debounced), so the limit is generous.
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const rundown = await Rundown.findOneAndUpdate(
        { ownerId: dbUser._id },
        { $set: { segments: request.body.segments } },
        { upsert: true, new: true },
      ).lean();
      // Edited mid-show: the consoles running it fetch it again.
      const live = await Stream.findOne({ streamerId: dbUser._id, isLive: true }).select("livekitRoomName").lean();
      if (live) void sendRoomDataTo(live.livekitRoomName, consoleIdentities(dbUser), { __evt: "rundown_changed" }).catch(() => {});
      return {
        success: true,
        data: { rundown: { segments: rundown?.segments ?? [], updatedAt: rundown?.updatedAt ? new Date(rundown.updatedAt).toISOString() : null } },
      };
    },
  );

  app.get(
    "/streams/:id/rundown",
    {
      schema: {
        tags: ["Run of show"],
        summary: "Where the show is (the segment on air and since when) and its running order — the host's and their producers'",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("+rundown streamerId").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      await requireChannelRole(stream, dbUser._id, "producer");
      const rundown = await Rundown.findOne({ ownerId: stream.streamerId }).select("segments").lean();
      return { success: true, data: { position: positionView(stream.rundown), segments: rundown?.segments ?? [] } };
    },
  );

  app.put(
    "/streams/:id/rundown",
    {
      schema: {
        tags: ["Run of show"],
        summary: "Put a segment on air (null stops the rundown); its clock starts on the server",
        params: streamIdParamsSchema,
        body: rundownPositionBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("+rundown streamerId isLive livekitRoomName").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      const { streamer } = await requireChannelRole(stream, dbUser._id, "producer");
      if (!stream.isLive) throw new ApiError(409, "Go live first", "NOT_LIVE");
      const { segmentId } = request.body;
      const now = new Date();
      // The show's clock starts with its first segment and runs until it's stopped.
      const position: StoredPosition = segmentId
        ? { segmentId, startedAt: now, showStartedAt: stream.rundown?.showStartedAt ?? now }
        : { segmentId: null, startedAt: null, showStartedAt: null };
      await Stream.updateOne({ _id: stream._id, isLive: true }, { $set: { rundown: position } });
      // The host's studio and every producer's console move on together —
      // the host's prompter follows a producer's Next.
      void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), { __evt: "rundown", position: positionView(position) }).catch(() => {});
      return { success: true, data: { position: positionView(position) } };
    },
  );
};
