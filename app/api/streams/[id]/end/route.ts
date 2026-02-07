import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream, User } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";

/**
 * POST /api/streams/[id]/end — End a live stream
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticate(req);
  if (isErrorResponse(result)) return result;

  const { id } = await params;
  await connectDB();

  const stream = await Stream.findById(id);
  if (!stream) {
    return NextResponse.json(
      { success: false, message: "Stream not found" },
      { status: 404 }
    );
  }

  // Only the streamer can end
  if (!stream.streamerId.equals(result.dbUser._id)) {
    return NextResponse.json(
      { success: false, message: "Not authorized" },
      { status: 403 }
    );
  }

  if (!stream.isLive) {
    return NextResponse.json(
      { success: false, message: "Stream is not live" },
      { status: 400 }
    );
  }

  // Calculate duration
  const durationMs = Date.now() - stream.startedAt.getTime();
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const duration =
    hours > 0
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${minutes}:${String(seconds).padStart(2, "0")}`;

  // Update stream
  stream.isLive = false;
  stream.endedAt = new Date();
  stream.duration = duration;
  await stream.save();

  // Mark user as not live
  await User.updateOne({ _id: result.dbUser._id }, { isLive: false });

  // LiveKit room will auto-expire via emptyTimeout when all participants leave

  return NextResponse.json({
    success: true,
    message: "Stream ended",
    data: {
      stream: {
        id: stream._id,
        title: stream.title,
        duration: stream.duration,
        viewers: stream.viewers,
        peakViewers: stream.peakViewers,
      },
    },
  });
}
