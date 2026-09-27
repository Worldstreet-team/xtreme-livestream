import type { CSSProperties } from "react";

/**
 * The unfold language: one set of eases and durations for the surfaces that
 * open out of something you touched — the notifications window, the top
 * gifters board and its full leaderboard, the highlight of the week.
 *
 * The numbers live here once. CSS reads them as custom properties (spread
 * `MOTION_VARS` into a root's `style`), and the few timers that must wait
 * for an exit to finish read `DURATION` directly, so the two never drift.
 *
 * Rules the surfaces keep: transform, opacity and clip-path only; entrances
 * are long and land soft, exits are short and leave fast; under
 * prefers-reduced-motion everything is a plain fade.
 */

export const EASE = {
  /** Out of a trigger: quick off the mark, a long, soft landing. Expo-out. */
  unfold: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** Back into it: accelerates away. Exits are quicker than entrances. */
  fold: "cubic-bezier(0.7, 0, 0.84, 0)",
  /** A small overshoot for things that drop into place — the crown, #1's step. */
  settle: "cubic-bezier(0.34, 1.45, 0.64, 1)",
  /** Slow travel with no arrival bump — a picture pushing in on hover. */
  drift: "cubic-bezier(0.25, 0.1, 0.25, 1)",
} as const;

/** Milliseconds. */
export const DURATION = {
  /** A window unfolding out of its trigger (desktop). */
  unfold: 560,
  /** …and folding back. */
  fold: 200,
  /** A phone panel sliding in from the edge. */
  slide: 480,
  /** …and out. */
  slideOut: 260,
  /** One row settling in. */
  row: 460,
  /** Gap between rows. */
  stagger: 34,
  /** The first row waits for the window to open this far. */
  rowLead: 110,
  /** A podium step rising. */
  rise: 640,
  /** Gap between the podium's steps. */
  step: 120,
  /** The crown dropping onto #1. */
  crown: 620,
  /** Amounts counting up. */
  count: 1100,
  /** A picture's mask opening. */
  reveal: 900,
  /** The slow push-in on hover. */
  push: 1600,
  /** Hover detail sliding up. */
  hover: 420,
  /** Reduced motion: every one of the above becomes this fade. */
  fade: 160,
} as const;

/** The same numbers as custom properties, for a root element's `style`. */
export const MOTION_VARS = {
  "--mo-ease-unfold": EASE.unfold,
  "--mo-ease-fold": EASE.fold,
  "--mo-ease-settle": EASE.settle,
  "--mo-ease-drift": EASE.drift,
  ...Object.fromEntries(Object.entries(DURATION).map(([k, v]) => [`--mo-${k}`, `${v}ms`])),
} as CSSProperties;

/** A row's delay in a staggered list, capped so a long list doesn't dawdle. */
export function staggerDelay(index: number, cap = 10): number {
  return DURATION.rowLead + Math.min(index, cap) * DURATION.stagger;
}

/** True when the viewer asked for less motion. Safe on the server (false). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
