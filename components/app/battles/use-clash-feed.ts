"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { isBattleActive, type BattleGift, type BattleView } from "@/lib/battles";

/**
 * What the clash view animates: the battle, polled while the view is open,
 * turned into hits.
 *
 * Every few seconds it asks GET /api/battles/:id/activity for the battle
 * and the gifts that counted since the last ask. Each new gift is a hit
 * with its art and its sender. Whatever the score moved by that those
 * gifts don't account for (gifts older than the feed's page, or a score
 * that moved some other way) becomes one plain hit on that side — so the
 * view only ever animates what really changed, and nothing is invented.
 *
 * The gifts already there on the first ask are history, not hits: they
 * were counted before the view opened, so they're listed, not replayed.
 */

export type ClashSide = "host" | "challenger";

export interface ClashHit {
  key: string;
  side: ClashSide;
  usdMinor: number;
  /** Set when a real gift explains the hit; unset for a plain score move. */
  gift?: { name: string; emoji: string; sender: string };
}

type Feed = { success: boolean; data: { battle: BattleView; gifts: BattleGift[] } };

export const POLL_MS = 2500;
const BOOKED_POLL_MS = 10_000;
/** Gifts shown one by one per poll; past this the rest ride in the plain remainder. */
const MAX_GIFT_HITS = 8;

let seq = 0;

export function useClashFeed(
  initial: BattleView | null,
  open: boolean,
  onHits: (hits: ClashHit[], next: BattleView) => void,
  /** More for the query ("?previewKey=…"): how a practice run's preview link reads its practice battle. */
  feedQuery = "",
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

  useEffect(() => {
    if (!open || !initial) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let prev = initial;
    let since: string | undefined;
    let first = true;
    const seen = new Set<string>();
    // Booked battles only need an occasional look (has it started?).
    let wait = initial.status === "scheduled" ? BOOKED_POLL_MS : POLL_MS;

    const poll = async () => {
      if (document.hidden) {
        timer = setTimeout(poll, wait);
        return;
      }
      try {
        const q = since ? `?since=${encodeURIComponent(since)}` : "?limit=6";
        const more = feedQuery ? `&${feedQuery.replace(/^\?/, "")}` : "";
        const r = await apiFetch<Feed>(`/api/battles/${initial.id}/activity${q}${more}`);
        if (cancelled) return;
        const next = r.data.battle;
        // Oldest first, never the same gift twice.
        const fresh = r.data.gifts.filter((g) => !seen.has(g.id)).reverse();
        fresh.forEach((g) => seen.add(g.id));
        if (fresh.length) since = fresh[fresh.length - 1]!.at;

        const hits: ClashHit[] = [];
        const explained = { host: 0, challenger: 0 };
        if (first) {
          setHistory(fresh.slice(-5).reverse());
        } else {
          for (const g of fresh.slice(-MAX_GIFT_HITS)) {
            explained[g.side] += g.usdMinor;
            hits.push({ key: `g${g.id}`, side: g.side, usdMinor: g.usdMinor, gift: { name: g.giftName, emoji: g.emoji, sender: g.sender.displayName } });
          }
        }
        first = false;
        for (const side of ["host", "challenger"] as const) {
          const rest = next[side].usdMinor - prev[side].usdMinor - explained[side];
          if (rest > 0) hits.push({ key: `d${++seq}`, side, usdMinor: rest });
        }
        prev = next;
        wait = next.status === "scheduled" ? BOOKED_POLL_MS : POLL_MS;
        setBattle(next);
        onHitsRef.current(hits, next);
        // A battle that's over stops asking.
        if (!isBattleActive(next) && next.status !== "scheduled" && next.status !== "invited") return;
      } catch {
        // A missed poll is fine; the next one catches up.
      }
      if (!cancelled) timer = setTimeout(poll, wait);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // The card's battle seeds each opening; re-polling on every card refresh would reset the deltas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, id]);

  return { battle, history };
}
