"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * Face anchors (Phase 4, Sets): where the host's face is, so a gift's crown
 * lands on their head on every viewer's screen. The host's browser finds
 * the face in its own camera — MediaPipe's FaceLandmarker, a dozen times a
 * second at most — boils its 478 landmarks down to a few points and sends
 * them to the room on LiveKit's lossy data channel (topic "anchors") as 28
 * bytes. Viewers keep the last few packets and interpolate, so the effects
 * glide at the screen's pace, a moment behind to meet the video.
 *
 * Nothing about the face leaves the device but these numbers — never a
 * picture, never the landmarks — and the model only runs while the stream's
 * Set has effects that sit on the face and the camera is what's on.
 *
 *   byte  0      version (high nibble) · session (bits 1–3) · a face is in the frame (bit 0)
 *   byte  1      sequence, wrapping at 256
 *   bytes 2–3    the host's clock in ms, wrapping at 65 536
 *   bytes 4–5    the frame's aspect (width ÷ height) × 10 000
 *   … and with a face:
 *   bytes 6–9    face centre x, y      int16 ÷ 16 384 (x in frame widths, y in frame heights)
 *   bytes 10–13  face width, height    uint16 ÷ 16 384, in frame heights
 *   bytes 14–21  the two eyes' centres int16 x, y each
 *   bytes 22–25  the mouth's centre    int16 x, y
 *   bytes 26–27  head roll             int16, radians × 10 000
 *
 * Little-endian throughout. The pure parts — the codec, the mapping onto a
 * tile, the feed — run in Node for the tests; MediaPipe loads by dynamic
 * import, and only once something starts it.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * A face in the frame. Positions are fractions of the frame — x of its
 * width, y of its height, as the camera sends it (never mirrored); sizes
 * are in frame heights, measured along the face's own axes, so they read
 * the same whichever way the head tilts.
 */
export interface FaceAnchors {
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** The eye on the frame's left while the head is upright, then the other. */
  eyes: [Point, Point];
  mouth: Point;
  /** Head roll in radians: positive leans clockwise as the frame shows it. */
  roll: number;
}

export interface AnchorPacket {
  /** 1–7, picked when the host's tracker starts: a new one (a reload, say) tells viewers to start over. */
  session?: number;
  seq: number;
  /** The host's clock (performance.now) when the frame was looked at, ms. */
  t: number;
  /** The frame's width over its height. */
  aspect: number;
  /** Null: nobody's face is in the frame. */
  face: FaceAnchors | null;
}

/* ---- the codec ---------------------------------------------------------- */

export const ANCHORS_TOPIC = "anchors";
export const ANCHOR_VERSION = 1;
/** A packet with a face; one without is just the 6-byte header. */
export const ANCHOR_BYTES = 28;
const HEADER_BYTES = 6;
/** Fixed point: 14 fractional bits — ±2 frames at a 16th of a pixel on a 1080p frame. */
const Q = 16384;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const toI16 = (v: number) => Math.round(clamp((Number.isFinite(v) ? v : 0) * Q, -32768, 32767));
const toU16 = (v: number) => Math.round(clamp((Number.isFinite(v) ? v : 0) * Q, 0, 65535));
/** Any angle as the same angle in (−π, π]. */
export function wrapAngle(a: number) {
  if (!Number.isFinite(a)) return 0;
  const r = ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return r === -Math.PI ? Math.PI : r;
}

export function encodeAnchors(packet: AnchorPacket): Uint8Array<ArrayBuffer> {
  const f = packet.face;
  const buf = new ArrayBuffer(f ? ANCHOR_BYTES : HEADER_BYTES);
  const v = new DataView(buf);
  v.setUint8(0, (ANCHOR_VERSION << 4) | (((packet.session ?? 0) & 7) << 1) | (f ? 1 : 0));
  v.setUint8(1, packet.seq & 0xff);
  v.setUint16(2, Math.round(Math.max(0, packet.t)) & 0xffff, true);
  v.setUint16(4, Math.round(clamp(packet.aspect, 0.1, 6.5) * 10000), true);
  if (f) {
    v.setInt16(6, toI16(f.cx), true);
    v.setInt16(8, toI16(f.cy), true);
    v.setUint16(10, toU16(f.w), true);
    v.setUint16(12, toU16(f.h), true);
    v.setInt16(14, toI16(f.eyes[0].x), true);
    v.setInt16(16, toI16(f.eyes[0].y), true);
    v.setInt16(18, toI16(f.eyes[1].x), true);
    v.setInt16(20, toI16(f.eyes[1].y), true);
    v.setInt16(22, toI16(f.mouth.x), true);
    v.setInt16(24, toI16(f.mouth.y), true);
    v.setInt16(26, Math.round(wrapAngle(f.roll) * 10000), true);
  }
  return new Uint8Array(buf);
}

/** A packet off the room, or null when it isn't one this build reads. Longer packets (a later minor version) read as far as they're known. */
export function decodeAnchors(data: ArrayBuffer | ArrayBufferView): AnchorPacket | null {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength < HEADER_BYTES) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const head = v.getUint8(0);
  if (head >> 4 !== ANCHOR_VERSION) return null;
  const hasFace = (head & 1) === 1;
  if (hasFace && bytes.byteLength < ANCHOR_BYTES) return null;
  const aspect = v.getUint16(4, true) / 10000;
  if (!(aspect > 0)) return null;
  const packet: AnchorPacket = { session: (head >> 1) & 7, seq: v.getUint8(1), t: v.getUint16(2, true), aspect, face: null };
  if (hasFace) {
    const i = (at: number) => v.getInt16(at, true) / Q;
    const w = v.getUint16(10, true) / Q;
    const h = v.getUint16(12, true) / Q;
    if (!(w > 0) || !(h > 0)) return packet;
    packet.face = {
      cx: i(6),
      cy: i(8),
      w,
      h,
      eyes: [
        { x: i(14), y: i(16) },
        { x: i(18), y: i(20) },
      ],
      mouth: { x: i(22), y: i(24) },
      roll: v.getInt16(26, true) / 10000,
    };
  }
  return packet;
}

/* ---- from landmarks ----------------------------------------------------- */

// MediaPipe's face mesh: the eyes' corners and lids, the lips, the face's edges.
const EYE_A = [33, 133, 159, 145];
const EYE_B = [362, 263, 386, 374];
const MOUTH = [13, 14, 61, 291];
const CHEEK_A = 234;
const CHEEK_B = 454;
const BROW_TOP = 10;
const CHIN = 152;

/**
 * 478 landmarks (fractions of the frame, as FaceLandmarker gives them) down
 * to the few points the effects need. Distances are taken with x stretched
 * by the aspect, so a face's width means the same on a tall frame and a
 * wide one.
 */
export function reduceLandmarks(landmarks: ArrayLike<{ x: number; y: number }> | null | undefined, aspect: number): FaceAnchors | null {
  if (!landmarks || landmarks.length < 468 || !(aspect > 0)) return null;
  const at = (i: number): Point => ({ x: landmarks[i].x * aspect, y: landmarks[i].y });
  const mean = (ids: number[]): Point => {
    let x = 0;
    let y = 0;
    for (const i of ids) {
      x += landmarks[i].x * aspect;
      y += landmarks[i].y;
    }
    return { x: x / ids.length, y: y / ids.length };
  };
  const a = mean(EYE_A);
  const b = mean(EYE_B);
  const mouth = mean(MOUTH);
  const l = at(CHEEK_A);
  const r = at(CHEEK_B);
  const top = at(BROW_TOP);
  const chin = at(CHIN);
  const w = Math.hypot(r.x - l.x, r.y - l.y);
  const h = Math.hypot(chin.x - top.x, chin.y - top.y);
  if (!(w > 0) || !(h > 0)) return null;
  const back = (p: Point): Point => ({ x: p.x / aspect, y: p.y });
  return {
    cx: (l.x + r.x + top.x + chin.x) / 4 / aspect,
    cy: (l.y + r.y + top.y + chin.y) / 4,
    w,
    h,
    eyes: [back(a), back(b)],
    mouth: back(mouth),
    roll: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

/** Partway from one face to the next: straight lines, and the short way round for the roll. */
export function lerpFace(a: FaceAnchors, b: FaceAnchors, k: number): FaceAnchors {
  const t = clamp(k, 0, 1);
  const m = (x: number, y: number) => x + (y - x) * t;
  const p = (x: Point, y: Point): Point => ({ x: m(x.x, y.x), y: m(x.y, y.y) });
  return {
    cx: m(a.cx, b.cx),
    cy: m(a.cy, b.cy),
    w: m(a.w, b.w),
    h: m(a.h, b.h),
    eyes: [p(a.eyes[0], b.eyes[0]), p(a.eyes[1], b.eyes[1])],
    mouth: p(a.mouth, b.mouth),
    roll: a.roll + wrapAngle(b.roll - a.roll) * t,
  };
}

/* ---- onto a tile -------------------------------------------------------- */

export type Fit = "cover" | "contain";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a frame of this aspect is drawn in a tile, as CSS object-fit draws it (centred). */
export function frameBox(aspect: number | null | undefined, tileW: number, tileH: number, fit: Fit): Box {
  const a = aspect && aspect > 0 ? aspect : tileW / Math.max(1, tileH);
  // The frame is a × 1; scale it to fill (cover) or fit (contain) the tile.
  const s = fit === "cover" ? Math.max(tileW / a, tileH) : Math.min(tileW / a, tileH);
  const w = a * s;
  return { x: (tileW - w) / 2, y: (tileH - s) / 2, w, h: s };
}

/** The part of the frame that's actually on the tile (all of it with contain; the middle with cover). */
export function visibleBox(box: Box, tileW: number, tileH: number): Box {
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  return { x, y, w: Math.min(tileW, box.x + box.w) - x, h: Math.min(tileH, box.y + box.h) - y };
}

/** A point in the frame, on the tile in its pixels — flipped as a mirrored video draws it. */
export function toTile(p: Point, box: Box, tileW: number, mirrored = false): Point {
  const x = box.x + p.x * box.w;
  return { x: mirrored ? tileW - x : x, y: box.y + p.y * box.h };
}

/** A face on the tile, in its pixels: what the effects are drawn around. */
export interface FaceGeo {
  cx: number;
  cy: number;
  /** Width and height along the face's own axes. */
  fw: number;
  fh: number;
  /** Head roll, radians, clockwise positive on the tile. */
  roll: number;
  /** Between the eyes, and how far apart they are. */
  ex: number;
  ey: number;
  ed: number;
  mx: number;
  my: number;
  /** False: no face is known and this is the centre-frame stand-in. */
  known: boolean;
}

/**
 * The face as it lands on a tile showing the frame with `fit` — the same
 * crop the video gets — mirrored (x flipped, roll reversed) when the tile
 * shows the picture the way a front camera's preview does.
 */
export function mapFace(face: FaceAnchors, aspect: number, tileW: number, tileH: number, fit: Fit, mirrored = false): FaceGeo {
  const box = frameBox(aspect, tileW, tileH, fit);
  const c = toTile({ x: face.cx, y: face.cy }, box, tileW, mirrored);
  const e0 = toTile(face.eyes[0], box, tileW, mirrored);
  const e1 = toTile(face.eyes[1], box, tileW, mirrored);
  const m = toTile(face.mouth, box, tileW, mirrored);
  return {
    cx: c.x,
    cy: c.y,
    // Frame heights to pixels: the frame is drawn box.h tall, and the scale is the same both ways.
    fw: face.w * box.h,
    fh: face.h * box.h,
    roll: mirrored ? -face.roll : face.roll,
    ex: (e0.x + e1.x) / 2,
    ey: (e0.y + e1.y) / 2,
    ed: Math.hypot(e1.x - e0.x, e1.y - e0.y),
    mx: m.x,
    my: m.y,
    known: true,
  };
}

/** Where effects sit when no face is known: a face-sized spot a little above the middle of what's on the tile. */
export function fallbackFace(visible: Box): FaceGeo {
  const fw = 0.3 * Math.max(1, Math.min(visible.w, visible.h));
  const fh = fw * 1.3;
  const cx = visible.x + visible.w / 2;
  const cy = visible.y + visible.h * 0.44;
  return { cx, cy, fw, fh, roll: 0, ex: cx, ey: cy - fh * 0.12, ed: fw * 0.42, mx: cx, my: cy + fh * 0.24, known: false };
}

/** Eased from one placement toward another: `k` of the way (0–1). */
export function mixFace(a: FaceGeo, b: FaceGeo, k: number): FaceGeo {
  const t = clamp(k, 0, 1);
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    cx: m(a.cx, b.cx),
    cy: m(a.cy, b.cy),
    fw: m(a.fw, b.fw),
    fh: m(a.fh, b.fh),
    roll: a.roll + wrapAngle(b.roll - a.roll) * t,
    ex: m(a.ex, b.ex),
    ey: m(a.ey, b.ey),
    ed: m(a.ed, b.ed),
    mx: m(a.mx, b.mx),
    my: m(a.my, b.my),
    known: b.known,
  };
}

/* ---- the viewer's feed -------------------------------------------------- */

/** No packet for this long: the face is no longer known. */
export const ANCHORS_STALE_MS = 1500;
/** How late a packet may be and still count as merely out of order (older than this is the host starting over). */
const REORDER_MS = 2000;
/** The playout clock may drift up this much a packet, so one lucky fast packet doesn't pin it forever. */
const DRIFT_MS = 1;
/**
 * A packet this much later than the clock expects re-syncs it rather than
 * creeping — the path got slower for good. A one-off late packet only
 * moves it for a frame: the next on-time one brings it straight back.
 */
const RESYNC_MS = 400;
const KEEP = 12;

const nowMs = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export interface AnchorSample {
  face: FaceAnchors | null;
  /** The frame's aspect as last heard (null: never). */
  aspect: number | null;
}

/**
 * The host's face as this screen knows it: the last second of packets on
 * the host's own clock, mapped onto this device's (by the fastest packet
 * seen — the rest only arrived later), and sampled a little in the past so
 * there's a packet either side to glide between. Out-of-order and repeated
 * packets are dropped; a host who reloads starts a fresh clock, and the
 * feed starts over with it.
 */
export class AnchorFeed {
  private frames: { st: number; face: FaceAnchors | null }[] = [];
  private session: number | null = null;
  private lastT: number | null = null;
  private unwrapped = 0;
  private offset: number | null = null;
  private lastArrival = -Infinity;
  /** The frame's aspect as last heard. */
  aspect: number | null = null;
  received = 0;
  dropped = 0;

  /** A packet off the room: call it for topic "anchors" from the host's identity only. False when it's not one, or out of turn. */
  push(data: ArrayBuffer | ArrayBufferView, receivedAt = nowMs()): boolean {
    const p = decodeAnchors(data);
    if (!p) {
      this.dropped++;
      return false;
    }
    // A new tracker on the host's side, or a long silence: start over.
    if (receivedAt - this.lastArrival > 5000 || (this.session !== null && p.session !== this.session)) this.reset();
    if (this.lastT !== null) {
      const d = (p.t - this.lastT + 65536) % 65536;
      if (d === 0 || (d >= 32768 && 65536 - d < REORDER_MS)) {
        this.dropped++;
        return false;
      }
      // Far older than the last: the host's clock started over.
      if (d >= 32768) this.reset();
      else this.unwrapped += d;
    }
    this.session = p.session ?? 0;
    this.lastT = p.t;
    const seen = receivedAt - this.unwrapped;
    this.offset = this.offset === null || seen - this.offset > RESYNC_MS ? seen : Math.min(this.offset + DRIFT_MS, seen);
    this.add(this.unwrapped, p.face, p.aspect, receivedAt);
    this.received++;
    return true;
  }

  /** The host's own detections, straight in — no codec, no network: `at` is when the frame was looked at. */
  put(face: FaceAnchors | null, aspect: number, at = nowMs()) {
    this.offset = 0;
    this.lastT = null;
    this.session = null;
    const last = this.frames[this.frames.length - 1];
    this.add(last && at <= last.st ? last.st + 0.001 : at, face, aspect, at);
  }

  /** The face as of `delay` ms ago (to meet a video that runs behind the data), or null. */
  sample(delay = 0, now = nowMs()): AnchorSample {
    const aspect = this.aspect;
    if (!this.frames.length || this.offset === null || now - this.lastArrival > ANCHORS_STALE_MS) return { face: null, aspect };
    const at = now - delay - this.offset;
    let i = this.frames.length - 1;
    while (i >= 0 && this.frames[i].st > at) i--;
    const prev = i >= 0 ? this.frames[i] : null;
    const next = this.frames[i + 1] ?? null;
    if (!prev) return { face: next ? next.face : null, aspect };
    if (!next || !prev.face || !next.face) return { face: prev.face, aspect };
    return { face: lerpFace(prev.face, next.face, (at - prev.st) / Math.max(1e-6, next.st - prev.st)), aspect };
  }

  reset() {
    this.frames = [];
    this.session = null;
    this.lastT = null;
    this.unwrapped = 0;
    this.offset = null;
  }

  private add(st: number, face: FaceAnchors | null, aspect: number, arrival: number) {
    this.frames.push({ st, face });
    if (this.frames.length > KEEP) this.frames.splice(0, this.frames.length - KEEP);
    this.aspect = aspect;
    this.lastArrival = arrival;
  }
}

/** A feed for the life of a component: the watch page's for the host's packets, the studio's for its own detections. */
export function useAnchorFeed(): AnchorFeed {
  const [feed] = useState(() => new AnchorFeed());
  return feed;
}

/**
 * For the front of a `RoomEvent.DataReceived` handler: takes an "anchors"
 * packet into the feed when it's from the host (anyone else's is ignored)
 * and returns true, so the handler returns before trying to read it as
 * JSON. Returns false for everything else.
 */
export function anchorsListener(feed: AnchorFeed, hostIdentity: () => string | null | undefined) {
  return (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string): boolean => {
    if (topic !== ANCHORS_TOPIC) return false;
    const host = hostIdentity();
    if (host && participant?.identity === host) feed.push(payload);
    return true;
  };
}

/* ---- the host's side ---------------------------------------------------- */

/**
 * Where the model comes from: MediaPipe's wasm from jsDelivr at the
 * installed version and Google's float16 face landmarker (≈3.6 MB, cached
 * by the browser after the first time) — the way lib/looks.ts loads its
 * segmenter. A strict CSP or an offline host means no face tracking, and
 * effects sit centre-frame. To self-host, point these at copies in /public.
 */
export const FACE_ASSETS = {
  wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  model: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
};

/** The most detections a second — more buys nothing a viewer can see, since they interpolate. */
export const FACE_MAX_HZ = 12;
/** A detection that takes longer than this on average brings the rate down. */
export const FACE_BUDGET_MS = 30;
const FACE_MIN_HZ = 3;
/** Detections on a device's first frames compile shaders; they don't count toward the average. */
const WARMUP = 3;
/** The model stays loaded this long after the last tracker stops, so turning a Set off and on is instant. */
const LINGER_MS = 30_000;
/**
 * Frames are copied down to this width before the model sees them: it
 * works at 192 px anyway, the landmarks come back as fractions, and handing
 * it a canvas rather than the video skips a slow first upload some GPUs make
 * of a video element (seconds, in testing — the studio frozen meanwhile).
 */
const INPUT_WIDTH = 640;

export type FaceTrackState = "off" | "loading" | "tracking" | "searching" | "unavailable";

/**
 * The next rate, given what a detection costs on this device: over budget,
 * a quarter fewer looks a second (never below three); comfortably under,
 * a tenth more, back up to the most.
 */
export function adaptRate(hz: number, avgMs: number, maxHz = FACE_MAX_HZ) {
  if (avgMs > FACE_BUDGET_MS) return Math.max(FACE_MIN_HZ, hz * 0.75);
  if (avgMs < FACE_BUDGET_MS / 2) return Math.min(maxHz, hz * 1.1);
  return hz;
}

/** What the tracker needs of a Room: to publish data while connected. `Room` itself fits. */
export interface AnchorRoom {
  state: string;
  localParticipant: { publishData(data: Uint8Array<ArrayBuffer>, options?: { reliable?: boolean; topic?: string }): Promise<void> };
}

/** What the tracker needs of the camera: a LocalVideoTrack fits. */
export interface FaceTrack {
  mediaStreamTrack: MediaStreamTrack;
  isMuted?: boolean;
  getProcessor?: () => unknown;
}

/**
 * The camera as captured. Under a look, LiveKit's `mediaStreamTrack` is the
 * look's output — a track that's replaced whenever the look restarts — so
 * the processor's own source is read instead (as lib/looks.ts does).
 */
function sourceOf(track: FaceTrack): MediaStreamTrack {
  const processor = track.getProcessor?.() as { source?: MediaStreamTrack } | undefined;
  return processor?.source ?? track.mediaStreamTrack;
}

export interface FaceAnchorsOptions {
  /** The host's camera (the LocalVideoTrack): the raw capture is read, before any look. */
  track: FaceTrack;
  /** The live room: the anchors go out on it. Null before going live — the host's own preview still follows. */
  room?: AnchorRoom | null;
  /** The host's own preview's feed: detections go straight in. */
  feed?: AnchorFeed | null;
  maxHz?: number;
  onState?: (state: FaceTrackState) => void;
}

export interface FaceAnchorStats {
  state: FaceTrackState;
  /** The rate it's running at now. */
  hz: number;
  /** A detection's cost on this device, averaged, once warm. */
  avgMs: number;
  /** The first detection (it compiles the model's shaders). */
  firstMs: number;
  /** Where the model runs: the GPU, or the CPU where WebGL wouldn't. */
  delegate: "GPU" | "CPU" | null;
  detections: number;
  faces: number;
  /** Packets published to the room, and the size of the last. */
  sent: number;
  packetBytes: number;
}

export interface FaceAnchorsHandle {
  /** Go live (or off air) without restarting the model. */
  setRoom(room: AnchorRoom | null): void;
  /** Stop looking: the video's let go, viewers are told there's no face, and the model is released. */
  stop(): void;
  readonly stats: FaceAnchorStats;
}

type Loaded = { landmarker: FaceLandmarker; delegate: "GPU" | "CPU" };

let shared: { promise: Promise<Loaded>; users: number; closeTimer: ReturnType<typeof setTimeout> | null } | null = null;

async function createLandmarker(): Promise<Loaded> {
  const vision = await import("@mediapipe/tasks-vision");
  const files = await vision.FilesetResolver.forVisionTasks(FACE_ASSETS.wasm);
  const make = (delegate: "GPU" | "CPU") =>
    vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: FACE_ASSETS.model, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  // The GPU where there is one; the CPU where WebGL won't play.
  try {
    return { landmarker: await make("GPU"), delegate: "GPU" };
  } catch {
    return { landmarker: await make("CPU"), delegate: "CPU" };
  }
}

function acquireLandmarker(): Promise<Loaded> {
  if (shared?.closeTimer) {
    clearTimeout(shared.closeTimer);
    shared.closeTimer = null;
  }
  if (!shared) {
    const promise = createLandmarker();
    shared = { promise, users: 0, closeTimer: null };
    // A failed load isn't kept: the next start tries again.
    promise.catch(() => {
      if (shared?.promise === promise) shared = null;
    });
  }
  shared.users++;
  return shared.promise;
}

function releaseLandmarker() {
  const s = shared;
  if (!s) return;
  s.users = Math.max(0, s.users - 1);
  if (s.users > 0 || s.closeTimer) return;
  s.closeTimer = setTimeout(() => {
    if (shared !== s || s.users > 0) return;
    shared = null;
    void s.promise.then((l) => l.landmarker.close()).catch(() => {});
  }, LINGER_MS);
}

/**
 * Start following the host's face on this camera. One at a time: the model
 * is shared, and it tracks one video. Never throws — a model that can't load
 * lands as `unavailable`, and effects sit centre-frame.
 */
export function startFaceAnchors(opts: FaceAnchorsOptions): FaceAnchorsHandle {
  const maxHz = clamp(opts.maxHz ?? FACE_MAX_HZ, 1, FACE_MAX_HZ);
  let room = opts.room ?? null;
  let landmarker: FaceLandmarker | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Viewers start over when this changes: a reload, a new camera.
  const session = 1 + Math.floor(Math.random() * 7);
  let seq = 0;
  let lastVideoTime = -1;
  let lastSentFace = false;
  let lastNoFaceAt = -Infinity;
  let aspect = 16 / 9;
  const stats: FaceAnchorStats = { state: "loading", hz: maxHz, avgMs: 0, firstMs: 0, delegate: null, detections: 0, faces: 0, sent: 0, packetBytes: 0 };
  const setState = (s: FaceTrackState) => {
    if (s === stats.state) return;
    stats.state = s;
    opts.onState?.(s);
  };
  opts.onState?.("loading");

  // A video of its own on the raw camera: the preview element isn't touched.
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  let attached: MediaStreamTrack | null = null;
  /** Follow the camera underneath: a new device, or a look put on or off, swaps the track on the same LocalVideoTrack. */
  const attach = () => {
    const src = sourceOf(opts.track);
    if (src === attached) return src;
    attached = src;
    video.srcObject = new MediaStream([src]);
    lastVideoTime = -1;
    void video.play().catch(() => {});
    return src;
  };
  attach();
  const input = document.createElement("canvas");
  const inputCtx = input.getContext("2d", { alpha: false });

  const publish = (face: FaceAnchors | null, t: number) => {
    const r = room;
    if (!r || r.state !== "connected") return;
    // A lost face goes out at once, then once a second: viewers need to know, not to hear it twelve times.
    if (!face) {
      if (!lastSentFace && t - lastNoFaceAt < 1000) return;
      lastNoFaceAt = t;
    }
    lastSentFace = Boolean(face);
    const bytes = encodeAnchors({ session, seq: seq++, t, aspect, face });
    stats.sent++;
    stats.packetBytes = bytes.byteLength;
    void r.localParticipant.publishData(bytes, { reliable: false, topic: ANCHORS_TOPIC }).catch(() => {});
  };

  const schedule = (ms: number) => {
    if (stopped || timer !== null || document.visibilityState === "hidden") return;
    timer = setTimeout(tick, ms);
  };

  function tick() {
    timer = null;
    const lm = landmarker;
    if (stopped || !lm || document.visibilityState === "hidden") return;
    const started = performance.now();
    if (attach().readyState === "ended" || opts.track.isMuted) {
      // Camera off, or between cameras: nobody to follow for now. Stopping is the studio's call.
      opts.feed?.put(null, aspect, started);
      publish(null, started);
      setState("searching");
      schedule(250);
      return;
    }
    const fresh = video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastVideoTime;
    if (fresh) {
      lastVideoTime = video.currentTime;
      aspect = video.videoWidth / video.videoHeight;
      const w = Math.min(INPUT_WIDTH, video.videoWidth);
      const h = Math.max(1, Math.round(w / aspect));
      if (input.width !== w || input.height !== h) {
        input.width = w;
        input.height = h;
      }
      let face: FaceAnchors | null = null;
      try {
        inputCtx?.drawImage(video, 0, 0, w, h);
        face = reduceLandmarks(lm.detectForVideo(inputCtx ? input : video, started).faceLandmarks[0], aspect);
      } catch {
        face = null;
      }
      const cost = performance.now() - started;
      stats.detections++;
      if (stats.detections === 1) stats.firstMs = cost;
      if (stats.detections > WARMUP) {
        stats.avgMs = stats.avgMs === 0 ? cost : stats.avgMs * 0.8 + cost * 0.2;
        // A slow device: fewer looks a second rather than a juddering studio.
        stats.hz = adaptRate(stats.hz, stats.avgMs, maxHz);
      }
      if (face) stats.faces++;
      opts.feed?.put(face, aspect, started);
      publish(face, started);
      setState(face ? "tracking" : "searching");
    }
    schedule(fresh ? Math.max(0, 1000 / stats.hz - (performance.now() - started)) : 30);
  }

  const onVisibility = () => {
    if (document.visibilityState === "visible") schedule(0);
    else if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  acquireLandmarker().then(
    (loaded) => {
      if (stopped) {
        releaseLandmarker();
        return;
      }
      landmarker = loaded.landmarker;
      stats.delegate = loaded.delegate;
      setState("searching");
      schedule(0);
    },
    () => {
      if (!stopped) setState("unavailable");
    }
  );

  const handle: FaceAnchorsHandle = {
    stats,
    setRoom(next) {
      room = next;
      lastSentFace = false;
      lastNoFaceAt = -Infinity;
    },
    stop() {
      if (stopped) return;
      // Viewers let go of the face now rather than when it goes stale.
      publish(null, performance.now());
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      document.removeEventListener("visibilitychange", onVisibility);
      video.pause();
      video.srcObject = null;
      opts.feed?.put(null, aspect);
      if (landmarker) releaseLandmarker();
      landmarker = null;
      setState("off");
    },
  };
  return handle;
}

/**
 * The studio's way in: follows the face on `track` while `enabled` — a Set
 * with face effects is on (or the Sets panel is trying them) and the camera
 * is the main picture — publishing on `room` once there is one, and feeding
 * the host's own preview. Returns what the tracker's doing, for the panel.
 */
export function useFaceAnchors({
  track,
  room = null,
  feed = null,
  enabled,
  maxHz,
}: {
  track: FaceAnchorsOptions["track"] | null | undefined;
  room?: AnchorRoom | null;
  feed?: AnchorFeed | null;
  enabled: boolean;
  maxHz?: number;
}): FaceTrackState {
  const [state, setState] = useState<FaceTrackState>("off");
  const handle = useRef<FaceAnchorsHandle | null>(null);
  const roomRef = useRef<AnchorRoom | null>(room);

  // Declared first, so a tracker starting in the same commit sees the room.
  useEffect(() => {
    roomRef.current = room;
    handle.current?.setRoom(room);
  }, [room]);

  useEffect(() => {
    if (!enabled || !track) return;
    const h = startFaceAnchors({ track, room: roomRef.current, feed, maxHz, onState: setState });
    handle.current = h;
    return () => {
      h.stop();
      if (handle.current === h) handle.current = null;
    };
  }, [enabled, track, feed, maxHz]);

  return enabled && track ? state : "off";
}
