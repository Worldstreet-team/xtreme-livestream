"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Tip — the one tooltip. A short, plain-English name for a control whose
 * icon has to explain itself: "Pin in chat", "Add a guest", "Mute (M)".
 *
 *   <Tip label="Put this comment on screen" hint="F">
 *     <button aria-label="Feature" …><Star /></button>
 *   </Tip>
 *
 * When it shows
 *  - mouse: after resting on the trigger for OPEN_DELAY; once one tip has
 *    been up, the next opens at once for WARM_WINDOW (a toolbar you sweep
 *    along reads like macOS's), with a short cross-fade instead of the grow;
 *  - keyboard: on focus, when the focus is visible;
 *  - touch: only on a long-press. A tap is never delayed or eaten; a
 *    long-press that showed the tip doesn't also press the button.
 *  - it goes on leave, blur, Escape, and the moment you press the trigger.
 *
 * Where: fixed to the viewport in a portal (into the fullscreen element when
 * there is one), on `side` if it fits, flipped to the other side if that has
 * more room, then slid along to stay EDGE px inside the screen. The arrow is
 * placed after the slide, so it always points at the trigger's centre.
 *
 * Motion: grows from the arrow's tip (0.92 → 1) as it fades in and travels a
 * few px away from the trigger, on EASE.tip; leaves faster on EASE.tipOut.
 * Reduced motion is a plain fade.
 *
 * Look: Afterglow's solid inverse surface (light on the dark theme, ink on
 * the light one), 8px corners, 12.5px medium type, an optional key cap for
 * a shortcut. No blur, no glow.
 *
 * Accessibility: role="tooltip", wired to the trigger with aria-describedby
 * while it's up (skipped when it would only repeat the trigger's own
 * aria-label). A tip never names a control: icon buttons keep an aria-label.
 * The child must pass pointer, focus and click handlers through to its DOM
 * element (every button, link and our Button/IconButton/Pill do).
 */

export type TipSide = "top" | "bottom" | "left" | "right";

/** Rest before a hover tip opens. */
const OPEN_DELAY = 350;
/** After a tip closes, the next one opens without the rest. */
const WARM_WINDOW = 450;
/** A touch has to be held this long to ask what something is. */
const LONG_PRESS = 450;
/** A finger that travels this far is scrolling, not asking. */
const TOUCH_SLOP = 10;
/** A long-press tip stays this long after the finger lifts. */
const TOUCH_LINGER = 1500;
/** Trigger edge to tip body. The arrow sits in this gap. */
const GAP = 9;
/** The closest a tip comes to the screen's edge. */
const EDGE = 8;
/** Arrow box (pointing down), and how far the arrow keeps from the corners. */
const ARROW_W = 14;
const ARROW_H = 7;
const ARROW_INSET = 12;
/** The px the tip travels away from its trigger as it arrives. */
const TRAVEL = 5;

const OPPOSITE: Record<TipSide, TipSide> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/* ---- one tip at a time, and the warm window --------------------------- */

/** The tip that's up, and the one still fading out: a new tip clears both at once. */
let activeDismiss: (() => void) | null = null;
let exitingDismiss: (() => void) | null = null;
let warmUntil = 0;

/** Take the stage. Returns true while tips are warm (one up, or one just gone). */
function claimStage(dismiss: () => void): boolean {
  const warm = isWarm();
  if (activeDismiss && activeDismiss !== dismiss) activeDismiss();
  if (exitingDismiss && exitingDismiss !== dismiss) exitingDismiss();
  exitingDismiss = null;
  activeDismiss = dismiss;
  return warm;
}

function leaveStage(dismiss: () => void, { warm, exiting }: { warm: boolean; exiting: boolean }) {
  if (activeDismiss === dismiss) activeDismiss = null;
  if (exiting) exitingDismiss = dismiss;
  else if (exitingDismiss === dismiss) exitingDismiss = null;
  if (warm) warmUntil = performance.now() + WARM_WINDOW;
}

function exitDone(dismiss: () => void) {
  if (exitingDismiss === dismiss) exitingDismiss = null;
}

function isWarm(): boolean {
  return activeDismiss !== null || performance.now() < warmUntil;
}

/* ---- placement --------------------------------------------------------- */

interface Placement {
  side: TipSide;
  x: number;
  y: number;
  /** Arrow centre along the tip's edge (x for top/bottom, y for left/right). */
  arrow: number;
}

function place(anchor: DOMRect, w: number, h: number, want: TipSide): Placement {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const room: Record<TipSide, number> = { top: anchor.top, bottom: vh - anchor.bottom, left: anchor.left, right: vw - anchor.right };
  const need = (s: TipSide) => (s === "top" || s === "bottom" ? h : w) + GAP + EDGE;

  let side = want;
  if (room[side] < need(side) && room[OPPOSITE[side]] > room[side]) side = OPPOSITE[side];
  // Too narrow to sit beside it on either hand (a phone): go above, or below.
  if ((side === "left" || side === "right") && room[side] < need(side)) side = room.top >= need("top") ? "top" : "bottom";

  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  if (side === "top" || side === "bottom") {
    const x = clamp(cx - w / 2, EDGE, vw - EDGE - w);
    const y = side === "top" ? anchor.top - GAP - h : anchor.bottom + GAP;
    return { side, x: Math.round(x), y: Math.round(clamp(y, EDGE, vh - EDGE - h)), arrow: Math.round(clamp(cx - x, ARROW_INSET, w - ARROW_INSET)) };
  }
  const y = clamp(cy - h / 2, EDGE, vh - EDGE - h);
  const x = side === "left" ? anchor.left - GAP - w : anchor.right + GAP;
  return { side, x: Math.round(clamp(x, EDGE, vw - EDGE - w)), y: Math.round(y), arrow: Math.round(clamp(cy - y, ARROW_INSET, h - ARROW_INSET)) };
}

/**
 * A tip never repeats what the control already says on screen (a button whose
 * word shows from `xl`, a rail opened wide). Only text a sighted user can see
 * counts: not sr-only, not faded out, not squeezed to nothing.
 */
function saysAlready(anchor: HTMLElement, label: string): boolean {
  let seen = "";
  const walk = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const host = node.parentElement;
    if (!host || !node.textContent?.trim() || host.closest(".sr-only")) continue;
    if (host.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) continue;
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    const clip = host.getBoundingClientRect();
    if (box.width < 1 || clip.width < 1 || clip.height < 1) continue;
    seen += ` ${node.textContent}`;
  }
  const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
  return seen !== "" && norm(seen) === norm(label);
}

/** The unit vector from the tip toward its trigger. */
function towardTrigger(side: TipSide): [number, number] {
  return side === "top" ? [0, 1] : side === "bottom" ? [0, -1] : side === "left" ? [1, 0] : [-1, 0];
}

/* ---- the component ----------------------------------------------------- */

type Via = "hover" | "focus" | "touch";

type TriggerProps = {
  title?: string;
  "aria-describedby"?: string;
  "aria-label"?: string;
  onPointerEnter?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel?: (e: ReactPointerEvent<HTMLElement>) => void;
  onFocus?: (e: ReactFocusEvent<HTMLElement>) => void;
  onBlur?: (e: ReactFocusEvent<HTMLElement>) => void;
  onClickCapture?: (e: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLElement>) => void;
};

export interface TipProps {
  /** What the control does, in a few plain words. */
  label: string;
  /** Where it prefers to sit. It flips when there isn't room. */
  side?: TipSide;
  /** A keyboard shortcut, shown in a key cap ("M", "⌘K", "Hold V"). */
  hint?: string;
  /** Render the child alone — e.g. once a rail is wide enough to show its words. */
  disabled?: boolean;
  /** Long-press shows the tip on touch. Off for triggers that are held (push-to-talk). */
  touch?: boolean;
  className?: string;
  /** One element that takes focus and passes handlers through. */
  children: ReactElement<TriggerProps>;
}

interface Shown {
  via: Via;
  /** Opened while warm: cross-fade, don't grow. */
  swap: boolean;
  host: Element;
}

export function Tip({ label, side = "top", hint, disabled, touch = true, className, children }: TipProps) {
  const id = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sideRef = useRef<TipSide>(side);
  const viaRef = useRef<Via | null>(null);
  const exitRef = useRef<Animation | null>(null);
  /** Pressed with a mouse: stay quiet until the pointer leaves. */
  const quietRef = useRef(false);
  /** A long-press showed the tip: the click it ends in isn't a press. */
  const longPressRef = useRef(false);
  const pressStart = useRef<{ x: number; y: number } | null>(null);

  const clearTimers = useCallback(() => {
    clearTimeout(timer.current);
    clearTimeout(lingerTimer.current);
  }, []);

  // Stable identity on the stage, so another tip can clear this one at once.
  const dismissNow = useRef<() => void>(() => {});
  const hide = useCallback(
    (instant = false) => {
      clearTimers();
      const via = viaRef.current;
      if (!via) return;
      viaRef.current = null;
      const el = tipRef.current;
      const animate = !instant && el !== null;
      leaveStage(dismissNow.current, { warm: via !== "touch", exiting: animate });
      if (!animate) {
        setShown(null);
        return;
      }
      const [dx, dy] = towardTrigger(sideRef.current);
      const reduce = prefersReducedMotion();
      exitRef.current?.cancel();
      const anim = el.animate(
        reduce
          ? [{ opacity: 1 }, { opacity: 0 }]
          : [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: `translate(${dx * 2}px, ${dy * 2}px) scale(0.96)` },
            ],
        { duration: reduce ? DURATION.fade * 0.6 : DURATION.tipOut, easing: EASE.tipOut, fill: "both" },
      );
      exitRef.current = anim;
      anim.onfinish = () => {
        exitDone(dismissNow.current);
        // Re-opened mid-exit: that open owns the element now.
        if (exitRef.current === anim && !viaRef.current) setShown(null);
      };
    },
    [clearTimers],
  );

  useEffect(() => {
    dismissNow.current = () => {
      clearTimers();
      viaRef.current = null;
      exitRef.current?.cancel();
      exitRef.current = null;
      setShown(null);
    };
  }, [clearTimers]);

  const show = useCallback(
    (via: Via, anchor: HTMLElement) => {
      clearTimers();
      if (saysAlready(anchor, label)) return;
      anchorRef.current = anchor;
      const swap = claimStage(dismissNow.current) && via !== "touch";
      viaRef.current = via;
      exitRef.current?.cancel();
      exitRef.current = null;
      // Fullscreen shows only its own subtree, so the tip goes in there.
      const full = document.fullscreenElement;
      setShown({ via, swap, host: full && !(full instanceof HTMLMediaElement) ? full : document.body });
    },
    [clearTimers, label],
  );

  /** Measure, flip, slide, and aim the arrow. Style writes only — no render. */
  const reposition = useCallback(() => {
    const el = tipRef.current;
    const anchor = anchorRef.current;
    const arrow = arrowRef.current;
    if (!el || !anchor || !arrow) return;
    const p = place(anchor.getBoundingClientRect(), el.offsetWidth, el.offsetHeight, side);
    sideRef.current = p.side;
    el.dataset.side = p.side;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // The arrow is drawn pointing down; turn it to face the trigger and
    // sit it half in the gap, its base tucked under the body.
    const a = arrow.style;
    const rot = { top: 0, bottom: 180, left: -90, right: 90 }[p.side];
    const vertical = p.side === "top" || p.side === "bottom";
    const cx = vertical ? p.arrow : p.side === "left" ? w + ARROW_H / 2 - 1 : -ARROW_H / 2 + 1;
    const cy = vertical ? (p.side === "top" ? h + ARROW_H / 2 - 1 : -ARROW_H / 2 + 1) : p.arrow;
    a.left = `${cx - ARROW_W / 2}px`;
    a.top = `${cy - ARROW_H / 2}px`;
    a.transform = `rotate(${rot}deg)`;
    // Grow from the arrow's point.
    const ox = vertical ? p.arrow : p.side === "left" ? w + ARROW_H : -ARROW_H;
    const oy = vertical ? (p.side === "top" ? h + ARROW_H : -ARROW_H) : p.arrow;
    el.style.transformOrigin = `${ox}px ${oy}px`;
  }, [side]);

  // Placed and set moving before the first paint.
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!shown || !el) return;
    reposition();
    const reduce = prefersReducedMotion();
    const [dx, dy] = towardTrigger(sideRef.current);
    if (reduce) {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.fade * 0.75, easing: "linear", fill: "backwards" });
    } else if (shown.swap) {
      el.animate(
        [
          { opacity: 0, transform: `translate(${dx * 2}px, ${dy * 2}px)` },
          { opacity: 1, transform: "none" },
        ],
        { duration: DURATION.tipSwap, easing: EASE.unfold, fill: "backwards" },
      );
    } else {
      el.animate(
        [
          { opacity: 0, transform: `translate(${dx * TRAVEL}px, ${dy * TRAVEL}px) scale(0.92)` },
          // The fade is done while the grow is still landing.
          { opacity: 1, offset: 0.45 },
          { opacity: 1, transform: "none" },
        ],
        { duration: DURATION.tip, easing: EASE.tip, fill: "backwards" },
      );
    }
    if (process.env.NODE_ENV !== "production") {
      const a = anchorRef.current;
      const named = a && (a.getAttribute("aria-label") || a.getAttribute("aria-labelledby") || a.textContent?.trim());
      if (a && !named) console.warn(`<Tip label="${label}">: the trigger has no accessible name. Give it an aria-label.`);
    }
    // Only a fresh open animates; a label change just re-measures (below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  // A label that changes while up (Mute → Unmute) re-measures in place.
  useLayoutEffect(() => {
    if (shown) reposition();
  }, [label, hint, shown, reposition]);

  // While up: follow scroll and resize; Escape and a vanished trigger close it.
  useEffect(() => {
    if (!shown) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!anchorRef.current?.isConnected) hide(true);
        else reposition();
      });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown, hide, reposition]);

  // Unmounting while up hands the stage back.
  useEffect(
    () => () => {
      clearTimers();
      const dismiss = dismissNow.current;
      leaveStage(dismiss, { warm: false, exiting: false });
    },
    [clearTimers],
  );

  // Disabled while up (the rail opened under the pointer): go.
  useEffect(() => {
    if (disabled && viaRef.current) hide(true);
  }, [disabled, hide]);

  if (!isValidElement(children)) return children;

  const own = children.props;
  const describe = shown && own["aria-label"]?.trim().toLowerCase() !== label.trim().toLowerCase();

  // Disabled keeps the same tree (so the trigger isn't remounted when it flips),
  // just without the handlers.
  const trigger = disabled ? children : cloneElement(children, {
    // An empty title stops an ancestor's native tooltip (a chat line's time)
    // from surfacing over this one.
    title: own.title ?? "",
    "aria-describedby": describe ? [own["aria-describedby"], id].filter(Boolean).join(" ") : own["aria-describedby"],
    onPointerEnter: (e: ReactPointerEvent<HTMLElement>) => {
      own.onPointerEnter?.(e);
      if (e.pointerType === "touch" || quietRef.current) return;
      const anchor = e.currentTarget;
      clearTimers();
      if (isWarm()) show("hover", anchor);
      else timer.current = setTimeout(() => show("hover", anchor), OPEN_DELAY);
    },
    onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => {
      own.onPointerLeave?.(e);
      if (e.pointerType === "touch") return;
      quietRef.current = false;
      clearTimeout(timer.current);
      if (viaRef.current === "hover") hide();
    },
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      own.onPointerDown?.(e);
      longPressRef.current = false;
      if (e.pointerType !== "touch") {
        // Pressing is the answer to "what is this?" — step aside.
        quietRef.current = true;
        clearTimeout(timer.current);
        if (viaRef.current) hide();
        return;
      }
      // A tap while a long-press tip lingers: the tip has said its piece.
      if (viaRef.current === "touch") hide();
      if (!touch) return;
      pressStart.current = { x: e.clientX, y: e.clientY };
      const anchor = e.currentTarget;
      clearTimers();
      timer.current = setTimeout(() => {
        longPressRef.current = true;
        show("touch", anchor);
      }, LONG_PRESS);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      own.onPointerMove?.(e);
      const start = pressStart.current;
      if (e.pointerType !== "touch" || !start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TOUCH_SLOP) {
        pressStart.current = null;
        clearTimeout(timer.current);
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      own.onPointerUp?.(e);
      if (e.pointerType !== "touch") return;
      pressStart.current = null;
      clearTimeout(timer.current);
      if (viaRef.current === "touch") lingerTimer.current = setTimeout(() => hide(), TOUCH_LINGER);
      // The click a long-press ends in arrives right after the lift, if at
      // all; past that, a later press (a keyboard Enter) is a real one.
      if (longPressRef.current) setTimeout(() => (longPressRef.current = false), 600);
    },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => {
      own.onPointerCancel?.(e);
      pressStart.current = null;
      clearTimeout(timer.current);
      if (viaRef.current === "touch") hide();
    },
    onFocus: (e: ReactFocusEvent<HTMLElement>) => {
      own.onFocus?.(e);
      let visible = false;
      try {
        visible = e.currentTarget.matches(":focus-visible");
      } catch {
        visible = false;
      }
      if (visible && !quietRef.current) show("focus", e.currentTarget);
    },
    onBlur: (e: ReactFocusEvent<HTMLElement>) => {
      own.onBlur?.(e);
      clearTimeout(timer.current);
      if (viaRef.current === "focus") hide();
    },
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (longPressRef.current) {
        // The long-press asked what this is; it didn't press it.
        longPressRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      own.onClickCapture?.(e);
    },
    onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
      // Android's long-press menu would land on top of the tip. Links keep theirs.
      if (viaRef.current === "touch" && !e.currentTarget.closest("a[href]")) e.preventDefault();
      own.onContextMenu?.(e);
    },
  });

  return (
    <>
      {trigger}
      {shown &&
        !disabled &&
        createPortal(
          <TipBubble ref={tipRef} arrowRef={arrowRef} id={id} label={label} hint={shown.via === "touch" ? undefined : hint} className={className} />,
          shown.host,
        )}
    </>
  );
}

/* ---- the bubble -------------------------------------------------------- */

/** Where the arrow sits when nothing measures it: centred on the side facing the trigger. */
const RESTING_ARROW: Record<TipSide, CSSProperties> = {
  top: { left: `calc(50% - ${ARROW_W / 2}px)`, top: "calc(100% - 1px)" },
  bottom: { left: `calc(50% - ${ARROW_W / 2}px)`, top: `${1 - ARROW_H}px`, transform: "rotate(180deg)" },
  left: { left: `calc(100% - ${ARROW_W / 2 - ARROW_H / 2 + 1}px)`, top: `calc(50% - ${ARROW_H / 2}px)`, transform: "rotate(-90deg)" },
  right: { left: `${-(ARROW_W / 2 + ARROW_H / 2 - 1)}px`, top: `calc(50% - ${ARROW_H / 2}px)`, transform: "rotate(90deg)" },
};

/**
 * The tip itself, without the behaviour: Tip floats one of these in a
 * portal; `still` draws one in place (the design system's anatomy, where a
 * tip has to be seen without a hover). A still tip is decoration, so it's
 * hidden from assistive tech.
 */
export function TipBubble({
  label,
  hint,
  side = "top",
  still = false,
  id,
  className,
  ref,
  arrowRef,
}: {
  label: string;
  hint?: string;
  /** The side of its trigger it sits on (a still tip's arrow faces the other way). */
  side?: TipSide;
  still?: boolean;
  id?: string;
  className?: string;
  ref?: Ref<HTMLDivElement>;
  arrowRef?: Ref<SVGSVGElement>;
}) {
  return (
    <div
      ref={ref}
      id={id}
      role={still ? undefined : "tooltip"}
      aria-hidden={still || undefined}
      data-slot="tip"
      data-side={side}
      className={cn(
        still ? "relative inline-block" : "pointer-events-none fixed top-0 left-0 z-[var(--layer-tooltip)]",
        "w-max max-w-[min(260px,calc(100vw-16px))] rounded-[8px] bg-inverse px-2.5 py-[5px] text-left text-[12.5px] leading-[18px] font-medium tracking-[-0.005em] text-on-inverse shadow-[0_6px_18px_-8px_rgb(0_0_0/0.45)] select-none",
        hint && (still ? "inline-flex items-center gap-2 pr-[5px]" : "flex items-center gap-2 pr-[5px]"),
        className,
      )}
    >
      <span className="min-w-0">{label}</span>
      {hint && (
        <kbd className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] bg-on-inverse/[0.08] px-[5px] font-sans text-[11px] leading-none font-semibold text-on-inverse/65 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--on-inverse)_14%,transparent),inset_0_-1px_0_color-mix(in_oklab,var(--on-inverse)_16%,transparent)]">
          {hint}
        </kbd>
      )}
      <svg
        ref={arrowRef}
        aria-hidden="true"
        width={ARROW_W}
        height={ARROW_H}
        viewBox={`0 0 ${ARROW_W} ${ARROW_H}`}
        className="absolute text-inverse"
        style={still ? RESTING_ARROW[side] : { left: 0, top: 0 }}
      >
        <path d="M0 0H14L8.3 5.9C7.6 6.6 6.4 6.6 5.7 5.9Z" fill="currentColor" />
      </svg>
    </div>
  );
}
