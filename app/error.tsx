"use client";

import { useEffect } from "react";
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

/**
 * Segment-level error boundary.
 *
 * Without one, a single throw during render — `next/image` rejecting an
 * unconfigured host was the one that bit us — replaces the entire app with
 * Next's bare error screen and leaves the user no way forward but a manual
 * reload. This keeps the failure contained and recoverable.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[App] Unhandled render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-500/10">
          <WarningCircle size={26} className="text-red-400" />
        </div>
        <h1 className="text-lg font-bold text-foreground">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page hit an unexpected error. Trying again usually clears it.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[0.65rem] text-muted-foreground/50">
            Reference: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
        >
          <ArrowClockwise size={16} />
          Try again
        </button>
        <a
          href="/explore"
          className="mt-3 inline-block text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Go to Explore
        </a>
      </div>
    </div>
  );
}
