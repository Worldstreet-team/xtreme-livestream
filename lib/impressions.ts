"use client";

import { useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api-client";

/**
 * Impression logging: what we showed, where, and in which slot.
 *
 * Every click we read back is confounded by placement — the first slot on a
 * page earns several times the clicks of the fifth regardless of content —
 * so a ranker trained on clicks alone learns "we put it first" as "people
 * liked it". Recording the slot is what makes that correctable later, and
 * it is the one thing that cannot be backfilled.
 *
 * An impression counts when at least half the card has been on screen for a
 * second (YouTube's definition), once per card per page view. Batched and
 * flushed on a short timer or when the page hides, so a grid costs one
 * request, not forty.
 */

export type ImpressionSurface =
  | "home"
  | "explore"
  | "browse"
  | "channel"
  | "watch"
  | "following"
  | "search";

export interface ImpressionMeta {
  streamId: string;
  surface: ImpressionSurface;
  /** Row id within the surface ("followed-live", "trending"); omit for flat grids. */
  row?: string;
  slot: number;
  /** The item came from the exploration budget rather than the ranker. */
  explore?: boolean;
}

const KEY = "xtreme-viewer-key";
const FLUSH_MS = 1_500;
const MAX_BATCH = 60;

/** A stable per-browser key so anonymous sessions can be grouped. */
export function getViewerKey(): string {
  if (typeof window === "undefined") return "server";
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh = `v-${crypto.randomUUID()}`;
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Storage blocked: still a valid key for this page view, just not stable.
    return `v-${Math.random().toString(36).slice(2, 14)}`;
  }
}

const seen = new Set<string>();
let queue: ImpressionMeta[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let hooked = false;

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queue.length === 0) return;
  const items = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  void apiFetch("/api/impressions", {
    method: "POST",
    body: JSON.stringify({ viewerKey: getViewerKey(), items }),
    keepalive: true,
  }).catch(() => {
    // Analytics must never surface as a user-visible failure.
  });
  if (queue.length > 0) schedule();
}

function schedule() {
  if (timer) return;
  timer = setTimeout(flush, FLUSH_MS);
}

function hookLifecycle() {
  if (hooked || typeof document === "undefined") return;
  hooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

export function logImpression(meta: ImpressionMeta) {
  const key = `${meta.surface}|${meta.row ?? ""}|${meta.streamId}`;
  if (seen.has(key)) return;
  seen.add(key);
  hookLifecycle();
  queue.push(meta);
  if (queue.length >= MAX_BATCH) flush();
  else schedule();
}

/** Forget what has been logged — call on client-side navigation to a new page view. */
export function resetImpressions() {
  seen.clear();
}

/**
 * Attach to a card's root element. Logs one impression the first time at
 * least half of it has been on screen for a second.
 */
export function useImpression<T extends HTMLElement>(meta: ImpressionMeta | null) {
  const ref = useRef<T | null>(null);
  const streamId = meta?.streamId;
  const surface = meta?.surface;
  const row = meta?.row;
  const slot = meta?.slot;
  const explore = meta?.explore;

  useEffect(() => {
    const el = ref.current;
    if (!el || !streamId || !surface || slot === undefined) return;
    if (typeof IntersectionObserver === "undefined") return;

    // Captured here, not read from a ref later: the effect re-runs when any
    // of these change, so the closure is always the current card.
    const current: ImpressionMeta = { streamId, surface, slot };
    if (row !== undefined) current.row = row;
    if (explore !== undefined) current.explore = explore;

    let dwell: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (!dwell) {
              dwell = setTimeout(() => {
                logImpression(current);
                observer.disconnect();
              }, 1_000);
            }
          } else if (dwell) {
            clearTimeout(dwell);
            dwell = null;
          }
        }
      },
      { threshold: [0.5] }
    );
    observer.observe(el);

    return () => {
      if (dwell) clearTimeout(dwell);
      observer.disconnect();
    };
  }, [streamId, surface, row, slot, explore]);

  return ref;
}
