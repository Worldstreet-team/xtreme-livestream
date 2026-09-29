"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { X } from "@/components/icons";
import { Tip } from "@/components/ui/tip";
import { DURATION, EASE } from "@/lib/motion";
import { holeFor, placeTip, type Box, type Hole, type TipPlacement } from "@/lib/tour/geometry";
import { isTipDue, markTipSeen } from "@/lib/tour/state";
import { TOURS, resolveStep, type Tour } from "@/lib/tour/story";
import { barInsets, boxOf, findTarget, inBar, pageReady, sameBox, somethingOpen, stillThere, usePhoneLayout, viewport, visibleShare, type Bars } from "./tour-dom";
import styles from "./tour-tip.module.css";

/**
 * Deferred tips: a tour's step that didn't play (its target wasn't on the
 * page, or went away mid-tour) comes back later as a lone tooltip, the first
 * time its target is properly on screen. Not a walkthrough: no dim, no
 * Back or Next, nothing blocked — the bubble names the thing, with an × to
 * close it, a small arrow at it and one soft Ember ring pulse around it.
 *
 * When one shows: its tour has been seen (a snoozed tour's tips wait with
 * it), the tip hasn't (lib/tour/state.ts `isTipDue`), and its target, for
 * this layout, is at least 60% on screen and has held still for STILL_MS,
 * with the page settled and no tour, dialog, sheet or menu up. It appears
 * DELAY_MS after that. One at a time, and at most one per page view.
 *
 * It goes for good with the × or a tap on the target itself (which still
 * does what it does). It follows the target as the page scrolls, fades out
 * while the target is off screen or something modal is up, and comes back
 * if the target does, until you leave the page. Leaving without closing it
 * leaves it due for another time.
 */

/** How often the page is looked over for a tip that's due. */
const SCAN_MS = 200;
/** The target has to hold still this long… */
const STILL_MS = 600;
/** …and then the tip waits this long more before it appears. */
const DELAY_MS = 1000;
/** On screen enough to be pointed at; and gone enough, once shown, to hide. */
const SHOW_SHARE = 0.6;
const HIDE_SHARE = 0.4;
/** The app's bars are read this often while a tip is up (it's a layout walk, too dear for every frame). */
const BARS_EVERY_MS = 500;
/** The bubble's widest. */
const MAX_W = 280;

const TIP_VARS = {
  "--tip-ease": EASE.tip,
  "--tip-ease-out": EASE.tipOut,
  "--tip-in": `${DURATION.tip}ms`,
  "--tip-out": `${DURATION.tipOut}ms`,
  "--tip-fade": `${DURATION.fade}ms`,
} as CSSProperties;

interface Due {
  tour: Tour;
  /** The step's index in the tour's full story. */
  index: number;
  names: string[];
}

/** A practice run's private preview is watch-only: no tips there either. */
function inPreview(): boolean {
  return new URLSearchParams(window.location.search).has("preview");
}

/** How much of the target is on screen: bars count against page content, not against the bars' own buttons. */
function shareOf(el: HTMLElement, box: Box | null, bars: Bars): number {
  return visibleShare(box, viewport(), inBar(el) ? { top: 0, bottom: 0 } : bars);
}

/**
 * Something modal is up in this tip's way. The panel its tour was allowed to
 * play over or beside (the gift keyboard, the studio's room sheet) is where
 * its targets live, so that one doesn't count.
 */
function blocked(tour: Tour): boolean {
  return somethingOpen(tour.over ?? tour.beside);
}

export function TourTips({
  uid,
  eligible,
  tourBusy,
}: {
  uid: string | null;
  /** Whether this person can see a tour's steps at all (signed-in tours, off-air tours). */
  eligible: (tour: Tour) => boolean;
  /** A tour is playing ("playing") or waiting to start ("waiting"): tips keep out of its way. */
  tourBusy: () => "playing" | "waiting" | null;
}) {
  const pathname = usePathname();
  const phone = usePhoneLayout();
  const [tip, setTip] = useState<(Due & { path: string }) | null>(null);
  /** Something modal (or a tour) is up over the page: the tip steps aside, and comes back after. */
  const [aside, setAside] = useState(false);
  /** The page view that has had its tip. */
  const usedOn = useRef<string | null>(null);

  // A new page: the last page's tip goes (still due, since it wasn't closed), and this one may have its own.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (tip) setTip(null);
  }

  // Every visit to a page is a new page view (coming back to one included).
  useEffect(() => {
    usedOn.current = null;
  }, [pathname]);

  // Looking for a tip that's due, and waiting for its target to settle on screen.
  useEffect(() => {
    let cand: { key: string; box: Box; since: number } | null = null;
    let dueList: Due[] = [];
    let dueAt = 0;
    const scan = () => {
      const busy = tourBusy();
      if (tip) {
        const off = busy !== null || blocked(tip.tour);
        setAside((a) => (a === off ? a : off));
        return;
      }
      // A tour that played here doesn't use up the page's tip: a step it had to drop can
      // turn up as a tip once its target arrives, right after the tour, on the same page.
      if (usedOn.current === pathname || busy || inPreview() || !pageReady()) {
        cand = null;
        return;
      }
      // Which tips are due changes only when something's closed or a tour ends: a second's staleness is fine.
      if (Date.now() - dueAt > 1000) {
        dueAt = Date.now();
        dueList = [];
        for (const tour of TOURS) {
          if (!eligible(tour)) continue;
          tour.steps.forEach((step, index) => {
            const names = resolveStep(step, phone).targets;
            if (names.length > 0 && isTipDue(tour.id, index, uid)) dueList.push({ tour, index, names });
          });
        }
      }
      if (dueList.length === 0) {
        cand = null;
        return;
      }
      const vp = viewport();
      const bars = barInsets(vp);
      const open = somethingOpen();
      for (const due of dueList) {
        if (open && blocked(due.tour)) continue;
        const el = findTarget(due.names);
        if (!el) continue;
        const box = boxOf(el, vp);
        if (!box || shareOf(el, box, bars) < SHOW_SHARE) continue;
        const key = `${due.tour.id}:${due.index}`;
        if (!cand || cand.key !== key || !sameBox(cand.box, box)) {
          cand = { key, box, since: Date.now() };
          return;
        }
        if (Date.now() - cand.since >= STILL_MS + DELAY_MS) {
          usedOn.current = pathname;
          cand = null;
          setAside(false);
          setTip({ ...due, path: pathname });
        }
        return;
      }
      cand = null;
    };
    const timer = setInterval(scan, SCAN_MS);
    return () => clearInterval(timer);
  }, [pathname, phone, uid, tip, eligible, tourBusy]);

  const onClose = useCallback(() => {
    if (tip) markTipSeen(tip.tour.id, tip.index, uid);
  }, [tip, uid]);
  const onGone = useCallback(() => setTip(null), []);

  if (!tip || tip.path !== pathname) return null;
  const copy = resolveStep(tip.tour.steps[tip.index], phone);
  return (
    <TipBubble
      key={`${tip.tour.id}:${tip.index}:${tip.path}`}
      names={tip.names}
      title={copy.title}
      line={copy.line}
      aside={aside}
      onClose={onClose}
      onGone={onGone}
    />
  );
}

/* ---- The bubble -------------------------------------------------------- */

interface Spot {
  box: Box;
  /** The ring around it: the spotlight's hole (the ring is drawn just outside it, and the bubble keeps clear of that). */
  hole: Hole;
  place: TipPlacement;
}

/** The ring's width, as the walkthrough's. */
const RING = 2;

function TipBubble({
  names,
  title,
  line,
  aside,
  onClose,
  onGone,
}: {
  names: string[];
  title: string;
  line: string;
  /** Something's over the page: fade out for now. */
  aside: boolean;
  /** Closed for good (the × or the target tapped): record it. */
  onClose: () => void;
  /** It has faded out after closing. */
  onGone: () => void;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  /** The target is on screen to be pointed at. */
  const [onScreen, setOnScreen] = useState(true);
  const [closed, setClosed] = useState(false);
  /** The target, as found; a re-render that replaces it is followed to the new one. */
  const targetRef = useRef<HTMLElement | null>(null);

  // The bubble's own size, untransformed.
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!el) return;
    const read = () => setSize((s) => (s && s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Following the target: every frame for its box (a scroll, a layout shift), the bars now and then.
  useEffect(() => {
    if (!size) return;
    let frame = 0;
    let bars: Bars = barInsets(viewport());
    let barsAt = Date.now();
    let last: Spot | null = null;
    let shown = true;
    const measure = () => {
      frame = requestAnimationFrame(measure);
      if (!stillThere(targetRef.current)) targetRef.current = findTarget(names);
      const el = targetRef.current;
      const vp = viewport();
      if (Date.now() - barsAt > BARS_EVERY_MS) {
        bars = barInsets(vp);
        barsAt = Date.now();
      }
      const box = el ? boxOf(el, vp) : null;
      const share = el && box ? shareOf(el, box, bars) : 0;
      const nowShown = shown ? share >= HIDE_SHARE : share >= SHOW_SHARE;
      if (nowShown !== shown) {
        shown = nowShown;
        setOnScreen(nowShown);
      }
      if (!box || !nowShown) return;
      const hole = holeFor(box, vp);
      const ring: Box = { x: hole.x - RING, y: hole.y - RING, w: hole.w + RING * 2, h: hole.h + RING * 2 };
      const place = placeTip(ring, size, vp, el && inBar(el) ? { top: 0, bottom: 0 } : bars, last?.place.at ?? null);
      if (last && sameBox(last.box, box) && last.place.x === place.x && last.place.y === place.y && last.place.at === place.at) return;
      last = { box, hole, place };
      setSpot(last);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [names, size]);

  const close = useCallback(() => {
    if (closed) return;
    setClosed(true);
    onClose();
  }, [closed, onClose]);

  // Tapping or clicking the target while the tip points at it closes it for good; the tap still does what it does.
  const shownRef = useRef(false);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = targetRef.current;
      if (shownRef.current && el && e.target instanceof Node && el.contains(e.target)) close();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [close]);

  // Esc from inside the bubble closes it, like the ×.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && bubbleRef.current?.contains(document.activeElement)) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Closed: fade, then go.
  useEffect(() => {
    if (!closed) return;
    const t = setTimeout(onGone, Math.max(DURATION.tipOut, DURATION.fade) + 40);
    return () => clearTimeout(t);
  }, [closed, onGone]);

  // It arrives a frame after it's placed, so the entrance runs from where it sits.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!spot || ready) return;
    const t = setTimeout(() => setReady(true), 30);
    return () => clearTimeout(t);
  }, [spot, ready]);

  const shown = ready && onScreen && !aside && !closed;
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  const place = spot?.place;
  const hole = spot?.hole;

  return createPortal(
    <div data-tour-root data-tour-tip className={styles.root} style={TIP_VARS} data-shown={shown || undefined}>
      {hole && (
        <div
          aria-hidden
          className={styles.ring}
          style={{ transform: `translate3d(${hole.x}px, ${hole.y}px, 0)`, width: hole.w, height: hole.h, borderRadius: hole.r }}
        />
      )}
      <div
        className={styles.positioner}
        data-placed={place ? true : undefined}
        style={{ transform: place ? `translate3d(${Math.round(place.x)}px, ${Math.round(place.y)}px, 0)` : undefined, maxWidth: MAX_W }}
      >
        <div
          ref={bubbleRef}
          className={`${styles.bubble} w-max max-w-[min(280px,calc(100vw-24px))] rounded-[12px] bg-popover py-2.5 pr-9 pl-3 text-popover-foreground shadow-popover`}
          style={{ "--tip-origin": place ? `${place.along}px ${place.at === "below" ? "0%" : "100%"}` : undefined } as CSSProperties}
        >
          <div role="status" aria-live="polite">
            <p className="text-[13.5px] leading-[1.3] font-semibold tracking-[-0.01em] text-balance text-foreground">{title}</p>
            <p className="mt-0.5 text-[12.5px] leading-[1.42] text-pretty text-subtle">{line}</p>
          </div>
          <Tip label="Close" side="top">
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="press absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full text-subtle transition-colors outline-none hover:bg-tint/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ember"
            >
              <X size={14} weight="bold" />
            </button>
          </Tip>
          {place && place.at !== "over" && (
            <svg
              aria-hidden
              data-at={place.at}
              viewBox="0 0 14 7"
              className={`${styles.arrow} text-popover`}
              style={{ left: place.along - 7 }}
            >
              <path d="M0 0H14L8.3 5.9C7.6 6.6 6.4 6.6 5.7 5.9Z" fill="currentColor" />
            </svg>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
