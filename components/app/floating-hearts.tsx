"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Floating hearts up the right edge of the mobile live view — one per like
 * event, local taps included. Purely presentational; parents feed it via
 * the imperative handle from `onReady`, since like events arrive inside
 * LiveKit callbacks rather than through React state.
 */

export interface FloatingHeartsHandle {
  push: (emoji?: string) => void;
}

interface Heart {
  id: number;
  emoji: string;
  /** Horizontal drift and rotation, fixed per heart at spawn. */
  hx: number;
  hr: number;
  duration: number;
}

const MAX_ACTIVE = 24;
const HEART_EMOJI = ["❤️", "🧡", "💛", "💜", "🔥"];

export function FloatingHearts({
  onReady,
}: {
  onReady: (handle: FloatingHeartsHandle) => void;
}) {
  const [hearts, setHearts] = useState<Heart[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const push = useCallback((emoji?: string) => {
    const heart: Heart = {
      id: nextId.current++,
      emoji:
        emoji ?? HEART_EMOJI[Math.floor(Math.random() * HEART_EMOJI.length)],
      hx: (Math.random() - 0.5) * 70,
      hr: (Math.random() - 0.5) * 50,
      duration: 2200 + Math.random() * 1400,
    };
    setHearts((prev) => [...prev.slice(-MAX_ACTIVE), heart]);
    const timer = setTimeout(() => {
      setHearts((prev) => prev.filter((h) => h.id !== heart.id));
      timers.current.delete(timer);
    }, heart.duration);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    onReady({ push });
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, [onReady, push]);

  return (
    <div className="pointer-events-none absolute right-3 bottom-28 z-20 h-0 w-12">
      {hearts.map((h) => (
        <span
          key={h.id}
          className="absolute bottom-0 left-1/2 text-2xl"
          style={
            {
              "--hx": `${h.hx}px`,
              "--hr": `${h.hr}deg`,
              animation: `heart-rise ${h.duration}ms ease-out forwards`,
            } as React.CSSProperties
          }
        >
          {h.emoji}
        </span>
      ))}
    </div>
  );
}
