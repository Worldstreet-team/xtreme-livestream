"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { AppShell } from "@/components/app/sidebar";
import { useAuth } from "@/lib/auth-context";

const SIGN_IN_URL = "https://www.worldstreetgold.com/login";

/** Routes browsable without an account (interactions still require sign-in). */
function isPublicPath(pathname: string) {
  return (
    pathname === "/explore" ||
    pathname.startsWith("/explore/") ||
    pathname.startsWith("/stream/")
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, error, refreshUser } = useAuth();
  const pathname = usePathname();
  const publicPath = isPublicPath(pathname);

  // Signed out on a protected page — actually send the visitor to sign-in
  // (the fallback UI below only shows while the navigation happens)
  useEffect(() => {
    if (!publicPath && !isLoading && !isAuthenticated && !error) {
      window.location.href = SIGN_IN_URL;
    }
  }, [publicPath, isLoading, isAuthenticated, error]);

  // Public pages render immediately for everyone — no auth gate
  if (publicPath) {
    return <AppShell>{children}</AppShell>;
  }

  // Still loading — show spinner
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Auth finished but failed — show error with retry
  if (!isAuthenticated && error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center px-4">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => refreshUser()}
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Not signed in at all — redirect to login
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
