"use client";

import { useSyncExternalStore } from "react";
import type { LocalVideoTrack, TrackProcessor, Track } from "livekit-client";
import { latestFaceMesh, type FaceMesh } from "@/lib/face-anchors";
import { ART, artFor, faceGeom, isFaceEffect, mixGeom, notoUrl, placeEffect, type ArtId, type FaceEffectId, type FaceGeom } from "@/lib/face-effects";
import type {
  BackgroundOptions,
  BackgroundTransformer,
  TrackTransformerDestroyOptions,
  VideoTrackTransformer,
  VideoTransformerInitOptions,
} from "@livekit/track-processors";

/**
 * Your picture (Phase 1, the Look half of "Sound & look"): what's behind
 * you — nothing, a blur, your brand's colour, a picture of your own, or a
 * real green screen keyed out — a look, a colour grade the camera wears,
 * skin smoothing, and a face effect worn on camera (a crown, shades, puppy
 * ears). All of it rides one LiveKit track processor: the
 * package's segmenter for a blurred or replaced background, then one
 * WebGL2 pass that smooths skin (inside a mask drawn from the face the
 * tracker in lib/face-anchors.ts finds), keys the green screen and grades
 * through a 17³ 3D LUT, then draws the face effect's pieces locked to that
 * same face, on the same frame. A look is a switch of LUT
 * texture, never a rebuilt pipeline, and nothing here may ever take the
 * camera down: every failure lands as "your picture, as it is".
 *
 * The pure parts (the looks' maths, the settings) run in Node for the
 * tests; the browser parts sit behind guards and a dynamic import, so the
 * studio's bundle only carries MediaPipe once someone picks a look.
 */

export type LookBackground = "none" | "blur-soft" | "blur-strong" | "brand" | "image" | "green";
export type Look = "natural" | "warm" | "cool" | "film" | "mono" | "punch";

export interface LookSettings {
  background: LookBackground;
  look: Look;
  /** Skin smoothing, 0 (off) to 1. Off by default: it changes how a face looks, and viewers are told when it's on. */
  smooth: number;
  /** Something worn on the face — a crown, shades, puppy ears (lib/face-effects.ts). */
  face: FaceEffectId;
}

export const DEFAULT_LOOK_SETTINGS: LookSettings = { background: "none", look: "natural", smooth: 0, face: "none" };

/** The smoothing steps the studio offers; any value 0..1 works underneath. */
export const SMOOTH_STEPS: { value: number; label: string }[] = [
  { value: 0, label: "Off" },
  { value: 0.35, label: "Light" },
  { value: 0.6, label: "Medium" },
  { value: 0.85, label: "Strong" },
];

/** Anything the camera wears that changes how the host looks (not just the light): viewers see an "Effects on" tag. */
export function changesAppearance(settings: Pick<LookSettings, "smooth">): boolean {
  return settings.smooth > 0;
}

/** Nothing to do: the camera goes out as captured, with no processor on it. */
export function isPlainLook(settings: LookSettings): boolean {
  return settings.background === "none" && settings.look === "natural" && settings.smooth <= 0 && settings.face === "none";
}

export const BACKGROUNDS: { id: LookBackground; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Your picture as it is." },
  { id: "blur-soft", label: "Soft blur", hint: "Softens what's behind you." },
  { id: "blur-strong", label: "Strong blur", hint: "Hides what's behind you." },
  { id: "brand", label: "Brand", hint: "Your accent colour, your logo in the corner — the kit from Scenes." },
  { id: "image", label: "Your image", hint: "Stays on this device. It's never uploaded." },
  { id: "green", label: "Green screen", hint: "For a real green backdrop: keyed out and swapped for your image, or your brand if you haven't picked one." },
];

export const LOOKS: { id: Look; label: string; hint: string }[] = [
  { id: "natural", label: "Natural", hint: "Nothing added." },
  { id: "warm", label: "Warm", hint: "A little sun." },
  { id: "cool", label: "Cool", hint: "Cleaner, bluer." },
  { id: "film", label: "Film", hint: "Soft blacks, gentle colour." },
  { id: "mono", label: "Mono", hint: "Black and white." },
  { id: "punch", label: "Punch", hint: "More contrast, more colour." },
];

/* ---- the looks' maths ------------------------------------------------ */

/** The cube's edge: 17 points a side is what every colour tool ships, and trilinear filtering fills the gaps. */
export const LUT_SIZE = 17;

/** How much of a blur, in the package's radius (it downsamples ×4 before blurring). */
export const SOFT_BLUR = 10;
export const STRONG_BLUR = 26;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** Steeper through the mids, softer at both ends; keeps black, mid-grey and white where they are. */
const sCurve = (v: number, amount: number) => v - (amount * Math.sin(2 * Math.PI * v)) / (2 * Math.PI);
/** Raise the floor: black becomes a dark grey, white stays white. */
const lift = (v: number, by: number) => by + v * (1 - by);
const saturate = (c: [number, number, number], by: number): [number, number, number] => {
  const y = luma(c[0], c[1], c[2]);
  return [y + (c[0] - y) * by, y + (c[1] - y) * by, y + (c[2] - y) * by];
};

/**
 * One colour through a look, 0..1 in and out. The whole grade in one
 * place, so the LUT below and any swatch drawn from it agree.
 */
export function gradeColor(look: Look, r: number, g: number, b: number): [number, number, number] {
  let c: [number, number, number] = [r, g, b];
  switch (look) {
    case "natural":
      break;
    case "warm":
      // Warmth as a white balance shift, and a slight lift so it feels sunny, not dark.
      c = [lift(r * 1.06, 0.02), lift(g, 0.02), lift(b * 0.92, 0.02)];
      break;
    case "cool":
      c = [r * 0.93, g, b * 1.07];
      break;
    case "film":
      // Lifted blacks, a gentle S, and colour eased back a touch.
      c = saturate([sCurve(lift(r, 0.06), 0.12), sCurve(lift(g, 0.06), 0.12), sCurve(lift(b, 0.06), 0.12)], 0.85);
      break;
    case "mono": {
      const y = luma(r, g, b);
      c = [y, y, y];
      break;
    }
    case "punch":
      c = saturate([sCurve(r, 0.22), sCurve(g, 0.22), sCurve(b, 0.22)], 1.3);
      break;
  }
  return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
}

/**
 * A look as a cube of RGBA8 bytes, red running fastest, then green, then
 * blue — the layout a WebGL `TEXTURE_3D` takes as-is, so `texture(lut,
 * rgb)` looks a colour up. 17³ × 4 is under 20 KB; there are no assets.
 */
export function makeLut(look: Look, size = LUT_SIZE): Uint8Array {
  const out = new Uint8Array(size * size * size * 4);
  const last = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [R, G, B] = gradeColor(look, r / last, g / last, b / last);
        out[i++] = Math.round(R * 255);
        out[i++] = Math.round(G * 255);
        out[i++] = Math.round(B * 255);
        out[i++] = 255;
      }
    }
  }
  return out;
}

const lutCache = new Map<Look, Uint8Array>();
function lutFor(look: Look) {
  let lut = lutCache.get(look);
  if (!lut) {
    lut = makeLut(look);
    lutCache.set(look, lut);
  }
  return lut;
}

/* ---- the settings ------------------------------------------------------ */

const KEY = "xtream:look";
const EVENT = "xtream:look";

const isBackground = (v: unknown): v is LookBackground => BACKGROUNDS.some((b) => b.id === v);
const isLook = (v: unknown): v is Look => LOOKS.some((l) => l.id === v);

/** Settings off the shelf (a JSON string or an object): anything unknown falls back to the default. */
export function readLookSettings(raw: unknown): LookSettings {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return DEFAULT_LOOK_SETTINGS;
    }
  }
  if (!value || typeof value !== "object") return DEFAULT_LOOK_SETTINGS;
  const r = value as Record<string, unknown>;
  return {
    background: isBackground(r.background) ? r.background : DEFAULT_LOOK_SETTINGS.background,
    look: isLook(r.look) ? r.look : DEFAULT_LOOK_SETTINGS.look,
    smooth: typeof r.smooth === "number" && Number.isFinite(r.smooth) ? clamp01(r.smooth) : DEFAULT_LOOK_SETTINGS.smooth,
    face: isFaceEffect(r.face) ? r.face : DEFAULT_LOOK_SETTINGS.face,
  };
}

let cachedRaw: string | null | undefined;
let cached: LookSettings = DEFAULT_LOOK_SETTINGS;
/** Storage blocked: this page keeps its own copy. */
let memoryRaw: string | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memoryRaw;
  }
}

function read(): LookSettings {
  const raw = readRaw();
  // Same string, same object — useSyncExternalStore wants a stable snapshot.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = raw ? readLookSettings(raw) : DEFAULT_LOOK_SETTINGS;
  }
  return cached;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setLookSettings(patch: Partial<LookSettings>) {
  const json = JSON.stringify({ ...read(), ...patch });
  try {
    localStorage.setItem(KEY, json);
  } catch {
    memoryRaw = json;
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The host's background and look, remembered by this browser. */
export function useLookSettings(): LookSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_LOOK_SETTINGS);
}

export interface LookImage {
  /** An object URL for this session — the picture never leaves the device. */
  url: string;
  name: string;
}

let sessionImage: LookImage | null = null;

/** The host's own background picture: kept in memory as an object URL for the session, never stored, never uploaded. */
export function setLookImage(file: File | null) {
  if (sessionImage) URL.revokeObjectURL(sessionImage.url);
  sessionImage = file ? { url: URL.createObjectURL(file), name: file.name } : null;
  window.dispatchEvent(new Event(EVENT));
}

export function useLookImage(): LookImage | null {
  return useSyncExternalStore(subscribe, () => sessionImage, () => null);
}

/* ---- support ----------------------------------------------------------- */

let supported: boolean | null = null;

/**
 * Chrome and Edge, on a device with WebGL2: the frame pipeline needs
 * `MediaStreamTrackProcessor`, which Safari and Firefox don't ship, and
 * the package's canvas fallback is too slow to be a live camera. Probed
 * once; the answer doesn't change while the page is open.
 */
export function isLooksSupported(): boolean {
  if (supported !== null) return supported;
  if (typeof window === "undefined") return false;
  const modern =
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof MediaStreamTrackGenerator !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof OffscreenCanvas !== "undefined";
  let webgl2 = false;
  if (modern) {
    try {
      const gl = new OffscreenCanvas(1, 1).getContext("webgl2");
      webgl2 = Boolean(gl);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  supported = modern && webgl2;
  return supported;
}

/* ---- the pipeline ------------------------------------------------------ */

/**
 * Where the segmenter's files come from. Undefined means the package's
 * defaults — the MediaPipe wasm from cdn.jsdelivr.net and the model from
 * storage.googleapis.com — so a strict CSP or an offline host means no
 * background (the look still works; `applyLook` says so). To self-host,
 * point these at copies under /public.
 */
export const SEGMENTER_ASSETS: BackgroundOptions["assetPaths"] = undefined;

export const LOOK_PROCESSOR_NAME = "xtream-look";
/** Below this the blur judders and the host is better off without it. */
export const MIN_BLUR_FPS = 15;
/** The model has this long to arrive before we call it a failure. */
const BACKGROUND_TIMEOUT_MS = 20_000;
/** And the first frame this long: the segmenter compiles its shaders on it (a couple of seconds on a slow GPU). */
const FIRST_FRAME_TIMEOUT_MS = 10_000;
/** Frames the blur stage may swallow in a row before the look carries on without it. */
const BACKGROUND_MAX_MISSES = 8;

type Processors = typeof import("@livekit/track-processors");
type FrameStats = Parameters<NonNullable<BackgroundOptions["onFrameProcessed"]>>[0];

let processorsPromise: Promise<Processors> | null = null;
function loadProcessors() {
  processorsPromise ??= import("@livekit/track-processors");
  return processorsPromise;
}

export class LookError extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new LookError(why)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/** What the transformer runs with; a plain object so the wrapper's generic is happy. */
type LookOptions = { look: Look; background: LookBackground; imagePath: string | null; smooth: number; face: FaceEffectId };

/** What a background needs from the studio: the host's own picture, and the brand kit. */
export interface LookSources {
  /** The host's picture, from `useLookImage().url`. */
  imageUrl?: string | null;
  /** The brand background: the accent's flat fill (`ACCENTS[brand.accent].fill`) and the logo's URL. */
  brand?: { fill: string; logoUrl?: string | null } | null;
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // Rows come in top-first; clip space runs bottom-up. Flip once, here.
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/**
 * The one pass every frame takes: smooth the skin, key the green screen,
 * grade through the LUT. Each step costs nothing when it's off — the
 * smoothing only samples where the mask says skin, the key is one branch.
 */
const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_frame;
uniform sampler3D u_lut;
uniform sampler2D u_mask;
uniform sampler2D u_bg;
uniform float u_scale;
uniform float u_offset;
uniform float u_smooth;
uniform float u_radius;
uniform vec2 u_texel;
uniform float u_key;
in vec2 v_uv;
out vec4 o_color;
// Two rings of six, the outer turned half a step: an even spread with twelve reads.
const vec2 TAPS[12] = vec2[12](
  vec2(0.5, 0.0), vec2(0.25, 0.433), vec2(-0.25, 0.433), vec2(-0.5, 0.0), vec2(-0.25, -0.433), vec2(0.25, -0.433),
  vec2(0.866, 0.5), vec2(0.0, 1.0), vec2(-0.866, 0.5), vec2(-0.866, -0.5), vec2(0.0, -1.0), vec2(0.866, -0.5)
);
void main() {
  vec3 c = texture(u_frame, v_uv).rgb;
  // Skin: an edge-preserving blur, only where the mask says face (never eyes, brows or lips).
  float m = u_smooth > 0.0 ? texture(u_mask, v_uv).r * u_smooth : 0.0;
  if (m > 0.004) {
    vec3 sum = c;
    float ws = 1.0;
    for (int i = 0; i < 12; i++) {
      vec3 s = texture(u_frame, v_uv + TAPS[i] * u_radius * u_texel).rgb;
      vec3 d = s - c;
      // Close colours blend; an edge (a jawline, a strand of hair) doesn't.
      float w = exp(-dot(d, d) * 90.0);
      sum += s * w;
      ws += w;
    }
    c = mix(c, sum / ws, m);
  }
  // Green screen: how much greener a pixel is than its other two channels.
  if (u_key > 0.5) {
    float g = c.g - max(c.r, c.b);
    float a = 1.0 - smoothstep(0.04, 0.15, g);
    // Green light bouncing onto hair and shoulders, taken back out.
    vec3 despilled = vec3(c.r, min(c.g, max(c.r, c.b) + 0.015), c.b);
    c = mix(texture(u_bg, v_uv).rgb, despilled, a);
  }
  // Sample cell centres, so the cube's corners are exactly black and white.
  o_color = vec4(texture(u_lut, c * u_scale + u_offset).rgb, 1.0);
}`;

/** The skin mask: triangles in frame fractions, painted 1 for face and 0 for the holes cut in it. */
const MASK_VERT = `#version 300 es
in vec2 a_pos;
void main() {
  // Fractions of the frame, rows top-first, into a texture sampled the same way as the frame.
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

const MASK_FRAG = `#version 300 es
precision mediump float;
uniform float u_val;
out vec4 o_color;
void main() {
  o_color = vec4(u_val, u_val, u_val, 1.0);
}`;

/** A face effect's piece: a textured quad turned and placed in frame pixels. */
const SPRITE_VERT = `#version 300 es
in vec2 a_pos;
uniform vec2 u_res;
uniform vec2 u_center;
uniform vec2 u_size;
uniform float u_rot;
uniform float u_flip;
out vec2 v_uv;
void main() {
  vec2 p = (a_pos - 0.5) * u_size;
  float c = cos(u_rot);
  float s = sin(u_rot);
  vec2 q = vec2(p.x * c - p.y * s, p.x * s + p.y * c) + u_center;
  v_uv = vec2(u_flip > 0.5 ? 1.0 - a_pos.x : a_pos.x, a_pos.y);
  // Frame pixels, rows top-first, into clip space.
  gl_Position = vec4(q.x / u_res.x * 2.0 - 1.0, 1.0 - q.y / u_res.y * 2.0, 0.0, 1.0);
}`;

const SPRITE_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform float u_alpha;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec4 c = texture(u_tex, v_uv);
  o_color = vec4(c.rgb, c.a * u_alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new LookError("The look's shader couldn't be created.");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new LookError(`The look's shader didn't compile: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vert: string, frag: string) {
  const vs = compile(gl, gl.VERTEX_SHADER, vert);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  const program = gl.createProgram();
  if (!program) throw new LookError("The look's program couldn't be created.");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new LookError(`The look's program didn't link: ${gl.getProgramInfoLog(program) ?? ""}`);
  }
  return program;
}

/* ---- where the skin is ------------------------------------------------- */

/**
 * MediaPipe's face mesh, by landmark number: the face's outline, and the
 * parts smoothing must leave sharp. Each is a loop in order.
 */
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const SKIN_HOLES: { loop: number[]; grow: number }[] = [
  // Eyes grow the most: lashes and lids read as detail, and the mask trails a fast blink.
  { loop: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246], grow: 1.55 },
  { loop: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466], grow: 1.55 },
  { loop: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46], grow: 1.3 },
  { loop: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276], grow: 1.3 },
  { loop: [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185], grow: 1.2 },
];

/** A loop as a fan of triangles from its centre, grown by `grow` around that centre. */
function fan(points: ArrayLike<number>, loop: number[], grow: number, out: number[]) {
  let cx = 0;
  let cy = 0;
  for (const i of loop) {
    cx += points[i * 2];
    cy += points[i * 2 + 1];
  }
  cx /= loop.length;
  cy /= loop.length;
  const at = (i: number) => [cx + (points[i * 2] - cx) * grow, cy + (points[i * 2 + 1] - cy) * grow];
  for (let k = 0; k < loop.length; k++) {
    const [ax, ay] = at(loop[k]);
    const [bx, by] = at(loop[(k + 1) % loop.length]);
    out.push(cx, cy, ax, ay, bx, by);
  }
}

export interface SkinShape {
  /** Triangles (x, y pairs, frame fractions) covering the face. */
  face: Float32Array;
  /** Triangles to cut back out: eyes, brows, lips. */
  holes: Float32Array;
  /** The face's height, in frame heights — sizes the blur. */
  height: number;
}

/** Where the skin is, from MediaPipe's 478 points as x, y fractions. Null for too few points. */
export function skinShape(points: ArrayLike<number>): SkinShape | null {
  if (points.length < 468 * 2) return null;
  const face: number[] = [];
  const holes: number[] = [];
  fan(points, FACE_OVAL, 1, face);
  for (const h of SKIN_HOLES) fan(points, h.loop, h.grow, holes);
  let top = Infinity;
  let bottom = -Infinity;
  for (const i of FACE_OVAL) {
    const y = points[i * 2 + 1];
    if (y < top) top = y;
    if (y > bottom) bottom = y;
  }
  return { face: new Float32Array(face), holes: new Float32Array(holes), height: Math.max(0, bottom - top) };
}

/** The blur's reach in pixels for a face this many pixels tall: bigger faces, wider pores. */
export function smoothRadius(facePx: number) {
  return Math.min(9, Math.max(1.5, facePx * 0.02));
}

/** The mask's width: small on purpose — sampled back up, its edges come out feathered. */
const MASK_WIDTH = 160;
/** A face older than this is left alone rather than smoothed where it used to be. */
export const FACE_MESH_STALE_MS = 400;

interface GradeStage {
  /** Swap the look: a texture upload, nothing else. */
  setLut(bytes: Uint8Array): void;
  /** How much to smooth, 0..1. */
  setSmooth(amount: number): void;
  /** The latest face; the skin mask is redrawn from it and the face effect follows it. Null: nobody in frame. */
  setMesh(mesh: FaceMesh | null): void;
  /** The face effect to wear, with its art loaded; "none" takes it off. The stage doesn't own the bitmaps. */
  setEffect(effect: FaceEffectId, art: Map<ArtId, ImageBitmap>): void;
  /** The green screen's replacement, sized to the frame; null turns the key off. The stage owns the bitmap from here and closes it. */
  setKey(bg: ImageBitmap | null): void;
  /** Draw a frame through the pass onto the canvas; false when the GPU has gone away. */
  grade(frame: VideoFrame): boolean;
  destroy(): void;
}

/**
 * One WebGL2 context on the processor's canvas: the frame, the 17³ LUT, a
 * small skin mask and the green screen's picture as textures, one
 * full-screen pass, and a tiny second program that paints the mask when a
 * new face comes in. That's the whole GPU budget of a look. A lost context
 * passes frames through until it comes back.
 */
function createGradeStage(canvas: OffscreenCanvas | HTMLCanvasElement): GradeStage | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  }) as WebGL2RenderingContext | null;
  if (!gl) return null;

  let program: WebGLProgram | null = null;
  let maskProgram: WebGLProgram | null = null;
  let spriteProgram: WebGLProgram | null = null;
  let spriteVao: WebGLVertexArrayObject | null = null;
  let spriteVbo: WebGLBuffer | null = null;
  const spriteTex = new Map<ArtId, WebGLTexture>();
  let effect: FaceEffectId = "none";
  let effectArt = new Map<ArtId, ImageBitmap>();
  let geom: FaceGeom | null = null;
  let geomSeq = -1;
  let effectAlpha = 0;
  const su: Record<string, WebGLUniformLocation | null> = {};
  let frameTex: WebGLTexture | null = null;
  let lutTex: WebGLTexture | null = null;
  let maskTex: WebGLTexture | null = null;
  let bgTex: WebGLTexture | null = null;
  let maskFbo: WebGLFramebuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let vbo: WebGLBuffer | null = null;
  let maskVao: WebGLVertexArrayObject | null = null;
  let maskVbo: WebGLBuffer | null = null;
  let current: Uint8Array | null = null;
  let lost = false;

  let smooth = 0;
  let face: FaceMesh | null = null;
  let drawnSeq = -1;
  let maskW = 0;
  let maskH = 0;
  let faceHeight = 0;
  let hasMask = false;
  let keyOn = false;
  let keyBitmap: ImageBitmap | null = null;
  const u: Record<string, WebGLUniformLocation | null> = {};

  const texture2D = (filter: number) => {
    const t = gl!.createTexture();
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, filter);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    return t;
  };

  function build() {
    program = link(gl!, VERT, FRAG);
    maskProgram = link(gl!, MASK_VERT, MASK_FRAG);
    gl!.useProgram(program);

    // A quad that covers the canvas.
    vao = gl!.createVertexArray();
    gl!.bindVertexArray(vao);
    vbo = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl!.STATIC_DRAW);
    const aPos = gl!.getAttribLocation(program, "a_pos");
    gl!.enableVertexAttribArray(aPos);
    gl!.vertexAttribPointer(aPos, 2, gl!.FLOAT, false, 0, 0);

    // A unit quad for the face effect's pieces.
    spriteProgram = link(gl!, SPRITE_VERT, SPRITE_FRAG);
    spriteVao = gl!.createVertexArray();
    gl!.bindVertexArray(spriteVao);
    spriteVbo = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, spriteVbo);
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl!.STATIC_DRAW);
    const sPos = gl!.getAttribLocation(spriteProgram, "a_pos");
    gl!.enableVertexAttribArray(sPos);
    gl!.vertexAttribPointer(sPos, 2, gl!.FLOAT, false, 0, 0);
    for (const name of ["u_res", "u_center", "u_size", "u_rot", "u_flip", "u_alpha", "u_tex"]) su[name] = gl!.getUniformLocation(spriteProgram, name);

    // The mask's triangles, rewritten with each new face.
    maskVao = gl!.createVertexArray();
    gl!.bindVertexArray(maskVao);
    maskVbo = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, maskVbo);
    const mPos = gl!.getAttribLocation(maskProgram, "a_pos");
    gl!.enableVertexAttribArray(mPos);
    gl!.vertexAttribPointer(mPos, 2, gl!.FLOAT, false, 0, 0);
    gl!.bindVertexArray(null);

    // The frame, sampled 1:1 by the pass — linear so the smoothing's taps land between pixels.
    frameTex = texture2D(gl!.LINEAR);

    lutTex = gl!.createTexture();
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_3D, lutTex);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_R, gl!.CLAMP_TO_EDGE);
    gl!.texImage3D(gl!.TEXTURE_3D, 0, gl!.RGBA8, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, current);

    // The mask and the green screen's picture start as a single black pixel.
    gl!.activeTexture(gl!.TEXTURE2);
    maskTex = texture2D(gl!.LINEAR);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, 1, 1, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, new Uint8Array(4));
    maskW = maskH = 1;
    maskFbo = gl!.createFramebuffer();
    gl!.activeTexture(gl!.TEXTURE3);
    bgTex = texture2D(gl!.LINEAR);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, 1, 1, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, new Uint8Array(4));

    for (const name of ["u_smooth", "u_radius", "u_texel", "u_key", "u_val"]) {
      u[name] = gl!.getUniformLocation(name === "u_val" ? maskProgram : program, name);
    }
    gl!.useProgram(program);
    gl!.uniform1i(gl!.getUniformLocation(program, "u_frame"), 0);
    gl!.uniform1i(gl!.getUniformLocation(program, "u_lut"), 1);
    gl!.uniform1i(gl!.getUniformLocation(program, "u_mask"), 2);
    gl!.uniform1i(gl!.getUniformLocation(program, "u_bg"), 3);
    gl!.uniform1f(gl!.getUniformLocation(program, "u_scale"), (LUT_SIZE - 1) / LUT_SIZE);
    gl!.uniform1f(gl!.getUniformLocation(program, "u_offset"), 0.5 / LUT_SIZE);

    // A rebuilt context has lost what was uploaded: the mask redraws, the key re-uploads.
    drawnSeq = -1;
    hasMask = false;
    if (keyBitmap) uploadKey(keyBitmap);
    uploadArt();
  }

  /** The effect's art as textures, one each; what the effect no longer needs is let go. */
  function uploadArt() {
    for (const [id, tex] of spriteTex) {
      if (!effectArt.has(id)) {
        gl!.deleteTexture(tex);
        spriteTex.delete(id);
      }
    }
    for (const [id, bmp] of effectArt) {
      if (spriteTex.has(id)) continue;
      const tex = gl!.createTexture();
      if (!tex) continue;
      gl!.activeTexture(gl!.TEXTURE4);
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
      gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, bmp);
      spriteTex.set(id, tex);
    }
  }

  /**
   * The face effect's pieces over the graded frame, locked to the face: the
   * tracker's face eased toward each frame (it looks a dozen or two times a
   * second; the picture runs at thirty), faded out when the face goes.
   */
  function drawEffect(w: number, h: number) {
    if (effect === "none" || !spriteProgram) return;
    const target = face && face.seq !== geomSeq ? faceGeom(face.points, w, h) : null;
    if (face) geomSeq = face.seq;
    if (target) geom = geom ? mixGeom(geom, target, 0.6) : target;
    effectAlpha = face ? Math.min(1, effectAlpha + 0.2) : Math.max(0, effectAlpha - 0.15);
    if (!geom || effectAlpha <= 0) return;
    const pieces = placeEffect(effect, geom, performance.now() / 1000, effectAlpha);
    gl!.useProgram(spriteProgram);
    gl!.bindVertexArray(spriteVao);
    gl!.enable(gl!.BLEND);
    gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA);
    gl!.uniform2f(su.u_res, w, h);
    gl!.uniform1i(su.u_tex, 4);
    gl!.activeTexture(gl!.TEXTURE4);
    for (const p of pieces) {
      const tex = spriteTex.get(p.art);
      if (!tex) continue;
      gl!.bindTexture(gl!.TEXTURE_2D, tex);
      gl!.uniform2f(su.u_center, p.x, p.y);
      gl!.uniform2f(su.u_size, p.w, p.h);
      gl!.uniform1f(su.u_rot, p.rot);
      gl!.uniform1f(su.u_flip, p.flip ? 1 : 0);
      gl!.uniform1f(su.u_alpha, p.alpha);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    }
    gl!.disable(gl!.BLEND);
    gl!.bindVertexArray(null);
  }

  function release() {
    for (const p of [program, maskProgram, spriteProgram]) if (p) gl!.deleteProgram(p);
    for (const t of [frameTex, lutTex, maskTex, bgTex, ...spriteTex.values()]) if (t) gl!.deleteTexture(t);
    spriteTex.clear();
    for (const b of [vbo, maskVbo, spriteVbo]) if (b) gl!.deleteBuffer(b);
    for (const v of [vao, maskVao, spriteVao]) if (v) gl!.deleteVertexArray(v);
    if (maskFbo) gl!.deleteFramebuffer(maskFbo);
    program = maskProgram = spriteProgram = frameTex = lutTex = maskTex = bgTex = vbo = maskVbo = spriteVbo = vao = maskVao = spriteVao = maskFbo = null;
  }

  function uploadKey(bmp: ImageBitmap) {
    if (!bgTex) return;
    gl!.activeTexture(gl!.TEXTURE3);
    gl!.bindTexture(gl!.TEXTURE_2D, bgTex);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, bmp);
  }

  /** Paint the skin mask from the latest face: the outline in white, the holes back to black. */
  function drawMask(frameW: number, frameH: number) {
    if (!face || !maskProgram || !maskFbo || !maskTex) return;
    const shape = skinShape(face.points);
    drawnSeq = face.seq;
    if (!shape) {
      hasMask = false;
      return;
    }
    const w = MASK_WIDTH;
    const h = Math.max(1, Math.round((MASK_WIDTH * frameH) / Math.max(1, frameW)));
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, maskTex);
    if (w !== maskW || h !== maskH) {
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
      maskW = w;
      maskH = h;
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, maskFbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, maskTex, 0);
    gl!.viewport(0, 0, w, h);
    gl!.clearColor(0, 0, 0, 1);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.useProgram(maskProgram);
    gl!.bindVertexArray(maskVao);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, maskVbo);
    const all = new Float32Array(shape.face.length + shape.holes.length);
    all.set(shape.face, 0);
    all.set(shape.holes, shape.face.length);
    gl!.bufferData(gl!.ARRAY_BUFFER, all, gl!.DYNAMIC_DRAW);
    gl!.uniform1f(u.u_val, 1);
    gl!.drawArrays(gl!.TRIANGLES, 0, shape.face.length / 2);
    gl!.uniform1f(u.u_val, 0);
    gl!.drawArrays(gl!.TRIANGLES, shape.face.length / 2, shape.holes.length / 2);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.bindVertexArray(null);
    faceHeight = shape.height;
    hasMask = true;
  }

  const onLost = (e: Event) => {
    // Allow a restore; until then frames pass through as they are.
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    try {
      build();
      lost = false;
    } catch {
      lost = true;
    }
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  build();

  return {
    setLut(bytes) {
      current = bytes;
      if (lost || !lutTex) return;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, LUT_SIZE, LUT_SIZE, LUT_SIZE, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    },
    setSmooth(amount) {
      smooth = clamp01(amount);
    },
    setMesh(mesh) {
      face = mesh;
      if (!mesh) hasMask = false;
    },
    setEffect(next, art) {
      effect = next;
      effectArt = next === "none" ? new Map() : art;
      if (next === "none") {
        geom = null;
        effectAlpha = 0;
      }
      if (!lost) uploadArt();
    },
    setKey(bmp) {
      keyBitmap?.close();
      keyBitmap = null;
      keyOn = Boolean(bmp);
      if (!bmp) return;
      // Kept: a restored context needs it again.
      keyBitmap = bmp;
      if (!lost) uploadKey(bmp);
    },
    grade(frame) {
      if (lost || !program) return false;
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const smoothing = smooth > 0 && face !== null;
      if (smoothing && face && face.seq !== drawnSeq) drawMask(w, h);
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform1f(u.u_smooth, smoothing && hasMask ? smooth : 0);
      gl.uniform1f(u.u_radius, smoothRadius(faceHeight * h));
      gl.uniform2f(u.u_texel, 1 / w, 1 / h);
      gl.uniform1f(u.u_key, keyOn ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, maskTex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawEffect(w, h);
      return true;
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      keyBitmap?.close();
      keyBitmap = null;
      release();
      // Hand the GPU memory back now rather than whenever the canvas is collected.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/** The longest side a piece of face-effect art is drawn at: sharp on a 1080p frame, light on memory. */
const ART_PX = 320;
const artCache = new Map<ArtId, Promise<ImageBitmap>>();

/**
 * One piece of art as a bitmap the GPU takes: a Noto emoji fetched as SVG
 * (read as text and drawn from our own blob, so the canvas stays clean) or
 * one of ours. Kept for the session; a failed load is forgotten so the next
 * try fetches again.
 */
function loadArt(id: ArtId): Promise<ImageBitmap> {
  let p = artCache.get(id);
  if (p) return p;
  p = (async () => {
    const def = ART[id];
    const text = def.svg ?? (await (await fetch(notoUrl(def.noto!))).text());
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const w = def.aspect > 1 ? Math.round(ART_PX / def.aspect) : ART_PX;
      const h = def.aspect > 1 ? ART_PX : Math.round(ART_PX * def.aspect);
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      return canvas.transferToImageBitmap();
    } finally {
      URL.revokeObjectURL(url);
    }
  })();
  artCache.set(id, p);
  p.catch(() => artCache.delete(id));
  return p;
}

/** Everything an effect draws, loaded; a piece that won't load is left out rather than failing the effect. */
async function loadEffectArt(effect: FaceEffectId): Promise<Map<ArtId, ImageBitmap>> {
  const ids = artFor(effect);
  const loaded = await Promise.allSettled(ids.map(loadArt));
  const out = new Map<ArtId, ImageBitmap>();
  loaded.forEach((r, i) => {
    if (r.status === "fulfilled") out.set(ids[i], r.value);
  });
  return out;
}

/**
 * A picture cropped to cover a frame of this size (centred), as a bitmap
 * the GPU takes directly: the green screen's replacement.
 */
async function coverBitmap(url: string, width: number, height: number): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  const src = await createImageBitmap(blob);
  try {
    const want = width / height;
    const have = src.width / src.height;
    let sw = src.width;
    let sh = src.height;
    if (have > want) sw = Math.round(src.height * want);
    else sh = Math.round(src.width / want);
    const sx = Math.round((src.width - sw) / 2);
    const sy = Math.round((src.height - sh) / 2);
    return await createImageBitmap(src, sx, sy, sw, sh, { resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  } finally {
    src.close();
  }
}

/**
 * The transformer: the package's background stage (when a blur or a
 * replaced background is chosen) and then the pass — skin, green screen,
 * LUT — on one frame. The background stage arrives
 * when its model has loaded; frames wear the look alone until then, and
 * again if it ever stops delivering — a blur that fails must never freeze
 * the camera.
 */
class LookTransformer implements VideoTrackTransformer<LookOptions> {
  transformer?: TransformStream;
  options: LookOptions;
  /** Compare: frames go through untouched while this is on. */
  bypass = false;
  /** The background stage's timings, per frame — the device test counts these. */
  onFrame?: (stats: FrameStats) => void;
  /** The background stopped coming through; the look carries on without it. */
  onBackgroundLost?: (reason: string) => void;
  /** Every frame that went out through the pass, and what the pass cost — the device test counts these. */
  onGraded?: (ms: number) => void;

  private readonly mod: Processors;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private inputVideo: HTMLVideoElement | null = null;
  private lut: GradeStage | null = null;
  private keyToken = 0;
  private effectToken = 0;
  private live = false;
  private bg: BackgroundTransformer | null = null;
  private bgOn = false;
  private bgMisses = 0;
  private bgQueue: Promise<void> = Promise.resolve();

  constructor(mod: Processors, options: LookOptions) {
    this.mod = mod;
    this.options = options;
  }

  async init({ outputCanvas, inputElement }: VideoTransformerInitOptions) {
    this.transformer = new TransformStream({
      transform: (frame: VideoFrame, controller) => this.transform(frame, controller),
    });
    this.canvas = outputCanvas;
    this.inputVideo = inputElement;
    // No WebGL2 (a context limit, a GPU reset): frames pass through untouched
    // rather than the camera stopping — LiveKit restarts a processor with no
    // way back if its init throws, and the look is the one thing allowed to fail.
    const lut = createGradeStage(outputCanvas);
    if (lut) {
      lut.setLut(lutFor(this.options.look));
      lut.setSmooth(this.options.smooth);
    }
    this.lut = lut;
    this.live = true;
    this.bgMisses = 0;
    // Not awaited: the background arrives when its model has; `update` is what waits on it.
    void this.queueBackground().catch(() => {});
    void this.syncKey().catch(() => {});
    void this.syncEffect().catch(() => {});
  }

  async restart(opts: VideoTransformerInitOptions) {
    await this.destroy({ willProcessorRestart: true });
    await this.init(opts);
  }

  async destroy(opts?: TrackTransformerDestroyOptions) {
    this.live = false;
    this.keyToken++;
    this.lut?.destroy();
    this.lut = null;
    const bg = this.bg;
    this.bg = null;
    this.bgOn = false;
    if (bg) await bg.destroy(opts).catch(() => {});
    this.transformer = undefined;
    this.canvas = null;
    this.inputVideo = null;
  }

  /** Change the look or the background in place; resolves once the background (if any) is running. */
  async update(next: Partial<LookOptions>) {
    const prev = this.options;
    this.options = { ...prev, ...next };
    if (this.options.look !== prev.look) this.lut?.setLut(lutFor(this.options.look));
    if (this.options.smooth !== prev.smooth) this.lut?.setSmooth(this.options.smooth);
    if (this.options.face !== prev.face) await this.syncEffect();
    if (this.options.background !== prev.background || this.options.imagePath !== prev.imagePath) {
      await Promise.all([this.queueBackground(), this.syncKey()]);
    } else {
      await this.bgQueue;
    }
  }

  /** The frame size the processor was set up at — what a painted background should be. */
  get size() {
    return { width: this.canvas?.width || 1280, height: this.canvas?.height || 720 };
  }

  private wanted(): BackgroundOptions | null {
    const { background, imagePath } = this.options;
    if (background === "blur-soft") return { blurRadius: SOFT_BLUR, imagePath: undefined, backgroundDisabled: false };
    if (background === "blur-strong") return { blurRadius: STRONG_BLUR, imagePath: undefined, backgroundDisabled: false };
    if ((background === "brand" || background === "image") && imagePath) {
      return { blurRadius: undefined, imagePath, backgroundDisabled: false };
    }
    return null;
  }

  /**
   * The green screen: key it out against the host's picture (or the brand),
   * cropped to the frame. No segmenter — the colour does the work, which is
   * cheaper and cleaner when there's a real backdrop.
   */
  private async syncKey() {
    const token = ++this.keyToken;
    const { background, imagePath } = this.options;
    if (background !== "green" || !imagePath) {
      this.lut?.setKey(null);
      return;
    }
    const { width, height } = this.size;
    let bmp: ImageBitmap;
    try {
      bmp = await coverBitmap(imagePath, width, height);
    } catch (e) {
      throw new LookError(`The green screen's picture couldn't load: ${message(e)}`);
    }
    // Settings moved on (or the processor stopped) while it loaded.
    if (token !== this.keyToken || !this.live || !this.lut) {
      bmp.close();
      return;
    }
    this.lut.setKey(bmp);
  }

  /** The face effect: its art loaded (cached after the first time), then handed to the stage. */
  private async syncEffect() {
    const token = ++this.effectToken;
    const effect = this.options.face;
    if (effect === "none") {
      this.lut?.setEffect("none", new Map());
      return;
    }
    const art = await loadEffectArt(effect);
    if (token !== this.effectToken || !this.live || !this.lut) return;
    this.lut.setEffect(effect, art);
  }

  /** Background changes run one after another, each reading the latest options when its turn comes. */
  private queueBackground(): Promise<void> {
    const run = this.bgQueue.catch(() => {}).then(() => this.syncBackground());
    this.bgQueue = run;
    return run;
  }

  private async syncBackground() {
    const want = this.wanted();
    if (!want) {
      this.bgOn = false;
      return;
    }
    if (!this.live || !this.inputVideo || !this.canvas) return;
    if (!this.bg) {
      const bg = new this.mod.BackgroundTransformer({
        assetPaths: SEGMENTER_ASSETS,
        onFrameProcessed: (stats) => this.onFrame?.(stats),
      });
      // Its own canvas: the segmenter shares that WebGL context, so it can't be the LUT's.
      const canvas = new OffscreenCanvas(this.canvas.width, this.canvas.height);
      try {
        await withTimeout(
          bg.init({ outputCanvas: canvas, inputElement: this.inputVideo }),
          BACKGROUND_TIMEOUT_MS,
          "The background's model didn't arrive in time."
        );
      } catch (e) {
        await bg.destroy().catch(() => {});
        throw new LookError(`The background couldn't start: ${message(e)}`);
      }
      if (!this.live) {
        await bg.destroy().catch(() => {});
        return;
      }
      this.bg = bg;
    }
    // Options may have moved on while the model loaded.
    const latest = this.wanted();
    if (!latest) {
      this.bgOn = false;
      return;
    }
    try {
      await this.bg.update(latest);
    } catch (e) {
      this.bgOn = false;
      throw new LookError(`The background couldn't load: ${message(e)}`);
    }
    this.bgMisses = 0;
    this.bgOn = true;
  }

  async transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    if (!this.live || this.bypass || !this.lut) {
      controller.enqueue(frame);
      return;
    }
    // Where the face is now, for the skin mask and the face effect: the
    // tracker on the raw camera sees the same frame geometry.
    if (this.options.smooth > 0 || this.options.face !== "none") {
      const mesh = latestFaceMesh();
      this.lut.setMesh(mesh && performance.now() - mesh.t < FACE_MESH_STALE_MS ? mesh : null);
    }
    if (frame.codedWidth === 0 || frame.codedHeight === 0) {
      frame.close();
      return;
    }
    const bg = this.bgOn ? this.bg : null;
    if (!bg) {
      this.grade(frame, controller);
      return;
    }
    // The background stage closes what it doesn't hand on; whatever it enqueues is ours to grade and close.
    let handed = 0;
    await bg.transform(frame, {
      enqueue: (out: VideoFrame) => {
        handed++;
        this.grade(out, controller);
      },
    } as TransformStreamDefaultController<VideoFrame>);
    if (handed > 0) {
      this.bgMisses = 0;
    } else if (++this.bgMisses >= BACKGROUND_MAX_MISSES) {
      this.bgOn = false;
      this.onBackgroundLost?.("The background stopped delivering frames.");
    }
  }

  /** The LUT pass: a new frame from the canvas, or the frame as it is if the GPU won't play. */
  private grade(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    try {
      const t0 = performance.now();
      if (this.lut && this.canvas && this.lut.grade(frame)) {
        const out = new VideoFrame(this.canvas, { timestamp: frame.timestamp });
        frame.close();
        controller.enqueue(out);
        this.onGraded?.(performance.now() - t0);
        return;
      }
    } catch {
      // Fall through: the frame goes out untouched.
    }
    controller.enqueue(frame);
  }
}

/** The processor on the camera: a LiveKit `TrackProcessor` that takes new settings in place. */
export interface LookProcessor extends TrackProcessor<Track.Kind> {
  /** What it's running. */
  readonly settings: LookSettings;
  /** Switch background and look in place; resolves once the background (if any) is on, rejects if it can't be. */
  apply(next: LookSettings, sources?: LookSources): Promise<void>;
  /** Compare: while on, frames pass through untouched. */
  setBypass(on: boolean): void;
  readonly bypassed: boolean;
  /** The background stage gave up mid-stream; the look carries on without it. */
  onBackgroundLost?: (reason: string) => void;
  /** Each frame out through the pass, with what the pass cost in ms (the device test). */
  onGraded?: (ms: number) => void;
}

type LookProcessorClass = new (transformer: LookTransformer, settings: LookSettings) => LookProcessor;
let processorClass: LookProcessorClass | null = null;

function createLookProcessor(mod: Processors, settings: LookSettings): LookProcessor {
  processorClass ??= class LookProcessorImpl
    extends mod.ProcessorWrapper<LookOptions, LookTransformer>
    implements LookProcessor
  {
    settings: LookSettings;
    private brandUrl: string | null = null;
    private brandKey = "";

    constructor(transformer: LookTransformer, initial: LookSettings) {
      super(transformer, LOOK_PROCESSOR_NAME);
      this.settings = initial;
      transformer.onBackgroundLost = (reason) => {
        this.settings = { ...this.settings, background: "none" };
        this.onBackgroundLost?.(reason);
      };
      transformer.onGraded = (ms) => this.onGraded?.(ms);
    }

    onBackgroundLost?: (reason: string) => void;
    onGraded?: (ms: number) => void;

    get bypassed() {
      return this.transformer.bypass;
    }

    setBypass(on: boolean) {
      this.transformer.bypass = on;
    }

    async apply(next: LookSettings, sources: LookSources = {}) {
      let imagePath: string | null = null;
      if (next.background === "image") {
        imagePath = sources.imageUrl ?? null;
        if (!imagePath) throw new LookError("Pick a picture first.");
      } else if (next.background === "brand") {
        imagePath = await this.brandBackground(sources.brand ?? null);
      } else if (next.background === "green") {
        // Keyed out onto the host's own picture when there is one, else the brand.
        imagePath = sources.imageUrl ?? (await this.brandBackground(sources.brand ?? null));
      }
      this.settings = next;
      await this.transformer.update({ look: next.look, background: next.background, imagePath, smooth: next.smooth, face: next.face });
    }

    /** The brand's flat colour with the logo small in a corner, painted once per size and kit. */
    private async brandBackground(brand: LookSources["brand"]) {
      const { width, height } = this.transformer.size;
      const fill = brand?.fill ?? "#f85810";
      const logoUrl = brand?.logoUrl ?? null;
      const key = `${fill}|${logoUrl ?? ""}|${width}x${height}`;
      if (this.brandUrl && this.brandKey === key) return this.brandUrl;
      const blob = await paintBrand(fill, logoUrl, width, height);
      if (this.brandUrl) URL.revokeObjectURL(this.brandUrl);
      this.brandUrl = URL.createObjectURL(blob);
      this.brandKey = key;
      return this.brandUrl;
    }

    async destroy(opts?: TrackTransformerDestroyOptions) {
      await super.destroy(opts);
      if (!opts?.willProcessorRestart && this.brandUrl) {
        URL.revokeObjectURL(this.brandUrl);
        this.brandUrl = null;
        this.brandKey = "";
      }
    }
  };
  return new processorClass(new LookTransformer(mod, { look: settings.look, background: settings.background, smooth: settings.smooth, face: settings.face, imagePath: null }), settings);
}

/** A flat accent with the logo top-right, at the frame's size; the colour alone if the logo won't load. */
async function paintBrand(fill: string, logoUrl: string | null, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new LookError("The brand background couldn't be painted.");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  if (logoUrl) {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = logoUrl;
      await img.decode();
      // Small, in a corner: a tenth of the height, a margin of the same.
      const inset = Math.round(Math.min(width, height) * 0.06);
      const h = Math.round(height * 0.11);
      const w = Math.min(Math.round((img.naturalWidth / Math.max(1, img.naturalHeight)) * h), Math.round(width * 0.3));
      ctx.drawImage(img, width - inset - w, inset, w, h);
    } catch {
      // A logo that won't load (offline, or a server without CORS) leaves the colour on its own.
    }
  }
  return canvas.convertToBlob({ type: "image/png" });
}

/* ---- what the studio calls ------------------------------------------- */

export type LookResult =
  | { ok: true; applied: LookSettings }
  | { ok: false; reason: string; applied: LookSettings };

/** The look processor on this track, if it's ours. */
export function getLookProcessor(track: LocalVideoTrack): LookProcessor | null {
  const p = track.getProcessor();
  return p && p.name === LOOK_PROCESSOR_NAME && "apply" in p ? (p as LookProcessor) : null;
}

/** Compare: hold to see the picture as the camera gives it. */
export function setLookBypass(track: LocalVideoTrack, on: boolean) {
  getLookProcessor(track)?.setBypass(on);
}

// One change at a time per track: a quick second tap waits for the first.
const chains = new WeakMap<LocalVideoTrack, Promise<unknown>>();

/**
 * Put these settings on the camera. Reuses a running processor (a look is
 * a texture swap, a background a mode switch), sets one up when there's
 * nothing yet, and takes it off when everything's back to none/natural.
 * Never throws: a background that won't start leaves the look on and says
 * so in `reason`; `applied` is what the camera is actually wearing now.
 */
export function applyLook(track: LocalVideoTrack, settings: LookSettings, sources: LookSources = {}): Promise<LookResult> {
  const run = (chains.get(track) ?? Promise.resolve()).catch(() => {}).then(() => applyNow(track, settings, sources));
  chains.set(track, run);
  return run;
}

async function applyNow(track: LocalVideoTrack, settings: LookSettings, sources: LookSources): Promise<LookResult> {
  const running = getLookProcessor(track);
  if (isPlainLook(settings)) {
    if (running) await track.stopProcessor().catch(() => {});
    return { ok: true, applied: DEFAULT_LOOK_SETTINGS };
  }
  if (!isLooksSupported()) {
    return { ok: false, reason: "Backgrounds and looks need Chrome or Edge on a computer.", applied: DEFAULT_LOOK_SETTINGS };
  }
  let proc = running;
  try {
    if (!proc) {
      const mod = await loadProcessors();
      proc = createLookProcessor(mod, settings);
      await track.setProcessor(proc);
    }
    await proc.apply(settings, sources);
    return { ok: true, applied: settings };
  } catch (err) {
    const reason = message(err);
    // A background that won't start shouldn't take the look with it.
    if (settings.background !== "none" && proc && getLookProcessor(track) === proc) {
      const fallback: LookSettings = { ...settings, background: "none" };
      try {
        if (isPlainLook(fallback)) await track.stopProcessor();
        else await proc.apply(fallback, sources);
        return { ok: false, reason, applied: fallback };
      } catch {
        // Then nothing at all.
      }
    }
    await track.stopProcessor().catch(() => {});
    return { ok: false, reason, applied: DEFAULT_LOOK_SETTINGS };
  }
}

/** Take the look off the camera, if it's on. */
export async function stopLook(track: LocalVideoTrack) {
  if (getLookProcessor(track)) await track.stopProcessor().catch(() => {});
}

export interface DeviceTestResult {
  /** The device kept the strong blur at or above `MIN_BLUR_FPS`. */
  ok: boolean;
  fps: number;
  reason?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Can this device blur? The strong blur runs on a clone of the camera for
 * about two seconds — the studio's preview isn't touched — and what comes
 * back is the frame rate it managed once the model was warm. Run it
 * before the first blur; a running look is left alone (the clone is of
 * the camera, not of the processed picture).
 */
export async function deviceTest(track: LocalVideoTrack, { seconds = 2 }: { seconds?: number } = {}): Promise<DeviceTestResult> {
  if (!isLooksSupported()) return { ok: false, fps: 0, reason: "Backgrounds and looks need Chrome or Edge on a computer." };
  const raw = (track.getProcessor() as { source?: MediaStreamTrack } | undefined)?.source ?? track.mediaStreamTrack;
  let clone: MediaStreamTrack | null = null;
  let video: HTMLVideoElement | null = null;
  let processor: { init(opts: { kind: Track.Kind; track: MediaStreamTrack; element: HTMLMediaElement }): Promise<void>; destroy(): Promise<void> } | null = null;
  try {
    const mod = await loadProcessors();
    clone = raw.clone();
    video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([clone]);
    await video.play().catch(() => {});
    let frames = 0;
    let first = 0;
    processor = mod.BackgroundProcessor({
      mode: "background-blur",
      blurRadius: STRONG_BLUR,
      assetPaths: SEGMENTER_ASSETS,
      onFrameProcessed: () => {
        frames++;
        if (!first) first = performance.now();
      },
    });
    await withTimeout(
      processor.init({ kind: track.kind, track: clone, element: video }),
      BACKGROUND_TIMEOUT_MS,
      "The blur's model didn't arrive in time."
    );
    const started = performance.now();
    while (!first && performance.now() - started < FIRST_FRAME_TIMEOUT_MS) await sleep(50);
    if (!first) return { ok: false, fps: 0, reason: "No frames came through the blur." };
    // Count once the model is warm, so the first frame's setup doesn't drag the number down.
    const from = frames;
    const t0 = performance.now();
    await sleep(seconds * 1000);
    const fps = (frames - from) / ((performance.now() - t0) / 1000);
    return { ok: fps >= MIN_BLUR_FPS, fps: Math.round(fps * 10) / 10 };
  } catch (e) {
    return { ok: false, fps: 0, reason: message(e) };
  } finally {
    await processor?.destroy().catch(() => {});
    clone?.stop();
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }
}
