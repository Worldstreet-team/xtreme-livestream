"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useLiveSession } from "@/lib/live-session";
import { TOURS, tourById, type Tour, type TourId, type TourMove } from "@/lib/tour/story";
import { PRACTICE_EVENT, PRACTICE_HREF, forcedTour, isTourDue, markTourSeen, onTourAction, resetTours, snoozeTour } from "@/lib/tour/state";
import { TourOverlay, pageBusy } from "./tour-overlay";

/**
 * Plays the walkthrough — one tour at a time, never over another dialog.
 *
 * Mounted once in the app shell. It watches the route and the actions the
 * app reports (`tourAction`), and when a tour is due for this person
 * (lib/tour/state.ts) it waits for the page to settle and for any open
 * dialog, sheet or menu to close, then plays it.
 *
 *  - The "new look" tour plays on the first visit to any browsing page.
 *  - A page's explainer plays the first time you land on that page.
 *  - An action's tour plays the first time you do the thing (going live,
 *    opening the gift keyboard), after whatever's playing now.
 *
 * At most one tour starts per page: once one ends, the next waits until you
 * go somewhere else, so nobody finishes one walkthrough only to be handed
 * another. Leaving a page mid-tour closes that page's tour without marking
 * it seen, so it plays next time.
 */

/** Let the page render (and its data arrive) before looking for targets. */
const SETTLE_MS = 1100;
/** Going live: the console needs a moment to come up around the picture. */
const ACTION_SETTLE_MS = 1600;
/** How often, and for how long, to wait for another dialog to close. */
const POLL_MS = 700;
const READY_POLL_MS = 200;
const GIVE_UP_MS = 30_000;
/** How long a tour waits for the page to finish loading (fonts, skeletons) before starting regardless. */
const READY_CAP_MS = 8000;

/** The page has finished loading: the document and its fonts are in, and no skeleton or spinner is showing. */
function pageReady(): boolean {
  if (document.readyState !== "complete") return false;
  if (document.fonts && document.fonts.status !== "loaded") return false;
  return !pageBusy();
}

interface Playing {
  tour: Tour;
  index: number;
  /** A dev `?tour=` replay: plays regardless, and records nothing. */
  forced: boolean;
  closing: boolean;
  /** The page it started on (a page tour closes if you leave). */
  path: string;
}

/** Something modal is already up: a dialog, a sheet, a menu, a listbox. */
function somethingOpen(allow?: string): boolean {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
  for (const el of open) {
    if (el.closest("[data-tour-root]")) continue;
    if (allow && (el.closest(`[data-tour="${allow}"]`) || el.querySelector(`[data-tour="${allow}"]`))) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return true;
  }
  return false;
}

/**
 * A practice run's private preview (`/stream/<id>?preview=<key>`) is watch-only:
 * no gifts, chat or follow to explain, and not the moment for any tour.
 */
function inPreview(): boolean {
  return new URLSearchParams(window.location.search).has("preview");
}

function present(name: string): boolean {
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export function TourHost() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isLoading } = useAuth();
  const session = useLiveSession();
  const uid = user?.id ?? null;
  const signedIn = Boolean(user);
  const onAir = Boolean(session);

  const [playing, setPlaying] = useState<Playing | null>(null);
  /** Action tours waiting their turn. */
  const [queued, setQueued] = useState<TourId[]>([]);
  /** The page the last tour ended on — no second tour starts there. */
  const endedOn = useRef<string | null>(null);
  /** The dev override plays once per URL. */
  const forcedFor = useRef<string | null>(null);

  // Actions arrive from anywhere; they wait here until it's their turn.
  useEffect(
    () =>
      onTourAction((action) => {
        const tour = TOURS.find((t) => t.trigger.some((tr) => tr.kind === "action" && tr.action === action));
        if (tour) setQueued((q) => (q.includes(tour.id) ? q : [...q, tour.id]));
      }),
    [],
  );

  const eligible = useCallback(
    (tour: Tour) => (tour.audience === "anyone" || signedIn) && (!tour.offAir || !onAir),
    [signedIn, onAir],
  );

  // Leaving the page closes a page's own tour (it plays next time); the
  // first-visit tour is about the whole app, so it carries on.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (playing && !playing.closing && playing.path !== pathname) {
      const stays = playing.tour.trigger.some((t) => t.kind === "first-visit" || (t.kind === "route" && t.match.test(pathname)));
      if (!stays) setPlaying({ ...playing, closing: true });
    }
  }

  // Choosing what plays next, and waiting for a quiet moment to play it.
  useEffect(() => {
    if (isLoading || playing) return;

    let next: { tour: Tour; index: number; forced: boolean; settle: number } | null = null;

    const forced = forcedTour();
    const href = window.location.pathname + window.location.search;
    if (forced && forcedFor.current !== href) {
      if (forced.id === "reset") {
        forcedFor.current = href;
        resetTours(uid);
      } else {
        const tour = tourById(forced.id);
        if (tour) next = { tour, index: Math.min(forced.step, tour.steps.length - 1), forced: true, settle: 600 };
      }
    }

    // Nothing plays over a private preview (the dev override still does).
    if (!next && inPreview()) return;

    // Something you just did comes first.
    if (!next) {
      for (const id of queued) {
        const tour = tourById(id);
        if (tour && eligible(tour) && isTourDue(tour.id, uid)) {
          next = { tour, index: 0, forced: false, settle: ACTION_SETTLE_MS };
          break;
        }
      }
    }

    // Then the first visit, then the page's own explainer — one per page.
    if (!next && endedOn.current !== pathname) {
      for (const tour of TOURS) {
        if (!eligible(tour) || !isTourDue(tour.id, uid)) continue;
        const firstVisit = tour.trigger.some((t) => t.kind === "first-visit") && (!tour.where || tour.where.test(pathname));
        const route = tour.trigger.some((t) => t.kind === "route" && t.match.test(pathname));
        if (firstVisit || route) {
          next = { tour, index: 0, forced: false, settle: SETTLE_MS };
          break;
        }
      }
    }
    if (!next) return;

    const pick = next;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (Date.now() - started > GIVE_UP_MS) return;
      // A moment's tour needs its moment: the gift keyboard closed before it got a turn.
      if (pick.tour.over && !present(pick.tour.over)) {
        setQueued((q) => q.filter((id) => id !== pick.tour.id));
        return;
      }
      if (!pick.forced && inPreview()) return;
      if (somethingOpen(pick.tour.over ?? pick.tour.beside)) {
        timer = setTimeout(attempt, POLL_MS);
        return;
      }
      // Let the page finish loading first (up to a point: a page that never settles still gets its tour).
      if (!pageReady() && Date.now() - started < pick.settle + READY_CAP_MS) {
        timer = setTimeout(attempt, READY_POLL_MS);
        return;
      }
      setQueued((q) => q.filter((id) => id !== pick.tour.id));
      // A replay counts as played only once it starts: the page settling (auth, the live session)
      // re-runs this effect and clears the wait, and the replay must survive that.
      if (pick.forced) forcedFor.current = window.location.pathname + window.location.search;
      setPlaying({ tour: pick.tour, index: pick.index, forced: pick.forced, closing: false, path: pathname });
    };
    timer = setTimeout(attempt, pick.settle);
    return () => clearTimeout(timer);
  }, [isLoading, playing, pathname, uid, queued, eligible]);

  /** Where a practice run was asked for: the studio's own tour waits for another visit. */
  const practiceTo = useRef<string | null>(null);

  const onMove = useCallback(
    (move: TourMove) => {
      if (!playing || playing.closing) return;
      const { tour, index, forced } = playing;
      const last = index === tour.steps.length - 1;
      if (move === "next" && !last) return setPlaying({ ...playing, index: index + 1 });
      if (move === "back") return index > 0 ? setPlaying({ ...playing, index: index - 1 }) : undefined;
      // Everything else closes it: "Later" for a day, the rest for good.
      if (!forced) {
        if (move === "later") snoozeTour(tour.id, uid);
        else markTourSeen(tour.id, uid);
      }
      setPlaying({ ...playing, closing: true });
      if (move === "practice") {
        practiceTo.current = "/studio";
        if (window.location.pathname === "/studio") window.dispatchEvent(new Event(PRACTICE_EVENT));
        else router.push(PRACTICE_HREF);
      }
    },
    [playing, router, uid],
  );

  const onExited = useCallback(() => {
    setPlaying(null);
    endedOn.current = practiceTo.current ?? window.location.pathname;
    practiceTo.current = null;
  }, []);

  if (!playing) return null;
  return (
    <TourOverlay
      key={playing.tour.id}
      tour={playing.tour}
      index={playing.index}
      closing={playing.closing}
      onMove={onMove}
      onExited={onExited}
    />
  );
}
