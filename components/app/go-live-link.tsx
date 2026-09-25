"use client";

import Link from "next/link";
import { Broadcast } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * Go live, in solid Chili (owner, 2026-09-24: "make it one solid color") —
 * the heat gradient is left to rings and gift moments. On air it keeps the
 * red and trades the icon for a pulsing dot. `compact` is the icon rail's
 * round button.
 */
export function GoLiveLink({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { user } = useAuth();
  const live = user?.isLive ?? false;
  return (
    <Link
      href="/studio"
      aria-label={live ? "On air — open the studio" : "Go live"}
      title={compact ? (live ? "On air" : "Go live") : undefined}
      className={cn(
        "press flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap text-white transition-[filter] hover:brightness-110",
        compact ? "mx-auto size-10" : "h-11 w-full text-[15px]",
        "bg-chili",
        className,
      )}
    >
      {live ? (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-white" />
        </span>
      ) : (
        <Broadcast size={17} weight="fill" />
      )}
      {!compact && (live ? "On air" : "Go live")}
    </Link>
  );
}
