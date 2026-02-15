import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream, Follow } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";

/**
 * GET /api/dashboard/stats — Creator analytics
 *
 * Returns:
 *   - Total views, followers, estimated earnings, stream hours
 *   - Recent past streams
 *   - Daily view breakdown (last 7 days)
 */
export async function GET() {
  const result = await authenticate();
  if (isErrorResponse(result)) return result;

  const { dbUser } = result;
  await connectDB();

  // All streams by this user
  const allStreams = await Stream.find({ streamerId: dbUser._id })
    .sort({ startedAt: -1 })
    .lean();

  const liveStreams = allStreams.filter((s) => s.isLive);
  const pastStreams = allStreams.filter((s) => !s.isLive);

  // Total views across all streams
  const totalViews = allStreams.reduce((sum, s) => sum + (s.peakViewers || s.viewers), 0);

  // Total stream hours
  const totalSeconds = pastStreams.reduce((sum, s) => {
    if (!s.startedAt || !s.endedAt) return sum;
    return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000;
  }, 0);
  const totalHours = Math.round(totalSeconds / 3600 * 10) / 10;

  // Follower count
  const followerCount = await Follow.countDocuments({ followingId: dbUser._id });

  // Recent 10 past streams
  const recentStreams = pastStreams.slice(0, 10).map((s) => ({
    id: s._id,
    title: s.title,
    category: s.category,
    thumbnail: s.thumbnail,
    viewers: s.viewers,
    peakViewers: s.peakViewers,
    duration: s.duration,
    date: s.startedAt,
    earnings: s.earnings,
  }));

  // Daily views for last 7 days (approximation from stream start dates)
  const now = new Date();
  const dailyViews: { date: string; views: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    const dayStr = day.toISOString().split("T")[0];

    const dayViews = allStreams
      .filter((s) => {
        const streamDate = new Date(s.startedAt).toISOString().split("T")[0];
        return streamDate === dayStr;
      })
      .reduce((sum, s) => sum + (s.peakViewers || s.viewers), 0);

    dailyViews.push({ date: dayStr, views: dayViews });
  }

  return NextResponse.json({
    success: true,
    data: {
      stats: {
        totalViews,
        followers: followerCount,
        totalHours,
        totalStreams: allStreams.length,
        currentlyLive: liveStreams.length > 0,
      },
      recentStreams,
      dailyViews,
    },
  });
}
