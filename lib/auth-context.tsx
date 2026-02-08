"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api-client";

// Shape of the user object returned by GET /api/user/me
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
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  error: null,
  refreshUser: async () => {},
});

const LOGIN_URL = "https://worldstreetgold.com/login";

function redirectToLogin() {
  const currentUrl = window.location.href;
  const loginUrl = `${LOGIN_URL}?redirect=${encodeURIComponent(currentUrl)}`;
  window.location.href = loginUrl;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await apiFetch<{ success: boolean; data: { user: AppUser } }>(
        "/api/user/me"
      );
      setUser(res.data.user);
      setError(null);
    } catch (err) {
      const isAuthError =
        err instanceof Error && "status" in err && (err as { status: number }).status === 401;
      setUser(null);

      if (isAuthError) {
        // Unauthorized — redirect to login with return URL
        redirectToLogin();
        return;
      }

      console.error("[Auth] Failed to fetch user:", err);
      setError(err instanceof Error ? err.message : "Failed to load user");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        error,
        refreshUser: fetchUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
