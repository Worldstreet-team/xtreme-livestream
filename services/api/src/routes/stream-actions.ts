import crypto from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  chatQuerySchema,
  createChatMessageBodySchema,
  createReportBodySchema,
  streamIdParamsSchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { CHAT_SLOW_MODE_SECONDS, chatPayload } from "../chat.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { createToken, sendRoomData, sendRoomDataTo } from "../livekit.js";
import { assertNotBanned } from "./moderation.js";
import { heldView } from "./safety.js";
import {
  ChatMessage,
  Follow,
  Notification,
  Report,
  Stream,
  StreamLike,
  User,
} from "../models.js";
import { checkMessage, HELD_REASON_LABELS, NEW_ACCOUNT_MS } from "../safety/filter.js";
import { evasionOf, evasionReason } from "../safety/evasion.js";
import { atLeast, moderatorIdentities, roleIn } from "../safety/roles.js";
import {
  markStreamEnded,
  parseImageDataUri,
  reconcileStream,
} from "../stream-service.js";
import { bumpGoal } from "../goals.js";
import { fanStatus, fanStatuses } from "../fans.js";
import { fireRules } from "../rules.js";
import { noteTickers } from "../tickers.js";

/**
 * Cooldown between messages when the streamer has slow mode on
 * (CHAT_SLOW_MODE_SECONDS, chat.ts). Mirrored client-side as
 * SLOW_MODE_SECONDS in components/app/live-chat.tsx — keep the two in step
 * so the countdown matches what the server enforces.
 */

/** Suspicious accounts already pointed out, per stream: once every half hour is enough. */
const flagged = new Map<string, number>();
const FLAG_EVERY_MS = 30 * 60_000;

/** Tell the room's moderators — only them — that this account looks like a ban evader. */
function flagSuspect(
  stream: { _id: unknown; livekitRoomName: string },
  streamer: Parameters<typeof moderatorIdentities>[0],
  user: { _id: unknown; username: string },
  reason: string,
  now = Date.now(),
) {
  const key = `${String(stream._id)}:${String(user._id)}`;
  if (now - (flagged.get(key) ?? 0) < FLAG_EVERY_MS) return;
  flagged.set(key, now);
  if (flagged.size > 5000) flagged.delete(flagged.keys().next().value!);
  void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), {
    __evt: "suspect",
    userId: String(user._id),
    username: user.username,
    reason,
  }).catch(() => {});
}

export const streamActionRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams/:id/token",
    {
      schema: {
        tags: ["Streams"],
        summary:
          "Create a LiveKit viewer token (anonymous viewers get a read-only guest token)",
        params: streamIdParamsSchema,
        querystring: z.object({
          /** Which surface the viewer is on — badged on the join row. */
          platform: z
            .enum(["xstream", "socials", "worldspace"])
            .default("xstream"),
          /**
           * A muted look from a hero or channel page, not a viewing session:
           * always a guest identity, so it never announces a join, never
           * opens a watch session and never lets the previewer publish.
           */
          preview: z.enum(["true", "false"]).default("false"),
          /**
           * Owner-as-viewer: join under a distinct mon-<id> identity with no
           * publish rights. Without this, a host opening their own stream
           * page reuses the broadcaster identity and LiveKit kicks the
           * actual broadcast (their phone app or studio tab) off the air.
           */
          monitor: z.enum(["1"]).optional(),
        }),
      },
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      // Signed-in viewers join under their identity; anonymous visitors get a
      // guest identity that can watch but cannot broadcast data messages.
      const viewer =
        request.query.preview !== "true" && getOptionalAuthUserId(request)
          ? await authenticate(request)
          : null;
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      // The stream's owner gets a publisher token: this is how a broadcaster
      // whose page reloaded reclaims their own live stream instead of being
      // locked out of it while it stays live.
      const isOwner =
        viewer !== null && stream.streamerId.equals(viewer.dbUser._id);

      // A practice run's room is private: the host (their monitor included)
      // and their producers, nobody else — not a moderator, not a preview,
      // not a guest. Checked before the liveness reconcile, so a stranger's
      // probe never so much as asks LiveKit about the room.
      if (stream.practice && !isOwner) {
        const streamer = viewer ? await User.findById(stream.streamerId).select("safety").lean() : null;
        if (!viewer || !streamer || !atLeast(roleIn(streamer, viewer.dbUser._id), "producer")) {
          throw new ApiError(
            403,
            "This is a practice run — only the host and their producers can join",
            "PRACTICE_PRIVATE",
          );
        }
      }

      if (!(await reconcileStream(stream))) {
        throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      }

      const monitoring = isOwner && request.query.monitor === "1";
      const token = await createToken(
        stream.livekitRoomName,
        monitoring
          ? `mon-${viewer!.dbUser._id.toString()}`
          : viewer
            ? viewer.dbUser._id.toString()
            : `guest-${crypto.randomUUID()}`,
        viewer ? viewer.dbUser.displayName : "Guest",
        {
          canPublish: isOwner && !monitoring,
          canSubscribe: true,
          // Room events are the API's to send (it fans chat out too): a
          // viewer who could publish data could put a fake gift, scene or
          // card in front of everyone in the room.
          canPublishData: isOwner && !monitoring,
        },
      );

      // "X joined" — the handshake viewers actually see. Announced for
      // named viewers only: a guest row would just say "someone", and the
      // broadcaster reclaiming their own room is not an arrival.
      if (viewer && !isOwner) {
        void sendRoomData(stream.livekitRoomName, {
          __evt: "join",
          username: viewer.dbUser.username,
          platform: request.query.platform,
        });
      }

      return {
        success: true,
        data: {
          token,
          livekitUrl: config.LIVEKIT_URL,
          roomName: stream.livekitRoomName,
        },
      };
    },
  );

  app.post(
    "/streams/:id/end",
    {
      schema: {
        tags: ["Streams"],
        summary: "End a live stream",
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
      if (!stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(403, "Not authorized", "FORBIDDEN");
      }
      if (!stream.isLive) {
        throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      }

      await markStreamEnded(stream);

      return {
        success: true,
        message: "Stream ended",
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            duration: stream.duration,
            viewers: stream.viewers,
            peakViewers: stream.peakViewers,
          },
        },
      };
    },
  );

  app.get(
    "/streams/:id/thumbnail",
    {
      schema: {
        tags: ["Streams"],
        summary: "Stream thumbnail as an image (long-lived, versioned cache)",
        params: streamIdParamsSchema,
      },
      // Cacheable static-ish bytes; the rate limiter would only punish a
      // first page load, which legitimately fetches a whole grid at once.
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const stream = await Stream.findById(request.params.id)
        .select("thumbnail thumbnailVersion")
        .lean();

      if (!stream?.thumbnail) {
        throw new ApiError(404, "No thumbnail for this stream", "NO_THUMBNAIL");
      }

      // `imageSourceSchema` also permits a plain http(s) URL — hand those
      // straight back rather than proxying someone else's bytes.
      if (!stream.thumbnail.startsWith("data:")) {
        return reply.redirect(stream.thumbnail, 302);
      }

      const image = parseImageDataUri(stream.thumbnail);
      if (!image) {
        throw new ApiError(
          415,
          "Stored thumbnail is not a readable image",
          "THUMBNAIL_UNREADABLE",
        );
      }

      // Version-based rather than content-hashed so the list endpoint can
      // build the URL without loading the blob, and so we skip hashing on
      // every request.
      const etag = `"thumb-${stream.thumbnailVersion ?? 0}"`;
      if (request.headers["if-none-match"] === etag) {
        return reply.code(304).send();
      }

      return reply
        .header("Content-Type", image.contentType)
        .header("ETag", etag)
        // The URL carries ?v=<thumbnailVersion>, so a replaced thumbnail is a
        // different URL — this response can be kept indefinitely.
        .header("Cache-Control", "public, max-age=31536000, immutable")
        // Helmet defaults every response to CORP same-origin, which makes an
        // <img> on the web app's origin fail with NotSameOrigin — the API is
        // a different host in every deployed environment. Thumbnails are
        // public images built to be embedded, so opt this route out.
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(image.body);
    },
  );

  app.get(
    "/streams/:id/like",
    {
      schema: {
        tags: ["Streams"],
        summary: "Get like count and whether the caller liked the stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("likes");

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const liked = Boolean(
        await StreamLike.exists({ streamId: stream._id, userId: dbUser._id }),
      );

      return { success: true, data: { likes: stream.likes, liked } };
    },
  );

  app.post(
    "/streams/:id/like",
    {
      schema: {
        tags: ["Streams"],
        summary: "Like a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("likes");

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const result = await StreamLike.updateOne(
        { streamId: stream._id, userId: dbUser._id },
        { $setOnInsert: { streamId: stream._id, userId: dbUser._id } },
        { upsert: true },
      );

      let likes = stream.likes;
      if (result.upsertedCount > 0) {
        const updated = await Stream.findByIdAndUpdate(
          stream._id,
          { $inc: { likes: 1 } },
          { new: true, select: "likes livekitRoomName" },
        );
        likes = updated?.likes ?? likes + 1;
        // Everyone watching sees the count move — likes were REST-only and
        // never reached the room, on either platform.
        void sendRoomData(updated?.livekitRoomName ?? "", {
          __evt: "like",
          likes,
          username: dbUser.username,
        });
        // A likes goal counts it too; never fails the like.
        await bumpGoal(stream._id, "likes", 1).catch((err) => request.log.error({ err }, "moving the goal failed"));
      }

      return { success: true, data: { likes, liked: true } };
    },
  );

  app.delete(
    "/streams/:id/like",
    {
      schema: {
        tags: ["Streams"],
        summary: "Remove a like from a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("likes");

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      const deleted = await StreamLike.findOneAndDelete({
        streamId: stream._id,
        userId: dbUser._id,
      });

      let likes = stream.likes;
      if (deleted) {
        const updated = await Stream.findOneAndUpdate(
          { _id: stream._id, likes: { $gt: 0 } },
          { $inc: { likes: -1 } },
          { new: true, select: "likes livekitRoomName" },
        );
        likes = updated?.likes ?? Math.max(0, likes - 1);
        void sendRoomData(updated?.livekitRoomName ?? "", {
          __evt: "like",
          likes,
        });
      }

      return { success: true, data: { likes, liked: false } };
    },
  );

  app.post(
    "/streams/:id/report",
    {
      schema: {
        tags: ["Streams"],
        summary: "Report a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: createReportBodySchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select(
        "streamerId title",
      );

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      // A chat line, or the stream itself. The line's words are kept with
      // the report: it may be deleted before anyone reviews it.
      const messageId = request.body.messageId ?? null;
      let message: { username: string; content: string } | null = null;
      if (messageId) {
        const row = await ChatMessage.findOne({ _id: messageId, streamId: stream._id }).select("userId username content").lean();
        if (!row) {
          throw new ApiError(404, "Message not found", "MESSAGE_NOT_FOUND");
        }
        if (String(row.userId) === String(dbUser._id)) {
          throw new ApiError(400, "You can't report your own message", "SELF_REPORT");
        }
        message = { username: row.username, content: row.content };
      } else if (stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(
          400,
          "You cannot report your own stream",
          "SELF_REPORT",
        );
      }

      const result = await Report.updateOne(
        { streamId: stream._id, reporterId: dbUser._id, messageId },
        {
          $set: {
            reason: request.body.reason,
            details: request.body.details ?? "",
            status: "open",
            ...(message ? { message } : {}),
          },
          // The response clock starts at the first report, not a repeat.
          $setOnInsert: {
            streamId: stream._id,
            streamerId: stream.streamerId,
            reporterId: dbUser._id,
            messageId,
            dueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          },
        },
        { upsert: true },
      );

      // Admins hear about every new report, with the clock already running.
      if (result.upsertedCount > 0 && config.ADMIN_USERNAMES.length > 0) {
        const admins = await User.find({ username: { $in: config.ADMIN_USERNAMES } }).select("_id").lean();
        if (admins.length) {
          await Notification.insertMany(
            admins.map((a) => ({
              userId: a._id,
              type: "report",
              actorId: dbUser._id,
              actorName: dbUser.displayName || dbUser.username,
              streamId: stream._id,
              streamTitle: message ? `a chat line in “${stream.title}”` : stream.title,
              link: "/admin/reports",
            })),
          ).catch(() => {});
        }
      }

      return {
        success: true,
        message: "Report submitted. Our moderation team will review it.",
      };
    },
  );

  app.get(
    "/streams/:id/chat",
    {
      schema: {
        tags: ["Chat"],
        summary: "Get persisted chat history",
        params: streamIdParamsSchema,
        querystring: chatQuerySchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id).select("_id streamerId");
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      // Held lines wait for a moderator; nobody else sees them in history.
      const filter: Record<string, unknown> = { streamId: stream._id, status: { $ne: "held" } };
      if (request.query.before) {
        filter._id = { $lt: request.query.before };
      }

      const messages = await ChatMessage.find(filter)
        .sort({ createdAt: -1 })
        .limit(request.query.limit)
        .lean();

      messages.reverse();
      // Each author's standing with the channel, read once for the page.
      // Never fails the history.
      const authors = [...new Map(messages.map((m) => [String(m.userId), m.userId])).values()];
      const standing = await fanStatuses(stream.streamerId, authors).catch(() => new Map());
      const withFans = messages.map((m) => {
        const fan = standing.get(String(m.userId));
        return fan && (fan.level > 0 || fan.badge > 0) ? { ...m, fan } : m;
      });
      // The first page also carries every Shout still pinned, however far
      // back it was sent — an hour's pin outlives the page it's on.
      const shouts = request.query.before
        ? []
        : await ChatMessage.find({ streamId: stream._id, shoutUntil: { $gt: new Date() }, status: { $ne: "held" } })
            .sort({ createdAt: 1 })
            .limit(20)
            .lean();
      return { success: true, data: { messages: withFans, shouts } };
    },
  );

  app.post(
    "/streams/:id/chat",
    {
      schema: {
        tags: ["Chat"],
        summary: "Persist a chat message",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: createChatMessageBodySchema,
      },
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!(await reconcileStream(stream))) {
        throw new ApiError(
          400,
          "Stream is not live - chat is disabled",
          "STREAM_OFFLINE",
        );
      }

      const body = request.body;
      if (body.type === "tip") {
        // Tip announcements are only written by the gifts route after a
        // successful wallet charge — never directly by clients.
        throw new ApiError(
          400,
          "Tips are sent via the gifts endpoint",
          "TIP_VIA_GIFTS",
        );
      }

      // The room's rules, enforced here — client-side state is trivially
      // bypassed by posting directly. The host and their moderators are
      // exempt; everyone else meets the ban list, Shield, allies-only, slow
      // mode and the chat filter, in that order.
      const streamer = await User.findById(stream.streamerId).select("settings safety");
      const role = streamer ? roleIn(streamer, dbUser._id) : stream.streamerId.equals(dbUser._id) ? "host" : null;
      const shield = Boolean(stream.shield?.on);
      let held: ReturnType<typeof checkMessage> = null;
      if (!role) {
        // Ban check first: a banned user's message must not slip through on
        // a stream with no other restrictions enabled.
        await assertNotBanned(stream._id, dbUser._id);

        if (streamer?.settings.subscriberOnly || shield) {
          const follows = await Follow.exists({
            followerId: dbUser._id,
            followingId: stream.streamerId,
          });
          if (!follows) {
            throw new ApiError(
              403,
              shield
                ? "Shield is up — for now only allies can chat. Ally with the streamer to join in"
                : "This chat is for allies only — ally with the streamer to join in",
              "FOLLOWERS_ONLY",
            );
          }
        }

        if (streamer?.settings.slowMode || shield) {
          const since = new Date(Date.now() - CHAT_SLOW_MODE_SECONDS * 1000);
          const recent = await ChatMessage.exists({
            streamId: stream._id,
            userId: dbUser._id,
            createdAt: { $gt: since },
          });
          if (recent) {
            throw new ApiError(
              429,
              `Slow mode is on — wait ${CHAT_SLOW_MODE_SECONDS}s between messages`,
              "SLOW_MODE",
            );
          }
        }

        // The chat filter: its switch and levels are the host's; Shield
        // raises the floor whether or not the switch is on. Reactions are
        // the room's own emoji, so there's nothing to read.
        if (body.type !== "reaction") {
          const createdAt = (dbUser as { createdAt?: Date }).createdAt;
          const verdict = checkMessage(body.content, streamer?.settings.profanityFilter === false ? null : (streamer?.safety ?? {}), {
            shield,
            newAccount: createdAt ? Date.now() - new Date(createdAt).getTime() < NEW_ACCOUNT_MS : false,
          });
          if (verdict?.level === "block") {
            throw new ApiError(422, "That message wasn't sent — it goes against this room's chat rules", "MESSAGE_BLOCKED");
          }
          held = verdict;
        }

        // A young account named like one banned here lately: the moderators
        // are told, and if the host says so its lines wait for review.
        const evasion = await evasionOf(stream.streamerId, dbUser).catch(() => null);
        if (evasion) {
          if (!held && streamer?.safety?.evasion === "hold") held = { level: "hold", category: "evasion" };
          if (streamer) flagSuspect(stream, streamer, dbUser, evasionReason(evasion));
        }
      }

      const message = await ChatMessage.create({
        streamId: stream._id,
        userId: dbUser._id,
        username: dbUser.username,
        avatar: dbUser.avatar,
        isMod: role !== null,
        content: body.content,
        type: body.type,
        tipAmount: body.tipAmount ?? null,
        tipCurrency: body.tipCurrency ?? null,
        emoji: body.emoji ?? null,
        platform: body.platform,
        status: held ? "held" : "visible",
        heldReason: held?.category ?? "",
      });

      // Held: only the host and moderators hear about it, to approve or
      // turn down; the writer sees it waiting.
      if (held && streamer) {
        void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), {
          __evt: "held",
          message: heldView(message),
        });
        return {
          success: true,
          data: { message, held: true, reason: HELD_REASON_LABELS[held.category] },
        };
      }

      // The API fans the message into the live room. Delivery used to
      // depend on the sender's own client republishing over WebRTC, which
      // was silence for anyone whose token lacked canPublishData — the
      // usual state of cross-platform viewers. Clients dedupe on `id`.
      // The author's fan level and watch-time badge ride along. Never fails the line.
      const fan = await fanStatus(stream.streamerId, dbUser._id).catch(() => null);
      void sendRoomData(stream.livekitRoomName, chatPayload(message, fan));
      // A chat word the host made a rule for ("!discord") — never the host's own line.
      if (body.type === "text" && role !== "host") {
        void fireRules(stream, { kind: "chat_word", text: body.content, user: dbUser.username });
        // "$SOL": what chat's talking about, as a chart the host can put up in a tap.
        void noteTickers(stream, streamer ?? null, body.content).catch(() => {});
      }

      return { success: true, data: { message, fan } };
    },
  );
};
