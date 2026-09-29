"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CaretLeft } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { TourArt } from "@/components/app/tour/tour-art";
import { DURATION, EASE } from "@/lib/motion";
import { closedHole, holeFor, openHole, placeCard, placeDock, ringClip, scrimClip, type Box, type Dock, type Hole, type Side, type Viewport } from "@/lib/tour/geometry";
import { resolveStep, stepButtons, type Tour, type TourMove } from "@/lib/tour/story";
import { cn } from "@/lib/utils";
import { barInsets, boxOf, findTarget, pageBusy, pinned, sameBox, stillThere, usePhoneLayout, useReducedMotion, viewport, type Bars } from "./tour-dom";
import styles from "./tour.module.css";

export { findTarget, pageBusy, usePhoneLayout, useReducedMotion } from "./tour-dom";

/**
 * One step of a tour, drawn: the dim with its rounded cut-out around the
 * thing being named, an Ember ring (and a flat pulse) around it, and the
 * card — a floating card with a pointer beside it on a desktop; on a phone a
 * compact card docked to whichever end of the screen the target isn't at,
 * with a pointer line reaching across to it — carrying the morphing art,
 * the words, progress and the buttons.
 *
 * Tapping the lit thing itself is the same as Next (it never performs the
 * thing: opening the Go live sheet mid-tour would bury the tour under it).
 * Tapping the dim does nothing, so nobody closes a tour by accident.
 *
 * The host (tour-host.tsx) owns which tour and which step; this owns how it
 * looks and moves: finding the target, scrolling it into view, measuring it
 * as the page scrolls or resizes, and handing the geometry to CSS, which
 * does every bit of motion (lib/tour/geometry.ts, tour.module.css).
 *
 * It's a modal dialog: focus is held in the card, ← and → step, Esc leaves
 * (as "Later" on a first step that offers it), and a polite live region
 * reads each new step.
 */

/** The phone card's distance from the screen's edges (safe areas added on top). */
const SHEET_INSET = 8;
/** A phone card never gets wider than this, even on a big phone held sideways. */
const PHONE_CARD_MAX = 440;
const CARD_W = 348;

/** The curves and timings, as the custom properties tour.module.css reads. */
const TOUR_VARS = {
  "--tour-ease-glide": EASE.tourGlide,
  "--tour-ease-iris": EASE.tourIris,
  "--tour-ease-text": EASE.tourText,
  "--tour-ease-text-out": EASE.tourTextOut,
  "--tour-ease-rise": EASE.tourRise,
  "--tour-glide": `${DURATION.tourGlide}ms`,
  "--tour-trail": `${DURATION.tourTrail}ms`,
  "--tour-iris": `${DURATION.tourIris}ms`,
  "--tour-rise": `${DURATION.tourRise}ms`,
  "--tour-text": `${DURATION.tourText}ms`,
  "--tour-text-out": `${DURATION.tourTextOut}ms`,
  "--tour-text-gap": `${DURATION.tourTextGap}ms`,
  "--tour-exit": `${DURATION.tourExit}ms`,
  "--tour-fade": `${DURATION.fade}ms`,
  "--tour-inset": `${SHEET_INSET}px`,
} as CSSProperties;
/**
 * How long a step's target is looked for before the step is skipped (in the
 * direction of travel): a card never points at nothing. The same grace
 * covers a target that vanishes while its step is up.
 */
const FIND_FOR_MS = 1500;
const FIND_EVERY_MS = 150;
/** A target counts as settled once its box has held still this long… */
const STABLE_MS = 150;
const SETTLE_EVERY_MS = 50;
/** …and the page has stopped loading. A page still busy after this long skips the step rather than light it. */
const BUSY_CAP_MS = 12_000;
/** Waiting longer than this for a step's target, the light leaves the last one. */
const LET_GO_MS = 320;
/** Bringing a target into view: done once scrolling has been quiet this long, or after the most it may take. */
const SCROLL_QUIET_MS = 140;
const SCROLL_MAX_MS = 1200;

/* ---- Targets ---------------------------------------------------------- */

function sameGeo(a: Geo, b: Geo) {
  if (a.vp.w !== b.vp.w || a.vp.h !== b.vp.h || a.safe.top !== b.safe.top || a.safe.bottom !== b.safe.bottom) return false;
  if (!a.box || !b.box) return a.box === b.box;
  return sameBox(a.box, b.box);
}

/** Calls back once a scroll has come to rest: scrollend where there is one, or quiet (Safari), or a cap. */
function afterScroll(instant: boolean, done: () => void) {
  if (instant) {
    requestAnimationFrame(() => done());
    return;
  }
  let over = false;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (over) return;
    over = true;
    clearTimeout(quiet);
    clearTimeout(cap);
    window.removeEventListener("scrollend", finish, true);
    window.removeEventListener("scroll", onScroll, true);
    done();
  };
  const onScroll = () => {
    clearTimeout(quiet);
    quiet = setTimeout(finish, SCROLL_QUIET_MS);
  };
  window.addEventListener("scrollend", finish, true);
  window.addEventListener("scroll", onScroll, true);
  quiet = setTimeout(finish, 220);
  const cap = setTimeout(finish, SCROLL_MAX_MS);
}

/** The screen's safe areas, read off a probe padded with env(). */
function safeOf(probe: HTMLElement | null): Bars {
  if (!probe) return { top: 0, bottom: 0 };
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

/** Where everything is right now. */
function readGeo(target: HTMLElement | null, probe: HTMLElement | null): Geo {
  const vp = viewport();
  return { vp, box: boxOf(target, vp), safe: safeOf(probe) };
}

/** Tall things are read from the top: only their top needs to be in view. */
function isTall(el: HTMLElement, bars: Bars) {
  return el.getBoundingClientRect().height > (window.innerHeight - bars.top - bars.bottom) * 0.56;
}

function inView(el: HTMLElement, bars: Bars): boolean {
  if (pinned(el)) return true;
  const r = el.getBoundingClientRect();
  const top = bars.top + 8;
  const bottom = window.innerHeight - bars.bottom - 8;
  if (isTall(el, bars)) return r.top >= top && r.top <= top + (bottom - top) * 0.35;
  return r.top >= top && r.bottom <= bottom && r.left >= 0 && r.right <= window.innerWidth;
}

/** Bring it into view, clear of the bars: centred, or a tall one's top just under the top bar. */
function reveal(el: HTMLElement, smooth: boolean, bars: Bars) {
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  const { scrollMarginTop, scrollMarginBottom } = el.style;
  el.style.scrollMarginTop = `${bars.top + 16}px`;
  el.style.scrollMarginBottom = `${bars.bottom + 16}px`;
  el.scrollIntoView({ block: isTall(el, bars) ? "start" : "center", inline: "nearest", behavior });
  el.style.scrollMarginTop = scrollMarginTop;
  el.style.scrollMarginBottom = scrollMarginBottom;
}

/* ---- The overlay ------------------------------------------------------ */

type Phase = "pre" | "enter" | "glide" | "track" | "exit";

interface Layer {
  key: number;
  index: number;
  dir: 1 | -1;
  state: "in" | "out";
}

interface Geo {
  vp: Viewport;
  box: Box | null;
  /** The screen's safe areas (a notch, a home bar). */
  safe: Bars;
}

export function TourOverlay({
  tour,
  plan,
  at,
  closing,
  onMove,
  onExited,
  onLanded,
  onMissing,
}: {
  tour: Tour;
  /** The steps that play, as indexes into `tour.steps` (the ones whose targets are there), in order. */
  plan: number[];
  /** Where in `plan` we are. */
  at: number;
  /** Play the exit, then call `onExited`. */
  closing: boolean;
  onMove: (move: TourMove) => void;
  onExited: () => void;
  /** A step was actually shown: its target lit (or it's a centred step). */
  onLanded: (index: number) => void;
  /** A step's target never turned up, vanished, or the page never settled around it: skip it. */
  onMissing: (index: number) => void;
}) {
  const reduced = useReducedMotion();
  const phone = usePhoneLayout();
  /** The step on screen, as an index into the full story (tips and records use these). */
  const index = plan[at] ?? plan[plan.length - 1] ?? 0;
  const step = tour.steps[index];
  const copy = resolveStep(step, phone);
  // Buttons, dots and "Got it" follow the steps that play, not the story's full list.
  const playing: Tour = { ...tour, steps: plan.map((i) => tour.steps[i]) };
  const { primary, secondary, back } = stepButtons(playing, Math.min(at, plan.length - 1));
  const last = at >= plan.length - 1;
  const titleId = useId();
  const lineId = useId();

  // The host's callbacks change with its state; the searches below read the latest.
  const landedRef = useRef(onLanded);
  const missingRef = useRef(onMissing);
  useEffect(() => {
    landedRef.current = onLanded;
    missingRef.current = onMissing;
  }, [onLanded, onMissing]);
  /** The step whose target is lit right now (its vanishing skips it). */
  const litFor = useRef<number | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>(reduced ? "glide" : "pre");
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [geo, setGeo] = useState<Geo>(() => ({ vp: typeof window === "undefined" ? { w: 1280, h: 800 } : viewport(), box: null, safe: { top: 0, bottom: 0 } }));
  /** Counts each landing on a target, so the ring's pulse and the pointer wait for the light to arrive. */
  const [landed, setLanded] = useState(0);
  const [card, setCard] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [settled, setSettled] = useState(false);

  /* -- Words: the outgoing step and the incoming one share the cell for a moment. */
  const [seenIndex, setSeenIndex] = useState(index);
  const [moved, setMoved] = useState(false);
  const [layers, setLayers] = useState<Layer[]>([{ key: 0, index, dir: 1, state: "in" }]);
  const [pose, setPose] = useState<{ index: number; second: boolean }>({ index, second: false });
  if (seenIndex !== index) {
    const dir: 1 | -1 = index > seenIndex ? 1 : -1;
    // The line on screen stays the same element and turns to leave; the new one arrives beside it.
    const current = layers.find((l) => l.state === "in");
    setSeenIndex(index);
    setMoved(true);
    setLayers([...(current ? [{ ...current, dir, state: "out" as const }] : []), { key: (current?.key ?? 0) + 1, index, dir, state: "in" }]);
    setPose({ index, second: false });
    if (phase === "track" || phase === "enter") setPhase("glide");
  }
  useEffect(() => {
    if (!layers.some((l) => l.state === "out")) return;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => l.state === "in")), DURATION.tourTextOut + 120);
    return () => clearTimeout(t);
  }, [layers]);

  // A step with a second pose (the countdown becoming the rings) turns after a beat.
  useEffect(() => {
    if (!step.then) return;
    const t = setTimeout(() => setPose({ index, second: true }), DURATION.tourBeat);
    return () => clearTimeout(t);
  }, [index, step.then]);
  const scene = pose.second && pose.index === index && step.then ? step.then : step.scene;

  /* -- Finding the target: wait for it to render and hold still, bring it into view, then light it.
     A target that never turns up (or a page that never stops loading) skips the step instead. */
  const targetsKey = copy.targets.join("|");
  useEffect(() => {
    const names = targetsKey ? targetsKey.split("|") : [];
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    litFor.current = null;
    const land = (el: HTMLElement | null) => {
      if (!alive) return;
      clearTimeout(timer);
      litFor.current = el ? index : null;
      setTarget(el);
      setGeo(readGeo(el, probeRef.current));
      setLanded((n) => n + 1);
      setPhase((p) => (p === "track" ? "glide" : p));
      landedRef.current(index);
    };
    const miss = () => {
      if (!alive) return;
      clearTimeout(timer);
      missingRef.current(index);
    };
    // While the target is still loading, the light leaves the last one (after a moment, so a target
    // that's simply settling doesn't make the light blink): the new words never sit beside the old
    // spotlight. It glides on once the target turns up.
    let letGo = false;
    let revealed = false;
    let seen: Box | null = null;
    let seenAt = 0;
    const look = () => {
      if (!alive) return;
      const waited = Date.now() - started;
      if (names.length === 0) return land(null);
      if (!letGo && waited > LET_GO_MS) {
        letGo = true;
        setTarget(null);
        setGeo(readGeo(null, probeRef.current));
      }
      const el = findTarget(names);
      if (!el) {
        if (waited < FIND_FOR_MS) timer = setTimeout(look, FIND_EVERY_MS);
        else miss();
        return;
      }
      // Bring it into view once, then light it when the page has come to rest.
      const bars = barInsets(viewport());
      if (!revealed && !inView(el, bars)) {
        revealed = true;
        reveal(el, !reduced, bars);
        afterScroll(reduced, () => {
          if (alive) look();
        });
        return;
      }
      // Settled: its box has held still for a moment, and nothing on screen is still loading.
      // A page that never settles doesn't get a light pointing into the loading: the step is skipped.
      const vp = viewport();
      const box = boxOf(el, vp);
      // Not yet: a sheet still sliding up from below the screen can hold still at its edge for a moment.
      const shown = box !== null && Math.min(box.y + box.h, vp.h) - Math.max(box.y, 0) >= Math.min(box.h, 48);
      const still = shown && seen !== null && sameBox(box, seen);
      if (!still) {
        seen = box;
        seenAt = Date.now();
      }
      if (still && Date.now() - seenAt >= STABLE_MS && !pageBusy()) return land(el);
      if (waited >= BUSY_CAP_MS) return miss();
      timer = setTimeout(look, SETTLE_EVERY_MS);
    };
    timer = setTimeout(look, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [targetsKey, index, reduced]);

  /* -- A lit target that goes away (a panel closing, a list re-rendering) is looked for again; if
     it's still gone after the grace, the step is skipped rather than left pointing at nothing. */
  useEffect(() => {
    if (!target) return;
    const names = targetsKey ? targetsKey.split("|") : [];
    let goneSince = 0;
    const check = setInterval(() => {
      if (litFor.current !== index || stillThere(target)) {
        goneSince = 0;
        return;
      }
      const again = findTarget(names);
      if (again) {
        goneSince = 0;
        setTarget(again);
        return;
      }
      goneSince ||= Date.now();
      if (Date.now() - goneSince >= FIND_FOR_MS) {
        clearInterval(check);
        litFor.current = null;
        missingRef.current(index);
      }
    }, FIND_EVERY_MS);
    return () => clearInterval(check);
  }, [target, targetsKey, index]);

  /* -- Following it: a scroll cuts the light to the target as it moves (no glide lagging behind a
     finger); a frame loop catches everything else that moves it — a resize, a layout shift as
     something above it loads, a sticky bar, a transformed or animating container — and hands the
     new box over only when it has actually changed. */
  useEffect(() => {
    let frame = 0;
    let last: Geo | null = null;
    const measure = () => {
      frame = requestAnimationFrame(measure);
      const next = readGeo(target, probeRef.current);
      if (last && sameGeo(last, next)) return;
      last = next;
      setGeo(next);
    };
    frame = requestAnimationFrame(measure);
    // Only scrolling that moves the target counts: the page, or a box it sits in —
    // not a carousel sliding somewhere else on the page.
    const onScroll = (e: Event) => {
      const at = e.target;
      if (at === document || at === document.documentElement || (target && at instanceof Node && at.contains(target))) {
        setPhase((p) => (p === "glide" ? "track" : p));
      }
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [target]);

  // The card's own size, untransformed.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const read = () => setCard((c) => (c.w === el.offsetWidth && c.h === el.offsetHeight ? c : { w: el.offsetWidth, h: el.offsetHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);

  // The card rides a transition only once it has been placed for real.
  useEffect(() => {
    if (settled || card.w === 0) return;
    const t = setTimeout(() => setSettled(true), 60);
    return () => clearTimeout(t);
  }, [card.w, settled]);

  /* -- Entering and leaving. Timers, not frames: a background tab still gets there. */
  useEffect(() => {
    if (phase !== "pre" || card.w === 0) return;
    const t = setTimeout(() => setPhase("enter"), 40);
    return () => clearTimeout(t);
  }, [phase, card.w]);
  useEffect(() => {
    if (phase !== "enter") return;
    const t = setTimeout(() => setPhase((p) => (p === "enter" ? "glide" : p)), DURATION.tourIris);
    return () => clearTimeout(t);
  }, [phase]);
  const [seenClosing, setSeenClosing] = useState(closing);
  if (seenClosing !== closing) {
    setSeenClosing(closing);
    if (closing) setPhase("exit");
  }
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onExited, reduced ? DURATION.fade : DURATION.tourExit);
    return () => clearTimeout(t);
  }, [closing, onExited, reduced]);

  /* -- Keyboard and focus: held in the card while it's up, handed back after. */
  const escMove: TourMove = secondary?.move === "later" ? "later" : "finish";
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current;
      if (!card) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onMove(escMove);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (!last) onMove("next");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (at > 0) onMove("back");
      } else if (e.key === "Tab") {
        const focusable = [...card.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const end = focusable[focusable.length - 1];
        const focused = document.activeElement;
        if (!card.contains(focused)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && focused === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && focused === end) {
          e.preventDefault();
          first.focus();
        }
      }
      // Nothing behind the dialog hears the keyboard while it's up (the studio's hold-V, ⌘K).
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [escMove, at, last, onMove]);

  // Focus the way forward on arrival, and whenever a step leaves focus nowhere.
  useEffect(() => {
    if (!cardRef.current?.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true });
  }, [index]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const hold = (e: FocusEvent) => {
      const card = cardRef.current;
      if (card && e.target instanceof Node && !card.contains(e.target)) primaryRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", hold);
    return () => {
      document.removeEventListener("focusin", hold);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  /* -- Arriving: the ring's pulse and the pointer wait for the light (and the card) to get there. */
  const arriveKey = `${index}:${landed}`;
  const [arrivedFor, setArrivedFor] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setArrivedFor(arriveKey), reduced ? 0 : Math.max(DURATION.tourIris, DURATION.tourGlide + DURATION.tourTrail));
    return () => clearTimeout(t);
  }, [arriveKey, reduced]);
  const arrived = arrivedFor === arriveKey && phase !== "pre" && phase !== "exit";

  /* -- Geometry for this render. */
  const [kept, setKept] = useState<Dock | null>(null);
  const { vp } = geo;
  let hole: Hole | null = geo.box ? holeFor(geo.box, vp) : null;
  const size = { w: card.w || (phone ? vp.w - SHEET_INSET * 2 : CARD_W), h: card.h || 220 };

  let cardX = 0;
  let cardY = 0;
  let arrow: { side: Side; along: number } | null = null;
  let pointer: { x1: number; y1: number; x2: number; y2: number } | null = null;
  let dock: Dock | null = null;
  let centre: { x: number; y: number };
  if (phone) {
    // Docked to the end the target isn't at; while the page only scrolls, it stays where it is.
    const edges = { top: geo.safe.top + SHEET_INSET, bottom: geo.safe.bottom + SHEET_INSET };
    const p = placeDock(hole, { h: size.h }, vp, edges, phase === "track" ? kept : null);
    hole = p.hole;
    dock = p.dock;
    cardY = p.y;
    cardX = Math.max(SHEET_INSET, (vp.w - size.w) / 2);
    if (p.pointer) {
      // The line leaves the card from its nearest point to the target.
      const x1 = Math.min(Math.max(p.pointer.x, cardX + 20), cardX + size.w - 20);
      pointer = { x1, y1: p.pointer.from, x2: p.pointer.x, y2: p.pointer.to };
    }
    centre = { x: vp.w / 2, y: p.y + size.h / 2 };
  } else {
    const p = placeCard(hole, size, vp);
    hole = p.hole;
    cardX = p.x;
    cardY = p.y;
    if (p.side) arrow = { side: p.side, along: p.along };
    centre = { x: p.x + size.w / 2, y: p.y + size.h / 2 };
  }
  // Remember the end the card is at, for the next scroll.
  if (phone && kept !== dock) setKept(dock);

  const shape: Hole =
    phase === "pre" || (phase === "exit" && !reduced) ? openHole(vp) : hole ?? closedHole(centre);
  const lit = Boolean(hole) && phase !== "pre" && phase !== "exit";
  // Tapping the lit thing moves on, where moving on is what the step's button does.
  const tapNext = lit && hole !== null && primary.move === "next";

  /* -- The words for a step, on this screen. */
  const words = (i: number) => resolveStep(tour.steps[i], phone);
  const announce = `Step ${at + 1} of ${plan.length}. ${copy.title}. ${copy.line}`;

  const words_ = (
    <div className={styles.stack}>
      {/* Every step's words, unseen: the cell takes the tallest, so the card never jumps. */}
      {plan.map((i) => {
        const w = words(i);
        return (
          <div key={`size-${i}`} aria-hidden className={styles.sizer}>
            <Title compact={phone}>{w.title}</Title>
            <Line compact={phone}>{w.line}</Line>
          </div>
        );
      })}
      {layers.map((l) => {
        const w = words(l.index);
        const incoming = l.state === "in";
        return (
          <div
            key={l.key}
            aria-hidden={incoming ? undefined : true}
            className={incoming ? styles.in : styles.out}
            style={{ "--dir": l.dir, "--lead": moved ? `${DURATION.tourTextLead}ms` : `${Math.round(DURATION.tourIris * 0.42)}ms` } as CSSProperties}
          >
            <div className={styles.mask}>
              <Title id={incoming ? titleId : undefined} className={styles.rise} i={0} compact={phone}>
                {w.title}
              </Title>
            </div>
            <div className={styles.mask}>
              <Line id={incoming ? lineId : undefined} className={styles.rise} i={1} compact={phone}>
                {w.line}
              </Line>
            </div>
          </div>
        );
      })}
    </div>
  );

  const live = (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {moved ? announce : ""}
    </p>
  );

  // Phones: Back on the left (or the first step's "Later"), dots in the middle, the way on at the right;
  // Skip — or the last step's own way out — in the corner.
  const quiet = secondary && secondary.move !== "back" ? secondary : null;
  const phoneBack = at > 0;
  const corner: { label: string; move: TourMove } | null = phoneBack && quiet ? quiet : !last ? { label: "Skip", move: "finish" } : null;
  const left = phoneBack ? null : quiet;

  const body = phone ? (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={lineId}
      className={cn(styles.card, "relative w-full rounded-[20px] bg-popover p-3 text-popover-foreground shadow-popover")}
    >
      {/* Above the words: their animated layers paint over it otherwise, and a tap on Skip lands on the title. */}
      {corner && (
        <button
          type="button"
          onClick={() => onMove(corner.move)}
          className="press absolute top-1.5 right-1.5 z-10 flex h-8 items-center rounded-full px-2.5 text-[12.5px] font-semibold text-subtle transition-colors outline-none hover:bg-tint/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ember"
        >
          {corner.label}
        </button>
      )}

      <div className="flex items-start gap-3">
        {/* The drawing as a thumbnail: a 5:4 box to match its viewBox, so it's scaled, never cropped. */}
        <div aria-hidden className="w-[104px] shrink-0 rounded-[12px] bg-tint/[0.04] p-1">
          <div className="aspect-[5/4] w-full">
            <TourArt scene={scene} className="block size-full" />
          </div>
        </div>
        <div className="min-w-0 flex-1 pt-0.5">{words_}</div>
      </div>

      <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <div className="flex min-w-0 justify-start">
          {phoneBack ? (
            <Pill variant="glass" size="md" iconOnly aria-label="Back" icon={<CaretLeft size={16} weight="bold" />} onClick={() => onMove("back")} />
          ) : left ? (
            <Pill variant="ghost" size="md" onClick={() => onMove(left.move)} className="-ml-1 px-3 text-[13.5px]">
              {left.label}
            </Pill>
          ) : null}
        </div>
        <Dots count={plan.length} at={at} />
        <div className="flex min-w-0 justify-end">
          <Pill
            ref={primaryRef}
            variant={primary.move === "practice" ? "ember" : "primary"}
            size="md"
            onClick={() => onMove(primary.move)}
            className="px-3.5 text-[13.5px]"
          >
            {primary.label}
          </Pill>
        </div>
      </div>
      {live}
    </div>
  ) : (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={lineId}
      className={cn(styles.card, "rounded-overlay bg-popover p-2 text-popover-foreground shadow-popover")}
      style={{ width: CARD_W }}
    >
      {/* Where you are, and the way out. */}
      <div className="flex h-8 items-center justify-between pr-1 pl-3">
        <Dots count={plan.length} at={at} />
        {!last && (
          <button
            type="button"
            onClick={() => onMove("finish")}
            className="press flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-semibold text-subtle transition-colors outline-none hover:bg-tint/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ember"
          >
            Skip
          </button>
        )}
      </div>

      {/* The one drawn object, morphing from step to step: a 5:4 box to match its
          viewBox, generous, and never clipped — parts that overshoot or grow mid-morph
          spill into the padding around it, not off a cropped edge. One drawing for the
          whole tour: only its scene changes, so it morphs rather than replays. */}
      <div aria-hidden className="mx-auto w-[296px] px-3 py-3">
        <div className="aspect-[5/4] w-full">
          <TourArt scene={scene} className="w-full" />
        </div>
      </div>

      <div className="px-3 pt-1 pb-2">
        {words_}

        <div className="mt-5 flex items-center justify-end gap-2">
          {back && (
            <Pill variant="glass" size="md" iconOnly aria-label="Back" icon={<CaretLeft size={16} weight="bold" />} onClick={() => onMove("back")} className="mr-auto" />
          )}
          {secondary && (
            <Pill variant="ghost" size="md" onClick={() => onMove(secondary.move)} className="px-3.5">
              {secondary.label}
            </Pill>
          )}
          <Pill
            ref={primaryRef}
            variant={primary.move === "practice" ? "ember" : "primary"}
            size="md"
            onClick={() => onMove(primary.move)}
          >
            {primary.label}
          </Pill>
        </div>
      </div>
      {live}
    </div>
  );

  // The ring's outer edge, where the pulse starts.
  const RING = 2;
  const ringBox = hole
    ? { x: hole.x - RING, y: hole.y - RING, w: hole.w + RING * 2, h: hole.h + RING * 2, r: hole.r + RING }
    : null;

  return createPortal(
    <div
      data-tour-root
      data-phase={phase}
      data-lit={lit || undefined}
      data-arrived={(lit && arrived) || undefined}
      data-target={(lit && target?.dataset.tour) || undefined}
      className={styles.root}
      style={TOUR_VARS}
    >
      <div ref={probeRef} aria-hidden className={styles.probe} />
      <div aria-hidden className={styles.scrim} style={{ clipPath: scrimClip(shape) }} />
      <div aria-hidden className={styles.ring} style={{ clipPath: ringClip(shape, RING) }} />
      {ringBox && (
        <div
          aria-hidden
          className={styles.pulse}
          style={{
            transform: `translate3d(${ringBox.x}px, ${ringBox.y}px, 0)`,
            width: ringBox.w,
            height: ringBox.h,
            borderRadius: ringBox.r,
          }}
        />
      )}
      {/* The lit thing, tappable: it's the same as Next. The dim swallows taps and does nothing. */}
      {tapNext && hole && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className={styles.hit}
          onClick={() => onMove("next")}
          style={{ transform: `translate3d(${hole.x}px, ${hole.y}px, 0)`, width: hole.w, height: hole.h, borderRadius: hole.r }}
        />
      )}
      {phone && <Pointer line={lit ? pointer : null} />}

      {phone ? (
        <div
          data-settled={settled || undefined}
          data-dock={dock ?? "centre"}
          className={styles.dock}
          style={{ transform: `translate3d(${Math.round(cardX)}px, ${Math.round(cardY)}px, 0)`, width: Math.min(vp.w - SHEET_INSET * 2, PHONE_CARD_MAX) }}
        >
          {body}
        </div>
      ) : (
        <div
          data-settled={settled || undefined}
          className={styles.positioner}
          style={{ transform: `translate3d(${Math.round(cardX)}px, ${Math.round(cardY)}px, 0)`, width: CARD_W }}
        >
          {body}
          <Arrow arrow={arrow} />
        </div>
      )}
    </div>,
    document.body,
  );
}

/* ---- Pieces ----------------------------------------------------------- */

function Title({ children, id, className, i, compact }: { children: string; id?: string; className?: string; i?: number; compact?: boolean }) {
  return (
    <h2
      id={id}
      className={cn(
        "font-wide font-bold tracking-[-0.02em] text-balance text-foreground",
        // On a phone the corner holds Skip: the title keeps clear of it.
        compact ? "pr-10 text-[16px] leading-[1.2]" : "text-[19px] leading-[1.18]",
        className,
      )}
      style={i === undefined ? undefined : ({ "--i": i } as CSSProperties)}
    >
      {children}
    </h2>
  );
}

function Line({ children, id, className, i, compact }: { children: string; id?: string; className?: string; i?: number; compact?: boolean }) {
  return (
    <p
      id={id}
      className={cn("text-pretty text-subtle", compact ? "mt-1 text-[13.5px] leading-[1.42]" : "mt-1.5 text-[14.5px] leading-[1.5]", className)}
      style={i === undefined ? undefined : ({ "--i": i } as CSSProperties)}
    >
      {children}
    </p>
  );
}

/** Where you are: a dot per step, and an Ember pip gliding between them. */
function Dots({ count, at }: { count: number; at: number }) {
  if (count < 2) return null;
  return (
    <div className={styles.dots} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn(styles.dot, i < at ? "bg-tint/45" : "bg-tint/[0.16]")} />
      ))}
      <span className={cn(styles.pip, "bg-ember")} style={{ transform: `translate3d(${at * 13}px, 0, 0)` }} />
    </div>
  );
}

/**
 * The pointer: a notch in the card's colour on the edge facing the target,
 * sliding along that edge as the card travels. A change of edge fades one
 * notch out and the next in, rather than swinging round the corner.
 */
function Arrow({ arrow }: { arrow: { side: Side; along: number } | null }) {
  const sides: Side[] = ["top", "right", "bottom", "left"];
  return (
    <>
      {sides.map((side) => {
        const on = arrow?.side === side;
        const along = on ? arrow!.along : 0;
        const turn = { top: 0, right: 90, bottom: 180, left: -90 }[side];
        const shift = side === "top" || side === "bottom" ? `translate3d(${along - 10}px, 0, 0)` : `translate3d(0, ${along - 5}px, 0)`;
        return (
          <svg
            key={side}
            aria-hidden
            data-side={side}
            data-on={on || undefined}
            viewBox="0 0 20 10"
            className={styles.arrow}
            style={{ transform: `${shift} rotate(${turn}deg)` }}
          >
            <path d="M0 10 L8.1 1.6 Q10 -0.4 11.9 1.6 L20 10 Z" fill="var(--popover)" />
            <path d="M0.4 9.8 L8.1 1.6 Q10 -0.4 11.9 1.6 L19.6 9.8" fill="none" stroke="var(--hairline-color)" strokeWidth="1" />
          </svg>
        );
      })}
    </>
  );
}

/**
 * The phone's pointer: an Ember line from the card to the lit thing, with a
 * dot where it leaves the card and a head where it arrives. It draws itself
 * once the light has landed, and is simply not there while things glide.
 */
function Pointer({ line }: { line: { x1: number; y1: number; x2: number; y2: number } | null }) {
  if (!line) return <svg aria-hidden className={styles.pointer} />;
  const { x1, y1, x2, y2 } = line;
  const turn = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <svg aria-hidden className={styles.pointer}>
      <circle cx={x1} cy={y1} r={3} className={styles.pointerDot} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} pathLength={1} className={styles.pointerLine} />
      <path d="M-7 -6 L0 0 L-7 6" transform={`translate(${x2} ${y2}) rotate(${turn})`} className={styles.pointerHead} />
    </svg>
  );
}
