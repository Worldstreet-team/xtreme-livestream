import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream, Follow } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";
import { averageViewers } from "@/lib/stream-service";

/**
 * GET /api/dashboard/stats — Creator analytics
 *
 * Returns:
 *   - Peak/average viewers, followers, stream hours
 *   - Recent past streams
 *   - Daily view breakdown (last 7 days)
 *
 * Legacy in-process route: gifting (and therefore earnings) lives only in the
 * standalone API service, so the earnings fields are absent here and the
 * dashboard renders them as unavailable rather than as a misleading $0.00.
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

  // Peak concurrent viewers summed across streams — an audience-size measure,
  // not a count of views.
  const totalPeakViewers = allStreams.reduce((sum, s) => sum + (s.peakViewers || s.viewers), 0);

  // Time-weighted mean across all streams, so a long stream counts for more
  // than a brief one that happened to spike.
  const totalViewerSeconds = allStreams.reduce((sum, s) => sum + (s.viewerSeconds ?? 0), 0);

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
    avgViewers: averageViewers(s),
    duration: s.duration,
    date: s.startedAt,
  }));

  // Daily views for last 7 days (approximation from stream start dates).
  // Buckets are UTC days — the client labels them in UTC to match.
  const now = new Date();
  const dailyViews: { date: string; views: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now);
    day.setUTCDate(day.getUTCDate() - i);
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
        totalPeakViewers,
        // Retained under the old name for existing clients.
        totalViews: totalPeakViewers,
        followers: followerCount,
        totalHours,
        totalStreams: allStreams.length,
        currentlyLive: liveStreams.length > 0,
        avgViewers:
          totalSeconds > 0 ? Math.round(totalViewerSeconds / totalSeconds) : 0,
      },
      recentStreams,
      dailyViews,
    },
  });
}
