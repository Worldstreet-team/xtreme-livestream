"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that counts to its value — and jumps straight there if motion
 * is off or the tab is hidden. Rewards' balance and the channel hub's
 * stats both use it.
 */
export function useCountUp(value: number, ms = 900, from?: number) {
  const [shown, setShown] = useState(from ?? value);
  const last = useRef(from ?? value);
  useEffect(() => {
    const start = last.current;
    last.current = value;
    if (start === value) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || document.hidden) {
      const t = setTimeout(() => setShown(value), 0);
      return () => clearTimeout(t);
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // Frames can stall in a background tab; land on the value regardless.
    const land = setTimeout(() => setShown(value), ms + 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(land);
    };
  }, [value, ms]);
  return shown;
}
