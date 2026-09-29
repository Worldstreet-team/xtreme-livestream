/**
 * The battle stage's arithmetic: which side is ours, how the bar splits,
 * what the clock pill says, when the result is stamped and dimmed, who
 * sits in the seats, and how gift toasts stack. Pure and framework-free,
 * so it's exercised from services/api/test (the repo's only test runner).
 *
 * Everything here reads the server's view: the clock is the server's
 * (callers pass a server-clock `now`), the result is the server's, and
 * nothing is decided on the client.
 */

import { winnerSide } from "./battle-result";
import { formatClock, formatPoints, inMultiplierWindow, isBattleActive, secondsLeft, sideOf, teamName, type BattleSide, type BattleView } from "./battles";

export type SideKey = "host" | "challenger";

/** A result settled before laps existed stays up this long after the clock (the old window). */
export const LEGACY_RESULT_MS = 120_000;
/** WIN and LOSE (or DRAW) stay stamped this long after the clock; then the loser dims for the lap. */
export const STAMP_MS = 2_400;
/** The VS stamp as the clock starts. */
export const VS_MS = 1_600;
/** Neither end of the bar is squeezed past this, however lopsided the score. */
export const SHARE_MIN = 0.14;
/** The final seconds: the pill turns chili and beats once a second. */
export const FINAL_SEC = 10;
/** Same sender, same gift, same side, this close together: one toast, counted up. */
export const TOAST_MERGE_MS = 4_000;
/** How long a toast stays up after its last gift. */
export const TOAST_MS = 3_200;
/** Toasts shown per side at once. */
export const TOASTS_PER_SIDE = 3;
/** Score announcements for screen readers, at most this often (and on every lead change). */
export const ANNOUNCE_MS = 10_000;

/** Which side is ours (the room we're in — the left of everything) and which is theirs. */
export function sidesFor(b: BattleView, streamId: string): { ours: SideKey; theirs: SideKey } {
  const ours = sideOf(b, streamId) ?? "host";
  return { ours, theirs: ours === "host" ? "challenger" : "host" };
}

/** When a settled battle's result comes down (server ms), or null for a battle that isn't settled. */
export function resultUntil(b: Pick<BattleView, "status" | "lapEndsAt" | "endsAt">): number | null {
  if (b.status !== "ended") return null;
  if (b.lapEndsAt) return Date.parse(b.lapEndsAt);
  return b.endsAt ? Date.parse(b.endsAt) + LEGACY_RESULT_MS : null;
}

/** Whether a settled battle's result is still up: the victory lap, or a draw's few seconds. */
export function resultUp(b: BattleView, now: number) {
  const until = resultUntil(b);
  return until !== null && now < until;
}

/** Whether the battle owns the stage: running, or its result still up. */
export function onStage(b: BattleView | null | undefined, now: number): b is BattleView {
  return Boolean(b) && (isBattleActive(b) || resultUp(b!, now));
}

/** Our end of the bar as a fraction: half on a fresh battle, clamped so neither end is squeezed off. */
export function barShare(b: Pick<BattleView, "host" | "challenger">, ours: SideKey) {
  const total = b.host.usdMinor + b.challenger.usdMinor;
  const share = total > 0 ? b[ours].usdMinor / total : 0.5;
  return Math.min(1 - SHARE_MIN, Math.max(SHARE_MIN, share));
}

export type ClockTone = "calm" | "double" | "final" | "lap" | "draw" | "over";

/**
 * What the pill hung on the seam says. Running: the clock (with OT in
 * overtime), Ember with ×2 in the closing window, Chili in the final ten
 * seconds. Settled: the lap's own clock after a win, "Draw" after a draw.
 */
export function clockFor(b: BattleView, now: number): { tone: ClockTone; text: string; overtime: boolean; left: number } {
  if (isBattleActive(b)) {
    const left = secondsLeft(b, now);
    const tone: ClockTone = left <= FINAL_SEC ? "final" : inMultiplierWindow(b, now) ? "double" : "calm";
    return { tone, text: formatClock(left), overtime: b.status === "overtime", left };
  }
  if (b.status === "ended") {
    if (!winnerSide(b)) return { tone: "draw", text: "Draw", overtime: false, left: 0 };
    const until = resultUntil(b);
    const left = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
    return { tone: "lap", text: formatClock(left), overtime: false, left };
  }
  return { tone: "over", text: "0:00", overtime: false, left: 0 };
}

/** How a side came out: null until the battle is settled. */
export function outcomeOf(b: BattleView, side: SideKey): "win" | "lose" | "draw" | null {
  if (b.status !== "ended") return null;
  const w = winnerSide(b);
  if (!w) return "draw";
  return w === side ? "win" : "lose";
}

/** WIN / LOSE (or DRAW) stamped on the halves: for a moment after the clock, from the server's end time. */
export function stampShowing(b: BattleView, now: number) {
  if (b.status !== "ended" || !b.endsAt) return false;
  const since = now - Date.parse(b.endsAt);
  return since >= -1_000 && since < STAMP_MS && resultUp(b, now);
}

/** The loser's picture dims for the lap, once the stamps have had their moment. A draw dims nobody. */
export function dimmed(b: BattleView, side: SideKey, now: number) {
  return outcomeOf(b, side) === "lose" && resultUp(b, now) && !stampShowing(b, now);
}

/** The VS stamp: only in the moment the clock starts, from the server's start time. */
export function vsShowing(b: BattleView, now: number) {
  if (!isBattleActive(b) || !b.startsAt) return false;
  const since = now - Date.parse(b.startsAt);
  return since >= 0 && since < VS_MS;
}

export type Seat = NonNullable<BattleSide["top"]>[number] | null;

/** A side's three seats, best backer first; an empty seat is null. */
export function seatsOf(side: BattleSide): [Seat, Seat, Seat] {
  const top = side.top ?? [];
  return [top[0] ?? null, top[1] ?? null, top[2] ?? null];
}

/**
 * One short line under the clock pill, if any: the closing window first
 * ("Last 30 seconds: gifts count double"), else which gifts count, else
 * what the loser does. Nothing once it's settled — the forfeit card has
 * the lap.
 */
export function captionFor(b: BattleView, now: number, filterLine: string | null): { text: string; tone: "double" | "plain" } | null {
  if (!isBattleActive(b)) return null;
  if (inMultiplierWindow(b, now)) {
    return { text: `Last ${b.multiplierWindowSec} seconds: gifts count ${b.multiplier === 2 ? "double" : `×${b.multiplier}`}`, tone: "double" };
  }
  if (filterLine) return { text: filterLine, tone: "plain" };
  if (b.forfeit) return { text: `Loser ${b.forfeit}`, tone: "plain" };
  return null;
}

/** The side ahead, or null when level. */
export function leaderKey(b: Pick<BattleView, "host" | "challenger">): SideKey | null {
  if (b.host.usdMinor === b.challenger.usdMinor) return null;
  return b.host.usdMinor > b.challenger.usdMinor ? "host" : "challenger";
}

/** The score as a screen reader says it, ours first: "Ada 12.4K points, Tolu 9,100 points. Ada leads." */
export function scoreLine(b: BattleView, ours: SideKey) {
  const theirs: SideKey = ours === "host" ? "challenger" : "host";
  const lead = leaderKey(b);
  const said = (s: SideKey) => `${teamName(b[s])} ${formatPoints(b[s].usdMinor)} points`;
  return `${said(ours)}, ${said(theirs)}. ${lead ? `${teamName(b[lead])} lead${b[lead].partner ? "" : "s"}.` : "Level."}`;
}

/** The result, said once: "Ada wins the battle", "It's a draw". */
export function resultLine(b: BattleView) {
  const w = winnerSide(b);
  if (!w) return "The battle is over. It's a draw.";
  const side = b[w];
  return `The battle is over. ${teamName(side)} win${side.partner ? "" : "s"}${b.endedReason === "conceded" ? " — the other side ended it early" : ""}.`;
}

/**
 * Whether to say the score now: on a lead change always, otherwise no more
 * than every ANNOUNCE_MS, and only when something moved.
 */
export function shouldAnnounce(prev: { at: number; lead: SideKey | null; line: string } | null, lead: SideKey | null, line: string, now: number) {
  if (!prev) return true;
  if (lead !== prev.lead) return true;
  return line !== prev.line && now - prev.at >= ANNOUNCE_MS;
}

export interface GiftToast {
  key: string;
  side: SideKey;
  sender: string;
  gift: string;
  emoji: string;
  count: number;
  /** When the last gift in it landed (client ms). */
  at: number;
}

/**
 * A gift landing, as a toast over the half it went to: the same sender
 * sending the same gift again soon after counts the toast up ("Tolu sent
 * Rose ×5") rather than stacking another. Newest first, a few a side.
 */
export function pushToast(list: GiftToast[], hit: { key: string; side: SideKey; sender: string; gift: string; emoji: string }, now: number): GiftToast[] {
  const live = list.filter((t) => now - t.at < TOAST_MS);
  const same = live.find((t) => t.side === hit.side && t.sender === hit.sender && t.gift === hit.gift && now - t.at < TOAST_MERGE_MS);
  if (same) return [{ ...same, count: same.count + 1, at: now }, ...live.filter((t) => t !== same)];
  const next = [{ key: hit.key, side: hit.side, sender: hit.sender, gift: hit.gift, emoji: hit.emoji, count: 1, at: now }, ...live];
  // Past a few on one side, the oldest there goes.
  const mine = next.filter((t) => t.side === hit.side);
  return mine.length > TOASTS_PER_SIDE ? next.filter((t) => t !== mine[mine.length - 1]) : next;
}

/** "Tolu sent Rose ×5". */
export function toastText(t: Pick<GiftToast, "sender" | "gift" | "count">) {
  return `${t.sender} sent ${t.gift}${t.count > 1 ? ` ×${t.count}` : ""}`;
}

/** Height of the score bar over the feeds, in px. */
export const BAR_H = 16;

/**
 * Where the band sits in a frame (px) on a computer: a centred portrait
 * column — two 9:16 halves side by side (18:16 together), the bar on top —
 * as tall as the frame allows between `top` (where the bar starts) and
 * `bottom`, and never wider than the frame. On an upright phone the
 * surfaces use the CSS twin of `portraitBand`: full width, min(50vw × 16/9,
 * 45% of the height) tall.
 */
export function columnBand(width: number, height: number, { top = 12, bottom = 12 }: { top?: number; bottom?: number } = {}) {
  const avail = Math.max(0, height - top - BAR_H - bottom);
  let bandH = avail;
  let bandW = (bandH * 18) / 16;
  if (bandW > width) {
    bandW = width;
    bandH = (width * 16) / 18;
  }
  return { barTop: top, bandTop: top + BAR_H, bandH: Math.round(bandH), bandW: Math.round(bandW), bandLeft: Math.round((width - bandW) / 2) };
}

/** An upright screen's band (px): full width, each half 9:16, but never more than 45% of the height. */
export function portraitBand(width: number, height: number, top: number) {
  const bandH = Math.min((width / 2) * (16 / 9), height * 0.45);
  return { barTop: top, bandTop: top + BAR_H, bandH: Math.round(bandH), bandW: width, bandLeft: 0 };
}
