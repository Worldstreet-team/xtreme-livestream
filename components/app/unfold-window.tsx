"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons";
import { DURATION, MOTION_VARS, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import s from "./unfold.module.css";

/**
 * The window that unfolds out of the thing you touched. One surface, two
 * shapes, shared by the notifications bell and the top gifters board:
 *
 * - Computers: a panel that opens out of its trigger's top-right corner —
 *   a clip that grows down and left while the panel lifts into place, rows
 *   settling in one after another — and folds back quickly on close.
 * - Phones: a full-height panel sliding in from the right edge over a
 *   scrim. The right because that's where the bell and the rail live, and
 *   the account drawer already owns the left; full height because a list
 *   of twenty wants the room, and a sheet from the top would fight the
 *   thumb for its close. Swipe it back to the right to dismiss.
 *
 * `placement` says where it opens on a computer: "below" hangs it under
 * the trigger (the bell), "over" lays it over the trigger from its top
 * (a board growing into its full window). Either way its right edge lines
 * up with the trigger's.
 *
 * Closing: Escape, the close control, a click outside (the trigger itself
 * excepted, so it can toggle), the scrim, or a swipe. Portaled to <body>
 * and marked `data-glass-popover`, so the rail's own outside-click closers
 * treat clicks inside it as inside.
 */

const PHONE_MAX = 767;
const GAP = 10;
const EDGE = 16;
/** Swipe-to-dismiss: past this far right, or a flick. */
const DISMISS_PX = 80;
const DISMISS_V = 0.55;

export type UnfoldPlacement = "below" | "over";

export function UnfoldWindow({
  open,
  onClose,
  anchor,
  triggerRef,
  placement = "below",
  width = 380,
  label,
  title,
  aside,
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  /** The trigger's rect, captured when it was pressed. */
  anchor: DOMRect | null;
  /** The trigger, so pressing it again toggles instead of closing-then-opening, and focus goes back to it. */
  triggerRef?: RefObject<HTMLElement | null>;
  placement?: UnfoldPlacement;
  width?: number;
  /** The dialog's accessible name. */
  label: string;
  title: ReactNode;
  /** Beside the title — a count, a period. */
  aside?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // Mounted while open and while leaving, so the exit finishes first.
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(false);
  // Which shape: decided when it opens and kept while it's up.
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.innerWidth <= PHONE_MAX);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Opening and closing are reconciled during render, no extra pass.
  if (open && (!present || closing)) {
    setPresent(true);
    setClosing(false);
    setPhone(window.innerWidth <= PHONE_MAX);
  }
  if (!open && present && !closing) {
    setClosing(true);
    setShown(false);
  }

  useEffect(() => {
    if (!present) return;
    if (!closing) {
      // A timer, not a frame: the closed transform has to paint first, and
      // frames don't run in a hidden tab, where a timer still does.
      const t = setTimeout(() => setShown(true), 20);
      return () => clearTimeout(t);
    }
    const reduce = prefersReducedMotion();
    const ms = reduce ? DURATION.fade : phone ? DURATION.slideOut : DURATION.fold;
    const t = setTimeout(() => {
      setPresent(false);
      setClosing(false);
    }, ms + 30);
    return () => clearTimeout(t);
  }, [present, closing, phone]);

  // Focus in on open, back to the trigger on close; Escape closes.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef?.current;
    const panel = panelRef.current;
    const t = setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      if (trigger && document.activeElement && panel?.contains(document.activeElement)) trigger.focus({ preventScroll: true });
    };
  }, [open, triggerRef]);

  // A computer: a press anywhere else closes it.
  useEffect(() => {
    if (!open || phone) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef?.current?.contains(t)) return;
      onCloseRef.current();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, phone, triggerRef]);

  // A phone: the page underneath holds still.
  useEffect(() => {
    if (!open || !phone) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, phone]);

  // Swipe right to dismiss (phone). Horizontal only; vertical is the list's.
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const st = start.current;
    if (!st) return;
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    if (!st.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (st.axis === "x") {
        setDragging(true);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }
    }
    if (st.axis === "x") setDrag(Math.max(0, dx));
  };
  const endDrag = (e: React.PointerEvent) => {
    const st = start.current;
    start.current = null;
    if (!st || st.axis !== "x") return;
    const dx = Math.max(0, e.clientX - st.x);
    const v = dx / Math.max(1, performance.now() - st.t);
    setDragging(false);
    setDrag(0);
    if (dx > DISMISS_PX || v > DISMISS_V) onCloseRef.current();
  };

  if (!present || typeof document === "undefined") return null;

  const header = (
    <div className="flex shrink-0 items-center gap-3 px-4 pt-3.5 pb-3 shadow-[inset_0_-1px_0_var(--hairline-color)]">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <h2 className="truncate font-wide text-[15px] font-bold tracking-[-0.02em] text-foreground">{title}</h2>
        {aside}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cn(
          "press flex shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-control hover:text-foreground",
          phone ? "size-9 bg-control text-foreground" : "size-8",
        )}
      >
        <X size={phone ? 18 : 16} weight="bold" />
      </button>
    </div>
  );

  const body = (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin scrollbar-track-transparent scrollbar-thumb-tint/10">
      {children}
    </div>
  );

  if (phone) {
    return createPortal(
      <div
        data-glass-popover
        data-shown={shown || undefined}
        data-dragging={dragging || undefined}
        className={s.phone}
        style={{ ...MOTION_VARS, ["--drag" as string]: `${drag}px` }}
      >
        <div className={s.scrim} onClick={onClose} aria-hidden />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className={cn(s.sheet, "rounded-l-panel bg-popover pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] outline-none", className)}
        >
          {header}
          {body}
          {footer}
        </div>
      </div>,
      document.body,
    );
  }

  // A computer: right edge on the trigger's, clamped to the screen.
  const a = anchor ?? new DOMRect(window.innerWidth - EDGE, 64, 0, 0);
  const vh = window.innerHeight;
  const right = Math.max(EDGE, window.innerWidth - a.right);
  const want = Math.min(620, vh - 2 * EDGE);
  const top =
    placement === "below"
      ? Math.round(a.bottom + GAP)
      : Math.round(Math.max(72, Math.min(a.top, vh - want - EDGE)));
  const maxHeight = vh - top - EDGE;

  return createPortal(
    <div
      data-glass-popover
      data-closing={closing || undefined}
      className={s.desk}
      style={{ ...MOTION_VARS, top, right, width, maxHeight }}
    >
      <div className={s.plate} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className={cn(s.deskPanel, "bg-popover shadow-[inset_0_0_0_1px_var(--hairline-color)] outline-none", className)}
        style={{ maxHeight }}
      >
        {header}
        {body}
        {footer}
      </div>
    </div>,
    document.body,
  );
}

/** A staggered row: spread its props onto any element inside the window. */
export function unfoldRow(delayMs: number) {
  return { className: s.row, style: { ["--delay" as string]: `${delayMs}ms` } };
}
