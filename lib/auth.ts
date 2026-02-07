import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { connectDB } from "@/lib/db";
import { User, IUser } from "@/lib/models";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;

// Shape returned by the external auth service's /api/auth/verify
interface AuthUser {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isVerified: boolean;
  createdAt: string;
}

export interface AuthenticatedUser {
  authUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  dbUser: IUser;
}

/**
 * Verify JWT by calling the external auth service.
 * On first visit, auto-provisions a local user profile.
 */
export async function authenticate(
  req: NextRequest
): Promise<AuthenticatedUser | NextResponse> {
  // Try Authorization header first, then fall back to HttpOnly cookie
  const authHeader = req.headers.get("authorization");
  let token: string | undefined;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  } else {
    token = req.cookies.get("accessToken")?.value;
  }

  if (!token) {
    return NextResponse.json(
      { success: false, message: "Authentication required" },
      { status: 401 }
    );
  }

  // Call external auth service to verify the token
  let authUser: AuthUser;
  try {
    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, message: "Invalid or expired token" },
        { status: 401 }
      );
    }

    const body = await res.json();
    authUser = body.data.user;
  } catch {
    return NextResponse.json(
      { success: false, message: "Auth service unavailable" },
      { status: 503 }
    );
  }

  // Connect to MongoDB and find or create local user profile
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

  return {
    authUserId: authUser.userId,
    email: authUser.email,
    firstName: authUser.firstName,
    lastName: authUser.lastName,
    role: authUser.role,
    dbUser,
  };
}

/**
 * Helper: returns 401 if authentication failed, otherwise the authenticated user.
 */
export function isErrorResponse(
  result: AuthenticatedUser | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
