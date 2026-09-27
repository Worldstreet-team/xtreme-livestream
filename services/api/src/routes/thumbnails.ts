import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  chooseThumbnailBodySchema,
  streamIdParamsSchema,
  thumbnailCandidateBodySchema,
  type ThumbnailCandidate,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Stream } from "../models.js";
import { thumbnailUrlFor } from "../stream-service.js";
import { candidateGapMs, offerCandidate, type StoredCandidate } from "../thumbnail-candidates.js";

/**
 * "Pick a thumbnail": the frames the studio kept while live, and the host
 * choosing one afterwards. Every route here is the host's alone — the same
 * checks as PATCH /streams/:id (signed in, and the stream's own streamer).
 * The candidates are `select: false` on the model, so nothing else ever
 * loads them; they're asked for by name here.
 */
export const thumbnailRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** The stream, with its candidates, when the caller is its streamer. */
  const ownStream = async (request: Parameters<typeof authenticate>[0], id: string) => {
    const { dbUser } = await authenticate(request);
    const stream = await Stream.findById(id).select("+thumbnailCandidates");

    if (!stream) {
      throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
    }
    if (!stream.streamerId.equals(dbUser._id)) {
      throw new ApiError(403, "Not authorized", "FORBIDDEN");
    }
    return stream;
  };

  const candidatesOf = (stream: { thumbnail: string; thumbnailCandidates?: StoredCandidate[] }): ThumbnailCandidate[] =>
    (stream.thumbnailCandidates ?? []).map((c) => ({
      id: c.id,
      image: c.image,
      score: c.score,
      at: new Date(c.at).toISOString(),
      current: Boolean(stream.thumbnail) && c.image === stream.thumbnail,
    }));

  app.post(
    "/streams/:id/thumbnail-candidates",
    {
      schema: {
        tags: ["Streams"],
        summary: "Offer a scored live frame as a thumbnail candidate (host only)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: thumbnailCandidateBodySchema,
      },
    },
    async (request) => {
      const stream = await ownStream(request, request.params.id);
      // Frames of the broadcast, from the broadcast: an ended stream's
      // choices are settled.
      if (!stream.isLive) {
        throw new ApiError(409, "This stream isn't live", "STREAM_NOT_LIVE");
      }

      const now = new Date();
      const offered: StoredCandidate = {
        id: crypto.randomUUID(),
        image: request.body.image,
        score: request.body.score,
        at: now,
      };
      const list = (stream.thumbnailCandidates ?? []).map((c) => ({ id: c.id, image: c.image, score: c.score, at: c.at }));
      const next = offerCandidate(list, offered, candidateGapMs(stream.startedAt, now));
      if (next) {
        await Stream.updateOne({ _id: stream._id }, { $set: { thumbnailCandidates: next } });
      }

      return {
        success: true,
        data: { kept: Boolean(next), count: (next ?? list).length },
      };
    },
  );

  app.get(
    "/streams/:id/thumbnail-candidates",
    {
      schema: {
        tags: ["Streams"],
        summary: "The frames kept while live, and the current thumbnail (host only)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await ownStream(request, request.params.id);
      return {
        success: true,
        data: {
          thumbnailUrl: thumbnailUrlFor(stream),
          isLive: stream.isLive,
          startedAt: stream.startedAt,
          candidates: candidatesOf(stream),
        },
      };
    },
  );

  app.put(
    "/streams/:id/thumbnail",
    {
      schema: {
        tags: ["Streams"],
        summary: "Make one of the kept frames the stream's thumbnail (host only)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: chooseThumbnailBodySchema,
      },
    },
    async (request) => {
      const stream = await ownStream(request, request.params.id);
      const chosen = (stream.thumbnailCandidates ?? []).find((c) => c.id === request.body.candidateId);
      if (!chosen) {
        throw new ApiError(404, "That frame isn't one of this stream's", "CANDIDATE_NOT_FOUND");
      }

      // As PATCH does: the version moves only when the image does, and the
      // new version is a new URL for every cached card.
      if (chosen.image !== stream.thumbnail) {
        stream.thumbnail = chosen.image;
        stream.thumbnailVersion = Date.now();
        await stream.save();
      }

      return {
        success: true,
        message: "Thumbnail updated",
        data: {
          thumbnailUrl: thumbnailUrlFor(stream),
          thumbnailVersion: stream.thumbnailVersion,
          candidates: candidatesOf(stream),
        },
      };
    },
  );
};
