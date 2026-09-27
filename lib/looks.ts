"use client";

import { useSyncExternalStore } from "react";
import type { LocalVideoTrack, TrackProcessor, Track } from "livekit-client";
import type {
  BackgroundOptions,
  BackgroundTransformer,
  TrackTransformerDestroyOptions,
  VideoTrackTransformer,
  VideoTransformerInitOptions,
} from "@livekit/track-processors";

/**
 * Your picture (Phase 1, the Look half of "Sound & look"): what's behind
 * you — nothing, a blur, your brand's colour, a picture of your own — and
 * a look, a colour grade the camera wears. Both ride one LiveKit track
 * processor: the package's segmenter for the background, then a 17³ 3D
 * LUT in WebGL2 for the look, on the same frame. A look is a switch of
 * LUT texture, never a rebuilt pipeline, and nothing here may ever take
 * the camera down: every failure lands as "your picture, as it is".
 *
 * The pure parts (the looks' maths, the settings) run in Node for the
 * tests; the browser parts sit behind guards and a dynamic import, so the
 * studio's bundle only carries MediaPipe once someone picks a look.
 */

export type LookBackground = "none" | "blur-soft" | "blur-strong" | "brand" | "image";
export type Look = "natural" | "warm" | "cool" | "film" | "mono" | "punch";

export interface LookSettings {
  background: LookBackground;
  look: Look;
}

export const DEFAULT_LOOK_SETTINGS: LookSettings = { background: "none", look: "natural" };

export const BACKGROUNDS: { id: LookBackground; label: string; hint: string }[] = [
  { id: "none", label: "None", hint: "Your picture as it is." },
  { id: "blur-soft", label: "Soft blur", hint: "Softens what's behind you." },
  { id: "blur-strong", label: "Strong blur", hint: "Hides what's behind you." },
  { id: "brand", label: "Brand", hint: "Your accent colour, your logo in the corner — the kit from Scenes." },
  { id: "image", label: "Your image", hint: "Stays on this device. It's never uploaded." },
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
type LookOptions = { look: Look; background: LookBackground; imagePath: string | null };

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

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_frame;
uniform sampler3D u_lut;
uniform float u_scale;
uniform float u_offset;
in vec2 v_uv;
out vec4 o_color;
void main() {
  vec3 c = texture(u_frame, v_uv).rgb;
  // Sample cell centres, so the cube's corners are exactly black and white.
  o_color = vec4(texture(u_lut, c * u_scale + u_offset).rgb, 1.0);
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

interface LutStage {
  /** Swap the look: a texture upload, nothing else. */
  setLut(bytes: Uint8Array): void;
  /** Draw a frame through the LUT onto the canvas; false when the GPU has gone away. */
  grade(frame: VideoFrame): boolean;
  destroy(): void;
}

/**
 * One WebGL2 context on the processor's canvas, one frame texture, one
 * 17³ LUT texture, one full-screen pass. That's the whole GPU budget of a
 * look. A lost context passes frames through until it comes back.
 */
function createLutStage(canvas: OffscreenCanvas | HTMLCanvasElement): LutStage | null {
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
  let frameTex: WebGLTexture | null = null;
  let lutTex: WebGLTexture | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let vbo: WebGLBuffer | null = null;
  let current: Uint8Array | null = null;
  let lost = false;

  function build() {
    const vs = compile(gl!, gl!.VERTEX_SHADER, VERT);
    const fs = compile(gl!, gl!.FRAGMENT_SHADER, FRAG);
    program = gl!.createProgram();
    if (!program) throw new LookError("The look's program couldn't be created.");
    gl!.attachShader(program, vs);
    gl!.attachShader(program, fs);
    gl!.linkProgram(program);
    gl!.deleteShader(vs);
    gl!.deleteShader(fs);
    if (!gl!.getProgramParameter(program, gl!.LINK_STATUS)) {
      throw new LookError(`The look's program didn't link: ${gl!.getProgramInfoLog(program) ?? ""}`);
    }
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

    // The frame, sampled 1:1 — no filtering to soften it.
    frameTex = gl!.createTexture();
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, frameTex);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);

    // The cube, trilinear so 17 points a side reads as a smooth grade.
    lutTex = gl!.createTexture();
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_3D, lutTex);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_3D, gl!.TEXTURE_WRAP_R, gl!.CLAMP_TO_EDGE);
    gl!.texImage3D(gl!.TEXTURE_3D, 0, gl!.RGBA8, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, current);

    gl!.uniform1i(gl!.getUniformLocation(program, "u_frame"), 0);
    gl!.uniform1i(gl!.getUniformLocation(program, "u_lut"), 1);
    gl!.uniform1f(gl!.getUniformLocation(program, "u_scale"), (LUT_SIZE - 1) / LUT_SIZE);
    gl!.uniform1f(gl!.getUniformLocation(program, "u_offset"), 0.5 / LUT_SIZE);
  }

  function release() {
    if (program) gl!.deleteProgram(program);
    if (frameTex) gl!.deleteTexture(frameTex);
    if (lutTex) gl!.deleteTexture(lutTex);
    if (vbo) gl!.deleteBuffer(vbo);
    if (vao) gl!.deleteVertexArray(vao);
    program = frameTex = lutTex = vbo = vao = null;
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
    grade(frame) {
      if (lost || !program) return false;
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, lutTex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return true;
    },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      release();
      // Hand the GPU memory back now rather than whenever the canvas is collected.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/**
 * The transformer: the package's background stage (when a background is
 * chosen) and then the LUT, on one frame. The background stage arrives
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

  private readonly mod: Processors;
  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private inputVideo: HTMLVideoElement | null = null;
  private lut: LutStage | null = null;
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
    const lut = createLutStage(outputCanvas);
    if (!lut) throw new LookError("This device's browser has no WebGL2 for the look.");
    lut.setLut(lutFor(this.options.look));
    this.lut = lut;
    this.live = true;
    this.bgMisses = 0;
    // Not awaited: the background arrives when its model has; `update` is what waits on it.
    void this.queueBackground().catch(() => {});
  }

  async restart(opts: VideoTransformerInitOptions) {
    await this.destroy({ willProcessorRestart: true });
    await this.init(opts);
  }

  async destroy(opts?: TrackTransformerDestroyOptions) {
    this.live = false;
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
    if (this.options.background !== prev.background || this.options.imagePath !== prev.imagePath) {
      await this.queueBackground();
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
      if (this.lut && this.canvas && this.lut.grade(frame)) {
        const out = new VideoFrame(this.canvas, { timestamp: frame.timestamp });
        frame.close();
        controller.enqueue(out);
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
    }

    onBackgroundLost?: (reason: string) => void;

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
      }
      this.settings = next;
      await this.transformer.update({ look: next.look, background: next.background, imagePath });
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
  return new processorClass(new LookTransformer(mod, { ...settings, imagePath: null }), settings);
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
  if (settings.background === "none" && settings.look === "natural") {
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
        if (fallback.look === "natural") await track.stopProcessor();
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
