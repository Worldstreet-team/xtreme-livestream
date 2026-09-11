"use client";

import Link from "next/link";
import { Broadcast } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * The one empty state, and the one thing it always says.
 *
 * An empty screen on a livestream app is not a dead end: it is the moment
 * the platform has nothing to show you, which is exactly the moment to
 * point out that you could be the one on air. So `Empty` carries a Go live
 * button by default (owner, 2026-09-11: "always show them in empty screens
 * to go live") and any other action sits beside it as the quieter option.
 *
 * It exists because the same block had been hand-rolled a dozen times over
 * — bare paragraphs here, icon-title-body there, pill buttons on one route
 * and square ones on the next. Reach for this instead of writing another.
 */

/** Either a link out or a filter to undo — both render as the quiet button. */
export type EmptyAction =
  | { label: string; href: string; onClick?: never }
  | { label: string; onClick: () => void; href?: never };

export function Empty({
  icon,
  title,
  body,
  action,
  goLive = true,
  onDark = false,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  /** One line under the title. Optional — some empties say enough in four words. */
  body?: string;
  /** The route-specific way out, shown next to Go live as the quieter button. */
  action?: EmptyAction;
  /** Off only where the viewer is already in the studio, or it isn't their stage to fill. */
  goLive?: boolean;
  /** The feed lays its empty over video, so the block turns white-on-black there. */
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center md:py-20",
        onDark && "text-white",
        className,
      )}
    >
      {icon && (
        <span className={cn("mb-4", onDark ? "text-white/30" : "text-muted-foreground/25")}>
          {icon}
        </span>
      )}
      <p className={cn("text-sm font-medium", onDark ? "text-white" : "text-foreground/85")}>
        {title}
      </p>
      {body && (
        <p
          className={cn(
            "mt-1 max-w-[46ch] text-[13px]",
            onDark ? "text-white/70" : "text-muted-foreground/70",
          )}
        >
          {body}
        </p>
      )}
      {(goLive || action) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {goLive && <GoLiveButton />}
          {action &&
            (action.href ? (
              <Link href={action.href} className={quiet(onDark)}>
                {action.label}
              </Link>
            ) : (
              <button type="button" onClick={action.onClick} className={quiet(onDark)}>
                {action.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** The second button never competes with Go live, on either ground. */
const quiet = (onDark: boolean) =>
  cn(
    "flex h-9 items-center rounded-sm px-4 text-sm font-medium transition-colors",
    onDark ? "bg-white/10 text-white hover:bg-white/20" : "bg-white/[0.06] text-foreground hover:bg-white/[0.09]",
  );

/**
 * Go live, in the empty state's own size. Matches the top bar's button:
 * red and pulsing once you are already on air, where it becomes the way
 * back to the studio rather than an invitation.
 */
export function GoLiveButton({ className, onClick }: { className?: string; onClick?: () => void }) {
  const { user } = useAuth();
  const live = user?.isLive ?? false;

  return (
    <Link
      href="/studio"
      onClick={onClick}
      className={cn(
        "shine flex h-9 items-center gap-2 rounded-sm px-4 text-sm font-semibold transition-colors",
        live
          ? "bg-red-600 text-white hover:bg-red-700"
          : "bg-primary text-primary-foreground hover:bg-primary/85",
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
      {live ? "Back to your studio" : "Go live"}
    </Link>
  );
}
