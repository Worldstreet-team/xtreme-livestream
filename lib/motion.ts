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
  /** A tooltip growing out of its arrow: off the mark at once, a ~1% lift past rest, then still. */
  tip: "cubic-bezier(0.22, 1.2, 0.36, 1)",
  /** …and gone: eases in, then leaves quickly. */
  tipOut: "cubic-bezier(0.4, 0, 1, 1)",
  /** The walkthrough's spotlight and card travelling between targets: a patient start, a long, calm arrival. */
  tourGlide: "cubic-bezier(0.77, 0, 0.18, 1)",
  /** The dim closing in on the first target (and opening back up as the tour leaves). */
  tourIris: "cubic-bezier(0.65, 0, 0.12, 1)",
  /** A step's lines rising into place: fast off the mark, then a feather landing. */
  tourText: "cubic-bezier(0.19, 1, 0.22, 1)",
  /** …and the outgoing lines lifting away: they gather speed and go. */
  tourTextOut: "cubic-bezier(0.55, 0, 0.9, 0.35)",
  /** The card arriving: a lift of about 1% past rest, then still. */
  tourRise: "cubic-bezier(0.18, 1.1, 0.3, 1)",
  /**
   * The walkthrough's art: one shape becoming another. A held breath off the
   * mark, a fast middle, then a long, quiet arrival. Colours ride it too.
   */
  morph: "cubic-bezier(0.7, 0, 0.16, 1)",
  /** The same travel for small parts, landing about 5% past and settling back. */
  morphSettle: "cubic-bezier(0.62, 0, 0.22, 1.28)",
  /**
   * Battles: two things meeting hard. Off the mark at once, a firm arrival
   * about 4% past rest, and still — faces clashing into the VS, a card
   * lifting, the tug-of-war knot being yanked toward the leader.
   */
  clash: "cubic-bezier(0.2, 0.9, 0.1, 1.04)",
  /** …and a quick recoil: things snapping back out of the way. */
  clashOut: "cubic-bezier(0.5, 0, 0.75, 0)",
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
  /** A tooltip growing out of its arrow. */
  tip: 240,
  /** …and leaving. */
  tipOut: 110,
  /** Moving from one tooltip to the next, while they're warm: a short cross-fade. */
  tipSwap: 130,
  /** The spotlight gliding from one target to the next; the card follows on the same curve. */
  tourGlide: 760,
  /** The card sets off this far behind the light, so it reads as following it. */
  tourTrail: 50,
  /** The dim closing in on the first target. */
  tourIris: 900,
  /** The card arriving. */
  tourRise: 620,
  /** A step's line rising in. */
  tourText: 680,
  /** …and the outgoing one leaving. */
  tourTextOut: 240,
  /** The incoming lines wait for the outgoing ones to start clearing. */
  tourTextLead: 120,
  /** Between the title and the line. */
  tourTextGap: 75,
  /** The tour leaving. */
  tourExit: 320,
  /** A second pose (the countdown becoming the rings) waits this long. */
  tourBeat: 1500,
  /** One part of the walkthrough's art turning into its next shape. */
  morph: 760,
  /** Gap between parts, so a morph reads as choreography, not a blend… */
  morphStagger: 24,
  /** …capped, so the last part never starts more than this after the first. */
  morphSpan: 170,
  /** Battles: a card's faces clashing into the VS. */
  clash: 380,
  /** …the gap between cards in a row. */
  clashStagger: 60,
  /** A gift's flight from the edge into its side. */
  flight: 620,
  /** The hit: the meter's shake and the face's bump. */
  impact: 280,
  /** The tug-of-war knot travelling to the new split. */
  tug: 720,
  /** A card lifting under the pointer. */
  lift: 180,
  /** Reduced motion: every one of the above becomes this fade. */
  fade: 160,
} as const;

/** The same numbers as custom properties, for a root element's `style`. */
export const MOTION_VARS = {
  "--mo-ease-unfold": EASE.unfold,
  "--mo-ease-fold": EASE.fold,
  "--mo-ease-settle": EASE.settle,
  "--mo-ease-drift": EASE.drift,
  "--mo-ease-morph": EASE.morph,
  "--mo-ease-morph-settle": EASE.morphSettle,
  "--mo-ease-clash": EASE.clash,
  "--mo-ease-clash-out": EASE.clashOut,
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
