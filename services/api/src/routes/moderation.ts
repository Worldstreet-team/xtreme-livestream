import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import mongoose from "mongoose";
import {
  chatMessageParamsSchema,
  createBanBodySchema,
  featureBodySchema,
  streamIdParamsSchema,
  streamUserParamsSchema,
} from "@xtreme/contracts";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { featuredFrom, isDropMessage, sceneView, unfeatureMessage, unfeatureUser, writeFeatured } from "../featured.js";
import { sendRoomData, sendRoomDataTo } from "../livekit.js";
import { ChatMessage, Stream, StreamBan } from "../models.js";
import { assertActionable, moderatorIdentities, requireChannelRole } from "../safety/roles.js";
import { featureQueueView } from "./safety.js";

/**
 * Moderation — the host and their moderators (safety kit roles) delete
 * messages, time out and ban, pin, and put lines on screen, per stream.
 * Moderators act on viewers only; every action is audited.
 *
 * A ban row with `expiresAt: null` lasts the stream's lifetime; with a date
 * it's a timeout that lapses on its own (checked lazily at enforcement time,
 * no sweeper needed). Enforcement lives where the actions land: the chat
 * POST, the stage request, and the gift charge all call `getActiveBan`.
 *
 * Fan-out mirrors the rest of the platform: `chat_delete` carries the doomed
 * message id, `chat_ban` tells every client to purge that user's rows (and
 * tells the banned client itself to lock its composer).
 */

/** The ban currently gagging this user on this stream, if any. */
export async function getActiveBan(
  streamId: mongoose.Types.ObjectId | string,
  userId: mongoose.Types.ObjectId | string,
) {
  return StreamBan.findOne({
    streamId,
    userId,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });
}

/** 403 the request when the caller is banned from this stream. */
export async function assertNotBanned(
  streamId: mongoose.Types.ObjectId | string,
  userId: mongoose.Types.ObjectId | string,
) {
  const ban = await getActiveBan(streamId, userId);
  if (!ban) return;
  throw new ApiError(
    403,
    ban.expiresAt
      ? `You're timed out until ${ban.expiresAt.toISOString()}`
      : "You're banned from this stream",
    "BANNED",
  );
}

const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));

async function loadStream(id: string) {
  const stream = await Stream.findById(id);
  if (!stream) {
    throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
  }
  return stream;
}

export const moderationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.delete(
    "/streams/:id/chat/:messageId",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host and moderators: delete a chat message (or deny a held one)",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer, role } = await requireChannelRole(stream, dbUser._id, "mod");

      const target = await ChatMessage.findOne({ _id: request.params.messageId, streamId: stream._id })
        .select("userId status heldReason")
        .lean();
      if (!target) {
        throw new ApiError(404, "Message not found", "MESSAGE_NOT_FOUND");
      }
      // Moderators keep the viewers' lines; the host's and other
      // moderators' are the host's to remove. Anyone can remove their own.
      if (role !== "host" && String(target.userId) !== String(dbUser._id)) {
        assertActionable(streamer, target.userId);
      }

      // Hard delete: history reloads clean, and there's nothing sensitive
      // to retain — reports capture their own evidence separately.
      const message = await ChatMessage.findOneAndDelete({
        _id: request.params.messageId,
        streamId: stream._id,
      });
      if (!message) {
        throw new ApiError(404, "Message not found", "MESSAGE_NOT_FOUND");
      }

      void sendRoomData(stream.livekitRoomName, {
        __evt: "chat_delete",
        messageId: request.params.messageId,
      });
      // A held line that's turned down: the moderators' queues clear it,
      // and its writer hears it won't be posted.
      if (target.status === "held") {
        void sendRoomDataTo(stream.livekitRoomName, [...moderatorIdentities(streamer), String(target.userId)], {
          __evt: "held_resolved",
          messageId: request.params.messageId,
          outcome: "denied",
        });
      }
      await audit(dbUser._id, target.status === "held" ? "chat.deny" : "chat.delete", "chat", oid(request.params.messageId), {
        streamId: String(stream._id),
        authorId: String(target.userId),
        ...(target.status === "held" ? { reason: target.heldReason } : {}),
      });
      // A deleted line doesn't stay on screen either. The delete is done
      // whatever happens here; a miss only means it comes down at its time.
      await unfeatureMessage(stream._id, request.params.messageId).catch((err) =>
        request.log.error({ err }, "taking a deleted line off screen failed"),
      );

      return { success: true, data: { deleted: true } };
    },
  );

  app.post(
    "/streams/:id/ban/:userId",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host and moderators: ban a viewer from the stream (or time them out)",
        security: [{ bearerAuth: [] }],
        params: streamUserParamsSchema,
        body: createBanBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer } = await requireChannelRole(stream, dbUser._id, "mod");

      if (request.params.userId === String(dbUser._id)) {
        throw new ApiError(400, "You can't ban yourself", "CANNOT_BAN_SELF");
      }
      assertActionable(streamer, request.params.userId);

      const expiresAt = request.body.minutes
        ? new Date(Date.now() + request.body.minutes * 60_000)
        : null;

      // Their chat rows go with them — and we grab a username for the ban
      // list from the most recent one, since the ban target may never have
      // been seen by this API instance otherwise.
      const lastMessage = await ChatMessage.findOne({
        streamId: stream._id,
        userId: request.params.userId,
      })
        .sort({ createdAt: -1 })
        .select("username")
        .lean();

      // Upsert: re-banning updates the row (e.g. a timeout upgraded to a
      // permanent ban) instead of tripping the unique index.
      const ban = await StreamBan.findOneAndUpdate(
        { streamId: stream._id, userId: request.params.userId },
        {
          $set: {
            username: lastMessage?.username ?? "user",
            bannedBy: dbUser._id,
            expiresAt,
          },
        },
        { upsert: true, new: true },
      );

      await ChatMessage.deleteMany({
        streamId: stream._id,
        userId: request.params.userId,
      });

      // Banned users also come off the stage / out of the request queue.
      await Stream.updateOne(
        { _id: stream._id },
        { $pull: { guests: { userId: request.params.userId } } },
      );

      void sendRoomData(stream.livekitRoomName, {
        __evt: "chat_ban",
        userId: request.params.userId,
        username: ban?.username ?? lastMessage?.username,
        until: expiresAt ? expiresAt.toISOString() : null,
      });
      // Nor does anything of theirs that's featured — without failing the ban.
      await unfeatureUser(stream._id, request.params.userId).catch((err) =>
        request.log.error({ err }, "taking a banned user's line off screen failed"),
      );
      await audit(dbUser._id, expiresAt ? "chat.timeout" : "chat.ban", "user", oid(request.params.userId), {
        streamId: String(stream._id),
        ...(request.body.minutes ? { minutes: request.body.minutes } : {}),
      });

      return {
        success: true,
        data: {
          ban: {
            userId: request.params.userId,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
          },
        },
      };
    },
  );

  app.delete(
    "/streams/:id/ban/:userId",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host and moderators: lift a ban",
        security: [{ bearerAuth: [] }],
        params: streamUserParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "mod");

      await StreamBan.deleteOne({
        streamId: stream._id,
        userId: request.params.userId,
      });

      void sendRoomData(stream.livekitRoomName, {
        __evt: "chat_unban",
        userId: request.params.userId,
      });
      await audit(dbUser._id, "chat.unban", "user", oid(request.params.userId), { streamId: String(stream._id) });

      return { success: true, data: { unbanned: true } };
    },
  );

  app.post(
    "/streams/:id/chat/:messageId/pin",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host and moderators: pin a chat message above the chat",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "mod");

      const message = await ChatMessage.findOne({
        _id: request.params.messageId,
        streamId: stream._id,
      }).lean();
      if (!message) {
        throw new ApiError(404, "Message not found", "MESSAGE_NOT_FOUND");
      }

      // Snapshot the content onto the stream: the pin must survive the
      // original row being deleted (or its author being banned).
      const pinned = {
        messageId: message._id,
        username: message.username,
        avatar: message.avatar ?? "",
        content: message.content,
      };
      await Stream.updateOne(
        { _id: stream._id },
        { $set: { pinnedMessage: pinned } },
      );

      void sendRoomData(stream.livekitRoomName, {
        __evt: "pin",
        message: { ...pinned, messageId: String(pinned.messageId) },
      });
      await audit(dbUser._id, "chat.pin", "chat", oid(pinned.messageId), { streamId: String(stream._id) });

      return { success: true, data: { pinned: true } };
    },
  );

  app.delete(
    "/streams/:id/pin",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host and moderators: unpin the pinned message",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "mod");

      await Stream.updateOne(
        { _id: stream._id },
        { $set: { pinnedMessage: null } },
      );

      void sendRoomData(stream.livekitRoomName, { __evt: "unpin" });
      await audit(dbUser._id, "chat.unpin", "stream", stream._id);

      return { success: true, data: { pinned: false } };
    },
  );

  app.post(
    "/streams/:id/chat/:messageId/feature",
    {
      schema: {
        tags: ["Moderation"],
        summary:
          "Put a chat line or gift on screen (10, 20 or 60 seconds, or until taken down). Moderators, as the host allows: directly, or as a suggestion the host approves",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
        body: featureBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer, role } = await requireChannelRole(stream, dbUser._id, "mod");
      if (!stream.isLive) {
        throw new ApiError(409, "Go live first", "NOT_LIVE");
      }

      // From the stored row: what goes on screen is what was said.
      const message = await ChatMessage.findOne({
        _id: request.params.messageId,
        streamId: stream._id,
      }).lean();
      if (!message) {
        throw new ApiError(404, "Message not found", "MESSAGE_NOT_FOUND");
      }
      if (isDropMessage(message)) {
        throw new ApiError(400, "Drops can't go on screen", "NOT_FEATURABLE");
      }

      // The host and their producers put lines up directly; moderators as the host allows.
      if (role !== "host" && role !== "producer") {
        const mode = streamer.safety?.modsCanFeature ?? "suggest";
        if (mode === "off") {
          throw new ApiError(403, "The host hasn't let moderators put lines on screen", "FORBIDDEN");
        }
        if (mode === "suggest") {
          // Into the host's queue, once; the newest twenty are kept.
          const entry = {
            messageId: message._id,
            username: message.username,
            text: message.content,
            kind: message.type === "tip" ? ("gift" as const) : ("chat" as const),
            suggestedBy: dbUser.username,
            at: new Date(),
          };
          await Stream.updateOne(
            { _id: stream._id, "featureQueue.messageId": { $ne: message._id } },
            { $push: { featureQueue: { $each: [entry], $slice: -20 } } },
          );
          const fresh = await Stream.findById(stream._id).select("featureQueue").lean();
          const queue = featureQueueView(fresh?.featureQueue);
          void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), { __evt: "feature_queue", queue });
          await audit(dbUser._id, "feature.suggest", "chat", oid(message._id), { streamId: String(stream._id) });
          return { success: true, data: { suggested: true, queue } };
        }
      }

      const scene = await writeFeatured(stream._id, featuredFrom(message, request.body.seconds));
      if (!scene) {
        throw new ApiError(409, "Go live first", "NOT_LIVE");
      }
      // Up on screen: it leaves the suggestions if it was waiting there.
      if (stream.featureQueue?.some((q) => String(q.messageId) === String(message._id))) {
        await Stream.updateOne({ _id: stream._id }, { $pull: { featureQueue: { messageId: message._id } } });
        const fresh = await Stream.findById(stream._id).select("featureQueue").lean();
        void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), {
          __evt: "feature_queue",
          queue: featureQueueView(fresh?.featureQueue),
        });
      }
      await audit(dbUser._id, "feature.show", "chat", oid(message._id), {
        streamId: String(stream._id),
        seconds: request.body.seconds,
      });
      return { success: true, data: { scene } };
    },
  );

  app.delete(
    "/streams/:id/chat/:messageId/feature",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Take a chat line or gift off screen (the host; moderators when allowed to put them up)",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer, role } = await requireChannelRole(stream, dbUser._id, "mod");
      if (role !== "host" && role !== "producer" && (streamer.safety?.modsCanFeature ?? "suggest") !== "on") {
        throw new ApiError(403, "Only the host takes lines off screen here", "FORBIDDEN");
      }

      // Only while it's still the one on screen — a newer pick stays up.
      const scene = await unfeatureMessage(stream._id, request.params.messageId);
      if (scene) {
        await audit(dbUser._id, "feature.hide", "chat", oid(request.params.messageId), { streamId: String(stream._id) });
      }
      return { success: true, data: { scene: scene ?? sceneView(stream.scene) } };
    },
  );

  app.get(
    "/streams/:id/bans",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host and moderators: list bans on this stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "mod");

      const bans = await StreamBan.find({ streamId: stream._id })
        .sort({ createdAt: -1 })
        .lean();

      return {
        success: true,
        data: {
          bans: bans.map((b) => ({
            userId: String(b.userId),
            username: b.username,
            expiresAt: b.expiresAt ? b.expiresAt.toISOString() : null,
          })),
        },
      };
    },
  );
};
