import { GIFT_KEYS, type GiftId } from "@xtreme/contracts";

/**
 * Practice battles: a host in a practice run (practice.ts) tries a whole
 * battle round against a stand-in — the "Sparring partner" — so they see
 * how one goes before they take on a real host.
 *
 * It is a real Battle doc run by the real machinery in battles.ts (the
 * clock, ×2 in the closing window, the late-gift reset, overtime on a tie,
 * the sweep that settles it, the room events and polls every screen
 * already reads), marked `practice: true`. What makes it practice:
 *
 * - the challenger is nobody: its user and stream ids point at nothing,
 *   and the view names it "Sparring partner";
 * - every gift is simulated and kept on the battle itself
 *   (`practiceGifts`) — no GiftTransaction, so no wallet, earnings, fans,
 *   levels, quests or heat ever see one;
 * - settling pays nothing, audits nothing, relays nothing and tells no one;
 * - no list, row, rail, history or quick match ever shows it.
 *
 * This module is the sparring partner's script, and pure: given the score
 * and the clock it says who gifts next, what, and when. The sweep in
 * battles.ts plays it once a second.
 */

/** A practice round: a minute and a half, so the ×2 window comes round quickly. */
export const PRACTICE_BATTLE_SEC = 90;
/** The stand-in on the other side. */
export const SPARRING_NAME = "Sparring partner";
/** How many simulated gifts a practice battle keeps (the feed shows a handful). */
export const PRACTICE_GIFTS_KEPT = 80;
/** The first simulated gift lands this soon after the bell. */
export const PRACTICE_FIRST_MOVE_MS = 2_000;
/** With this little left, and the late reset still unused, the sparring partner surges. */
export const PRACTICE_SURGE_MS = 7_000;

/**
 * The crowds. Fictional first names only: the sparring partner's backers,
 * and a few on the host's side so the round moves even before the host
 * sends a test gift of their own (the same names as the practice run's
 * simulated chat).
 */
export const SPARRING_CROWD = ["bayo", "funmi", "ike_j", "zainab", "obi_n"] as const;
export const HOST_CROWD = ["ada_k", "tolu", "suya_sam", "kemi", "ngozi"] as const;

export interface PracticeGiftDef {
  id: GiftId;
  name: string;
  emoji: string;
  usdMinor: number;
}

/** "tsion-car" → "Tsion Car": the catalog's ids are its names, lower-cased. */
export function giftNameOf(id: string) {
  return id
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** A catalog gift, as a practice gift. Null for an id the catalog doesn't have. */
export function practiceGiftDef(id: string): PracticeGiftDef | null {
  const g = GIFT_KEYS.find((k) => k.id === id);
  return g ? { id: g.id, name: giftNameOf(g.id), emoji: g.emoji, usdMinor: g.usdMinor } : null;
}

/** The rungs a simulated gift is picked from: Clap up to Lion. */
const LADDER: PracticeGiftDef[] = GIFT_KEYS.slice(0, 9).map((g) => practiceGiftDef(g.id)!);
/** The everyday ones: Clap to Party. */
const SMALL = LADDER.slice(0, 5);
/** The biggest an ordinary move goes: a Crown. A surge may go to a Lion. */
const ORDINARY_MAX = 10_000;

/** The smallest rung worth at least `minor`, capped at `max`. */
function rungFor(minor: number, max: number) {
  const fits = LADDER.filter((g) => g.usdMinor <= max);
  return fits.find((g) => g.usdMinor >= minor) ?? fits[fits.length - 1]!;
}

export interface PracticeMoveInput {
  now: number;
  endsAt: number;
  hostUsdMinor: number;
  challengerUsdMinor: number;
  multiplier: number;
  multiplierWindowSec: number;
  lateResetUsed: boolean;
}

export interface PracticeMove {
  side: "host" | "challenger";
  gift: PracticeGiftDef;
  sender: string;
  /** A late surge: the sparring partner's big answer in the last seconds. */
  surge: boolean;
  /** When the next move is due. */
  nextAt: number;
}

/**
 * The next simulated gift. The side that's behind moves more often and
 * reaches for a gift near the gap, so the lead keeps changing hands; the
 * one ahead drops small ones. In the ×2 window the rhythm quickens. With
 * seconds left and the late reset unused, the sparring partner surges with
 * a big one that takes the lead — which doubles and resets the clock to
 * 15 s, so the host sees both rules at work.
 */
export function practiceMove(input: PracticeMoveInput, rand: () => number = Math.random): PracticeMove {
  const left = input.endsAt - input.now;
  const hot = left <= input.multiplierWindowSec * 1000;
  const mult = hot ? input.multiplier : 1;
  const diff = input.hostUsdMinor - input.challengerUsdMinor;
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length) % list.length]!;

  let side: PracticeMove["side"];
  let gift: PracticeGiftDef;
  const surge = isSurgeDue(input);
  if (surge) {
    side = "challenger";
    // Enough to take the lead after the ×2, and never less than a Diamond.
    gift = rungFor(Math.max(2_000, Math.ceil((Math.max(0, diff) + 500) / mult)), 20_000);
  } else {
    const sparringOdds = diff > 0 ? 0.78 : diff < 0 ? 0.35 : 0.55;
    side = rand() < sparringOdds ? "challenger" : "host";
    const behind = side === "challenger" ? diff > 0 : diff < 0;
    if (behind && rand() < 0.7) {
      // Somewhere around the gap: sometimes short of it, sometimes past it.
      gift = rungFor(Math.ceil((Math.abs(diff) * (0.6 + rand())) / mult), ORDINARY_MAX);
    } else {
      // Mostly the small ones.
      gift = SMALL[Math.min(SMALL.length - 1, Math.floor(rand() * rand() * SMALL.length))]!;
    }
  }

  const gap = hot ? 1_500 + rand() * 1_800 : 2_500 + rand() * 3_500;
  let nextAt = input.now + gap;
  // Never skip past the surge: the move that lands on it is the surge.
  const surgeAt = input.endsAt - PRACTICE_SURGE_MS;
  if (!input.lateResetUsed && !surge && input.now < surgeAt && nextAt > surgeAt) nextAt = surgeAt;
  return { side, gift, sender: pick(side === "host" ? HOST_CROWD : SPARRING_CROWD), surge, nextAt };
}

/** Is it time for the sparring partner's late surge? */
export function isSurgeDue(input: Pick<PracticeMoveInput, "now" | "endsAt" | "lateResetUsed">) {
  const left = input.endsAt - input.now;
  return !input.lateResetUsed && left <= PRACTICE_SURGE_MS + 1_000 && left > 0;
}
