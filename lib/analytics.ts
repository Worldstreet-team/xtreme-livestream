"use client";

import { useEffect, useState } from "react";
import type { MomentKind, StreamAnalytics } from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";

/**
 * Live analytics (Phase 3) on the client: a broadcast minute by minute,
 * read live in the studio (every half minute) and afterwards as the recap.
 */

export type { MomentKind, StreamAnalytics };

const LIVE_POLL_MS = 30_000;

export function useStreamAnalytics(streamId: string | null, live = false) {
  const [state, setState] = useState<{ streamId: string; analytics: StreamAnalytics | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!streamId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const r = await apiFetch<{ success: boolean; data: { analytics: StreamAnalytics } }>(`/api/streams/${streamId}/analytics`);
        if (alive) setState({ streamId, analytics: r.data.analytics, failed: false });
      } catch {
        // Keep what we had; say so only if there's nothing.
        if (alive) setState((cur) => (cur?.streamId === streamId && cur.analytics ? cur : { streamId, analytics: null, failed: true }));
      }
      if (alive && live) timer = setTimeout(load, LIVE_POLL_MS);
    };
    void load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [streamId, live]);

  const mine = streamId && state?.streamId === streamId ? state : null;
  return { analytics: mine?.analytics ?? null, failed: mine?.failed ?? false };
}

/** "12:00" into the broadcast, or "1:02:00". */
export function minuteStamp(minute: number) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:00` : `${m}:00`;
}

/** "62 min", "2 h 5 min". */
export function durationWords(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

export const MOMENT_LABELS: Record<MomentKind, string> = {
  segment: "Segment",
  guest: "Guest",
  card: "Card",
  gift: "Gift",
  battle: "Battle",
  goal: "Goal",
  peak: "Peak",
};
