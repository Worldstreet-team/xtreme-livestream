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

    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/user/me");

      if (!res.ok) {
        console.error("[Auth] /api/user/me returned status:", res.status);
        setUser(null);
        setError("Failed to load profile");
        return;
      }

      const data = await res.json();

      if (data.success && data.data?.user) {
        setUser(data.data.user);
      } else {
        setUser(null);
        setError("Failed to load profile");
      }
    } catch (err) {
      console.error("[Auth] Profile fetch failed:", err);
      setUser(null);
      setError("Failed to load profile");
    } finally {
      setIsLoading(false);
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
