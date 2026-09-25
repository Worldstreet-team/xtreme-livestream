import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { Payout, PointsLedger, User } from "../models.js";
import { ensureWelcomeGrant, DRIP_POINTS, STREAK_BASE, STREAK_CAP, STREAK_STEP } from "../points.js";
import { DAILY_REDEEM_CAP_POINTS, MIN_REDEEM_POINTS, POINTS_PER_USD } from "../rewards.js";
import { QuestError, claimQuest, levelFor, lifetimePoints, questViews, streakWeek } from "../quests.js";
import { isTreasuryConfigured } from "../wallet.js";

/**
 * The rewards page in one read, and the one write quests need. Redemption
 * keeps its own route (`/user/me/points/redeem` in games.ts) — the money
 * path is unchanged.
 */
export const rewardRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/user/me/rewards",
    {
      schema: {
        tags: ["Rewards"],
        summary: "Balance, level, streak, quests, redemption rules, payouts and recent points — everything the rewards page shows",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await ensureWelcomeGrant(dbUser._id);
      const [user, xp, quests, week, ledger, payouts] = await Promise.all([
        User.findById(dbUser._id).select("pointsBalance watchStreakDays").lean(),
        lifetimePoints(dbUser._id),
        questViews(dbUser._id),
        streakWeek(dbUser._id),
        PointsLedger.find({ userId: dbUser._id }).sort({ createdAt: -1 }).limit(24).lean(),
        Payout.find({ userId: dbUser._id }).sort({ createdAt: -1 }).limit(12).lean(),
      ]);
      const streakDays = user?.watchStreakDays ?? 0;
      return {
        success: true,
        data: {
          balance: user?.pointsBalance ?? 0,
          level: levelFor(xp),
          streak: {
            days: streakDays,
            week,
            // What tomorrow's first watch pays, so the page can say so.
            nextBonus: Math.min(STREAK_CAP, STREAK_BASE + streakDays * STREAK_STEP),
          },
          quests,
          earn: { dripPoints: DRIP_POINTS, dripMinutes: 10 },
          rules: {
            pointsPerUsd: POINTS_PER_USD,
            minPoints: MIN_REDEEM_POINTS,
            dailyCapPoints: DAILY_REDEEM_CAP_POINTS,
            minAccountAgeDays: 7,
            treasuryReady: isTreasuryConfigured(),
          },
          payouts: payouts.map((p) => ({
            id: String(p._id),
            kind: p.kind,
            points: p.points,
            usdMinor: p.usdMinor,
            status: p.status,
            createdAt: p.createdAt,
            paidAt: p.paidAt,
          })),
          ledger: ledger.map((l) => ({ delta: l.delta, balanceAfter: l.balanceAfter, reason: l.reason, at: l.createdAt })),
        },
      };
    },
  );

  app.post(
    "/user/me/quests/:questId/claim",
    {
      schema: {
        tags: ["Rewards"],
        summary: "Claim a finished quest's points",
        security: [{ bearerAuth: [] }],
        params: z.object({ questId: z.string().trim().min(1).max(60) }),
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      try {
        const result = await claimQuest(dbUser._id, request.params.questId);
        return {
          success: true,
          data: { questId: result.quest.id, points: result.quest.points, pointsBalance: result.balance },
        };
      } catch (error) {
        if (error instanceof QuestError) {
          const status = error.code === "UNKNOWN_QUEST" ? 404 : 409;
          throw new ApiError(status, error.message, error.code);
        }
        throw error;
      }
    },
  );
};
