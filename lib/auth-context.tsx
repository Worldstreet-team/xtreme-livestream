"use client";

import { SIGNED_OUT_URL } from "@/lib/auth-urls";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { apiFetch, ApiError } from "@/lib/api-client";

// Shape of the local DB user object returned by /api/user/me
export interface AppUser {
  id: string;
  authUserId: string;
  username: string;
  displayName: string;
  email: string;
  avatar: string;
  bio: string;
  followers: number;
  following: number;
  totalViews: number;
  isLive: boolean;
  streamKey: string;
  settings: {
    autoRecord: boolean;
    slowMode: boolean;
    subscriberOnly: boolean;
    profanityFilter: boolean;
    discoverableByTag?: boolean;
    /** Gifts at or above this many cents go on screen by themselves; 0 is off. */
    featureGiftsFromMinor?: number;
    /** How long a featured comment stays up, in seconds; 0 is until taken down. */
    featureSeconds?: number;
    /** Who can ask to join the stage (the request line). */
    stageRequests?: "everyone" | "allies" | "fans" | "off";
    /** How old an account must be to ask to join, in days. */
    stageAccountDays?: number;
  };
  /** Cold-start picker state; `completedAt` null means never seen or skipped. */
  onboarding?: {
    completedAt: string | null;
    categories: string[];
    language?: string;
  };
  createdAt: string;
}

interface AuthContextValue {
  user: AppUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,
  refreshUser: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();

  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!isSignedIn) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    const MAX_RETRIES = 3;
    const BACKOFF_MS = [500, 1000, 2000];

    setIsLoading(true);
    setError(null);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const data = await apiFetch<{
          success: boolean;
          data?: { user?: AppUser };
        }>("/api/user/me");

        if (data.success && data.data?.user) {
          setUser(data.data.user);
          setError(null);
          setIsLoading(false);
          return;
        } else {
          setUser(null);
          setError("Failed to load profile");
          setIsLoading(false);
          return;
        }
      } catch (err) {
        console.error(`[Auth] Profile fetch failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, err);

        // Don't retry 4xx client errors (except 408/429)
        if (
          err instanceof ApiError &&
          err.status < 500 &&
          err.status !== 408 &&
          err.status !== 429
        ) {
          setUser(null);
          setError("Failed to load profile");
          setIsLoading(false);
          return;
        }

        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        } else {
          setUser(null);
          setError("Failed to load profile");
          setIsLoading(false);
        }
      }
    }
  }, [isSignedIn]);

  const logout = useCallback(async () => {
    setUser(null);
    await signOut({ redirectUrl: SIGNED_OUT_URL });
  }, [signOut]);

  // Fetch local DB profile once Clerk confirms sign-in
  useEffect(() => {
    if (clerkLoaded) {
      fetchProfile();
    }
  }, [clerkLoaded, isSignedIn, fetchProfile]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: !clerkLoaded || isLoading,
        isAuthenticated: !!isSignedIn && !!user,
        error,
        refreshUser: fetchProfile,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
