import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small label that sits on a picture: LIVE, a viewer count, an uptime,
 * a category. A black overlay with a hairline ring, so it reads on any frame
 * without a black box behind it; the live one is the only coloured thing.
 */

export type BadgeVariant =
  | "glass"
  | "live"
  | "dark"
  | "muted"
  // Legacy names from the previous badge, kept so older surfaces still build.
  | "default"
  | "secondary"
  | "destructive"
  | "outline";
export type BadgeSize = "xs" | "sm" | "md";

const SIZE: Record<BadgeSize, string> = {
  xs: "h-[18px] gap-1 px-1.5 text-[0.6rem]",
  sm: "h-[22px] gap-1.5 px-2 text-[0.68rem]",
  md: "h-7 gap-1.5 px-2.5 text-xs",
};

const VARIANT: Record<BadgeVariant, string> = {
  glass:
    "bg-black/60 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]",
  dark: "bg-black/45 text-white/95 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
  live:
    "bg-gradient-to-b from-red-500 to-red-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0_0_1px_rgba(255,255,255,0.08),0_4px_14px_-4px_rgba(239,68,68,0.9)]",
  muted: "bg-white/[0.06] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
  default: "bg-primary text-primary-foreground",
  secondary: "bg-white/[0.06] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]",
  destructive: "bg-red-500/[0.14] text-red-300 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.3)]",
  outline: "text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16)]",
};

export function Badge({
  variant = "glass",
  size = "sm",
  icon,
  className,
  children,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-semibold tracking-wide tabular-nums",
        SIZE[size],
        VARIANT[variant],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** The LIVE badge, with its pulse. */
export function LiveBadge({ size = "sm", className, children }: { size?: BadgeSize; className?: string; children?: ReactNode }) {
  const dot = size === "xs" ? "size-1" : "size-1.5";
  return (
    <Badge
      variant="live"
      size={size}
      className={cn("uppercase", className)}
      icon={
        <span className={cn("relative flex", dot)}>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
          <span className={cn("relative inline-flex rounded-full bg-white", dot)} />
        </span>
      }
    >
      Live{children}
    </Badge>
  );
}
