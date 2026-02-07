import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User, Follow } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";

/**
 * POST /api/user/[username]/follow — Follow a user
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const result = await authenticate(req);
  if (isErrorResponse(result)) return result;

  const { username } = await params;
  await connectDB();

  const target = await User.findOne({ username: username.toLowerCase() });
  if (!target) {
    return NextResponse.json(
      { success: false, message: "User not found" },
      { status: 404 }
    );
  }

  if (target._id.equals(result.dbUser._id)) {
    return NextResponse.json(
      { success: false, message: "Cannot follow yourself" },
      { status: 400 }
    );
  }

  // Check if already following
  const existing = await Follow.findOne({
    followerId: result.dbUser._id,
    followingId: target._id,
  });

  if (existing) {
    return NextResponse.json(
      { success: false, message: "Already following this user" },
      { status: 409 }
    );
  }

  await Follow.create({
    followerId: result.dbUser._id,
    followingId: target._id,
  });

  // Update counts
  await User.updateOne({ _id: result.dbUser._id }, { $inc: { following: 1 } });
  await User.updateOne({ _id: target._id }, { $inc: { followers: 1 } });

  return NextResponse.json({
    success: true,
    message: `Now following ${target.displayName}`,
  });
}

/**
 * DELETE /api/user/[username]/follow — Unfollow a user
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const result = await authenticate(req);
  if (isErrorResponse(result)) return result;

  const { username } = await params;
  await connectDB();

  const target = await User.findOne({ username: username.toLowerCase() });
  if (!target) {
    return NextResponse.json(
      { success: false, message: "User not found" },
      { status: 404 }
    );
  }

  const deleted = await Follow.findOneAndDelete({
    followerId: result.dbUser._id,
    followingId: target._id,
  });

  if (!deleted) {
    return NextResponse.json(
      { success: false, message: "Not following this user" },
      { status: 400 }
    );
  }

  // Update counts
  await User.updateOne({ _id: result.dbUser._id }, { $inc: { following: -1 } });
  await User.updateOne({ _id: target._id }, { $inc: { followers: -1 } });

  return NextResponse.json({
    success: true,
    message: `Unfollowed ${target.displayName}`,
  });
}
