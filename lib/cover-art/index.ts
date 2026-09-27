/**
 * Category covers, drawn from nothing but the category's name.
 *
 * `coverSvg(name, { w, h })` is a pure function: the same name at the same
 * shape is the same SVG, byte for byte. A cover is a flat poster in the
 * Afterglow palette — a ground, the family's motif (low contrast, one hot
 * element), the category's mark, and its name set in Archivo at the brand's
 * wide display cut, outlined so it renders identically in an <img>.
 *
 * Shapes: portrait (box art, 3:4), landscape (16:9, 4:3) and compact —
 * anything under 200px on its short side (picker thumbs, rail cards) drops
 * the type and lets the mark fill the tile, since the name sits beside it.
 *
 * Grounds come in dark and light; solid Chili, Ember, Crimson and Bone
 * grounds read the same on either page, the dark ones swap to a tinted
 * paper under `theme: "light"`.
 */

import { CAP_HEIGHT, GLYPHS, ICONS } from "./assets";
import {
  FAMILIES,
  FAMILY_OF,
  GAMES,
  GENRES,
  TOPICS,
  familyByKeyword,
  type Genre,
  type Motif,
  type Scheme,
  type Sport,
} from "./catalog";

export type CoverTheme = "dark" | "light";
export interface CoverOptions {
  w: number;
  h: number;
  theme?: CoverTheme;
}

export { COVER_VERSION } from "./version";

// ── palettes ────────────────────────────────────────────────────────────

interface Palette {
  ground: string;
  /** Motif strokes: a step off the ground. */
  line: string;
  /** Motif fills: two steps off the ground. */
  tone: string;
  /** The one hot element, and the mark. */
  accent: string;
  accent2: string;
  text: string;
  sub: string;
}

const P = (ground: string, line: string, tone: string, accent: string, accent2: string, text: string, sub: string): Palette => ({
  ground, line, tone, accent, accent2, text, sub,
});

const SCHEMES: Record<Scheme, { dark: Palette; light: Palette }> = {
  night: {
    dark: P("#151012", "#2a2124", "#3a2e31", "#ff5a66", "#ff8a4c", "#fff3ee", "#a99490"),
    light: P("#eee5e0", "#ded1ca", "#cdbdb5", "#e3122a", "#f85810", "#1c0a03", "#7c645c"),
  },
  chiliNight: {
    dark: P("#25090e", "#421219", "#5a1821", "#ff5a66", "#ff8a4c", "#fff3ee", "#d9959a"),
    light: P("#fadcdd", "#f2c3c6", "#e8a6ab", "#c00f16", "#d2460a", "#3b0a10", "#9a4d53"),
  },
  emberNight: {
    dark: P("#231007", "#40200f", "#5a2e15", "#ff8a4c", "#ff5a66", "#fff3ee", "#dda88a"),
    light: P("#fce3d3", "#f5cdb4", "#edb693", "#d2460a", "#e3122a", "#3a1606", "#97583a"),
  },
  chili: {
    dark: P("#e3122a", "#cf0f25", "#b30e1f", "#ffffff", "#1c0a03", "#ffffff", "#ffd2d6"),
    light: P("#e3122a", "#cf0f25", "#b30e1f", "#ffffff", "#1c0a03", "#ffffff", "#ffd2d6"),
  },
  ember: {
    dark: P("#f85810", "#e94f0c", "#d2460a", "#1c0a03", "#ffffff", "#1c0a03", "#5e2408"),
    light: P("#f85810", "#e94f0c", "#d2460a", "#1c0a03", "#ffffff", "#1c0a03", "#5e2408"),
  },
  crimson: {
    dark: P("#8e1915", "#a21d18", "#6e120f", "#ff8a4c", "#ffffff", "#fff3ee", "#f0b2a8"),
    light: P("#8e1915", "#a21d18", "#6e120f", "#ff8a4c", "#ffffff", "#fff3ee", "#f0b2a8"),
  },
  bone: {
    dark: P("#f3eae5", "#e3d6cf", "#d4c3ba", "#e3122a", "#f85810", "#1c0a03", "#7c645c"),
    light: P("#f3eae5", "#e3d6cf", "#d4c3ba", "#e3122a", "#f85810", "#1c0a03", "#7c645c"),
  },
  stem: {
    dark: P("#111a0e", "#1f2e19", "#2c4223", "#95d477", "#65a347", "#f2faec", "#9db88f"),
    light: P("#e4efdd", "#d0e2c5", "#b9d3a9", "#3f7a2b", "#65a347", "#0f1a0b", "#56704a"),
  },
  ink: {
    dark: P("#10121a", "#1f2331", "#2d3246", "#a3baff", "#ff5a66", "#f1f3ff", "#939bb8"),
    light: P("#e5e9f8", "#d0d6ee", "#b9c2e3", "#3a55c8", "#e3122a", "#0e1120", "#5a6285"),
  },
};

// ── what a category is ──────────────────────────────────────────────────

export interface CoverSpec {
  name: string;
  family: string;
  kicker: string;
  motif: Motif;
  scheme: Scheme;
  icon: string;
  sport?: Sport;
  genre?: Genre;
  /** Game titles: the initials that stand in as the hero. */
  mono?: string;
  seed: number;
}

/** FNV-1a: a stable 32-bit seed from a name. */
export function seedOf(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SMALL = new Set(["OF", "THE", "AND", "&", "A", "VS.", "VS", "BY", "DE"]);

/** Initials for a title with no hand-picked monogram. */
function autoMono(name: string) {
  const words = name
    .toUpperCase()
    .replace(/[:.,!'’()]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !SMALL.has(w));
  if (words.length === 1) return words[0].length <= 4 ? words[0] : words[0].slice(0, 2);
  return words
    .map((w) => (/^\d+$/.test(w) || /^[IVX]+$/.test(w) ? w : w[0]))
    .join("")
    .slice(0, 4);
}

const LOOSE_MOTIFS: Motif[] = ["dots", "slashes", "pixels", "zone", "burst", "lattice", "hex", "waves"];
const LOOSE_SCHEMES: Scheme[] = ["night", "chiliNight", "emberNight", "chili", "ember", "crimson"];

export function coverSpec(category: string): CoverSpec {
  const name = category.trim() || "Live";
  const seed = seedOf(name);
  const game = GAMES[name];
  if (game) {
    const g = GENRES[game.genre];
    return {
      name,
      family: "Games",
      kicker: g.label,
      motif: g.motif,
      scheme: g.schemes[seed % g.schemes.length],
      icon: game.icon ?? g.icon,
      sport: game.sport,
      genre: game.genre,
      mono: game.mono ?? autoMono(name),
      seed,
    };
  }
  const known = FAMILY_OF.get(name);
  const family = known?.group ?? familyByKeyword(name);
  if (!known && family === "General") {
    // A label we don't file (an old stream's, or a title nobody catalogued):
    // treat it like a game title — its initials are the mark — so a row of
    // them isn't a row of identical chat bubbles.
    return {
      name,
      family,
      kicker: FAMILIES.General.kicker,
      motif: LOOSE_MOTIFS[seed % LOOSE_MOTIFS.length],
      scheme: LOOSE_SCHEMES[(seed >>> 8) % LOOSE_SCHEMES.length],
      icon: FAMILIES.General.icon,
      mono: autoMono(name),
      seed,
    };
  }
  const f = FAMILIES[family] ?? FAMILIES.General;
  const t = TOPICS[name] ?? {};
  const index = known?.index ?? seed;
  return {
    name,
    family,
    kicker: f.kicker,
    motif: t.motif ?? f.motif,
    scheme: f.schemes[index % f.schemes.length],
    icon: t.icon ?? f.icon,
    sport: t.sport,
    seed,
  };
}

// ── drawing helpers ─────────────────────────────────────────────────────

const n = (v: number) => String(Math.round(v * 10) / 10);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Ctx {
  W: number;
  H: number;
  wide: boolean;
  compact: boolean;
  r: () => number;
  pal: Palette;
  /** Where the motif's hot spot sits. */
  fx: number;
  fy: number;
  /** Bottom of the zone the motif may be loud in (the type lives below). */
  calm: number;
  /** Where the name sits (landscape): hot elements keep out of it. */
  clear: (x: number, y: number) => boolean;
  /** Below the kicker: where the motif's hot parts may start. */
  top: number;
}

const between = (r: () => number, a: number, b: number) => a + (b - a) * r();
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

function circle(cx: number, cy: number, rad: number, attrs: string) {
  return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rad)}" ${attrs}/>`;
}
function line(x1: number, y1: number, x2: number, y2: number, attrs: string) {
  return `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${attrs}/>`;
}
function rect(x: number, y: number, w: number, h: number, attrs: string) {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs}/>`;
}
function poly(pts: [number, number][], closed = false) {
  return pts.map(([x, y], i) => `${i ? "L" : "M"}${n(x)} ${n(y)}`).join("") + (closed ? "Z" : "");
}
const stroke = (c: string, w: number, extra = "") => `fill="none" stroke="${c}" stroke-width="${n(w)}" ${extra}`.trim();
const fill = (c: string, extra = "") => `fill="${c}" ${extra}`.trim();

// ── motifs ──────────────────────────────────────────────────────────────

type Draw = (c: Ctx, spec: CoverSpec) => string;

const dots: Draw = ({ W, H, pal, fx, fy }) => {
  const sp = 20;
  const maxD = Math.hypot(W, H) * 0.62;
  let s = "";
  for (let y = sp / 2; y < H; y += sp)
    for (let x = sp / 2; x < W; x += sp) {
      const d = Math.hypot(x - fx, y - fy) / maxD;
      const rad = sp * 0.44 * Math.max(0, 1 - d) ** 1.5;
      if (rad > 0.9) s += circle(x, y, rad, fill(rad > sp * 0.3 ? pal.tone : pal.line));
    }
  const hx = Math.round((fx - sp / 2) / sp) * sp + sp / 2;
  const hy = Math.round((fy - sp / 2) / sp) * sp + sp / 2;
  return s + circle(hx, hy, sp * 0.44, fill(pal.accent2));
};

const contour: Draw = ({ r, pal, fx, fy, W }) => {
  const p = [r() * 6.28, r() * 6.28, r() * 6.28];
  let s = "";
  const rings = 11;
  const hot = 2 + Math.floor(r() * 3);
  for (let k = 0; k < rings; k++) {
    const base = 14 + k * (W / 17);
    const amp = 0.1 + k * 0.012;
    const pts: [number, number][] = [];
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      const rr = base * (1 + amp * Math.sin(3 * t + p[0]) + amp * 0.6 * Math.sin(5 * t + p[1]) + amp * 0.4 * Math.sin(2 * t + p[2]));
      pts.push([fx + rr * Math.cos(t), fy + rr * 0.86 * Math.sin(t)]);
    }
    s += `<path d="${poly(pts, true)}" ${stroke(k === hot ? pal.accent2 : pal.line, k === hot ? 3 : 2)}/>`;
  }
  return s;
};

const candles: Draw = ({ W, H, r, pal, wide, calm }) => {
  const x0 = wide ? W * 0.44 : 26;
  const x1 = W - 26;
  const count = wide ? 16 : 13;
  const step = (x1 - x0) / count;
  const top = H * 0.1;
  const bottom = calm - 10;
  let price = 0.5;
  const series: { o: number; c: number; hi: number; lo: number }[] = [];
  for (let i = 0; i < count; i++) {
    const o = price;
    price = Math.min(0.95, Math.max(0.08, price + (r() - 0.42) * 0.22));
    series.push({ o, c: price, hi: Math.max(o, price) + r() * 0.08, lo: Math.min(o, price) - r() * 0.08 });
  }
  const y = (v: number) => bottom - v * (bottom - top);
  let s = "";
  // Grid rows first, then candles; the last candle is the hot one.
  for (let g = 0; g < 4; g++) s += line(0, top + ((bottom - top) * g) / 3, W, top + ((bottom - top) * g) / 3, stroke(pal.line, 1.5, 'stroke-dasharray="2 6"'));
  series.forEach((k, i) => {
    const cx = x0 + step * (i + 0.5);
    const last = i === count - 1;
    const up = k.c >= k.o;
    const c = last ? pal.accent : pal.tone;
    s += line(cx, y(k.hi), cx, y(k.lo), stroke(c, 2.4, 'stroke-linecap="round"'));
    const bh = Math.max(4, Math.abs(y(k.o) - y(k.c)));
    const by = Math.min(y(k.o), y(k.c));
    s += rect(cx - step * 0.28, by, step * 0.56, bh, up || last ? fill(c, 'rx="2"') : stroke(c, 2.4, 'rx="2"'));
  });
  const lastY = y(series[count - 1].c);
  s += line(0, lastY, W, lastY, stroke(pal.accent, 1.6, 'stroke-dasharray="5 5"'));
  return s;
};

function hexPath(cx: number, cy: number, R: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return poly(pts, true);
}

const hex: Draw = ({ W, H, r, pal, calm, clear, top }) => {
  const R = 28;
  const dx = R * Math.sqrt(3);
  const dy = R * 1.5;
  let s = "";
  const cells: [number, number][] = [];
  for (let row = -1, y = 0; y < H + R; row++, y = row * dy)
    for (let x = (row & 1 ? dx / 2 : 0) - dx; x < W + dx; x += dx) cells.push([x, y]);
  let d = "";
  for (const [x, y] of cells) d += hexPath(x, y, R);
  s += `<path d="${d}" ${stroke(pal.line, 2)}/>`;
  const upper = cells.filter(([x, y]) => y > top + R && y < calm - 30 && x > 10 && x < W - 10 && clear(x, y));
  for (let i = 0; i < 6 && upper.length; i++) {
    const [x, y] = upper.splice(Math.floor(r() * upper.length), 1)[0];
    s += `<path d="${hexPath(x, y, R - 5)}" ${fill(i === 0 ? pal.accent2 : pal.tone)}/>`;
  }
  return s;
};

const lattice: Draw = ({ W, H, r, pal, calm, clear, top }) => {
  const sp = 36;
  let s = "";
  for (let k = -H; k < W + H; k += sp) {
    s += line(k, 0, k + H, H, stroke(pal.line, 1.8));
    s += line(k, 0, k - H, H, stroke(pal.line, 1.8));
  }
  // Diamonds filled on the lattice: centres sit on the half-grid.
  const cells: [number, number][] = [];
  for (let y = sp / 2; y < calm - sp / 2; y += sp / 2)
    for (let x = ((y / (sp / 2)) % 2 ? sp / 2 : 0) + sp / 2; x < W; x += sp)
      if (y > top && clear(x - sp / 2, y)) cells.push([x - sp / 2, y]);
  for (let i = 0; i < 7 && cells.length; i++) {
    const [x, y] = cells.splice(Math.floor(r() * cells.length), 1)[0];
    const h = sp / 2 - 3;
    s += `<path d="${poly([[x, y - h], [x + h, y], [x, y + h], [x - h, y]], true)}" ${fill(i === 0 ? pal.accent2 : pal.tone)}/>`;
  }
  return s;
};

const pixels: Draw = ({ W, H, r, pal, wide, calm }) => {
  const c = 24;
  const base = wide ? H - 24 : calm - 14;
  const x0 = wide ? W * 0.46 : 0;
  let s = "";
  let h = 2 + Math.floor(r() * 3);
  let best = { x: 0, y: base, h: 0 };
  for (let x = x0; x < W; x += c) {
    h = Math.max(1, Math.min(wide ? 9 : 11, h + Math.floor(r() * 5) - 2));
    for (let k = 0; k < h; k++) {
      const y = base - (k + 1) * c;
      s += rect(x + 1.5, y + 1.5, c - 3, c - 3, fill(r() < 0.22 ? pal.line : pal.tone, 'rx="2"'));
    }
    if (h > best.h) best = { x, y: base - (h + 1) * c, h };
  }
  // A few loose pixels above the skyline, and one hot block on the peak.
  for (let i = 0; i < 6; i++) {
    const x = x0 + Math.floor(r() * ((W - x0) / c)) * c;
    const y = base - (best.h + 2 + Math.floor(r() * 3)) * c;
    if (y > 8) s += rect(x + 1.5, y + 1.5, c - 3, c - 3, fill(pal.line, 'rx="2"'));
  }
  return s + rect(best.x + 1.5, best.y + 1.5, c - 3, c - 3, fill(pal.accent2, 'rx="2"'));
};

const claws: Draw = ({ W, r, pal, calm }) => {
  let s = "";
  const ang = between(r, -1.1, -0.8);
  const len = calm * 0.95;
  const cx = W * between(r, 0.42, 0.6);
  const cy = calm * 0.5;
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * 44;
    const ox = cx + off * Math.cos(ang + Math.PI / 2);
    const oy = cy + off * Math.sin(ang + Math.PI / 2);
    const l = len * (i === 0 || i === 3 ? 0.78 : 1);
    const ax = ox - (Math.cos(ang) * l) / 2;
    const ay = oy - (Math.sin(ang) * l) / 2;
    const bx = ox + (Math.cos(ang) * l) / 2;
    const by = oy + (Math.sin(ang) * l) / 2;
    const w = 13;
    const nx = Math.cos(ang + Math.PI / 2) * w;
    const ny = Math.sin(ang + Math.PI / 2) * w;
    s += `<path d="M${n(ax)} ${n(ay)}Q${n(ox + nx)} ${n(oy + ny)} ${n(bx)} ${n(by)}Q${n(ox - nx * 0.2)} ${n(oy - ny * 0.2)} ${n(ax)} ${n(ay)}Z" ${fill(i === 1 ? pal.accent : pal.tone)}/>`;
  }
  return s;
};

const speed: Draw = ({ W, H, r, pal, calm, wide }) => {
  let s = "";
  for (let i = 0; i < 16; i++) {
    const y = between(r, 16, calm - 12);
    const x = between(r, -60, W * 0.6);
    const len = between(r, 50, W * 0.7);
    s += line(x, y, x + len, y, stroke(r() < 0.3 ? pal.tone : pal.line, between(r, 3, 8), 'stroke-linecap="round"'));
  }
  // Checker band, then chevrons: the finish line and the push.
  const cy = wide ? H * 0.2 : calm - 40;
  const sq = 13;
  for (let x = 0, i = 0; x < W; x += sq, i++) {
    s += rect(x, cy + (i % 2 ? sq : 0), sq, sq, fill(pal.tone));
  }
  const chx = W * (wide ? 0.62 : 0.5);
  const chy = wide ? H * 0.52 : calm * 0.42;
  for (let i = 0; i < 3; i++) {
    const x = chx + i * 30;
    s += `<path d="${poly([[x, chy - 26], [x + 22, chy], [x, chy + 26]])}" ${stroke(i === 2 ? pal.accent : pal.tone, 9, 'stroke-linejoin="round" stroke-linecap="round"')}/>`;
  }
  return s;
};

const burst: Draw = ({ W, H, r, pal, fx, fy }) => {
  const rays = 22;
  const R = Math.hypot(W, H) * 1.2;
  const rot = r() * Math.PI;
  let d = "";
  for (let i = 0; i < rays; i++) {
    const a0 = rot + (i / rays) * Math.PI * 2;
    const a1 = a0 + (Math.PI / rays) * between(r, 0.45, 0.8);
    d += poly([[fx, fy], [fx + R * Math.cos(a0), fy + R * Math.sin(a0)], [fx + R * Math.cos(a1), fy + R * Math.sin(a1)]], true);
  }
  return `<path d="${d}" ${fill(pal.line)}/>` + circle(fx, fy, 30, fill(pal.tone)) + circle(fx, fy, 11, fill(pal.accent2));
};

const slashes: Draw = ({ W, H, r, pal, calm }) => {
  let s = "";
  const ang = -0.42;
  const hot = Math.floor(r() * 5);
  let x = between(r, -W * 0.3, -W * 0.1);
  for (let i = 0; i < 6; i++) {
    const w = i === hot ? 12 : between(r, 22, 70);
    const dx = Math.tan(-ang) * H;
    s += `<path d="${poly([[x, calm + 40], [x + w, calm + 40], [x + w + dx, calm + 40 - H], [x + dx, calm + 40 - H]], true)}" ${fill(i === hot ? pal.accent2 : i % 2 ? pal.tone : pal.line)}/>`;
    x += w + between(r, 18, 46);
  }
  return s;
};

const columns: Draw = ({ W, H, r, pal, wide, calm }) => {
  const base = wide ? H - 30 : calm - 10;
  const x0 = wide ? W * 0.46 : 26;
  const count = wide ? 9 : 8;
  const gap = 8;
  const bw = (W - 26 - x0 - gap * (count - 1)) / count;
  const top = wide ? 40 : 30;
  let s = line(0, base + 6, W, base + 6, stroke(pal.tone, 2));
  let v = between(r, 0.18, 0.32);
  for (let i = 0; i < count; i++) {
    v = Math.min(1, v + between(r, -0.06, 0.16));
    const h = (base - top) * v;
    const last = i === count - 1;
    s += rect(x0 + i * (bw + gap), base - h, bw, h, fill(last ? pal.accent : i % 3 === 1 ? pal.line : pal.tone, 'rx="2"'));
  }
  return s;
};

const eq: Draw = ({ W, r, pal, calm }) => {
  const bw = 9;
  const gap = 8;
  const mid = calm * 0.48;
  const f1 = between(r, 0.18, 0.35);
  const f2 = between(r, 0.5, 0.9);
  const p = r() * 6;
  let s = "";
  let i = 0;
  for (let x = 12; x < W - 8; x += bw + gap, i++) {
    const v = 0.25 + 0.45 * Math.abs(Math.sin(i * f1 + p)) + 0.3 * Math.abs(Math.sin(i * f2 + p * 2));
    const h = calm * 0.4 * v;
    const hot = i % 7 === 3;
    s += rect(x, mid - h, bw, h * 2, fill(hot ? pal.accent2 : v > 0.7 ? pal.tone : pal.line, `rx="${bw / 2}"`));
  }
  return s;
};

const waves: Draw = ({ W, r, pal, calm }) => {
  let s = "";
  const rows = 8;
  const hot = 2 + Math.floor(r() * 4);
  const freq = between(r, 1.2, 2.4);
  for (let k = 0; k < rows; k++) {
    const y0 = 26 + (k * (calm - 50)) / (rows - 1);
    const amp = between(r, 8, 22);
    const ph = r() * 6.28;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 48; i++) {
      const x = (i / 48) * (W + 20) - 10;
      pts.push([x, y0 + amp * Math.sin((x / W) * Math.PI * 2 * freq + ph)]);
    }
    s += `<path d="${poly(pts)}" ${stroke(k === hot ? pal.accent2 : pal.line, k === hot ? 3.2 : 2.4, 'stroke-linecap="round"')}/>`;
  }
  return s;
};

const circuit: Draw = ({ W, r, pal, calm }) => {
  const g = 24;
  let s = "";
  const hot = Math.floor(r() * 9);
  for (let t = 0; t < 10; t++) {
    let x = Math.floor(r() * (W / g)) * g;
    let y = Math.floor(r() * ((calm - 40) / g)) * g + g;
    const pts: [number, number][] = [[x, y]];
    const segs = 3 + Math.floor(r() * 3);
    for (let i = 0; i < segs; i++) {
      const dir = Math.floor(r() * 3);
      const len = (1 + Math.floor(r() * 3)) * g;
      if (dir === 0) x += len;
      else if (dir === 1) y += len * (r() < 0.5 ? -1 : 1);
      else {
        x += len;
        y += len * (r() < 0.5 ? -1 : 1);
      }
      y = Math.max(g / 2, Math.min(calm - 16, y));
      pts.push([x, y]);
    }
    const c = t === hot ? pal.accent : pal.tone;
    s += `<path d="${poly(pts)}" ${stroke(c, 2.6, 'stroke-linejoin="round" stroke-linecap="round"')}/>`;
    s += circle(pts[0][0], pts[0][1], 4.5, `fill="${pal.ground}" stroke="${c}" stroke-width="2.4"`);
    const e = pts[pts.length - 1];
    s += circle(e[0], e[1], 4.5, fill(c));
  }
  return s;
};

const graph: Draw = ({ W, H, pal, wide, top }) => {
  const g = 18;
  let d1 = "";
  let d2 = "";
  for (let x = 0, i = 0; x <= W; x += g, i++) {
    if (i % 4) d1 += `M${x} 0V${H}`;
    else d2 += `M${x} 0V${H}`;
  }
  for (let y = 0, i = 0; y <= H; y += g, i++) {
    if (i % 4) d1 += `M0 ${y}H${W}`;
    else d2 += `M0 ${y}H${W}`;
  }
  const mx = wide ? W - 72 : 54;
  return `<path d="${d1}" ${stroke(pal.line, 1)}/><path d="${d2}" ${stroke(pal.tone, 1.4)}/>` + line(mx, top, mx, H, stroke(pal.accent2, 2.4));
};

const shapes: Draw = ({ W, r, pal, calm, wide, top }) => {
  const cols = 3;
  const x0 = wide ? W * 0.6 : 0;
  const c = (W - x0) / cols;
  const rows = Math.max(1, Math.floor((calm - 10 - top) / c));
  const inks = [pal.tone, pal.line, pal.tone, pal.line, pal.text];
  let s = "";
  let hot = Math.floor(r() * cols * rows);
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const x = x0 + col * c;
      const y = calm - 10 - (rows - row) * c;
      const kind = Math.floor(r() * 6);
      const ink = hot-- === 0 ? pal.accent : pick(r, inks);
      const rot = Math.floor(r() * 4) * 90;
      const cx = x + c / 2;
      const cy = y + c / 2;
      const tf = `transform="rotate(${rot} ${n(cx)} ${n(cy)})"`;
      const q = c - 6;
      if (kind === 0) s += circle(cx, cy, q / 2, fill(ink));
      else if (kind === 1) s += `<path d="M${n(x + 3)} ${n(y + 3 + q)}A${n(q)} ${n(q)} 0 0 1 ${n(x + 3 + q)} ${n(y + 3)}V${n(y + 3 + q)}Z" ${fill(ink)} ${tf}/>`;
      else if (kind === 2) s += `<path d="M${n(x + 3)} ${n(cy)}A${n(q / 2)} ${n(q / 2)} 0 0 1 ${n(x + 3 + q)} ${n(cy)}Z" ${fill(ink)} ${tf}/>`;
      else if (kind === 3) s += `<path d="${poly([[x + 3, y + 3 + q], [x + 3 + q, y + 3 + q], [x + 3, y + 3]], true)}" ${fill(ink)} ${tf}/>`;
      else if (kind === 4) s += rect(x + 3, y + 3, q, q, fill(ink, 'rx="3"'));
      else s += circle(cx, cy, q / 2 - 6, stroke(ink, 10));
    }
  return s;
};

const orbit: Draw = ({ W, H, r, pal, fx, fy }) => {
  let s = "";
  for (let i = 0; i < 40; i++) s += circle(r() * W, r() * H * 0.7, between(r, 0.8, 2), fill(pal.tone));
  const tilt = between(r, -28, -12);
  const hot = Math.floor(r() * 3);
  for (let k = 0; k < 3; k++) {
    const rx = W * (0.24 + k * 0.17);
    const ry = rx * 0.36;
    s += `<ellipse cx="${n(fx)}" cy="${n(fy)}" rx="${n(rx)}" ry="${n(ry)}" ${stroke(pal.line, 2)} transform="rotate(${n(tilt)} ${n(fx)} ${n(fy)})"/>`;
    const a = r() * Math.PI * 2;
    const t = (tilt * Math.PI) / 180;
    const px = fx + rx * Math.cos(a) * Math.cos(t) - ry * Math.sin(a) * Math.sin(t);
    const py = fy + rx * Math.cos(a) * Math.sin(t) + ry * Math.sin(a) * Math.cos(t);
    s += circle(px, py, k === hot ? 9 : 6, fill(k === hot ? pal.accent2 : pal.tone));
  }
  return s + circle(fx, fy, 18, fill(pal.tone));
};

const pulse: Draw = ({ W, r, pal, calm }) => {
  const y = calm * 0.5;
  const g = 16;
  let d = "";
  for (let x = 0; x <= W; x += g) d += `M${x} 0V${calm}`;
  for (let yy = 0; yy <= calm; yy += g) d += `M0 ${yy}H${W}`;
  let s = `<path d="${d}" ${stroke(pal.line, 1)}/>`;
  const pts: [number, number][] = [[-10, y]];
  let x = between(r, 20, 60);
  while (x < W + 10) {
    pts.push([x, y], [x + 8, y - 12], [x + 16, y], [x + 24, y], [x + 32, y + 18], [x + 42, y - calm * 0.36], [x + 52, y + 26], [x + 60, y], [x + 76, y], [x + 88, y - 16], [x + 102, y]);
    x += between(r, 130, 170);
  }
  s += `<path d="${poly(pts)}" ${stroke(pal.tone, 9, 'stroke-linejoin="round" stroke-linecap="round" opacity=".6"')}/>`;
  return s + `<path d="${poly(pts)}" ${stroke(pal.accent2, 3.4, 'stroke-linejoin="round" stroke-linecap="round"')}/>`;
};

const arches: Draw = ({ W, r, pal, calm, wide }) => {
  const cx = wide ? W * between(r, 0.62, 0.8) : W * between(r, 0.3, 0.7);
  const base = calm - 6;
  let s = "";
  const bands = 6;
  for (let k = 0; k < bands; k++) {
    const R = (wide ? 190 : 170) - k * 26;
    const c = k === bands - 1 ? pal.accent2 : k % 2 ? pal.tone : pal.line;
    s += `<path d="M${n(cx - R)} ${n(base)}A${n(R)} ${n(R)} 0 0 1 ${n(cx + R)} ${n(base)}Z" ${fill(c)}/>`;
  }
  return s + line(0, base, W, base, stroke(pal.tone, 3));
};

const iso: Draw = ({ W, H, r, pal, calm, wide }) => {
  const a = 22;
  const hx = a * Math.cos(Math.PI / 6);
  let d = "";
  for (let k = -H; k < W + H; k += hx * 2) {
    d += `M${n(k)} 0L${n(k + H * Math.sqrt(3))} ${H}`;
    d += `M${n(k)} 0L${n(k - H * Math.sqrt(3))} ${H}`;
  }
  let s = `<path d="${d}" ${stroke(pal.line, 1.2)}/>`;
  const cube = (cx: number, cy: number, sz: number, top: string) => {
    const h = sz * Math.cos(Math.PI / 6);
    const t: [number, number][] = [[cx, cy - sz], [cx + h, cy - sz / 2], [cx, cy], [cx - h, cy - sz / 2]];
    const lf: [number, number][] = [[cx - h, cy - sz / 2], [cx, cy], [cx, cy + sz], [cx - h, cy + sz / 2]];
    const rt: [number, number][] = [[cx + h, cy - sz / 2], [cx, cy], [cx, cy + sz], [cx + h, cy + sz / 2]];
    return `<path d="${poly(t, true)}" ${fill(top)}/><path d="${poly(lf, true)}" ${fill(pal.tone)}/><path d="${poly(rt, true)}" ${fill(pal.line)}/>`;
  };
  const sz = 34;
  const hot = Math.floor(r() * 4);
  const ox = wide ? W * 0.7 : W * between(r, 0.4, 0.62);
  const oy = wide ? H * 0.46 : calm * 0.46;
  const offs: [number, number][] = [[0, 0], [-1, 0.5], [1, 0.5], [0, 1], [0, -1.25]];
  offs.forEach(([ix, iy], i) => {
    if (i === 4 && r() < 0.4) return;
    s += cube(ox + ix * sz * Math.cos(Math.PI / 6), oy + iy * sz, sz, i === hot ? pal.accent2 : pal.line);
  });
  return s;
};

const press: Draw = ({ W, r, pal, calm, wide, top }) => {
  const x0 = wide ? W * 0.44 : 26;
  const x1 = W - 26;
  const t = wide ? 24 : top;
  let s = rect(x0, t, x1 - x0, 7, fill(pal.tone));
  s += rect(x0, t + 16, (x1 - x0) * between(r, 0.6, 0.9), 16, fill(pal.tone, 'rx="2"'));
  s += rect(x0, t + 38, (x1 - x0) * between(r, 0.35, 0.6), 16, fill(pal.tone, 'rx="2"'));
  const cols = wide ? 3 : 2;
  const gw = 14;
  const cw = (x1 - x0 - gw * (cols - 1)) / cols;
  const photo = Math.floor(r() * cols);
  for (let c = 0; c < cols; c++) {
    const cx = x0 + c * (cw + gw);
    let y = t + 70;
    if (c === photo) {
      s += rect(cx, y, cw, cw * 0.62, fill(pal.accent2, 'rx="2"'));
      y += cw * 0.62 + 10;
    }
    while (y < calm - 18) {
      s += rect(cx, y, cw * (r() < 0.2 ? between(r, 0.4, 0.8) : 1), 5, fill(pal.line, 'rx="2.5"'));
      y += 12;
    }
  }
  return s;
};

const film: Draw = ({ W, r, pal, calm }) => {
  const h = 116;
  const cy = calm * between(r, 0.36, 0.5);
  const rot = between(r, -14, -8);
  const len = W * 1.6;
  const x = -W * 0.3;
  let s = rect(x, cy - h / 2, len, h, fill(pal.tone));
  for (let hx = x + 6; hx < x + len; hx += 18) {
    s += rect(hx, cy - h / 2 + 7, 9, 11, fill(pal.ground, 'rx="2"'));
    s += rect(hx, cy + h / 2 - 18, 9, 11, fill(pal.ground, 'rx="2"'));
  }
  const fw = 96;
  const hot = 1 + Math.floor(r() * 3);
  for (let i = 0, fx = x + 14; fx < x + len; fx += fw + 8, i++) s += rect(fx, cy - h / 2 + 26, fw, h - 52, fill(i === hot ? pal.accent2 : pal.line, 'rx="2"'));
  return `<g transform="rotate(${n(rot)} ${n(W / 2)} ${n(cy)})">${s}</g>`;
};

const rings: Draw = ({ W, r, pal, fx, fy }) => {
  let s = "";
  const hot = 3 + Math.floor(r() * 4);
  for (let k = 1; k < 18; k++) {
    const R = k * (W / 22);
    s += circle(fx, fy, R, stroke(k === hot ? pal.accent2 : k % 4 === 0 ? pal.tone : pal.line, k === hot ? 3.4 : k % 4 === 0 ? 3 : 1.8));
  }
  return s;
};

const crosshair: Draw = ({ W, pal, fx, fy }) => {
  const R = W * 0.36;
  let s = circle(fx, fy, R, stroke(pal.line, 2.4)) + circle(fx, fy, R * 0.62, stroke(pal.tone, 3)) + circle(fx, fy, R * 1.5, stroke(pal.line, 2));
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const l = i % 6 === 0 ? 14 : 6;
    s += line(fx + R * Math.cos(a), fy + R * Math.sin(a), fx + (R + l) * Math.cos(a), fy + (R + l) * Math.sin(a), stroke(pal.line, 2));
  }
  const g = R * 0.2;
  s += line(fx - R * 1.8, fy, fx - g, fy, stroke(pal.tone, 3)) + line(fx + g, fy, fx + R * 1.8, fy, stroke(pal.tone, 3));
  s += line(fx, fy - R * 1.8, fx, fy - g, stroke(pal.tone, 3)) + line(fx, fy + g, fx, fy + R * 1.8, stroke(pal.tone, 3));
  return s + circle(fx, fy, 6, fill(pal.accent));
};

const zone: Draw = ({ W, H, r, pal, fx, fy }) => {
  let d = "";
  for (let x = 0; x <= W; x += 40) d += `M${x} 0V${H}`;
  for (let y = 0; y <= H; y += 40) d += `M0 ${y}H${W}`;
  let s = `<path d="${d}" ${stroke(pal.line, 1.2)}/>`;
  let cx = fx + between(r, -40, 40);
  let cy = fy + between(r, -30, 30);
  let R = W * 0.62;
  for (let k = 0; k < 4; k++) {
    const last = k === 3;
    s += circle(cx, cy, R, last ? stroke(pal.accent, 3.4) : k === 0 ? stroke(pal.tone, 2.6, 'stroke-dasharray="8 8"') : stroke(pal.tone, 2.6));
    const nr = R * between(r, 0.5, 0.62);
    const a = r() * Math.PI * 2;
    cx += Math.cos(a) * (R - nr) * 0.7;
    cy += Math.sin(a) * (R - nr) * 0.7;
    R = nr;
  }
  return s;
};

const vinyl: Draw = ({ W, pal, fx, fy }) => {
  const R = W * 0.5;
  let s = circle(fx, fy, R, fill(pal.tone));
  for (let k = R * 0.4; k < R - 4; k += 6) s += circle(fx, fy, k, stroke(pal.line, 1.4));
  return s + circle(fx, fy, R * 0.3, fill(pal.accent2)) + circle(fx, fy, 5, fill(pal.ground));
};

const signal: Draw = ({ r, pal, fx, fy }) => {
  let s = "";
  const hot = 2 + Math.floor(r() * 3);
  const face = r() < 0.5 ? 0 : Math.PI;
  for (let k = 1; k <= 8; k++) {
    const R = k * 30;
    const a0 = face - 0.9;
    const a1 = face + 0.9;
    s += `<path d="M${n(fx + R * Math.cos(a0))} ${n(fy + R * Math.sin(a0))}A${R} ${R} 0 0 1 ${n(fx + R * Math.cos(a1))} ${n(fy + R * Math.sin(a1))}" ${stroke(k === hot ? pal.accent2 : k % 2 ? pal.tone : pal.line, k === hot ? 7 : 5, 'stroke-linecap="round"')}/>`;
  }
  return s + circle(fx, fy, 10, fill(pal.tone));
};

// Sports grounds, line-drawn in the ground's own ink.
const field: Draw = (c, spec) => {
  const { W, H, pal, calm, r } = c;
  const ink = pal.text;
  const L = (w = 3) => stroke(ink, w, 'opacity=".24"');
  const hotFill = fill(pal.accent2);
  const sport = spec.sport ?? pick(r, ["football", "track", "gridiron"] as const);
  const m = 22;
  let s = "";
  switch (sport) {
    case "football": {
      const top = 18;
      s += rect(m, top, W - 2 * m, H * 1.2, L());
      const bw = W * 0.62;
      s += rect((W - bw) / 2, top, bw, calm * 0.3, L());
      s += rect((W - bw * 0.42) / 2, top, bw * 0.42, calm * 0.12, L());
      s += `<path d="M${n(W / 2 - 46)} ${n(top + calm * 0.3)}A56 56 0 0 0 ${n(W / 2 + 46)} ${n(top + calm * 0.3)}" ${L()}/>`;
      const mid = calm * 0.82;
      s += line(m, mid, W - m, mid, L()) + circle(W / 2, mid, W * 0.2, L());
      s += circle(W / 2, top + calm * 0.21, 5, hotFill) + circle(W / 2, mid, 6, hotFill);
      break;
    }
    case "basketball": {
      const top = 18;
      s += rect(m, top, W - 2 * m, H * 1.2, L());
      const kw = W * 0.34;
      s += rect((W - kw) / 2, top, kw, calm * 0.46, L());
      s += circle(W / 2, top + calm * 0.46, kw / 2, L());
      const R = W * 0.44;
      s += `<path d="M${n(W / 2 - R)} ${top}V${n(top + 30)}A${n(R)} ${n(R)} 0 0 0 ${n(W / 2 + R)} ${n(top + 30)}V${top}" ${L()}/>`;
      s += circle(W / 2, top + 26, 10, stroke(pal.accent2, 4));
      break;
    }
    case "gridiron": {
      const gap = 40;
      const hot = 1 + Math.floor(r() * 4);
      for (let i = 0, y = 26; y < calm + 20; y += gap, i++) {
        s += line(0, y, W, y, i === hot ? stroke(pal.accent2, 4) : L(i % 2 ? 2 : 3.5));
        for (const fx of [W * 0.34, W * 0.66]) for (let t = 1; t < 5; t++) s += line(fx - 6, y + (t * gap) / 5, fx + 6, y + (t * gap) / 5, L(2));
      }
      break;
    }
    case "cricket": {
      s += `<ellipse cx="${n(W / 2)}" cy="${n(calm * 0.5)}" rx="${n(W * 0.62)}" ry="${n(calm * 0.62)}" ${L()}/>`;
      s += `<ellipse cx="${n(W / 2)}" cy="${n(calm * 0.5)}" rx="${n(W * 0.34)}" ry="${n(calm * 0.36)}" ${L(2)} stroke-dasharray="6 7"/>`;
      s += rect(W / 2 - 16, calm * 0.5 - calm * 0.22, 32, calm * 0.44, fill(pal.tone));
      s += line(W / 2 - 24, calm * 0.5 - calm * 0.17, W / 2 + 24, calm * 0.5 - calm * 0.17, stroke(pal.accent2, 3));
      s += line(W / 2 - 24, calm * 0.5 + calm * 0.17, W / 2 + 24, calm * 0.5 + calm * 0.17, stroke(pal.accent2, 3));
      break;
    }
    case "tennis": {
      const x0 = W * 0.14;
      const x1 = W * 0.86;
      s += rect(x0, 18, x1 - x0, H * 1.1, L());
      s += line(x0 + (x1 - x0) * 0.12, 18, x0 + (x1 - x0) * 0.12, H, L(2)) + line(x1 - (x1 - x0) * 0.12, 18, x1 - (x1 - x0) * 0.12, H, L(2));
      s += line(x0 + (x1 - x0) * 0.12, calm * 0.36, x1 - (x1 - x0) * 0.12, calm * 0.36, L(2));
      s += line(W / 2, calm * 0.36, W / 2, calm * 0.82, L(2));
      s += line(0, calm * 0.82, W, calm * 0.82, stroke(pal.accent2, 5));
      break;
    }
    case "track": {
      const cy = calm * 0.5;
      const hot = Math.floor(r() * 6);
      for (let k = 0; k < 7; k++) {
        const rw = W * 0.34 + k * 14;
        const rh = calm * 0.2 + k * 14;
        s += rect(W / 2 - rw, cy - rh, rw * 2, rh * 2, k === hot ? stroke(pal.accent2, 3.4, `rx="${n(rh)}"`) : L(2.4).replace('opacity', `rx="${n(rh)}" opacity`));
      }
      break;
    }
    case "ring": {
      for (let k = 0; k < 3; k++) {
        const y = calm * (0.28 + k * 0.2);
        s += line(-10, y + 30, W + 10, y - 30, k === 0 ? stroke(pal.accent2, 6, 'stroke-linecap="round"') : stroke(ink, 6, 'opacity=".24" stroke-linecap="round"'));
      }
      s += rect(W * 0.8, 0, 16, calm, fill(pal.tone, 'rx="4"'));
      break;
    }
    case "motor": {
      const d = `M${n(-40)} ${n(calm * 0.82)}C${n(W * 0.3)} ${n(calm * 0.9)} ${n(W * 0.2)} ${n(calm * 0.2)} ${n(W * 0.6)} ${n(calm * 0.24)}S${n(W + 40)} ${n(calm * 0.5)} ${n(W + 60)} ${n(calm * 0.1)}`;
      s += `<path d="${d}" ${stroke(pal.tone, 46, 'stroke-linecap="round"')}/>`;
      s += `<path d="${d}" ${stroke(pal.accent2, 5, 'stroke-dasharray="12 12" transform="translate(0 -26)"')}/>`;
      s += `<path d="${d}" ${stroke(ink, 2.4, 'opacity=".4" stroke-dasharray="16 14"')}/>`;
      break;
    }
    case "golf": {
      const cx = W * between(r, 0.4, 0.62);
      const cy = calm * 0.46;
      for (let k = 0; k < 5; k++) s += `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(40 + k * 34)}" ry="${n(26 + k * 24)}" ${L(k === 0 ? 3 : 2)}/>`;
      s += line(cx, cy, cx, cy - 92, stroke(ink, 3, 'opacity=".6"'));
      s += `<path d="${poly([[cx, cy - 92], [cx + 38, cy - 80], [cx, cy - 68]], true)}" ${hotFill}/>` + circle(cx, cy, 5, fill(pal.tone));
      break;
    }
    case "diamond": {
      const cx = W / 2;
      const cy = calm * 0.52;
      const h = W * 0.3;
      s += `<path d="${poly([[cx, cy - h], [cx + h, cy], [cx, cy + h], [cx - h, cy]], true)}" ${L()}/>`;
      s += `<path d="M${n(cx - h * 1.5)} ${n(cy + h * 0.2)}A${n(h * 1.6)} ${n(h * 1.6)} 0 0 1 ${n(cx + h * 1.5)} ${n(cy + h * 0.2)}" ${L(2)}/>`;
      for (const [bx, by] of [[cx + h, cy], [cx, cy - h], [cx - h, cy]] as [number, number][]) s += rect(bx - 7, by - 7, 14, 14, fill(ink, `opacity=".5" transform="rotate(45 ${n(bx)} ${n(by)})"`));
      s += circle(cx, cy, 13, fill(pal.tone)) + `<path d="${poly([[cx - 9, cy + h - 6], [cx + 9, cy + h - 6], [cx + 9, cy + h + 3], [cx, cy + h + 10], [cx - 9, cy + h + 3]], true)}" ${hotFill}/>`;
      break;
    }
  }
  return s;
};

const MOTIFS: Record<Motif, Draw> = {
  dots, contour, candles, hex, lattice, pixels, claws, speed, field, burst, slashes, columns,
  eq, waves, circuit, graph, shapes, orbit, pulse, arches, iso, press, film, rings, crosshair,
  zone, vinyl, signal,
};

// ── type ────────────────────────────────────────────────────────────────

function norm(text: string) {
  return text.toUpperCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-");
}

/** Width of a line in font units, or null if a glyph is missing. */
function unitsWide(text: string, tracking: number) {
  let w = 0;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) return null;
    w += g[0] + tracking;
  }
  return w - tracking;
}

class Type {
  used = new Set<string>();
  defs() {
    let d = "";
    for (const ch of this.used) {
      const g = GLYPHS[ch];
      if (g && g[1]) d += `<path id="g${ch.codePointAt(0)}" d="${g[1]}"/>`;
    }
    return d;
  }
  /** A line at (x, baseline), `size` = em in cover units. */
  line(text: string, x: number, baseline: number, size: number, paint: string, opts: { tracking?: number; maxW?: number; anchor?: "start" | "end" } = {}) {
    const tr = (opts.tracking ?? 0) * 1000;
    const units = unitsWide(text, tr);
    if (units === null) {
      // Outside the outlined set: fall back to live text in the same face.
      const a = opts.anchor === "end" ? ' text-anchor="end"' : "";
      return `<text x="${n(x)}" y="${n(baseline)}" font-family="Archivo, 'Arial Black', system-ui, sans-serif" font-weight="800" font-size="${n(size)}"${a} ${paint}>${esc(text)}</text>`;
    }
    const k = size / 1000;
    const squeeze = opts.maxW && units * k > opts.maxW ? opts.maxW / (units * k) : 1;
    const wpx = units * k * squeeze;
    const x0 = opts.anchor === "end" ? x - wpx : x;
    let s = `<g transform="translate(${n(x0)} ${n(baseline)}) scale(${(k * squeeze).toFixed(5)} ${k.toFixed(5)})" ${paint}>`;
    let ux = 0;
    for (const ch of text) {
      const g = GLYPHS[ch];
      if (g[1]) {
        this.used.add(ch);
        s += `<use href="#g${ch.codePointAt(0)}"${ux ? ` x="${Math.round(ux)}"` : ""}/>`;
      }
      ux += g[0] + tr;
    }
    return s + "</g>";
  }
}

/** Break the name into lines at the largest size that fits. */
/**
 * Words that break together: "&" and "+" stay with the word after them,
 * and a short tail ("2", "V") stays with the word before it.
 */
function tokens(text: string) {
  const raw = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if ((w === "&" || w === "+") && i + 1 < raw.length) {
      out.push(`${w} ${raw[++i]}`);
    } else if (i === raw.length - 1 && w.length <= 2 && out.length) {
      out[out.length - 1] += ` ${w}`;
    } else out.push(w);
  }
  return out;
}

function fitName(text: string, maxW: number, maxLines: number, sMax: number, sMin: number, tracking: number) {
  const words = tokens(text);
  const tr = tracking * 1000;
  const wide = (s: string) => unitsWide(s, tr) ?? s.length * 820;
  for (let size = sMax; size >= sMin; size -= 1) {
    const k = size / 1000;
    const lines: string[] = [];
    let cur = "";
    let ok = true;
    for (const w of words) {
      const tryLine = cur ? `${cur} ${w}` : w;
      if (wide(tryLine) * k <= maxW) cur = tryLine;
      else {
        if (!cur || wide(w) * k > maxW) {
          ok = false;
          break;
        }
        lines.push(cur);
        cur = w;
      }
    }
    if (ok && cur) lines.push(cur);
    if (ok && lines.length <= maxLines) return { lines, size };
  }
  // Too long even small: one word per line at the floor, squeezed to fit.
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && wide(t) * (sMin / 1000) > maxW) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return { lines, size: sMin };
}

function icon(name: string, x: number, y: number, size: number, color: string) {
  const body = ICONS[name];
  if (!body) return "";
  return `<g transform="translate(${n(x)} ${n(y)}) scale(${(size / 24).toFixed(4)})" color="${color}" fill="currentColor">${body}</g>`;
}

// ── the cover ───────────────────────────────────────────────────────────

/** The cover's frame: short side 360 units, long side to the requested shape. */
export function coverFrame(w: number, h: number) {
  const ratio = Math.max(0.25, Math.min(4, (w || 1) / (h || 1)));
  return ratio >= 1 ? { W: Math.round(360 * ratio), H: 360 } : { W: 360, H: Math.round(360 / ratio) };
}

const cache = new Map<string, string>();
const KICKER_SLOT = "<!--k-->";

export function coverSvg(category: string, opts: CoverOptions): string {
  const theme: CoverTheme = opts.theme === "light" ? "light" : "dark";
  const compact = Math.min(opts.w, opts.h) < 200;
  const { W, H } = coverFrame(opts.w, opts.h);
  const key = `${category}|${W}x${H}|${compact ? 1 : 0}|${theme}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const spec = coverSpec(category);
  const pal = SCHEMES[spec.scheme][theme];
  const wide = W > H;
  const r = rng(spec.seed);
  const pad = wide ? 30 : 26;
  const type = new Type();

  // The name first: its height decides how much room the motif gets.
  const name = norm(spec.name);
  const nameTrack = -0.01;
  const fit = compact
    ? { lines: [] as string[], size: 0 }
    : wide
      ? fitName(name, W * 0.6 - pad, 3, 62, 30, nameTrack)
      : fitName(name, W - pad * 2, 3, 54, 28, nameTrack);
  const lead = fit.size * 0.96;
  const capPx = (fit.size * CAP_HEIGHT) / 1000;
  const nameTop = compact ? H : H - pad - capPx - lead * (fit.lines.length - 1);
  const calm = compact ? H : wide ? H : nameTop - 22;

  // Hot spot: upper area for portraits, right half for landscapes.
  const fx = wide ? W * between(r, 0.62, 0.8) : W * between(r, 0.3, 0.7);
  const fy = wide ? H * between(r, 0.3, 0.55) : calm * between(r, 0.3, 0.55);
  const nameRight = wide ? W * 0.62 : W;
  const clear = (x: number, y: number) => compact || !(x < nameRight && y > nameTop - 30);
  const top = compact ? 0 : pad + 36;
  const ctx: Ctx = { W, H, wide, compact, r, pal, fx, fy, calm, clear, top };

  let body = rect(0, 0, W, H, fill(pal.ground));
  body += MOTIFS[spec.motif](ctx, spec);

  if (compact) {
    // Thumbs: the mark alone, centred and big.
    if (spec.mono) {
      const size = fitMono(spec.mono, W * 0.8, H * 0.5);
      const units = unitsWide(spec.mono, -10) ?? 0;
      body += type.line(spec.mono, (W - (units * size) / 1000) / 2, H / 2 + (size * CAP_HEIGHT) / 2000, size, `fill="${pal.accent}"`, { tracking: -0.01 });
    } else {
      const s = Math.min(W, H) * 0.56;
      body += icon(spec.icon, (W - s) / 2, (H - s) / 2, s, pal.accent);
    }
  } else {
    // Kicker, top left: the family (or a game's genre) and a hot tick.
    body += KICKER_SLOT;
    const kSize = wide ? 19 : 17;
    const kCap = (kSize * CAP_HEIGHT) / 1000;
    const kBase = pad + kCap;
    const kx = pad + (spec.genre ? kSize + 7 : 15);
    if (spec.genre) body += icon(GENRES[spec.genre].icon, pad - 2, kBase - kCap / 2 - (kSize + 3) / 2, kSize + 3, pal.accent);
    else body += rect(pad, kBase - kCap, 8, kCap, fill(pal.accent));
    // A ground-coloured tab under the kicker keeps it off the motif.
    const kw = ((unitsWide(norm(spec.kicker), 100) ?? 0) * kSize) / 1000;
    body = body.replace(KICKER_SLOT, rect(pad - 8, kBase - kCap - 8, kx - pad + kw + 18, kCap + 16, fill(pal.ground, 'rx="4"')));
    body += type.line(norm(spec.kicker), kx, kBase, kSize, `fill="${pal.sub}"`, { tracking: 0.1 });

    // Hero: a game's monogram, else the topic's icon.
    if (spec.mono) {
      const boxW = wide ? W * 0.38 : W - pad * 2;
      const boxH = wide ? H * 0.4 : (calm - kBase - 30) * 0.8;
      const size = fitMono(spec.mono, boxW, boxH);
      const cap = (size * CAP_HEIGHT) / 1000;
      const units = unitsWide(spec.mono, -10) ?? 0;
      const x = wide ? W - pad - (units * size) / 1000 : pad;
      const y = wide ? kBase + 30 + cap : kBase + 22 + cap + ((calm - kBase - 22 - cap) * 0.35);
      body += type.line(spec.mono, x, y, size, `fill="${pal.ground}" stroke="${pal.accent}" stroke-width="${n((5.5 * 1000) / size)}" stroke-linejoin="round" paint-order="stroke"`, { tracking: -0.01 });
    } else {
      const s = wide ? H * 0.42 : Math.min(W * 0.42, (calm - kBase) * 0.62);
      const x = wide ? W - pad - s - 6 : pad - s * 0.04;
      const y = wide ? (H - s) / 2 + 6 : kBase + 24 + Math.max(0, (calm - kBase - 24 - s) * 0.5);
      body += circle(x + s / 2, y + s / 2, s * 0.66, fill(pal.ground)) + icon(spec.icon, x, y, s, pal.accent);
    }

    // The name, bottom left.
    const maxW = wide ? W * 0.6 - pad : W - pad * 2;
    fit.lines.forEach((ln, i) => {
      const base = nameTop + capPx + lead * i;
      body += type.line(ln, pad, base, fit.size, `fill="${pal.text}"`, { tracking: nameTrack, maxW });
    });
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">` +
    `<title>${esc(spec.name)}</title>` +
    (type.used.size ? `<defs>${type.defs()}</defs>` : "") +
    body +
    `</svg>`;
  if (cache.size > 2000) cache.clear();
  cache.set(key, svg);
  return svg;
}

/** Largest size at which a monogram fits the box. */
function fitMono(mono: string, boxW: number, boxH: number) {
  const units = unitsWide(mono, -10) ?? mono.length * 800;
  return Math.max(20, Math.min((boxW * 1000) / units, (boxH * 1000) / CAP_HEIGHT));
}

/** The cover as a data URI — for places that can't make a request. */
export function coverDataUri(category: string, opts: CoverOptions) {
  return `data:image/svg+xml,${encodeURIComponent(coverSvg(category, opts)).replace(/%20/g, " ").replace(/%3D/g, "=").replace(/%3A/g, ":").replace(/%2F/g, "/")}`;
}
