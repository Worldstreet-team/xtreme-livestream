import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../auth.js";
import { Follow, GiftTransaction, Stream } from "../models.js";
import { averageViewers } from "../stream-service.js";

export const dashboardRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/dashboard/stats",
    {
      schema: {
        tags: ["Dashboard"],
        summary: "Get creator analytics",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const allStreams = await Stream.find({ streamerId: dbUser._id })
        .sort({ startedAt: -1 })
        .lean();
      const pastStreams = allStreams.filter((stream) => !stream.isLive);
      // Peak concurrent viewers summed across streams — an audience-size
      // measure, not a count of views.
      const totalPeakViewers = allStreams.reduce(
        (sum, stream) => sum + (stream.peakViewers || stream.viewers),
        0,
      );
      const totalSeconds = pastStreams.reduce((sum, stream) => {
        if (!stream.startedAt || !stream.endedAt) return sum;
        return (
          sum +
          (new Date(stream.endedAt).getTime() -
            new Date(stream.startedAt).getTime()) /
            1000
        );
      }, 0);
      // Time-weighted mean across every stream, so long streams count for more
      // than a brief one that happened to spike.
      const totalViewerSeconds = allStreams.reduce(
        (sum, stream) => sum + (stream.viewerSeconds ?? 0),
        0,
      );

      // Gifts grouped per stream: gives both the lifetime totals and the
      // per-stream earnings in a single round-trip.
      const [followers, giftsByStream] = await Promise.all([
        Follow.countDocuments({ followingId: dbUser._id }),
        GiftTransaction.aggregate<{
          _id: unknown;
          gross: number;
          net: number;
          count: number;
        }>([
          { $match: { streamerId: dbUser._id } },
          {
            $group: {
              _id: "$streamId",
              gross: { $sum: "$grossUsdMinor" },
              net: { $sum: "$netUsdMinor" },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const giftsFor = new Map(
        giftsByStream.map((row) => [String(row._id), row]),
      );
      const tips = giftsByStream.reduce(
        (totals, row) => ({
          gross: totals.gross + row.gross,
          net: totals.net + row.net,
          count: totals.count + row.count,
        }),
        { gross: 0, net: 0, count: 0 },
      );

      const recentStreams = pastStreams.slice(0, 10).map((stream) => {
        const earned = giftsFor.get(String(stream._id))?.net ?? 0;

        return {
          id: stream._id,
          title: stream.title,
          category: stream.category,
          thumbnail: stream.thumbnail,
          viewers: stream.viewers,
          peakViewers: stream.peakViewers,
          avgViewers: averageViewers(stream),
          duration: stream.duration,
          date: stream.startedAt,
          earningsUsdMinor: earned,
          // Legacy pre-formatted string kept for existing clients.
          earnings: `$${(earned / 100).toFixed(2)}`,
        };
      });
      const now = new Date();
      const dailyViews = Array.from({ length: 7 }, (_, index) => {
        const day = new Date(now);
        day.setUTCDate(day.getUTCDate() - (6 - index));
        const date = day.toISOString().slice(0, 10);
        const views = allStreams
          .filter(
            (stream) =>
              new Date(stream.startedAt).toISOString().slice(0, 10) === date,
          )
          .reduce(
            (sum, stream) => sum + (stream.peakViewers || stream.viewers),
            0,
          );

        return { date, views };
      });

      return {
        success: true,
        data: {
          stats: {
            totalPeakViewers,
            // Retained under the old name for existing clients.
            totalViews: totalPeakViewers,
            followers,
            totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
            totalStreams: allStreams.length,
            currentlyLive: allStreams.some((stream) => stream.isLive),
            avgViewers:
              totalSeconds > 0
                ? Math.round(totalViewerSeconds / totalSeconds)
                : 0,
            // Net of commission — what the creator actually keeps.
            earningsUsdMinor: dbUser.earningsUsdMinor,
            tipsGrossUsdMinor: tips.gross,
            tipsNetUsdMinor: tips.net,
            tipsCount: tips.count,
          },
          recentStreams,
          dailyViews,
        },
      };
    },
  );
};
