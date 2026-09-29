"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";

/** Seconds on the clock between the tap and the air. */
export const COUNTDOWN_FROM = 3;

/**
 * The 3·2·1 between tapping Go live and being on air (owner, 2026-09-28:
 * "I just clicked Live and I went live"). The tap starts it, a second tap
 * (or Escape) calls it off, and when it runs out `onDone` goes live. The
 * latest `onDone` is the one called, so the caller can pass a fresh
 * function every render.
 *
 * `onCancel` hears every way a running count is called off — the second
 * tap, Escape, `cancel()` from the caller, leaving mid-count — so work the
 * count started (the studio prepares the stream behind it) is thrown away.
 */
export function useGoLiveCountdown(onDone: () => void, from = COUNTDOWN_FROM, onCancel?: () => void) {
  const [count, setCount] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(onDone);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    doneRef.current = onDone;
    cancelRef.current = onCancel;
  });

  const cancel = useCallback(() => {
    const running = timer.current !== null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCount(null);
    if (running) cancelRef.current?.();
  }, []);

  const start = useCallback(() => {
    if (timer.current) return;
    let n = from;
    setCount(n);
    buzz();
    const step = () => {
      n -= 1;
      if (n > 0) {
        setCount(n);
        buzz();
        timer.current = setTimeout(step, 1000);
        return;
      }
      timer.current = null;
      setCount(null);
      doneRef.current();
    };
    timer.current = setTimeout(step, 1000);
  }, [from]);

  // Escape calls it off, like the second tap.
  const running = count !== null;
  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, cancel]);

  // Leaving the studio mid-count goes nowhere.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      cancelRef.current?.();
    },
    []
  );

  return { count, running, start, cancel };
}

/** A tick under the thumb on phones that have one. */
function buzz() {
  try {
    navigator.vibrate?.(8);
  } catch {
    // No vibration motor, or not allowed: the numbers say it.
  }
}

/**
 * The count over the camera preview: the picture dims a little and each
 * number lands big in the middle. Taps pass through — the Go live button
 * (now "Cancel") stays live above it.
 */
export function CountdownOverlay({ count }: { count: number | null }) {
  if (count === null) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[15] flex items-center justify-center" role="status" aria-live="assertive">
      <div className="animate-fade-in absolute inset-0 bg-black/40" />
      <Numeral key={count} n={count} />
      <span className="sr-only">Going live in {count}</span>
    </div>
  );
}

function Numeral({ n }: { n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = prefersReducedMotion();
    // Transform and opacity only: it drops in from a little larger and settles.
    const a = el.animate(
      reduce
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "scale(1.5)" },
            { opacity: 1, transform: "scale(1)" },
          ],
      { duration: reduce ? DURATION.fade : 520, easing: EASE.unfold, fill: "both" }
    );
    return () => a.cancel();
  }, []);
  return (
    <span
      ref={ref}
      aria-hidden
      className="relative font-wide text-[clamp(96px,32cqmin,220px)] leading-none font-bold tracking-[-0.06em] text-white tabular-nums [text-shadow:0_8px_40px_rgba(0,0,0,0.45)]"
    >
      {n}
    </span>
  );
}
