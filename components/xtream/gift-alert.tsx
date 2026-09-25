"use client";

import { giftByEmoji } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { GiftArt } from "@/components/app/gift-art";

/**
 * A gift arriving on the picture — the burst, Afterglow's gift moment.
 *
 * `small` is a lit pill that slides in from the corner: the face breaking
 * out of the left edge over a bloom, who sent it, what, and the amount in a
 * heat pill. `big` takes the centre: a larger bloom, the face at 96px, the
 * name set wide. Heat is allowed — a gift landing is one of the gradient's
 * three moments.
 *
 * This is the look only. Where it sits and how it enters belongs to the
 * surface (GiftOverlay stacks and times them on the player).
 */
export function GiftAlert({
  emoji,
  art,
  giftName,
  from,
  amountLabel,
  size = "small",
  className,
}: {
  emoji?: string;
  art?: string;
  /** Falls back to the catalog name for `emoji`. */
  giftName?: string;
  from: string;
  amountLabel: string;
  size?: "small" | "big";
  className?: string;
}) {
  const name = giftName ?? giftByEmoji(emoji)?.name ?? "a gift";

  if (size === "big") {
    return (
      <div
        className={cn(
          "relative isolate flex flex-col items-center gap-1 rounded-overlay bg-black/65 px-7 pt-5 pb-4 text-center text-white",
          "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.14),0_30px_70px_-20px_rgba(248,88,16,0.6)]",
          className,
        )}
      >
        <span aria-hidden className="absolute top-[-10px] left-1/2 -z-10 size-48 -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(248,120,16,0.55),rgba(248,88,16,0)_66%)]" />
        <GiftArt art={art} emoji={emoji} size={96} className="drop-shadow-[0_10px_24px_rgba(248,88,16,0.6)]" />
        <span className="mt-1 max-w-[16rem] truncate text-[13px] text-white/75">{from} sent</span>
        <span className="font-wide text-[22px] leading-none font-bold tracking-[-0.025em]">{name}</span>
        <span className="mt-2 rounded-full bg-heat px-3.5 py-1.5 text-[13px] leading-none font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
          {amountLabel}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative isolate flex items-center gap-2.5 rounded-full bg-black/62 py-1.5 pr-1.5 pl-1.5 text-white",
        "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),inset_0_1px_0_rgba(255,255,255,0.14),0_18px_44px_-12px_rgba(248,88,16,0.6)]",
        className,
      )}
    >
      <span aria-hidden className="absolute top-1/2 left-[-14px] -z-10 size-24 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(248,120,16,0.5),rgba(248,88,16,0)_66%)]" />
      <GiftArt art={art} emoji={emoji} size={44} className="-my-3 -ml-1 drop-shadow-[0_8px_16px_rgba(248,88,16,0.6)]" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="max-w-[9rem] truncate text-[11px] text-white/72">{from} sent</span>
        <span className="max-w-[9rem] truncate font-wide text-[15px] leading-tight font-bold tracking-[-0.02em]">{name}</span>
      </span>
      <span className="shrink-0 rounded-full bg-heat px-2.5 py-1.5 text-[12px] leading-none font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
        {amountLabel}
      </span>
    </div>
  );
}
