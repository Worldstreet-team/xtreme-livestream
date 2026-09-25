import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The small label that sits on a picture: LIVE, a viewer count, an uptime,
 * a category. Flat (owner, 2026-09-25: "yes i want them flat too") — black
 * at 55% so it reads on any frame, no edge, no sheen, no glow. LIVE is solid
 * Chili; `value` is money, in gold.
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


const VARIANT: Record<BadgeVariant, string> = {
  glass: "bg-black/55 text-white",
  dark: "bg-black/70 text-white/95",
  live: "bg-chili text-white",
  muted: "bg-white/[0.06] text-muted-foreground",
  ember: "bg-ember text-on-ember",
  value: "bg-black/60 text-value",
  default: "bg-primary text-primary-foreground",
  secondary: "bg-white/[0.06] text-muted-foreground",
  destructive: "bg-chili/15 text-chili-hi",
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
