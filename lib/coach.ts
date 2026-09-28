"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * The studio's coach: while a host is live, short lines that say what's
 * happening and what to do next, the way TikTok Live does ("We're telling
 * your 212 followers you're live", "Share your link to bring people in").
 *
 * Host-only and local: nothing here goes to the room or the API, and no
 * viewer ever sees a line. The studio feeds its state in through
 * `useCoachDriver` (called once, in studio.tsx); anything that renders the
 * lines — the on-screen chat, the studio's chat panel — reads them with
 * `useCoachLines(streamId)` and closes one with `dismissCoach(id)`.
 *
 * Each line shows once per stream (kept in sessionStorage, so a reload
 * doesn't replay them), at most one new line every 20 s and never more than
 * six in a stream. A line stays up for 45 s, until it's dismissed or its
 * button is used, or until it no longer holds (a title was added, a guest
 * came on, data saver went on). Nothing is said that isn't true: the
 * follower count is the go-live fan-out's own, and "people are finding
 * your stream" waits for someone actually watching.
 */

export type CoachIcon = "bell" | "share" | "invite" | "title" | "signal" | "spark" | "lock";

export type CoachLine = {
  id: string;
  icon: CoachIcon;
  text: string;
  action?: { label: string; run: () => void };
};

export type CoachKind = "followers" | "share" | "invite" | "title" | "signal" | "keep-going" | "practice";

/** What the studio knows — handed in on every render by `useCoachDriver`. */
export interface CoachDriverInput {
  isLive: boolean;
  streamId: string | null;
  /** A practice run: private, so no follower/share/invite/finding lines. */
  practice: boolean;
  /** The host can see the studio (not minimized): new lines wait while it's tucked away. */
  visible: boolean;
  /** The host never typed a title (viewers see the default name). */
  untitled: boolean;
  viewers: number;
  /** People on stage with the host now. */
  guests: number;
  /** Another creator is live to invite (the Stage panel's co-live list isn't empty). */
  canInvite: boolean;
  /** The browser feed's health verdict (lib/stream-health.ts); null from an encoder, where data saver can't help. */
  health: { level: "good" | "fair" | "poor"; label: string } | null;
  /** The studio's "Save data — 540p" switch. */
  saveData: boolean;
  actions: {
    /** Share the stream's link: the share sheet, else the clipboard. */
    share: () => void;
    /** Open the Stage panel's co-live invites. */
    invite: () => void;
    /** Open the stream details sheet (title and category). */
    addTitle: () => void;
    /** Turn data saver on, live. */
    saveData: () => void;
    /** Open the practice run's Share preview. */
    practiceShare: () => void;
  };
}

/* ------------------------------------------------------------------ */
/* The rules — pure, and tested from services/api/test/coach.test.ts    */
/* ------------------------------------------------------------------ */

/** The least time between two new lines. */
export const COACH_GAP_MS = 20_000;
/** Never more lines than this in one stream. */
export const COACH_MAX = 6;
/** How long a line stays up unless it's dismissed first. */
export const COACH_TTL_MS = 45_000;
/** How long the connection has to struggle before data saver is suggested. */
export const COACH_STRUGGLE_MS = 6_000;
/** When each line is first due, from going live. */
export const COACH_AT: Record<CoachKind, number> = {
  followers: 2_000,
  practice: 2_000,
  share: 30_000,
  title: 50_000,
  invite: 90_000,
  "keep-going": 300_000,
  signal: 0,
};
/** Most urgent first: a struggling connection jumps the queue. */
const ORDER: CoachKind[] = ["signal", "followers", "practice", "share", "title", "invite", "keep-going"];
/** Health verdicts that a lighter send helps (not "Not sending": the camera's off or the link is gone). */
const STRUGGLES = new Set(["Upload limited", "Device busy", "Slow link", "Low frame rate", "Unsteady"]);

/** The fan-out's answer: a count, "unknown" (sent, number not given), or null (nobody was told). */
export type FollowersTold = number | "unknown" | null;

export interface CoachFacts {
  /** Since this studio saw the stream go live. */
  elapsedMs: number;
  practice: boolean;
  untitled: boolean;
  viewers: number;
  guests: number;
  canInvite: boolean;
  saveData: boolean;
  /** How long the connection has been struggling; 0 when it isn't. */
  strugglingMs: number;
  /** Undefined until the go-live answer lands (and on a resume, where there is none). */
  followersTold: FollowersTold | undefined;
}

/** Whether a verdict is one data saver helps with. */
export function isStruggle(health: CoachDriverInput["health"]): boolean {
  return Boolean(health && health.level !== "good" && STRUGGLES.has(health.label));
}

/** Whether a line's condition holds right now (time aside). */
export function coachHolds(kind: CoachKind, f: CoachFacts): boolean {
  switch (kind) {
    case "followers":
      return !f.practice && f.followersTold !== undefined && f.followersTold !== null && f.followersTold !== 0;
    case "practice":
      return f.practice;
    case "share":
      return !f.practice;
    case "title":
      return f.untitled;
    case "invite":
      return !f.practice && f.guests === 0 && f.canInvite;
    case "signal":
      return !f.saveData && f.strugglingMs >= COACH_STRUGGLE_MS;
    case "keep-going":
      return !f.practice && f.viewers > 0;
  }
}

/**
 * The next line to show, or null: nothing due, the gap since the last one
 * isn't up, or the stream has had its six.
 */
export function nextCoach(f: CoachFacts, shown: readonly CoachKind[], lastAt: number | null, now: number): CoachKind | null {
  if (shown.length >= COACH_MAX) return null;
  if (lastAt !== null && now - lastAt < COACH_GAP_MS) return null;
  return ORDER.find((k) => !shown.includes(k) && f.elapsedMs >= COACH_AT[k] && coachHolds(k, f)) ?? null;
}

/** Whether a line on screen should go because it no longer holds. */
export function coachMoot(kind: CoachKind, f: CoachFacts): boolean {
  if (kind === "title") return !f.untitled;
  if (kind === "invite") return f.guests > 0;
  if (kind === "signal") return f.saveData;
  return false;
}

const plural = (n: number, one: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : `${one}s`}`;

/** What a line says. */
export function coachText(kind: CoachKind, f: Pick<CoachFacts, "followersTold">): string {
  switch (kind) {
    case "followers":
      return typeof f.followersTold === "number"
        ? `We're telling your ${plural(f.followersTold, "follower")} you're live`
        : "We're telling your followers you're live";
    case "share":
      return "Share your link to bring people in";
    case "invite":
      return "Invite someone to go live with you";
    case "title":
      return "Add a title so people know what's on";
    case "signal":
      return "Your connection is struggling. Turn on Data saver?";
    case "keep-going":
      return "Keep going, people are finding your stream";
    case "practice":
      return "This is a practice run: only people with your link can see it";
  }
}

const ICON: Record<CoachKind, CoachIcon> = {
  followers: "bell",
  share: "share",
  invite: "invite",
  title: "title",
  signal: "signal",
  "keep-going": "spark",
  practice: "lock",
};

const ACTION: Partial<Record<CoachKind, { label: string; key: keyof CoachDriverInput["actions"] }>> = {
  share: { label: "Share", key: "share" },
  invite: { label: "Invite", key: "invite" },
  title: { label: "Add title", key: "addTitle" },
  signal: { label: "Turn on", key: "saveData" },
  practice: { label: "Share preview", key: "practiceShare" },
};

/* ------------------------------------------------------------------ */
/* The store                                                            */
/* ------------------------------------------------------------------ */

interface ShownLine {
  line: CoachLine;
  kind: CoachKind;
  streamId: string;
  at: number;
}

interface StreamState {
  streamId: string;
  liveSince: number;
  shown: CoachKind[];
  lastAt: number | null;
  strugglingSince: number | null;
}

let input: CoachDriverInput | null = null;
let stream: StreamState | null = null;
let onScreen: ShownLine[] = [];
let snapshot: CoachLine[] = [];
/** Per stream: the fan-out's answer from the go-live response. */
const told = new Map<string, FollowersTold>();
const listeners = new Set<() => void>();

const storeKey = (streamId: string) => `xtream:coach:${streamId}`;

function readShown(streamId: string): { shown: CoachKind[]; lastAt: number | null } {
  try {
    const raw = sessionStorage.getItem(storeKey(streamId));
    if (raw) {
      const v = JSON.parse(raw) as { shown?: unknown; lastAt?: unknown };
      return {
        shown: Array.isArray(v.shown) ? (v.shown.filter((k) => typeof k === "string" && k in COACH_AT) as CoachKind[]) : [],
        lastAt: typeof v.lastAt === "number" ? v.lastAt : null,
      };
    }
  } catch {
    // Private mode or storage off: this page remembers anyway.
  }
  return { shown: [], lastAt: null };
}

function writeShown(s: StreamState) {
  try {
    sessionStorage.setItem(storeKey(s.streamId), JSON.stringify({ shown: s.shown, lastAt: s.lastAt }));
  } catch {
    // As above.
  }
}

function publish(next: ShownLine[]) {
  const same = next.length === onScreen.length && next.every((l, i) => l === onScreen[i]);
  if (same) return;
  onScreen = next;
  snapshot = next.map((l) => l.line);
  listeners.forEach((fn) => fn());
}

function factsNow(now: number): CoachFacts | null {
  if (!input || !stream) return null;
  return {
    elapsedMs: now - stream.liveSince,
    practice: input.practice,
    untitled: input.untitled,
    viewers: input.viewers,
    guests: input.guests,
    canInvite: input.canInvite,
    saveData: input.saveData,
    strugglingMs: stream.strugglingSince === null ? 0 : now - stream.strugglingSince,
    followersTold: told.get(stream.streamId),
  };
}

function makeLine(kind: CoachKind, streamId: string, facts: CoachFacts): CoachLine {
  const id = `coach:${kind}:${streamId}`;
  const act = ACTION[kind];
  return {
    id,
    icon: ICON[kind],
    text: coachText(kind, facts),
    ...(act
      ? {
          action: {
            label: act.label,
            run: () => {
              // The studio's latest handler, not the one from when the line went up.
              input?.actions[act.key]();
              dismissCoach(id);
            },
          },
        }
      : {}),
  };
}

/** One step: retire what's done, then maybe say the next thing. */
function evaluate(now: number) {
  if (!input?.isLive || !input.streamId) {
    stream = null;
    publish([]);
    return;
  }
  if (!stream || stream.streamId !== input.streamId) {
    const kept = readShown(input.streamId);
    stream = { streamId: input.streamId, liveSince: now, shown: kept.shown, lastAt: kept.lastAt, strugglingSince: null };
  }
  const s = stream;
  if (isStruggle(input.health)) s.strugglingSince ??= now;
  else s.strugglingSince = null;

  const facts = factsNow(now)!;
  let lines = onScreen.filter((l) => l.streamId === s.streamId && now - l.at < COACH_TTL_MS && !coachMoot(l.kind, facts));

  if (input.visible) {
    const kind = nextCoach(facts, s.shown, s.lastAt, now);
    if (kind) {
      s.shown = [...s.shown, kind];
      s.lastAt = now;
      writeShown(s);
      lines = [...lines, { line: makeLine(kind, s.streamId, facts), kind, streamId: s.streamId, at: now }];
    }
  }
  publish(lines);
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
const getSnapshot = () => snapshot;
const EMPTY: CoachLine[] = [];
const getServerSnapshot = () => EMPTY;

/* ------------------------------------------------------------------ */
/* The API                                                              */
/* ------------------------------------------------------------------ */

/** The coach's lines on screen for this stream, oldest first. Empty off air. */
export function useCoachLines(streamId: string | null): CoachLine[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => (streamId ? all.filter((l) => l.id.endsWith(`:${streamId}`)) : EMPTY), [all, streamId]);
}

/** Close a line. It won't come back this stream. */
export function dismissCoach(id: string): void {
  publish(onScreen.filter((l) => l.line.id !== id));
}

/**
 * The go-live response's `followersTold`: how many followers the bell went
 * to. Undefined (an API that doesn't say) is "sent, number unknown"; null or
 * 0 means nobody was told, and the line isn't said.
 */
export function noteFollowersTold(streamId: string, followersTold: number | null | undefined): void {
  told.set(streamId, followersTold === undefined ? "unknown" : followersTold);
}

/** The studio's state in, once per render; the coach ticks every second while live. */
export function useCoachDriver(next: CoachDriverInput): void {
  // The latest state and handlers, for the tick and the buttons.
  useEffect(() => {
    input = next;
  });

  const { isLive, streamId, visible, untitled, guests, saveData, practice } = next;
  const struggling = isStruggle(next.health);
  // Changes that retire a line (or free one up) are acted on at once.
  useEffect(() => {
    evaluate(Date.now());
  }, [isLive, streamId, visible, untitled, guests, saveData, practice, struggling]);

  useEffect(() => {
    if (!isLive || !streamId) return;
    const t = setInterval(() => evaluate(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [isLive, streamId]);

  // The studio going away takes its lines with it.
  useEffect(
    () => () => {
      input = null;
      evaluate(Date.now());
    },
    [],
  );
}
