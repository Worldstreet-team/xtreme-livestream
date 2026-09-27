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
