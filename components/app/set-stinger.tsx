"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { useReducedMotion } from "@/components/app/gift-effects";
import type { SetManifest, StingerStyle } from "@/lib/sets";
import { cn } from "@/lib/utils";

/**
 * A Set's stinger (Phase 4): a short full-frame transition in the set's
 * colours, over the program, when the layout changes — bands of colour
 * sweep across it while the tiles glide underneath, so the cut lands
 * under cover. All CSS (Web Animations on a few flat blocks), under 600 ms,
 * and nothing at all under reduced motion.
 *
 * Mount it over the program; it plays whenever `trigger` changes (the
 * scene's layout, say) after the first render, and is invisible between.
 */

interface Band {
  style: CSSProperties;
  keyframes: Keyframe[];
  duration: number;
  delay: number;
  /** Over the whole move: one-way moves ease as a whole, in-hold-out moves ease each leg. */
  easing: string;
}

const INK = "#0b0708";
const SWEEP_EASE = "cubic-bezier(0.65, 0, 0.35, 1)";
/** Legs of an in-hold-out move: quick to cover, quick to clear. */
const IN = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const OUT = "cubic-bezier(0.7, 0, 0.84, 0)";

/** Each style's blocks and moves, in the set's colours. */
export function stingerBands(style: StingerStyle, palette: readonly string[]): Band[] {
  const c = (i: number) => palette[i % palette.length] ?? INK;
  switch (style) {
    case "sweep":
      // Three slanted bands, one after another, left to right.
      return [0, 1, 2].map((i) => ({
        style: { top: "-20%", bottom: "-20%", left: 0, width: "46%", background: c(i) },
        keyframes: [
          { transform: "translateX(-130%) skewX(-16deg)", opacity: 1 },
          { transform: "translateX(330%) skewX(-16deg)", opacity: 1 },
        ],
        duration: 500,
        delay: i * 40,
        easing: SWEEP_EASE,
      }));
    case "tape":
      // Six strips, in from alternate sides like a price tape, and on out.
      return Array.from({ length: 6 }, (_, i) => {
        const from = i % 2 ? "-101%" : "101%";
        const to = i % 2 ? "101%" : "-101%";
        return {
          style: { left: 0, right: 0, top: `${(i * 100) / 6}%`, height: `calc(${100 / 6}% + 1px)`, background: i % 2 ? c(0) : INK },
          keyframes: [
            { transform: `translateX(${from})`, opacity: 1, easing: IN },
            { transform: "translateX(0)", opacity: 1, offset: 0.42 },
            { transform: "translateX(0)", opacity: 1, offset: 0.58, easing: OUT },
            { transform: `translateX(${to})`, opacity: 1 },
          ],
          duration: 510,
          delay: i * 14,
          easing: "linear",
        };
      });
    case "shutter":
      // Two halves slam shut on a bright seam, and open again.
      return [
        {
          style: { left: 0, right: 0, top: 0, height: "50.5%", background: c(0) },
          keyframes: [
            { transform: "translateY(-100%)", opacity: 1, easing: IN },
            { transform: "translateY(0)", opacity: 1, offset: 0.4 },
            { transform: "translateY(0)", opacity: 1, offset: 0.6, easing: OUT },
            { transform: "translateY(-100%)", opacity: 1 },
          ],
          duration: 480,
          delay: 0,
          easing: "linear",
        },
        {
          style: { left: 0, right: 0, bottom: 0, height: "50.5%", background: c(1) },
          keyframes: [
            { transform: "translateY(100%)", opacity: 1, easing: IN },
            { transform: "translateY(0)", opacity: 1, offset: 0.4 },
            { transform: "translateY(0)", opacity: 1, offset: 0.6, easing: OUT },
            { transform: "translateY(100%)", opacity: 1 },
          ],
          duration: 480,
          delay: 0,
          easing: "linear",
        },
        {
          style: { left: 0, right: 0, top: "calc(50% - 2px)", height: 4, background: c(2) },
          keyframes: [
            { transform: "scaleX(0)", opacity: 0, easing: IN },
            { transform: "scaleX(1)", opacity: 1, offset: 0.4 },
            { transform: "scaleX(1)", opacity: 1, offset: 0.6, easing: OUT },
            { transform: "scaleX(0)", opacity: 0 },
          ],
          duration: 480,
          delay: 0,
          easing: "linear",
        },
      ];
    case "wash":
      // A soft wash of colour, in and out.
      return [
        {
          style: { inset: 0, background: c(0) },
          keyframes: [
            { opacity: 0, transform: "scale(1.04)", easing: IN },
            { opacity: 0.9, transform: "scale(1)", offset: 0.45, easing: "ease-in" },
            { opacity: 0, transform: "scale(1)" },
          ],
          duration: 500,
          delay: 0,
          easing: "linear",
        },
      ];
  }
}

/** The longest a style runs, start to finish. */
export function stingerMs(style: StingerStyle) {
  return Math.max(...stingerBands(style, [INK]).map((b) => b.delay + b.duration));
}

export function SetStinger({ set, trigger, className }: { set: SetManifest | null | undefined; trigger: unknown; className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // The trigger it last saw: mounting (twice, in dev's strict mode) never plays it.
  const seen = useRef(trigger);
  const reduced = useReducedMotion();
  const style = set?.stinger ?? null;
  const palette = set?.palette;
  const bands = style && palette ? stingerBands(style, palette) : [];

  useEffect(() => {
    if (Object.is(seen.current, trigger)) return;
    seen.current = trigger;
    const root = rootRef.current;
    if (!style || !palette || reduced || !root || typeof root.animate !== "function") return;
    const plan = stingerBands(style, palette);
    const els = Array.from(root.children) as HTMLElement[];
    const runs = plan.map((band, i) => els[i]?.animate(band.keyframes, { duration: band.duration, delay: band.delay, easing: band.easing, fill: "none" }));
    // A second change mid-stinger starts it over.
    return () => runs.forEach((a) => a?.cancel());
    // Only a new trigger plays it; a new set waits for the next change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  if (!bands.length) return null;
  return (
    <div ref={rootRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {bands.map((b, i) => (
        <div key={i} className="absolute" style={{ ...b.style, opacity: 0, willChange: "transform, opacity" }} />
      ))}
    </div>
  );
}
