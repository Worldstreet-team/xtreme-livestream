"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  align,
  blade,
  center,
  circle,
  crown,
  easeFrom,
  lerpInto,
  line,
  Pen,
  point,
  rrect,
  sparkle,
  stroke,
  toPath,
  type Outline,
  type Pt,
} from "./emblem-geometry";
import s from "./clash-emblem.module.css";

/**
 * The battle's emblem: one drawn object that becomes the moment.
 *
 *   vs      the V and the S, heavy and leaning in
 *   clash   the two letters become two crossed blades — Chili from the
 *           host's side, Ember from the challenger's — over a burst ring
 *           and a spark where they meet (a big gift, a lead change)
 *   crown   the blades fold into the winner's crown, in their colour
 *   clock   a booked battle: a clean face whose hand ticks round
 *
 * The morphing-svg-art technique: a fixed cast of five parts, each one
 * closed outline of 24 cubics in every pose, interpolated point-wise on a
 * rAF driver that runs only while a morph does, staggered out from the
 * centre, with paint blended between token classes. Keep one mounted and
 * change `scene`. Reduced motion: a short crossfade, no loops.
 * Decorative: the words around it carry the meaning.
 */

export type EmblemScene = "vs" | "clash" | "crown-host" | "crown-challenger" | "clock";

const PAINTS = ["disc", "burst", "ink", "chili", "ember", "spark", "face", "hand", "handHot"] as const;
type PaintName = (typeof PAINTS)[number];
type Idle = "tick" | "bob" | "wink";
type Pose = { d: Outline; paint: PaintName; idle?: Idle; opacity?: number };
type Part = Pose | { fold: Pt };
type Scene = { parts: [Part, Part, Part, Part, Part]; ease: "clash" | "morph"; dur: number };

const C: Pt = [50, 50];
const isPose = (p: Part): p is Pose => "d" in p;

/** Lean a glyph like heavy italic type. */
const lean = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [x - (y - 50) * 0.2, y] as const);

function letterS(): Outline {
  const q = lean([
    [75, 40], [73, 36.5], [69, 35], [64, 35],
    [58, 35], [54.5, 38], [54.5, 42.5],
    [54.5, 47.5], [59.5, 49], [64.5, 50],
    [70, 51], [75.5, 53], [75.5, 57.5],
    [75.5, 62.5], [71, 65], [65, 65],
    [59.5, 65], [55.5, 63], [53.5, 59.5],
  ]);
  const p = new Pen(q[0]![0], q[0]![1]);
  for (let i = 1; i + 2 < q.length; i += 3) p.c(q[i]![0], q[i]![1], q[i + 1]![0], q[i + 1]![1], q[i + 2]![0], q[i + 2]![1]);
  return stroke(p.open());
}

const SCENES: Record<EmblemScene, Scene> = {
  vs: {
    ease: "morph",
    dur: 520,
    parts: [
      { d: circle(50, 50, 38), paint: "disc" },
      { d: line(...lean([[25, 36], [35.5, 64], [46, 36]])), paint: "ink" },
      { d: letterS(), paint: "ink" },
      { fold: C },
      { fold: C },
    ],
  },
  clash: {
    ease: "clash",
    dur: 380,
    parts: [
      { d: circle(50, 50, 46), paint: "burst" },
      { d: blade([18, 20], [82, 80], 7.5), paint: "chili" },
      { d: blade([82, 20], [18, 80], 7.5), paint: "ember" },
      { d: sparkle(50, 50, 13), paint: "spark" },
      { d: sparkle(80, 50, 5), paint: "spark" },
    ],
  },
  "crown-host": {
    ease: "morph",
    dur: 620,
    parts: [
      { d: circle(50, 52, 38), paint: "disc" },
      { d: crown(50, 63, 50, 30), paint: "chili", idle: "bob" },
      { d: rrect(27, 67, 46, 7.5, 3.75), paint: "chili", idle: "bob" },
      { d: sparkle(22, 30, 5.5), paint: "spark", idle: "wink" },
      { d: sparkle(79, 24, 7), paint: "spark", idle: "wink" },
    ],
  },
  "crown-challenger": {
    ease: "morph",
    dur: 620,
    parts: [
      { d: circle(50, 52, 38), paint: "disc" },
      { d: crown(50, 63, 50, 30), paint: "ember", idle: "bob" },
      { d: rrect(27, 67, 46, 7.5, 3.75), paint: "ember", idle: "bob" },
      { d: sparkle(22, 30, 5.5), paint: "spark", idle: "wink" },
      { d: sparkle(79, 24, 7), paint: "spark", idle: "wink" },
    ],
  },
  clock: {
    ease: "morph",
    dur: 620,
    parts: [
      { d: circle(50, 50, 33), paint: "face" },
      { d: line([50, 50], [38, 41]), paint: "hand" },
      { d: line([50, 50], [50, 25]), paint: "handHot", idle: "tick" },
      { d: circle(50, 50, 3.6), paint: "spark" },
      { fold: C },
    ],
  },
};

export function ClashEmblem({ scene, className }: { scene: EmblemScene; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const probes = useRef<SVGGElement>(null);
  const driver = useRef<Driver | null>(null);
  const [first] = useState(() => SCENES[scene] ?? SCENES.vs);

  useLayoutEffect(() => {
    const d = new Driver(svg.current!, layer.current!, probes.current!, first);
    driver.current = d;
    return () => {
      d.destroy();
      driver.current = null;
    };
    // Mount only: the driver follows `scene` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    driver.current?.go(SCENES[scene] ?? SCENES.vs);
  }, [scene]);

  return (
    <svg ref={svg} viewBox="0 0 100 100" aria-hidden focusable="false" className={cn(s.canvas, className)}>
      <g ref={layer}>
        {first.parts.map((part, i) => (
          <g key={i} style={{ opacity: isPose(part) ? (part.opacity ?? 1) : 0 }}>
            <g>
              <path className={cn(s.shape, s[isPose(part) ? part.paint : "spark"])} d={toPath(isPose(part) ? part.d : point(...part.fold))} />
            </g>
          </g>
        ))}
      </g>
      <g ref={probes} style={{ display: "none" }}>
        {PAINTS.map((p) => (
          <path key={p} data-paint={p} className={cn(s.shape, s[p])} d="M0 0" />
        ))}
      </g>
    </svg>
  );
}

/* ---- the driver ------------------------------------------------------------ */

type RGBA = [number, number, number, number];
type Look = { fill: RGBA; stroke: RGBA; width: number };
type Live = {
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
  delay: number;
  done: boolean;
  idle: Idle | null;
};

const EASES = { clash: easeFrom(EASE.clash), morph: easeFrom(EASE.morph) };
const PAINT_EASE = easeFrom(EASE.morph);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

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
  const al = a[3] + (b[3] - a[3]) * t;
  if (al < 1e-4) return [0, 0, 0, 0];
  const ch = (i: number) => (a[i]! * a[3] + (b[i]! * b[3] - a[i]! * a[3]) * t) / al;
  return [ch(0), ch(1), ch(2), al];
}

const css = (c: RGBA) => `rgb(${(c[0] * 255).toFixed(1)} ${(c[1] * 255).toFixed(1)} ${(c[2] * 255).toFixed(1)} / ${c[3].toFixed(3)})`;

class Driver {
  private parts: Live[];
  private now: Scene;
  private looks = {} as Record<PaintName, Look>;
  private raf = 0;
  private t0 = 0;
  private dur = 0;
  private ease = EASES.morph;
  private reduced: boolean;
  private readonly io: IntersectionObserver | null;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly layer: SVGGElement,
    private readonly probes: SVGGElement,
    first: Scene,
  ) {
    this.now = first;
    this.reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.readLooks();
    this.parts = (Array.from(layer.children) as SVGGElement[]).map((wrap, i) => {
      const beat = wrap.firstElementChild as SVGGElement;
      const path = beat.firstElementChild as SVGPathElement;
      const part = first.parts[i]!;
      const d = isPose(part) ? part.d : point(...part.fold);
      const paint: PaintName = isPose(part) ? part.paint : "spark";
      const look = this.looks[paint];
      const op = isPose(part) ? (part.opacity ?? 1) : 0;
      return { wrap, beat, path, cur: d.slice(), from: d, to: d, look, lookFrom: look, lookTo: look, paint, op, opFrom: op, opTo: op, delay: 0, done: true, idle: null };
    });
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([e]) => {
            this.svg.dataset.paused = String(e ? !e.isIntersecting : false);
          });
    this.io?.observe(svg);
    this.startIdles();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
  }

  go(next: Scene) {
    if (next === this.now) return;
    this.now = next;
    cancelAnimationFrame(this.raf);
    this.readLooks();
    this.stopIdles();
    if (this.reduced) {
      this.cut(next);
      return;
    }
    this.dur = next.dur;
    this.ease = EASES[next.ease];
    const movers: { p: Live; dist: number }[] = [];
    next.parts.forEach((part, i) => {
      const p = this.parts[i]!;
      p.from = p.cur.slice();
      p.lookFrom = p.look;
      p.opFrom = p.op;
      p.done = false;
      if (!isPose(part)) {
        p.to = point(...part.fold);
        p.lookTo = p.look;
        p.opTo = 0;
        p.delay = 0;
        return;
      }
      if (p.op < 0.05) {
        // Arriving unseen: it grows out of a point where it was, already in its paint.
        const [x, y] = center(p.cur);
        p.from = point(x, y);
        p.lookFrom = p.look = this.looks[part.paint];
      }
      p.to = align(p.from, part.d);
      p.lookTo = this.looks[part.paint];
      this.setPaint(p, part.paint);
      p.opTo = part.opacity ?? 1;
      const [cx, cy] = center(part.d);
      movers.push({ p, dist: Math.hypot(cx - 50, cy - 50) });
    });
    // Nearest the middle first: the change ripples outward from the hit.
    movers.sort((a, b) => a.dist - b.dist);
    const gap = Math.min(DURATION.morphStagger, DURATION.morphSpan / Math.max(1, movers.length - 1));
    movers.forEach(({ p }, k) => (p.delay = k * gap));
    this.t0 = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    let running = false;
    for (const p of this.parts) {
      if (p.done) continue;
      const t = clamp01((now - this.t0 - p.delay) / this.dur);
      lerpInto(p.cur, p.from, p.to, this.ease(t));
      p.path.setAttribute("d", toPath(p.cur));
      const c = PAINT_EASE(t);
      p.look = {
        fill: mixColor(p.lookFrom.fill, p.lookTo.fill, c),
        stroke: mixColor(p.lookFrom.stroke, p.lookTo.stroke, c),
        width: p.lookFrom.width + (p.lookTo.width - p.lookFrom.width) * c,
      };
      const st = p.path.style;
      st.fill = css(p.look.fill);
      st.stroke = css(p.look.stroke);
      st.strokeWidth = String(p.look.width);
      const o = p.opTo > p.opFrom ? PAINT_EASE(clamp01(t / 0.5)) : PAINT_EASE(clamp01(t / 0.4));
      p.op = p.opFrom + (p.opTo - p.opFrom) * o;
      p.wrap.style.opacity = String(Math.round(p.op * 1000) / 1000);
      if (t >= 1) this.settle(p);
      else running = true;
    }
    if (running) this.raf = requestAnimationFrame(this.tick);
    else this.startIdles();
  };

  private settle(p: Live) {
    p.done = true;
    p.cur = p.to.slice();
    p.path.setAttribute("d", toPath(p.cur));
    p.look = p.lookTo;
    p.op = p.opTo;
    p.wrap.style.opacity = String(p.opTo);
    p.path.style.fill = p.path.style.stroke = p.path.style.strokeWidth = "";
  }

  private cut(next: Scene) {
    this.layer.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: DURATION.fade + 60, easing: "linear" });
    next.parts.forEach((part, i) => {
      const p = this.parts[i]!;
      p.cur = isPose(part) ? part.d.slice() : point(...part.fold);
      p.path.setAttribute("d", toPath(p.cur));
      if (isPose(part)) {
        this.setPaint(p, part.paint);
        p.look = p.lookTo = this.looks[part.paint];
      }
      p.done = true;
      p.op = p.opTo = isPose(part) ? (part.opacity ?? 1) : 0;
      p.wrap.style.opacity = String(p.op);
      p.path.style.fill = p.path.style.stroke = p.path.style.strokeWidth = "";
    });
  }

  private setPaint(p: Live, paint: PaintName) {
    if (p.paint === paint) return;
    p.path.classList.remove(s[p.paint]!);
    p.path.classList.add(s[paint]!);
    p.paint = paint;
  }

  private readLooks() {
    for (const el of Array.from(this.probes.children) as SVGPathElement[]) {
      const cs = getComputedStyle(el);
      this.looks[el.dataset.paint as PaintName] = { fill: parseColor(cs.fill), stroke: parseColor(cs.stroke), width: parseFloat(cs.strokeWidth) || 0 };
    }
  }

  private stopIdles() {
    for (const p of this.parts) {
      if (!p.idle) continue;
      p.beat.classList.remove(s[p.idle]!);
      p.idle = null;
    }
  }

  private startIdles() {
    if (this.reduced) return;
    this.now.parts.forEach((part, i) => {
      const p = this.parts[i]!;
      if (!isPose(part) || !part.idle || p.idle === part.idle) return;
      if (part.idle === "wink") {
        const [x, y] = center(part.d);
        p.beat.style.transformOrigin = `${x}px ${y}px`;
        p.beat.style.animationDelay = `${i * 0.35}s`;
      }
      p.beat.classList.add(s[part.idle]!);
      p.idle = part.idle;
    });
  }
}
