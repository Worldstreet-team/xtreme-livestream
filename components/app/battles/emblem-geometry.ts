/**
 * The geometry under the clash emblem (./clash-emblem.tsx): the morphing
 * technique of the walkthrough's art (components/app/tour/tour-art-morph.ts),
 * cut down to what one small emblem needs.
 *
 * Every part is one closed outline of exactly SEGS cubic segments in every
 * pose, so VS can become two crossed blades, and the blades a crown, by
 * plain point-wise interpolation. Open lines (the V, the S, a clock hand)
 * go out and back over themselves: closed, with no area. Shapes run
 * clockwise on screen, and `align` rotates a target's start so it travels
 * least. Numbers only: no DOM.
 */

export const SEGS = 24;

export type Pt = readonly [number, number];
export type Outline = Float64Array;
type Cubic = [number, number, number, number, number, number, number, number];

const rad = (d: number) => (d * Math.PI) / 180;

export class Pen {
  readonly cubics: Cubic[] = [];
  private x: number;
  private y: number;
  private readonly sx: number;
  private readonly sy: number;

  constructor(x: number, y: number) {
    this.x = this.sx = x;
    this.y = this.sy = y;
  }

  to(x: number, y: number) {
    if (Math.hypot(x - this.x, y - this.y) < 1e-6) return this;
    const { x: x0, y: y0 } = this;
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

  /** An arc around (cx, cy) from a0 to a1 degrees (0 = 3 o'clock, increasing clockwise on screen). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    this.to(cx + r * Math.cos(rad(a0)), cy + r * Math.sin(rad(a0)));
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90 - 1e-9));
    const step = rad((a1 - a0) / n);
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const t0 = rad(a0) + i * step;
      const t1 = t0 + step;
      const x1 = cx + r * Math.cos(t1);
      const y1 = cy + r * Math.sin(t1);
      this.c(this.x - k * r * Math.sin(t0), this.y + k * r * Math.cos(t0), x1 + k * r * Math.sin(t1), y1 - k * r * Math.cos(t1), x1, y1);
    }
    return this;
  }

  close() {
    this.to(this.sx, this.sy);
    return this.cubics;
  }

  open() {
    return this.cubics;
  }
}

function cubicAt(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6],
    u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7],
  ];
}

function cubicLength(c: Cubic) {
  let len = 0;
  let [px, py] = [c[0], c[1]];
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
    const ax = l(q[0], q[2]), ay = l(q[1], q[3]);
    const bx = l(q[2], q[4]), by = l(q[3], q[5]);
    const cx = l(q[4], q[6]), cy = l(q[5], q[7]);
    const dx = l(ax, bx), dy = l(ay, by);
    const ex = l(bx, cx), ey = l(by, cy);
    const fx = l(dx, ex), fy = l(dy, ey);
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

/** Exactly n cubics, the extra cuts going to whichever piece is longest per cut. */
function resample(cubics: Cubic[], n: number): Cubic[] {
  const len = cubics.map(cubicLength);
  const count = cubics.map(() => 1);
  for (let left = n - cubics.length; left > 0; left--) {
    let best = 0;
    for (let i = 1; i < cubics.length; i++) if (len[i]! / count[i]! > len[best]! / count[best]!) best = i;
    count[best]!++;
  }
  const out: Cubic[] = [];
  cubics.forEach((c, i) => {
    const k = count[i]!;
    for (let j = 0; j < k; j++) out.push(k === 1 ? c : subCubic(c, j / k, (j + 1) / k));
  });
  return out;
}

function pack(cubics: Cubic[]): Outline {
  const o = new Float64Array(cubics.length * 6);
  cubics.forEach((c, i) => o.set([c[2], c[3], c[4], c[5], c[6], c[7]], i * 6));
  return o;
}

export const outline = (cubics: Cubic[]) => pack(resample(cubics, SEGS));

/** An open line, out and back over itself. */
export function stroke(cubics: Cubic[]): Outline {
  const out = resample(cubics, SEGS / 2);
  const back = out
    .slice()
    .reverse()
    .map((c): Cubic => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]]);
  return pack([...out, ...back]);
}

export function point(x: number, y: number): Outline {
  const o = new Float64Array(SEGS * 6);
  for (let i = 0; i < o.length; i += 2) {
    o[i] = x;
    o[i + 1] = y;
  }
  return o;
}

export function center(o: Outline): Pt {
  let x = 0;
  let y = 0;
  const n = o.length / 6;
  for (let i = 0; i < n; i++) {
    x += o[i * 6 + 4]!;
    y += o[i * 6 + 5]!;
  }
  return [x / n, y / n];
}

/** `to`, restarted at the segment that makes the trip from `from` shortest. */
export function align(from: Outline, to: Outline): Outline {
  const n = to.length / 6;
  let best = 0;
  let bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    let cost = 0;
    for (let i = 0; i < n && cost < bestCost; i++) {
      const a = i * 6 + 4;
      const b = ((i + k) % n) * 6 + 4;
      cost += (from[a]! - to[b]!) ** 2 + (from[a + 1]! - to[b + 1]!) ** 2;
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

export function lerpInto(out: Outline, a: Outline, b: Outline, e: number) {
  for (let i = 0; i < out.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * e;
}

const num = (v: number) => String(Math.round(v * 100) / 100);

export function toPath(o: Outline): string {
  const n = o.length / 6;
  let d = `M${num(o[n * 6 - 2]!)} ${num(o[n * 6 - 1]!)}`;
  for (let i = 0; i < n; i++) {
    const j = i * 6;
    d += `C${num(o[j]!)} ${num(o[j + 1]!)} ${num(o[j + 2]!)} ${num(o[j + 3]!)} ${num(o[j + 4]!)} ${num(o[j + 5]!)}`;
  }
  return `${d}Z`;
}

/** A CSS `cubic-bezier(…)` string (lib/motion.ts's EASE) as a function of progress. */
export function easeFrom(css: string): (t: number) => number {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = m ? m[1]!.split(",").map(Number) : [];
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-5) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/* ---- shapes ---------------------------------------------------------------- */

export const circle = (cx: number, cy: number, r: number) => outline(new Pen(cx, cy - r).arc(cx, cy, r, -90, 270).close());

export function rrect(x: number, y: number, w: number, h: number, r: number): Outline {
  r = Math.min(r, w / 2, h / 2);
  const p = new Pen(x + r, y);
  p.to(x + w - r, y).arc(x + w - r, y + r, r, -90, 0);
  p.to(x + w, y + h - r).arc(x + w - r, y + h - r, r, 0, 90);
  p.to(x + r, y + h).arc(x + r, y + h - r, r, 90, 180);
  p.to(x, y + r).arc(x + r, y + r, r, 180, 270);
  return outline(p.close());
}

/** A polygon with rounded corners; the points are put clockwise on screen whatever order they came in. */
export function roundPoly(input: Pt[], r: number): Outline {
  let area = 0;
  for (let i = 0; i < input.length; i++) {
    const a = input[i]!;
    const b = input[(i + 1) % input.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  // y points down, so a positive shoelace sum is clockwise on screen.
  const pts = area < 0 ? input.slice().reverse() : input;
  const n = pts.length;
  const k = 0.5523;
  const corner = pts.map((v, i) => {
    const p = pts[(i + n - 1) % n]!;
    const q = pts[(i + 1) % n]!;
    const lp = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const lq = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const rr = Math.min(r, lp / 2, lq / 2);
    const a: Pt = [v[0] + ((p[0] - v[0]) / lp) * rr, v[1] + ((p[1] - v[1]) / lp) * rr];
    const b: Pt = [v[0] + ((q[0] - v[0]) / lq) * rr, v[1] + ((q[1] - v[1]) / lq) * rr];
    return { v, a, b, rr };
  });
  const pen = new Pen(corner[0]!.b[0], corner[0]!.b[1]);
  for (let i = 1; i <= n; i++) {
    const { v, a, b, rr } = corner[i % n]!;
    pen.to(a[0], a[1]);
    if (rr > 1e-6) pen.c(a[0] + (v[0] - a[0]) * k, a[1] + (v[1] - a[1]) * k, b[0] + (v[0] - b[0]) * k, b[1] + (v[1] - b[1]) * k, b[0], b[1]);
  }
  return outline(pen.close());
}

export function line(...pts: Pt[]): Outline {
  const p = new Pen(pts[0]![0], pts[0]![1]);
  for (const q of pts.slice(1)) p.to(q[0], q[1]);
  return stroke(p.open());
}

/** A four-point sparkle. */
export function sparkle(cx: number, cy: number, R: number): Outline {
  const k = 0.16 * R;
  const p = new Pen(cx, cy - R);
  p.c(cx + k, cy - k, cx + k, cy - k, cx + R, cy);
  p.c(cx + k, cy + k, cx + k, cy + k, cx, cy + R);
  p.c(cx - k, cy + k, cx - k, cy + k, cx - R, cy);
  p.c(cx - k, cy - k, cx - k, cy - k, cx, cy - R);
  return outline(p.close());
}

/**
 * A blade: a long, thin diamond from `a` to `b`, widest (w) a little past
 * the middle, the way a slash reads. Two of them crossed are the clash.
 */
export function blade(a: Pt, b: Pt, w: number): Outline {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const mx = a[0] + dx * 0.56;
  const my = a[1] + dy * 0.56;
  return roundPoly(
    [
      a,
      [mx + nx * w, my + ny * w],
      b,
      [mx - nx * w, my - ny * w],
    ],
    1.2,
  );
}

/** The crown for the winner, its base centred on (cx, base). */
export function crown(cx: number, base: number, w: number, h: number): Outline {
  const kx = w / 29.6;
  const ky = h / 17;
  const pts: Pt[] = [
    [5, 21],
    [3.2, 8.6],
    [11.2, 14],
    [18, 4],
    [24.8, 14],
    [32.8, 8.6],
    [31, 21],
  ].map(([x, y]) => [cx + (x! - 18) * kx, base + (y! - 21) * ky] as const);
  return roundPoly(pts, 1.4);
}
