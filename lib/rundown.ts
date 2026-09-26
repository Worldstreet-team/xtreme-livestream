"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_RUNDOWN_SCRIPT,
  MAX_SEGMENT_CUES,
  MAX_SEGMENT_SCRIPT,
  MAX_SEGMENTS,
  type RundownCue,
  type RundownPosition,
  type RundownSegment,
} from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";
import { CARDS, DEFAULT_CHART, LAYOUTS, withLayer, type Scene, type SceneLayer } from "@/lib/scene";

/**
 * Run of show (Phase 3), on the client: the rundown's shape and words, the
 * scene change a segment makes as it starts, and the two hooks the studio
 * runs it with — the rundown itself (saved as you edit) and where the show
 * is (kept on the live stream, so timers survive a reload).
 */

export type { RundownCue, RundownPosition, RundownSegment };
export { MAX_RUNDOWN_SCRIPT, MAX_SEGMENT_CUES, MAX_SEGMENT_SCRIPT, MAX_SEGMENTS };

export function newSegmentId() {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

export const totalSeconds = (segments: RundownSegment[]) => segments.reduce((n, s) => n + s.seconds, 0);
export const scriptLength = (segments: RundownSegment[]) => segments.reduce((n, s) => n + s.script.length, 0);

/** "4:05", "1:02:03" — a running clock; negative reads as "+0:41" (over). */
export function formatClock(seconds: number, signed = false) {
  const over = seconds < 0;
  const total = Math.floor(Math.abs(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  return signed && over ? `+${body}` : body;
}

/** "5 min", "1 h 30 min", "45 s" — a planned length. */
export function formatLength(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return seconds % 60 === 0 ? `${m} min` : formatClock(seconds);
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** A sponsor a cue can put up — the studio's own list (lib/sponsors.ts). */
export interface CueSponsor {
  source: "own" | "campaign";
  id: string;
  name: string;
  line: string;
  url: string;
  code: string;
  logoUrl: string | null;
  restricted: boolean;
}

/** How a cue reads on its chip. */
export function cueLabel(cue: RundownCue, sponsors: CueSponsor[] = []) {
  switch (cue.do) {
    case "layout":
      return `Layout: ${LAYOUTS.find((l) => l.id === cue.layout)?.label ?? cue.layout}`;
    case "card":
      return `Card: ${CARDS.find((c) => c.id === cue.card)?.title ?? cue.card}`;
    case "clear-card":
      return "Card down";
    case "lower-third":
      return `Lower third: ${cue.title}${cue.subtitle ? ` · ${cue.subtitle}` : ""}`;
    case "hide-lower-third":
      return "Lower third down";
    case "banner":
      return `Banner: ${cue.text}`;
    case "hide-banner":
      return "Banner down";
    case "sponsor":
      return `Sponsor: ${sponsors.find((s) => s.source === cue.source && s.id === cue.sponsorId)?.name ?? "a sponsor you removed"}`;
    case "hide-sponsor":
      return "Sponsor down";
    case "countdown":
      return "Countdown";
  }
}

/**
 * The scene a segment starts with: the current one, with the segment's
 * cues applied in order. Null when it has nothing to change. A sponsor the
 * creator has since removed is skipped rather than failing the rest.
 */
export function applyCues(
  scene: Pick<Scene, "layout" | "card" | "layers" | "chart">,
  segment: Pick<RundownSegment, "title" | "seconds" | "cues">,
  now: number,
  sponsors: CueSponsor[] = [],
): Pick<Scene, "layout" | "card" | "layers" | "chart"> | null {
  if (segment.cues.length === 0) return null;
  let { layout, card, layers, chart } = scene;
  const put = (kind: SceneLayer["kind"], layer: SceneLayer | null) => {
    layers = withLayer(layers, kind, layer);
  };
  for (const cue of segment.cues) {
    switch (cue.do) {
      case "layout":
        layout = cue.layout;
        if (layout === "chart-face" && !chart) chart = DEFAULT_CHART;
        break;
      case "card":
        card = cue.card;
        break;
      case "clear-card":
        card = null;
        break;
      case "lower-third":
        put("lower-third", { kind: "lower-third", title: cue.title, subtitle: cue.subtitle ?? "" });
        break;
      case "hide-lower-third":
        put("lower-third", null);
        break;
      case "banner":
        put("banner", { kind: "banner", text: cue.text });
        break;
      case "hide-banner":
        put("banner", null);
        break;
      case "sponsor": {
        const s = sponsors.find((x) => x.source === cue.source && x.id === cue.sponsorId);
        if (s) {
          put("sponsor", { kind: "sponsor", source: s.source, sponsorId: s.id, name: s.name, line: s.line, url: s.url, code: s.code, logoUrl: s.logoUrl, restricted: s.restricted });
        }
        break;
      }
      case "hide-sponsor":
        put("sponsor", null);
        break;
      case "countdown":
        put("countdown", { kind: "countdown", label: segment.title.slice(0, 40), endsAt: new Date(now + segment.seconds * 1000).toISOString() });
        break;
    }
  }
  return { layout, card, layers, chart };
}

/** Starting points, so a first rundown isn't a blank page. */
export const TEMPLATES: { id: string; name: string; blurb: string; segments: Omit<RundownSegment, "id">[] }[] = [
  {
    id: "talk",
    name: "Talk show",
    blurb: "Open, a main topic, a guest, your questions",
    segments: [
      { title: "Starting soon", seconds: 120, script: "", cues: [{ do: "card", card: "starting-soon" }, { do: "countdown" }] },
      { title: "Cold open", seconds: 180, script: "Welcome in. Tell them what tonight's about, and what's coming up.", cues: [{ do: "clear-card" }] },
      { title: "Main topic", seconds: 1200, script: "", cues: [] },
      { title: "Guest", seconds: 900, script: "Introduce your guest: who they are and why they're here.", cues: [{ do: "layout", layout: "split" }] },
      { title: "Your questions", seconds: 600, script: "", cues: [{ do: "layout", layout: "solo" }, { do: "banner", text: "Ask in chat — I'm answering live" }] },
      { title: "Wrap-up", seconds: 180, script: "Thank the room and say when you're back.", cues: [{ do: "hide-banner" }] },
    ],
  },
  {
    id: "market",
    name: "Market open",
    blurb: "Recap on the chart, levels, then your calls",
    segments: [
      { title: "Starting soon", seconds: 120, script: "", cues: [{ do: "card", card: "starting-soon" }, { do: "countdown" }] },
      { title: "Overnight recap", seconds: 480, script: "What moved overnight, and why it matters today.", cues: [{ do: "clear-card" }, { do: "layout", layout: "chart-face" }] },
      { title: "Levels to watch", seconds: 600, script: "", cues: [] },
      { title: "Your calls", seconds: 900, script: "", cues: [{ do: "layout", layout: "solo" }, { do: "banner", text: "Drop your ticker in chat" }] },
      { title: "Wrap-up", seconds: 180, script: "Not financial advice — do your own research. Back tomorrow at the open.", cues: [{ do: "hide-banner" }] },
    ],
  },
  {
    id: "game",
    name: "Game night",
    blurb: "Lobby, ranked, then games with viewers",
    segments: [
      { title: "Lobby", seconds: 300, script: "", cues: [{ do: "card", card: "starting-soon" }, { do: "countdown" }] },
      { title: "Ranked", seconds: 2400, script: "", cues: [{ do: "clear-card" }] },
      { title: "Viewer games", seconds: 1800, script: "Explain how to join the lobby.", cues: [{ do: "banner", text: "Type !join in chat to play" }] },
      { title: "Wrap-up", seconds: 300, script: "", cues: [{ do: "hide-banner" }] },
    ],
  },
];

/** What the API accepts: every segment titled, cues whole, scripts within the limits. */
export function toBody(segments: RundownSegment[]): RundownSegment[] {
  let budget = MAX_RUNDOWN_SCRIPT;
  return segments.slice(0, MAX_SEGMENTS).map((s) => {
    const script = s.script.slice(0, Math.min(MAX_SEGMENT_SCRIPT, budget));
    budget -= script.length;
    const cues = s.cues.filter((c) => (c.do === "lower-third" ? c.title.trim() : c.do === "banner" ? c.text.trim() : true)).slice(0, MAX_SEGMENT_CUES);
    return {
      id: s.id,
      title: s.title.trim().slice(0, 60) || "Untitled segment",
      seconds: Math.min(4 * 3600, Math.max(10, Math.round(s.seconds))),
      script,
      cues,
    };
  });
}

/** Segments off the wire, as far as they're usable. */
export function readSegments(raw: unknown): RundownSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
    .map((s) => ({
      id: typeof s.id === "string" && /^[a-z0-9]{6,16}$/.test(s.id) ? s.id : newSegmentId(),
      title: typeof s.title === "string" ? s.title.slice(0, 60) : "Untitled segment",
      seconds: typeof s.seconds === "number" && s.seconds >= 10 ? Math.round(s.seconds) : 300,
      script: typeof s.script === "string" ? s.script.slice(0, MAX_SEGMENT_SCRIPT) : "",
      cues: Array.isArray(s.cues) ? (s.cues.filter((c) => c && typeof c === "object" && typeof (c as { do?: unknown }).do === "string") as RundownCue[]) : [],
    }));
}

type Envelope<T> = { success: boolean; data: T };
export type SaveStatus = "saved" | "saving" | "error";

/**
 * The rundown, saved as it's edited: changes show at once and reach the
 * API 700 ms after the last one, or straight away when the studio closes.
 */
export function useRundown(enabled: boolean) {
  const [segments, setSegments] = useState<RundownSegment[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const pending = useRef<RundownSegment[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiFetch<Envelope<{ rundown: { segments: unknown } }>>("/api/users/me/rundown")
      .then((r) => alive && setSegments(readSegments(r.data.rundown.segments)))
      .catch(() => alive && setSegments([]));
    return () => {
      alive = false;
    };
  }, [enabled]);

  const flush = useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      await apiFetch("/api/users/me/rundown", { method: "PUT", body: JSON.stringify({ segments: toBody(next) }) });
      if (!pending.current) setStatus("saved");
    } catch {
      // Keep it: the next edit, or leaving, tries again.
      pending.current ??= next;
      setStatus("error");
    }
  }, []);

  const update = useCallback(
    (next: RundownSegment[]) => {
      setSegments(next);
      pending.current = next;
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  // Nothing typed is lost to closing the tab mid-debounce.
  useEffect(() => {
    const now = () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
    window.addEventListener("pagehide", now);
    return () => {
      window.removeEventListener("pagehide", now);
      now();
    };
  }, [flush]);

  return { segments, status, update };
}

/** Where the show is on this live stream — read once on the way in, then kept by `go`. */
export function useRundownPosition(streamId: string | null, live: boolean) {
  const [state, setState] = useState<{ streamId: string; position: RundownPosition } | null>(null);

  useEffect(() => {
    if (!streamId || !live) return;
    let alive = true;
    apiFetch<Envelope<{ position: RundownPosition }>>(`/api/streams/${streamId}/rundown`)
      .then((r) => alive && setState({ streamId, position: r.data.position }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [streamId, live]);

  const go = useCallback(
    async (segmentId: string | null) => {
      if (!streamId) return null;
      const r = await apiFetch<Envelope<{ position: RundownPosition }>>(`/api/streams/${streamId}/rundown`, {
        method: "PUT",
        body: JSON.stringify({ segmentId }),
      });
      setState({ streamId, position: r.data.position });
      return r.data.position;
    },
    [streamId],
  );

  const position = live && state && state.streamId === streamId ? state.position : null;
  return { position, go };
}
