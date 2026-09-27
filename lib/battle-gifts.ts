"use client";

import { useEffect, useSyncExternalStore } from "react";
import { isBattleActive, type BattleView } from "./battles";

/**
 * Which gifts count in the battle this page is watching, for the gift
 * picker to mark. The watch page holds the battle (fed by the API's room
 * events); the picker sits deep inside the chat. A tiny page-wide store
 * joins the two without threading a prop through every chat layout.
 *
 * Empty means nothing to mark: no battle running, or one where every gift
 * counts.
 */
let current: readonly string[] = [];
const listeners = new Set<() => void>();
const EMPTY: readonly string[] = [];

function set(next: readonly string[]) {
  if (next.length === current.length && next.every((id, i) => id === current[i])) return;
  current = next;
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The watch page: say which gifts count while this battle runs, and nothing once it stops. */
export function useShareBattleGifts(battle: BattleView | null) {
  const filter = battle && isBattleActive(battle) ? (battle.giftFilter ?? EMPTY) : EMPTY;
  const key = filter.join(",");
  useEffect(() => {
    set(key ? key.split(",") : EMPTY);
    return () => set(EMPTY);
  }, [key]);
}

/** The gift picker: the catalog ids that count in the running battle; empty for none to mark. */
export function useBattleGifts() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => EMPTY,
  );
}
