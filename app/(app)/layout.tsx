"use client";

import { signInHref } from "@/lib/auth-urls";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/app/sidebar";
import { VividVoiceProvider } from "@/components/vivid-provider";
import { CallProvider } from "@/components/app/calls/call-provider";
import { useAuth } from "@/lib/auth-context";
import { useViewerFrame } from "@/lib/viewer-view";
import { WELCOME_SKIP_KEY } from "@/components/app/welcome/onboarding-flow";
import { XtreamLoader } from "@/components/ui/xtream-loader";

/** A new account gets the first-run flow; older ones never do. */
const WELCOME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pages the first-run flow never interrupts: someone who arrived on a
 * stream, a channel or a camera link came for that, and the studio is
 * already where a new creator wants to be. The flow waits for their next page.
 */
function welcomeWaits(pathname: string) {
  return (
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/stream/") ||
    pathname.startsWith("/c/") ||
    pathname.startsWith("/camera/") ||
    pathname.startsWith("/studio") ||
    pathname.startsWith("/produce/")
  );
}


/** Routes browsable without an account (interactions still require sign-in). */
function isPublicPath(pathname: string) {
  return (
    pathname === "/explore" ||
    pathname.startsWith("/explore/") ||
    pathname === "/browse" ||
    pathname.startsWith("/browse/") ||
    pathname === "/feed" ||
    pathname.startsWith("/stream/") ||
    // A second phone as a camera has no account: the code it scanned is its key.
    pathname.startsWith("/camera/") ||
    // Channel pages are how a stream gets shared and how a streamer gets
    // discovered — gating them behind sign-in would make every link a
    // dead end for the visitor most worth converting.
    pathname.startsWith("/c/")
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated, error, refreshUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const publicPath = isPublicPath(pathname);
  // The studio's "See what viewers see" frame is a second copy of the app: it mustn't ring for calls too.
  const viewerFrame = useViewerFrame();

  // Signed out on a protected page — actually send the visitor to sign-in
  // (the fallback UI below only shows while the navigation happens)
  useEffect(() => {
    if (!publicPath && !isLoading && !isAuthenticated && !error) {
      // Locally that's our own /sign-in, which brings you back here after.
      window.location.href = signInHref(window.location.href);
    }
  }, [publicPath, isLoading, isAuthenticated, error]);

  // The first-run flow (/welcome), once: a new account (under a week old)
  // that hasn't finished or skipped it and follows nobody yet. It comes back
  // to the page they were on. Finishing or skipping on the app counts too —
  // the record is on the account.
  const onboarding = user?.onboarding;
  const createdAt = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
  const welcomeDue =
    Boolean(user) &&
    !viewerFrame &&
    !onboarding?.completedAt &&
    !onboarding?.skippedAt &&
    (user?.following ?? 0) === 0 &&
    !welcomeWaits(pathname);
  useEffect(() => {
    if (!welcomeDue || Date.now() - createdAt >= WELCOME_WINDOW_MS) return;
    try {
      if (localStorage.getItem(WELCOME_SKIP_KEY)) return;
    } catch {
      // Storage off: the account's record decides.
    }
    router.replace(`/welcome?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [welcomeDue, createdAt, router]);

  // Public pages render immediately for everyone — no auth gate
  if (publicPath) {
    return (
      <VividVoiceProvider>
        {/* Calls ring on every page, public ones included, once you're signed in. */}
        <CallProvider enabled={isAuthenticated && !viewerFrame}>
          <AppShell>{children}</AppShell>
        </CallProvider>
      </VividVoiceProvider>
    );
  }

  // Still loading — show spinner
  if (isLoading) {
    return (
      <div className="relative min-h-screen bg-background">
        <XtreamLoader messages={["Getting Xtream ready"]} />
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
            className="px-4 py-2 rounded-sm bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
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
      <div className="relative min-h-screen bg-background">
        <XtreamLoader messages={["Taking you to sign in"]} />
      </div>
    );
  }

  return (
    <VividVoiceProvider>
      <CallProvider enabled={isAuthenticated}>
        <AppShell>{children}</AppShell>
      </CallProvider>
    </VividVoiceProvider>
  );
}
