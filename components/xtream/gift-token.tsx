"use client";

import { centsToDollars, type GiftDef } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { GiftArt } from "@/components/app/gift-art";

/**
 * One gift, as a sticker — the tile the gift keyboard is made of.
 *
 * Afterglow's states, each its own beat:
 *   rest     the animated face floats on a quiet tile; the price is gold
 *   picked   the tile lifts with an Ember ring; the price lights up in heat
 *   sending  it rises and the face swells, glowing
 *   landed   a burst of sparks and a combo count in heat
 * Heat is allowed here: a gift is one of the gradient's three moments.
 *
 * A <button> when `onClick` is given (the keyboard), otherwise a picture of
 * one (a receipt, the design system).
 */
export type GiftTokenState = "rest" | "picked" | "sending" | "landed";

export function GiftToken({
  gift,
  state = "rest",
  combo,
  dimmed = false,
  size = "md",
  onClick,
  className,
  title,
}: {
  gift: Pick<GiftDef, "name" | "art" | "emoji" | "usdMinor">;
  state?: GiftTokenState;
  /** Shown on `landed` — how many in a row. */
  combo?: number;
  /** Beyond the balance: still tappable (the send row explains), but quieter. */
  dimmed?: boolean;
  size?: "sm" | "md";
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const picked = state === "picked";
  const sending = state === "sending";
  const landed = state === "landed";
  const art = size === "sm" ? 40 : 48;

  const body = (
    <>
      <span
        className={cn(
          "block transition-transform duration-300 [transition-timing-function:var(--ease-spring)]",
          sending ? "-translate-y-1.5 scale-[1.14]" : "motion-safe:animate-[xt-float_3.2s_ease-in-out_infinite]",
        )}
      >
        <GiftArt art={gift.art} emoji={gift.emoji} size={art} />
      </span>
      <span className="mt-0.5 text-[11.5px] leading-tight font-semibold text-foreground/90">{gift.name}</span>
      <span
        className={cn(
          "rounded-full px-2 py-[3px] text-[10.5px] leading-none font-bold tabular-nums transition-colors",
          picked || sending ? "bg-heat text-white" : "bg-white/[0.08] text-value",
        )}
      >
        {centsToDollars(gift.usdMinor)}
      </span>
      {landed && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute top-[34px] left-1/2 size-[5px] -ml-[2px] rounded-full [box-shadow:0_-31px_0_#ffd36b,25px_-19px_0_#ff6a3d,31px_7px_0_#f8a008,4px_30px_0_-1px_#ff2b45,-25px_17px_0_#ffd36b,-29px_-11px_0_#f85810] motion-safe:animate-[xt-sparks-stay_.7s_var(--ease-out)_both]"
          />
          {combo != null && combo > 0 && (
            <span className="absolute -top-2.5 -right-2.5 rounded-full bg-heat px-2 py-1 font-wide text-[12px] leading-none font-extrabold text-white motion-safe:animate-[xt-pop_.5s_var(--ease-spring)_both]">
              ×{combo}
            </span>
          )}
        </>
      )}
    </>
  );

  const cls = cn(
    "relative flex flex-col items-center gap-1 rounded-[16px] px-1 pt-3 pb-2.5 text-center transition-[transform,background-color,box-shadow,opacity] duration-300 [transition-timing-function:var(--ease-spring)]",
    picked || landed
      ? "bg-ember/[0.07] shadow-[inset_0_0_0_1.5px_var(--ember)]"
      : sending
        ? "-translate-y-2 scale-[1.04] bg-ember/[0.1] shadow-[inset_0_0_0_1.5px_#ffb36b]"
        : "bg-white/[0.035] shadow-[inset_0_0_0_1px_rgba(255,236,230,0.08)]",
    dimmed && !picked && "opacity-55",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={picked} title={title} className={cn(cls, "outline-none focus-visible:ring-2 focus-visible:ring-ember active:scale-95", state === "rest" && "hover:bg-white/[0.06]")}>
        {body}
      </button>
    );
  }
  return (
    <span className={cls} title={title}>
      {body}
    </span>
  );
}
