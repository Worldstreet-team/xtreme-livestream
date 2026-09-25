"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GiftAlert } from "@/components/xtream/gift-alert";

/**
 * On-video gift spectacle.
 *
 * The gifts route fans every wallet-charged tip into the room as a chat
 * payload (type: "tip"); the chat writes the line, and this layer turns the
 * same event into a moment on the player. Big gifts ($10+) hold the centre
 * of the frame. Smaller ones are TikTok's banners: they slide in on the
 * left, two or three deep, and the same gift from the same sender while its
 * banner is up counts up (×2, ×3…) instead of stacking another.
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
const BIG_MS = 4000;
const SMALL_MS = 3200;
/** The banner's slide-out, played before it's removed. */
const EXIT_MS = 260;

interface ActiveGift extends GiftEvent {
  tier: "big" | "small";
  /** Deterministic per-gift emoji scatter. */
  seeds: number[];
  count: number;
  leaving: boolean;
}

export function GiftOverlay({
  onReady,
  laneBottom = "64px",
}: {
  onReady: (handle: GiftOverlayHandle) => void;
  /** Where the banner lane starts, from the bottom — phones lift it above the chat. */
  laneBottom?: string;
}) {
  const [active, setActive] = useState<ActiveGift[]>([]);
  // The live list, for deciding combos synchronously inside room callbacks.
  const activeRef = useRef<ActiveGift[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

  const push = useCallback((gift: GiftEvent) => {
    const commit = (next: ActiveGift[]) => {
      activeRef.current = next;
      setActive(next);
    };
    const clear = (id: string) => {
      timers.current.get(id)?.forEach(clearTimeout);
      timers.current.delete(id);
    };
    // Leave after `ms`: slide out, then go.
    const schedule = (id: string, ms: number) => {
      clear(id);
      timers.current.set(id, [
        setTimeout(() => commit(activeRef.current.map((g) => (g.id === id ? { ...g, leaving: true } : g))), ms - EXIT_MS),
        setTimeout(() => {
          timers.current.delete(id);
          commit(activeRef.current.filter((g) => g.id !== id));
        }, ms),
      ]);
    };

    const tier = gift.amountUsdMinor >= BIG_GIFT_MINOR ? "big" : "small";
    const combo =
      tier === "small"
        ? activeRef.current.find((g) => g.tier === "small" && !g.leaving && g.username === gift.username && g.emoji === gift.emoji)
        : undefined;
    if (combo) {
      commit(activeRef.current.map((g) => (g.id === combo.id ? { ...g, count: g.count + 1 } : g)));
      schedule(combo.id, SMALL_MS);
      return;
    }

    const entry: ActiveGift = {
      ...gift,
      tier,
      count: 1,
      leaving: false,
      seeds: Array.from({ length: tier === "big" ? 10 : 4 }, () => Math.random()),
    };
    // Three small banners at most; the oldest makes room.
    const smalls = activeRef.current.filter((g) => g.tier === "small");
    const bumped = tier === "small" && smalls.length >= 3 ? smalls[0].id : null;
    if (bumped) clear(bumped);
    commit([...activeRef.current.filter((g) => g.id !== bumped).slice(-4), entry]);
    schedule(entry.id, tier === "big" ? BIG_MS : SMALL_MS);
  }, []);

  useEffect(() => {
    onReady({ push });
  }, [onReady, push]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((list) => list.forEach(clearTimeout));
      pending.clear();
    };
  }, []);

  const smalls = active.filter((g) => g.tier === "small");

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {active
        .filter((g) => g.tier === "big")
        .map((gift) => (
          <div key={gift.id} className="absolute top-1/2 left-1/2" style={{ animation: "gift-pop 4s ease-out forwards" }}>
            <GiftAlert size="big" emoji={gift.emoji} from={gift.username} amountLabel={gift.amountLabel} />
            {/* Emoji burst around the card */}
            {gift.seeds.map((seed, i) => (
              <span
                key={i}
                className="absolute top-0 text-2xl"
                style={{
                  left: `${(seed - 0.5) * 220}px`,
                  ["--gift-rot" as string]: `${(seed - 0.5) * 60}deg`,
                  animation: `gift-emoji-rise ${1.6 + seed}s ease-out ${i * 0.12}s forwards`,
                  opacity: 0,
                }}
              >
                {gift.emoji}
              </span>
            ))}
          </div>
        ))}

      {/* The banner lane: newest at the bottom, the way chat reads. */}
      <div className="absolute left-3 flex flex-col-reverse gap-2" style={{ bottom: laneBottom }}>
        {[...smalls].reverse().map((gift) => (
          <div
            key={gift.id}
            style={{
              animation: gift.leaving
                ? `gift-slide-out ${EXIT_MS}ms ease-in forwards`
                : "gift-slide-in 260ms var(--ease-out) both",
            }}
          >
            <GiftAlert emoji={gift.emoji} from={gift.username} amountLabel={gift.amountLabel} count={gift.count} />
          </div>
        ))}
      </div>
    </div>
  );
}
