import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type mongoose from "mongoose";
import {
  MAX_STAGE_GUESTS,
  STAGE_FAN_LEVEL,
  guestUserParamsSchema,
  streamIdParamsSchema,
  type StageStanding,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { fanStatus } from "../fans.js";
import { sendRoomData, setParticipantPublishPermission } from "../livekit.js";
import { Follow, Stream, User, type IStream, type IUser } from "../models.js";
import { reconcileStream } from "../stream-service.js";
import { requireChannelRole, roleIn } from "../safety/roles.js";
import { assertNotBanned } from "./moderation.js";

/**
 * Stage guests — "bring people into your live".
 *
 * Flow: a signed-in viewer raises their hand (request), the host approves
 * from the studio, and the API upgrades that viewer's LiveKit participant to
 * a publisher. Their camera/mic then joins the room like any other track and
 * every viewer sees them — no second room, no re-tokening, no client trust.
 *
 * The Stream document's `guests` array is the authority; LiveKit permission
 * changes always follow a successful write to it, so a crashed request can't
 * leave someone publishing whom the document says isn't on stage.
 *
 * Every transition fans a `guest_update` event into the room:
 *   { __evt: "guest_update", action, userId, username, avatar? }
 * Clients react to actions about themselves (start/stop publishing) and
 * about others (tiles, request lists). Requests additionally fan
 * `guest_request`, which only the studio renders.
 */

/** A live stream the caller may act on, or the reason they can't. */
async function loadLiveStream(id: string) {
  const stream = await Stream.findById(id);
  if (!stream) {
    throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
  }
  if (!(await reconcileStream(stream))) {
    throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
  }
  return stream;
}

const publicGuest = (g: IStream["guests"][number]) => ({
  userId: String(g.userId),
  username: g.username,
  avatar: g.avatar,
  status: g.status,
  standing: g.standing ? { ally: Boolean(g.standing.ally), level: g.standing.level ?? 0, hours: g.standing.hours ?? 0 } : null,
});

const DAY_MS = 86_400_000;

/** Where someone asking to join stands with the channel: an ally or not, their fan level, hours watched. */
async function standingOf(channelId: mongoose.Types.ObjectId, userId: mongoose.Types.ObjectId): Promise<StageStanding> {
  const [ally, fan] = await Promise.all([Follow.exists({ followerId: userId, followingId: channelId }), fanStatus(channelId, userId)]);
  return { ally: Boolean(ally), level: fan?.level ?? 0, hours: fan?.hours ?? 0 };
}

/**
 * The request line, as the host set it (producer mode): who can ask to
 * join, and how old their account must be. The host's crew is never held
 * back by it. Says why, in words for the viewer, when they can't.
 */
export function assertMayAsk(
  streamer: Pick<IUser, "username" | "displayName"> & { settings?: Partial<IUser["settings"]> | null },
  user: { createdAt?: Date | string | null },
  standing: StageStanding,
  now = Date.now(),
) {
  const host = streamer.displayName || streamer.username;
  const rule = streamer.settings?.stageRequests ?? "everyone";
  const days = streamer.settings?.stageAccountDays ?? 0;
  if (rule === "off") {
    throw new ApiError(403, `${host} isn't taking requests to join right now`, "STAGE_CLOSED");
  }
  if (days > 0 && user.createdAt && now - new Date(user.createdAt).getTime() < days * DAY_MS) {
    throw new ApiError(403, `Accounts need to be ${days === 1 ? "a day" : "a week"} old to ask to join ${host}`, "STAGE_NEW_ACCOUNT");
  }
  if (rule === "allies" && !standing.ally) {
    throw new ApiError(403, `Only allies can ask to join — ally with ${host} first`, "STAGE_ALLIES_ONLY");
  }
  if (rule === "fans" && standing.level < STAGE_FAN_LEVEL) {
    throw new ApiError(
      403,
      `Only fans at level ${STAGE_FAN_LEVEL} or more can ask to join ${host} — you're level ${standing.level}. Watching and chatting level you up`,
      "STAGE_FANS_ONLY",
    );
  }
}

export const guestRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams/:id/guests",
    {
      schema: {
        tags: ["Guests"],
        summary: "Stage state: who is live on stage, and pending requests",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id).select("guests streamerId");
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      const guests = stream.guests ?? [];
      const streamer = await User.findById(stream.streamerId).select("settings.stageRequests settings.stageAccountDays").lean();
      return {
        success: true,
        data: {
          live: guests.filter((g) => g.status === "live").map(publicGuest),
          requests: guests
            .filter((g) => g.status === "requested")
            .map(publicGuest),
          maxGuests: MAX_STAGE_GUESTS,
          // Who can ask, so a viewer knows before they try.
          line: {
            who: streamer?.settings?.stageRequests ?? "everyone",
            accountDays: streamer?.settings?.stageAccountDays ?? 0,
          },
        },
      };
    },
  );

  app.post(
    "/streams/:id/guests/request",
    {
      schema: {
        tags: ["Guests"],
        summary: "Ask to join the stream's stage",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadLiveStream(request.params.id);

      if (stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(400, "You are the host", "HOST_CANNOT_REQUEST");
      }

      // Banned viewers don't get to ask for the camera either.
      await assertNotBanned(stream._id, dbUser._id);

      // The request line's rules — the crew always gets through.
      const streamer = await User.findById(stream.streamerId).select("username displayName settings safety").lean();
      const standing = await standingOf(stream.streamerId, dbUser._id);
      if (streamer && !roleIn(streamer, dbUser._id)) assertMayAsk(streamer, dbUser, standing);

      // Single atomic push, guarded on "not already in the array" — two
      // rapid taps produce one entry, not two.
      const updated = await Stream.findOneAndUpdate(
        {
          _id: stream._id,
          isLive: true,
          "guests.userId": { $ne: dbUser._id },
          // Bound the array: a raid of requests shouldn't grow the stream
          // document without limit. Old requests fall out when denied.
          $expr: { $lt: [{ $size: "$guests" }, 25] },
        },
        {
          $push: {
            guests: {
              userId: dbUser._id,
              username: dbUser.username,
              avatar: dbUser.avatar,
              status: "requested",
              requestedAt: new Date(),
              standing,
            },
          },
        },
        { new: true },
      );

      if (!updated) {
        const existing = stream.guests.find((g) =>
          g.userId.equals(dbUser._id),
        );
        if (existing) {
          // Already asked (or already up there) — idempotent success.
          return {
            success: true,
            data: { status: existing.status },
          };
        }
        throw new ApiError(
          409,
          "The stage request list is full right now",
          "STAGE_REQUESTS_FULL",
        );
      }

      void sendRoomData(stream.livekitRoomName, {
        __evt: "guest_request",
        userId: String(dbUser._id),
        username: dbUser.username,
        avatar: dbUser.avatar,
        standing,
      });

      return { success: true, data: { status: "requested" } };
    },
  );

  app.delete(
    "/streams/:id/guests/request",
    {
      schema: {
        tags: ["Guests"],
        summary: "Withdraw your own pending stage request",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      await Stream.updateOne(
        { _id: stream._id },
        { $pull: { guests: { userId: dbUser._id, status: "requested" } } },
      );

      void sendRoomData(stream.livekitRoomName, {
        __evt: "guest_update",
        action: "cancelled",
        userId: String(dbUser._id),
        username: dbUser.username,
      });

      return { success: true, data: { status: "idle" } };
    },
  );

  app.post(
    "/streams/:id/guests/:userId/approve",
    {
      schema: {
        tags: ["Guests"],
        summary: "Host: bring a requester onto the stage",
        security: [{ bearerAuth: [] }],
        params: guestUserParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadLiveStream(request.params.id);
      // The host, or a producer running the stage from their console.
      await requireChannelRole(stream, dbUser._id, "producer");

      const liveCount = stream.guests.filter(
        (g) => g.status === "live",
      ).length;
      if (liveCount >= MAX_STAGE_GUESTS) {
        throw new ApiError(
          409,
          `The stage is full (${MAX_STAGE_GUESTS} guests)`,
          "STAGE_FULL",
        );
      }

      // Flip requested → live in the document first; only a successful write
      // is followed by the LiveKit grant.
      const updated = await Stream.findOneAndUpdate(
        {
          _id: stream._id,
          guests: {
            $elemMatch: {
              userId: request.params.userId,
              status: "requested",
            },
          },
        },
        { $set: { "guests.$.status": "live" } },
        { new: true },
      );

      if (!updated) {
        // Approving someone already on stage is a no-op, not an error — the
        // studio may double-fire on a slow network.
        const already = stream.guests.find(
          (g) => String(g.userId) === request.params.userId,
        );
        if (already?.status === "live") {
          return { success: true, data: { status: "live" } };
        }
        throw new ApiError(
          404,
          "No pending request from that user",
          "GUEST_REQUEST_NOT_FOUND",
        );
      }

      const guest = updated.guests.find(
        (g) => String(g.userId) === request.params.userId,
      )!;

      try {
        await setParticipantPublishPermission(
          stream.livekitRoomName,
          request.params.userId,
          true,
        );
      } catch (error) {
        // The guest closed their tab between requesting and being approved.
        // Roll the document back so the stage doesn't hold a ghost slot.
        await Stream.updateOne(
          { _id: stream._id },
          { $pull: { guests: { userId: guest.userId } } },
        );
        request.log.warn(
          { err: error, guest: request.params.userId },
          "stage approve: participant not in room; request dropped",
        );
        throw new ApiError(
          409,
          "That viewer is no longer connected",
          "GUEST_NOT_CONNECTED",
        );
      }

      void sendRoomData(stream.livekitRoomName, {
        __evt: "guest_update",
        action: "approved",
        userId: String(guest.userId),
        username: guest.username,
        avatar: guest.avatar,
      });

      return { success: true, data: { status: "live" } };
    },
  );

  app.post(
    "/streams/:id/guests/:userId/deny",
    {
      schema: {
        tags: ["Guests"],
        summary: "Host: decline a stage request",
        security: [{ bearerAuth: [] }],
        params: guestUserParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      // The host, or a producer running the stage from their console.
      await requireChannelRole(stream, dbUser._id, "producer");

      await Stream.updateOne(
        { _id: stream._id },
        {
          $pull: {
            guests: { userId: request.params.userId, status: "requested" },
          },
        },
      );

      void sendRoomData(stream.livekitRoomName, {
        __evt: "guest_update",
        action: "denied",
        userId: request.params.userId,
      });

      return { success: true, data: { status: "idle" } };
    },
  );

  app.post(
    "/streams/:id/guests/:userId/remove",
    {
      schema: {
        tags: ["Guests"],
        summary: "Host: take a guest off the stage",
        security: [{ bearerAuth: [] }],
        params: guestUserParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      // The host, or a producer running the stage from their console.
      await requireChannelRole(stream, dbUser._id, "producer");

      const guest = stream.guests.find(
        (g) => String(g.userId) === request.params.userId,
      );

      await Stream.updateOne(
        { _id: stream._id },
        { $pull: { guests: { userId: request.params.userId } } },
      );

      // Revoke even if the document had no entry — belt and braces against a
      // past crash that granted publish without recording it.
      try {
        await setParticipantPublishPermission(
          stream.livekitRoomName,
          request.params.userId,
          false,
        );
      } catch {
        // Participant already gone — nothing left to revoke.
      }

      void sendRoomData(stream.livekitRoomName, {
        __evt: "guest_update",
        action: "removed",
        userId: request.params.userId,
        username: guest?.username,
      });

      return { success: true, data: { status: "idle" } };
    },
  );

  app.post(
    "/streams/:id/guests/claim",
    {
      schema: {
        tags: ["Guests"],
        summary:
          "Reclaim publish rights for a stage slot you already hold (reconnect / co-live merge)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadLiveStream(request.params.id);

      // Only someone the document ALREADY records as live on stage may
      // claim — this never grants a slot, it re-arms one. Used after a
      // co-live merge (the accepter connects to the primary room after
      // being added) and after a mid-stage reconnect.
      const mine = stream.guests.find(
        (g) => g.userId.equals(dbUser._id) && g.status === "live",
      );
      if (!mine) {
        throw new ApiError(403, "You're not on this stage", "NOT_ON_STAGE");
      }

      await setParticipantPublishPermission(
        stream.livekitRoomName,
        String(dbUser._id),
        true,
      );

      return { success: true, data: { status: "live" } };
    },
  );

  app.post(
    "/streams/:id/guests/leave",
    {
      schema: {
        tags: ["Guests"],
        summary: "Step off the stage yourself",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      await Stream.updateOne(
        { _id: stream._id },
        { $pull: { guests: { userId: dbUser._id } } },
      );

      try {
        await setParticipantPublishPermission(
          stream.livekitRoomName,
          String(dbUser._id),
          false,
        );
      } catch {
        // Already disconnected — the webhook cleanup got here first.
      }

      void sendRoomData(stream.livekitRoomName, {
        __evt: "guest_update",
        action: "left",
        userId: String(dbUser._id),
        username: dbUser.username,
      });

      return { success: true, data: { status: "idle" } };
    },
  );
};
