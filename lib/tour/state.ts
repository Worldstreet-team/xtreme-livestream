import type { TourAction, TourId } from "./story";

/**
 * What each person has seen of the walkthrough, and the way the rest of the
 * app starts a tour.
 *
 * Seen and snoozed live in localStorage, per signed-in user id (a server
 * flag can come later): finishing or skipping a tour marks it seen for
 * good; "Later" snoozes it for a day. Signed out, the same record lives
 * under "guest". Storage that's blocked just means a tour may play again.
 *
 * Other code calls `tourAction("first-live")` and friends when the moment
 * happens; the host (components/app/tour/tour-host.tsx) decides whether a
 * tour is due and plays it. An action that fires before the host is ready
 * waits in a short queue.
 *
 * Dev override: `?tour=<id>` plays that tour now, seen or not (and
 * `&tourStep=<n>` opens it on step n, from 1); `?tour=reset` forgets
 * everything this person has seen.
 */

const KEY = "xtream:tour:v1";
/** "Later" means tomorrow. */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

interface TourRecord {
  /** Tour → when it was finished or skipped. */
  seen: Partial<{ [K in TourId]: number }>;
  /** Tour → when "Later" runs out. */
  snoozed: Partial<{ [K in TourId]: number }>;
}

const empty = (): TourRecord => ({ seen: {}, snoozed: {} });
const keyFor = (userId: string | null) => `${KEY}:${userId ?? "guest"}`;

function read(userId: string | null): TourRecord {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<TourRecord>;
    return { seen: parsed.seen ?? {}, snoozed: parsed.snoozed ?? {} };
  } catch {
    return empty();
  }
}

function write(userId: string | null, record: TourRecord) {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(record));
  } catch {
    // Blocked storage: the tour may simply play again next time.
  }
}

/** Not seen, and not snoozed (or the snooze has run out). */
export function isTourDue(id: TourId, userId: string | null, now = Date.now()): boolean {
  const r = read(userId);
  if (r.seen[id]) return false;
  const until = r.snoozed[id];
  return !until || until <= now;
}

/** Finished or skipped: never again. */
export function markTourSeen(id: TourId, userId: string | null) {
  const r = read(userId);
  r.seen[id] = Date.now();
  delete r.snoozed[id];
  write(userId, r);
}

/** "Later": back in a day. */
export function snoozeTour(id: TourId, userId: string | null, ms = SNOOZE_MS) {
  const r = read(userId);
  r.snoozed[id] = Date.now() + ms;
  write(userId, r);
}

/** Forget everything this person has seen (the dev `?tour=reset`, or a "replay the tours" setting). */
export function resetTours(userId: string | null) {
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    // Nothing to forget.
  }
}

/* ---- Actions -------------------------------------------------------- */

type Listener = (action: TourAction) => void;
const listeners = new Set<Listener>();
/** Actions that fired with nobody listening yet (the host mounts a beat after the page). */
let pending: { action: TourAction; at: number }[] = [];
/** How long an unheard action stays worth playing. */
const PENDING_MS = 8000;

/**
 * Something happened that a tour explains: the first tap on Go live, the
 * first time on air, the gift keyboard opening. Safe to call every time —
 * the host plays each tour once.
 */
export function tourAction(action: TourAction) {
  if (typeof window === "undefined") return;
  if (listeners.size === 0) {
    pending = [...pending.filter((p) => Date.now() - p.at < PENDING_MS), { action, at: Date.now() }];
    return;
  }
  listeners.forEach((l) => l(action));
}

/** The host listens here; anything that fired before it arrived is handed over first. */
export function onTourAction(listener: Listener): () => void {
  listeners.add(listener);
  const waiting = pending.filter((p) => Date.now() - p.at < PENDING_MS);
  pending = [];
  waiting.forEach((p) => listener(p.action));
  return () => {
    listeners.delete(listener);
  };
}

/* ---- The dev override ---------------------------------------------- */

/** `?tour=<id>&tourStep=<n>` — the tour to force, and the step to open on (0-based). */
export function forcedTour(): { id: string; step: number } | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const id = q.get("tour");
  if (!id) return null;
  const n = Number(q.get("tourStep"));
  return { id, step: Number.isFinite(n) && n > 0 ? n - 1 : 0 };
}

/* ---- The practice run ---------------------------------------------- */

/** The studio listens for this when it's already open (a URL change to the same page wouldn't remount it). */
export const PRACTICE_EVENT = "xtream:practice-run";
export const PRACTICE_HREF = "/studio?practice=1";
