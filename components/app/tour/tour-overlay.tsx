"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { CaretLeft } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { TourArt } from "@/components/app/tour/tour-art";
import { DURATION, EASE } from "@/lib/motion";
import { closedHole, holeFor, openHole, placeCard, placeSheet, ringClip, scrimClip, type Box, type Hole, type Side, type Viewport } from "@/lib/tour/geometry";
import { resolveStep, stepButtons, type Tour, type TourMove } from "@/lib/tour/story";
import { cn } from "@/lib/utils";
import styles from "./tour.module.css";

/**
 * One step of a tour, drawn: the dim with its rounded cut-out around the
 * thing being named, and the card — a floating card with a pointer beside
 * it on a desktop, a sheet at the foot of a phone — carrying the morphing
 * art, the words, progress and the buttons.
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

/** The phone sheet's distance from the screen's edges. */
const SHEET_INSET = 8;
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
/** How long a missing target is looked for before the step plays centred. */
const FIND_FOR_MS = 1800;
const FIND_EVERY_MS = 150;

/* ---- Small stores --------------------------------------------------- */

function mediaStore(query: string) {
  return {
    subscribe(cb: () => void) {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    get: () => window.matchMedia(query).matches,
  };
}
const reducedStore = mediaStore("(prefers-reduced-motion: reduce)");
const phoneStore = mediaStore("(max-width: 767px)");

export function useReducedMotion() {
  return useSyncExternalStore(reducedStore.subscribe, reducedStore.get, () => false);
}
export function usePhoneLayout() {
  return useSyncExternalStore(phoneStore.subscribe, phoneStore.get, () => false);
}

/* ---- Targets ---------------------------------------------------------- */

/** The first element named `data-tour=<name>` that's actually on screen to be seen. */
export function findTarget(names: string[]): HTMLElement | null {
  for (const name of names) {
    const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
    for (const el of all) {
      if (el.closest("[data-tour-root]")) continue;
      if (el.closest("[aria-hidden='true'], [inert]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      return el;
    }
  }
  return null;
}

const viewport = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight });

function boxOf(el: HTMLElement | null, vp: Viewport): Box | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  // Scrolled right out of view: the step plays centred until it's back.
  if (r.bottom < 0 || r.top > vp.h || r.right < 0 || r.left > vp.w) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Where everything is right now. offsetTop ignores the sheet's lift: it's where the sheet rests. */
function readGeo(target: HTMLElement | null, sheet: HTMLElement | null): Geo {
  const vp = viewport();
  return { vp, box: boxOf(target, vp), sheetBottom: sheet ? sheet.offsetTop + sheet.offsetHeight : null };
}

/** Tall things are read from the top: only their top needs to be in view. */
function isTall(el: HTMLElement) {
  return el.getBoundingClientRect().height > window.innerHeight * 0.56;
}

function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  if (isTall(el)) return r.top >= 56 && r.top <= vh * 0.35;
  return r.top >= 72 && r.bottom <= vh - 24 && r.left >= 0 && r.right <= window.innerWidth;
}

/** Bring it into view: centred, or a tall one's top just under the bar. */
function reveal(el: HTMLElement, smooth: boolean) {
  const behavior: ScrollBehavior = smooth ? "smooth" : "auto";
  if (!isTall(el)) {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior });
    return;
  }
  const before = el.style.scrollMarginTop;
  el.style.scrollMarginTop = "96px";
  el.scrollIntoView({ block: "start", inline: "nearest", behavior });
  el.style.scrollMarginTop = before;
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
  /** The sheet's resting bottom edge (phones), untransformed. */
  sheetBottom: number | null;
}

export function TourOverlay({
  tour,
  index,
  closing,
  onMove,
  onExited,
}: {
  tour: Tour;
  index: number;
  /** Play the exit, then call `onExited`. */
  closing: boolean;
  onMove: (move: TourMove) => void;
  onExited: () => void;
}) {
  const reduced = useReducedMotion();
  const phone = usePhoneLayout();
  const step = tour.steps[index];
  const copy = resolveStep(step, phone);
  const { primary, secondary, back } = stepButtons(tour, index);
  const last = index === tour.steps.length - 1;
  const titleId = useId();
  const lineId = useId();

  const cardRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const [phase, setPhase] = useState<Phase>(reduced ? "glide" : "pre");
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [geo, setGeo] = useState<Geo>(() => ({ vp: typeof window === "undefined" ? { w: 1280, h: 800 } : viewport(), box: null, sheetBottom: null }));
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

  /* -- Finding the target: wait a little for it to render, bring it into view, then light it. */
  const targetsKey = copy.targets.join("|");
  useEffect(() => {
    const names = targetsKey ? targetsKey.split("|") : [];
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    const land = (el: HTMLElement | null) => {
      if (!alive) return;
      setTarget(el);
      setGeo(readGeo(el, sheetRef.current));
      setPhase((p) => (p === "track" ? "glide" : p));
    };
    const look = () => {
      if (!alive) return;
      const el = names.length ? findTarget(names) : null;
      if (!el && names.length && Date.now() - started < FIND_FOR_MS) {
        timer = setTimeout(look, FIND_EVERY_MS);
        return;
      }
      if (el && !inView(el)) {
        reveal(el, !reduced);
        // Light it once the page has come to rest (scrollend where there is one).
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener("scrollend", finish, true);
          land(el);
        };
        window.addEventListener("scrollend", finish, true);
        timer = setTimeout(finish, reduced ? 0 : 520);
        return;
      }
      land(el);
    };
    timer = setTimeout(look, 0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [targetsKey, index, reduced]);

  /* -- Measuring: read-only, batched to a frame, on every scroll, resize and change of size. */
  useEffect(() => {
    let frame = 0;
    const track = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPhase((p) => (p === "glide" ? "track" : p));
        setGeo(readGeo(target, sheetRef.current));
      });
    };
    // Only scrolling that moves the target counts: the page, or a box it sits in —
    // not a carousel sliding somewhere else on the page.
    const onScroll = (e: Event) => {
      const at = e.target;
      if (at === document || at === document.documentElement || (target && at instanceof Node && at.contains(target))) track();
    };
    // A ResizeObserver reports once on observing; that's not a change.
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) first = false;
      else track();
    });
    window.addEventListener("resize", track);
    window.addEventListener("scroll", onScroll, true);
    if (target) ro.observe(target);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", track);
      window.removeEventListener("scroll", onScroll, true);
      ro.disconnect();
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
        if (index > 0) onMove("back");
      } else if (e.key === "Tab") {
        const focusable = [...card.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
        if (focusable.length === 0) return;
        const first = focusable[0];
        const end = focusable[focusable.length - 1];
        const at = document.activeElement;
        if (!card.contains(at)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && at === first) {
          e.preventDefault();
          end.focus();
        } else if (!e.shiftKey && at === end) {
          e.preventDefault();
          first.focus();
        }
      }
      // Nothing behind the dialog hears the keyboard while it's up (the studio's hold-V, ⌘K).
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [escMove, index, last, onMove]);

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

  /* -- Geometry for this render. */
  const { vp } = geo;
  let hole: Hole | null = geo.box ? holeFor(geo.box, vp) : null;
  const size = { w: card.w || (phone ? vp.w - SHEET_INSET * 2 : CARD_W), h: card.h || 320 };

  let cardX = 0;
  let cardY = 0;
  let arrow: { side: Side; along: number } | null = null;
  let lift = 0;
  let centre: { x: number; y: number };
  if (phone) {
    const bottom = geo.sheetBottom ?? vp.h - SHEET_INSET;
    const sp = placeSheet(hole, { h: size.h }, vp, SHEET_INSET, vp.h - SHEET_INSET - bottom);
    lift = sp.lift;
    hole = sp.hole;
    if (sp.along !== null) arrow = { side: "bottom", along: sp.along };
    centre = { x: vp.w / 2, y: bottom - size.h / 2 };
  } else {
    const p = placeCard(hole, size, vp);
    hole = p.hole;
    cardX = p.x;
    cardY = p.y;
    if (p.side) arrow = { side: p.side, along: p.along };
    centre = { x: p.x + size.w / 2, y: p.y + size.h / 2 };
  }

  const shape: Hole =
    phase === "pre" || (phase === "exit" && !reduced) ? openHole(vp) : hole ?? closedHole(centre);
  const lit = Boolean(hole) && phase !== "pre" && phase !== "exit";

  /* -- The words for a step, on this screen. */
  const words = (i: number) => resolveStep(tour.steps[i], phone);
  const announce = `Step ${index + 1} of ${tour.steps.length}. ${copy.title}. ${copy.line}`;

  const body = (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={lineId}
      className={cn(
        styles.card,
        "bg-popover text-popover-foreground shadow-popover",
        phone ? "w-full rounded-[24px] p-2" : "rounded-overlay p-2",
      )}
      style={phone ? undefined : { width: CARD_W }}
    >
      {/* Where you are, and the way out. */}
      <div className="flex h-8 items-center justify-between pr-1 pl-3">
        <Dots count={tour.steps.length} at={index} />
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
      <div aria-hidden className={cn("mx-auto px-3 py-3", phone ? "w-[min(344px,100%,calc(40vh+24px))]" : "w-[296px]")}>
        <div className="aspect-[5/4] w-full">
          <TourArt scene={scene} className="w-full" />
        </div>
      </div>

      <div className="px-3 pt-1 pb-2">
        <div className={styles.stack}>
          {/* Every step's words, unseen: the cell takes the tallest, so the card never jumps. */}
          {tour.steps.map((_, i) => {
            const w = words(i);
            return (
              <div key={`size-${i}`} aria-hidden className={styles.sizer}>
                <Title>{w.title}</Title>
                <Line>{w.line}</Line>
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
                  <Title id={incoming ? titleId : undefined} className={styles.rise} i={0}>
                    {w.title}
                  </Title>
                </div>
                <div className={styles.mask}>
                  <Line id={incoming ? lineId : undefined} className={styles.rise} i={1}>
                    {w.line}
                  </Line>
                </div>
              </div>
            );
          })}
        </div>

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

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {moved ? announce : ""}
      </p>
    </div>
  );

  return createPortal(
    <div
      data-tour-root
      data-phase={phase}
      data-lit={lit || undefined}
      className={styles.root}
      style={TOUR_VARS}
    >
      <div aria-hidden className={styles.scrim} style={{ clipPath: scrimClip(shape) }} />
      <div aria-hidden className={styles.ring} style={{ clipPath: ringClip(shape) }} />

      {phone ? (
        <div
          ref={sheetRef}
          data-settled={settled || undefined}
          className={styles.sheet}
          style={{ transform: `translate3d(0, ${-lift}px, 0)` }}
        >
          {body}
          <Arrow arrow={arrow} />
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

function Title({ children, id, className, i }: { children: string; id?: string; className?: string; i?: number }) {
  return (
    <h2
      id={id}
      className={cn("font-wide text-[19px] leading-[1.18] font-bold tracking-[-0.02em] text-balance text-foreground", className)}
      style={i === undefined ? undefined : ({ "--i": i } as CSSProperties)}
    >
      {children}
    </h2>
  );
}

function Line({ children, id, className, i }: { children: string; id?: string; className?: string; i?: number }) {
  return (
    <p
      id={id}
      className={cn("mt-1.5 text-[14.5px] leading-[1.5] text-pretty text-subtle", className)}
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
