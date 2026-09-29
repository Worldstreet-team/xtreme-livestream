import { xtreamBattleChange } from "../xtream-events.js";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import mongoose from "mongoose";
import { z } from "zod";
import { GIFT_IDS, giftFilterSchema, streamIdParamsSchema } from "@xtreme/contracts";
import type { FastifyRequest } from "fastify";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { Battle, Stream, User, type IBattle } from "../models.js";
import { previewAccess } from "../preview.js";
import { atLeast, roleIn } from "../safety/roles.js";
import { practiceGiftDef } from "../practice-battle.js";
import {
  ACTIVITY_LIMIT,
  battleActivity,
  currentBattleForStream,
  endLap,
  fanOutBattle,
  inQuickMatch,
  inviteToBattle,
  lapOpen,
  leaveQuickMatch,
  practiceActivity,
  quickMatch,
  recentResultForStream,
  recordPracticeGift,
  scheduleBattle,
  settleBattle,
  stagePartner,
  startBattle,
  startPracticeBattle,
  toBattleView,
  upcomingBattles,
} from "../battles.js";

// Candidates for @xtreme/contracts once the client SDK adopts battles.
/** What the loser does on the victory lap ("sings a song"), if anything. */
const forfeitSchema = z.string().trim().max(60).default("");
/** 1v1, or 2v2: each side is its stream and the partner on its stage. */
const modeSchema = z.enum(["1v1", "2v2"]).default("1v1");
const inviteBodySchema = z.object({
  /** The creator to challenge — must be live right now. */
  challengerUsername: z.string().trim().min(1).max(60),
  forfeit: forfeitSchema,
  mode: modeSchema,
  /** Only these catalog gifts count toward the score; left out, every gift does. */
  giftFilter: giftFilterSchema,
});
const scheduleBodySchema = z.object({
  challengerUsername: z.string().trim().min(1).max(60),
  /** ISO time; at least five minutes out, at most two weeks. */
  scheduledAt: z.string().min(10).max(40),
  forfeit: forfeitSchema,
  mode: modeSchema,
  giftFilter: giftFilterSchema,
});
/** Quick match takes no gift filter: every gift counts in one. */
const quickBodySchema = z.object({ mode: modeSchema }).optional();

/** A 2v2 needs a partner on this stream's stage — a guest, or a creator brought over by co-live. */
async function requirePartner(streamId: mongoose.Types.ObjectId, message: string) {
  if (!(await stagePartner(streamId))) throw new ApiError(409, message, "PARTNER_MISSING");
}
const battleIdParamsSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid battle id"),
});
const activityQuerySchema = z.object({
  /** ISO time of the newest gift already seen; only newer gifts come back. */
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(ACTIVITY_LIMIT).optional(),
  /** A practice run's preview key (preview.ts): how a preview viewer sees its practice battle. */
  previewKey: z.string().max(128).optional(),
});
const previewQuerySchema = z.object({ previewKey: z.string().max(128).optional() });
/** A test gift in a practice battle: any catalog gift, by id. Simulated — nobody is charged. */
const practiceGiftBodySchema = z.object({ giftId: z.enum(GIFT_IDS) });

/**
 * A practice battle is as private as the practice run it's in: its host and
 * their producers see it, and so does anyone holding the run's preview
 * link. Everyone else gets the 404 a battle that doesn't exist would.
 */
/** Either side's host, or a producer on either host's crew: who may run a battle's lap. */
async function mayRunSide(battle: Pick<IBattle, "hostId" | "challengerId" | "practice">, userId: mongoose.Types.ObjectId) {
  if (battle.hostId.equals(userId) || (!battle.practice && battle.challengerId.equals(userId))) return true;
  const ids = battle.practice ? [battle.hostId] : [battle.hostId, battle.challengerId];
  const hosts = await User.find({ _id: { $in: ids } }).select("safety").lean();
  return hosts.some((h) => atLeast(roleIn(h, userId), "producer"));
}

async function assertMaySeePractice(request: FastifyRequest, battle: Pick<IBattle, "practice" | "hostId" | "hostStreamId">, previewKey: string | undefined) {
  if (!battle.practice) return;
  if (await previewAccess(battle.hostStreamId, previewKey)) return;
  const viewer = getOptionalAuthUserId(request) ? await authenticate(request).catch(() => null) : null;
  const host = viewer ? await User.findById(battle.hostId).select("safety").lean() : null;
  if (viewer && host && atLeast(roleIn(host, viewer.dbUser._id), "producer")) return;
  throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
}

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
      const hostStream = await Stream.findOne({ streamerId: dbUser._id, isLive: true, practice: { $ne: true } });
      if (!hostStream) throw new ApiError(400, "Go live before you challenge anyone", "NOT_LIVE");

      const challenger = await User.findOne({ username: request.body.challengerUsername.toLowerCase() }).select("_id username");
      if (!challenger) throw new ApiError(404, "No creator by that name", "USER_NOT_FOUND");
      if (challenger._id.equals(dbUser._id)) throw new ApiError(400, "You can't battle yourself", "SELF_BATTLE");
      const challengerStream = await Stream.findOne({ streamerId: challenger._id, isLive: true, practice: { $ne: true } });
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
      if (request.body.mode === "2v2") {
        await requirePartner(hostStream._id as mongoose.Types.ObjectId, "Bring your partner on stage first — a 2v2 is you and a guest against another pair");
      }

      const battle = await inviteToBattle(
        { _id: dbUser._id, username: dbUser.username, displayName: dbUser.displayName },
        hostStream,
        challengerStream,
        request.body.forfeit,
        request.body.mode,
        request.body.giftFilter,
      );
      // An invite out means not waiting for a stranger any more.
      await leaveQuickMatch(dbUser._id);
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/practice",
    {
      schema: {
        tags: ["Battles"],
        summary: "Start a practice battle: 90 seconds against a sparring partner, in a practice run — simulated, nobody sees it, no money moves",
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findOne({ streamerId: dbUser._id, isLive: true });
      if (!stream || !stream.practice) {
        throw new ApiError(409, "Practice battles run in a practice run — start one from the studio", "NOT_PRACTICE");
      }
      const busy = await Battle.exists({
        status: { $in: ["invited", "live", "overtime"] },
        $or: [{ hostStreamId: stream._id }, { challengerStreamId: stream._id }, { hostId: dbUser._id, practice: true }],
      });
      if (busy) throw new ApiError(409, "A battle is already running", "BATTLE_BUSY");
      const battle = await startPracticeBattle({ _id: dbUser._id }, stream);
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/practice-gift",
    {
      schema: {
        tags: ["Battles"],
        summary: "Send a test gift to your own side of a practice battle — simulated, never charged",
        security: [{ bearerAuth: [] }],
        params: battleIdParamsSchema,
        body: practiceGiftBodySchema,
      },
      config: { rateLimit: { max: 40, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      if (!battle.hostId.equals(dbUser._id)) throw new ApiError(403, "Only the host sends test gifts", "NOT_HOST");
      if (!battle.practice) throw new ApiError(409, "Test gifts are for practice battles", "NOT_PRACTICE");
      if (!["live", "overtime"].includes(battle.status)) throw new ApiError(409, "This battle is already over", "BATTLE_OVER");
      const gift = practiceGiftDef(request.body.giftId)!;
      const updated = await recordPracticeGift(battle, "host", gift, `${dbUser.displayName || dbUser.username} · test`);
      if (!updated) throw new ApiError(409, "This battle is already over", "BATTLE_OVER");
      return { success: true, data: { battle: await toBattleView(updated) } };
    },
  );

  app.post(
    "/battles/quick",
    {
      schema: {
        tags: ["Battles"],
        summary: "Quick match: battle whoever else is waiting for the same kind of battle, or wait for the next to ask",
        security: [{ bearerAuth: [] }],
        body: quickBodySchema,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const myStream = await Stream.findOne({ streamerId: dbUser._id, isLive: true, practice: { $ne: true } });
      if (!myStream) throw new ApiError(400, "Go live before you look for a battle", "NOT_LIVE");
      const busy = await Battle.exists({
        status: { $in: ["invited", "live", "overtime"] },
        $or: [{ hostStreamId: myStream._id }, { challengerStreamId: myStream._id }],
      });
      if (busy) throw new ApiError(409, "You're already in a battle or have an open invite", "BATTLE_BUSY");
      const mode = request.body?.mode ?? "1v1";
      if (mode === "2v2") {
        await requirePartner(myStream._id as mongoose.Types.ObjectId, "Bring your partner on stage first — a 2v2 is you and a guest against another pair");
      }
      const { battle, queued } = await quickMatch({ _id: dbUser._id }, myStream, mode);
      return { success: true, data: { battle: battle ? await toBattleView(battle) : null, queued } };
    },
  );

  app.delete(
    "/battles/quick",
    { schema: { tags: ["Battles"], summary: "Stop waiting for a quick match", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await leaveQuickMatch(dbUser._id);
      return { success: true, data: { queued: false } };
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
      if (battle.mode === "2v2") {
        await requirePartner(battle.challengerStreamId, "Bring a partner on stage to take on a 2v2");
        await requirePartner(battle.hostStreamId, "Their partner has left the stage — ask them to bring one back");
      }
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
      xtreamBattleChange(battle, "declined");
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/cancel",
    { schema: { tags: ["Battles"], summary: "Withdraw an invite, or end a battle early (no bonus) — a practice battle too", security: [{ bearerAuth: [] }], params: battleIdParamsSchema } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      if (!battle.hostId.equals(dbUser._id) && !battle.challengerId.equals(dbUser._id)) throw new ApiError(403, "Not your battle", "NOT_IN_BATTLE");
      if (!["scheduled", "invited", "live", "overtime"].includes(battle.status)) throw new ApiError(409, "This battle is already over", "BATTLE_OVER");
      const was = battle.status;
      if (battle.status === "scheduled") {
        battle.status = "cancelled";
        battle.endedReason = "cancelled";
        await battle.save();
      } else {
        await settleBattle(battle, "cancelled");
      }
      // A booking called off, or an invite taken back, reaches both creators; a running battle's end is battle.ended.
      if (was === "scheduled") xtreamBattleChange(battle, "cancelled");
      else if (was === "invited") xtreamBattleChange(battle, "withdrawn");
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/concede",
    {
      schema: {
        tags: ["Battles"],
        summary: "End a running battle now, as a loss: the other side wins, with the bonus a battle that ran its clock earns",
        security: [{ bearerAuth: [] }],
        params: battleIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      const side = battle.hostId.equals(dbUser._id) ? "host" : battle.challengerId.equals(dbUser._id) ? "challenger" : null;
      if (!side) throw new ApiError(403, "Not your battle", "NOT_IN_BATTLE");
      if (!["live", "overtime"].includes(battle.status)) throw new ApiError(409, "This battle is already over", "BATTLE_OVER");
      await settleBattle(battle, "conceded", { conceded: side });
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/end-lap",
    {
      schema: {
        tags: ["Battles"],
        summary: "End the victory lap early: the result comes down in both rooms — either side's host, or their producers",
        security: [{ bearerAuth: [] }],
        params: battleIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      if (!(await mayRunSide(battle, dbUser._id as mongoose.Types.ObjectId))) throw new ApiError(403, "Not your battle", "NOT_IN_BATTLE");
      if (!lapOpen(battle)) throw new ApiError(409, "The result is already down", "LAP_OVER");
      await endLap(battle);
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.post(
    "/battles/:id/rematch",
    {
      schema: {
        tags: ["Battles"],
        summary: "Ask for a rematch during the victory lap: the same opponent, clock, mode, forfeit and gifts — they still accept",
        security: [{ bearerAuth: [] }],
        params: battleIdParamsSchema,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const last = await Battle.findById(request.params.id);
      if (!last) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      const mine = last.hostId.equals(dbUser._id) ? "host" : last.challengerId.equals(dbUser._id) ? "challenger" : null;
      if (!mine) throw new ApiError(403, "Not your battle", "NOT_IN_BATTLE");
      if (!lapOpen(last)) throw new ApiError(409, "The victory lap is over — challenge them again from Battle", "LAP_OVER");

      // A practice battle's rematch is another round against the sparring partner.
      if (last.practice) {
        const stream = await Stream.findOne({ _id: last.hostStreamId, isLive: true });
        if (!stream?.practice) throw new ApiError(409, "Your practice run has ended", "STREAM_OFFLINE");
        const busy = await Battle.exists({
          status: { $in: ["invited", "live", "overtime"] },
          $or: [{ hostStreamId: stream._id }, { challengerStreamId: stream._id }, { hostId: dbUser._id, practice: true }],
        });
        if (busy) throw new ApiError(409, "A battle is already running", "BATTLE_BUSY");
        const battle = await startPracticeBattle({ _id: dbUser._id as mongoose.Types.ObjectId }, stream);
        return { success: true, data: { battle: await toBattleView(battle) } };
      }

      const [myStream, theirStream] = await Promise.all([
        Stream.findOne({ _id: mine === "host" ? last.hostStreamId : last.challengerStreamId, isLive: true, practice: { $ne: true } }),
        Stream.findOne({ _id: mine === "host" ? last.challengerStreamId : last.hostStreamId, isLive: true, practice: { $ne: true } }),
      ]);
      if (!myStream) throw new ApiError(409, "You're not live any more", "NOT_LIVE");
      if (!theirStream) throw new ApiError(409, "They've gone offline", "CHALLENGER_OFFLINE");
      const busy = await Battle.exists({
        status: { $in: ["invited", "live", "overtime"] },
        $or: [
          { hostStreamId: { $in: [myStream._id, theirStream._id] } },
          { challengerStreamId: { $in: [myStream._id, theirStream._id] } },
        ],
      });
      if (busy) throw new ApiError(409, "One of you is already in a battle or has an open invite", "BATTLE_BUSY");
      if (last.mode === "2v2") {
        await requirePartner(myStream._id as mongoose.Types.ObjectId, "Bring your partner back on stage for the rematch");
      }
      // The same terms, from whoever asked: they host it, the other side accepts.
      const battle = await inviteToBattle(
        { _id: dbUser._id as mongoose.Types.ObjectId, username: dbUser.username, displayName: dbUser.displayName },
        myStream,
        theirStream,
        last.forfeit ?? "",
        last.mode ?? "1v1",
        [...(last.giftFilter ?? [])],
        last.durationSec,
      );
      await leaveQuickMatch(dbUser._id as mongoose.Types.ObjectId);
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
        request.body.forfeit,
        request.body.mode,
        request.body.giftFilter,
      );
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.get(
    "/battles/upcoming",
    { schema: { tags: ["Battles"], summary: "Booked battles, soonest first" } },
    // Never a practice battle: upcomingBattles leaves them out.
    async () => ({ success: true, data: { battles: await Promise.all((await upcomingBattles()).map(toBattleView)) } }),
  );

  app.get(
    "/battles/live",
    { schema: { tags: ["Battles"], summary: "Battles happening right now, biggest pot first" } },
    async () => {
      // A practice battle is its host's alone: never listed.
      const battles = await Battle.find({ status: { $in: ["live", "overtime"] }, practice: { $ne: true } }).sort({ startsAt: -1 }).limit(20);
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
      return {
        success: true,
        data: { battles: await Promise.all(battles.map(toBattleView)), queued: await inQuickMatch(dbUser._id) },
      };
    },
  );

  app.get(
    "/battles/:id",
    { schema: { tags: ["Battles"], summary: "A battle's state, scores and clock", params: battleIdParamsSchema, querystring: previewQuerySchema } },
    async (request) => {
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      await assertMaySeePractice(request, battle, request.query.previewKey);
      return { success: true, data: { battle: await toBattleView(battle) } };
    },
  );

  app.get(
    "/battles/:id/activity",
    {
      schema: {
        tags: ["Battles"],
        summary: "A battle's state plus the gifts that counted since a time — what the clash view polls",
        params: battleIdParamsSchema,
        querystring: activityQuerySchema,
      },
    },
    async (request) => {
      const battle = await Battle.findById(request.params.id);
      if (!battle) throw new ApiError(404, "Battle not found", "BATTLE_NOT_FOUND");
      await assertMaySeePractice(request, battle, request.query.previewKey);
      const since = request.query.since ? new Date(request.query.since) : null;
      const [view, gifts] = await Promise.all([
        toBattleView(battle),
        battle.practice ? practiceActivity(battle, since, request.query.limit) : battleActivity(battle._id as mongoose.Types.ObjectId, since, request.query.limit),
      ]);
      return { success: true, data: { battle: view, gifts } };
    },
  );

  app.get(
    "/streams/:id/battle",
    {
      schema: {
        tags: ["Battles"],
        summary: "The battle this stream is in now, or the one it just finished",
        params: streamIdParamsSchema,
        querystring: previewQuerySchema,
      },
    },
    async (request) => {
      const id = new mongoose.Types.ObjectId(request.params.id);
      let battle = (await currentBattleForStream(id)) ?? (await recentResultForStream(id));
      // A practice run's battle is for its crew and its preview link; to anyone else there's none.
      if (battle?.practice) battle = await assertMaySeePractice(request, battle, request.query.previewKey).then(() => battle, () => null);
      return { success: true, data: { battle: battle ? await toBattleView(battle) : null } };
    },
  );
};
