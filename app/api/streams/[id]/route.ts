import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Stream } from "@/lib/models";

/**
 * GET /api/streams/[id] — Get stream details
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await connectDB();

  const stream = await Stream.findById(id)
    .populate("streamerId", "username displayName avatar bio followers isLive")
    .lean();

  if (!stream) {
    return NextResponse.json(
      { success: false, message: "Stream not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: { stream },
  });
}

/**
 * PATCH /api/streams/[id] — Update stream details (while live)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { authenticate, isErrorResponse } = await import("@/lib/auth");
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

  // Only the streamer can update
  if (!stream.streamerId.equals(result.dbUser._id)) {
    return NextResponse.json(
      { success: false, message: "Not authorized" },
      { status: 403 }
    );
  }

  const body = await req.json();
  const allowedFields = ["title", "category", "tags", "thumbnail"] as const;

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      (stream as unknown as Record<string, unknown>)[field] = body[field];
    }
  }

  await stream.save();

  return NextResponse.json({
    success: true,
    message: "Stream updated",
    data: { stream },
  });
}
