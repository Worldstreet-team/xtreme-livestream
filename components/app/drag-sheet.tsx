"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 */

/** Springy, slightly underdamped: it passes the mark and comes back. */
const STIFFNESS = 150;
const DAMPING = 19;
/** Where a flick would land, in seconds of travel. */
const PROJECTION = 0.12;
/** Past this far below the smallest detent, a dismissible sheet closes. */
const DISMISS_SLOP = 56;

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
}: {
  /** Heights as a fraction of the stage, smallest first (e.g. [0.3, 0.72]). */
  detents: number[];
  defaultDetent?: number;
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
    startY: number;
    startH: number;
    lastY: number;
    lastT: number;
    v: number;
    fromBody: boolean;
    moved: number;
  } | null>(null);

  const stops = [
    ...(collapsible && thumbH > 0 ? [thumbH] : []),
    ...detents.map((d) => Math.round(d * stage)).filter((h) => h > 0),
  ];
  const opening = Math.round((detents[defaultDetent] ?? detents[0] ?? 0.5) * stage);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const settle = useCallback(
    (to: number, velocity: number, after?: () => void) => {
      stopSpring.current?.();
      // No frames run in a hidden tab, so a spring there would freeze
      // mid-flight; land it instead. Same for anyone who asked for less motion.
      if (document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setHeight(to);
        after?.();
        return;
      }
      stopSpring.current = springTo(height, to, velocity, setHeight, after);
    },
    [height],
  );

  useEffect(() => () => stopSpring.current?.(), []);

  const begin = (e: React.PointerEvent, fromBody: boolean) => {
    if (drag.current || stage <= 0) return;
    touched.current = true;
    stopSpring.current?.();
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      startH: height,
      lastY: e.clientY,
      lastT: performance.now(),
      v: 0,
      fromBody,
      moved: 0,
    };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // No live pointer to capture (synthetic events): the move and up
      // handlers on the same element still see it through.
    }
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    d.moved = Math.max(d.moved, Math.abs(dy));
    // A drag that starts in the body only counts while it pulls the sheet
    // shut; pushing up there is the list scrolling, not the sheet growing.
    if (d.fromBody && dy < 0 && d.startH >= max) return;
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
    const collapsed = collapsible && thumbH > 0 && height <= thumbH + 2;
    if (!d.fromBody && d.moved < 6) {
      // A press that never moved is a tap however long it was held: fold
      // it away, or bring it back.
      if (collapsed) settle(opening, 0);
      else if (collapsible && thumbH > 0) settle(thumbH, 0);
      return;
    }
    // Where the flick is headed, not where the finger left off.
    const projected = height + d.v * PROJECTION;
    if (onDismiss && projected < min - DISMISS_SLOP) {
      settle(0, d.v, onDismiss);
      return;
    }
    const target = stops.reduce((best, s) => (Math.abs(s - projected) < Math.abs(best - projected) ? s : best), stops[0] ?? 0);
    settle(target, d.v);
  };

  /** The thumb is a real control: arrows move between detents, Escape shuts. */
  const onKey = (e: React.KeyboardEvent) => {
    touched.current = true;
    const i = stops.reduce((bi, s, si) => (Math.abs(s - height) < Math.abs((stops[bi] ?? 0) - height) ? si : bi), 0);
    if (e.key === "ArrowUp" && i < stops.length - 1) {
      e.preventDefault();
      settle(stops[i + 1]!, 0);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (i > 0) settle(stops[i - 1]!, 0);
      else if (onDismiss) settle(0, 0, onDismiss);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (collapsible && thumbH > 0 && height <= thumbH + 2) settle(opening, 0);
      else if (collapsible && thumbH > 0) settle(thumbH, 0);
    } else if (e.key === "Escape" && onDismiss) {
      settle(0, 0, onDismiss);
    }
  };

  const expanded = height >= max - 1;

  return (
    <div
      ref={ref}
      className={cn(
        "sheet-obj absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden rounded-t-[22px]",
        className,
      )}
      style={{ height: height || undefined, paddingBottom: collapsible ? "env(safe-area-inset-bottom)" : undefined }}
      role="dialog"
      aria-label={label}
    >
      <div
        className="shrink-0 touch-none"
        onPointerDown={(e) => begin(e, false)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div ref={thumbRef} className="py-2.5">
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
        {header}
      </div>

      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onPointerDown={(e) => {
          if ((bodyRef.current?.scrollTop ?? 0) <= 0) begin(e, true);
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {children}
      </div>

      {footer && <div className="shrink-0">{footer}</div>}
    </div>
  );
}
