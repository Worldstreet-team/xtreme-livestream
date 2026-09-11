/**
 * Battles, as the client sees them. The server owns the clock, the scores
 * and the settlement; everything here is rendering and time arithmetic.
 */

export type BattleStatus = "scheduled" | "invited" | "live" | "overtime" | "ended" | "cancelled";

export interface BattleSide {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  streamId: string;
  /** Score: gross gift value counted for this side, in USD cents. */
  usdMinor: number;
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
  endedReason: string | null;
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
