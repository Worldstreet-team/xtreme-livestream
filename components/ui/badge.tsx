import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small label that sits on a picture: LIVE, a viewer count, an uptime,
 * a category. Afterglow's object language — black at 55%, a hairline edge
 * and a lit top — so it reads on any frame without a box behind it. LIVE is
 * solid Chili with a glow (the tally); `value` is money, in gold.
 */

export type BadgeVariant =
  | "glass"
  | "live"
  | "dark"
  | "muted"
  | "ember"
  | "value"
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

const OBJ = "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.1)]";

const VARIANT: Record<BadgeVariant, string> = {
  glass: `bg-black/55 text-white ${OBJ}`,
  dark: `bg-black/70 text-white/95 ${OBJ}`,
  live: "bg-chili text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_6px_18px_-6px_rgba(227,18,42,0.85)]",
  muted: "bg-white/[0.06] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)]",
  ember: "bg-ember text-on-ember shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]",
  value: "bg-black/60 text-value shadow-[inset_0_0_0_1px_rgba(245,199,110,0.35),inset_0_1px_0_rgba(255,255,255,0.08)]",
  default: "bg-primary text-primary-foreground",
  secondary: "bg-white/[0.06] text-muted-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)]",
  destructive: "bg-chili/15 text-chili-hi shadow-[inset_0_0_0_1px_rgba(255,90,102,0.3)]",
  outline: "text-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.16)]",
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
