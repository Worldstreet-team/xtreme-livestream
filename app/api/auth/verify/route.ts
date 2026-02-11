import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyToken, refreshTokens, type AuthUser } from "@/lib/auth-service";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";

/**
 * GET /api/auth/verify — Verify the current user's authentication
 *
 * Reads httpOnly cookies, verifies with external auth service,
 * refreshes tokens if needed, and returns the local user profile.
 */
export async function GET(request: NextRequest) {
  const accessToken = request.cookies.get("accessToken")?.value;
  const refreshToken = request.cookies.get("refreshToken")?.value;

  // No tokens at all
  if (!accessToken && !refreshToken) {
    return NextResponse.json(
      { success: false, message: "No authentication tokens found" },
      { status: 401 }
    );
  }

  // Try to verify the access token
  if (accessToken) {
    try {
      const result = await verifyToken(accessToken);

      if (result.success && result.data?.user) {
        return await buildUserResponse(result.data.user);
      }
    } catch {
      // Token verification failed, try refresh
    }
  }

  // Access token missing or invalid — try refresh
  if (refreshToken) {
    return await attemptRefresh(refreshToken);
  }

  return NextResponse.json(
    { success: false, message: "Token verification failed" },
    { status: 401 }
  );
}

/**
 * Attempt to refresh tokens and return user data with new cookies.
 */
async function attemptRefresh(refreshToken: string): Promise<NextResponse> {
  try {
    const refreshResult = await refreshTokens(refreshToken);

    if (
      refreshResult.success &&
      refreshResult.data?.tokens?.accessToken &&
      refreshResult.data?.tokens?.refreshToken
    ) {
      const newAccessToken = refreshResult.data.tokens.accessToken;
      const newRefreshToken = refreshResult.data.tokens.refreshToken;

      // Verify new token to get user data
      const verifyResult = await verifyToken(newAccessToken);

      if (verifyResult.success && verifyResult.data?.user) {
        const response = await buildUserResponse(verifyResult.data.user, true);

        // Set new cookies
        response.cookies.set("accessToken", newAccessToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 15 * 60, // 15 minutes
        });

        response.cookies.set("refreshToken", newRefreshToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 7 * 24 * 60 * 60, // 7 days
        });

        return response;
      }
    }

    return NextResponse.json(
      { success: false, message: "Token refresh failed" },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { success: false, message: "Token refresh failed" },
      { status: 401 }
    );
  }
}

/**
 * Build the success response with local user data.
 * Auto-provisions a local user if this is their first visit.
 */
async function buildUserResponse(
  authUser: AuthUser,
  refreshed = false
): Promise<NextResponse> {
  await connectDB();

  let dbUser = await User.findOne({ authUserId: authUser.userId });

  if (!dbUser) {
    // Auto-provision on first visit
    const baseUsername = (
      authUser.firstName.toLowerCase() + authUser.lastName.toLowerCase()
    ).replace(/[^a-z0-9]/g, "");

    // Ensure username is unique
    let username = baseUsername;
    let attempt = 0;
    while (await User.findOne({ username })) {
      attempt++;
      username = `${baseUsername}${attempt}`;
    }

    dbUser = await User.create({
      authUserId: authUser.userId,
      email: authUser.email,
      username,
      displayName: `${authUser.firstName} ${authUser.lastName}`,
      avatar: `https://api.dicebear.com/9.x/avataaars/svg?seed=${authUser.userId}`,
      bio: "",
      streamKey: crypto.randomUUID(),
    });
  }

  return NextResponse.json({
    success: true,
    refreshed,
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
  });
}
