"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { apiFetch } from "@/lib/api-client";
import type { BattleGift, BattleView } from "@/lib/battles";
import { clashStep, feedStillRunning, isBehind, readBattlePacket, type ClashFeedState, type ClashHit } from "@/lib/battle-feed";
import { useServerRoomEvents } from "@/lib/room-events";

/**
 * What the clash view and the battle stage animate: the battle, followed
 * while the view is open, turned into hits (lib/battle-feed.ts `clashStep`).
 *
 * In the room (`room` set — the watch page, the studio), the server pushes
 * every change to both rooms as `{ __evt: "battle", battle, gift }`, the
 * counted gift riding with the score it moved: each packet is a step, and
 * the only asks are one on opening (the recent gifts, listed as history)
 * and a slow backstop for anything a dropped connection missed — plus one
 * the moment the room comes back.
 *
 * Outside a room (the Home battles row's clash view, a practice preview
 * link) nothing pushes the gifts, so it asks GET /api/battles/:id/activity
 * every few seconds for the battle and the gifts that counted since the
 * last ask, as before.
 */

export type { ClashHit, ClashSide } from "@/lib/battle-feed";

type Feed = { success: boolean; data: { battle: BattleView; gifts: BattleGift[] } };

export const POLL_MS = 2500;
const BOOKED_POLL_MS = 10_000;
/** In a room, pushes carry everything; this only mops up what a drop missed. */
export const PUSHED_BACKSTOP_MS = 30_000;

let seq = 0;
const nextKey = () => `d${++seq}`;

export function useClashFeed(
  initial: BattleView | null,
  open: boolean,
  onHits: (hits: ClashHit[], next: BattleView) => void,
  /** More for the query ("?previewKey=…"): how a practice run's preview link reads its practice battle. */
  feedQuery = "",
  /** The room this battle is pushed to, when the surface is in it. */
  room: Room | null = null,
) {
  const [battle, setBattle] = useState(initial);
  const [history, setHistory] = useState<BattleGift[]>([]);
  const onHitsRef = useRef(onHits);
  useLayoutEffect(() => {
    onHitsRef.current = onHits;
  });

  // A different battle opened: start from its card's numbers.
  const id = initial?.id ?? null;
  const [forId, setForId] = useState(id);
  if (id !== forId) {
    setForId(id);
    setBattle(initial);
    setHistory([]);
  }

  // The feed's working state, shared by the poll and the pushes of one opening.
  const feed = useRef<{ id: string; state: ClashFeedState; since?: string; first: boolean; poll: () => void } | null>(null);
  /** The room's pushes, into the opening that's current. */
  const stepRef = useRef<((next: BattleView, gift: BattleGift | null) => void) | null>(null);
  const pushed = Boolean(room);

  useEffect(() => {
    if (!open || !initial) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const me = { id: initial.id, state: { prev: initial, seen: new Set<string>() } as ClashFeedState, since: undefined as string | undefined, first: true, poll: () => {} };
    feed.current = me;
    const waitFor = (b: BattleView) => (pushed ? PUSHED_BACKSTOP_MS : b.status === "scheduled" ? BOOKED_POLL_MS : POLL_MS);
    let wait = waitFor(initial);

    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(poll, wait);
    };
    const poll = async () => {
      if (document.hidden) return schedule();
      try {
        const q = me.since ? `?since=${encodeURIComponent(me.since)}` : "?limit=6";
        const more = feedQuery ? `&${feedQuery.replace(/^\?/, "")}` : "";
        const r = await apiFetch<Feed>(`/api/battles/${initial.id}/activity${q}${more}`);
        if (cancelled) return;
        const next = step(r.data.battle, r.data.gifts, true);
        wait = waitFor(next);
        // A battle that's over stops asking.
        if (!feedStillRunning(next)) return;
      } catch {
        // A missed ask is fine; the next one (or a push) catches up.
      }
      schedule();
    };
    me.poll = () => void poll();

    /**
     * Count a newer view (and its gifts) into hits; hands back the view now
     * held. Only the first ask's gifts are history: a push is always news.
     */
    function step(next: BattleView, gifts: readonly BattleGift[], asked: boolean) {
      const history = asked && me.first;
      if (asked) me.first = false;
      const { state, hits, fresh } = clashStep(me.state, next, gifts, { history, key: nextKey });
      me.state = state;
      const newest = gifts.reduce<string | undefined>((at, g) => (!at || Date.parse(g.at) > Date.parse(at) ? g.at : at), me.since);
      me.since = newest;
      if (history) setHistory(fresh.slice(-5).reverse());
      const held = state.prev;
      setBattle(held);
      onHitsRef.current(hits, held);
      return held;
    }
    stepRef.current = (next, gift) => {
      if (cancelled || next.id !== me.id) return;
      // A push that lands before the first ask has answered is a step all the same.
      if (isBehind(me.state.prev, next)) return;
      step(next, gift ? [gift] : [], false);
    };

    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stepRef.current = null;
      if (feed.current === me) feed.current = null;
    };
    // The card's battle seeds each opening; re-polling on every card refresh would reset the deltas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id, pushed]);

  useServerRoomEvents(
    open ? room : null,
    ["battle"],
    (_evt, data) => {
      const packet = readBattlePacket(data);
      if (packet) stepRef.current?.(packet.battle, packet.gift);
    },
    // Back after a drop: ask once now rather than at the backstop.
    () => {
      if (feed.current && !feed.current.first) feed.current.poll();
    },
  );

  return { battle, history };
}
