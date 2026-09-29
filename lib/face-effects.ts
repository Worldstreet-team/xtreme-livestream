/**
 * Face effects: things the host wears on camera — a crown, shades, puppy
 * ears — drawn into the picture itself (lib/looks.ts), so viewers, the
 * recording and the WorldSpace relay all see them, locked to the face the
 * tracker finds (lib/face-anchors.ts): its tilt, its size, where it is.
 *
 * Here: which effects there are, their art, and where each piece sits on a
 * face. Pure, so it's tested in Node; the drawing is the look's WebGL pass.
 *
 * Art is either Google's Noto emoji (the same family as our gifts, as small
 * vector files that stay sharp at any size) or drawn here as SVG.
 */

export type FaceEffectId =
  | "none"
  | "crown"
  | "shades"
  | "hearts"
  | "puppy"
  | "bunny"
  | "cat"
  | "devil"
  | "halo"
  | "flowers"
  | "fire"
  | "sparkles"
  | "mustache"
  | "blush";

/** Each effect with its name and the Noto emoji its tile shows (null: "None"). */
export const FACE_EFFECTS: { id: FaceEffectId; label: string; icon: string | null }[] = [
  { id: "none", label: "None", icon: null },
  { id: "crown", label: "Crown", icon: "1f451" },
  { id: "shades", label: "Shades", icon: "1f60e" },
  { id: "hearts", label: "Heart eyes", icon: "1f60d" },
  { id: "puppy", label: "Puppy", icon: "1f436" },
  { id: "bunny", label: "Bunny", icon: "1f430" },
  { id: "cat", label: "Cat", icon: "1f431" },
  { id: "devil", label: "Devil", icon: "1f608" },
  { id: "halo", label: "Halo", icon: "1f607" },
  { id: "flowers", label: "Flowers", icon: "1f338" },
  { id: "fire", label: "On fire", icon: "1f525" },
  { id: "sparkles", label: "Sparkle", icon: "2728" },
  { id: "mustache", label: "Mustache", icon: "1f978" },
  { id: "blush", label: "Blush", icon: "1f60a" },
];

export function isFaceEffect(v: unknown): v is FaceEffectId {
  return FACE_EFFECTS.some((e) => e.id === v);
}

/* ---- the art ------------------------------------------------------------ */

export type ArtId =
  | "crown"
  | "heart"
  | "fire"
  | "blossom"
  | "daisy"
  | "hibiscus"
  | "sparkles"
  | "shades"
  | "puppyEar"
  | "puppyNose"
  | "bunnyEar"
  | "pinkNose"
  | "catEar"
  | "whiskers"
  | "horn"
  | "halo"
  | "mustache"
  | "blush";

/** Where a piece of art comes from, and its height over its width. */
export interface ArtDef {
  /** A Noto emoji code (fonts.gstatic.com/s/e/notoemoji/latest/<code>/emoji.svg), or our own SVG. */
  noto?: string;
  svg?: string;
  aspect: number;
}

const svg = (viewBox: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;

export const ART: Record<ArtId, ArtDef> = {
  crown: { noto: "1f451", aspect: 1 },
  heart: { noto: "2764_fe0f", aspect: 1 },
  fire: { noto: "1f525", aspect: 1 },
  blossom: { noto: "1f338", aspect: 1 },
  daisy: { noto: "1f33c", aspect: 1 },
  hibiscus: { noto: "1f33a", aspect: 1 },
  sparkles: { noto: "2728", aspect: 1 },
  // Two black lenses on a bar with a glint on each: the gift effects' shades.
  shades: {
    aspect: 64 / 200,
    svg: svg(
      "0 0 200 64",
      `<path d="M2 9.5C2 7 4 5 6.5 5h187c2.5 0 4.5 2 4.5 4.5v3c0 2.5-2 4.5-4.5 4.5H6.5C4 17 2 15 2 12.5z" fill="#0b0708"/>
      <path d="M10 12h80c2.8 0 4.6 2.8 3.6 5.4L84 48c-2 6-7.5 10-13.8 10H32.2c-6.6 0-12.3-4.4-14-10.8L7 16.6C6.3 14.3 7.8 12 10 12z" fill="#0b0708"/>
      <path d="M110 12h80c2.2 0 3.7 2.3 3 4.6l-11.2 30.6c-1.7 6.4-7.4 10.8-14 10.8h-37.6c-6.3 0-11.8-4-13.8-10l-9.6-30.6c-1-2.6.8-5.4 3.6-5.4z" fill="#0b0708"/>
      <path d="M22 20h14L27 46h-8z" fill="#fff" opacity="0.3"/><path d="M122 20h14l-9 26h-8z" fill="#fff" opacity="0.3"/>`
    ),
  },
  // A floppy left ear, hanging; the right one is this mirrored.
  puppyEar: {
    aspect: 170 / 100,
    svg: svg(
      "0 0 100 170",
      `<path d="M62 6C84 2 98 18 96 42c-3 40-10 78-24 106-9 18-30 22-44 10C12 144 4 118 6 90 9 52 30 12 62 6z" fill="#7a4a2e"/>
      <path d="M60 30c16-2 24 10 22 28-3 30-9 58-19 78-6 12-19 14-27 6-9-9-13-28-11-48 3-30 17-60 35-64z" fill="#b97a55"/>
      <path d="M64 12c10 0 18 6 20 16" stroke="#9a6341" stroke-width="5" fill="none" stroke-linecap="round" opacity=".6"/>`
    ),
  },
  puppyNose: {
    aspect: 70 / 100,
    svg: svg(
      "0 0 100 70",
      `<path d="M50 66C30 66 6 50 6 28 6 12 22 4 50 4s44 8 44 24c0 22-24 38-44 38z" fill="#1b1414"/>
      <ellipse cx="36" cy="20" rx="13" ry="7" fill="#fff" opacity=".35"/>
      <path d="M36 44c5 5 23 5 28 0" stroke="#000" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>`
    ),
  },
  // A tall left ear, leaning in; the right one is this mirrored.
  bunnyEar: {
    aspect: 200 / 64,
    svg: svg(
      "0 0 64 200",
      `<path d="M32 4C52 4 60 40 60 96c0 58-10 100-28 100S4 154 4 96C4 40 12 4 32 4z" fill="#f6f1ec" stroke="#e6dcd4" stroke-width="3"/>
      <path d="M32 26c11 0 16 28 16 72 0 42-6 78-16 78s-16-36-16-78c0-44 5-72 16-72z" fill="#f4a6b8"/>`
    ),
  },
  pinkNose: {
    aspect: 60 / 80,
    svg: svg("0 0 80 60", `<path d="M40 56C26 56 6 36 6 20 6 10 18 4 40 4s34 6 34 16c0 16-20 36-34 36z" fill="#f28aa5"/><ellipse cx="30" cy="16" rx="10" ry="5" fill="#fff" opacity=".45"/>`),
  },
  // A pointed left ear; the right one is this mirrored.
  catEar: {
    aspect: 110 / 100,
    svg: svg(
      "0 0 100 110",
      `<path d="M8 104L22 8c1-6 8-8 12-3l58 74c4 5 1 13-6 14z" fill="#2a2224"/>
      <path d="M26 88L34 32l36 46z" fill="#f4a6b8"/>`
    ),
  },
  // Three whiskers fanning out to the left; the right side is this mirrored.
  whiskers: {
    aspect: 60 / 120,
    svg: svg(
      "0 0 120 60",
      `<g stroke="#241c1e" stroke-width="3.2" stroke-linecap="round" fill="none" opacity=".85">
        <path d="M114 22C84 16 44 10 6 12"/><path d="M114 30C82 30 44 32 4 36"/><path d="M114 38C84 44 46 52 8 58"/></g>`
    ),
  },
  // A left horn curling up and out; the right one is this mirrored.
  horn: {
    aspect: 120 / 90,
    svg: svg(
      "0 0 90 120",
      `<defs><linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#b30e1f"/><stop offset="1" stop-color="#ff5a66"/></linearGradient></defs>
      <path d="M74 116C46 108 26 88 20 62 14 36 20 14 34 4c-4 22 2 40 16 54 12 12 26 26 30 44 2 8 0 14-6 14z" fill="url(#h)"/>
      <path d="M36 18c-4 16 0 30 10 42" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".35"/>`
    ),
  },
  halo: {
    aspect: 44 / 160,
    svg: svg(
      "0 0 160 44",
      `<ellipse cx="80" cy="22" rx="72" ry="15" fill="none" stroke="#ffe7a8" stroke-width="12" opacity=".35"/>
      <ellipse cx="80" cy="22" rx="72" ry="15" fill="none" stroke="#ffd27a" stroke-width="6"/>
      <ellipse cx="80" cy="20" rx="70" ry="13" fill="none" stroke="#fff6d8" stroke-width="2" opacity=".8"/>`
    ),
  },
  mustache: {
    aspect: 50 / 160,
    svg: svg(
      "0 0 160 50",
      `<path d="M80 18c-8-12-26-16-40-6-10 7-18 20-32 16C2 26 0 20 2 16c-2 16 10 30 30 30 22 0 36-10 48-20 12 10 26 20 48 20 20 0 32-14 30-30 2 4 0 10-6 12-14 4-22-9-32-16-14-10-32-6-40 6z" fill="#2b1c16"/>`
    ),
  },
  blush: {
    aspect: 0.62,
    svg: svg(
      "0 0 100 62",
      `<defs><radialGradient id="b"><stop offset="0" stop-color="#f56b8a" stop-opacity=".62"/><stop offset=".55" stop-color="#f77d97" stop-opacity=".3"/><stop offset="1" stop-color="#ff7a9a" stop-opacity="0"/></radialGradient></defs>
      <ellipse cx="50" cy="31" rx="50" ry="31" fill="url(#b)"/>`
    ),
  },
};

export function notoUrl(code: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/emoji.svg`;
}

/** The art an effect needs, so it can be loaded before it's switched on. */
export function artFor(effect: FaceEffectId): ArtId[] {
  const out = new Set<ArtId>();
  for (const p of RECIPES[effect] ?? []) out.add(p.art);
  return [...out];
}

/* ---- where things sit on a face --------------------------------------- */

export interface Vec {
  x: number;
  y: number;
}

/** A face in the frame's pixels: its landmarks that matter, its size and its tilt. */
export interface FaceGeom {
  top: Vec;
  chin: Vec;
  nose: Vec;
  lip: Vec;
  eyeL: Vec;
  eyeR: Vec;
  cheekL: Vec;
  cheekR: Vec;
  /** Cheek to cheek, px. */
  w: number;
  /** Forehead to chin, px. */
  h: number;
  /** Tilt in radians, positive leaning clockwise as the frame shows it. */
  roll: number;
  /** Unit vectors: toward the top of the head, and toward the frame's right along the face. */
  up: Vec;
  right: Vec;
}

const avg = (pts: Vec[]): Vec => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The face in pixels, from MediaPipe's landmarks as x, y fractions of a
 * `width` × `height` frame (478 points; the first 468 are the face).
 */
export function faceGeom(points: ArrayLike<number>, width: number, height: number): FaceGeom | null {
  if (points.length < 468 * 2 || width <= 0 || height <= 0) return null;
  const P = (i: number): Vec => ({ x: points[i * 2] * width, y: points[i * 2 + 1] * height });
  const eyeL = avg([P(33), P(133), P(159), P(145)]);
  const eyeR = avg([P(263), P(362), P(386), P(374)]);
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
  const right = { x: Math.cos(roll), y: Math.sin(roll) };
  const up = { x: Math.sin(roll), y: -Math.cos(roll) };
  const top = P(10);
  const chin = P(152);
  return {
    top,
    chin,
    nose: P(1),
    lip: P(13),
    eyeL,
    eyeR,
    cheekL: P(205),
    cheekR: P(425),
    w: dist(P(234), P(454)),
    h: dist(top, chin),
    roll,
    up,
    right,
  };
}

/** Blend two faces (for smoothing between the tracker's looks). */
export function mixGeom(a: FaceGeom, b: FaceGeom, k: number): FaceGeom {
  const v = (p: Vec, q: Vec): Vec => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
  // Angles blend the short way round.
  let d = b.roll - a.roll;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const roll = a.roll + d * k;
  return {
    top: v(a.top, b.top),
    chin: v(a.chin, b.chin),
    nose: v(a.nose, b.nose),
    lip: v(a.lip, b.lip),
    eyeL: v(a.eyeL, b.eyeL),
    eyeR: v(a.eyeR, b.eyeR),
    cheekL: v(a.cheekL, b.cheekL),
    cheekR: v(a.cheekR, b.cheekR),
    w: a.w + (b.w - a.w) * k,
    h: a.h + (b.h - a.h) * k,
    roll,
    right: { x: Math.cos(roll), y: Math.sin(roll) },
    up: { x: Math.sin(roll), y: -Math.cos(roll) },
  };
}

/** One piece to draw: its art, its centre and width in px, its turn, whether it's mirrored, how opaque. */
export interface Placed {
  art: ArtId;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  flip: boolean;
  alpha: number;
}

interface Recipe {
  art: ArtId;
  /** Where its centre sits: an anchor, then offsets along the face's right and up, in face widths / heights. */
  at: (g: FaceGeom) => Vec;
  dx?: number;
  dy?: number;
  /** Width in face widths. */
  w: number;
  /** Extra turn on top of the head's, radians. */
  turn?: number;
  flip?: boolean;
  /** A little life: bob up and down, wiggle, or pulse; amount and speed (per second). */
  bob?: [number, number];
  wiggle?: [number, number];
  pulse?: [number, number];
  phase?: number;
}

const TOP = (g: FaceGeom) => g.top;
const EYES = (g: FaceGeom) => avg([g.eyeL, g.eyeR]);

/** Each effect's pieces. Offsets are in face widths (along) and face heights (up). */
const RECIPES: Record<FaceEffectId, Recipe[]> = {
  none: [],
  crown: [{ art: "crown", at: TOP, dy: 0.3, w: 0.92, bob: [0.012, 1.6] }],
  shades: [{ art: "shades", at: EYES, dy: 0.01, w: 1.06 }],
  hearts: [
    { art: "heart", at: (g) => g.eyeL, w: 0.34, pulse: [0.09, 5.5] },
    { art: "heart", at: (g) => g.eyeR, w: 0.34, pulse: [0.09, 5.5], phase: 0.6 },
  ],
  puppy: [
    { art: "puppyEar", at: TOP, dx: -0.47, dy: -0.02, w: 0.42, turn: 0.28, wiggle: [0.07, 2.6] },
    { art: "puppyEar", at: TOP, dx: 0.47, dy: -0.02, w: 0.42, turn: -0.28, flip: true, wiggle: [0.07, 2.6], phase: 1.4 },
    { art: "puppyNose", at: (g) => g.nose, dy: 0.02, w: 0.3 },
  ],
  bunny: [
    { art: "bunnyEar", at: TOP, dx: -0.17, dy: 0.46, w: 0.24, turn: -0.14, wiggle: [0.05, 1.8] },
    { art: "bunnyEar", at: TOP, dx: 0.17, dy: 0.46, w: 0.24, turn: 0.14, flip: true, wiggle: [0.05, 1.8], phase: 1.1 },
    { art: "pinkNose", at: (g) => g.nose, dy: 0.01, w: 0.15 },
  ],
  cat: [
    { art: "catEar", at: TOP, dx: -0.34, dy: 0.14, w: 0.34, turn: -0.18, wiggle: [0.04, 2.2] },
    { art: "catEar", at: TOP, dx: 0.34, dy: 0.14, w: 0.34, turn: 0.18, flip: true, wiggle: [0.04, 2.2], phase: 0.9 },
    { art: "pinkNose", at: (g) => g.nose, dy: 0.01, w: 0.15 },
    { art: "whiskers", at: (g) => g.cheekL, dx: -0.1, dy: 0.02, w: 0.42 },
    { art: "whiskers", at: (g) => g.cheekR, dx: 0.1, dy: 0.02, w: 0.42, flip: true },
  ],
  devil: [
    { art: "horn", at: TOP, dx: -0.27, dy: 0.1, w: 0.22, turn: -0.12 },
    { art: "horn", at: TOP, dx: 0.27, dy: 0.1, w: 0.22, turn: 0.12, flip: true },
  ],
  halo: [{ art: "halo", at: TOP, dy: 0.2, w: 0.82, bob: [0.02, 1.4] }],
  flowers: [-2, -1, 0, 1, 2].map((k, i) => ({
    art: (["hibiscus", "blossom", "daisy", "blossom", "hibiscus"] as ArtId[])[i],
    at: TOP,
    dx: k * 0.23,
    dy: 0.07 - 0.035 * k * k,
    w: k === 0 ? 0.24 : 0.2,
    turn: k * 0.22,
    bob: [0.006, 1.3],
    phase: i * 0.7,
  })),
  fire: [
    { art: "fire", at: TOP, dy: 0.3, w: 0.52, pulse: [0.06, 8.5] },
    { art: "fire", at: TOP, dx: -0.3, dy: 0.18, w: 0.36, turn: -0.2, pulse: [0.07, 9.5], phase: 1.2 },
    { art: "fire", at: TOP, dx: 0.3, dy: 0.18, w: 0.36, turn: 0.2, pulse: [0.07, 9], phase: 2.1 },
  ],
  sparkles: [
    { art: "sparkles", at: TOP, dx: -0.56, dy: -0.1, w: 0.3, pulse: [0.15, 3.2] },
    { art: "sparkles", at: TOP, dx: 0.56, dy: -0.04, w: 0.26, pulse: [0.15, 3.2], phase: 1.6 },
    { art: "sparkles", at: TOP, dx: 0.3, dy: 0.26, w: 0.22, pulse: [0.18, 2.6], phase: 0.8 },
  ],
  mustache: [{ art: "mustache", at: (g) => ({ x: g.nose.x + (g.lip.x - g.nose.x) * 0.6, y: g.nose.y + (g.lip.y - g.nose.y) * 0.6 }), w: 0.46 }],
  blush: [
    { art: "blush", at: (g) => g.cheekL, dy: -0.03, w: 0.42 },
    { art: "blush", at: (g) => g.cheekR, dy: -0.03, w: 0.42 },
  ],
};

/** Where an effect's pieces go on this face at time `t` (seconds), in draw order. */
export function placeEffect(effect: FaceEffectId, g: FaceGeom, t: number, alpha = 1): Placed[] {
  const out: Placed[] = [];
  for (const r of RECIPES[effect] ?? []) {
    const base = r.at(g);
    const phase = r.phase ?? 0;
    const bob = r.bob ? Math.sin(t * r.bob[1] * Math.PI * 2 * 0.25 + phase) * r.bob[0] : 0;
    const dx = (r.dx ?? 0) * g.w;
    const dy = ((r.dy ?? 0) + bob) * g.h;
    const scale = r.pulse ? 1 + Math.sin(t * r.pulse[1] + phase) * r.pulse[0] : 1;
    const w = r.w * g.w * scale;
    const wiggle = r.wiggle ? Math.sin(t * r.wiggle[1] + phase) * r.wiggle[0] : 0;
    out.push({
      art: r.art,
      x: base.x + g.right.x * dx + g.up.x * dy,
      y: base.y + g.right.y * dx + g.up.y * dy,
      w,
      h: w * ART[r.art].aspect,
      rot: g.roll + (r.turn ?? 0) + wiggle,
      flip: Boolean(r.flip),
      alpha,
    });
  }
  return out;
}
