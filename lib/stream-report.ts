"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { StreamAnalytics } from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";

/**
 * The post-live report on the client: the shape GET /streams/:id/report
 * sends (services/api/src/stream-report.ts), the hook that loads it, the
 * one-tap rating, and a small store so any screen can open the report —
 * the studio the moment End is pressed, Your channel from a broadcast card.
 * The sheet itself is mounted once, beside the studio (StudioHost), so it
 * outlives a studio that closes behind it.
 */

export type ReportTone = "good" | "quiet" | "practice";

export interface ReportQuest {
  id: string;
  cadence: "daily" | "weekly" | "milestone";
  title: string;
  blurb: string;
  unit: string;
  target: number;
  progress: number;
  points: number;
  claimed: boolean;
  claimable: boolean;
  resetsAt: string | null;
  creator: boolean;
}

export interface StreamReportData {
  stream: {
    id: string;
    title: string;
    category: string;
    practice: boolean;
    live: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number;
    thumbnailUrl: string | null;
  };
  tone: ReportTone;
  analytics: StreamAnalytics | null;
  bestMinute: { minute: number; viewers: number; chats: number; giftsMinor: number; label: string | null } | null;
  earnings: { grossMinor: number; netMinor: number; gifts: number } | null;
  pointsEarned: number;
  progress: {
    level: { level: number; tier: string; nextTier: { name: string; level: number } | null; xp: number; floor: number; next: number };
    weeksInARow: number;
    streamsThisWeek: number;
    quests: ReportQuest[];
    next: {
      kind: "claim" | "quest" | "book" | "streak";
      text: string;
      href: string | null;
      progress?: number;
      target?: number;
      unit?: string;
      points?: number;
    };
  };
  rating: number | null;
}

/** The report for one broadcast. `retry` asks again (the stream may still be closing). */
export function useStreamReport(streamId: string | null) {
  const [state, setState] = useState<{ id: string; report: StreamReportData | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!streamId) return;
    let alive = true;
    apiFetch<{ success: boolean; data: { report: StreamReportData } }>(`/api/streams/${streamId}/report`)
      .then((r) => alive && setState({ id: streamId, report: r.data.report, failed: false }))
      .catch(() => alive && setState({ id: streamId, report: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [streamId, attempt]);

  const retry = useCallback(() => {
    setState(null);
    setAttempt((n) => n + 1);
  }, []);
  const mine = state && state.id === streamId ? state : null;
  return { report: mine?.report ?? null, failed: mine?.failed ?? false, retry };
}

/** The host's answer to "How likely are you to recommend Xtream to a friend?" (0–10). */
export async function rateStream(streamId: string, score: number) {
  const r = await apiFetch<{ success: boolean; data: { score: number } }>(`/api/streams/${streamId}/rating`, {
    method: "PUT",
    body: JSON.stringify({ score }),
  });
  return r.data.score;
}

/** "41 s", "12 min", "1 h 5 min". */
export function durationLabel(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

/** The line under the headline — what went right, or a reason to come back. */
export function reportLine(r: StreamReportData): string {
  const s = r.analytics?.summary;
  if (r.tone === "practice") return "Nobody saw that but you (and anyone you sent the preview link). Everything works — the real thing is one tap away.";
  if (!s) return "Your broadcast is in. The numbers land here as soon as they're counted.";
  if (r.tone === "good") {
    const bits: string[] = [];
    if (s.peakViewers > 0) bits.push(`${s.peakViewers} watching at the peak`);
    if (s.newAllies > 0) bits.push(`${s.newAllies} new ${s.newAllies === 1 ? "ally" : "allies"}`);
    if (s.gifters > 0) bits.push(`${s.gifters} ${s.gifters === 1 ? "person" : "people"} sent gifts`);
    if (bits.length === 0 && s.chats > 0) bits.push(`${s.chats} messages in chat`);
    const list = bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}` : (bits[0] ?? "");
    return `${list.charAt(0).toUpperCase()}${list.slice(1)}. Keep that energy for the next one.`;
  }
  return s.uniqueViewers > 0
    ? `${s.uniqueViewers} ${s.uniqueViewers === 1 ? "person" : "people"} dropped in. Channels grow by showing up at the same time each week — book the next one and your allies get a reminder.`
    : "A quiet one — every channel starts here. Going live at the same time each week is how people find you; book the next one and it's on your channel for them.";
}

export function reportHeadline(tone: ReportTone) {
  return tone === "good" ? "Nice stream!" : tone === "practice" ? "Practice done. Ready for the real thing?" : "You showed up. That's the hard part.";
}

/* ---- who's showing the report ------------------------------------------ */

export interface ReportRequest {
  streamId: string;
  /** Where it was opened: the studio (End) or Your channel (a broadcast card). */
  from: "studio" | "channel";
}

let current: ReportRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openStreamReport(request: ReportRequest) {
  current = request;
  emit();
}
export function closeStreamReport() {
  current = null;
  emit();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export function useStreamReportRequest() {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
