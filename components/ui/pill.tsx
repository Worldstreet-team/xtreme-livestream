"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The button. One shape (a pill), a few tones, three sizes.
 *
 *  - primary  the one action on a surface: a lit gradient with a soft glow
 *  - live     red, for going on air and things that are on air now
 *  - glass    everything secondary: frosted, hairline ring, lifts on hover
 *  - soft     tinted glass in a tone (red / amber / green) for states
 *  - ghost    text only, for the least important thing in a row
 *
 * Icons go in `icon`; they get the right size for the pill automatically.
 */

export type PillVariant = "primary" | "live" | "glass" | "soft" | "ghost";
export type PillTone = "neutral" | "red" | "amber" | "green" | "sky";
export type PillSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-semibold tracking-[-0.005em] transition-[background-color,box-shadow,transform,color,filter] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-white/40 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

const SIZE: Record<PillSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
  lg: "h-11 gap-2 px-5 text-[15px]",
};
const ICON_ONLY: Record<PillSize, string> = { sm: "size-8 px-0", md: "size-9 px-0", lg: "size-11 px-0" };
export const PILL_ICON: Record<PillSize, number> = { sm: 14, md: 16, lg: 18 };

/**
 * Direction: "Solid mono" (owner's pick, 2026-09-06). Flat fills, no blur:
 * a white primary, charcoal secondaries, opaque tinted states. Only `live`
 * carries the accent, because on air is the one thing that should be red.
 */
const VARIANT: Record<PillVariant, string> = {
  primary: "bg-white text-neutral-950 shadow-[0_8px_24px_-12px_rgba(255,255,255,0.45)] hover:bg-neutral-100",
  live: "bg-red-600 text-white shadow-[0_8px_24px_-10px_rgba(239,68,68,0.8)] hover:bg-red-500",
  glass: "bg-[#26262D] text-foreground/90 hover:bg-[#31313A] hover:text-foreground",
  soft: "",
  ghost: "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
};

const SOFT_TONE: Record<PillTone, string> = {
  neutral: "bg-[#26262D] text-foreground/90 hover:bg-[#31313A]",
  red: "bg-[#3A1F1C] text-[#FFB4A8] hover:bg-[#4A2622]",
  amber: "bg-[#3A2E14] text-[#FFD36B] hover:bg-[#4A3A19]",
  green: "bg-[#173428] text-[#86EFAC] hover:bg-[#1D4232]",
  sky: "bg-[#14303A] text-[#7DD3FC] hover:bg-[#1A3E4A]",
};

export function pillClass({
  variant = "glass",
  tone = "neutral",
  size = "md",
  iconOnly = false,
  className,
}: {
  variant?: PillVariant;
  tone?: PillTone;
  size?: PillSize;
  iconOnly?: boolean;
  className?: string;
}) {
  return cn(
    BASE,
    iconOnly ? ICON_ONLY[size] : SIZE[size],
    variant === "soft" ? SOFT_TONE[tone] : VARIANT[variant],
    className
  );
}

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillVariant;
  tone?: PillTone;
  size?: PillSize;
  icon?: ReactNode;
  /** Icon on the right instead of the left. */
  trailing?: ReactNode;
  iconOnly?: boolean;
}

export const Pill = forwardRef<HTMLButtonElement, PillProps>(function Pill(
  { variant, tone, size = "md", icon, trailing, iconOnly, className, children, type = "button", ...rest },
  ref
) {
  return (
    <button ref={ref} type={type} className={pillClass({ variant, tone, size, iconOnly, className })} {...rest}>
      {icon}
      {!iconOnly && children}
      {trailing}
    </button>
  );
});

/** The same pill, as a link. */
export function PillLink({
  href,
  variant,
  tone,
  size = "md",
  icon,
  trailing,
  iconOnly,
  className,
  children,
  external,
  ...rest
}: {
  href: string;
  external?: boolean;
} & Omit<PillProps, "type">) {
  const cls = pillClass({ variant, tone, size, iconOnly, className });
  if (external) {
    return (
      <a href={href} className={cls} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
        {icon}
        {!iconOnly && children}
        {trailing}
      </a>
    );
  }
  return (
    <Link href={href} className={cls} {...(rest as React.AnchorHTMLAttributes<HTMLAnchorElement>)}>
      {icon}
      {!iconOnly && children}
      {trailing}
    </Link>
  );
}
