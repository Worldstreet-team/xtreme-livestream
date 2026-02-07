import { NextRequest, NextResponse } from "next/server";
import { authenticate, isErrorResponse } from "@/lib/auth";

/**
 * GET /api/user/me — Get current user's profile
 */
export async function GET(req: NextRequest) {
  const result = await authenticate(req);
  if (isErrorResponse(result)) return result;

  const { dbUser } = result;

  return NextResponse.json({
    success: true,
    data: {
      user: {
        id: dbUser._id,
        authUserId: dbUser.authUserId,
        username: dbUser.username,
        displayName: dbUser.displayName,
        email: dbUser.email,
        avatar: dbUser.avatar,
        bio: dbUser.bio,
        followers: dbUser.followers,
        following: dbUser.following,
        totalViews: dbUser.totalViews,
        isLive: dbUser.isLive,
        streamKey: dbUser.streamKey,
        settings: dbUser.settings,
        createdAt: dbUser.createdAt,
      },
    },
  });
}

/**
 * PATCH /api/user/me — Update current user's profile
 */
export async function PATCH(req: NextRequest) {
  const result = await authenticate(req);
  if (isErrorResponse(result)) return result;

  const { dbUser } = result;
  const body = await req.json();

  // Allowed fields to update
  const allowedFields = [
    "displayName",
    "username",
    "avatar",
    "bio",
  ] as const;

  const allowedSettings = [
    "autoRecord",
    "slowMode",
    "subscriberOnly",
    "profanityFilter",
  ] as const;

  // Update top-level fields
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      (dbUser as unknown as Record<string, unknown>)[field] = body[field];
    }
  }

  // Update nested settings
  if (body.settings && typeof body.settings === "object") {
    for (const key of allowedSettings) {
      if (body.settings[key] !== undefined) {
        dbUser.settings[key] = body.settings[key];
      }
    }
  }

  // Validate username uniqueness if changed
  if (body.username) {
    const { User } = await import("@/lib/models");
    const existing = await User.findOne({
      username: body.username.toLowerCase(),
      _id: { $ne: dbUser._id },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, message: "Username already taken" },
        { status: 409 }
      );
    }
  }

  await dbUser.save();

  return NextResponse.json({
    success: true,
    message: "Profile updated",
    data: {
      user: {
        id: dbUser._id,
        username: dbUser.username,
        displayName: dbUser.displayName,
        avatar: dbUser.avatar,
        bio: dbUser.bio,
        settings: dbUser.settings,
      },
    },
  });
}
