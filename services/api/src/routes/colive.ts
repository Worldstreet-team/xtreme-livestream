import { z } from "zod";
import type { Types } from "mongoose";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { objectIdSchema, streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { createToken, sendRoomData } from "../livekit.js";
import { Stream, type IStream } from "../models.js";
import { markStreamEnded, reconcileStream } from "../stream-service.js";

/**
 * Co-live merge — two creators, each live, combine into one broadcast.
 *
 * The INVITER's stream is the primary: they asked someone onto their show.
 * Accepting makes the accepter a live stage guest of the primary (the
 * existing split-screen machinery takes it from there), ends the accepter's
 * own stream, and fans `colive_merged` into their room so every one of
 * their viewers is carried over to the primary. Audience and continuity
 * merge; each stream keeps its own persisted chat history.
 *
 * Consent is the invite. Invites are held in memory with a short TTL —
 * they're ephemeral session state between two currently-live hosts, and a
 * process restart voiding them costs one re-tap of "Invite".
 */

const INVITE_TTL_MS = 5 * 60_000;

/** `${fromStreamId}:${toStreamId}` → when the invite was made. */
const invites = new Map<string, number>();

/** Test hook: co-live invites are process state, tests need a clean slate. */
export function clearCoLiveInvites() {
  invites.clear();
}

function inviteKey(fromStreamId: string, toStreamId: string) {
  return `${fromStreamId}:${toStreamId}`;
}

function hasInvite(fromStreamId: string, toStreamId: string) {
  const at = invites.get(inviteKey(fromStreamId, toStreamId));
  if (at === undefined) return false;
  if (Date.now() - at > INVITE_TTL_MS) {
    invites.delete(inviteKey(fromStreamId, toStreamId));
    return false;
  }
  return true;
}

/** The caller's own currently-live stream, or the reason they can't play. */
async function requireLiveHost(dbUserId: Types.ObjectId) {
  const stream = await Stream.findOne({ streamerId: dbUserId, isLive: true });
  if (!stream || !(await reconcileStream(stream))) {
    throw new ApiError(
      400,
      "You need to be live to co-live",
      "NOT_LIVE",
    );
  }
  return stream;
}

const fromBodySchema = z.object({ fromStreamId: objectIdSchema });

export const coLiveRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/streams/:id/colive/invite",
    {
      schema: {
        tags: ["CoLive"],
        summary: "Invite another live host to merge into your stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const myStream = await requireLiveHost(dbUser._id);

      const target = await Stream.findById(request.params.id);
      if (!target || !(await reconcileStream(target))) {
        throw new ApiError(400, "That stream is not live", "TARGET_NOT_LIVE");
      }
      if (target.streamerId.equals(dbUser._id)) {
        throw new ApiError(400, "That's your own stream", "SELF_INVITE");
      }

      invites.set(inviteKey(String(myStream._id), String(target._id)), Date.now());

      void sendRoomData(target.livekitRoomName, {
        __evt: "colive_invite",
        fromStreamId: String(myStream._id),
        fromUserId: String(dbUser._id),
        fromUsername: dbUser.username,
        fromDisplayName: dbUser.displayName,
        fromAvatar: dbUser.avatar,
        fromTitle: myStream.title,
      });

      return { success: true, data: { invited: true } };
    },
  );

  app.post(
    "/streams/:id/colive/accept",
    {
      schema: {
        tags: ["CoLive"],
        summary:
          "Accept a co-live invite: join their stage, end your stream, carry your viewers over",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: fromBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);

      // :id is MY stream (the one being merged away); I must be its host.
      const myStream = await Stream.findById(request.params.id);
      if (!myStream || !myStream.streamerId.equals(dbUser._id)) {
        throw new ApiError(403, "Not your stream", "FORBIDDEN");
      }
      if (!(await reconcileStream(myStream))) {
        throw new ApiError(400, "Your stream is not live", "NOT_LIVE");
      }

      const { fromStreamId } = request.body;
      if (!hasInvite(fromStreamId, String(myStream._id))) {
        throw new ApiError(
          403,
          "No open invite from that stream",
          "NO_INVITE",
        );
      }

      const primary = await Stream.findById(fromStreamId);
      if (!primary || !(await reconcileStream(primary))) {
        throw new ApiError(
          400,
          "That stream ended before you accepted",
          "PRIMARY_NOT_LIVE",
        );
      }

      // One-shot: the invite is consumed win or lose past this point.
      invites.delete(inviteKey(fromStreamId, String(myStream._id)));

      // 1. On the primary's stage as a live guest — the same array the
      //    split-screen grid and stage tooling already key off.
      await Stream.findOneAndUpdate(
        { _id: primary._id },
        {
          $push: {
            guests: {
              userId: dbUser._id,
              username: dbUser.username,
              avatar: dbUser.avatar,
              status: "live",
              requestedAt: new Date(),
            },
          },
        },
      );
      void sendRoomData(primary.livekitRoomName, {
        __evt: "guest_update",
        action: "approved",
        userId: String(dbUser._id),
        username: dbUser.username,
        avatar: dbUser.avatar,
      });

      // 2. My viewers follow me to the primary. Fired BEFORE the stream is
      //    marked ended so clients see the merge, not a generic "ended".
      void sendRoomData(myStream.livekitRoomName, {
        __evt: "colive_merged",
        into: fromStreamId,
        primaryHost: true,
      });

      await markStreamEnded(myStream);

      // 3. A publisher token for the primary room — the accepter's client
      //    reconnects there and goes straight on stage. (A runtime
      //    permission grant can't work here: they aren't connected to the
      //    primary room yet.)
      const token = await createToken(
        primary.livekitRoomName,
        dbUser._id.toString(),
        dbUser.displayName,
        { canPublish: true, canSubscribe: true, canPublishData: true },
      );

      return {
        success: true,
        data: {
          primaryStreamId: fromStreamId,
          token,
          roomName: primary.livekitRoomName,
        },
      };
    },
  );

  app.post(
    "/streams/:id/colive/decline",
    {
      schema: {
        tags: ["CoLive"],
        summary: "Decline a co-live invite",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: fromBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const myStream = await Stream.findById(request.params.id);
      if (!myStream || !myStream.streamerId.equals(dbUser._id)) {
        throw new ApiError(403, "Not your stream", "FORBIDDEN");
      }

      const { fromStreamId } = request.body;
      invites.delete(inviteKey(fromStreamId, String(myStream._id)));

      const primary = await Stream.findById(fromStreamId);
      if (primary) {
        void sendRoomData(primary.livekitRoomName, {
          __evt: "colive_decline",
          byUserId: String(dbUser._id),
          byUsername: dbUser.username,
        });
      }

      return { success: true, data: { declined: true } };
    },
  );
};

/** Narrow helper the tests exercise via the routes — kept for reuse. */
export type CoLiveStream = IStream;
