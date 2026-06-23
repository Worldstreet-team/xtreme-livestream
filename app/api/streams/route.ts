import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";
import { createToken } from "@/lib/livekit";
import { markStreamEnded, reconcileLeanStreams } from "@/lib/stream-service";

/**
 * GET /api/streams — List streams (with optional filters)
 *
 * Query params:
 *   ?live=true         — only live streams
 *   ?category=Bitcoin Trading
 *   ?search=some query — search title
 *   ?sort=viewers|recent|trending  (default: viewers)
 *   ?limit=20&page=1
 */
export async function GET(req: NextRequest) {
  await connectDB();

  const { searchParams } = new URL(req.url);
  const live = searchParams.get("live");
  const category = searchParams.get("category");
  const search = searchParams.get("search");
  const sort = searchParams.get("sort") || "viewers";
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const page = Math.max(parseInt(searchParams.get("page") || "1"), 1);
  const skip = (page - 1) * limit;

  // Build filter
  const filter: Record<string, unknown> = {};
  if (live === "true") filter.isLive = true;
  if (category && category !== "All") filter.category = category;
  if (search) filter.title = { $regex: search, $options: "i" };

  // Build sort
  let sortObj: Record<string, 1 | -1> = { viewers: -1 };
  if (sort === "recent") sortObj = { startedAt: -1 };
  if (sort === "trending") sortObj = { viewers: -1, startedAt: -1 };

  const [streams, total] = await Promise.all([
    Stream.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limit)
      .populate("streamerId", "username displayName avatar isLive")
      .lean(),
    Stream.countDocuments(filter),
  ]);

  // Safety net: reconcile this page against LiveKit so streams whose
  // broadcaster has silently disconnected don't keep showing as live.
  // (The webhook is the primary mechanism; this catches anything it misses
  // and cleans up rows created before the webhook was configured.)
  const staleIds = await reconcileLeanStreams(streams);

  // When the caller asked for live streams only, drop the ones we just ended.
  const visible =
    live === "true" && staleIds.size > 0
      ? streams.filter((s) => !staleIds.has(String(s._id)))
      : streams.map((s) =>
          staleIds.has(String(s._id)) ? { ...s, isLive: false } : s
        );

  const adjustedTotal =
    live === "true" ? Math.max(0, total - staleIds.size) : total;

  return NextResponse.json({
    success: true,
    data: {
      streams: visible,
      pagination: {
        page,
        limit,
        total: adjustedTotal,
        pages: Math.ceil(adjustedTotal / limit),
      },
    },
  });
}

/**
 * POST /api/streams — Go live (create a new stream)
 *
 * Body: { title, category, tags?: string[] }
 */
export async function POST(req: NextRequest) {
  const result = await authenticate();
  if (isErrorResponse(result)) return result;

  const { dbUser } = result;

  // Check if user is already live — auto-cleanup stale streams
  if (dbUser.isLive) {
    // Find any existing live stream and end it (cleanup from failed connections)
    const staleStream = await Stream.findOne({
      streamerId: dbUser._id,
      isLive: true,
    });
    if (staleStream) {
      await markStreamEnded(staleStream); // also flips dbUser.isLive via streamerId
      // LiveKit room will auto-expire via emptyTimeout
    }

    dbUser.isLive = false;
    await dbUser.save();
  }

  const body = await req.json();
  const { title, category, tags, thumbnail } = body;

  if (!title || !category) {
    return NextResponse.json(
      { success: false, message: "Title and category are required" },
      { status: 400 }
    );
  }

  // Create a unique LiveKit room name
  // LiveKit Cloud auto-creates rooms when the first participant joins
  const roomName = `stream-${dbUser._id}-${Date.now()}`;

  // Generate a publisher token for the streamer (includes roomCreate grant)
  const token = await createToken(roomName, dbUser._id.toString(), dbUser.displayName, {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomCreate: true,
  });

  // Create stream record
  const stream = await Stream.create({
    streamerId: dbUser._id,
    title,
    category,
    tags: tags || [],
    thumbnail: thumbnail || "",
    livekitRoomName: roomName,
    isLive: true,
    startedAt: new Date(),
  });

  // Mark user as live
  dbUser.isLive = true;
  await dbUser.save();

  return NextResponse.json({
    success: true,
    message: "Stream started",
    data: {
      stream: {
        id: stream._id,
        title: stream.title,
        category: stream.category,
        livekitRoomName: roomName,
        startedAt: stream.startedAt,
      },
      livekitToken: token,
      livekitUrl: process.env.LIVEKIT_URL,
    },
  });
}
