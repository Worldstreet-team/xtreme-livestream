"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Ground } from "@/components/app/art/primitives";
import kit from "@/components/app/art/primitives.module.css";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { align, center, easeFrom, extent, lerpInto, point, SEGS, toPath, type Outline } from "./tour-art-morph";
import { ACTORS, EARLY, isPose, LOOP_ONLY, PAINTS, sceneOf, type Idle, type PaintName, type Pose, type Scene, type TourScene } from "./tour-art-scenes";
import s from "./tour-art.module.css";

export { TOUR_SCENES, type TourScene } from "./tour-art-scenes";

/**
 * The walkthrough's one drawn object. Every step shows the same twelve
 * parts; when `scene` changes they travel, reshape and recolour into the
 * next scene in a staggered morph (the play mark becomes a phone, the
 * phone's screen the lit ring, the LIVE tag the gift's ribbon…), then the
 * scene keeps a small beat of life at rest.
 *
 * Keep ONE mounted across steps and change `scene`: remounting replays the
 * entrance (the parts gathering out of the middle) instead of morphing.
 *
 * - Shapes and scenes: ./tour-art-morph.ts, ./tour-art-scenes.ts.
 * - The driver below writes each part's `d`, paint and opacity on
 *   requestAnimationFrame only while a morph runs; nothing ticks at rest.
 * - Idle beats are CSS loops on each part's middle <g>, paused off screen
 *   and in hidden tabs (the kit's `data-paused`).
 * - Reduced motion: no morph and no loops, a short crossfade between still
 *   scenes.
 * - Decorative: hidden from assistive tech (the step's words say it).
 */
export function TourArt({
  scene,
  className,
  tempo = 1,
  enter = true,
}: {
  scene: TourScene;
  className?: string;
  /** Stretch every morph (2 = half speed). 1 in the product; the dev gallery slows it down to study frames. */
  tempo?: number;
  /** Gather the parts out of the middle on mount (default). False shows the first scene still. */
  enter?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const probes = useRef<SVGGElement>(null);
  const driver = useRef<Driver | null>(null);
  // The first scene is drawn by React (and on the server); after that the driver owns every part.
  const [first] = useState(() => sceneOf(scene));
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;

  useLayoutEffect(() => {
    const d = new Driver(svg.current!, layer.current!, probes.current!, first, () => tempoRef.current);
    driver.current = d;
    if (enter) d.enter();
    return () => {
      d.destroy();
      driver.current = null;
    };
    // Mount only: the driver follows `scene` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    driver.current?.go(scene);
  }, [scene]);

  return (
    <svg ref={svg} viewBox="20 10 200 160" aria-hidden focusable="false" className={cn(kit.canvas, className)} data-scene={scene}>
      <Ground />
      <g ref={layer}>
        {ACTORS.map((id, i) => {
          const part = first.parts[i]!;
          const pose = isPose(part) ? part : null;
          return (
            <g key={id} data-part={id} style={{ opacity: pose ? (pose.opacity ?? 1) : 0 }}>
              <g>
                <path className={cn(s.shape, s[pose?.paint ?? "card"])} d={toPath(isPose(part) ? part.d : point(...part.fold))} />
              </g>
            </g>
          );
        })}
      </g>
      {/* One swatch per paint, never shown: the driver reads their computed colours to blend between paints. */}
      <g ref={probes} style={{ display: "none" }}>
        {PAINTS.map((p) => (
          <path key={p} data-paint={p} className={cn(s.shape, s[p])} d="M0 0" />
        ))}
      </g>
    </svg>
  );
}

/* ---- the driver --------------------------------------------------------------------- */

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
};

const MORPH = easeFrom(EASE.morph);
const SETTLE = easeFrom(EASE.morphSettle);
/** Parts smaller than this (box diagonal, user units) land with the overshoot. */
const SMALL = 46;
/** A loop that was mid-beat when the scene changed eases home over this long. */
const HOME = 320;

const idleClass = (idle: Idle) => s[idle.kind] ?? "";

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
  private sceneNow: Scene;
  private looks = {} as Record<PaintName, Look>;
  private raf = 0;
  private restTimer = 0;
  private t0 = 0;
  private total = 0;
  private reordered = true;
  private reduced: boolean;
  private readonly mq: MediaQueryList | null;
  private readonly io: IntersectionObserver | null;
  private offscreen = false;

  constructor(
    private readonly svg: SVGSVGElement,
    private readonly layer: SVGGElement,
    private readonly probes: SVGGElement,
    first: Scene,
    private readonly tempo: () => number,
  ) {
    this.sceneNow = first;
    this.readLooks();
    const wraps = Array.from(layer.children) as SVGGElement[];
    this.parts = wraps.map((wrap, i) => {
      const beat = wrap.firstElementChild as SVGGElement;
      const path = beat.firstElementChild as SVGPathElement;
      const part = first.parts[i]!;
      const pose = isPose(part) ? part : null;
      const d = isPose(part) ? part.d : point(...part.fold);
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
        idle: null, pose,
      };
    });
    this.mq = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.reduced = Boolean(this.mq?.matches);
    this.reorder(first.z);
    this.mq?.addEventListener("change", this.onReduce);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            this.offscreen = entry ? !entry.isIntersecting : false;
            this.onVisibility();
          });
    this.io?.observe(svg);
    this.applyRestOpacity();
    this.startIdles(true);
    this.startIdles(false);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.restTimer);
    this.mq?.removeEventListener("change", this.onReduce);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.io?.disconnect();
  }

  /** The entrance: every part gathers out of the scene's focus. */
  enter() {
    if (this.reduced) {
      this.layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.fade * 2, easing: "linear" });
      return;
    }
    const [fx, fy] = this.sceneNow.focus;
    for (const p of this.parts) {
      p.cur = point(fx, fy);
      p.op = 0;
      p.shown = false;
      p.wrap.style.opacity = "0";
      p.path.setAttribute("d", toPath(p.cur));
    }
    this.go(this.sceneNow, true);
  }

  go(target: TourScene | Scene, force = false) {
    const next = typeof target === "string" ? sceneOf(target) : target;
    if (next === this.sceneNow && !force) return;
    this.sceneNow = next;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.restTimer);
    this.readLooks();
    if (this.reduced) {
      this.cut(next, !force);
      return;
    }
    this.homeIdles(next);

    const D = DURATION.morph * this.tempo();
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
      if (p.op < 0.05) {
        // Arriving unseen (from a fold, or a loop that hid it): it grows out of
        // a point where it was, already in its new paint.
        const [x, y] = center(p.cur);
        p.from = point(x, y);
        p.lookFrom = p.look = this.looks[part.paint];
      }
      p.to = align(p.from, part.d, this.looks[part.paint].dash[1] > 0 ? [0, SEGS / 2] : undefined);
      p.lookTo = this.looks[part.paint];
      this.setPaint(p, part.paint);
      p.opTo = this.restOpacity(part);
      p.shown = true;
      p.ease = extent(part.d) < SMALL ? SETTLE : MORPH;
      const [cx, cy] = center(part.d);
      movers.push({ p, dist: Math.hypot(cx - next.focus[0], cy - next.focus[1]) });
    });

    // Nearest the focus moves first: the change ripples out from where it starts.
    movers.sort((a, b) => a.dist - b.dist);
    const gap = Math.min(DURATION.morphStagger, DURATION.morphSpan / Math.max(1, movers.length - 1)) * this.tempo();
    movers.forEach(({ p }, k) => {
      p.delay = k * gap;
      p.dur = D;
    });
    this.total = D + gap * Math.max(0, movers.length - 1);
    this.t0 = performance.now();
    this.reordered = false;
    this.startIdles(true);
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
      this.reorder(this.sceneNow.z);
    }
    if (running) this.raf = requestAnimationFrame(this.tick);
    else {
      if (!this.reordered) this.reorder(this.sceneNow.z);
      this.reordered = true;
      this.restTimer = window.setTimeout(() => this.startIdles(false), 80);
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

  /** Reduced motion: the new scene, still, crossfaded over the old. */
  private cut(next: Scene, fade: boolean) {
    this.homeIdles(next, true);
    if (fade) {
      const ghost = this.layer.cloneNode(true) as SVGGElement;
      this.layer.after(ghost);
      const dur = DURATION.fade + 60;
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "linear" }).onfinish = () => ghost.remove();
      this.layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, easing: "linear" });
    }
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
      p.op = p.opTo = isPose(part) ? this.restOpacity(part) : 0;
      p.wrap.style.opacity = String(p.op);
      p.path.style.fill = p.path.style.stroke = p.path.style.strokeWidth = p.path.style.strokeDasharray = "";
    });
    this.reorder(next.z);
  }

  private restOpacity(pose: Pose) {
    if (this.reduced && pose.idle && LOOP_ONLY.has(pose.idle.kind)) return 0;
    return pose.opacity ?? 1;
  }

  private applyRestOpacity() {
    for (const p of this.parts) {
      if (!p.pose) continue;
      p.op = p.opTo = this.restOpacity(p.pose);
      p.wrap.style.opacity = String(p.op);
    }
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
    st.stroke = css(p.look.stroke);
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

  /** Paint order, bottom to top. Moving nodes restarts their CSS loops, so the loops restart together after. */
  private reorder(z: number[]) {
    const now = Array.from(this.layer.children);
    if (z.every((i, k) => now[k] === this.parts[i]!.wrap)) return;
    const move = (this.layer as unknown as { moveBefore?: (n: Node, ref: Node | null) => void }).moveBefore;
    for (const i of z) {
      const el = this.parts[i]!.wrap;
      if (typeof move === "function") move.call(this.layer, el, null);
      else this.layer.appendChild(el);
    }
    if (typeof move !== "function") this.startIdles(true);
  }

  /**
   * Start the scene's loops. `early` ones start now on a shared clock,
   * holding their first frame until the morph lands; the rest start at rest.
   */
  private startIdles(early: boolean) {
    if (this.reduced) return;
    const lead = early ? Math.max(0, this.total - (performance.now() - this.t0)) / 1000 + 0.1 : 0;
    for (const p of this.parts) {
      const idle = p.pose?.idle;
      if (!idle || EARLY.has(idle.kind) !== early) continue;
      const cls = idleClass(idle);
      if (p.idle) p.beat.classList.remove(p.idle);
      p.beat.style.transition = "";
      p.beat.style.transform = "";
      p.beat.style.opacity = "";
      p.beat.style.transformOrigin = this.originFor(p, idle);
      p.beat.style.animationDelay = `${(lead + (idle.offset ?? 0)).toFixed(3)}s`;
      // Re-adding the class restarts the loop, so parts that share one stay in step.
      void p.beat.getBoundingClientRect();
      p.beat.classList.add(cls);
      p.idle = cls;
    }
  }

  private originFor(p: Part, idle: Idle) {
    if (idle.origin === "bottom") return "50% 100%";
    if (!idle.origin) return "";
    // A shared pivot, in the part's own box (the kit's canvas measures transforms by fill-box).
    const box = p.path.getBBox();
    return `${(idle.origin[0] - box.x).toFixed(2)}px ${(idle.origin[1] - box.y).toFixed(2)}px`;
  }

  /**
   * Stop the old scene's loops. A part caught mid-beat eases home from
   * where it was rather than jumping, unless its next loop starts at once.
   */
  private homeIdles(next: Scene, instant = false) {
    const caught: [Part, string, string][] = [];
    this.parts.forEach((p, i) => {
      if (!p.idle) return;
      const part = next.parts[i]!;
      const nextEarly = isPose(part) && part.idle && EARLY.has(part.idle.kind);
      const was = p.pose?.idle;
      if (was && LOOP_ONLY.has(was.kind)) {
        // Only ever seen mid-loop (a ping, the 2 and the 1): whatever showed of it
        // becomes the part's own opacity, so it leaves from there, not from full.
        p.op *= parseFloat(getComputedStyle(p.beat).opacity) || 0;
        p.wrap.style.opacity = String(p.op);
      } else if (!instant && !nextEarly) {
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

  private onReduce = () => {
    this.reduced = Boolean(this.mq?.matches);
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.restTimer);
    this.total = 0;
    this.cut(this.sceneNow, false);
    this.startIdles(true);
    this.startIdles(false);
  };

  private onVisibility = () => {
    this.svg.dataset.paused = String(this.offscreen || document.hidden);
  };
}
