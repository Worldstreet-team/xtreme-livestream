"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The button. One shape (a pill), a few tones, four sizes — Afterglow
 * (owner's pick, 2026-09-23).
 *
 *  - primary  white on dark, ink on light: the one neutral action on a
 *             surface (Ally, Watch)
 *  - live     Chili, solid: things that are on air, or put you on air
 *  - heat     the gradient — Go live and gift moments only (the allowlist)
 *  - ember    Ember, flat, dark ink: energy — claim, join, start a game
 *  - glass    the quiet control: flat warm charcoal
 *  - soft     a tinted control in a tone, for states
 *  - ghost    text only, for the least important thing in a row
 *
 * Presses spring (scale .94 on the overshoot curve); focus is an ember ring.
 * Icons go in `icon`; `PILL_ICON` gives the matching glyph size.
 */

export type PillVariant = "primary" | "live" | "heat" | "ember" | "glass" | "soft" | "ghost";
export type PillTone = "neutral" | "red" | "ember" | "amber" | "green" | "sky";
export type PillSize = "sm" | "md" | "lg" | "xl";

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-semibold tracking-[-0.005em] transition-[background-color,box-shadow,transform,color,filter] duration-200 [transition-timing-function:var(--ease-spring)] outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.94] disabled:pointer-events-none disabled:opacity-50";

const SIZE: Record<PillSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-9 gap-2 px-4 text-sm",
  lg: "h-11 gap-2 px-5 text-[15px]",
  xl: "h-[52px] gap-2 px-6 text-[15.5px]",
};
const ICON_ONLY: Record<PillSize, string> = { sm: "size-8 px-0", md: "size-9 px-0", lg: "size-11 px-0", xl: "size-[52px] px-0" };
export const PILL_ICON: Record<PillSize, number> = { sm: 14, md: 16, lg: 18, xl: 19 };

const VARIANT: Record<PillVariant, string> = {
  primary: "bg-inverse text-on-inverse hover:bg-inverse/90",
  live: "bg-chili text-white hover:brightness-110",
  heat: "bg-heat text-white hover:brightness-110",
  ember: "bg-ember text-on-ember hover:brightness-105",
  glass: "bg-control text-foreground/90 hover:bg-control-hover hover:text-foreground",
  soft: "",
  ghost: "text-muted-foreground hover:bg-tint/[0.06] hover:text-foreground",
};

const SOFT_TONE: Record<PillTone, string> = {
  neutral: "bg-control text-foreground/90 hover:bg-control-hover",
  red: "bg-tone-red text-chili-hi hover:bg-tone-red-hover",
  ember: "bg-tone-ember text-ember-hi hover:bg-tone-ember-hover",
  amber: "bg-tone-amber text-value hover:bg-tone-amber-hover",
  green: "bg-tone-green text-tone-green-ink hover:bg-tone-green-hover",
  sky: "bg-tone-sky text-tone-sky-ink hover:bg-tone-sky-hover",
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
