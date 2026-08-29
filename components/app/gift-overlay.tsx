"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * On-video gift spectacle.
 *
 * The gifts route fans every wallet-charged tip into the room as a chat
 * payload (type: "tip"); the chat renders it as a row, and this layer turns
 * the same event into a moment on the player. Big gifts ($10+) hold the
 * center of the frame; smaller ones drift up from the corner so a burst of
 * claps doesn't wallpaper the video.
 *
 * Purely presentational — parents feed it via the imperative handle from
 * `onReady` because the tip events arrive inside a LiveKit callback, not
 * through React state.
 */

export interface GiftEvent {
  id: string;
  username: string;
  emoji: string;
  /** Preformatted, e.g. "$5" or "5.00 USD". */
  amountLabel: string;
  /** Gross USD cents, used only to pick the animation tier. */
  amountUsdMinor: number;
}

export interface GiftOverlayHandle {
  push: (gift: GiftEvent) => void;
}

const BIG_GIFT_MINOR = 1000; // $10+

interface ActiveGift extends GiftEvent {
  tier: "big" | "small";
  /** Deterministic per-gift emoji scatter. */
  seeds: number[];
}

export function GiftOverlay({
  onReady,
}: {
  onReady: (handle: GiftOverlayHandle) => void;
}) {
  const [active, setActive] = useState<ActiveGift[]>([]);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const push = useCallback((gift: GiftEvent) => {
    const tier = gift.amountUsdMinor >= BIG_GIFT_MINOR ? "big" : "small";
    const entry: ActiveGift = {
      ...gift,
      tier,
      seeds: Array.from({ length: tier === "big" ? 10 : 4 }, () =>
        Math.random(),
      ),
    };
    setActive((prev) => [...prev.slice(-4), entry]);
    const timer = setTimeout(
      () => {
        setActive((prev) => prev.filter((g) => g.id !== entry.id));
        timers.current.delete(timer);
      },
      tier === "big" ? 4000 : 3000,
    );
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    onReady({ push });
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, [onReady, push]);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {active.map((gift, idx) =>
        gift.tier === "big" ? (
          <div
            key={gift.id}
            className="absolute top-1/2 left-1/2"
            style={{ animation: "gift-pop 4s ease-out forwards" }}
          >
            <div className="flex flex-col items-center gap-1 rounded-2xl border border-yellow-400/30 bg-black/70 px-6 py-4 backdrop-blur-md">
              <span className="text-5xl leading-none drop-shadow-lg">
                {gift.emoji}
              </span>
              <span className="mt-1 max-w-[16rem] truncate text-sm font-bold text-white">
                {gift.username}
              </span>
              <span className="text-lg font-extrabold text-yellow-300">
                {gift.amountLabel}
              </span>
            </div>
            {/* Emoji burst around the card */}
            {gift.seeds.map((seed, i) => (
              <span
                key={i}
                className="absolute top-0 text-2xl"
                style={{
                  left: `${(seed - 0.5) * 220}px`,
                  ["--gift-rot" as string]: `${(seed - 0.5) * 60}deg`,
                  animation: `gift-emoji-rise ${1.6 + seed}s ease-out ${
                    i * 0.12
                  }s forwards`,
                  opacity: 0,
                }}
              >
                {gift.emoji}
              </span>
            ))}
          </div>
        ) : (
          <div
            key={gift.id}
            className="absolute left-4"
            // Stagger concurrent small gifts so a clap volley stacks
            // upward instead of piling onto one spot.
            style={{
              bottom: `${64 + idx * 46}px`,
              animation: "gift-float 3s ease-out forwards",
            }}
          >
            <div className="flex items-center gap-2 rounded-full border border-yellow-400/20 bg-black/70 py-1.5 pr-3.5 pl-2.5 backdrop-blur-sm">
              <span className="text-xl leading-none">{gift.emoji}</span>
              <span className="max-w-[10rem] truncate text-xs font-semibold text-white">
                {gift.username}
              </span>
              <span className="text-xs font-bold text-yellow-300">
                {gift.amountLabel}
              </span>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
