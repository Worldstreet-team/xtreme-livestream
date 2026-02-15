import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { User, Follow } from "@/lib/models";
import { authenticate, isErrorResponse } from "@/lib/auth";
import { auth } from "@clerk/nextjs/server";

/**
 * GET /api/user/[username] — Public profile
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;

  await connectDB();

  const user = await User.findOne({ username: username.toLowerCase() });
  if (!user) {
    return NextResponse.json(
      { success: false, message: "User not found" },
      { status: 404 }
    );
  }

  // Check if the caller follows this user (optional — only if authenticated)
  let isFollowing = false;
  const { userId } = await auth();
  if (userId) {
    const result = await authenticate();
    if (!isErrorResponse(result)) {
      const follow = await Follow.findOne({
        followerId: result.dbUser._id,
        followingId: user._id,
      });
      isFollowing = !!follow;
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      user: {
        id: user._id,
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        bio: user.bio,
        followers: user.followers,
        following: user.following,
        totalViews: user.totalViews,
        isLive: user.isLive,
        createdAt: user.createdAt,
      },
      isFollowing,
    },
  });
}
