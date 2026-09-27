"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import s from "./primitives.module.css";

/**
 * Xtream's own illustration kit: the parts every in-house drawing is made
 * of — empty states first, then top gifters and key sections.
 *
 * The language: a faint disc to stand on, a few specks around it, objects
 * drawn in 2px lines over solid cards (10–14px corners, like the product),
 * placeholder text as soft bars, and at most one accent per drawing. Every
 * colour is a theme token, so a drawing is right in dark and light without a
 * second version. No bitmaps, gradients, glows, the Vivid dot sphere or the
 * logo.
 *
 * Coordinates are SVG user units inside an `ArtCanvas`; parts are designed
 * at scale 1 in a ~192×152 frame, which keeps the line weight the same from
 * drawing to drawing. Positioning transforms live on each part's own `<g>`,
 * so wrap a part in `Enter` / `Idle` to move it — their CSS transforms
 * would otherwise replace a `transform` attribute on the same element.
 */

/* ---- paint -------------------------------------------------------------- */

/** Class names for raw shapes, when a part doesn't exist yet: `<path className={paint.card} d="…" />`. */
export const paint = {
  /** 2px ink line, no fill. */
  line: s.line,
  /** A fainter 2px line: inner edges, dividers, empty buttons. */
  soft: s.soft,
  /** Add to a line for a dashed "empty slot" edge. */
  dash: s.dash,
  /** Solid card (surface-raised) with the ink line. */
  card: s.card,
  /** Card a step back (control fill), for things behind. */
  card2: s.card2,
  /** Placeholder text and quiet fills. */
  bar: s.bar,
  /** Stronger ink fill: glyphs, dots, a play triangle. */
  ink: s.ink,
  inkLine: s.inkLine,
  /** The neutral accent: white in dark, near-black in light. */
  hi: s.hi,
  /** Glyph and text bars drawn on `hi`. */
  onHi: s.onHi,
  onHiBar: s.onHiBar,
  speck: s.speck,
  disc: s.disc,
  /** Chili — only where the drawing is about being live, and a gift's ribbon. */
  live: s.live,
  liveLine: s.liveLine,
  /** Ember — a booked show, a pick, a streak. */
  ember: s.ember,
  emberLine: s.emberLine,
  /** Gold — money only. */
  coin: s.coin,
  coinLine: s.coinLine,
} as const;
export type Paint = keyof typeof paint;

/* ---- motion ------------------------------------------------------------- */

export type EnterKind = "rise" | "pop" | "fade" | "fromRight" | "disc";
export type IdleKind =
  | "float"
  | "breathe"
  | "twinkle"
  | "blink"
  | "typing"
  | "swing"
  | "ringOut"
  | "seek"
  | "spin"
  | "tick"
  | "flip"
  | "peek"
  | "fanL"
  | "fanR"
  | "search"
  | "wander"
  | "sway"
  | "earn";

const ENTER: Record<EnterKind, string> = { rise: s.rise!, pop: s.pop!, fade: s.fade!, fromRight: s.fromRight!, disc: s.discIn! };

/** Motion classes, for putting a motion straight on a shape instead of a wrapping `<g>`. */
export const motion: Record<EnterKind | IdleKind, string> = {
  ...ENTER,
  float: s.float!,
  breathe: s.breathe!,
  twinkle: s.twinkle!,
  blink: s.blink!,
  typing: s.typing!,
  swing: s.swing!,
  ringOut: s.ringOut!,
  seek: s.seek!,
  spin: s.spin!,
  tick: s.tick!,
  flip: s.flip!,
  peek: s.peek!,
  fanL: s.fanL!,
  fanR: s.fanR!,
  search: s.search!,
  wander: s.wander!,
  sway: s.sway!,
  earn: s.earn!,
};

/** Entrance delay, in ms, as the style the motion classes read. */
export const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;
/** Idle offset, in seconds, so parts that share a loop fall out of step. */
export const offset = (sec: number) => ({ "--i": `${sec}s` }) as CSSProperties;

/** Plays once when the drawing appears. `delay` in ms staggers parts. */
export function Enter({ kind = "rise", delay: ms, className, children }: { kind?: EnterKind; delay?: number; className?: string; children: ReactNode }) {
  return (
    <g className={cn(ENTER[kind], className)} style={ms === undefined ? undefined : delay(ms)}>
      {children}
    </g>
  );
}

/** A slow loop after the entrance. `offset` in seconds shifts it. */
export function Idle({ kind, offset: sec, className, children }: { kind: IdleKind; offset?: number; className?: string; children: ReactNode }) {
  return (
    <g className={cn(motion[kind], className)} style={sec === undefined ? undefined : offset(sec)}>
      {children}
    </g>
  );
}

/* ---- canvas ------------------------------------------------------------- */

/**
 * The `<svg>` every drawing sits in: carries the art tokens, holds its loops
 * still while off screen, and hides itself from assistive tech unless it's
 * given a `label` (decorative by default — the words around it say what it
 * means). Size it with a width class; height follows the viewBox.
 */
export function ArtCanvas({
  viewBox = "24 12 192 152",
  label,
  className,
  children,
  ...data
}: {
  viewBox?: string;
  label?: string;
  className?: string;
  children: ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  const ref = useRef<SVGSVGElement>(null);

  // Off screen, the loops hold still; they pick up where they were.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry) el.dataset.paused = String(!entry.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox={viewBox}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      className={cn(s.canvas, className)}
      {...data}
    >
      {children}
    </svg>
  );
}

/* ---- ground ------------------------------------------------------------- */

type Speck = [cx: number, cy: number, r: number, offset: number];
const SPECKS: Speck[] = [
  [38, 50, 2, 0],
  [206, 56, 1.6, 1.4],
  [198, 144, 2.2, 2.6],
  [44, 134, 1.5, 3.3],
];

/** What a drawing stands on: a faint disc that settles in, and specks that twinkle. */
export function Ground({ cx = 120, cy = 90, r = 72, specks = SPECKS }: { cx?: number; cy?: number; r?: number; specks?: Speck[] | false }) {
  return (
    <>
      <circle className={cn(s.disc, s.discIn)} cx={cx} cy={cy} r={r} />
      {specks && (
        <g className={s.fade} style={delay(300)}>
          {specks.map(([x, y, sr, t]) => (
            <circle key={`${x}-${y}`} className={cn(s.speck, s.twinkle)} style={offset(t)} cx={x} cy={y} r={sr} />
          ))}
        </g>
      )}
    </>
  );
}

/* ---- shapes ------------------------------------------------------------- */

/** A rounded card. `paint` card | card2 | line | soft; `dashed` for an empty slot. */
export function Card({
  x,
  y,
  w,
  h,
  r = 12,
  paint: p = "card",
  dashed = false,
  className,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  r?: number;
  paint?: Paint;
  dashed?: boolean;
  className?: string;
}) {
  return <rect className={cn(paint[p], dashed && s.dash, className)} x={x} y={y} width={w} height={h} rx={r} />;
}

/** A line of placeholder text — or any pill-ended bar. */
export function Bar({ x, y, w, h = 4.5, paint: p = "bar", className }: { x: number; y: number; w: number; h?: number; paint?: Paint; className?: string }) {
  return <rect className={cn(paint[p], className)} x={x} y={y} width={w} height={h} rx={h / 2} />;
}

/** A filled dot. */
export function Dot({ cx, cy, r, paint: p = "ink", className }: { cx: number; cy: number; r: number; paint?: Paint; className?: string }) {
  return <circle className={cn(paint[p], className)} cx={cx} cy={cy} r={r} />;
}

/** Five-point star polygon points. */
export function starPoints(cx: number, cy: number, R: number, r = R * 0.43) {
  return Array.from({ length: 10 }, (_, k) => {
    const rad = k % 2 ? r : R;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    return `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

export function Star({ cx, cy, R, r, paint: p = "ink" }: { cx: number; cy: number; R: number; r?: number; paint?: Paint }) {
  return <polygon className={paint[p]} points={starPoints(cx, cy, R, r)} />;
}

/* ---- figures ------------------------------------------------------------ */

/**
 * A person: head and shoulders in a round frame. No face, no colour — a
 * seat for someone. `ring` dashed makes it the empty seat.
 */
export function Figure({ cx, cy, r, ring = "line" }: { cx: number; cy: number; r: number; ring?: "line" | "dashed" | "none" }) {
  const id = `art${useId().replace(/[^\w-]/g, "")}`;
  return (
    <g>
      <clipPath id={id}>
        <circle cx={cx} cy={cy} r={r} />
      </clipPath>
      <circle className={s.card} style={{ stroke: "none" }} cx={cx} cy={cy} r={r} />
      <g clipPath={`url(#${id})`}>
        <circle className={s.bar} cx={cx} cy={cy - r * 0.22} r={r * 0.33} />
        <path className={s.bar} d={`M${cx - r * 0.62} ${cy + r}a${r * 0.62} ${r * 0.56} 0 0 1 ${r * 1.24} 0z`} />
      </g>
      {ring !== "none" && <circle className={cn(s.line, ring === "dashed" && s.dash)} cx={cx} cy={cy} r={r} />}
    </g>
  );
}

/* ---- props -------------------------------------------------------------- */

/** A coin. Gold is money's colour, so it's for money only. */
export function Coin({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle className={s.coin} cx={cx} cy={cy} r={r} />
      <circle className={s.coinLine} cx={cx} cy={cy} r={r * 0.6} />
    </g>
  );
}

/** A round badge in the neutral accent, with a glyph. */
export function Badge({ cx, cy, r, glyph = "check" }: { cx: number; cy: number; r: number; glyph?: "check" | "alert" | "plus" | "none" }) {
  const k = r / 16;
  return (
    <g>
      <circle className={s.hi} cx={cx} cy={cy} r={r} />
      {glyph === "check" && <path className={s.onHi} d={`M${cx - 7.5 * k} ${cy + 0.5 * k}l${5 * k} ${5 * k} ${10 * k} ${-10.5 * k}`} />}
      {glyph === "alert" && <path className={s.onHi} style={{ strokeWidth: 3 }} d={`M${cx} ${cy - 8.5 * k}v${10 * k}M${cx} ${cy + 7.5 * k}h0`} />}
      {glyph === "plus" && <path className={s.onHi} d={`M${cx} ${cy - 7 * k}v${14 * k}M${cx - 7 * k} ${cy}h${14 * k}`} />}
    </g>
  );
}

/** A signal ring leaving a point. At rest it sits still and faint; `far` is the fainter outer one. */
export function Pulse({ cx, cy, r, paint: p = "liveLine", offset: sec, far = false }: { cx: number; cy: number; r: number; paint?: Paint; offset?: number; far?: boolean }) {
  return <circle className={cn(paint[p], s.pulse, far && s.pulseFar)} style={sec === undefined ? undefined : offset(sec)} cx={cx} cy={cy} r={r} />;
}

/** A phone, notch and all. Children draw on its screen, in the same coordinates. */
export function Phone({ x, y, w = 60, h = 124, children }: { x: number; y: number; w?: number; h?: number; children?: ReactNode }) {
  return (
    <g>
      <rect className={s.card} x={x} y={y} width={w} height={h} rx={13} />
      <rect className={s.bar} x={x + w / 2 - 9} y={y + 7} width={18} height={4} rx={2} />
      {children}
    </g>
  );
}

/** A chat bubble. `mine` wears the neutral accent; `typing` shows three dots taking turns instead of text. */
export function Bubble({
  x,
  y,
  w,
  h = 34,
  mine = false,
  typing = false,
  lines = [0.58, 0.36],
}: {
  x: number;
  y: number;
  w: number;
  h?: number;
  mine?: boolean;
  typing?: boolean;
  /** Text bars as fractions of the width. */
  lines?: number[];
}) {
  const cy = y + h / 2;
  return (
    <g>
      <rect className={mine ? s.hi : s.card} x={x} y={y} width={w} height={h} rx={14} />
      {typing
        ? [-14, 0, 14].map((dx, k) => (
            <circle key={dx} className={cn(s.ink, s.typing)} style={offset(k * 0.18)} cx={x + w / 2 + dx} cy={cy} r={3.5} />
          ))
        : lines.map((f, k) => (
            <rect
              key={k}
              className={mine ? s.onHiBar : s.bar}
              x={x + 13}
              y={cy - (lines.length * 9.5) / 2 + k * 9.5 + 2.5}
              width={w * f}
              height={4.5}
              rx={2.25}
            />
          ))}
    </g>
  );
}

/**
 * A wrapped gift: box, lid and a Chili ribbon (a gift is one of heat's
 * places). `peek` lifts the lid now and then. (x, y) is the lid's top-left.
 */
export function Gift({ x, y, w = 82, peek = false }: { x: number; y: number; w?: number; peek?: boolean }) {
  const cx = x + w / 2;
  const lid = (
    <g className={peek ? s.peek : undefined}>
      <path
        className={s.liveLine}
        style={{ strokeWidth: 2.5 }}
        d={`M${cx} ${y}c-4-12-19-15-20-6-1 6 11 7 20 6zM${cx} ${y}c4-12 19-15 20-6 1 6-11 7-20 6z`}
      />
      <rect className={s.card} x={x} y={y} width={w} height={18} rx={7} />
      <rect className={s.live} x={cx - 5} y={y + 1} width={10} height={16} />
    </g>
  );
  return (
    <g>
      <rect className={s.card} x={x + 6} y={y + 16} width={w - 12} height={52} rx={9} />
      <rect className={s.live} x={cx - 5} y={y + 17} width={10} height={50} />
      {lid}
    </g>
  );
}

/** A ticket or voucher with notches and a tear line. (x, y) top-left; `stub` is the tear line's x. */
export function Ticket({ x, y, w = 116, h = 56, stub = 0.65, paint: p = "card", children }: { x: number; y: number; w?: number; h?: number; stub?: number; paint?: Paint; children?: ReactNode }) {
  const nx = x + w * stub;
  const d = `M${x + 10} ${y}H${nx - 6}a6 6 0 0 0 12 0H${x + w - 10}a10 10 0 0 1 10 10v${h - 20}a10 10 0 0 1-10 10H${nx + 6}a6 6 0 0 0-12 0H${x + 10}a10 10 0 0 1-10-10V${y + 10}a10 10 0 0 1 10-10z`;
  return (
    <g>
      <path className={paint[p]} d={d} />
      {children !== undefined && (
        <>
          <path className={s.soft} style={{ strokeDasharray: "3 5" }} d={`M${nx} ${y + 10}v${h - 20}`} />
          {children}
        </>
      )}
    </g>
  );
}

/** A magnifying lens with its handle, centred on (cx, cy). */
export function Lens({ cx, cy, r = 22 }: { cx: number; cy: number; r?: number }) {
  const k = r / 22;
  return (
    <g>
      <path className={s.line} style={{ strokeWidth: 6 }} d={`M${cx + 16 * k} ${cy + 16 * k}l${14 * k} ${14 * k}`} />
      <circle className={s.card} style={{ strokeWidth: 2.5 }} cx={cx} cy={cy} r={r} />
      <path className={s.soft} d={`M${cx - 12 * k} ${cy - 5 * k}a${13 * k} ${13 * k} 0 0 1 ${8 * k} ${-8 * k}`} />
    </g>
  );
}

/** A clock whose minute hand keeps going. */
export function Clock({ cx, cy, r = 19 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle className={s.card} cx={cx} cy={cy} r={r} />
      <path className={s.inkLine} d={`M${cx} ${cy}l${r * 0.37} ${-r * 0.21}`} />
      <path className={cn(s.inkLine, s.tick)} d={`M${cx} ${cy}v${-r * 0.68}`} />
      <circle className={s.ink} cx={cx} cy={cy} r={2.2} />
    </g>
  );
}

/** A bell, hung from (cx, top). `ringing` swings it every few seconds with sound marks either side. */
export function Bell({ cx, top, ringing = true, children }: { cx: number; top: number; ringing?: boolean; children?: ReactNode }) {
  return (
    <g transform={`translate(${cx - 120} ${top - 36})`}>
      {ringing && (
        <>
          <path className={cn(s.line, s.ringOut)} d="M84 58c-5 5-8 12-8 20" />
          <path className={cn(s.line, s.ringOut)} d="M156 58c5 5 8 12 8 20" />
        </>
      )}
      <g className={ringing ? s.swing : undefined}>
        <circle className={s.card} cx={120} cy={40} r={4} />
        <path className={s.card} d="M112 103a8 8 0 0 0 16 0z" />
        <path className={s.card} d="M120 46c-15 0-24 11-24 26v19l-7 11h62l-7-11V72c0-15-9-26-24-26z" />
        {children}
      </g>
    </g>
  );
}

/** A shield with a keyhole, its point at the bottom. (cx, top) is its crown. */
export function Shield({ cx, top }: { cx: number; top: number }) {
  return (
    <g transform={`translate(${cx - 120} ${top - 34})`}>
      <path className={s.card} d="M120 34l40 14v30c0 28-17 47-40 58-23-11-40-30-40-58V48z" />
      <path className={s.soft} d="M120 46l29 10v22c0 20-12 34-29 42-17-8-29-22-29-42V56z" />
      <circle className={s.ink} cx={120} cy={80} r={7} />
      <path className={s.ink} d="M116.5 84h7l2 16h-11z" />
    </g>
  );
}
