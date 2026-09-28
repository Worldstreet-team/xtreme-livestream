/**
 * The shared engine of the landing's page transition: easing, the outline
 * geometry (after the morphing-svg-art skill: every part one closed outline
 * of the same number of cubics, interpolated point-wise), the word layout,
 * the loading dots' bounce, and the helpers the five samples draw their
 * scenery and exit pieces with. Ported from the transition lookbook; the
 * samples themselves are in transition-samples.ts, the driver in
 * page-transition.tsx.
 */

import { CAP, GLYPHS, TRACK, WORD } from "./transition-outlines";

/* ---------- easing ---------- */

export type Ease = (x: number) => number;

export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1,
    bx = 3 * (x2 - x1) - cx,
    ax = 1 - cx - bx;
  const cy = 3 * y1,
    by = 3 * (y2 - y1) - cy,
    ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0,
      hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const EZ = {
  morph: cubicBezier(0.7, 0, 0.16, 1), // the skill's travel curve
  settle: cubicBezier(0.62, 0, 0.22, 1.28), // the skill's landing curve, ~5% overshoot
  pop: cubicBezier(0.5, 0, 0.2, 1.45),
  out: cubicBezier(0.16, 1, 0.3, 1),
  inout: cubicBezier(0.65, 0, 0.35, 1),
};

/** Camera.js's easeInOutExpo, for every exit piece. */
export const CSS_EXPO = "cubic-bezier(0.87, 0, 0.13, 1)";

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* ---------- outlines ---------- */

/** One cubic: [x0, y0, c1x, c1y, c2x, c2y, x, y]. */
type Cubic = number[];
/** An outline: n cubics packed as [c1x, c1y, c2x, c2y, x, y] × n (each starts where the last ends). */
export type Outline = Float64Array;

export const N_OUT = 48;
export const N_IN = 24;

class Pen {
  cubics: Cubic[] = [];
  x: number;
  y: number;
  sx: number;
  sy: number;
  constructor(x: number, y: number) {
    this.x = this.sx = x;
    this.y = this.sy = y;
  }
  to(x: number, y: number) {
    if (Math.hypot(x - this.x, y - this.y) < 1e-6) return this;
    const x0 = this.x,
      y0 = this.y;
    this.cubics.push([x0, y0, x0 + (x - x0) / 3, y0 + (y - y0) / 3, x0 + ((x - x0) * 2) / 3, y0 + ((y - y0) * 2) / 3, x, y]);
    this.x = x;
    this.y = y;
    return this;
  }
  c(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    this.cubics.push([this.x, this.y, c1x, c1y, c2x, c2y, x, y]);
    this.x = x;
    this.y = y;
    return this;
  }
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
    const rad = (d: number) => (d * Math.PI) / 180;
    if (rx < 1e-6 || ry < 1e-6 || Math.abs(a1 - a0) < 1e-6) return this;
    this.to(cx + rx * Math.cos(rad(a0)), cy + ry * Math.sin(rad(a0)));
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90 - 1e-9));
    const step = rad((a1 - a0) / n),
      k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const t0 = rad(a0) + i * step,
        t1 = t0 + step;
      const x1 = cx + rx * Math.cos(t1),
        y1 = cy + ry * Math.sin(t1);
      this.c(this.x - k * rx * Math.sin(t0), this.y + k * ry * Math.cos(t0), x1 + k * rx * Math.sin(t1), y1 - k * ry * Math.cos(t1), x1, y1);
    }
    return this;
  }
  close() {
    this.to(this.sx, this.sy);
    return this.cubics;
  }
}

function cubicAt(c: Cubic, t: number) {
  const u = 1 - t,
    a = u * u * u,
    b = 3 * u * u * t,
    d = 3 * u * t * t,
    e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
}
function cubicLength(c: Cubic) {
  let len = 0,
    px = c[0],
    py = c[1];
  for (let i = 1; i <= 12; i++) {
    const [x, y] = cubicAt(c, i / 12);
    len += Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  return len;
}
function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  const split = (q: Cubic, t: number): [Cubic, Cubic] => {
    const l = (a: number, b: number) => a + (b - a) * t;
    const ax = l(q[0], q[2]),
      ay = l(q[1], q[3]),
      bx = l(q[2], q[4]),
      by = l(q[3], q[5]),
      cx = l(q[4], q[6]),
      cy = l(q[5], q[7]);
    const dx = l(ax, bx),
      dy = l(ay, by),
      ex = l(bx, cx),
      ey = l(by, cy),
      fx = l(dx, ex),
      fy = l(dy, ey);
    return [
      [q[0], q[1], ax, ay, dx, dy, fx, fy],
      [fx, fy, ex, ey, cx, cy, q[6], q[7]],
    ];
  };
  let q = c;
  if (t0 > 0) q = split(q, t0)[1];
  if (t1 < 1) q = split(q, (t1 - t0) / (1 - t0))[0];
  return q;
}
/** Resample to exactly n cubics, splitting the longest pieces first so points sit evenly along the edge. */
function resample(cubics: Cubic[], n: number) {
  if (cubics.length > n) throw new Error("shape has " + cubics.length + " pieces, more than " + n);
  const len = cubics.map(cubicLength),
    count = cubics.map(() => 1);
  for (let left = n - cubics.length; left > 0; left--) {
    let best = 0;
    for (let i = 1; i < cubics.length; i++) if (len[i] / count[i] > len[best] / count[best]) best = i;
    count[best]++;
  }
  const out: Cubic[] = [];
  cubics.forEach((c, i) => {
    const k = count[i];
    for (let j = 0; j < k; j++) out.push(k === 1 ? c : subCubic(c, j / k, (j + 1) / k));
  });
  return out;
}
function pack(cubics: Cubic[]): Outline {
  const o = new Float64Array(cubics.length * 6);
  cubics.forEach((c, i) => o.set([c[2], c[3], c[4], c[5], c[6], c[7]], i * 6));
  return o;
}
const outline = (cubics: Cubic[], n = N_OUT) => pack(resample(cubics, n));

export function point(x: number, y: number, n = N_OUT): Outline {
  const o = new Float64Array(n * 6);
  for (let i = 0; i < o.length; i += 2) {
    o[i] = x;
    o[i + 1] = y;
  }
  return o;
}
function signedArea(cubics: Cubic[]) {
  let a = 0;
  for (const c of cubics) a += c[0] * c[7] - c[6] * c[1];
  return a / 2;
}
function reverseCubics(cs: Cubic[]): Cubic[] {
  return cs
    .slice()
    .reverse()
    .map((c) => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]]);
}
function center(o: Outline): [number, number] {
  let x = 0,
    y = 0;
  const n = o.length / 6;
  for (let i = 0; i < n; i++) {
    x += o[i * 6 + 4];
    y += o[i * 6 + 5];
  }
  return [x / n, y / n];
}
export type Box = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; w: number; h: number };
function box(o: Outline): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (let i = 0; i < o.length; i += 2) {
    x0 = Math.min(x0, o[i]);
    x1 = Math.max(x1, o[i]);
    y0 = Math.min(y0, o[i + 1]);
    y1 = Math.max(y1, o[i + 1]);
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
/** Rotate the target's start segment to the one that travels least from `from`, so shapes don't twist. */
export function align(from: Outline, to: Outline): Outline {
  const n = to.length / 6;
  let best = 0,
    bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    let cost = 0;
    for (let i = 0; i < n && cost < bestCost; i++) {
      const a = i * 6 + 4,
        b = ((i + k) % n) * 6 + 4,
        dx = from[a] - to[b],
        dy = from[a + 1] - to[b + 1];
      cost += dx * dx + dy * dy;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = k;
    }
  }
  if (best === 0) return to;
  const out = new Float64Array(to.length);
  for (let i = 0; i < n; i++) {
    const j = ((i + best) % n) * 6;
    out.set(to.subarray(j, j + 6), i * 6);
  }
  return out;
}
export function lerpInto(out: Float64Array, a: ArrayLike<number>, b: ArrayLike<number>, e: number) {
  for (let i = 0; i < out.length; i++) out[i] = a[i] + (b[i] - a[i]) * e;
}
export const r1 = (v: number) => Math.round(v * 10) / 10;
export function toPath(o: Outline) {
  const n = o.length / 6;
  let d = "M" + r1(o[n * 6 - 2]) + " " + r1(o[n * 6 - 1]);
  for (let i = 0; i < n; i++) {
    const j = i * 6;
    d += "C" + r1(o[j]) + " " + r1(o[j + 1]) + " " + r1(o[j + 2]) + " " + r1(o[j + 3]) + " " + r1(o[j + 4]) + " " + r1(o[j + 5]);
  }
  return d + "Z";
}
export const circle = (cx: number, cy: number, r: number, n = N_OUT) => outline(new Pen(cx, cy - r).arc(cx, cy, r, r, -90, 270).close(), n);
export function rrect(x: number, y: number, w: number, h: number, r: number, n = N_OUT) {
  r = Math.min(r, w / 2, h / 2);
  const p = new Pen(x + r, y);
  p.to(x + w - r, y).arc(x + w - r, y + r, r, r, -90, 0);
  p.to(x + w, y + h - r).arc(x + w - r, y + h - r, r, r, 0, 90);
  p.to(x + r, y + h).arc(x + r, y + h - r, r, r, 90, 180);
  p.to(x, y + r).arc(x + r, y + r, r, r, 180, 270);
  return outline(p.close(), n);
}
export function roundPoly(pts: [number, number][], rad: number, n = N_OUT) {
  const m = pts.length;
  const corner = pts.map((v, i) => {
    const p = pts[(i + m - 1) % m],
      q = pts[(i + 1) % m];
    const lp = Math.hypot(p[0] - v[0], p[1] - v[1]),
      lq = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const rr = Math.min(rad, lp / 2, lq / 2);
    return {
      v,
      a: [v[0] + ((p[0] - v[0]) / lp) * rr, v[1] + ((p[1] - v[1]) / lp) * rr],
      b: [v[0] + ((q[0] - v[0]) / lq) * rr, v[1] + ((q[1] - v[1]) / lq) * rr],
    };
  });
  const k = 0.5523,
    first = corner[0];
  const pen = new Pen(first.b[0], first.b[1]);
  for (let i = 1; i <= m; i++) {
    const { v, a, b } = corner[i % m];
    pen.to(a[0], a[1]);
    pen.c(a[0] + (v[0] - a[0]) * k, a[1] + (v[1] - a[1]) * k, b[0] + (v[0] - b[0]) * k, b[1] + (v[1] - b[1]) * k, b[0], b[1]);
  }
  return outline(pen.close(), n);
}

/* ---------- colour ---------- */

export type RGB = [number, number, number];
/** "#rrggbb" or "rgb(r, g, b)" to numbers (what a resolved custom property gives back). */
export function parseColor(v: string, fallback: RGB): RGB {
  const s = v.trim();
  const h = /^#([0-9a-f]{6})$/i.exec(s);
  if (h) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)];
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return fallback;
}
export const rgb = (c: ArrayLike<number>) => "rgb(" + Math.round(c[0]) + "," + Math.round(c[1]) + "," + Math.round(c[2]) + ")";

/* ---------- random ---------- */

export function rng32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rng = () => number;

/* ---------- the word ---------- */

export type Letter = { ch: string; outer: Outline; inner: Outline | null; box: Box; c: [number, number]; ic: [number, number] | null };
export type Dot = { cx: number; cy: number; r: number };
export type Layout = {
  W: number;
  H: number;
  portrait: boolean;
  phone: boolean;
  fs: number;
  s: number;
  cy: number;
  letters: Letter[];
  dots: Dot[];
  rect: Box;
  /** A size unit for scenery: 1 at 1440 wide. */
  u: number;
};

/**
 * Where the word sits, in px. The CSS in page-transition.css repeats the
 * word width, the centre line and the dot radius exactly, so the CSS dots
 * and the resting word line up with the morph.
 */
export function layout(W: number, H: number): Layout {
  const portrait = W < H;
  const chars = [...WORD];
  let adv = 0;
  chars.forEach((c, i) => (adv += GLYPHS[c].adv + (i < chars.length - 1 ? TRACK : 0)));
  const wordW = W >= 820 ? Math.min(W * 0.56, 1000) : W * 0.8;
  const s = wordW / adv,
    fs = s * 1000;
  const cy = H * (portrait ? 0.4 : 0.43);
  const baseline = cy + (CAP * s) / 2;
  let pen = (W - wordW) / 2;
  const letters = chars.map((c): Letter => {
    const g = GLYPHS[c];
    const conts = g.contours.map((cs) => cs.map((q) => q.map((v, k) => (k % 2 ? baseline + v * s : pen + v * s))));
    const withArea = conts.map((cs) => ({ cs, a: signedArea(cs) }));
    withArea.sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
    const cw = (x: { cs: Cubic[]; a: number }) => (x.a < 0 ? reverseCubics(x.cs) : x.cs);
    const outer = outline(cw(withArea[0]), N_OUT);
    const inner = withArea[1] ? outline(cw(withArea[1]), N_IN) : null;
    pen += (g.adv + TRACK) * s;
    const b = box(outer);
    return { ch: c, outer, inner, box: b, c: [b.cx, b.cy], ic: inner ? center(inner) : null };
  });
  const x0 = Math.min(...letters.map((l) => l.box.x0)),
    x1 = Math.max(...letters.map((l) => l.box.x1));
  const y0 = Math.min(...letters.map((l) => l.box.y0)),
    y1 = Math.max(...letters.map((l) => l.box.y1));
  const r = Math.max(7, fs * 0.075);
  const gap = r * 3.3;
  const dots = [0, 1, 2].map((k) => ({ cx: W / 2 + (k - 1) * gap, cy, r }));
  const u = Math.min(1.3, Math.max(0.42, Math.max(W, H * 0.85) / 1440));
  return {
    W,
    H,
    portrait,
    phone: W < 700,
    fs,
    s,
    cy,
    letters,
    dots,
    rect: { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 },
    u,
  };
}

/* ---------- the loading dots ---------- */

/** The bounce, in ms. page-transition.css's `xti-hop` is this, sampled. */
export const DOT = { start: 180, P: 820, HOP: 470, OFF: 115, SQ: 150 };

/** The first moment at or after `readyT` when the last dot lands: the dots can only turn into the word there. */
export function releaseAt(readyT: number) {
  let n = 0;
  while (DOT.start + n * DOT.P + 2 * DOT.OFF + DOT.HOP < readyT) n++;
  return DOT.start + n * DOT.P + 2 * DOT.OFF + DOT.HOP;
}

/** A dot's squash (and, before release, its hop) as an SVG transform about its foot. */
export function dotTransform(d: Dot, k: number, st: number, release: number) {
  const t = st - DOT.start - k * DOT.OFF;
  let y = 0,
    sy = 1;
  if (t > 0) {
    let n = Math.floor(t / DOT.P),
      ph = t - n * DOT.P;
    if (DOT.start + k * DOT.OFF + n * DOT.P >= release && n > 0) {
      n -= 1;
      ph += DOT.P;
    }
    const A = d.r * 2.7;
    if (ph < DOT.HOP && DOT.start + k * DOT.OFF + n * DOT.P < release) {
      const p = ph / DOT.HOP;
      y = -A * 4 * p * (1 - p);
      sy = 1 + 0.14 * Math.abs(1 - 2 * p);
    } else {
      const q = ph - DOT.HOP;
      if (q >= 0 && q < DOT.SQ) {
        const w = 1 - q / DOT.SQ;
        sy = 1 - 0.26 * w * w;
      }
    }
  }
  if (y === 0 && sy === 1) return "";
  const sx = 1 / Math.sqrt(sy),
    fx = d.cx,
    fy = d.cy + d.r;
  return "translate(" + r1(fx) + " " + r1(fy + y) + ") scale(" + sx.toFixed(3) + " " + sy.toFixed(3) + ") translate(" + r1(-fx) + " " + r1(-fy) + ")";
}

/* ---------- what a sample is made of ---------- */

export type Channel = "o" | "i" | "c";
export type TweenSpec = { part: number; ch: Channel; t0: number; dur: number; target: Outline | RGB; ease: Ease };
export type MorphPlan = {
  tweens: TweenSpec[];
  /** When the word has fully landed. */
  formed: number;
  /** A transform for the whole word at a moment (a beat, a spin); null leaves it alone, "" clears it. */
  group?: (st: number) => string | null;
};

/** One piece of scenery: an element positioned by transform only, animated by Web Animations. */
export type Item = {
  /** 0 and 1 sit under the word, 2 over it. */
  depth: 0 | 1 | 2;
  sym?: string;
  vb?: string;
  html?: string;
  w: number;
  h: number;
  x: number;
  y: number;
  r: number;
  s: number;
  op?: number;
  vars?: Record<string, string>;
  origin?: string;
  kf: Keyframe[];
  dur: number;
  delay: number;
  /** Fade in over this fraction of the run. */
  fade?: number;
  /** A screen that flickers on over the symbol. */
  lit?: { sym: string; vb: string; at: number };
};

export type Rect = { x: number; y: number; w: number; h: number; col: number; row: number };
/** One exit piece: a clone of the loader frame, cut to `rect` (and `clip`), animated with `kf`. */
export type Piece = { rect: Rect; clip?: string; origin?: string; delay: number; dur: number; kf: Keyframe[] };

export type Ground = "night" | "paper";

export type Sample = {
  id: "A" | "B" | "C" | "D" | "E";
  name: string;
  /** The ground it was shown on in the lookbook. */
  ground: Ground;
  /** Whether the X ends Chili (E) or ink (the rest). */
  xChili: boolean;
  /** Which dot each letter part grows from. */
  dotOf: (j: number) => number;
  morph: (G: Layout, M: number, ink: RGB, chili: RGB) => MorphPlan;
  /** When the scenery starts, after the release. */
  sceneryLead: number;
  scenery: (G: Layout, rng: Rng) => Item[];
  /** `pace` scales Camera's timing: 0.5 is the lookbook's "Page" pace. */
  pieces: (G: Layout, pace: number) => Piece[];
};

/* ---------- scenery helpers ---------- */

/** A transform that puts a w × h element's centre at (x, y), turned r degrees and scaled. */
export const T = (x: number, y: number, r: number, sx: number, sy: number | undefined, w: number, h: number) =>
  "translate(" +
  (x - w / 2).toFixed(1) +
  "px," +
  (y - h / 2).toFixed(1) +
  "px) rotate(" +
  r.toFixed(2) +
  "deg) scale(" +
  sx.toFixed(3) +
  "," +
  (sy ?? sx).toFixed(3) +
  ")";

type Spot = { x: number; y: number; s: number };
type Area = { x0: number; y0: number; x1: number; y1: number };

/** Place n things in a box, away from `avoid` and from each other. */
export function scatter(rng: Rng, n: number, bx: Area, sizeOf: (i: number) => number, avoid: Area[], placed: Spot[], gap = 0.95) {
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const s = sizeOf(i);
    let best: Spot = { x: bx.x0, y: bx.y0, s };
    let bestScore = -Infinity;
    for (let t = 0; t < 70; t++) {
      const x = bx.x0 + rng() * (bx.x1 - bx.x0),
        y = bx.y0 + rng() * (bx.y1 - bx.y0);
      let score = 1e9;
      for (const a of avoid) {
        const dx = Math.max(a.x0 - x, 0, x - a.x1),
          dy = Math.max(a.y0 - y, 0, y - a.y1),
          d = Math.hypot(dx, dy) - s * 0.5;
        score = Math.min(score, d < 0 ? d - 1e5 : d * 2);
      }
      for (const p of placed) score = Math.min(score, Math.hypot(p.x - x, p.y - y) - (p.s + s) * 0.5 * gap);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y, s };
      }
      if (score > s * 0.4) break;
    }
    placed.push(best);
    out.push(best);
  }
  return out;
}
export const inflate = (r: Area, px: number, py = px): Area => ({ x0: r.x0 - px, y0: r.y0 - py, x1: r.x1 + px, y1: r.y1 + py });

/** Rise from below with buoyancy: overshoot up, dip, settle; a damped sway. */
export function riseKF(it: Item, from: { x: number; y: number; r: number }, over: number, sway: number): Keyframe[] {
  const { x, y, r, s, w, h } = it;
  return [
    { transform: T(from.x, from.y, from.r, s, s, w, h), easing: "cubic-bezier(0.2, 0.75, 0.3, 1)" },
    { transform: T(x + (from.x - x) * -0.12, y - over, r + sway, s, s, w, h), offset: 0.6, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
    { transform: T(x, y + over * 0.28, r - sway * 0.45, s, s, w, h), offset: 0.82, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
    { transform: T(x, y, r, s, s, w, h) },
  ];
}

/**
 * Camera.js's timing: each piece waits ((T + D) / blocks) × order × couples
 * × 0.5 and moves for T − D, on easeInOutExpo, all scaled by `pace`.
 */
export function cameraTiming(cam: { T: number; D: number; couples: number; blocks: number }, pace: number) {
  return { step: ((cam.T + cam.D) / cam.blocks) * cam.couples * 0.5 * pace, dur: (cam.T - cam.D) * pace };
}
export function gridRects(W: number, H: number, cols: number, rows: number): Rect[] {
  const xs = [...Array(cols + 1)].map((_, i) => Math.round((i * W) / cols));
  const ys = [...Array(rows + 1)].map((_, i) => Math.round((i * H) / rows));
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) out.push({ col: c, row: r, x: xs[c], y: ys[r], w: xs[c + 1] - xs[c] + 1, h: ys[r + 1] - ys[r] + 1 });
  return out;
}
/** Camera.js's mosaicSpiral: the outer ring clockwise from the top-left, then inward. */
export function spiralOrder(cols: number, rows: number) {
  const order: number[] = [];
  let n = 0;
  for (let z = 0; z < rows / 2; z++) {
    let x: number,
      y = z;
    for (x = z; x < cols - z - 1; x++) order[n++] = y * cols + x;
    x = cols - z - 1;
    for (y = z; y < rows - z - 1; y++) order[n++] = y * cols + x;
    y = rows - z - 1;
    for (x = cols - z - 1; x > z; x--) order[n++] = y * cols + x;
    x = z;
    for (y = rows - z - 1; y > z; y--) order[n++] = y * cols + x;
  }
  const rank = new Array(cols * rows).fill(0);
  order.forEach((b, i) => (rank[b] = i));
  return rank as number[];
}
