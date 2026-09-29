/**
 * Battles, as the client sees them. The server owns the clock, the scores
 * and the settlement; everything here is rendering and time arithmetic.
 */

import { GIFT_CATALOG, type GiftDef } from "./gifts";

export type BattleStatus = "scheduled" | "invited" | "live" | "overtime" | "ended" | "cancelled";
/** 1v1, or 2v2: each side is its stream and the partner on its stage. */
export type BattleMode = "1v1" | "2v2";

export interface BattlePartner {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
}

export interface BattleSide {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  streamId: string;
  /** Score: gross gift value counted for this side, in USD cents. */
  usdMinor: number;
  /** The side's biggest backers, by what their gifts scored. */
  top?: Array<{ userId: string; username: string; displayName: string; avatar: string; usdMinor: number }>;
  /** A 2v2's partner on this side's stage (null in a 1v1). */
  partner?: BattlePartner | null;
  /**
   * Straight wins in a row: the run going in, and once the battle is
   * settled one more for the winner (a loss or a draw ends a run). 0 when
   * there is none, and always in a practice battle.
   */
  streak?: number;
}

export interface BattleView {
  id: string;
  status: BattleStatus;
  scheduledAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  durationSec: number;
  multiplierWindowSec: number;
  multiplier: number;
  host: BattleSide;
  challenger: BattleSide;
  winnerId: string | null;
  bonusUsdMinor: number;
  overtimeUsed: boolean;
  /** A counting gift in the last seconds reset the clock (once a battle). */
  lateResetUsed?: boolean;
  /** What the loser does on the victory lap ("sings a song"); "" for none. */
  forfeit?: string;
  mode?: BattleMode;
  /** Catalog ids of the gifts that count toward the score; empty (or absent) for every gift. */
  giftFilter?: string[];
  endedReason: string | null;
  /**
   * A practice battle: a practice run's host against a stand-in "Sparring
   * partner" (no user, no stream behind it), scored with simulated gifts.
   * Never listed, never paid, and its scores are practice points — never
   * written as money.
   */
  practice?: boolean;
  /**
   * When a settled battle's result stops showing: the victory lap (three
   * minutes after a win, unless a host ends it early), or a few seconds
   * after a draw. Null before it's settled.
   */
  lapEndsAt?: string | null;
}

/**
 * Going live into a battle — the Go live chooser's "Start a battle": the
 * studio says you'll pick your opponent once you're live, and opens its
 * Battle tab (once) when you are. With practice=1 it's a practice run
 * first, whose Battle tab leads with a practice battle.
 */
export const BATTLE_HREF = "/studio?battle=1";
export const PRACTICE_BATTLE_HREF = "/studio?practice=1&battle=1";
/** The studio listens for this when it's already open (a URL change to the same page doesn't remount it). */
export const BATTLE_EVENT = "xtream:battle-ask";

/** What a practice battle's stand-in is called. */
export const SPARRING_NAME = "Sparring partner";

/** The studio's "Send a test gift" chips: a small, a medium and a big one (catalog ids). */
export const PRACTICE_TEST_GIFTS = [
  { id: "fire", size: "Small" },
  { id: "party", size: "Medium" },
  { id: "crown", size: "Big" },
] as const;

/**
 * A practice battle's score, as points and never money: "1,250 pts" (or
 * "12.5K pts" compact). A point is a cent of the gift it stands in for.
 */
export function formatPracticeScore(minor: number, compact = false) {
  const n = Math.max(0, Math.round(minor));
  if (compact && n >= 10_000) return `${formatPoints(n)} pts`;
  return `${n.toLocaleString("en-US")} pts`;
}

/**
 * Battle points, the way the score bar writes them — never money: a point
 * is a cent of gift value. Whole and grouped to 9,999, then short: "12.4K",
 * "125K", "1.2M", "12M".
 */
export function formatPoints(minor: number) {
  const n = Number.isFinite(minor) ? Math.max(0, Math.round(minor)) : 0;
  if (n < 10_000) return n.toLocaleString("en-US");
  const short = (v: number, digits: number) => v.toFixed(digits).replace(/\.0$/, "");
  if (n < 99_950) return `${short(n / 1000, 1)}K`;
  if (n < 999_500) return `${short(n / 1000, 0)}K`;
  return `${short(n / 1_000_000, n < 9_950_000 ? 1 : 0)}M`;
}

/** A side as people say it: "Ada", or a pair, "Ada & Tolu". */
export function teamName(side: BattleSide) {
  return side.partner ? `${side.displayName} & ${side.partner.displayName}` : side.displayName;
}

/** Whole seconds left on the clock, never negative. */
export function secondsLeft(b: BattleView, now: number) {
  if (!b.endsAt) return 0;
  return Math.max(0, Math.ceil((new Date(b.endsAt).getTime() - now) / 1000));
}

/** True inside the closing window where gifts count double. */
export function inMultiplierWindow(b: BattleView, now: number) {
  return (b.status === "live" || b.status === "overtime") && secondsLeft(b, now) <= b.multiplierWindowSec;
}

export function formatClock(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Score split as a fraction for the host's bar; a fresh battle sits at half. */
export function hostShare(b: BattleView) {
  const total = b.host.usdMinor + b.challenger.usdMinor;
  return total === 0 ? 0.5 : b.host.usdMinor / total;
}

// Deliberately not a type guard: a guard would narrow the `else` branch to
// never, and callers legitimately test "active or just ended".
export function isBattleActive(b: BattleView | null | undefined): boolean {
  return !!b && (b.status === "live" || b.status === "overtime");
}

/** Which side of a battle a stream is on, if it's in it at all. */
export function sideOf(b: BattleView, streamId: string): "host" | "challenger" | null {
  if (b.host.streamId === streamId) return "host";
  if (b.challenger.streamId === streamId) return "challenger";
  return null;
}

/** The catalog gifts a battle's filter names, in catalog order; empty when every gift counts. */
export function filterGifts(filter: readonly string[] | null | undefined): GiftDef[] {
  if (!filter || filter.length === 0) return [];
  return GIFT_CATALOG.filter((g) => filter.includes(g.id));
}

/**
 * A filtered battle's line, as people read it: "Only Crown counts", "Only
 * Rose, Crown count", or "Only 5 gifts count" past three. Null when every
 * gift counts.
 */
export function giftFilterLine(filter: readonly string[] | null | undefined) {
  const gifts = filterGifts(filter);
  if (gifts.length === 0) return null;
  if (gifts.length === 1) return `Only ${gifts[0]!.name} counts`;
  if (gifts.length <= 3) return `Only ${gifts.map((g) => g.name).join(", ")} count`;
  return `Only ${gifts.length} gifts count`;
}

/** The side ahead on these scores, or null when level. */
export function leaderOf(host: number, challenger: number): "host" | "challenger" | null {
  if (host === challenger) return null;
  return host > challenger ? "host" : "challenger";
}

/**
 * Time to a booked battle as a clock: "12:05" under an hour, "2:31:44"
 * under a day, "3d 4h" past that. Never negative.
 */
export function formatCountdown(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

/** One gift that moved a battle's score, from GET /api/battles/:id/activity. */
export interface BattleGift {
  id: string;
  side: "host" | "challenger";
  /** What it added to the side's score (×2 already applied), USD cents. */
  usdMinor: number;
  giftName: string;
  emoji: string;
  sender: { userId: string; displayName: string };
  at: string;
}
