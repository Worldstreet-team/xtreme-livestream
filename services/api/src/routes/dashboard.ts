import type { FastifyPluginAsync } from "fastify";
import { authenticate } from "../auth.js";
import { Follow, Stream } from "../models.js";

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
      const totalViews = allStreams.reduce(
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
      const followers = await Follow.countDocuments({
        followingId: dbUser._id,
      });
      const recentStreams = pastStreams.slice(0, 10).map((stream) => ({
        id: stream._id,
        title: stream.title,
        category: stream.category,
        thumbnail: stream.thumbnail,
        viewers: stream.viewers,
        peakViewers: stream.peakViewers,
        duration: stream.duration,
        date: stream.startedAt,
        earnings: stream.earnings,
      }));
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
            totalViews,
            followers,
            totalHours: Math.round((totalSeconds / 3600) * 10) / 10,
            totalStreams: allStreams.length,
            currentlyLive: allStreams.some((stream) => stream.isLive),
          },
          recentStreams,
          dailyViews,
        },
      };
    },
  );
};
