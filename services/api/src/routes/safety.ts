import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import mongoose from "mongoose";
import {
  addModBodySchema,
  channelModParamsSchema,
  channelParamsSchema,
  chatMessageParamsSchema,
  DEFAULT_FILTER_LEVELS,
  FILTER_CATEGORIES,
  safetySettingsBodySchema,
  shieldBodySchema,
  slowModeBodySchema,
  streamIdParamsSchema,
} from "@xtreme/contracts";
import { audit } from "../audit.js";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { CHAT_SLOW_MODE_SECONDS, chatPayload } from "../chat.js";
import { ApiError } from "../errors.js";
import { sendRoomData, sendRoomDataTo } from "../livekit.js";
import { ChatMessage, Notification, Stream, User, type IStream, type IUser } from "../models.js";
import { HELD_REASON_LABELS, type FilterVerdict } from "../safety/filter.js";
import { atLeast, moderatorIdentities, requireChannelRole, roleIn } from "../safety/roles.js";
import { fanStatus } from "../fans.js";
import { pushNotifications } from "../xtream-events.js";

/**
 * The safety kit's routes: who you are in a room, the channel's filter and
 * moderators, Shield and slow mode, the held-line queue, and the queue of
 * lines moderators suggest for the screen. Every action lands in the audit
 * log. (Delete, ban, pin and feature live in moderation.ts, on the same
 * roles.)
 */

const MAX_MODS = 50;

const oid = (v: unknown) => new mongoose.Types.ObjectId(String(v));

/** The channel's safety settings as its creator sees them. */
function safetyView(user: Pick<IUser, "settings" | "safety">) {
  const s = user.safety;
  return {
    profanityFilter: user.settings?.profanityFilter ?? true,
    filters: Object.fromEntries(FILTER_CATEGORIES.map((c) => [c, s?.filters?.[c] ?? DEFAULT_FILTER_LEVELS[c]])),
    blockedTerms: s?.blockedTerms ?? [],
    blockedTermsLevel: s?.blockedTermsLevel ?? "block",
    modsCanFeature: s?.modsCanFeature ?? "suggest",
    evasion: s?.evasion ?? "flag",
  };
}

/** A channel's moderators, with the faces and names to show them by. */
async function modsView(user: Pick<IUser, "safety">) {
  const mods = user.safety?.mods ?? [];
  if (mods.length === 0) return [];
  const people = await User.find({ _id: { $in: mods.map((m) => m.userId) } })
    .select("username displayName avatar")
    .lean();
  const byId = new Map(people.map((p) => [String(p._id), p]));
  return mods.map((m) => {
    const p = byId.get(String(m.userId));
    return {
      userId: String(m.userId),
      username: p?.username ?? m.username,
      displayName: p?.displayName ?? m.username,
      avatar: p?.avatar ?? "",
      role: m.role,
      addedAt: m.addedAt,
    };
  });
}

/** A held line as moderators see it: the line, and what held it. */
export function heldView(message: Parameters<typeof chatPayload>[0] & { heldReason?: string; createdAt?: Date }) {
  const reason = (message.heldReason || "custom") as FilterVerdict["category"];
  return {
    ...chatPayload(message),
    heldReason: reason,
    heldLabel: HELD_REASON_LABELS[reason] ?? "Held",
    at: message.createdAt ? new Date(message.createdAt).getTime() : Date.now(),
  };
}

/** The feature queue as the host and moderators see it. */
export function featureQueueView(queue: IStream["featureQueue"] | undefined) {
  return (queue ?? []).map((q) => ({
    messageId: String(q.messageId),
    username: q.username,
    text: q.text,
    kind: q.kind,
    suggestedBy: q.suggestedBy,
    at: q.at,
  }));
}

async function loadStream(id: string) {
  const stream = await Stream.findById(id);
  if (!stream) {
    throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
  }
  return stream;
}

export const safetyRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ── Who you are in a room ─────────────────────────────────────────── */

  app.get(
    "/streams/:id/role",
    {
      schema: {
        tags: ["Safety"],
        summary: "Your role in this stream's room (host, lead, mod — or none), and the room's live rules",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id).select("streamerId shield").lean();
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      const streamer = await User.findById(stream.streamerId).select("safety settings").lean();
      const signedIn = getOptionalAuthUserId(request) ? await authenticate(request) : null;
      const role = signedIn && streamer ? roleIn(streamer, signedIn.dbUser._id) : null;
      return {
        success: true,
        data: {
          role,
          shield: Boolean(stream.shield?.on),
          slowMode: Boolean(streamer?.settings?.slowMode),
          followersOnly: Boolean(streamer?.settings?.subscriberOnly),
          // Only a moderator needs to know how far their screen button goes.
          modsCanFeature: role && role !== "host" ? (streamer?.safety?.modsCanFeature ?? "suggest") : undefined,
        },
      };
    },
  );

  /* ── Your channel's filter ─────────────────────────────────────────── */

  app.get(
    "/users/me/safety",
    {
      schema: { tags: ["Safety"], summary: "Your channel's chat filter and moderators", security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      return { success: true, data: { safety: safetyView(dbUser), mods: await modsView(dbUser) } };
    },
  );

  app.patch(
    "/users/me/safety",
    {
      schema: {
        tags: ["Safety"],
        summary: "Change your chat filter's levels, your blocked terms, or what moderators may put on screen",
        security: [{ bearerAuth: [] }],
        body: safetySettingsBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const body = request.body;
      const set: Record<string, unknown> = {};
      for (const [category, level] of Object.entries(body.filters ?? {})) {
        if (level) set[`safety.filters.${category}`] = level;
      }
      if (body.blockedTerms) set["safety.blockedTerms"] = [...new Set(body.blockedTerms)];
      if (body.blockedTermsLevel) set["safety.blockedTermsLevel"] = body.blockedTermsLevel;
      if (body.modsCanFeature) set["safety.modsCanFeature"] = body.modsCanFeature;
      if (body.evasion) set["safety.evasion"] = body.evasion;
      const updated = await User.findByIdAndUpdate(dbUser._id, { $set: set }, { new: true });
      await audit(dbUser._id, "safety.update", "user", dbUser._id, { changes: Object.keys(set) });
      return { success: true, data: { safety: safetyView(updated ?? dbUser) } };
    },
  );

  /* ── Moderators ────────────────────────────────────────────────────── */

  app.get(
    "/channels/:id/mods",
    {
      schema: {
        tags: ["Safety"],
        summary: "A channel's moderators (its host and moderators only)",
        security: [{ bearerAuth: [] }],
        params: channelParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const channel = await User.findById(request.params.id).select("safety");
      if (!channel) throw new ApiError(404, "Channel not found", "USER_NOT_FOUND");
      if (!roleIn(channel, dbUser._id)) throw new ApiError(403, "Only the host and moderators can see this", "FORBIDDEN");
      return { success: true, data: { mods: await modsView(channel) } };
    },
  );

  app.post(
    "/channels/:id/mods",
    {
      schema: {
        tags: ["Safety"],
        summary: "Make someone a moderator (the host; a lead can add moderators)",
        security: [{ bearerAuth: [] }],
        params: channelParamsSchema,
        body: addModBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const channel = await User.findById(request.params.id).select("username displayName safety");
      if (!channel) throw new ApiError(404, "Channel not found", "USER_NOT_FOUND");
      const role = roleIn(channel, dbUser._id);
      const { username, role: newRole } = request.body;
      if (!atLeast(role, "lead")) throw new ApiError(403, "Only the host and lead moderators can add moderators", "FORBIDDEN");
      if (role !== "host" && newRole !== "mod") {
        throw new ApiError(403, newRole === "producer" ? "Only the host appoints producers" : "Only the host appoints lead moderators", "FORBIDDEN");
      }

      const person = await User.findOne({ username }).select("username displayName");
      if (!person) throw new ApiError(404, `There's nobody called @${username}`, "USER_NOT_FOUND");
      if (person._id.equals(channel._id)) throw new ApiError(400, "That's the host — they can already do everything", "IS_HOST");

      const mods = channel.safety?.mods ?? [];
      const existing = mods.find((m) => m.userId.equals(person._id));
      const was = existing?.role ?? null;
      if (existing) {
        if (role !== "host" && existing.role !== "mod") {
          throw new ApiError(403, existing.role === "producer" ? "Only the host changes a producer" : "Only the host changes a lead moderator", "FORBIDDEN");
        }
        existing.role = newRole;
      } else {
        if (mods.length >= MAX_MODS) throw new ApiError(400, `A channel can have up to ${MAX_MODS} moderators`, "TOO_MANY_MODS");
        mods.push({ userId: person._id, username: person.username, role: newRole, addedAt: new Date() });
      }
      channel.set("safety.mods", mods);
      await channel.save();

      await audit(dbUser._id, existing ? "mods.role" : "mods.add", "user", channel._id, { userId: String(person._id), role: newRole });
      // Told when they join the team, and when they're made a producer —
      // who gets the way into the channel's console.
      if (!existing || (newRole === "producer" && was !== "producer")) {
        await Notification.create({
          userId: person._id,
          type: "mod_added",
          actorId: channel._id,
          actorName: channel.displayName || channel.username,
          streamId: null,
          streamTitle: newRole === "producer" ? "producer" : newRole === "lead" ? "lead moderator" : "moderator",
          link: newRole === "producer" ? `/produce/${channel.username}` : `/c/${channel.username}`,
        }).then(pushNotifications, () => {});
      }
      // Live now? Their chat grows the tools at once.
      const live = await Stream.findOne({ streamerId: channel._id, isLive: true }).select("livekitRoomName").lean();
      if (live) void sendRoomDataTo(live.livekitRoomName, [String(person._id)], { __evt: "role", role: newRole });

      return { success: true, data: { mods: await modsView(channel) } };
    },
  );

  app.delete(
    "/channels/:id/mods/:userId",
    {
      schema: {
        tags: ["Safety"],
        summary: "Remove a moderator (the host; a lead removes moderators; anyone can step down)",
        security: [{ bearerAuth: [] }],
        params: channelModParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const channel = await User.findById(request.params.id).select("safety");
      if (!channel) throw new ApiError(404, "Channel not found", "USER_NOT_FOUND");
      const role = roleIn(channel, dbUser._id);
      const mods = channel.safety?.mods ?? [];
      const target = mods.find((m) => String(m.userId) === request.params.userId);
      if (!target) return { success: true, data: { mods: await modsView(channel) } };
      const self = request.params.userId === String(dbUser._id);
      const allowed = self || role === "host" || (role === "lead" && target.role === "mod");
      if (!allowed) throw new ApiError(403, "You can't remove that moderator", "FORBIDDEN");

      channel.set(
        "safety.mods",
        mods.filter((m) => String(m.userId) !== request.params.userId),
      );
      await channel.save();
      await audit(dbUser._id, self ? "mods.step_down" : "mods.remove", "user", channel._id, { userId: request.params.userId });
      const live = await Stream.findOne({ streamerId: channel._id, isLive: true }).select("livekitRoomName").lean();
      if (live) void sendRoomDataTo(live.livekitRoomName, [request.params.userId], { __evt: "role", role: null });

      return { success: true, data: { mods: await modsView(channel) } };
    },
  );

  /* ── Live rules: Shield and slow mode ──────────────────────────────── */

  app.post(
    "/streams/:id/shield",
    {
      schema: {
        tags: ["Safety"],
        summary: "Raise or lower Shield: allies only, slow mode, links and scams blocked, new accounts held",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: shieldBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "lead");
      if (!stream.isLive) throw new ApiError(409, "Go live first", "NOT_LIVE");

      const on = request.body.on;
      stream.shield = { on, at: new Date(), by: dbUser._id };
      await stream.save();
      void sendRoomData(stream.livekitRoomName, { __evt: "shield", on, slowSeconds: CHAT_SLOW_MODE_SECONDS });
      await audit(dbUser._id, on ? "chat.shield_on" : "chat.shield_off", "stream", stream._id);
      return { success: true, data: { shield: on } };
    },
  );

  app.post(
    "/streams/:id/slowmode",
    {
      schema: {
        tags: ["Safety"],
        summary: "Turn slow mode on or off for the room (host and moderators)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: slowModeBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer } = await requireChannelRole(stream, dbUser._id, "mod");
      const enabled = request.body.enabled;
      await User.updateOne({ _id: streamer._id }, { $set: { "settings.slowMode": enabled } });
      void sendRoomData(stream.livekitRoomName, { __evt: "slowmode", enabled });
      await audit(dbUser._id, enabled ? "chat.slow_on" : "chat.slow_off", "stream", stream._id);
      return { success: true, data: { slowMode: enabled } };
    },
  );

  /* ── Held lines ────────────────────────────────────────────────────── */

  app.get(
    "/streams/:id/chat/held",
    {
      schema: {
        tags: ["Safety"],
        summary: "Lines the filter is holding for review (host and moderators)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "mod");
      const held = await ChatMessage.find({ streamId: stream._id, status: "held" }).sort({ createdAt: 1 }).limit(100).lean();
      return { success: true, data: { held: held.map(heldView) } };
    },
  );

  app.post(
    "/streams/:id/chat/:messageId/approve",
    {
      schema: {
        tags: ["Safety"],
        summary: "Let a held line into the room (host and moderators)",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer } = await requireChannelRole(stream, dbUser._id, "mod");
      const message = await ChatMessage.findOneAndUpdate(
        { _id: request.params.messageId, streamId: stream._id, status: "held" },
        { $set: { status: "visible" } },
        { new: true },
      ).lean();
      if (!message) throw new ApiError(404, "That line isn't waiting any more", "NOT_HELD");

      const fan = await fanStatus(stream.streamerId, message.userId).catch(() => null);
      void sendRoomData(stream.livekitRoomName, chatPayload(message, fan));
      void sendRoomDataTo(stream.livekitRoomName, [...moderatorIdentities(streamer), String(message.userId)], {
        __evt: "held_resolved",
        messageId: String(message._id),
        outcome: "approved",
      });
      await audit(dbUser._id, "chat.approve", "chat", oid(message._id), { streamId: String(stream._id), reason: message.heldReason });
      return { success: true, data: { approved: true } };
    },
  );

  /* ── Lines moderators suggest for the screen ───────────────────────── */

  app.get(
    "/streams/:id/feature-queue",
    {
      schema: {
        tags: ["Safety"],
        summary: "Lines moderators suggested for the screen, waiting on the host",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      await requireChannelRole(stream, dbUser._id, "mod");
      return { success: true, data: { queue: featureQueueView(stream.featureQueue) } };
    },
  );

  app.delete(
    "/streams/:id/feature-queue/:messageId",
    {
      schema: {
        tags: ["Safety"],
        summary: "Host or producer: turn down a suggested line",
        security: [{ bearerAuth: [] }],
        params: chatMessageParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await loadStream(request.params.id);
      const { streamer } = await requireChannelRole(stream, dbUser._id, "producer");
      const updated = await Stream.findByIdAndUpdate(
        stream._id,
        { $pull: { featureQueue: { messageId: oid(request.params.messageId) } } },
        { new: true, select: "featureQueue livekitRoomName" },
      ).lean();
      const queue = featureQueueView(updated?.featureQueue);
      void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), { __evt: "feature_queue", queue });
      await audit(dbUser._id, "feature.dismiss", "chat", oid(request.params.messageId), { streamId: String(stream._id) });
      return { success: true, data: { queue } };
    },
  );
};
