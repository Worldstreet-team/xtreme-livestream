import { cn } from "@/lib/utils";

/**
 * Money, the Gold Floor way — borrowed from direction C. Archivo at its
 * widest and thin, tabular, in gold: the watch-dial numerals that make a
 * $2,500 gift or a wallet balance look like it costs something. Gold is
 * reserved for money; nothing else in Afterglow wears it.
 *
 * Values are USD cents, like the rest of the app (`usdMinor`).
 */

const SIZE = {
  sm: "text-[15px]",
  md: "text-[20px]",
  lg: "text-[30px]",
  xl: "text-[clamp(2.5rem,7vw,4rem)]",
} as const;

const TONE = {
  value: "text-value",
  ink: "text-foreground",
  muted: "text-muted-foreground",
} as const;

/** "$1,500", "$0.50", or compact "$12.5K" / "$1.2M". */
export function formatUsd(cents: number, compact = false): string {
  const dollars = cents / 100;
  if (compact && Math.abs(dollars) >= 1000) {
    const [n, unit] = Math.abs(dollars) >= 1_000_000 ? [dollars / 1_000_000, "M"] : [dollars / 1000, "K"];
    return `$${n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, "")}${unit}`;
  }
  return cents % 100 === 0
    ? `$${dollars.toLocaleString("en-US")}`
    : `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Money({
  cents,
  size = "md",
  tone = "value",
  compact = false,
  className,
}: {
  cents: number;
  size?: keyof typeof SIZE;
  tone?: keyof typeof TONE;
  /** Shorten thousands and millions — for tight rows and scoreboards. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("font-money leading-none whitespace-nowrap", SIZE[size], TONE[tone], className)}>
      {formatUsd(cents, compact)}
    </span>
  );
}
