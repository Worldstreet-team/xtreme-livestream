"use client";

import Link from "next/link";
import Image from "next/image";
import { Broadcast } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

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
  artwork,
  title,
  body,
  action,
  goLive = true,
  onDark = false,
  className,
}: {
  icon?: React.ReactNode;
  /** A transparent illustration for a primary, unfiltered empty state. */
  artwork?: { src: string; alt?: string };
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
      {artwork ? (
        <Image
          src={artwork.src}
          alt={artwork.alt ?? ""}
          width={1024}
          height={1024}
          sizes="(max-width: 640px) 160px, 192px"
          className="mb-2 size-40 object-contain sm:size-48"
        />
      ) : icon && (
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
              <Button asChild variant="secondary" className={quiet(onDark)}><Link href={action.href}>{action.label}</Link></Button>
            ) : (
              <Button variant="secondary" onClick={action.onClick} className={quiet(onDark)}>
                {action.label}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}

/** The second button never competes with Go live, on either ground. */
const quiet = (onDark: boolean) =>
  cn(
    "flex items-center px-5 text-sm",
    // On a picture it wears the object language instead of the charcoal.
    onDark && "bg-black/55 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-black/70",
  );

/**
 * Go live — Afterglow's signature action, and one of the three places the
 * heat gradient is allowed (rings, Go live, gift moments). Once you are
 * already on air it turns solid Chili with a pulsing dot and becomes the
 * way back to the studio rather than an invitation.
 */
export function GoLiveButton({ className, onClick }: { className?: string; onClick?: () => void }) {
  const { user } = useAuth();
  const live = user?.isLive ?? false;

  return (
    <Button asChild variant={live ? "live" : "heat"} className={cn("gap-2 px-5", className)}>
    <Link href="/studio" onClick={onClick}>
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
    </Button>
  );
}
