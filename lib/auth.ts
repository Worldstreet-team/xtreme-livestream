import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth, currentUser } from "@clerk/nextjs/server";
import { connectDB } from "@/lib/db";
import { User, IUser } from "@/lib/models";

export interface AuthenticatedUser {
  authUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  dbUser: IUser;
}

/**
 * Verify the current user via Clerk's server-side auth().
 * On first visit, auto-provisions a local user profile in MongoDB.
 */
export async function authenticate(): Promise<AuthenticatedUser | NextResponse> {
  const { userId } = await auth();

  if (!userId) {
    return NextResponse.json(
      { success: false, message: "Authentication required" },
      { status: 401 }
    );
  }

  // Fetch full Clerk user to get name/email
  const clerkUser = await currentUser();

  if (!clerkUser) {
    return NextResponse.json(
      { success: false, message: "Authentication required" },
      { status: 401 }
    );
  }

  const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
  const firstName = clerkUser.firstName ?? "";
  const lastName = clerkUser.lastName ?? "";

  // Connect to MongoDB and find or create local user profile
  await connectDB();

  let dbUser = await User.findOne({ authUserId: userId });

  if (!dbUser) {
    // Auto-provision on first visit
    const baseUsername = (
      firstName.toLowerCase() + lastName.toLowerCase()
    ).replace(/[^a-z0-9]/g, "") || `user${Date.now()}`;

    // Ensure username is unique
    let username = baseUsername;
    let attempt = 0;
    while (await User.findOne({ username })) {
      attempt++;
      username = `${baseUsername}${attempt}`;
    }

    dbUser = await User.create({
      authUserId: userId,
      email,
      username,
      displayName: `${firstName} ${lastName}`.trim() || "Anonymous",
      avatar: clerkUser.imageUrl || `https://api.dicebear.com/9.x/avataaars/svg?seed=${userId}`,
      bio: "",
      streamKey: crypto.randomUUID(),
    });
  }

  return {
    authUserId: userId,
    email,
    firstName,
    lastName,
    role: (clerkUser.publicMetadata?.role as string) ?? "user",
    dbUser,
  };
}

/**
 * Helper: returns true if authentication failed (result is a NextResponse error).
 */
export function isErrorResponse(
  result: AuthenticatedUser | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
