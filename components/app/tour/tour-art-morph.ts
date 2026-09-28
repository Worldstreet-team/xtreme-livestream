/**
 * The geometry under the walkthrough's art (./tour-art.tsx): every part of
 * the drawing is one closed outline of exactly `SEGS` cubic segments, in
 * every scene. Because the structure never changes, turning one scene into
 * another is plain point-wise interpolation — a phone's screen can travel,
 * round off and become an avatar ring without a cut.
 *
 * - Shapes are drawn with a tiny `Pen` (lines, cubics, elliptical arcs),
 *   then `outline` resamples them to SEGS segments, splitting the longest
 *   pieces first so the points sit evenly along the edge.
 * - Open lines (a wave, a digit, a link) go there and back (`stroke`): a
 *   closed outline with no area, so a line can become a card and back.
 * - Every closed shape runs clockwise on screen; `align` picks the starting
 *   segment that travels least, so shapes don't twist on the way.
 * - Numbers only: no DOM, no React. The rAF driver lives in the component.
 */

export const SEGS = 24;

export type Pt = readonly [number, number];
/** SEGS cubic segments, flattened: `c1x c1y c2x c2y x y` each; the path starts at the last segment's end. */
export type Outline = Float64Array;
/** One cubic: start, two handles, end. */
type Cubic = [number, number, number, number, number, number, number, number];

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/* ---- the pen -------------------------------------------------------------- */

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

  /** A straight line (handles at thirds, so it resamples evenly). Zero-length lines are skipped. */
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

  /**
   * An elliptical arc around (cx, cy) from angle a0 to a1, in degrees (0 is
   * 3 o'clock; increasing runs clockwise on screen). Joins with a line if
   * the pen isn't at the arc's start. Pieces of at most 90°.
   */
  arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number) {
    if (rx < 1e-6 || ry < 1e-6 || Math.abs(a1 - a0) < 1e-6) return this;
    this.to(cx + rx * Math.cos(rad(a0)), cy + ry * Math.sin(rad(a0)));
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90 - 1e-9));
    const step = rad((a1 - a0) / n);
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const t0 = rad(a0) + i * step;
      const t1 = t0 + step;
      const x1 = cx + rx * Math.cos(t1);
      const y1 = cy + ry * Math.sin(t1);
      this.c(
        this.x - k * rx * Math.sin(t0),
        this.y + k * ry * Math.cos(t0),
        x1 + k * rx * Math.sin(t1),
        y1 - k * ry * Math.cos(t1),
        x1,
        y1,
      );
    }
    return this;
  }

  /** Close back to the start and hand over the cubics. */
  close() {
    this.to(this.sx, this.sy);
    return this.cubics;
  }

  /** Leave it open (for `stroke`). */
  open() {
    return this.cubics;
  }
}

/* ---- resampling ------------------------------------------------------------ */

function cubicAt(c: Cubic, t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return [a * c[0] + b * c[2] + d * c[4] + e * c[6], a * c[1] + b * c[3] + d * c[5] + e * c[7]];
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

/** The piece of a cubic between t0 and t1 (de Casteljau, twice). */
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

/** Split cubics into exactly n, giving extra cuts to whichever piece is longest per cut. */
function resample(cubics: Cubic[], n: number): Cubic[] {
  if (cubics.length === 0) throw new Error("tour-art: empty shape");
  if (cubics.length > n) throw new Error(`tour-art: shape has ${cubics.length} pieces, more than ${n}`);
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

/** A closed shape as an outline. */
export function outline(cubics: Cubic[]): Outline {
  return pack(resample(cubics, SEGS));
}

/** An open line as an outline: out along the line and back over itself. */
export function stroke(cubics: Cubic[]): Outline {
  const out = resample(cubics, SEGS / 2);
  const back = out
    .slice()
    .reverse()
    .map((c): Cubic => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]]);
  return pack([...out, ...back]);
}

/** Every point at one place: a part folded away. */
export function point(x: number, y: number): Outline {
  const o = new Float64Array(SEGS * 6);
  for (let i = 0; i < o.length; i += 2) {
    o[i] = x;
    o[i + 1] = y;
  }
  return o;
}

/* ---- transforms -------------------------------------------------------------- */

export function mapPoints(o: Outline, fn: (x: number, y: number) => Pt): Outline {
  const out = new Float64Array(o.length);
  for (let i = 0; i < o.length; i += 2) {
    const [x, y] = fn(o[i]!, o[i + 1]!);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

export const translate = (o: Outline, dx: number, dy: number) => mapPoints(o, (x, y) => [x + dx, y + dy]);

export function rotate(o: Outline, degrees: number, cx: number, cy: number) {
  const c = Math.cos(rad(degrees));
  const s = Math.sin(rad(degrees));
  return mapPoints(o, (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}

export function scale(o: Outline, k: number, cx: number, cy: number, ky = k) {
  return mapPoints(o, (x, y) => [cx + (x - cx) * k, cy + (y - cy) * ky]);
}

/** Mirror left-right about x = mx, keeping the winding clockwise. */
function mirrorCubics(cubics: Cubic[], mx: number): Cubic[] {
  return cubics
    .map((c): Cubic => [2 * mx - c[0], c[1], 2 * mx - c[2], c[3], 2 * mx - c[4], c[5], 2 * mx - c[6], c[7]])
    .reverse()
    .map((c): Cubic => [c[6], c[7], c[4], c[5], c[2], c[3], c[0], c[1]]);
}

/** The average of a shape's anchor points: where it is, for ordering and folding. */
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

/** The size of a shape's box, corner to corner. */
export function extent(o: Outline) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < o.length; i += 2) {
    x0 = Math.min(x0, o[i]!);
    x1 = Math.max(x1, o[i]!);
    y0 = Math.min(y0, o[i + 1]!);
    y1 = Math.max(y1, o[i + 1]!);
  }
  return Math.hypot(x1 - x0, y1 - y0);
}

/* ---- morphing ------------------------------------------------------------------ */

/**
 * `to`, restarted at whichever segment makes the trip from `from` shortest.
 * Same shape, same winding; only where its outline "begins" moves. Dashed
 * paint counts its pattern from the start, so a dashed part may only start
 * at either end (`starts`: [0, SEGS / 2]).
 */
export function align(from: Outline, to: Outline, starts?: number[]): Outline {
  const n = to.length / 6;
  let best = 0;
  let bestCost = Infinity;
  for (const k of starts ?? Array.from({ length: n }, (_, i) => i)) {
    let cost = 0;
    for (let i = 0; i < n && cost < bestCost; i++) {
      const a = i * 6 + 4;
      const b = ((i + k) % n) * 6 + 4;
      const dx = from[a]! - to[b]!;
      const dy = from[a + 1]! - to[b + 1]!;
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

/** Point-wise a → b at e (e may run past 1 for an overshoot), written into `out`. */
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

/* ---- easing -------------------------------------------------------------------- */

/** A CSS `cubic-bezier(x1, y1, x2, y2)` as a function of progress — the same curve CSS draws. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-5) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    // Newton stalled: bisect.
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

/** `cubic-bezier(…)` from lib/motion.ts's EASE strings. */
export function easeFrom(css: string) {
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  const [a = 0, b = 0, c = 1, d = 1] = m ? m[1]!.split(",").map(Number) : [];
  return cubicBezier(a, b, c, d);
}

/* ---- shapes --------------------------------------------------------------------- */

export function circle(cx: number, cy: number, r: number): Outline {
  return outline(new Pen(cx, cy - r).arc(cx, cy, r, r, -90, 270).close());
}

export function ellipse(cx: number, cy: number, rx: number, ry: number): Outline {
  return outline(new Pen(cx, cy - ry).arc(cx, cy, rx, ry, -90, 270).close());
}

/** A rounded rectangle; `r` is one radius or [top-left, top-right, bottom-right, bottom-left]. */
export function rrect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number] = 0): Outline {
  const lim = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = (typeof r === "number" ? [r, r, r, r] : r).map((v) => Math.min(v, lim)) as [number, number, number, number];
  const p = new Pen(x + tl, y);
  p.to(x + w - tr, y).arc(x + w - tr, y + tr, tr, tr, -90, 0);
  p.to(x + w, y + h - br).arc(x + w - br, y + h - br, br, br, 0, 90);
  p.to(x + bl, y + h).arc(x + bl, y + h - bl, bl, bl, 90, 180);
  p.to(x, y + tl).arc(x + tl, y + tl, tl, tl, 180, 270);
  return outline(p.close());
}

/** A pill-ended bar, like the kit's `Bar`. */
export const bar = (x: number, y: number, w: number, h = 4.5) => rrect(x, y, w, h, h / 2);

/** A polygon (points clockwise on screen) with its corners rounded by r. */
export function roundPoly(pts: Pt[], r: number | number[]): Outline {
  const n = pts.length;
  const corner = pts.map((v, i) => {
    const p = pts[(i + n - 1) % n]!;
    const q = pts[(i + 1) % n]!;
    const lp = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const lq = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const rr = Math.min(typeof r === "number" ? r : r[i]!, lp / 2, lq / 2);
    const a: Pt = [v[0] + ((p[0] - v[0]) / lp) * rr, v[1] + ((p[1] - v[1]) / lp) * rr];
    const b: Pt = [v[0] + ((q[0] - v[0]) / lq) * rr, v[1] + ((q[1] - v[1]) / lq) * rr];
    return { v, a, b, rr };
  });
  const k = 0.5523;
  const first = corner[0]!;
  const pen = new Pen(first.b[0], first.b[1]);
  for (let i = 1; i <= n; i++) {
    const { v, a, b, rr } = corner[i % n]!;
    pen.to(a[0], a[1]);
    if (rr > 1e-6) pen.c(a[0] + (v[0] - a[0]) * k, a[1] + (v[1] - a[1]) * k, b[0] + (v[0] - b[0]) * k, b[1] + (v[1] - b[1]) * k, b[0], b[1]);
  }
  return outline(pen.close());
}

/** A straight line (or polyline), there and back. */
export function line(...pts: Pt[]): Outline {
  const p = new Pen(pts[0]![0], pts[0]![1]);
  for (const q of pts.slice(1)) p.to(q[0], q[1]);
  return stroke(p.open());
}

/** An open arc, there and back. */
export function arcLine(cx: number, cy: number, r: number, a0: number, a1: number): Outline {
  const p = new Pen(cx + r * Math.cos(rad(a0)), cy + r * Math.sin(rad(a0)));
  return stroke(p.arc(cx, cy, r, r, a0, a1).open());
}

/**
 * Head and shoulders as one outline, like the kit's `Figure` without its
 * frame. (cx, cy) is the middle of the seat it fills and s its radius;
 * `bottom` puts the shoulders' flat base on a frame's edge.
 */
export function bust(cx: number, cy: number, s: number, bottom = cy + 0.72 * s): Outline {
  const hr = 0.31 * s;
  const hy = cy - 0.18 * s;
  const top = cy + 0.2 * s;
  const rx = 0.56 * s;
  const ry = Math.max(bottom - top, 0.1 * s);
  const neck = 40;
  const nw = hr * Math.sin(rad(neck));
  const t = deg(Math.acos(Math.min(1, nw / rx)));
  const a0 = 90 + neck;
  const p = new Pen(cx + hr * Math.cos(rad(a0)), hy + hr * Math.sin(rad(a0)));
  p.arc(cx, hy, hr, hr, a0, 90 - neck + 360);
  p.arc(cx, bottom, rx, ry, -t, 0);
  p.to(cx - rx, bottom);
  p.arc(cx, bottom, rx, ry, 180, 180 + t);
  return outline(p.close());
}

/** The same seat standing on a line at `bottom` (a podium step). */
export const bustOn = (cx: number, bottom: number, s: number) => bust(cx, bottom - 0.72 * s, s, bottom);

/** A chat bubble with its tail at the bottom left or right. */
export function bubble(x: number, y: number, w: number, h: number, r: number, side: "left" | "right"): Outline {
  const p = new Pen(x + r, y);
  p.to(x + w - r, y).arc(x + w - r, y + r, r, r, -90, 0);
  p.to(x + w, y + h - r).arc(x + w - r, y + h - r, r, r, 0, 90);
  p.to(x + 22, y + h);
  p.c(x + 13, y + h, x + 6, y + h + 3, x - 3, y + h + 7);
  p.c(x + 1, y + h + 1, x, y + h - 5, x, y + h - 14);
  p.to(x, y + r).arc(x + r, y + r, r, r, 180, 270);
  const cubics = p.close();
  return outline(side === "left" ? cubics : mirrorCubics(cubics, x + w / 2));
}

/** The left half of a disc: the light side of the theme. */
export function halfDisc(cx: number, cy: number, r: number): Outline {
  return outline(new Pen(cx, cy - r).to(cx, cy + r).arc(cx, cy, r, r, 90, 270).close());
}

/** An arc from `from` to `to` (degrees) that passes through `via`. */
function arcVia(p: Pen, cx: number, cy: number, r: number, from: number, to: number, via: number) {
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const sweep = norm(to - from);
  const cw = norm(via - from) < sweep;
  return p.arc(cx, cy, r, r, from, cw ? from + sweep : from + sweep - 360);
}

/** A crescent: the disc (cx, cy, R) with the disc at (cx+dx, cy+dy, r) bitten out of it. */
export function crescent(cx: number, cy: number, R: number, dx: number, dy: number, r: number): Outline {
  const d = Math.hypot(dx, dy);
  const phi = deg(Math.atan2(dy, dx));
  const alpha = deg(Math.acos((R * R - r * r + d * d) / (2 * d * R)));
  const ix = cx + dx;
  const iy = cy + dy;
  const a = phi + alpha;
  const b = phi - alpha + 360;
  const p = new Pen(cx + R * Math.cos(rad(a)), cy + R * Math.sin(rad(a)));
  p.arc(cx, cy, R, R, a, b);
  const ex = cx + R * Math.cos(rad(b));
  const ey = cy + R * Math.sin(rad(b));
  const sx = cx + R * Math.cos(rad(a));
  const sy = cy + R * Math.sin(rad(a));
  arcVia(p, ix, iy, r, deg(Math.atan2(ey - iy, ex - ix)), deg(Math.atan2(sy - iy, sx - ix)), phi + 180);
  return outline(p.close());
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

/** A flame (a teardrop leaning up), `s` about its half-height. */
export function flame(cx: number, cy: number, s: number): Outline {
  const w = 0.64 * s;
  const by = cy + 0.2 * s;
  const tip: Pt = [cx + 0.06 * s, cy - 1.1 * s];
  const p = new Pen(tip[0], tip[1]);
  p.c(cx + 0.3 * s, cy - 0.7 * s, cx + w, cy - 0.36 * s, cx + w, by);
  p.arc(cx, by, w, w * 0.94, 0, 180);
  p.c(cx - w, cy - 0.28 * s, cx - 0.22 * s, cy - 0.62 * s, tip[0], tip[1]);
  return outline(p.close());
}

/** The crown for #1 (the podium's, in the kit), its base centred on (cx, base). */
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
  return roundPoly(pts, [1.5, 1.2, 1.5, 1.2, 1.5, 1.2, 1.5]);
}

/** A shield, its crown at (cx, top), point at the bottom (the kit's `Shield` outline). */
export function shield(cx: number, top: number, w: number, h: number): Outline {
  const kx = w / 80;
  const ky = h / 102;
  const X = (x: number) => cx + x * kx;
  const Y = (y: number) => top + y * ky;
  const p = new Pen(X(0), Y(0));
  p.to(X(40), Y(14)).to(X(40), Y(44));
  p.c(X(40), Y(72), X(23), Y(91), X(0), Y(102));
  p.c(X(-23), Y(91), X(-40), Y(72), X(-40), Y(44));
  p.to(X(-40), Y(14));
  return outline(p.close());
}

/** A phone handset, spine on the left, pads to the right; place with `rotate`/`translate`. */
export function handset(): Outline {
  const p = new Pen(5, 0);
  p.to(13, 0).arc(13, 3, 3, 3, -90, 0);
  p.to(16, 9).arc(13, 9, 3, 3, 0, 90);
  p.to(9.5, 12);
  p.c(5, 20, 5, 38, 9.5, 46);
  p.to(13, 46).arc(13, 49, 3, 3, -90, 0);
  p.to(16, 55).arc(13, 55, 3, 3, 0, 90);
  p.to(5, 58).arc(5, 53, 5, 5, 90, 180);
  p.c(-7, 42, -7, 16, 0, 5);
  p.arc(5, 5, 5, 5, 180, 270);
  return outline(p.close());
}

/* ---- glyphs (open lines, there and back), drawn around (0, 0) ----------------- */

export function digit(n: 1 | 2 | 3): Outline {
  if (n === 1) return line([-5, -7], [1.5, -11.5], [1.5, 11]);
  if (n === 2) {
    const p = new Pen(-6.5, -5.5);
    p.c(-6, -10, -2.5, -11.5, 0.5, -11.5);
    p.c(4.5, -11.5, 7, -8.6, 7, -5.4);
    p.c(7, -1.2, 3, 1.8, -7, 11);
    p.to(7.5, 11);
    return stroke(p.open());
  }
  const p = new Pen(-6.5, -8);
  p.c(-4, -11.8, 6.5, -12.6, 6.5, -5.6);
  p.c(6.5, -1.6, 2.4, -0.6, -1, -0.6);
  p.c(3.2, -0.6, 7.4, 1, 7.4, 5.4);
  p.c(7.4, 12, -4, 12.8, -7.2, 7.6);
  return stroke(p.open());
}

export function dollar(): Outline {
  const p = new Pen(0, -13);
  p.to(0, -9);
  p.c(3.5, -9, 5.8, -7.8, 6.2, -5.4);
  p.c(5.8, -7.8, 3.5, -9, 0, -9);
  p.c(-4, -9, -6.4, -7, -6.4, -4.3);
  p.c(-6.4, -0.6, -2, -0.4, 0, 0);
  p.c(2.4, 0.4, 6.6, 1.1, 6.6, 4.6);
  p.c(6.6, 7.6, 3.6, 9, 0, 9);
  p.c(-3.4, 9, -5.9, 7.8, -6.4, 5.2);
  p.c(-5.9, 7.8, -3.4, 9, 0, 9);
  p.to(0, 13);
  return stroke(p.open());
}

/** Place a glyph drawn around (0, 0). */
export const at = (o: Outline, x: number, y: number, k = 1) => mapPoints(o, (gx, gy) => [x + gx * k, y + gy * k]);
