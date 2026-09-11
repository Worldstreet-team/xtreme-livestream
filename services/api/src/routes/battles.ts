import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import mongoose from "mongoose";
import { z } from "zod";
import { streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Battle, Stream, User } from "../models.js";
import {
  currentBattleForStream,
  fanOutBattle,
  inviteToBattle,
  recentResultForStream,
  scheduleBattle,
  settleBattle,
  startBattle,
  toBattleView,
  upcomingBattles,
} from "../battles.js";

// Candidates for @xtreme/contracts once the client SDK adopts battles.
const inviteBodySchema = z.object({
  /** The creator to challenge — must be live right now. */
  challengerUsername: z.string().trim().min(1).max(60),
});
const scheduleBodySchema = z.object({
  challengerUsername: z.string().trim().min(1).max(60),
  /** ISO time; at least five minutes out, at most two weeks. */
  scheduledAt: z.string().min(10).max(40),
});
const battleIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid battle id"),
});

export const battleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/battles/invite",
    {
      schema: {
        tags: ["Battles"],
        summary: "Challenge another live creator to a battle",
        security: [{ bearerAuth: [] }],
        body: inviteBodySchema,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const hostStream = await Stream.findOne({ streamerId: dbUser._id, isLive: true });
      if (!hostStream) throw new ApiError(400, "Go live before you challenge anyone", "NOT_LIVE");

      const challenger = await User.findOne({ username: request.body.challengerUsername.toLowerCase() }).select("_id username");
      if (!challenger) throw new ApiError(404, "No creator by that name", "USER_NOT_FOUND");
      if (challenger._id.equals(dbUser._id)) throw new ApiError(400, "You can't battle yourself", "SELF_BATTLE");
      const challengerStream = await Stream.findOne({ streamerId: challenger._id, isLive: true });
      if (!challengerStream) throw new ApiError(400, "That creator isn't live right now", "CHALLENGER_OFFLINE");

      // One battle per stream at a time, on either side, in any open state.
      const busy = await Battle.exists({
        status: { $in: ["invited", "live", "overtime"] },
        $or: [
          { hostStreamId: { $in: [hostStream._id, challengerStream._id] } },
          { challengerStreamId: { $in: [hostStream._id, challengerStream._id] } },
        ],
      });
      if (busy) throw new ApiError(409, "One of you is already in a battle or has an open invite", "BATTLE_BUSY");

      const battle = await inviteToBattle(
        { _id: dbUser._id, username: dbUser.username, displayName: dbUser.displayName },
        hostStream,
        challengerStream,
      );
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/accept",
    { schema: { tags: ["Battles"], summary: "Accept a battle invite — the clock starts now", security: [{ bearerAuth: [] }], params: battleIdParamsSchema } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      if (!battle.challengerId.equals(dbUser._id)) throw new ApiError(403, "This invite isn't yours", "NOT_CHALLENGER");
      if (battle.status !== "invited") throw new ApiError(409, "This invite is no longer open", "BATTLE_NOT_OPEN");
      const live = await Stream.countDocuments({ _id: { $in: [battle.hostStreamId, battle.challengerStreamId] }, isLive: true });
      if (live !== 2) throw new ApiError(409, "One of the streams has ended", "STREAM_OFFLINE");
      await startBattle(battle);
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/decline",
    { schema: { tags: ["Battles"], summary: "Decline a battle invite", security: [{ bearerAuth: [] }], params: battleIdParamsSchema } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      if (!battle.challengerId.equals(dbUser._id)) throw new ApiError(403, "This invite isn't yours", "NOT_CHALLENGER");
      if (battle.status !== "invited") throw new ApiError(409, "This invite is no longer open", "BATTLE_NOT_OPEN");
      battle.status = "cancelled";
      battle.endedReason = "declined";
      await battle.save();
      await fanOutBattle(battle);
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/cancel",
    { schema: { tags: ["Battles"], summary: "Withdraw an invite, or end a battle early (no bonus)", security: [{ bearerAuth: [] }], params: battleIdParamsSchema } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      if (!battle.hostId.equals(dbUser._id) && !battle.challengerId.equals(dbUser._id)) throw new ApiError(403, "Not your battle", "NOT_IN_BATTLE");
      if (!["scheduled", "invited", "live", "overtime"].includes(battle.status)) throw new ApiError(409, "This battle is already over", "BATTLE_OVER");
      if (battle.status === "scheduled") {
        battle.status = "cancelled";
        battle.endedReason = "cancelled";
        await battle.save();
      } else {
        await settleBattle(battle, "cancelled");
      }
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/schedule",
    {
      schema: { tags: ["Battles"], summary: "Book a battle for later — it starts by itself when both are live", security: [{ bearerAuth: [] }], body: scheduleBodySchema },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const challenger = await User.findOne({ username: request.body.challengerUsername.toLowerCase() }).select("_id username displayName");
      if (!challenger) throw new ApiError(404, "No creator by that name", "USER_NOT_FOUND");
      if (challenger._id.equals(dbUser._id)) throw new ApiError(400, "You can't battle yourself", "SELF_BATTLE");
      const at = new Date(request.body.scheduledAt);
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 5 * 60_000) throw new ApiError(400, "Pick a time at least five minutes from now", "BAD_TIME");
      if (at.getTime() > Date.now() + 14 * 86_400_000) throw new ApiError(400, "Two weeks ahead at most", "BAD_TIME");
      const battle = await scheduleBattle(
        { _id: dbUser._id, username: dbUser.username, displayName: dbUser.displayName },
        { _id: challenger._id, username: challenger.username, displayName: challenger.displayName },
        at,
      );
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.get(
    "/battles/upcoming",
    { schema: { tags: ["Battles"], summary: "Booked battles, soonest first" } },
    async () => ({ success: true, data: { battles: await Promise.all((await upcomingBattles()).map(toBattleView)) } }),
  );

  app.get(
    "/battles/live",
    { schema: { tags: ["Battles"], summary: "Battles happening right now, biggest pot first" } },
    async () => {
      const battles = await Battle.find({ status: { $in: ["live", "overtime"] } }).sort({ startsAt: -1 }).limit(20);
      const views = await Promise.all(battles.map(toBattleView));
      views.sort((a, b) => b.host.usdMinor + b.challenger.usdMinor - (a.host.usdMinor + a.challenger.usdMinor));
      return { success: true, data: { battles: views } };
    },
  );

  app.get(
    "/battles/mine",
    { schema: { tags: ["Battles"], summary: "Open invites and the live battle involving the caller", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battles = await Battle.find({
        status: { $in: ["scheduled", "invited", "live", "overtime"] },
        $or: [{ hostId: dbUser._id }, { challengerId: dbUser._id }],
      }).sort({ invitedAt: -1 });
      return { success: true, data: { battles: await Promise.all(battles.map(toBattleView)) } };
    },
  );

  app.get(
    "/battles/:id",
    { schema: { tags: ["Battles"], summary: "A battle's state, scores and clock", params: battleIdParamsSchema } },
    async (request) => {
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.get(
    "/streams/:id/battle",
    { schema: { tags: ["Battles"], summary: "The battle this stream is in now, or the one it just finished", params: streamIdParamsSchema } },
    async (request) => {
      const id = new mongoose.Types.ObjectId(request.params.id);
      const battle = (await currentBattleForStream(id)) ?? (await recentResultForStream(id));
      return { success: true, data: { battle: battle ? await toBattleView(battle) : null } };
    },
  );
};
