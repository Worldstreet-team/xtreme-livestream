import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";
import { createToken } from "@/lib/livekit";
import { reconcileStream } from "@/lib/stream-service";

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
  // Signed-in viewers join under their identity; anonymous visitors fall back
  // to a read-only guest identity that cannot broadcast data messages.
  const result = await authenticate();
  const viewer = isErrorResponse(result) ? null : result;

  const { id } = await params;
  await connectDB();

  const stream = await Stream.findById(id);
  if (!stream) {
    return NextResponse.json(
      { success: false, message: "Stream not found" },
      { status: 404 }
    );
  }

  // Verify against LiveKit's real room state before letting a viewer in, so a
  // silently-disconnected stream can't keep handing out join tokens.
  const stillLive = await reconcileStream(stream);
  if (!stillLive) {
    return NextResponse.json(
      { success: false, message: "Stream is not live" },
      { status: 400 }
    );
  }

  // Viewer token — can subscribe (and, when signed in, send data messages for
  // chat), but cannot publish media
  const token = await createToken(
    stream.livekitRoomName,
    viewer ? viewer.dbUser._id.toString() : `guest-${crypto.randomUUID()}`,
    viewer ? viewer.dbUser.displayName : "Guest",
    {
      canPublish: false,
      canSubscribe: true,
      canPublishData: viewer !== null,
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
