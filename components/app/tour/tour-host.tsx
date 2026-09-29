"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useLiveSession } from "@/lib/live-session";
import { TOURS, resolveStep, tourById, type Tour, type TourId, type TourMove } from "@/lib/tour/story";
import { PRACTICE_EVENT, PRACTICE_HREF, forcedTour, isTourDue, markTipsSeen, markTourSeen, onTourAction, resetTours, snoozeTour } from "@/lib/tour/state";
import { findTarget, isPhoneLayout, pageReady, somethingOpen } from "./tour-dom";
import { TourOverlay } from "./tour-overlay";
import { TourTips } from "./tour-tip";

/**
 * Plays the walkthrough — one tour at a time, never over another dialog.
 *
 * Mounted once in the app shell. It watches the route and the actions the
 * app reports (`tourAction`), and when a tour is due for this person
 * (lib/tour/state.ts) it waits for the page to finish loading and for any
 * open dialog, sheet or menu to close, then plays it.
 *
 *  - The "new look" tour plays on the first visit to any browsing page.
 *  - A page's explainer plays the first time you land on that page.
 *  - An action's tour plays the first time you do the thing (going live,
 *    opening the gift keyboard), after whatever's playing now.
 *
 * A tour only starts once the page is really there: the document and fonts
 * are in, nothing is still loading, and the first step's target has turned
 * up and held still. A page that hasn't settled in GIVE_UP_MS gets no tour
 * this visit (and it isn't marked seen, so it plays another time).
 *
 * It plays only what's there. The steps whose targets aren't on this page,
 * in this layout, drop out before it starts (the dots count the rest), and
 * a target that vanishes mid-tour is skipped in the direction of travel. A
 * step that didn't play comes back later as a lone tip (tour-tip.tsx) the
 * first time its target is on screen. A tour marks itself seen only if at
 * least one of its steps played; with it, the steps that did (so their tips
 * never show).
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
/** A page that hasn't settled (or shown the first step's target) by now gets no tour this visit. */
const GIVE_UP_MS = 30_000;
/** The first step's target has to hold still this long before the tour starts. */
const FIRST_STILL_MS = 400;

interface Playing {
  tour: Tour;
  /** The steps that play, as indexes into `tour.steps`. */
  plan: number[];
  /** Where in `plan` we are. */
  at: number;
  /** The way we're travelling: a vanished step is skipped this way. */
  dir: 1 | -1;
  /** A dev `?tour=` replay: plays regardless, and records nothing. */
  forced: boolean;
  closing: boolean;
  /** The page it started on (a page tour closes if you leave). */
  path: string;
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

/** The step's targets in this layout: none means it's a centred step, which always plays. */
function targetsOf(tour: Tour, index: number, phone: boolean): string[] {
  return resolveStep(tour.steps[index], phone).targets;
}

/** A step can play now: it's centred, or its target is on the page (below the fold is fine: the tour scrolls to it). */
function playable(tour: Tour, index: number, phone: boolean): boolean {
  const names = targetsOf(tour, index, phone);
  return names.length === 0 || findTarget(names) !== null;
}

/** The steps of a tour that can play on this page, in this layout. */
function planFor(tour: Tour, phone: boolean): number[] {
  return tour.steps.map((_, i) => i).filter((i) => playable(tour, i, phone));
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
  /** The steps (indexes into the full story) the playing tour has actually shown. */
  const played = useRef<Set<number>>(new Set());
  /** A tour is up, or about to start: the lone tips keep out of its way. */
  const busy = useRef({ playing: false, waiting: false });
  useEffect(() => {
    busy.current.playing = playing !== null;
  }, [playing]);
  const tourBusy = useCallback(() => (busy.current.playing ? "playing" : busy.current.waiting ? "waiting" : null), []);

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

  // Choosing what plays next, and waiting for the page to be really there to play it.
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
    /** The first step's target as last seen, and since when it's been exactly there. */
    let still: { key: string; x: number; y: number; w: number; h: number; since: number } | null = null;
    busy.current.waiting = true;
    const stop = () => {
      busy.current.waiting = false;
    };
    const attempt = () => {
      // Never settled: no tour this visit, and nothing recorded.
      if (Date.now() - started > GIVE_UP_MS) return stop();
      // A moment's tour needs its moment: the gift keyboard closed before it got a turn.
      if (pick.tour.over && !present(pick.tour.over)) {
        stop();
        setQueued((q) => q.filter((id) => id !== pick.tour.id));
        return;
      }
      if (!pick.forced && inPreview()) return stop();
      if (somethingOpen(pick.tour.over ?? pick.tour.beside)) {
        timer = setTimeout(attempt, POLL_MS);
        return;
      }
      // The page has finished loading: no skeletons, no spinners, fonts in.
      if (!pageReady()) {
        timer = setTimeout(attempt, READY_POLL_MS);
        return;
      }
      // Only the steps whose targets are here play. None yet: the page may still be filling in.
      const phone = isPhoneLayout();
      const plan = planFor(pick.tour, phone);
      const at = plan.findIndex((i) => i >= pick.index);
      if (at < 0) {
        timer = setTimeout(attempt, READY_POLL_MS);
        return;
      }
      // The first step's target has turned up and held still (a centred step needs none).
      const names = targetsOf(pick.tour, plan[at], phone);
      if (names.length > 0) {
        const el = findTarget(names);
        const r = el?.getBoundingClientRect();
        const key = `${plan[at]}`;
        if (!r) {
          still = null;
          timer = setTimeout(attempt, READY_POLL_MS);
          return;
        }
        const same = still && still.key === key && Math.abs(still.x - r.x) < 1 && Math.abs(still.y - r.y) < 1 && Math.abs(still.w - r.width) < 1 && Math.abs(still.h - r.height) < 1;
        if (!same) still = { key, x: r.x, y: r.y, w: r.width, h: r.height, since: Date.now() };
        if (!same || Date.now() - still!.since < FIRST_STILL_MS) {
          timer = setTimeout(attempt, READY_POLL_MS);
          return;
        }
      }
      stop();
      setQueued((q) => q.filter((id) => id !== pick.tour.id));
      // A replay counts as played only once it starts: the page settling (auth, the live session)
      // re-runs this effect and clears the wait, and the replay must survive that.
      if (pick.forced) forcedFor.current = window.location.pathname + window.location.search;
      played.current = new Set();
      setPlaying({ tour: pick.tour, plan, at, dir: 1, forced: pick.forced, closing: false, path: pathname });
    };
    timer = setTimeout(attempt, pick.settle);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [isLoading, playing, pathname, uid, queued, eligible]);

  /** Where a practice run was asked for: the studio's own tour waits for another visit. */
  const practiceTo = useRef<string | null>(null);

  /**
   * The tour ends. "Later" snoozes it (its tips wait with it); anything else marks it seen, with
   * the steps it played, in one go, provided it played any at all. A replay records nothing.
   */
  const end = useCallback(
    (p: Playing, move: TourMove | "quiet") => {
      if (!p.forced) {
        if (move === "later") snoozeTour(p.tour.id, uid);
        else if (played.current.size > 0) {
          markTipsSeen(p.tour.id, [...played.current], uid);
          markTourSeen(p.tour.id, uid);
        }
      }
      setPlaying({ ...p, closing: true });
    },
    [uid],
  );

  /**
   * Moving to `from` and on in `dir`: steps whose targets have gone since the tour started are
   * dropped on the way (their tips come later). Null when there's nothing left that way.
   */
  const travel = useCallback((p: Playing, from: number, dir: 1 | -1): Pick<Playing, "plan" | "at"> | null => {
    const phone = isPhoneLayout();
    const plan = [...p.plan];
    let at = from;
    while (at >= 0 && at < plan.length && !playable(p.tour, plan[at], phone)) {
      plan.splice(at, 1);
      if (dir < 0) at -= 1;
    }
    return at >= 0 && at < plan.length ? { plan, at } : null;
  }, []);

  const onMove = useCallback(
    (move: TourMove) => {
      if (!playing || playing.closing) return;
      const { at, plan } = playing;
      if (move === "next" && at < plan.length - 1) {
        const to = travel(playing, at + 1, 1);
        return to ? setPlaying({ ...playing, ...to, dir: 1 }) : end(playing, "finish");
      }
      if (move === "back") {
        const to = at > 0 ? travel(playing, at - 1, -1) : null;
        return to ? setPlaying({ ...playing, ...to, dir: -1 }) : undefined;
      }
      // Everything else closes it: "Later" for a day, the rest for good. The step on screen was seen,
      // and closing early says "don't show me" for the steps still ahead (owner, 2026-09-29): only
      // steps dropped because their target wasn't there come back later as tips.
      if (move !== "later") for (const i of plan) played.current.add(i);
      end(playing, move);
      if (move === "practice") {
        practiceTo.current = "/studio";
        if (window.location.pathname === "/studio") window.dispatchEvent(new Event(PRACTICE_EVENT));
        else router.push(PRACTICE_HREF);
      }
    },
    [playing, router, travel, end],
  );

  const onLanded = useCallback((index: number) => {
    played.current.add(index);
  }, []);

  // A step's target never came, or went: skip it the way we were going. Nothing left: close quietly.
  const onMissing = useCallback(
    (index: number) => {
      if (!playing || playing.closing) return;
      const pos = playing.plan.indexOf(index);
      if (pos < 0) return;
      // Skipped, even if it was lit for a moment before its target went: it comes back as a tip.
      played.current.delete(index);
      const rest = { ...playing, plan: playing.plan.filter((i) => i !== index) };
      const onward = travel(rest, playing.dir > 0 ? pos : pos - 1, playing.dir);
      // Going back and nothing's left behind: carry on forward from the start instead.
      const turned = !onward && playing.dir < 0 ? travel(rest, 0, 1) : null;
      if (onward) setPlaying({ ...rest, ...onward });
      else if (turned) setPlaying({ ...rest, ...turned, dir: 1 });
      else end(playing, "quiet");
    },
    [playing, travel, end],
  );

  const onExited = useCallback(() => {
    setPlaying(null);
    endedOn.current = practiceTo.current ?? window.location.pathname;
    practiceTo.current = null;
  }, []);

  return (
    <>
      {!isLoading && <TourTips uid={uid} eligible={eligible} tourBusy={tourBusy} />}
      {playing && (
        <TourOverlay
          key={playing.tour.id}
          tour={playing.tour}
          plan={playing.plan}
          at={playing.at}
          closing={playing.closing}
          onMove={onMove}
          onExited={onExited}
          onLanded={onLanded}
          onMissing={onMissing}
        />
      )}
    </>
  );
}
