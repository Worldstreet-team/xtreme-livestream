"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useUser, useClerk } from "@clerk/nextjs";

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
        const res = await fetch("/api/user/me");

        if (!res.ok) {
          console.error(`[Auth] /api/user/me returned status: ${res.status} (attempt ${attempt + 1})`);
          // Don't retry 4xx client errors (except 408/429)
          if (res.status < 500 && res.status !== 408 && res.status !== 429) {
            setUser(null);
            setError("Failed to load profile");
            setIsLoading(false);
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();

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
    await signOut({ redirectUrl: "https://www.worldstreetgold.com/login" });
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
