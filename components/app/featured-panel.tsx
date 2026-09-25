"use client";

import { useState, type ReactNode } from "react";
import { ChatText, Gift, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { serverNow, serverOffset } from "@/lib/server-clock";
import { useFeaturedShowing } from "@/lib/use-featured";
import { centsToDollars, giftByEmoji } from "@/lib/gifts";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";
import {
  FEATURE_GIFT_TIERS,
  FEATURE_LENGTHS,
  featuredDeadline,
  formatCountdown,
  type FeaturedItem,
  type SuggestedLine,
} from "@/lib/scene";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * The studio's comments on screen: what's up now, how long a comment stays
 * up, and which gifts go up by themselves. Lines go up from chat — the
 * screen icon on any line, or on a gift — so this is where they're watched
 * and taken down, not where they're picked.
 */
export function FeaturedPanel({
  queue = [],
  onPutUp,
  onDismiss,
  featured,
  seconds,
  giftsFrom,
  carded,
  onSeconds,
  onGiftsFrom,
  onTakeDown,
}: {
  /** Lines moderators suggested, waiting on the host. */
  queue?: SuggestedLine[];
  onPutUp?: (messageId: string) => void;
  onDismiss?: (messageId: string) => void;
  featured: FeaturedItem | null;
  /** How long a comment goes up for; 0 is until taken down. */
  seconds: number;
  /** Gifts at or above this many cents go up by themselves; 0 is off. */
  giftsFrom: number;
  /** A card is up, so what's featured is waiting underneath it. */
  carded: boolean;
  onSeconds: (seconds: (typeof FEATURE_LENGTHS)[number]["seconds"]) => void;
  onGiftsFrom: (minor: (typeof FEATURE_GIFT_TIERS)[number]["minor"]) => void;
  onTakeDown: () => void;
}) {
  const showing = useFeaturedShowing(featured);

  return (
    <section aria-labelledby="scenes-featured">
      <p id="scenes-featured" className={LABEL}>On screen</p>

      {queue.length > 0 && (
        <div className="mt-2.5 rounded-[12px] bg-ember/[0.08] p-2">
          <p className="flex items-center gap-2 px-1.5 pt-0.5 pb-1.5 text-[12px] font-semibold text-ember-hi">
            <span className="rounded-full bg-ember px-1.5 font-mono text-[10.5px] font-bold text-on-ember tabular-nums">{queue.length}</span>
            Suggested by your moderators
          </p>
          <ul className="flex flex-col gap-1">
            {queue.map((q) => (
              <li key={q.messageId} className="flex items-start gap-2.5 rounded-[10px] bg-black/25 px-2.5 py-2">
                <span className="mt-0.5 shrink-0 text-muted-foreground">{q.kind === "gift" ? <Gift size={14} /> : <ChatText size={14} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12.5px] leading-snug break-words">
                    <span className="mr-1.5 font-semibold">{q.username}</span>
                    <span className="text-foreground/85">{q.text}</span>
                  </span>
                  {q.suggestedBy && <span className="mt-0.5 block text-[11px] text-muted-foreground">from @{q.suggestedBy}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onPutUp?.(q.messageId)}
                  className="press h-7 shrink-0 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-[#0b0708]"
                >
                  Put up
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss?.(q.messageId)}
                  aria-label={`Turn down ${q.username}'s line`}
                  className="press flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showing ? (
        <div className="mt-2.5 rounded-[12px] bg-white/[0.07] p-3">
          <div className="flex items-start gap-2.5">
            {showing.kind === "gift" ? (
              <GiftArt emoji={showing.emoji ?? "🎁"} size={36} className="shrink-0" />
            ) : (
              <UserAvatar src={showing.avatar} name={showing.username} size={36} className="shrink-0" />
            )}
            <p className="min-w-0 flex-1 text-[13px] leading-snug">
              <span className="block truncate text-[12px] font-semibold text-muted-foreground">{showing.username}</span>
              {showing.kind === "gift" ? (
                <span className="font-semibold">
                  {giftByEmoji(showing.emoji)?.verb ?? showing.text}
                  {showing.amount && (
                    <span className="ml-1.5 font-money text-value">{centsToDollars(Math.round(parseFloat(showing.amount) * 100))}</span>
                  )}
                </span>
              ) : (
                <span className="line-clamp-3 break-words text-foreground/90">{showing.text}</span>
              )}
            </p>
            <button
              type="button"
              onClick={onTakeDown}
              className="press h-8 shrink-0 rounded-full bg-white/[0.08] px-3.5 text-[12px] font-bold text-foreground transition-colors hover:bg-white/[0.12]"
            >
              Take down
            </button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium text-ember-hi">
            <span aria-hidden className="size-1.5 rounded-full bg-ember" />
            {carded ? "Waiting under the card" : <TimeLeft key={`${showing.id}:${showing.at}`} item={showing} />}
            {showing.auto && <span className="text-muted-foreground"> · put up by the gift tier</span>}
          </p>
        </div>
      ) : (
        <p className="mt-2.5 rounded-[12px] bg-white/[0.04] px-3.5 py-3 text-[12.5px] leading-snug text-muted-foreground">
          Nothing up. Choose the screen icon on any line in chat (tap the line on a phone) to put it on stream.
        </p>
      )}

      <p className="mt-4 text-[13px] font-medium text-foreground/85">Comments stay up</p>
      <div role="radiogroup" aria-label="Comments stay up" className="mt-2 flex flex-wrap gap-1.5">
        {FEATURE_LENGTHS.map((l) => (
          <Choice key={l.seconds} on={seconds === l.seconds} onClick={() => onSeconds(l.seconds)}>
            {l.label}
          </Choice>
        ))}
      </div>

      <p className="mt-4 text-[13px] font-medium text-foreground/85">Gifts go up by themselves</p>
      <div role="radiogroup" aria-label="Gifts go up by themselves" className="mt-2 flex flex-wrap gap-1.5">
        {FEATURE_GIFT_TIERS.map((t) => (
          <Choice key={t.minor} on={giftsFrom === t.minor} onClick={() => onGiftsFrom(t.minor)}>
            {t.label}
          </Choice>
        ))}
      </div>
      <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
        {giftsFrom
          ? `Gifts of ${centsToDollars(giftsFrom)} or more go up for ${seconds ? `${seconds < 60 ? `${seconds} seconds` : "a minute"}` : "20 seconds"} — never over a line you put up yourself.`
          : "Saved to your channel, for every stream."}
      </p>
    </section>
  );
}

/** Fixed when first seen — `featuredDeadline` guards a slow clock from the moment it's asked. */
function TimeLeft({ item }: { item: FeaturedItem }) {
  const [deadline] = useState(() => featuredDeadline(item, serverNow()));
  const now = useNow(deadline !== null) + serverOffset();
  if (deadline === null) return <>Up until you take it down</>;
  return <span className="tabular-nums">{formatCountdown(deadline - now)} left</span>;
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "press h-8 rounded-full px-3 text-[12px] font-semibold tabular-nums transition-colors",
        on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
      )}
    >
      {children}
    </button>
  );
}
