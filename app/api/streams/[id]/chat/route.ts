import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { ChatMessage, Stream } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";

/**
 * GET /api/streams/[id]/chat — Get chat history for a stream
 *
 * Query params:
 *   ?limit=50   — number of messages (default 50, max 200)
 *   ?before=<messageId>  — pagination cursor
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await connectDB();

  const stream = await Stream.findById(id);
  if (!stream) {
    return NextResponse.json(
      { success: false, message: "Stream not found" },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const before = searchParams.get("before");

  const filter: Record<string, unknown> = { streamId: stream._id };
  if (before) {
    filter._id = { $lt: before };
  }

  const messages = await ChatMessage.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // Return in chronological order
  messages.reverse();

  return NextResponse.json({
    success: true,
    data: { messages },
  });
}

/**
 * POST /api/streams/[id]/chat — Send and persist a chat message
 *
 * Body: { content, type?: "text"|"tip"|"reaction", tipAmount?, tipCurrency?, emoji? }
 *
 * This persists the message to MongoDB. The actual real-time delivery
 * happens via LiveKit data messages on the client side.
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

  if (!stream.isLive) {
    return NextResponse.json(
      { success: false, message: "Stream is not live — chat is disabled" },
      { status: 400 }
    );
  }

  const body = await req.json();
  const { content, type = "text", tipAmount, tipCurrency, emoji } = body;

  if (!content || content.trim().length === 0) {
    return NextResponse.json(
      { success: false, message: "Message content is required" },
      { status: 400 }
    );
  }

  const message = await ChatMessage.create({
    streamId: stream._id,
    userId: result.dbUser._id,
    username: result.dbUser.username,
    avatar: result.dbUser.avatar,
    isMod: stream.streamerId.equals(result.dbUser._id), // streamer is always mod
    content: content.trim(),
    type,
    tipAmount: tipAmount || null,
    tipCurrency: tipCurrency || null,
    emoji: emoji || null,
  });

  return NextResponse.json({
    success: true,
    data: { message },
  });
}
