import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type mongoose from "mongoose";
import {
  chatMessageParamsSchema,
  createBanBodySchema,
  streamIdParamsSchema,
  streamUserParamsSchema,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { sendRoomData } from "../livekit.js";
import { ChatMessage, Stream, StreamBan, type IStream } from "../models.js";

/**
 * Moderation v1 — the host deletes messages and bans users, per stream.
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

function requireHost(stream: IStream, userId: unknown) {
  if (!stream.streamerId.equals(String(userId))) {
    throw new ApiError(403, "Only the host can moderate", "FORBIDDEN");
  }
}

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
        summary: "Host: delete a chat message",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      requireHost(stream, dbUser._id);

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

      return { success: true, data: { deleted: true } };
    },
  );

  app.post(
    "/streams/:id/ban/:userId",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host: ban a user from the stream (or time them out)",
        security: [{ bearerAuth: [] }],
        params: streamUserParamsSchema,
        body: createBanBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      requireHost(stream, dbUser._id);

      if (request.params.userId === String(dbUser._id)) {
        throw new ApiError(400, "You can't ban yourself", "CANNOT_BAN_SELF");
      }

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
        summary: "Host: lift a ban",
        security: [{ bearerAuth: [] }],
        params: streamUserParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      requireHost(stream, dbUser._id);

      await StreamBan.deleteOne({
        streamId: stream._id,
        userId: request.params.userId,
      });

      void sendRoomData(stream.livekitRoomName, {
        __evt: "chat_unban",
        userId: request.params.userId,
      });

      return { success: true, data: { unbanned: true } };
    },
  );

  app.post(
    "/streams/:id/chat/:messageId/pin",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host: pin a chat message above the chat",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      requireHost(stream, dbUser._id);

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

      return { success: true, data: { pinned: true } };
    },
  );

  app.delete(
    "/streams/:id/pin",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host: unpin the pinned message",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      requireHost(stream, dbUser._id);

      await Stream.updateOne(
        { _id: stream._id },
        { $set: { pinnedMessage: null } },
      );

      void sendRoomData(stream.livekitRoomName, { __evt: "unpin" });

      return { success: true, data: { pinned: false } };
    },
  );

  app.get(
    "/streams/:id/bans",
    {
      schema: {
        tags: ["Moderation"],
        summary: "Host: list bans on this stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      requireHost(stream, dbUser._id);

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
