"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";

// Shape of the user object returned by /api/auth/verify
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

const LOGIN_URL = "https://www.worldstreetgold.com/login";

function redirectToLogin() {
  const currentUrl = window.location.href;
  const loginUrl = `${LOGIN_URL}?redirect=${encodeURIComponent(currentUrl)}`;
  // Use replace to do a full page navigation, avoiding RSC fetch issues
  window.location.replace(loginUrl);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const verifyUser = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Call our verify endpoint which reads httpOnly cookies server-side
      const res = await fetch("/api/auth/verify", {
        credentials: "include",
      });

      // Handle non-OK responses
      if (!res.ok) {
        console.error("[Auth] Verify returned status:", res.status);
        setUser(null);
        redirectToLogin();
        return;
      }

      // Safely parse JSON
      const text = await res.text();
      if (!text) {
        console.error("[Auth] Empty response from verify endpoint");
        setUser(null);
        redirectToLogin();
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("[Auth] Invalid JSON response:", text.slice(0, 100));
        setUser(null);
        redirectToLogin();
        return;
      }

      if (data.success && data.user) {
        setUser(data.user);
      } else {
        // Not authenticated — redirect to external login
        setUser(null);
        redirectToLogin();
      }
    } catch (err) {
      console.error("[Auth] Verification failed:", err);
      setUser(null);
      setError("Failed to verify identity");
      // On error, redirect to login
      redirectToLogin();
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort
    } finally {
      setUser(null);
      redirectToLogin();
    }
  }, []);

  useEffect(() => {
    verifyUser();
  }, [verifyUser]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        error,
        refreshUser: verifyUser,
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
