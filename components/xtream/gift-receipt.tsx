"use client";

import { cn } from "@/lib/utils";
import { GiftArt } from "@/components/app/gift-art";
import { Money } from "@/components/xtream/money";

/**
 * The receipt — Gold Floor's flow, in Afterglow's skin. What a sender sees
 * after a gift goes through, and what a gift looks like in a history: a
 * dashed tear line, the time, the gift, the amount in gold numerals, and
 * who it went from and to. A sheen crosses it once when it appears — value
 * moves with a sheen, never a bounce.
 */
export function GiftReceipt({
  giftName,
  emoji,
  art,
  cents,
  from,
  to,
  at,
  combo,
  animate = true,
  className,
}: {
  giftName: string;
  emoji?: string;
  art?: string;
  cents: number;
  from: string;
  to: string;
  /** When it was sent. A string is shown as given. */
  at: Date | string;
  /** Sent in a row — "×3". */
  combo?: number;
  animate?: boolean;
  className?: string;
}) {
  const time =
    typeof at === "string" ? at : at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div
      className={cn(
        "relative isolate w-full max-w-[20rem] overflow-hidden rounded-panel bg-surface-raised px-4 pt-3.5 pb-3.5",
        "shadow-[inset_0_0_0_1px_rgba(245,199,110,0.28),0_24px_50px_-24px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      {animate && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_34%,rgba(255,236,190,0.18)_50%,transparent_66%)] bg-[length:260%_100%] motion-safe:animate-[xt-sheen_1.5s_.3s_var(--ease-out)_both]"
        />
      )}
      <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-value/30 pb-2.5">
        <span className="caps text-[9.5px] font-bold text-value">Gift receipt</span>
        <time className="font-mono text-[11px] text-muted-foreground tabular-nums">{time}</time>
      </div>
      <div className="flex items-center gap-3 pt-3 pb-2">
        <GiftArt art={art} emoji={emoji} size={40} />
        <span className="min-w-0 flex-1 truncate font-wide text-[18px] leading-none font-semibold tracking-[-0.025em] text-foreground">
          {giftName}
          {combo && combo > 1 ? <span className="ml-1.5 text-[13px] font-bold text-ember-hi">×{combo}</span> : null}
        </span>
        <Money cents={cents * Math.max(1, combo ?? 1)} size="md" />
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {from} <span aria-hidden>→</span>
        <span className="sr-only">to</span> {to}
      </p>
    </div>
  );
}
