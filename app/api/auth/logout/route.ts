import { NextRequest, NextResponse } from "next/server";
import { logoutUser } from "@/lib/auth-service";

/**
 * POST /api/auth/logout — Log out the current user
 *
 * Invalidates the refresh token with the external auth service
 * and clears the httpOnly cookies.
 */
export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get("refreshToken")?.value;

  // Call external auth service to invalidate the refresh token
  if (refreshToken) {
    try {
      await logoutUser(refreshToken);
    } catch {
      // Best-effort — continue to clear cookies even if external call fails
    }
  }

  // Clear cookies
  const response = NextResponse.json({
    success: true,
    message: "Logged out successfully",
  });

  response.cookies.set("accessToken", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  response.cookies.set("refreshToken", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return response;
}
