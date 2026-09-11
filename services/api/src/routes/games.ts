import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import mongoose from "mongoose";
import { z } from "zod";
import { streamIdParamsSchema } from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { Game, GameEntry, PointsLedger, Stream, User } from "../models.js";
import {
  MAX_STAKE,
  MIN_STAKE,
  cancelGame,
  createGame,
  currentGameForStream,
  enterGame,
  liveGames,
  settleGame,
  toGameView,
} from "../games.js";
import { InsufficientPointsError, ensureWelcomeGrant } from "../points.js";
import { thumbnailUrlFor } from "../stream-service.js";
import { DAILY_REDEEM_CAP_POINTS, MIN_REDEEM_POINTS, POINTS_PER_USD, RedeemError, audit, redeemPoints } from "../rewards.js";
import { isTreasuryConfigured } from "../wallet.js";
import { Payout, type IPayout } from "../models.js";

function toPayoutView(p: IPayout) {
  return {
    id: String(p._id),
    kind: p.kind,
    points: p.points,
    usdMinor: p.usdMinor,
    status: p.status,
    createdAt: p.createdAt,
    paidAt: p.paidAt,
  };
}

// Candidates for @xtreme/contracts once the client SDK adopts games.
const createGameBodySchema = z
  .object({
    type: z.enum(["prediction", "raffle", "quiz"]).default("prediction"),
    question: z.string().trim().min(3).max(140),
    outcomes: z.array(z.string().trim().min(1).max(40)).max(4).default([]),
    /** How long entries stay open. */
    durationSec: z.number().int().min(30).max(600).default(120),
    /** Raffle: ticket cost in points, 0 for free. */
    ticketPoints: z.number().int().min(0).max(1000).default(0),
    /** Raffle: how many are drawn. */
    winnersCount: z.number().int().min(1).max(10).default(1),
    /** Raffle: added to the pot. Quiz: paid per correct answer. */
    prizePoints: z.number().int().min(0).max(10_000).default(0),
    /** Quiz: index of the right outcome. */
    correctIndex: z.number().int().min(0).max(3).nullable().default(null),
  })
  .refine((b) => b.type === "raffle" || b.outcomes.length >= 2, { message: "At least two outcomes", path: ["outcomes"] })
  .refine((b) => b.type !== "quiz" || (b.correctIndex !== null && b.correctIndex < b.outcomes.length), { message: "Mark the right answer", path: ["correctIndex"] });
const enterBodySchema = z.object({
  outcome: z.string().min(1).max(8).default("ticket"),
  stakePoints: z.number().int().min(0).max(MAX_STAKE).default(0),
});
const settleBodySchema = z.object({ winningOutcome: z.string().min(1).max(8).optional() });
const gameIdParamsSchema = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i, "Invalid game id") });

export const gameRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/streams/:id/games",
    {
      schema: { tags: ["Games"], summary: "Open a prediction, raffle or quiz in your live stream", security: [{ bearerAuth: [] }], params: streamIdParamsSchema, body: createGameBodySchema },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      if (!stream.streamerId.equals(dbUser._id)) throw new ApiError(403, "Only the host can start a game", "NOT_HOST");
      if (!stream.isLive) throw new ApiError(400, "Go live first", "NOT_LIVE");
      if (await Game.exists({ streamId: stream._id, status: { $in: ["open", "locked"] } })) {
        throw new ApiError(409, "Settle the running game before starting another", "GAME_RUNNING");
      }
      const game = await createGame(stream, dbUser._id, request.body);
      return { success: true, data: { game: await toGameView(game) } };
    },
  );

  app.get(
    "/streams/:id/games/current",
    { schema: { tags: ["Games"], summary: "The game running in this stream, with the caller's entry if any", params: streamIdParamsSchema } },
    async (request) => {
      const game = await currentGameForStream(request.params.id);
      if (!game) return { success: true, data: { game: null } };
      const authUserId = getOptionalAuthUserId(request);
      let mine: { outcome: string; stakePoints: number; wonPoints: number } | null = null;
      if (authUserId) {
        const user = await User.findOne({ authUserId }).select("_id").lean();
        if (user) {
          const e = await GameEntry.findOne({ gameId: game._id, userId: user._id }).lean();
          if (e) mine = { outcome: e.outcome, stakePoints: e.stakePoints, wonPoints: e.wonPoints };
        }
      }
      return { success: true, data: { game: await toGameView(game, mine) } };
    },
  );

  app.get(
    "/games/live",
    { schema: { tags: ["Games"], summary: "Games with an open or locked window right now, with their streams" } },
    async () => {
      const games = await liveGames(12);
      const streams = await Stream.find({ _id: { $in: games.map((g) => g.streamId) } })
        .select("-thumbnail")
        .populate("streamerId", "username displayName avatar")
        .lean();
      const byId = new Map(streams.map((s) => [String(s._id), s]));
      const items = [];
      for (const g of games) {
        const s = byId.get(String(g.streamId));
        if (!s) continue;
        const streamer = s.streamerId as unknown as { username: string; displayName: string; avatar: string };
        items.push({
          game: await toGameView(g),
          stream: {
            id: String(s._id),
            title: s.title,
            category: s.category,
            viewers: s.viewers,
            thumbnailUrl: thumbnailUrlFor(s as { _id: unknown; thumbnail?: string; thumbnailVersion?: number }),
            streamer: { username: streamer.username, displayName: streamer.displayName, avatar: streamer.avatar },
          },
        });
      }
      return { success: true, data: { items } };
    },
  );

  app.post(
    "/games/:id/enter",
    {
      schema: { tags: ["Games"], summary: "Enter: stake on an outcome, buy a ticket, or answer", security: [{ bearerAuth: [] }], params: gameIdParamsSchema, body: enterBodySchema },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const game = await Game.findById(request.params.id);
      if (!game) throw new ApiError(404, "Game not found", "GAME_NOT_FOUND");
      if (game.hostId.equals(dbUser._id)) throw new ApiError(400, "The host can't play their own game", "HOST_ENTRY");
      if (game.type === "prediction" && (request.body.stakePoints < MIN_STAKE || request.body.stakePoints > MAX_STAKE)) {
        throw new ApiError(400, `Stake between ${MIN_STAKE} and ${MAX_STAKE} points`, "BAD_STAKE");
      }
      try {
        const entry = await enterGame(game, dbUser._id, request.body.outcome, request.body.stakePoints);
        const fresh = await Game.findById(game._id);
        const balance = (await User.findById(dbUser._id).select("pointsBalance").lean())?.pointsBalance ?? 0;
        return {
          success: true,
          data: {
            game: await toGameView(fresh ?? game, { outcome: entry.outcome, stakePoints: entry.stakePoints, wonPoints: 0 }),
            pointsBalance: balance,
          },
        };
      } catch (error) {
        if (error instanceof InsufficientPointsError) throw new ApiError(402, "Not enough points for that", "INSUFFICIENT_POINTS");
        const code = error instanceof Error ? error.message : "";
        if (code === "CLOSED") throw new ApiError(409, "Entries are closed", "GAME_CLOSED");
        if (code === "ALREADY_IN") throw new ApiError(409, "You're already in — one entry per game", "ALREADY_ENTERED");
        if (code === "BAD_OUTCOME") throw new ApiError(400, "That outcome doesn't exist", "BAD_OUTCOME");
        throw error;
      }
    },
  );

  app.post(
    "/games/:id/settle",
    { schema: { tags: ["Games"], summary: "Settle: declare the outcome, draw the raffle, or reveal the quiz", security: [{ bearerAuth: [] }], params: gameIdParamsSchema, body: settleBodySchema } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const game = await Game.findById(request.params.id);
      if (!game) throw new ApiError(404, "Game not found", "GAME_NOT_FOUND");
      if (!game.hostId.equals(dbUser._id)) throw new ApiError(403, "Only the host settles", "NOT_HOST");
      try {
        await settleGame(game, request.body.winningOutcome ?? null);
        await audit(dbUser._id, "game.settle", "game", game._id as mongoose.Types.ObjectId, { type: game.type, winningOutcome: game.winningOutcome, poolPoints: game.poolPoints, entries: game.entries });
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "NOT_SETTLEABLE") throw new ApiError(409, "This game is already settled", "GAME_SETTLED");
        if (code === "BAD_OUTCOME") throw new ApiError(400, "Pick the outcome that happened", "BAD_OUTCOME");
        throw error;
      }
      return { success: true, data: { game: await toGameView(game) } };
    },
  );

  app.post(
    "/games/:id/cancel",
    { schema: { tags: ["Games"], summary: "Cancel a game and refund every stake and ticket", security: [{ bearerAuth: [] }], params: gameIdParamsSchema } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const game = await Game.findById(request.params.id);
      if (!game) throw new ApiError(404, "Game not found", "GAME_NOT_FOUND");
      if (!game.hostId.equals(dbUser._id)) throw new ApiError(403, "Only the host cancels", "NOT_HOST");
      try {
        await cancelGame(game);
        await audit(dbUser._id, "game.cancel", "game", game._id as mongoose.Types.ObjectId, { type: game.type, entries: game.entries });
      } catch {
        throw new ApiError(409, "This game is already over", "GAME_OVER");
      }
      return { success: true, data: { game: await toGameView(game) } };
    },
  );

  app.get(
    "/user/me/points",
    { schema: { tags: ["Games"], summary: "Your points balance and recent ledger", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const granted = await ensureWelcomeGrant(dbUser._id);
      const user = await User.findById(dbUser._id).select("pointsBalance watchStreakDays").lean();
      const ledger = await PointsLedger.find({ userId: dbUser._id }).sort({ createdAt: -1 }).limit(20).lean();
      return {
        success: true,
        data: {
          balance: user?.pointsBalance ?? 0,
          streakDays: user?.watchStreakDays ?? 0,
          welcomed: granted !== null,
          ledger: ledger.map((l) => ({ delta: l.delta, balanceAfter: l.balanceAfter, reason: l.reason, at: l.createdAt })),
        },
      };
    },
  );

  app.post(
    "/user/me/points/redeem",
    {
      schema: { tags: ["Games"], summary: "Turn points into wallet money (1,000 pts = $1)", security: [{ bearerAuth: [] }], body: z.object({ points: z.number().int().min(1).max(1_000_000) }) },
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      try {
        const payout = await redeemPoints({ _id: dbUser._id, createdAt: dbUser.createdAt }, request.body.points);
        const balance = (await User.findById(dbUser._id).select("pointsBalance").lean())?.pointsBalance ?? 0;
        return { success: true, data: { payout: toPayoutView(payout), pointsBalance: balance } };
      } catch (error) {
        if (error instanceof RedeemError) {
          const status = error.code === "INSUFFICIENT" ? 402 : 400;
          throw new ApiError(status, error.message, error.code);
        }
        throw error;
      }
    },
  );

  app.get(
    "/user/me/payouts",
    { schema: { tags: ["Games"], summary: "Your payouts — redemptions and battle bonuses — and the rules", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const payouts = await Payout.find({ userId: dbUser._id }).sort({ createdAt: -1 }).limit(20);
      return {
        success: true,
        data: {
          payouts: payouts.map(toPayoutView),
          rules: { pointsPerUsd: POINTS_PER_USD, minPoints: MIN_REDEEM_POINTS, dailyCapPoints: DAILY_REDEEM_CAP_POINTS, minAccountAgeDays: 7, treasuryReady: isTreasuryConfigured() },
        },
      };
    },
  );

  app.get(
    "/games/leaderboard",
    { schema: { tags: ["Games"], summary: "Top players by points won this week" } },
    async () => {
      const top = await GameEntry.aggregate<{ _id: mongoose.Types.ObjectId; won: number; games: number }>([
        { $match: { wonPoints: { $gt: 0 }, updatedAt: { $gte: new Date(Date.now() - 7 * 86_400_000) } } },
        { $group: { _id: "$userId", won: { $sum: "$wonPoints" }, games: { $sum: 1 } } },
        { $sort: { won: -1 } },
        { $limit: 5 },
      ]);
      const users = await User.find({ _id: { $in: top.map((t) => t._id) } }).select("username displayName avatar verified").lean();
      const byId = new Map(users.map((u) => [String(u._id), u]));
      return {
        success: true,
        data: {
          top: top.map((t) => {
            const u = byId.get(String(t._id));
            return { userId: String(t._id), username: u?.username ?? "", displayName: u?.displayName ?? u?.username ?? "Player", avatar: u?.avatar ?? "", verified: Boolean(u?.verified), won: t.won, games: t.games };
          }),
        },
      };
    },
  );
};
