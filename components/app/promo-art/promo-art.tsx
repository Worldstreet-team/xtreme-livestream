"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Ground } from "@/components/app/art/primitives";
import kit from "@/components/app/art/primitives.module.css";
import { align, center, easeFrom, extent, lerpInto, point, SEGS, toPath, type Outline } from "@/components/app/tour/tour-art-morph";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { heartPath, isPose, LOOP_ONLY, PAINTS, pieceOf, type Idle, type PaintName, type Piece, type Pose, type PromoArtId, type Scene } from "./promo-art-pieces";
import s from "./promo-art.module.css";

export { PROMO_ART, type PromoArtId } from "./promo-art-pieces";
export { PROMO_THEME, type PromoTheme } from "./promo-themes";

/**
 * The art on a house slide (the home stage's promos, the rail's Spotlight):
 * one drawn object per promo that tells its pitch in three beats.
 *
 * - Off stage (a side seat, the peeking card): the first scene, still.
 * - Entrance: when its slide becomes the active one, and it's on screen,
 *   the parts morph through the story beat by beat: the phone's Go live is
 *   pressed, the phone becomes the heat ring, the room fills.
 * - Stage: it lands and keeps a gentle life (loops, hearts rising, the
 *   count climbing) until the slide leaves, when it folds back to the
 *   first scene.
 *
 * It pauses (loops, count) while inactive, off screen or in a hidden tab;
 * the morph driver only runs while a morph does. Reduced motion shows the
 * stage, still. Decorative: the slide's words carry the meaning.
 *
 * Geometry and the morph technique are the walkthrough's
 * (components/app/tour/tour-art-morph.ts); the pieces are
 * ./promo-art-pieces.ts. Put it inside its card's theme scope
 * (`PROMO_THEME[piece].scope`, ./promo-themes.ts): the art takes that app's
 * palette, in the page's light or dark.
 */
export function PromoArt({ piece: id, active, className, style }: { piece: PromoArtId; active: boolean; className?: string; style?: CSSProperties }) {
  const svg = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const probes = useRef<SVGGElement>(null);
  const driver = useRef<Driver | null>(null);
  // Drawn by React (and the server) in its first scene; after that the driver owns every part.
  const [piece] = useState(() => pieceOf(id));
  const first = piece.scenes[0]!;
  const gid = `pa-heat-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useLayoutEffect(() => {
    const d = new Driver(svg.current!, layer.current!, probes.current!, piece);
    driver.current = d;
    return () => {
      d.destroy();
      driver.current = null;
    };
  }, [piece]);

  useLayoutEffect(() => {
    driver.current?.setActive(active);
  }, [active]);

  return (
    <svg
      ref={svg}
      viewBox="30 14 180 144"
      aria-hidden
      focusable="false"
      className={cn(kit.canvas, s.canvas, className)}
      style={{ ...style, "--promo-heat": `url(#${gid})` } as CSSProperties}
      data-art={piece.id}
      data-stage="off"
      data-paused="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className={s.heatA} />
          <stop offset="0.52" className={s.heatB} />
          <stop offset="1" className={s.heatC} />
        </linearGradient>
      </defs>
      <Ground />
      <g ref={layer}>
        {piece.cast.map((name, i) => {
          const part = first.parts[i]!;
          const pose = isPose(part) ? part : null;
          return (
            <g key={name} data-part={name} style={{ opacity: pose ? (pose.opacity ?? 1) : 0 }}>
              <g className={pose?.idle && LOOP_ONLY.has(pose.idle.kind) ? s.loopOnly : undefined}>
                <path className={cn(s.shape, s[pose?.paint ?? "card"])} d={toPath(pose ? pose.d : point(...(part as { fold: [number, number] }).fold))} />
              </g>
            </g>
          );
        })}
      </g>
      <Garnish id={piece.id} />
      {/* One swatch per paint, never shown: the driver reads their computed colours to blend between paints. */}
      <g ref={probes} style={{ display: "none" }}>
        {PAINTS.map((p) => (
          <path key={p} data-paint={p} className={cn(s.shape, s.probe, s[p])} d="M0 0" />
        ))}
      </g>
    </svg>
  );
}

/* ---- the stage's garnish ------------------------------------------------------------ */

type Drift = { x: number; y: number; size: number; delay: number; dx: number; dy?: number; rot?: number; dur?: number };
const driftStyle = (d: Drift) => ({ "--i": `${d.delay}s`, "--dx": `${d.dx}px`, "--dy": `${d.dy ?? -44}px`, "--rot": `${d.rot ?? 0}deg`, "--dur": `${d.dur ?? 3.2}s` }) as CSSProperties;

function Hearts({ list, className }: { list: Drift[]; className: string }) {
  return (
    <>
      {list.map((h, i) => (
        <path key={i} className={cn(s.drift, className)} style={driftStyle(h)} d={heartPath(h.x, h.y, h.size)} />
      ))}
    </>
  );
}

/** A counter the driver ticks up while the stage shows: `data-count` is where it starts. */
function Count({ x, y, from, suffix = "", step = 3, anchor = "start", soft }: { x: number; y: number; from: number; suffix?: string; step?: number; anchor?: "start" | "middle"; soft?: boolean }) {
  return (
    <text x={x} y={y} textAnchor={anchor} className={cn(s.count, soft && s.countSoft)} data-count={from} data-step={step} data-suffix={suffix}>
      {from.toLocaleString("en-US") + suffix}
    </text>
  );
}

/** What only the stage has: things that rise and tick rather than morph. */
function Garnish({ id }: { id: PromoArtId }) {
  if (id === "golive") {
    return (
      <g className={s.garnish}>
        <Hearts
          className={s.glyphLive}
          list={[
            { x: 136, y: 56, size: 4.5, delay: 0, dx: 10 },
            { x: 132, y: 60, size: 3.4, delay: 0.8, dx: -4, rot: -12 },
            { x: 140, y: 58, size: 5.2, delay: 1.6, dx: 16, rot: 10 },
            { x: 134, y: 62, size: 3.8, delay: 2.4, dx: 4 },
          ]}
        />
        <path className={s.eye} d="M130 116c3.2-3.6 7.8-3.6 11 0c-3.2 3.6-7.8 3.6-11 0Z" />
        <circle className={s.eyeDot} cx={135.5} cy={116} r={1.5} />
        <Count x={144} y={119.8} from={1284} step={4} />
      </g>
    );
  }
  if (id === "worldspace") {
    return (
      <g className={s.garnish}>
        <Hearts
          className={s.glyphLive}
          list={[
            { x: 64, y: 128, size: 3.4, delay: 0.4, dx: -6, dy: -30, dur: 2.8 },
            { x: 66, y: 128, size: 2.8, delay: 1.8, dx: 7, dy: -34, dur: 2.8 },
          ]}
        />
        <Count x={93} y={139.4} from={248} step={2} soft />
      </g>
    );
  }
  if (id === "wolf") {
    const plus = (x: number, y: number) => `M${x - 0.9} ${y - 3.6}h1.8v2.7h2.7v1.8h-2.7v2.7h-1.8v-2.7h-2.7v-1.8h2.7Z`;
    const rise: Drift[] = [
      { x: 98, y: 66, size: 3.6, delay: 0, dx: -4, dy: -34 },
      { x: 143, y: 64, size: 0, delay: 0.9, dx: 5, dy: -36 },
      { x: 150, y: 76, size: 3, delay: 1.8, dx: 3, dy: -34 },
      { x: 92, y: 80, size: 0, delay: 2.6, dx: -3, dy: -36 },
    ];
    return (
      <g className={s.garnish}>
        {rise.map((r, i) => (
          <path key={i} className={cn(s.drift, s.glyph)} style={driftStyle(r)} d={r.size ? heartPath(r.x, r.y, r.size) : plus(r.x, r.y)} />
        ))}
      </g>
    );
  }
  return (
    <g className={s.garnish}>
      <Count x={120} y={153} from={2418} step={3} suffix=" calls" anchor="middle" soft />
    </g>
  );
}

/* ---- the driver ------------------------------------------------------------------------ */

type RGBA = [number, number, number, number];
type Look = { fill: RGBA; stroke: RGBA; width: number; dash: [number, number] };

type Part = {
  wrap: SVGGElement;
  beat: SVGGElement;
  path: SVGPathElement;
  cur: Outline;
  from: Outline;
  to: Outline;
  look: Look;
  lookFrom: Look;
  lookTo: Look;
  paint: PaintName;
  op: number;
  opFrom: number;
  opTo: number;
  shown: boolean;
  delay: number;
  dur: number;
  ease: (t: number) => number;
  done: boolean;
  idle: string | null;
  pose: Pose | null;
  /** Staying in (or arriving in) a gradient paint: leave the class's stroke alone rather than blend it through Chili. */
  keepStroke: boolean;
};

/** Paints whose stroke is the heat gradient, which can't be blended; their probes read as Chili. */
const GRADIENT: ReadonlySet<PaintName> = new Set<PaintName>(["heat", "ringFace"]);

const MORPH = easeFrom(EASE.morph);
const SETTLE = easeFrom(EASE.morphSettle);
/** Parts smaller than this (box diagonal, user units) land with the overshoot. */
const SMALL = 46;
/** A loop caught mid-beat when the scene changes eases home over this long. */
const HOME = 320;
/** Folding back to the first scene as the slide leaves: quicker than the entrance. */
const LEAVE_TEMPO = 0.7;
/** The count ticks this often, give or take. */
const TICK_MS = 1500;

function parseColor(v: string): RGBA {
  const m = /^(rgba?|color)\(([^)]*)\)$/.exec(v.trim());
  if (!m) return [0, 0, 0, 0];
  const srgb = m[1] === "color";
  const parts = m[2]!
    .replace(/^srgb\s+/, "")
    .split(/[\s,/]+/)
    .filter(Boolean);
  const n = (x: string | undefined, max: number) => (x === undefined ? 1 : x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x) / max);
  return [n(parts[0], srgb ? 1 : 255), n(parts[1], srgb ? 1 : 255), n(parts[2], srgb ? 1 : 255), parts[3] === undefined ? 1 : n(parts[3], 1)];
}

function mixColor(a: RGBA, b: RGBA, t: number): RGBA {
  // Premultiplied, so fading into transparent doesn't pass through black.
  const al = a[3] + (b[3] - a[3]) * t;
  if (al < 1e-4) return [0, 0, 0, 0];
  const ch = (i: number) => (a[i]! * a[3] + (b[i]! * b[3] - a[i]! * a[3]) * t) / al;
  return [ch(0), ch(1), ch(2), al];
}

const css = (c: RGBA) => `rgb(${(c[0] * 255).toFixed(1)} ${(c[1] * 255).toFixed(1)} ${(c[2] * 255).toFixed(1)} / ${c[3].toFixed(3)})`;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

class Driver {
  private parts: Part[];
  private readonly scenes: Scene[];
  private at = 0;
  private looks = {} as Record<PaintName, Look>;
  private raf = 0;
  private restTimer = 0;
  private beatTimer = 0;
  private countTimer = 0;
  private t0 = 0;
  private total = 0;
  private morphing = false;
  private reordered = true;
  private active = false;
  private pending = false;
  private reduced: boolean;
  private offscreen: boolean;
  private readonly mq: MediaQueryList | null;
  private readonly io: IntersectionObserver | null;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly layer: SVGGElement,
    private readonly probes: SVGGElement,
    piece: Piece,
  ) {
    this.scenes = piece.scenes;
    const first = this.scenes[0]!;
    this.readLooks();
    // By name, not position: an earlier driver on this canvas (a remount) may have reordered them.
    const wraps = piece.cast.map((name) => layer.querySelector<SVGGElement>(`:scope > [data-part="${name}"]`)!);
    this.parts = wraps.map((wrap, i) => {
      const beat = wrap.firstElementChild as SVGGElement;
      const path = beat.firstElementChild as SVGPathElement;
      const part = first.parts[i]!;
      const pose = isPose(part) ? part : null;
      const d = pose ? pose.d : point(...(part as { fold: [number, number] }).fold);
      const paint = pose?.paint ?? "card";
      const look = this.looks[paint];
      const op = pose ? (pose.opacity ?? 1) : 0;
      return {
        wrap, beat, path,
        cur: d.slice(), from: d, to: d,
        look, lookFrom: look, lookTo: look, paint,
        op, opFrom: op, opTo: op,
        shown: Boolean(pose),
        delay: 0, dur: 0, ease: MORPH, done: true,
        idle: null, pose, keepStroke: false,
      };
    });
    this.reorder(first.z);
    this.mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.reduced = Boolean(this.mq?.matches);
    this.mq?.addEventListener("change", this.onReduce);
    document.addEventListener("visibilitychange", this.onVisibility);
    // Until the observer first reports, assume it isn't seen: the entrance waits to be watched.
    this.offscreen = typeof IntersectionObserver !== "undefined";
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            this.offscreen = entry ? !entry.isIntersecting : false;
            this.onVisibility();
          });
    this.io?.observe(svg);
    if (this.reduced) this.still();
    this.onVisibility();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.beatTimer);
    window.clearInterval(this.countTimer);
    this.mq?.removeEventListener("change", this.onReduce);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.io?.disconnect();
  }

  private get last() {
    return this.scenes.length - 1;
  }

  private get seen() {
    return !this.offscreen && !document.hidden;
  }

  /** The slide took the stage, or left it. */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.onVisibility();
    if (this.reduced) return;
    if (on) {
      if (this.seen) this.play();
      else this.pending = true;
      return;
    }
    this.pending = false;
    window.clearTimeout(this.beatTimer);
    window.clearTimeout(this.restTimer);
    this.stageOff();
    if (this.at !== 0 || this.morphing) this.go(0, LEAVE_TEMPO);
    else this.homeIdles();
  }

  /** The entrance: from wherever it rests, through the story's beats to the stage. */
  private play() {
    this.pending = false;
    window.clearTimeout(this.beatTimer);
    if (this.morphing || this.at !== 0) {
      // Caught on the way out: turn straight back to the stage.
      this.go(this.last);
      return;
    }
    // Resting on the first scene: its own beat plays (the button pressed), then the story moves on.
    this.startIdles();
    this.beatTimer = window.setTimeout(() => this.go(1), this.scenes[0]!.hold);
  }

  /** Landed on a scene: hold it for its beat, then move on, or come alive on the stage. */
  private landed() {
    if (!this.active) return;
    this.startIdles();
    if (this.at < this.last) {
      this.beatTimer = window.setTimeout(() => this.go(this.at + 1), this.scenes[this.at]!.hold);
    } else this.stageOn();
  }

  private go(index: number, tempo = 1) {
    const next = this.scenes[index]!;
    this.at = index;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.beatTimer);
    this.readLooks();
    this.homeIdles();
    this.markLoopOnly(next);

    const D = DURATION.morph * tempo;
    const movers: { p: Part; dist: number }[] = [];
    next.parts.forEach((part, i) => {
      const p = this.parts[i]!;
      p.from = p.cur.slice();
      p.lookFrom = p.look;
      p.opFrom = p.op;
      p.done = false;
      p.pose = isPose(part) ? part : null;
      if (!isPose(part)) {
        // Not needed here: fold into the scene's pocket and fade.
        p.to = point(...part.fold);
        p.lookTo = p.look;
        p.keepStroke = GRADIENT.has(p.paint);
        p.opTo = 0;
        p.delay = 0;
        p.dur = D * 0.8;
        p.ease = MORPH;
        if (!p.shown && p.op < 0.01) {
          p.cur = p.to.slice();
          p.from = p.to;
          p.path.setAttribute("d", toPath(p.cur));
          p.done = true;
        }
        p.shown = false;
        return;
      }
      const unseen = p.op < 0.05;
      if (unseen) {
        // Arriving unseen: it grows out of a point where it was, already in its new paint.
        const [x, y] = center(p.cur);
        p.from = point(x, y);
        p.lookFrom = p.look = this.looks[part.paint];
      }
      p.keepStroke = GRADIENT.has(part.paint) && (unseen || p.paint === part.paint);
      p.to = align(p.from, part.d, this.looks[part.paint].dash[1] > 0 ? [0, SEGS / 2] : undefined);
      p.lookTo = this.looks[part.paint];
      this.setPaint(p, part.paint);
      p.opTo = part.opacity ?? 1;
      p.shown = true;
      p.ease = extent(part.d) < SMALL ? SETTLE : MORPH;
      const [cx, cy] = center(part.d);
      movers.push({ p, dist: Math.hypot(cx - next.focus[0], cy - next.focus[1]) });
    });

    // Nearest the focus moves first: the change ripples out from where it starts.
    movers.sort((a, b) => a.dist - b.dist);
    const gap = Math.min(DURATION.morphStagger, DURATION.morphSpan / Math.max(1, movers.length - 1)) * tempo;
    movers.forEach(({ p }, k) => {
      p.delay = k * gap;
      p.dur = D;
    });
    this.total = D + gap * Math.max(0, movers.length - 1);
    this.t0 = performance.now();
    this.reordered = false;
    this.morphing = true;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    let running = false;
    for (const p of this.parts) {
      if (p.done) continue;
      const t = clamp01((now - this.t0 - p.delay) / p.dur);
      lerpInto(p.cur, p.from, p.to, p.ease(t));
      p.path.setAttribute("d", toPath(p.cur));
      const c = MORPH(t);
      p.look = {
        fill: mixColor(p.lookFrom.fill, p.lookTo.fill, c),
        stroke: mixColor(p.lookFrom.stroke, p.lookTo.stroke, c),
        width: p.lookFrom.width + (p.lookTo.width - p.lookFrom.width) * c,
        dash: [p.lookFrom.dash[0] + (p.lookTo.dash[0] - p.lookFrom.dash[0]) * c, p.lookFrom.dash[1] + (p.lookTo.dash[1] - p.lookFrom.dash[1]) * c],
      };
      this.writeLook(p);
      // Arrivals fade in over the first part of their trip, departures fade out sooner.
      const o = p.opTo > p.opFrom ? MORPH(clamp01(t / 0.55)) : MORPH(clamp01(t / 0.45));
      p.op = p.opFrom + (p.opTo - p.opFrom) * o;
      p.wrap.style.opacity = String(Math.round(p.op * 1000) / 1000);
      if (t >= 1) this.settle(p);
      else running = true;
    }
    if (!this.reordered && now - this.t0 > this.total * 0.45) {
      this.reordered = true;
      this.reorder(this.scenes[this.at]!.z);
    }
    if (running) this.raf = requestAnimationFrame(this.tick);
    else {
      this.morphing = false;
      if (!this.reordered) this.reorder(this.scenes[this.at]!.z);
      this.reordered = true;
      this.restTimer = window.setTimeout(() => this.landed(), 80);
    }
  };

  /** Land exactly, and hand the paint back to its class. */
  private settle(p: Part) {
    p.done = true;
    p.cur = p.to.slice();
    p.path.setAttribute("d", toPath(p.cur));
    p.look = p.lookTo;
    p.op = p.opTo;
    p.wrap.style.opacity = String(p.opTo);
    p.path.style.fill = p.path.style.stroke = p.path.style.strokeWidth = p.path.style.strokeDasharray = "";
  }

  /** Reduced motion: the stage, still, with no loops. */
  private still() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.beatTimer);
    this.morphing = false;
    this.cut(this.last);
    this.svg.dataset.stage = "on";
  }

  private cut(index: number) {
    const next = this.scenes[index]!;
    this.at = index;
    this.homeIdles(true);
    this.markLoopOnly(next);
    next.parts.forEach((part, i) => {
      const p = this.parts[i]!;
      p.pose = isPose(part) ? part : null;
      p.cur = isPose(part) ? part.d.slice() : point(...part.fold);
      p.path.setAttribute("d", toPath(p.cur));
      if (isPose(part)) {
        this.setPaint(p, part.paint);
        p.look = p.lookTo = this.looks[part.paint];
      }
      p.shown = isPose(part);
      p.done = true;
      const hidden = !isPose(part) || (part.idle && LOOP_ONLY.has(part.idle.kind) && this.reduced);
      p.op = p.opTo = hidden ? 0 : (part as Pose).opacity ?? 1;
      p.wrap.style.opacity = String(p.op);
      p.path.style.fill = p.path.style.stroke = p.path.style.strokeWidth = p.path.style.strokeDasharray = "";
    });
    this.reorder(next.z);
  }

  private setPaint(p: Part, paint: PaintName) {
    if (p.paint === paint) return;
    p.path.classList.remove(s[p.paint]!);
    p.path.classList.add(s[paint]!);
    p.paint = paint;
  }

  private writeLook(p: Part) {
    const st = p.path.style;
    st.fill = css(p.look.fill);
    if (!p.keepStroke) st.stroke = css(p.look.stroke);
    st.strokeWidth = String(p.look.width);
    st.strokeDasharray = `${p.look.dash[0].toFixed(2)} ${p.look.dash[1].toFixed(2)}`;
  }

  /** Every paint's resolved colours, read fresh each time (the theme may have changed). */
  private readLooks() {
    for (const el of Array.from(this.probes.children) as SVGPathElement[]) {
      const cs = getComputedStyle(el);
      const dash = cs.strokeDasharray === "none" ? [1, 0] : cs.strokeDasharray.split(/[\s,]+/).map((v) => parseFloat(v) || 0);
      this.looks[el.dataset.paint as PaintName] = {
        fill: parseColor(cs.fill),
        stroke: parseColor(cs.stroke),
        width: parseFloat(cs.strokeWidth) || 0,
        dash: [dash[0] ?? 1, dash[1] ?? 0],
      };
    }
  }

  /** Paint order, bottom to top. Loops restart after a move, but a reorder only happens mid-morph, before they start. */
  private reorder(z: number[]) {
    const now = Array.from(this.layer.children);
    if (z.every((i, k) => now[k] === this.parts[i]!.wrap)) return;
    for (const i of z) this.layer.appendChild(this.parts[i]!.wrap);
  }

  /** Start the current scene's loops, together (re-adding a class restarts it, so parts sharing a loop stay in step). */
  private startIdles() {
    if (this.reduced) return;
    const scene = this.scenes[this.at]!;
    this.parts.forEach((p, i) => {
      const part = scene.parts[i]!;
      const idle = isPose(part) ? part.idle : undefined;
      if (p.idle) p.beat.classList.remove(p.idle);
      p.idle = null;
      if (!idle) return;
      const cls = s[idle.kind]!;
      p.beat.style.transition = "";
      p.beat.style.transform = "";
      p.beat.style.opacity = "";
      p.beat.style.transformOrigin = this.originFor(p, idle);
      p.beat.style.animationDelay = `${(idle.offset ?? 0).toFixed(3)}s`;
      void p.beat.getBoundingClientRect();
      p.beat.classList.add(cls);
      p.idle = cls;
    });
  }

  /** A loop-only part (a ping, a halo) stays invisible whenever its loop isn't running. */
  private markLoopOnly(scene: Scene) {
    this.parts.forEach((p, i) => {
      const part = scene.parts[i]!;
      p.beat.classList.toggle(s.loopOnly!, Boolean(isPose(part) && part.idle && LOOP_ONLY.has(part.idle.kind)));
    });
  }

  private originFor(p: Part, idle: Idle) {
    if (idle.origin === "bottom") return "50% 100%";
    if (!idle.origin) return "";
    // A shared pivot, in the part's own box (the kit's canvas measures transforms by fill-box).
    const box = p.path.getBBox();
    return `${(idle.origin[0] - box.x).toFixed(2)}px ${(idle.origin[1] - box.y).toFixed(2)}px`;
  }

  /** Stop the loops. A part caught mid-beat eases home from where it was rather than jumping. */
  private homeIdles(instant = false) {
    const caught: [Part, string, string][] = [];
    this.parts.forEach((p) => {
      if (!p.idle) return;
      const was = p.pose?.idle;
      if (was && LOOP_ONLY.has(was.kind)) {
        // Only ever seen mid-loop (a ping, a halo): whatever showed becomes its own opacity, so it leaves from there.
        p.op *= parseFloat(getComputedStyle(p.beat).opacity) || 0;
        p.wrap.style.opacity = String(p.op);
      } else if (!instant) {
        const cs = getComputedStyle(p.beat);
        caught.push([p, cs.transform, cs.opacity]);
      }
      p.beat.classList.remove(p.idle);
      p.beat.style.animationDelay = "";
      p.idle = null;
    });
    for (const [p, transform, opacity] of caught) {
      p.beat.style.transition = "none";
      p.beat.style.transform = transform === "none" ? "" : transform;
      p.beat.style.opacity = opacity;
    }
    if (caught.length) void this.svg.getBoundingClientRect();
    for (const [p] of caught) {
      p.beat.style.transition = `transform ${HOME}ms ${EASE.unfold}, opacity ${HOME}ms linear`;
      p.beat.style.transform = "";
      p.beat.style.opacity = "";
    }
  }

  /* ---- the stage: garnish and the count ---- */

  private stageOn() {
    this.svg.dataset.stage = "on";
    window.clearInterval(this.countTimer);
    if (this.reduced) return;
    const counts = Array.from(this.svg.querySelectorAll<SVGTextElement>("[data-count]"));
    if (!counts.length) return;
    this.countTimer = window.setInterval(() => {
      if (this.svg.dataset.paused === "true") return;
      for (const el of counts) {
        if (Math.random() < 0.25) continue;
        const now = Number(el.dataset.now ?? el.dataset.count);
        const next = now + 1 + Math.floor(Math.random() * Number(el.dataset.step ?? 3));
        el.dataset.now = String(next);
        el.textContent = next.toLocaleString("en-US") + (el.dataset.suffix ?? "");
        el.animate([{ transform: "translateY(2.5px)", opacity: 0.35 }, { transform: "none", opacity: 1 }], { duration: 360, easing: EASE.unfold });
      }
    }, TICK_MS);
  }

  private stageOff() {
    this.svg.dataset.stage = "off";
    window.clearInterval(this.countTimer);
    for (const el of Array.from(this.svg.querySelectorAll<SVGTextElement>("[data-count]"))) {
      delete el.dataset.now;
      el.textContent = Number(el.dataset.count).toLocaleString("en-US") + (el.dataset.suffix ?? "");
    }
  }

  private onReduce = () => {
    this.reduced = Boolean(this.mq?.matches);
    if (this.reduced) {
      window.clearInterval(this.countTimer);
      this.still();
      return;
    }
    this.cut(this.active ? this.last : 0);
    if (this.active) {
      this.startIdles();
      this.stageOn();
    } else this.stageOff();
  };

  private onVisibility = () => {
    const paused = !this.active || !this.seen;
    this.svg.dataset.paused = String(paused);
    if (this.pending && this.active && this.seen && !this.reduced) this.play();
  };
}
