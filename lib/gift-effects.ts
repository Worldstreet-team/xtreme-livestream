import type { FaceGeo } from "@/lib/face-anchors";

/**
 * Gift effects (Phase 4, Sets): what a gift draws on the picture around the
 * host's face — a crown on the head, shades on the eyes, hearts, a ring of
 * fire, confetti, a rocket, diamonds. Every viewer draws them on their own
 * screen, from the gift's chat line and the face positions the host's
 * browser sends (lib/face-anchors.ts): nothing is burned into the video, so
 * they're sharp at any quality and cost the host nothing to send.
 *
 * This file is the maths, as plain functions Node can test: the pieces an
 * effect draws, where each is at a given moment for a given face, and how
 * a flurry of gifts stacks. The overlay (components/app/gift-effects.tsx)
 * runs the clock and writes the transforms. Pieces are sized once, when
 * the effect starts, and only moved, turned and scaled after — so the art
 * is drawn at its real size, not blown up.
 */

export type EffectId = "crown" | "shades" | "hearts" | "confetti" | "fire" | "rocket" | "diamonds";

export interface EffectDef {
  id: EffectId;
  label: string;
  /** What it does, for the picker. */
  hint: string;
  /** The gift art it draws (a Noto animated emoji path), or null when it's drawn here. */
  art: string | null;
  /** The emoji that stands in for it: the still badge, and art that won't load. */
  emoji: string;
  /** It sits on the face, so it needs the host's face positions to look right. */
  face: boolean;
  /** How long it plays, ms (3–6 s). */
  ms: number;
  /** One at a time: another of the same keeps it up longer rather than stacking a second. */
  single: boolean;
}

export const EFFECTS: readonly EffectDef[] = [
  { id: "crown", label: "Crown", hint: "Lands on your head", art: "1f451", emoji: "👑", face: true, ms: 4600, single: true },
  { id: "shades", label: "Shades", hint: "Slide down onto your eyes", art: null, emoji: "😎", face: true, ms: 4200, single: true },
  { id: "hearts", label: "Hearts", hint: "Float up around you", art: "2764_fe0f", emoji: "❤️", face: true, ms: 3800, single: false },
  { id: "confetti", label: "Confetti", hint: "Bursts from above", art: "1f389", emoji: "🎉", face: false, ms: 3800, single: false },
  { id: "fire", label: "Fire", hint: "A ring of flames round your face", art: "1f525", emoji: "🔥", face: true, ms: 4200, single: true },
  { id: "rocket", label: "Rocket", hint: "Flies right past you", art: "1f680", emoji: "🚀", face: true, ms: 3000, single: false },
  { id: "diamonds", label: "Diamonds", hint: "Circle your head", art: "1f48e", emoji: "💎", face: true, ms: 4400, single: true },
];

export function isEffectId(v: unknown): v is EffectId {
  return EFFECTS.some((e) => e.id === v);
}

export function effectDef(id: EffectId): EffectDef {
  return EFFECTS.find((e) => e.id === id) ?? EFFECTS[0];
}

/** How many of one kind may play at once, and in all. */
export const MAX_PER_KIND = 3;
export const MAX_RUNNING = 8;
/** A single effect kept up by more gifts still ends by this long after it began. */
export const MAX_SINGLE_MS = 9000;
/** What's cut short to make room fades over this long. */
export const TRIM_MS = 260;

/* ---- pieces -------------------------------------------------------------- */

export type PieceLook =
  | { kind: "art"; art: string; emoji: string }
  | { kind: "shades" }
  | { kind: "bit"; color: string; round: boolean }
  | { kind: "puff" }
  | { kind: "spark"; color: string };

export interface Piece {
  /** What it is within the effect: "crown", "spark", "popper", "bit"… */
  role: string;
  look: PieceLook;
  /** Drawn size, px, fixed when the effect starts. */
  w: number;
  h: number;
  i: number;
  n: number;
  /** Its own random 0–1s. */
  seed: number;
  seed2: number;
  /** Where it starts on the face's rim, radians (flames). */
  phi?: number;
  /** Which side of the face (−1 left, 1 right) and how far down it (0 cheekbone … 1 jaw) — hearts. */
  side?: number;
  along?: number;
  /** A launch: confetti's origin and speed (px, px/s), and when it goes (ms in). */
  x0?: number;
  y0?: number;
  vx?: number;
  vy?: number;
  delay?: number;
  /** A puff of smoke stays where it was let out. */
  at?: { x: number; y: number };
}

export interface EffectRun {
  key: string;
  effect: EffectId;
  /** On the overlay's clock, ms. */
  start: number;
  end: number;
  /** The face width it was sized for: pieces grow and shrink with the face from there. */
  fw: number;
  /** When another gift of the same kind last kept it up (0: never). */
  pulse: number;
  /** Every other rocket flies the other way. */
  flip: boolean;
  pieces: Piece[];
}

/** Where a piece is drawn: its centre (px), turn (deg), scale, opacity, and whether it's in front. */
export interface Pose {
  x: number;
  y: number;
  rot: number;
  sx: number;
  sy: number;
  o: number;
  z?: number;
}

export interface Tile {
  w: number;
  h: number;
}

/** A small, seedable random source: the same seed draws the same scatter (the tests and screenshots rely on it). */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number) => clamp(v, 0, 1);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number) => t * t * t;
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const deg = (r: number) => (r * 180) / Math.PI;
/** A hump 0 → 1 → 0 across `ms`. */
const hump = (t: number, ms: number) => (t <= 0 || t >= ms ? 0 : Math.sin((Math.PI * t) / ms));

/** A point in the face's own frame (x right, y down, turned with the head) on the tile. */
function local(g: FaceGeo, lx: number, ly: number) {
  const c = Math.cos(g.roll);
  const s = Math.sin(g.roll);
  return { x: g.cx + lx * c - ly * s, y: g.cy + lx * s + ly * c };
}

const art = (id: string, emoji: string): PieceLook => ({ kind: "art", art: id, emoji });
const GOLD = "#ffd76a";
/** The poppers aim this far below level, in towards the middle. */
const POP_DIR = 22;

/**
 * Start an effect: its pieces, sized to the face (or the tile) as it is now.
 * `palette` colours the confetti; `seed` makes the scatter repeatable.
 */
export function startEffect(
  effect: EffectId,
  g: FaceGeo,
  tile: Tile,
  { now, key, seed = 1, palette = [GOLD, "#ffffff", "#f85810"], flip = false }: { now: number; key: string; seed?: number; palette?: readonly string[]; flip?: boolean }
): EffectRun {
  const r = rng(seed);
  const def = effectDef(effect);
  const minWH = Math.max(1, Math.min(tile.w, tile.h));
  const pieces: Piece[] = [];
  const add = (role: string, look: PieceLook, w: number, h: number, extra: Partial<Piece> = {}) => {
    pieces.push({ role, look, w: Math.max(2, w), h: Math.max(2, h), i: pieces.filter((p) => p.role === role).length, n: 0, seed: r(), seed2: r(), ...extra });
  };
  switch (effect) {
    case "crown": {
      const s = g.fw * 0.95;
      add("crown", art("1f451", "👑"), s, s);
      for (let i = 0; i < 3; i++) add("spark", { kind: "spark", color: i === 1 ? GOLD : "#ffffff" }, s * 0.16, s * 0.16);
      break;
    }
    case "shades": {
      const w = Math.max(g.ed * 2.35, g.fw * 0.72);
      add("shades", { kind: "shades" }, w, w * 0.32);
      break;
    }
    case "hearts": {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const size = g.fw * (0.2 + 0.14 * r());
        // Up both sides of the face, from the cheekbone to the jaw — never across it.
        const side = i % 2 ? 1 : -1;
        const along = Math.floor(i / 2) / (n / 2 - 1);
        add("heart", art("2764_fe0f", "❤️"), size, size, { side, along, delay: ((i * 7) % n) * 95 + r() * 90 });
      }
      break;
    }
    case "confetti": {
      const pop = clamp(minWH * 0.17, 46, 150);
      const mouths = [0, 1].map((side) => {
        // In the top corners, wholly inside the tile however narrow it is.
        const inset = Math.max(pop * 0.62, tile.w * 0.08);
        const x = side === 0 ? inset : tile.w - inset;
        const y = Math.max(pop * 0.62, tile.h * 0.08);
        add("popper", art("1f389", "🎉"), pop, pop, { x0: x, y0: y });
        // The popper's mouth, aimed in and a little down.
        const dir = side === 0 ? POP_DIR : 180 - POP_DIR;
        const rad = (dir * Math.PI) / 180;
        return { x: x + Math.cos(rad) * pop * 0.3, y: y + Math.sin(rad) * pop * 0.3, dir, side };
      });
      const colors = palette.length ? palette : [GOLD];
      const diag = Math.hypot(tile.w, tile.h);
      for (let i = 0; i < 56; i++) {
        const m = mouths[i % 2];
        // Some fly up and fall back in; most go across and down.
        const spread = (m.side === 0 ? 1 : -1) * (r() * 64 - 36);
        const angle = ((m.dir + spread) * Math.PI) / 180;
        const speed = diag * (0.4 + 1.1 * r());
        const w = clamp(minWH * (0.015 + 0.012 * r()), 6, 18);
        const round = r() < 0.2;
        add("bit", { kind: "bit", color: colors[i % colors.length], round }, w, round ? w : w * (0.42 + 0.3 * r()), {
          x0: m.x,
          y0: m.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          delay: 80 + r() * 160,
        });
      }
      break;
    }
    case "fire": {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const phi = -Math.PI / 2 + (2 * Math.PI * i) / n;
        const top = Math.max(0, -Math.sin(phi));
        const size = g.fw * (0.27 + 0.15 * top) * (Math.sin(phi) > 0.6 ? 0.82 : 1);
        add("flame", art("1f525", "🔥"), size, size, { phi });
      }
      break;
    }
    case "rocket": {
      const size = clamp(g.fw * 0.55, minWH * 0.12, minWH * 0.32);
      add("rocket", art("1f680", "🚀"), size, size);
      for (let i = 0; i < 12; i++) {
        const s = size * (0.34 + 0.22 * r());
        add("puff", { kind: "puff" }, s, s, { delay: 140 + i * 125 });
      }
      break;
    }
    case "diamonds": {
      for (let i = 0; i < 7; i++) add("gem", art("1f48e", "💎"), g.fw * 0.24, g.fw * 0.24);
      for (let i = 0; i < 3; i++) add("spark", { kind: "spark", color: i === 0 ? "#bfe9ff" : "#ffffff" }, g.fw * 0.14, g.fw * 0.14);
      break;
    }
  }
  for (const p of pieces) p.n = pieces.filter((q) => q.role === p.role).length;
  return { key, effect, start: now, end: now + def.ms, fw: Math.max(1, g.fw), pulse: 0, flip, pieces };
}

/* ---- where a piece is ---------------------------------------------------- */

/**
 * A piece's pose at `now`, around the face as it is now, or null when it
 * isn't drawn (not started, or done). Entrances run on time since the start;
 * exits on time left, so a run kept up longer simply exits later.
 */
export function posePiece(run: EffectRun, p: Piece, now: number, g: FaceGeo, tile: Tile): Pose | null {
  const t = now - run.start;
  const left = run.end - now;
  if (left <= 0 || t < 0) return null;
  // Pieces follow the face's size since the effect began.
  const k = clamp(g.fw / run.fw, 0.4, 2.5);
  const pulse = run.pulse ? hump(now - run.pulse, 420) : 0;
  const trim = clamp01(left / TRIM_MS);
  const up = { x: Math.sin(g.roll), y: -Math.cos(g.roll) };
  let pose: Pose | null = null;

  switch (run.effect) {
    case "crown": {
      const h = p.h * k;
      // Its foot on the top of the head — the mesh's highest point is the brow's top, hair and skull above it — leaning with the head.
      const seat = g.fh * 0.62 + h * 0.36;
      let lift = 0;
      let sx = 1;
      let sy = 1;
      let o = 1;
      if (t < 520) {
        lift = (1 - easeOutCubic(t / 520)) * h * 1.8;
        o = clamp01(t / 140);
      } else if (t < 900) {
        const b = hump(t - 520, 380);
        sy = 1 - 0.1 * b;
        sx = 1 + 0.06 * b;
      }
      if (left < 450) {
        const q = 1 - left / 450;
        lift += easeInCubic(q) * h * 0.9;
        o *= 1 - q;
      }
      const bob = t > 900 ? Math.sin((t / 1400) * 2 * Math.PI) * h * 0.02 : 0;
      const wobble = t > 900 ? 2.5 * Math.sin((t / 1700) * 2 * Math.PI) : 0;
      const d = seat + lift + bob;
      const cx = g.cx + up.x * d;
      const cy = g.cy + up.y * d;
      if (p.role === "crown") {
        const s = k * (1 + 0.14 * pulse);
        pose = { x: cx, y: cy, rot: deg(g.roll) + wobble, sx: s * sx, sy: s * sy, o, z: 2 };
      } else {
        // Sparks twinkle round it once it's landed.
        const spots = [
          [-0.58, 0.3],
          [0.6, 0.14],
          [0.12, 0.66],
        ];
        const [lx, ly] = spots[p.i % spots.length];
        const phase = (t - 700 - p.i * 260) % 1100;
        if (t < 700 || left < 450 || phase > 600) return null;
        const tw = hump(phase, 600);
        const c = Math.cos(g.roll);
        const sn = Math.sin(g.roll);
        pose = { x: cx + lx * h * c + ly * h * up.x, y: cy + lx * h * sn + ly * h * up.y, rot: 45 * tw, sx: tw * k, sy: tw * k, o: tw, z: 3 };
      }
      break;
    }

    case "shades": {
      const w = p.w * k;
      // On the bridge of the nose, level with the eyes.
      const tx = g.ex - up.x * g.ed * 0.08;
      const ty = g.ey - up.y * g.ed * 0.08;
      // Down from above the tile, "deal with it" slow, then a settle.
      const from = (ty + p.h * k * 1.2) / Math.max(0.4, Math.cos(g.roll));
      let d = 0;
      let sy = 1;
      let o = 1;
      if (t < 900) {
        d = (1 - easeOutQuad(t / 900)) * from;
        o = clamp01(t / 120);
      } else if (t < 1150) sy = 1 - 0.07 * hump(t - 900, 250);
      if (left < 400) {
        const q = 1 - left / 400;
        d += easeInCubic(q) * g.fh * 1.2;
        o *= 1 - q;
      }
      const s = (w / p.w) * (1 + 0.1 * pulse);
      pose = { x: tx + up.x * d, y: ty + up.y * d, rot: deg(g.roll), sx: s, sy: s * sy, o, z: 2 };
      break;
    }

    case "hearts": {
      const life = 2300;
      const tt = t - (p.delay ?? 0);
      if (tt < 0 || tt > life) return null;
      const q = tt / life;
      const side = p.side ?? 1;
      // Just outside the face's outline at this height (an ellipse the face's size).
      const ly = (-0.12 + (p.along ?? 0) * 0.52) * g.fh;
      const edge = 0.5 * g.fw * Math.sqrt(Math.max(0, 1 - (ly / (0.5 * g.fh)) ** 2));
      const base = local(g, side * (edge + p.w * k * 0.62), ly);
      const wave = q * 2 * Math.PI * 0.9 + p.seed * 6.28;
      const rise = easeOutQuad(q) * (0.9 + 0.6 * p.seed2) * g.fh;
      // Drifting out from the face as they rise, so they frame it.
      const out = side * easeOutQuad(q) * g.fw * (0.2 + 0.2 * p.seed);
      const s = easeOutBack(clamp01(tt / 260)) * (1 - 0.2 * q) * k;
      pose = {
        x: base.x + out + Math.sin(wave) * g.fw * 0.08,
        y: base.y - rise,
        rot: 14 * Math.cos(wave),
        sx: s,
        sy: s,
        o: q < 0.6 ? clamp01(tt / 120) : 1 - (q - 0.6) / 0.4,
        z: 2,
      };
      break;
    }

    case "confetti": {
      if (p.role === "popper") {
        const left0 = p.i === 0;
        const pop = easeOutBack(clamp01(t / 280));
        const kick = hump(t - 60, 220) * p.w * 0.12;
        const dir = ((left0 ? POP_DIR : 180 - POP_DIR) * Math.PI) / 180;
        pose = {
          x: (p.x0 ?? 0) - Math.cos(dir) * kick,
          y: (p.y0 ?? 0) - Math.sin(dir) * kick,
          // The popper's cone aims up and right (−45°); turned (and mirrored on the right) to aim in.
          rot: left0 ? POP_DIR + 45 : -(POP_DIR + 45),
          sx: pop * (left0 ? 1 : -1),
          sy: pop,
          o: t < 1300 ? 1 : 1 - clamp01((t - 1300) / 320),
          z: 3,
        };
        break;
      }
      const tt = t - (p.delay ?? 0);
      if (tt < 0) return null;
      const s = tt / 1000;
      const tau = 0.38;
      const fall = tile.h * 0.24;
      const e = 1 - Math.exp(-s / tau);
      const flutter = Math.sin(tt * 0.004 + p.seed * 10) * tile.w * 0.014 * clamp01(tt / 400);
      const flip = Math.cos(tt * (0.008 + 0.006 * p.seed2) + p.seed * 6);
      pose = {
        x: (p.x0 ?? 0) + (p.vx ?? 0) * tau * e + flutter,
        y: (p.y0 ?? 0) + fall * s + ((p.vy ?? 0) - fall) * tau * e,
        rot: p.seed * 360 + tt * (0.25 + 0.35 * p.seed2) * (p.seed > 0.5 ? 1 : -1),
        sx: 1,
        sy: Math.sign(flip || 1) * Math.max(0.14, Math.abs(flip)),
        o: left < 700 ? left / 700 : 1,
        z: 1,
      };
      break;
    }

    case "fire": {
      const phi = p.phi ?? 0;
      const top = Math.abs(Math.atan2(Math.sin(phi + Math.PI / 2), Math.cos(phi + Math.PI / 2))) / Math.PI;
      const appear = easeOutBack(clamp01((t - top * 420) / 260));
      if (appear <= 0) return null;
      const out = clamp01((600 - left) / 600);
      const size = p.h * k;
      const base = local(g, Math.cos(phi) * g.fw * 0.62, Math.sin(phi) * g.fh * 0.6);
      const flare = 1 + 0.25 * pulse;
      const s = appear * (1 - 0.8 * out) * flare * k;
      pose = {
        // Flames rise: each stands a little above its spot on the rim.
        x: base.x + Math.sin(t * 0.06 + p.seed * 30) * size * 0.02,
        y: base.y - size * (0.36 + 0.2 * out),
        rot: 16 * Math.cos(phi) + deg(g.roll) * 0.5,
        sx: s * (1 + 0.07 * Math.sin(t * 0.035 + p.seed * 20)),
        sy: s * (1 + 0.13 * Math.sin(t * 0.047 + p.seed2 * 13)),
        o: 1 - out,
        z: Math.sin(phi) > 0.3 ? 3 : 2,
      };
      break;
    }

    case "rocket": {
      const F = 2300;
      const flight = (tt: number) => {
        const u = clamp01(tt / F);
        return u * (0.55 + 0.45 * u);
      };
      const R = run.pieces[0]?.w ?? p.w;
      const side = run.flip ? -1 : 1;
      // Up from below the frame, past the side of the face, out through the top — leaning outward, never across the face.
      const Q = { x: clamp(g.cx + side * (g.fw * 0.5 + R * 0.9), R * 0.6, tile.w - R * 0.6), y: g.cy };
      const top = -R;
      const bottom = tile.h + R;
      const lean = side * tile.w * 0.28;
      const at = (u: number) => {
        const y = bottom + (top - bottom) * u;
        return { x: Q.x + lean * ((Q.y - y) / (bottom - top)) + side * Math.sin(Math.PI * u) * tile.w * 0.03, y };
      };
      const heading = (u: number) => {
        const a = at(Math.max(0, u - 0.01));
        const b = at(Math.min(1, u + 0.01));
        return Math.atan2(b.y - a.y, b.x - a.x);
      };
      if (p.role === "rocket") {
        if (t > F) return null;
        const u = flight(t);
        const pos = at(u);
        // The art points up and to the right (−45°); mirrored, up and to the left.
        const rot = deg(heading(u)) + (run.flip ? 135 : 45) + 3 * Math.sin(t * 0.02);
        pose = { x: pos.x, y: pos.y, rot, sx: run.flip ? -1 : 1, sy: 1, o: 1, z: 3 };
      } else {
        const born = p.delay ?? 0;
        const age = t - born;
        if (age < 0 || born > F || age > 900) return null;
        if (!p.at) {
          // Let out behind the nozzle, and left there to drift and fade.
          const u = flight(born);
          const pos = at(u);
          const hd = heading(u);
          p.at = { x: pos.x - Math.cos(hd) * R * 0.42, y: pos.y - Math.sin(hd) * R * 0.42 };
        }
        const q = age / 900;
        const s = 0.35 + 1.1 * easeOutCubic(q);
        pose = { x: p.at.x, y: p.at.y + q * p.h * 0.3, rot: 0, sx: s, sy: s, o: 0.55 * (1 - q), z: 1 };
      }
      break;
    }

    case "diamonds": {
      const ringY = -g.fh * 0.7;
      if (p.role === "gem") {
        const t0 = t - p.i * 60;
        if (t0 < 0) return null;
        const a = (2 * Math.PI * p.i) / p.n + t * 0.0017;
        const spiral = 1 + 0.7 * (1 - easeOutCubic(clamp01(t0 / 500)));
        const pos = local(g, Math.cos(a) * g.fw * 0.74 * spiral, ringY + Math.sin(a) * g.fw * 0.17 * spiral);
        // Round the head: bigger and brighter in front, smaller behind.
        const depth = Math.sin(a);
        let s = easeOutBack(clamp01(t0 / 380)) * (0.86 + 0.24 * depth) * k * (1 + 0.2 * pulse);
        let o = 0.7 + 0.3 * depth;
        let y = pos.y;
        let rot = deg(g.roll) + 8 * Math.sin(a);
        if (left < 700) {
          const q = 1 - left / 700;
          y += q * q * g.fh * 0.9;
          o *= 1 - q;
          s *= 1 - 0.3 * q;
          rot += q * 180 * (p.i % 2 ? 1 : -1);
        }
        pose = { x: pos.x, y, rot, sx: s, sy: s, o, z: depth > 0 ? 3 : 1 };
      } else {
        const phase = (t - 500 - p.i * 330) % 1000;
        if (t < 500 || left < 700 || phase > 560) return null;
        const tw = hump(phase, 560);
        const spot = local(g, [-0.9, 0.85, 0.2][p.i % 3] * g.fw, ringY + [-0.1, 0.06, -0.3][p.i % 3] * g.fw);
        pose = { x: spot.x, y: spot.y, rot: 45 * tw, sx: tw * k, sy: tw * k, o: tw, z: 3 };
      }
      break;
    }
  }
  if (pose && trim < 1) pose.o *= trim;
  return pose;
}

/* ---- stacking ------------------------------------------------------------ */

export type Admission = { kind: "extend"; key: string } | { kind: "add" };

/**
 * A new gift's effect among those playing. A single effect (crown, shades,
 * fire, diamonds) already up and not yet leaving is kept up longer and
 * pulses; otherwise it's added — the oldest of its kind cut short past
 * three, the oldest of all past eight. Changes `runs` in place (ends move
 * up, a pulse is marked) and says what to do with the new one.
 */
export function admitEffect(runs: EffectRun[], effect: EffectId, now: number): Admission {
  const def = effectDef(effect);
  const live = runs.filter((r) => r.end - now > TRIM_MS);
  if (def.single) {
    const same = live.find((r) => r.effect === effect && r.end - now > 700);
    if (same) {
      // Each one buys it half again, up to the cap.
      same.end = Math.min(same.start + MAX_SINGLE_MS, same.end + def.ms * 0.5);
      same.pulse = now;
      return { kind: "extend", key: same.key };
    }
  }
  const kind = live.filter((r) => r.effect === effect).sort((a, b) => a.start - b.start);
  if (kind.length >= MAX_PER_KIND) kind[0].end = Math.min(kind[0].end, now + TRIM_MS);
  const all = live.filter((r) => r.end - now > TRIM_MS).sort((a, b) => a.start - b.start);
  if (all.length >= MAX_RUNNING) all[0].end = Math.min(all[0].end, now + TRIM_MS);
  return { kind: "add" };
}
