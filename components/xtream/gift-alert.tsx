"use client";

import { giftByEmoji } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { GiftArt } from "@/components/app/gift-art";

/**
 * A gift arriving on the picture — Afterglow's gift moment.
 *
 * `small` is a flat banner that slides in from the left, TikTok-style: the
 * gift breaking out of the left edge, who sent it and what, the amount in
 * a heat pill, and a combo count (×N) when the same gift keeps coming.
 * `big` takes the centre: a bloom, the gift at 96px, the name set wide.
 * Flat, no lit edges (owner, 2026-09-25: no glossy looks) — heat stays on
 * the amount, a gift landing being one of the gradient's moments.
 *
 * This is the look only. Where it sits and how it enters belongs to the
 * surface (GiftOverlay stacks, combos and times them on the player).
 */
export function GiftAlert({
  emoji,
  art,
  giftName,
  from,
  amountLabel,
  size = "small",
  count = 1,
  className,
}: {
  emoji?: string;
  art?: string;
  /** Falls back to the catalog name for `emoji`. */
  giftName?: string;
  from: string;
  amountLabel: string;
  size?: "small" | "big";
  /** The same gift from the same sender, again and again: a combo. */
  count?: number;
  className?: string;
}) {
  const name = giftName ?? giftByEmoji(emoji)?.name ?? "a gift";

  if (size === "big") {
    return (
      <div
        className={cn(
          "relative isolate flex flex-col items-center gap-1 rounded-overlay bg-black/70 px-7 pt-5 pb-4 text-center text-white",
          className,
        )}
      >
        <span aria-hidden className="absolute top-[-10px] left-1/2 -z-10 size-48 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(248,120,16,0.55),rgba(248,88,16,0)_66%)]" />
        <GiftArt art={art} emoji={emoji} size={96} className="drop-shadow-[0_10px_24px_rgba(248,88,16,0.6)]" />
        <span className="mt-1 max-w-[16rem] truncate text-[13px] text-white/75">{from} sent</span>
        <span className="font-wide text-[22px] leading-none font-bold tracking-[-0.025em]">{name}</span>
        <span className="mt-2 rounded-full bg-heat px-3.5 py-1.5 text-[13px] leading-none font-bold">{amountLabel}</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex items-center gap-2.5 rounded-full bg-black/60 py-1.5 pr-1.5 pl-1.5 text-white">
        <GiftArt art={art} emoji={emoji} size={44} className="-my-3 -ml-1" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="max-w-[9rem] truncate text-[11px] text-white/72">{from} sent</span>
          <span className="max-w-[9rem] truncate font-wide text-[15px] leading-tight font-bold tracking-[-0.02em]">{name}</span>
        </span>
        <span className="shrink-0 rounded-full bg-heat px-2.5 py-1.5 text-[12px] leading-none font-bold">{amountLabel}</span>
      </div>
      {count > 1 && (
        // Keyed on the count so each new one pops in.
        <span
          key={count}
          className="font-wide text-[26px] leading-none font-bold tracking-[-0.03em] text-white italic [text-shadow:0_2px_10px_rgba(0,0,0,0.6)] motion-safe:animate-[gift-combo-pop_.35s_var(--ease-spring)_both]"
        >
          ×{count}
        </span>
      )}
    </div>
  );
}
