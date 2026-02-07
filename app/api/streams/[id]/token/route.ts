import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";
import { createToken } from "@/lib/livekit";

/**
 * GET /api/streams/[id]/token — Get a LiveKit viewer token
 *
 * Returns a token that lets the caller join the LiveKit room as a viewer
 * (can subscribe to tracks + send data messages for chat, but cannot publish media).
 */
export async function GET(
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

  if (!stream.isLive) {
    return NextResponse.json(
      { success: false, message: "Stream is not live" },
      { status: 400 }
    );
  }

  // Viewer token — can subscribe & send data, but cannot publish media
  const token = await createToken(
    stream.livekitRoomName,
    result.dbUser._id.toString(),
    result.dbUser.displayName,
    {
      canPublish: false,
      canSubscribe: true,
      canPublishData: true, // for chat via data messages
    }
  );

  return NextResponse.json({
    success: true,
    data: {
      token,
      livekitUrl: process.env.LIVEKIT_URL,
      roomName: stream.livekitRoomName,
    },
  });
}
