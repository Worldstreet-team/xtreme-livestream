"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A bottom sheet you can drag by its thumb.
 *
 * It resizes rather than slides: the sheet is always anchored to the foot
 * of the screen and its *height* is what the drag changes, so a pinned
 * footer — Go live, most of the time — never rides off the bottom edge
 * while you are adjusting it.
 *
 * Releasing runs a spring rather than a transition. The owner asked for a
 * loose snap, and a cubic-bezier cannot give one: an easing curve always
 * takes the same time whether you flicked it or nudged it, and it always
 * arrives dead. A spring carries the velocity of your finger into the
 * settle and overshoots a little before resting, which is what "loose"
 * feels like. Under `prefers-reduced-motion` it just lands.
 *
 * Dragging is allowed from the thumb and the header at any time, and from
 * the body only when it is scrolled to the top and you pull down — so a
 * long form still scrolls normally inside a sheet that can also move.
 *
 * A press only becomes a drag once the finger has travelled (a few pixels,
 * mostly up or down). Until then nothing is captured, so a tap lands on
 * whatever was tapped — a tab, a chip, the composer — and only a tap on the
 * thumb itself folds or opens the sheet. Capturing on press used to steal
 * every click in the header and turn it into a fold (owner, 2026-09-24:
 * "tapping on almost anything closes that drawer").
 */

/** Springy, slightly underdamped: it passes the mark and comes back. */
const STIFFNESS = 150;
const DAMPING = 19;
/** Where a flick would land, in seconds of travel. */
const PROJECTION = 0.12;
/** Past this far below the smallest detent, a dismissible sheet closes. */
const DISMISS_SLOP = 56;
/** How far a finger travels before a press is a drag rather than a tap. */
const DRAG_SLOP = 6;

function springTo(
  from: number,
  to: number,
  velocity: number,
  onUpdate: (v: number) => void,
  onRest?: () => void,
) {
  let x = from;
  let v = velocity;
  let last = performance.now();
  let raf = 0;
  const step = (now: number) => {
    // Clamp dt so a backgrounded tab doesn't integrate one huge step.
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    v += (-STIFFNESS * (x - to) - DAMPING * v) * dt;
    x += v * dt;
    if (Math.abs(x - to) < 0.5 && Math.abs(v) < 8) {
      onUpdate(to);
      onRest?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** A place the sheet can rest: the thumb alone, hugging its content, or a detent (its index). */
export type SheetStop = "collapsed" | "fit" | number;

export function DragSheet({
  detents,
  defaultDetent = 0,
  onDismiss,
  header,
  footer,
  children,
  className,
  label = "Sheet",
  collapsible = false,
  fit = false,
  snap = null,
  heightVar,
  onSettle,
}: {
  /** Heights as a fraction of the stage, smallest first (e.g. [0.3, 0.72]). */
  detents: number[];
  /** Where it opens: a detent's index, or "fit" (needs `fit`). */
  defaultDetent?: number | "fit";
  /**
   * Adds a stop that hugs the content: the thumb, the header, the footer
   * and the body's first child at its own height. "measure" keeps it
   * measured as that child changes; "keep" holds the last measure while the
   * child is stretched to fill the sheet (the studio's room: compact, then
   * the full chat).
   */
  fit?: "measure" | "keep" | false;
  /** Move the sheet from outside: each new key springs it to that stop. */
  snap?: { to: SheetStop; key: number } | null;
  /** A custom property on the sheet's parent that follows its height in px, for things that ride above it. */
  heightVar?: string;
  /** The sheet came to rest after a drag, a tap on the thumb or a snap: where. */
  onSettle?: (stop: SheetStop) => void;
  /** Given, the sheet can be pulled shut; otherwise the smallest detent is the floor. */
  onDismiss?: () => void;
  /**
   * Adds a lowest stop that is nothing but the thumb: the sheet folds away
   * to a sliver at the foot of the screen and a tap on the thumb brings it
   * back. The picture gets the whole screen, the way back stays in view.
   */
  collapsible?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [height, setHeight] = useState(0);
  const stopSpring = useRef<(() => void) | null>(null);
  /** Until a hand has moved it, the sheet follows the stage's own size. */
  const touched = useRef(false);
  const thumbRef = useRef<HTMLDivElement>(null);
  /** The collapsed stop: the thumb strip plus the safe-area it sits on. */
  const [thumbH, setThumbH] = useState(0);
  /** Live drag bookkeeping, off React so a move never waits for a render. */
  const drag = useRef<{
    id: number;
    startX: number;
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    v: number;
    fromBody: boolean;
    /** Pressed on the thumb strip — the one place a tap folds or opens. */
    fromThumb: boolean;
    /** Became a drag: past the slop, vertical, and the pointer is ours now. */
    active: boolean;
    el: HTMLElement;
  } | null>(null);

  const headRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  /** The fit stop in px; 0 until measured. */
  const [fitH, setFitH] = useState(0);
  /** Where the sheet last came to rest, so a fit that changes size can be followed. */
  const restRef = useRef<SheetStop | null>(defaultDetent);

  /** Every stop, smallest first, with what it is. */
  const stopList: { stop: SheetStop; h: number }[] = [
    ...(collapsible && thumbH > 0 ? [{ stop: "collapsed" as const, h: thumbH }] : []),
    ...(fit && fitH > 0 ? [{ stop: "fit" as const, h: fitH }] : []),
    ...detents.map((d, i) => ({ stop: i, h: Math.round(d * stage) })).filter((s) => s.h > 0),
  ].sort((a, b) => a.h - b.h);
  const stops = stopList.map((s) => s.h);
  const stopAt = (h: number): SheetStop | null => stopList.find((s) => Math.abs(s.h - h) < 1)?.stop ?? null;
  const heightOf = (stop: SheetStop) => stopList.find((s) => s.stop === stop)?.h ?? 0;
  const opening =
    defaultDetent === "fit" && fit && fitH > 0
      ? fitH
      : Math.round((detents[typeof defaultDetent === "number" ? defaultDetent : 0] ?? detents[0] ?? 0.5) * stage);
  const min = stops[0] ?? 0;
  const max = stops[stops.length - 1] ?? 0;

  // The stage is whatever the sheet is anchored inside.
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      setStage(parent.clientHeight);
      const t = thumbRef.current;
      const root = ref.current;
      if (t && root) {
        const inset = parseFloat(getComputedStyle(root).paddingBottom) || 0;
        setThumbH(Math.round(t.offsetHeight + inset));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);

  // Open at the chosen detent. The first measurement can land before the
  // stage has its real height, so an untouched sheet keeps following it.
  useEffect(() => {
    if (stage <= 0) return;
    setHeight((h) => (touched.current ? Math.min(h, Math.round(stage * 0.95)) : opening));
  }, [stage, opening]);

  /** thumb + header + footer + the body's first child, as laid out now. */
  const measureFit = useCallback(() => {
    const root = ref.current;
    const child = bodyRef.current?.firstElementChild as HTMLElement | null | undefined;
    if (!root || !child) return 0;
    const inset = parseFloat(getComputedStyle(root).paddingBottom) || 0;
    return Math.round((headRef.current?.offsetHeight ?? 0) + child.offsetHeight + (footRef.current?.offsetHeight ?? 0) + inset);
  }, []);

  // The fit stop follows its content while it's measured (a notice appears,
  // the reactions open), and a sheet resting there follows with it.
  useEffect(() => {
    if (fit !== "measure") return;
    const body = bodyRef.current;
    if (!body) return;
    const update = () => {
      const h = measureFit();
      if (h > 0) setFitH(h);
    };
    update();
    const ro = new ResizeObserver(update);
    const watch = () => {
      ro.disconnect();
      if (headRef.current) ro.observe(headRef.current);
      if (footRef.current) ro.observe(footRef.current);
      if (body.firstElementChild) ro.observe(body.firstElementChild);
    };
    watch();
    const mo = new MutationObserver(() => {
      watch();
      update();
    });
    mo.observe(body, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [fit, measureFit]);

  useEffect(() => {
    if (fitH > 0 && touched.current && restRef.current === "fit" && !drag.current) {
      stopSpring.current?.();
      setHeight(fitH);
    }
  }, [fitH]);

  // Things that ride above the sheet read its height off the parent.
  useLayoutEffect(() => {
    if (!heightVar) return;
    const parent = ref.current?.parentElement;
    parent?.style.setProperty(heightVar, `${Math.round(height)}px`);
  }, [heightVar, height]);
  useEffect(() => {
    if (!heightVar) return;
    const parent = ref.current?.parentElement;
    return () => {
      parent?.style.removeProperty(heightVar);
    };
  }, [heightVar]);

  const onSettleRef = useRef(onSettle);
  useEffect(() => {
    onSettleRef.current = onSettle;
  }, [onSettle]);

  const settle = useCallback(
    (to: number, velocity: number, after?: () => void, stop: SheetStop | null = null) => {
      stopSpring.current?.();
      restRef.current = stop;
      const rest = () => {
        after?.();
        if (stop !== null) onSettleRef.current?.(stop);
      };
      // No frames run in a hidden tab, so a spring there would freeze
      // mid-flight; land it instead. Same for anyone who asked for less motion.
      if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setHeight(to);
        rest();
        return;
      }
      stopSpring.current = springTo(height, to, velocity, setHeight, rest);
    },
    [height],
  );

  // Sent somewhere from outside. The fit is measured here and now: the
  // content that decides it may have changed in this very render.
  const snapKey = snap?.key;
  useEffect(() => {
    if (!snap || stage <= 0) return;
    let to = heightOf(snap.to);
    if (snap.to === "fit" && fit) {
      const h = measureFit();
      if (h > 0) {
        to = h;
        setFitH(h);
      }
    }
    if (to <= 0) return;
    touched.current = true;
    settle(to, 0, undefined, snap.to);
    // Only a new key moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapKey]);

  useEffect(() => () => stopSpring.current?.(), []);

  /** Is anything between the finger and the body scrolled away from its top? Then pulling down is that list's. */
  const scrolledAbove = (target: EventTarget | null) => {
    for (let el = target as HTMLElement | null; el && el !== bodyRef.current; el = el.parentElement) {
      if (el.scrollTop > 0) return true;
    }
    return (bodyRef.current?.scrollTop ?? 0) > 0;
  };

  const begin = (e: React.PointerEvent, fromBody: boolean) => {
    if (drag.current || stage <= 0) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Nothing is captured yet: until the finger travels, this is a tap and
    // belongs to whatever it landed on.
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startH: height,
      lastY: e.clientY,
      lastT: performance.now(),
      v: 0,
      fromBody,
      fromThumb: !fromBody && Boolean(thumbRef.current?.contains(e.target as Node)),
      active: false,
      el: e.currentTarget as HTMLElement,
    };
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      const dx = e.clientX - d.startX;
      if (Math.abs(dy) < DRAG_SLOP && Math.abs(dx) < DRAG_SLOP) return;
      // Sideways is somebody else's gesture — a row of tabs, a carousel.
      if (Math.abs(dx) > Math.abs(dy)) {
        drag.current = null;
        return;
      }
      // From the body, pulling down only moves the sheet from the top of
      // the list, and pushing up only while there's room to grow; anything
      // else is the list scrolling.
      if (d.fromBody && (dy > 0 ? scrolledAbove(e.target) : d.startH >= max)) {
        drag.current = null;
        return;
      }
      d.active = true;
      touched.current = true;
      restRef.current = null;
      stopSpring.current?.();
      try {
        d.el.setPointerCapture(e.pointerId);
      } catch {
        // No live pointer to capture (synthetic events): the move and up
        // handlers on the same element still see it through.
      }
    }
    let next = d.startH - dy;
    // Past the top detent it gets heavy rather than stopping dead.
    if (next > max) next = max + (next - max) * 0.25;
    const floor = onDismiss ? 0 : min;
    if (next < floor) next = floor + (next - floor) * 0.35;
    const now = performance.now();
    const dt = (now - d.lastT) / 1000;
    if (dt > 0) d.v = ((d.lastY - e.clientY) / dt) * 0.85 + d.v * 0.15;
    d.lastY = e.clientY;
    d.lastT = now;
    setHeight(next);
    e.preventDefault();
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) {
      // Never became a drag, so it was a tap, however long it was held.
      // Only the thumb folds the sheet away or brings it back; a tap on a
      // tab, a chip or a button is left to that control.
      if (d.fromThumb && e.type === "pointerup" && collapsible && thumbH > 0) {
        const collapsed = height <= thumbH + 2;
        settle(collapsed ? opening : thumbH, 0, undefined, collapsed ? stopAt(opening) : "collapsed");
      }
      return;
    }
    // Where the flick is headed, not where the finger left off.
    const projected = height + d.v * PROJECTION;
    if (onDismiss && projected < min - DISMISS_SLOP) {
      settle(0, d.v, onDismiss);
      return;
    }
    const target = stops.reduce((best, s) => (Math.abs(s - projected) < Math.abs(best - projected) ? s : best), stops[0] ?? 0);
    settle(target, d.v, undefined, stopAt(target));
  };

  /** The thumb is a real control: arrows move between detents, Escape shuts. */
  const onKey = (e: React.KeyboardEvent) => {
    touched.current = true;
    const i = stops.reduce((bi, s, si) => (Math.abs(s - height) < Math.abs((stops[bi] ?? 0) - height) ? si : bi), 0);
    if (e.key === "ArrowUp" && i < stops.length - 1) {
      e.preventDefault();
      settle(stops[i + 1]!, 0, undefined, stopAt(stops[i + 1]!));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (i > 0) settle(stops[i - 1]!, 0, undefined, stopAt(stops[i - 1]!));
      else if (onDismiss) settle(0, 0, onDismiss);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (collapsible && thumbH > 0 && height <= thumbH + 2) settle(opening, 0, undefined, stopAt(opening));
      else if (collapsible && thumbH > 0) settle(thumbH, 0, undefined, "collapsed");
    } else if (e.key === "Escape" && onDismiss) {
      settle(0, 0, onDismiss);
    }
  };

  const expanded = height >= max - 1;

  return (
    <div
      ref={ref}
      className={cn(
        "sheet-obj absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-overlay",
        className,
      )}
      style={{ height: height || undefined, paddingBottom: collapsible ? "env(safe-area-inset-bottom)" : undefined }}
      role="dialog"
      aria-label={label}
    >
      <div
        ref={headRef}
        className="shrink-0"
        onPointerDown={(e) => begin(e, false)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div ref={thumbRef} className="touch-none py-2.5">
          <button
            type="button"
            onKeyDown={onKey}
            aria-label={`${label} — drag to resize, tap to ${expanded ? "fold away" : "open"}`}
            aria-expanded={expanded}
            className="mx-auto block h-5 w-14 cursor-grab active:cursor-grabbing"
          >
            <span className="mx-auto block h-1 w-9 rounded-full bg-white/[0.28] transition-colors hover:bg-white/50" />
          </button>
        </div>
        {/* The browser keeps sideways pans (a row of tabs); up and down is the sheet's. */}
        {header && <div className="touch-pan-x">{header}</div>}
      </div>

      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onPointerDown={(e) => {
          if (!scrolledAbove(e.target)) begin(e, true);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {children}
      </div>

      {footer && <div ref={footRef} className="shrink-0">{footer}</div>}
    </div>
  );
}
