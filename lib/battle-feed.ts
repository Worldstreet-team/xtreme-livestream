/**
 * Battles as they're pushed (the pure half; components/app/battles/
 * use-clash-feed.ts and the studio's battle panel wire it up).
 *
 * Since 2026-09-29 the API sends every change to a battle to both of its
 * rooms as `{ __evt: "battle", battle, gift? }` — server-sent, like every
 * room event anyone trusts — and a counted gift rides in the same packet as
 * the score it moved. So a surface in the room no longer polls: the clash
 * feed turns packets into hits, the studio's panel folds them into its
 * list, and a slow backstop poll mops up whatever a dropped connection
 * missed. Polls and pushes can cross in flight, so neither ever takes a
 * view that's behind the one already held.
 */

import { battleGiftSchema } from "@xtreme/contracts";
import { isBattleActive, type BattleGift, type BattleView } from "./battles";

export type ClashSide = "host" | "challenger";

export interface ClashHit {
  key: string;
  side: ClashSide;
  usdMinor: number;
  /** Set when a real gift explains the hit; unset for a plain score move. */
  gift?: { name: string; emoji: string; sender: string };
}

/** Gifts shown one by one per step; past this the rest ride in the plain remainder. */
export const MAX_GIFT_HITS = 8;

function isSide(v: unknown): v is { usdMinor: number; userId: string } {
  return !!v && typeof v === "object" && typeof (v as { usdMinor?: unknown }).usdMinor === "number" && typeof (v as { userId?: unknown }).userId === "string";
}

/** A battle view as a room packet carries it, or null when it isn't one. */
export function readBattleView(raw: unknown): BattleView | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<BattleView>;
  if (typeof b.id !== "string" || !b.id || typeof b.status !== "string") return null;
  if (!isSide(b.host) || !isSide(b.challenger)) return null;
  return raw as BattleView;
}

/** A gift riding a room packet (the contract's battleGiftSchema), or null. */
export function readBattleGift(raw: unknown): BattleGift | null {
  const parsed = battleGiftSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The server's `battle` room packet: the view, and the gift that moved it if one did. */
export function readBattlePacket(data: Record<string, unknown>): { battle: BattleView; gift: BattleGift | null } | null {
  if (data.__evt !== "battle") return null;
  const battle = readBattleView(data.battle);
  return battle ? { battle, gift: data.gift === undefined ? null : readBattleGift(data.gift) } : null;
}

/**
 * A gift from a battle's own Ably channel (`xtream:battle:<id>`, message
 * "gift"; services/api/src/xtream-events.ts `xtreamBattleGift`): flat and
 * money-free on the wire — `points`, `senderId`/`senderName`, and both new
 * totals — read back into the room's gift shape. Null when it isn't one.
 */
export function readChannelGift(raw: unknown): { gift: BattleGift; totals: { host: number; challenger: number } } | null {
  let data = raw;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const gift = readBattleGift({
    id: d.id,
    side: d.side,
    usdMinor: d.points,
    giftName: d.giftName ?? "",
    emoji: d.emoji ?? "",
    sender: { userId: d.senderId, displayName: d.senderName ?? "Someone" },
    at: d.at,
  });
  const host = d.hostPoints;
  const challenger = d.challengerPoints;
  if (!gift || typeof host !== "number" || typeof challenger !== "number" || !Number.isFinite(host) || !Number.isFinite(challenger)) return null;
  return { gift, totals: { host, challenger } };
}

/**
 * The view a channel gift implies: the one held, with the new totals —
 * never lower than what's held (scores only go up; a push can overtake a
 * slower ask). Clock and status still come from the view itself.
 */
export function withTotals(held: BattleView, totals: { host: number; challenger: number }): BattleView {
  return {
    ...held,
    host: { ...held.host, usdMinor: Math.max(held.host.usdMinor, totals.host) },
    challenger: { ...held.challenger, usdMinor: Math.max(held.challenger.usdMinor, totals.challenger) },
  };
}

const RANK: Record<string, number> = { scheduled: 0, invited: 0, live: 1, overtime: 2, ended: 3, cancelled: 3 };

/**
 * Whether `next` is behind `held` — the same battle, but an earlier status
 * or a lower score on either side (scores only ever go up). A poll answered
 * just before a push landed is the usual case.
 */
export function isBehind(held: BattleView | null | undefined, next: BattleView) {
  if (!held || held.id !== next.id) return false;
  return (
    (RANK[next.status] ?? 0) < (RANK[held.status] ?? 0) ||
    next.host.usdMinor < held.host.usdMinor ||
    next.challenger.usdMinor < held.challenger.usdMinor
  );
}

/** What the clash feed carries between steps. */
export interface ClashFeedState {
  /** The view the last hits were counted against. */
  prev: BattleView;
  /** Gifts already shown (or listed as history), by id. */
  seen: ReadonlySet<string>;
}

/**
 * One step of the clash feed: a newer view of the battle, and any gifts
 * that came with it (a push carries one; a poll a page, newest first).
 *
 * Each gift not seen before is a hit with its art and its sender — unless
 * `history` (the first look when the view opens: those were counted
 * before, so they're listed, not replayed). Whatever the score moved by
 * that those gifts don't account for becomes one plain hit on that side, so
 * nothing is invented and nothing is lost. A view that's behind the one
 * held moves nothing.
 *
 * `fresh` is the new gifts, oldest first.
 */
export function clashStep(
  state: ClashFeedState,
  next: BattleView,
  gifts: readonly BattleGift[],
  opts: { history?: boolean; key: () => string },
): { state: ClashFeedState; hits: ClashHit[]; fresh: BattleGift[] } {
  const seen = new Set(state.seen);
  const fresh = gifts
    .filter((g) => !seen.has(g.id))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  fresh.forEach((g) => seen.add(g.id));

  if (isBehind(state.prev, next)) return { state: { prev: state.prev, seen }, hits: [], fresh };

  const hits: ClashHit[] = [];
  const explained = { host: 0, challenger: 0 };
  if (!opts.history) {
    for (const g of fresh.slice(-MAX_GIFT_HITS)) {
      explained[g.side] += g.usdMinor;
      hits.push({ key: `g${g.id}`, side: g.side, usdMinor: g.usdMinor, gift: { name: g.giftName, emoji: g.emoji, sender: g.sender.displayName } });
    }
  }
  for (const side of ["host", "challenger"] as const) {
    const rest = next[side].usdMinor - state.prev[side].usdMinor - explained[side];
    if (rest > 0) hits.push({ key: opts.key(), side, usdMinor: rest });
  }
  return { state: { prev: next, seen }, hits, fresh };
}

/** Whether a battle's feed has anything more to say (a settled one is done). */
export function feedStillRunning(b: BattleView) {
  return isBattleActive(b) || b.status === "scheduled" || b.status === "invited";
}

/** What /battles/mine holds: open invites, bookings and the running battle. */
const MINE = new Set(["scheduled", "invited", "live", "overtime"]);
export function isOpenForMine(b: Pick<BattleView, "status">) {
  return MINE.has(b.status);
}

/**
 * The studio battle panel's list, with one pushed view folded in: a battle
 * of mine that's still open goes in (replacing its old self, or first if
 * it's new); one that's over leaves. Someone else's battle, or a view
 * behind the one held, changes nothing.
 */
export function mergeMine(list: readonly BattleView[], view: BattleView, meId: string | null | undefined): BattleView[] {
  if (!meId || (view.host.userId !== meId && view.challenger.userId !== meId)) return list as BattleView[];
  const i = list.findIndex((b) => b.id === view.id);
  if (i >= 0 && isBehind(list[i], view)) return list as BattleView[];
  if (!MINE.has(view.status)) return i < 0 ? (list as BattleView[]) : list.filter((b) => b.id !== view.id);
  if (i < 0) return [view, ...list];
  const next = list.slice();
  next[i] = view;
  return next;
}

/**
 * A fresh /battles/mine answered while pushes kept coming: its list, but
 * any battle a push has already taken further stays as the push had it,
 * and one a push said is over (`gone`) stays out.
 */
export function keepAhead(held: readonly BattleView[], fresh: readonly BattleView[], gone: ReadonlySet<string> = new Set()): BattleView[] {
  return fresh
    .filter((b) => !gone.has(b.id))
    .map((b) => {
      const h = held.find((x) => x.id === b.id);
      return h && isBehind(h, b) ? h : b;
    });
}
