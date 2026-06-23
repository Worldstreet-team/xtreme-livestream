import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";
import { markStreamEnded } from "@/lib/stream-service";

/**
 * POST /api/streams/[id]/end — End a live stream
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticate();
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

  // End the stream + flip the streamer's live flag (computes duration).
  await markStreamEnded(stream);

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
