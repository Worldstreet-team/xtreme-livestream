"use client";

import { useSyncExternalStore } from "react";
import type { LocalTrack, LocalTrackPublication, LocalVideoTrack, Room, Track, TrackProcessor } from "livekit-client";
import type { TrackTransformerDestroyOptions, VideoTrackTransformer, VideoTransformerInitOptions } from "@livekit/track-processors";
import {
  DEFAULT_DETECTORS,
  DETECTOR_OF,
  FindingTracker,
  MAX_ZONES,
  NOTICE_TEXT,
  clampRect,
  scanScreen,
  type CarriedFinding,
  type Detectors,
  type FindingKind,
  type Rect,
} from "./privacy-shield-detect";
import {
  RETRY_AFTER_MS,
  acquireOcr,
  changed,
  detectQr,
  ocrError,
  ocrState,
  onOcrState,
  prewarmOcr,
  qrDetector,
  releaseOcr,
  restartOcr,
  scanSize,
  signature,
  toGrey,
  toPgm,
  type OcrEngine,
  type OcrState,
} from "./privacy-shield-ocr";

/**
 * The privacy shield (Phase 4): while the host shares their screen, solid
 * boxes over what it recognises — keys, wallet QR codes — and over the
 * zones the host marked, and the whole screen hidden behind a slate while
 * a recovery phrase or a key export page is up, or while the host hides
 * it. An assist, not a guarantee: the checks read the screen about once a
 * second, so something can show for a moment before it's covered.
 *
 * It rides the screen share as a LiveKit track processor, like the looks
 * ride the camera (lib/looks.ts), and never takes the share down: a paint
 * that fails sends the frame as it is and says so; a check that fails
 * leaves the zones and Hide working. The OCR runs in Tesseract's worker;
 * copying a frame down for it and turning it grey (~5–7 ms a read) runs
 * on the page's main thread, in a task of its own.
 *
 * A screen only sends a frame when something on it changes — a still one,
 * a tab especially, sends none — so the shield keeps the last frame and
 * sends it again, painted as things stand now, whenever that changes (Hide,
 * a new find, a hold running out) and every 400 ms besides, and it reads
 * that kept frame too: covering and checking never wait on the screen to
 * move.
 */

/* ---- the settings ------------------------------------------------------ */

export interface PrivacyZone extends Rect {
  id: string;
}

export interface ShieldSettings {
  /** The checks: reading the screen for secrets. Zones and Hide work either way. */
  enabled: boolean;
  detectors: Detectors;
  /** Always covered while a screen's shared, on the shared screen's 0..1 square — Shield switch on or off. */
  zones: PrivacyZone[];
}

export const DEFAULT_SHIELD_SETTINGS: ShieldSettings = { enabled: true, detectors: DEFAULT_DETECTORS, zones: [] };

/**
 * The checks, as the panel names them — never in the words the page check
 * looks for ("recovery phrase", "private key"): the studio can be in the
 * very screen the shield reads, and its own panel mustn't slate it.
 */
export const DETECTOR_LABELS: { id: keyof Detectors; label: string; hint: string }[] = [
  { id: "phrases", label: "Wallet words", hint: "A wallet's 12 to 24 words hide the whole screen." },
  { id: "keys", label: "Keys", hint: "Hex, WIF and base58 keys, xprv keys and keypair files get a solid box." },
  { id: "qr", label: "Wallet QR codes", hint: "Addresses and payment requests. Your own links are left alone." },
  { id: "pages", label: "Export pages", hint: "A wallet page that reveals its words or exports its keys hides the whole screen." },
  { id: "balances", label: "Balances", hint: "Amounts beside a coin or currency on wallet screens. Prices on charts are left alone." },
];

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Settings off the shelf (a JSON string or an object): anything unknown falls back to the default; zones are kept inside the frame. */
export function readShieldSettings(raw: unknown): ShieldSettings {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return DEFAULT_SHIELD_SETTINGS;
    }
  }
  if (!value || typeof value !== "object") return DEFAULT_SHIELD_SETTINGS;
  const r = value as Record<string, unknown>;
  const d = (r.detectors && typeof r.detectors === "object" ? r.detectors : {}) as Record<string, unknown>;
  const detectors = Object.fromEntries(
    (Object.keys(DEFAULT_DETECTORS) as (keyof Detectors)[]).map((k) => [k, bool(d[k], DEFAULT_DETECTORS[k])])
  ) as unknown as Detectors;
  const zones: PrivacyZone[] = [];
  if (Array.isArray(r.zones)) {
    for (const z of r.zones.slice(0, MAX_ZONES)) {
      if (!z || typeof z !== "object") continue;
      const zz = z as Record<string, unknown>;
      if (![zz.x, zz.y, zz.w, zz.h].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      const id = typeof zz.id === "string" && zz.id ? zz.id.slice(0, 40) : newZoneId();
      zones.push({ id, ...clampRect({ x: zz.x as number, y: zz.y as number, w: zz.w as number, h: zz.h as number }) });
    }
  }
  return { enabled: bool(r.enabled, DEFAULT_SHIELD_SETTINGS.enabled), detectors, zones };
}

let zoneSeq = 0;
/** A zone's id: unique on this device, which is the only place zones live. */
export function newZoneId() {
  zoneSeq = (zoneSeq + 1) % 1e6;
  return `z${Date.now().toString(36)}${zoneSeq.toString(36)}`;
}

const KEY = "xtream:privacy-shield";
const EVENT = "xtream:privacy-shield";

let cachedRaw: string | null | undefined;
let cachedSettings: ShieldSettings = DEFAULT_SHIELD_SETTINGS;
/** Storage blocked: this page keeps its own copy. */
let memoryRaw: string | null = null;

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memoryRaw;
  }
}

/** The host's shield settings, as this browser remembers them. */
export function getShieldSettings(): ShieldSettings {
  const raw = typeof window === "undefined" ? null : readRaw();
  // Same string, same object — useSyncExternalStore wants a stable snapshot.
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSettings = raw ? readShieldSettings(raw) : DEFAULT_SHIELD_SETTINGS;
  }
  return cachedSettings;
}

function subscribeSettings(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Change some of the settings; `zones` and `detectors` are replaced as given (detectors merged). */
export function setShieldSettings(patch: Partial<Omit<ShieldSettings, "detectors">> & { detectors?: Partial<Detectors> }) {
  const cur = getShieldSettings();
  const next: ShieldSettings = { ...cur, ...patch, detectors: { ...cur.detectors, ...patch.detectors } };
  const json = JSON.stringify(readShieldSettings(next));
  try {
    localStorage.setItem(KEY, json);
  } catch {
    memoryRaw = json;
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The shield's settings, remembered by this browser. */
export function useShieldSettings(): ShieldSettings {
  return useSyncExternalStore(subscribeSettings, getShieldSettings, () => DEFAULT_SHIELD_SETTINGS);
}

/* ---- what the host sees of it -------------------------------------------- */

export type ShieldPhase = "idle" | "starting" | "on" | "unsupported" | "failed";
/** What the whole-screen slate is up for. */
export type SlateReason = "panic" | "secret" | "checking";

export interface ShieldNotice {
  id: string;
  kind: FindingKind;
  /** "Hidden: a wallet key". */
  text: string;
  /** When it was first seen (ms since the epoch). */
  at: number;
  /** Still on screen, or held: it's covered now (unless shown anyway). */
  active: boolean;
  /** "Show anyway" runs until then. */
  showingUntil: number;
  /** The host chose "Keep hidden". */
  kept: boolean;
}

export interface ShieldStats {
  /** Full reads of the screen so far. */
  scans: number;
  /** Reads skipped because the screen hadn't changed. */
  still: number;
  /** The last read, from grabbing the frame to its findings. */
  lastScanMs: number;
  /** How far apart reads start now: a second, or twice the last read on a slow machine. */
  readEveryMs: number;
  /** What a frame costs on the way through, averaged, and the worst. */
  frameMs: number;
  maxFrameMs: number;
  /** Frames painted (masked or slated) and passed through; the kept frame sent again between frames. */
  painted: number;
  passed: number;
  repaints: number;
  /** Main-thread time a read costs: reading the copy back and turning it grey, and the detectors — the last, and the worst. */
  grabMs: number;
  maxGrabMs: number;
  detectMs: number;
}

export interface ShieldStatus {
  phase: ShieldPhase;
  /** The last thing that went wrong, in words; null while all's well. */
  reason: string | null;
  /** The text checks' engine. */
  reading: OcrState;
  /** Whether this browser can read QR codes; null until it's been asked. */
  qr: boolean | null;
  panic: boolean;
  /** The slate that's up right now, if any. */
  slate: SlateReason | null;
  /** Newest first: what's hidden now, and what was a moment ago. */
  notices: ShieldNotice[];
  stats: ShieldStats;
}

const NO_STATS: ShieldStats = {
  scans: 0,
  still: 0,
  lastScanMs: 0,
  readEveryMs: 1000,
  frameMs: 0,
  maxFrameMs: 0,
  painted: 0,
  passed: 0,
  repaints: 0,
  grabMs: 0,
  maxGrabMs: 0,
  detectMs: 0,
};
const IDLE_STATUS: ShieldStatus = { phase: "idle", reason: null, reading: "idle", qr: null, panic: false, slate: null, notices: [], stats: NO_STATS };

/** Hide, as a key: H, with nothing else held, while a screen is shared — anywhere in the app but a text field or a menu. */
export const PANIC_KEY = "h";

let panic = false;
let phase: ShieldPhase = "idle";
let reason: string | null = null;
let qrOk: boolean | null = null;
let status: ShieldStatus = IDLE_STATUS;
const statusListeners = new Set<(s: ShieldStatus) => void>();
const liveTransformers = new Set<ShieldTransformer>();
/** What the last share was covering, for the next one (a re-share, a rejoin) to start from. */
let carried: CarriedFinding[] = [];

function computeStatus(): ShieldStatus {
  const now = Date.now();
  const notices: ShieldNotice[] = [];
  let slate: SlateReason | null = panic ? "panic" : null;
  const stats = { ...NO_STATS };
  for (const t of liveTransformers) {
    notices.push(...t.notices(now));
    if (!slate) slate = t.slateNow(now);
    const s = t.stats;
    stats.scans += s.scans;
    stats.still += s.still;
    stats.lastScanMs = Math.max(stats.lastScanMs, s.lastScanMs);
    stats.readEveryMs = Math.max(stats.readEveryMs, s.readEveryMs);
    stats.frameMs = Math.max(stats.frameMs, s.frameMs);
    stats.maxFrameMs = Math.max(stats.maxFrameMs, s.maxFrameMs);
    stats.painted += s.painted;
    stats.passed += s.passed;
    stats.repaints += s.repaints;
    stats.grabMs = Math.max(stats.grabMs, s.grabMs);
    stats.maxGrabMs = Math.max(stats.maxGrabMs, s.maxGrabMs);
    stats.detectMs = Math.max(stats.detectMs, s.detectMs);
  }
  notices.sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
  return { phase, reason, reading: ocrState(), qr: qrOk, panic, slate, notices: notices.slice(0, 4), stats };
}

function emit() {
  status = computeStatus();
  statusListeners.forEach((l) => l(status));
}

/** The shield as it stands. */
export const getShieldStatus = () => status;

/** Hear about what the shield finds and does; returns the way to stop. */
export function onFindings(listener: (s: ShieldStatus) => void): () => void {
  statusListeners.add(listener);
  return () => void statusListeners.delete(listener);
}

/** The shield's status, for the panel. */
export function useShieldStatus(): ShieldStatus {
  return useSyncExternalStore(
    (cb) => onFindings(cb),
    getShieldStatus,
    () => IDLE_STATUS
  );
}

onOcrState(() => emit());

function setPhase(next: ShieldPhase, why: string | null = null) {
  phase = next;
  reason = why;
  emit();
}

/** Something went wrong, but the share carries on: the host is told once, not every frame. */
function failNow(why: string) {
  if (reason === why) return;
  reason = why;
  emit();
}

/** A passing trouble is over (the text checks came back): stop saying so. */
function clearReason(why: string) {
  if (reason !== why) return;
  reason = null;
  emit();
}

/** Every running shield looks at its plan now, rather than at its next tick. */
function nudgeAll() {
  for (const t of liveTransformers) t.nudge();
}

/* ---- Hide -------------------------------------------------------------- */

/** Hide the shared screen behind the slate — on the next frame out, still screen or not — or show it again. */
export function setPanic(on: boolean) {
  if (panic === on) return;
  panic = on;
  emit();
  nudgeAll();
}

export const isPanic = () => panic;
export const togglePanic = () => setPanic(!panic);

/** Where a letter key belongs to someone else: typing, and a menu's or a list's type-to-find. */
const TYPES_HERE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="listbox"], [role="option"], [role="menu"], [role="menubar"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="tree"], [role="treeitem"], [role="grid"], [role="spinbutton"]';

/** A key event that means Hide: H alone, not already handled, not typing, not in a menu. */
export function isHideKey(e: {
  key?: unknown;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
}): boolean {
  // Chrome's autofill sends keydown events with no key at all.
  if (typeof e.key !== "string" || e.key.toLowerCase() !== PANIC_KEY) return false;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return false;
  const t = e.target as { isContentEditable?: boolean; closest?: (selector: string) => unknown } | null | undefined;
  if (t?.isContentEditable) return false;
  if (t && typeof t.closest === "function" && t.closest(TYPES_HERE)) return false;
  return true;
}

function onHideKey(e: KeyboardEvent) {
  if (!isHideKey(e)) return;
  e.preventDefault();
  togglePanic();
}

/** "Show anyway": the notice's find goes uncovered for 10 s; seen after that, it's covered again. */
export function showAnyway(noticeId: string) {
  for (const t of liveTransformers) {
    if (t.showAnyway(noticeId)) {
      emit();
      return nudgeAll();
    }
  }
}

/** "Keep hidden": the notice is acknowledged; its find stays covered. */
export function keepHidden(noticeId: string) {
  for (const t of liveTransformers) {
    if (t.keep(noticeId)) {
      emit();
      return nudgeAll();
    }
  }
}

/* ---- support -------------------------------------------------------------- */

let supported: boolean | null = null;

/**
 * Chrome and Edge on a computer: the shield paints frames on their way to
 * the encoder with `MediaStreamTrackProcessor`, which Safari and Firefox
 * don't ship (and they can't share a screen from a phone anyway).
 */
export function isShieldSupported(): boolean {
  if (supported !== null) return supported;
  if (typeof window === "undefined") return false;
  let ok =
    typeof MediaStreamTrackProcessor !== "undefined" &&
    typeof MediaStreamTrackGenerator !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof OffscreenCanvas !== "undefined";
  if (ok) {
    try {
      ok = Boolean(new OffscreenCanvas(1, 1).getContext("2d"));
    } catch {
      ok = false;
    }
  }
  supported = ok;
  return ok;
}

export const UNSUPPORTED_REASON = "The privacy shield needs Chrome or Edge on a computer.";

/* ---- what a frame wears ------------------------------------------------------ */

/** What the frames going out wear: the slate, some boxes, or nothing at all. */
export type Plan = { slate: SlateReason } | { slate: null; rects: Rect[] };

/**
 * The plan for this moment. Hide wins; then — with the checks on — a
 * whole-screen find, then the start's "Screen share starting". The zones
 * are covered whether the checks are on or not: they're the host's own
 * choice, and a switch that's about checking shouldn't uncover them.
 */
export function coverPlan(o: { panic: boolean; settings: ShieldSettings; cover: { whole: boolean; rects: Rect[] }; checking: boolean }): Plan | null {
  if (o.panic) return { slate: "panic" };
  const s = o.settings;
  if (s.enabled && o.cover.whole) return { slate: "secret" };
  if (s.enabled && o.checking) return { slate: "checking" };
  const rects = [...s.zones, ...(s.enabled ? o.cover.rects : [])];
  return rects.length ? { slate: null, rects } : null;
}

/** A plan as a string, to tell whether what goes out has to change. */
export function planKey(plan: Plan | null): string {
  if (!plan) return "clear";
  if (plan.slate) return `slate:${plan.slate}`;
  return plan.rects.map((r) => `${r.x.toFixed(4)},${r.y.toFixed(4)},${r.w.toFixed(4)},${r.h.toFixed(4)}`).join("|");
}

/* ---- the transformer ------------------------------------------------------ */

/** Reads start at least this far apart — and twice the last read's time on a slow machine, so a core isn't pinned. */
const SCAN_EVERY_MS = 1000;
/** A still screen is read again after this long anyway, if its picture moved at all — well inside the hold. */
const FORCE_RESCAN_MS = 5000;
/** How often a running shield looks at its plan and its kept frame. */
const TICK_MS = 250;
/** A still screen gets its last frame sent again this often, painted as things stand. */
const RESEND_MS = 400;
/**
 * A share starts behind "Screen share starting" until the first read is
 * done, for at most this long: what was on screen before the share began
 * is the one thing the second of lag can't otherwise cover. Warm, the read
 * lands in about 1.5 s; the very first time, the text checks download
 * (~7 MB) and took 4.5 s in testing — `prewarmShield` saves that wait.
 * 0 turns it off.
 */
export const CHECK_FIRST_MS = 6000;
/** Reads that fail (or hang) this many times in a row stop; zones, QR codes and Hide carry on. */
const MAX_READ_FAILURES = 3;

const INK = "#0b0708";
const MASK = "#1c1617";
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
/** Solar's eye-closed, bold — the icon the panel wears. */
const EYE_CLOSED =
  "M1.60603 6.08062C2.11366 5.86307 2.70154 6.09822 2.9191 6.60585L1.99995 6.99977C2.9191 6.60585 2.91924 6.60618 2.9191 6.60585L2.91858 6.60465C2.9183 6.604 2.91851 6.60447 2.91858 6.60465L2.9225 6.61351C2.92651 6.62253 2.93339 6.63785 2.94319 6.65905C2.96278 6.70147 2.99397 6.76735 3.03696 6.85334C3.12302 7.02546 3.25594 7.27722 3.43737 7.58203C3.80137 8.19355 4.35439 9.00801 5.10775 9.81932C5.28532 10.0105 5.47324 10.2009 5.67173 10.3878C5.68003 10.3954 5.68823 10.4031 5.69633 10.4109C7.18102 11.8012 9.25227 12.9998 12 12.9998C13.2089 12.9998 14.2783 12.769 15.2209 12.398C16.4469 11.9154 17.4745 11.1889 18.3156 10.3995C19.2652 9.50815 19.9627 8.54981 20.4232 7.81076C20.6526 7.44268 20.8207 7.13295 20.9299 6.91886C20.9844 6.81192 21.0241 6.72919 21.0491 6.67538C21.0617 6.64848 21.0706 6.62884 21.0758 6.61704L21.0808 6.60585C21.2985 6.0985 21.8864 5.86312 22.3939 6.08062C22.9015 6.29818 23.1367 6.88606 22.9191 7.39369L22 6.99977C22.9191 7.39369 22.9192 7.39346 22.9191 7.39369L22.9169 7.39871L22.9134 7.40693L22.9019 7.43278C22.8924 7.4541 22.879 7.48354 22.8618 7.52048C22.8274 7.59434 22.7774 7.69831 22.7115 7.8275C22.5799 8.08566 22.384 8.44584 22.1206 8.86844C21.718 9.5146 21.152 10.316 20.4096 11.1241L21.2071 11.9215C21.5976 12.312 21.5976 12.9452 21.2071 13.3357C20.8165 13.7262 20.1834 13.7262 19.7928 13.3357L18.9527 12.4955C18.3884 12.9513 17.757 13.3811 17.0558 13.752L17.8381 14.9544C18.1393 15.4173 18.0083 16.0367 17.5453 16.338C17.0824 16.6392 16.463 16.5081 16.1618 16.0452L15.1763 14.5306C14.4973 14.7388 13.772 14.8863 13 14.9554V16.4998C13 17.0521 12.5522 17.4998 12 17.4998C11.4477 17.4998 11 17.0521 11 16.4998V14.9556C10.2253 14.8864 9.50014 14.7386 8.82334 14.531L7.83814 16.0452C7.53693 16.5081 6.91748 16.6392 6.45457 16.338C5.99165 16.0367 5.86056 15.4173 6.16177 14.9544L6.94417 13.7519C6.24405 13.3814 5.61245 12.9515 5.04746 12.4953L4.20706 13.3357C3.81654 13.7262 3.18337 13.7262 2.79285 13.3357C2.40232 12.9452 2.40232 12.312 2.79285 11.9215L3.59029 11.1241C2.74529 10.2043 2.12772 9.292 1.71879 8.605C1.5096 8.25356 1.35345 7.95845 1.2481 7.74776C1.19539 7.64234 1.15529 7.55783 1.12752 7.49771C1.11363 7.46765 1.10282 7.44366 1.09505 7.42618L1.08566 7.4049L1.08267 7.39801L1.0816 7.39553L1.08117 7.39453C1.08098 7.39409 1.08081 7.39369 1.99995 6.99977L1.08117 7.39453C0.863613 6.8869 1.0984 6.29818 1.60603 6.08062Z";

const SLATE_COPY: Record<SlateReason, [string, string]> = {
  panic: ["Screen hidden", "Back in a moment"],
  secret: ["Screen hidden", "Something private was on screen"],
  checking: ["Screen share starting", "One moment"],
};

const STALLED = "The text checks stalled — starting them again.";
const TEXT_DOWN = "The text checks didn't load, so only zones, QR codes and Hide are working.";
const TEXT_OFF = "The text checks stopped working, so only zones, QR codes and Hide are working.";

type ShieldOptions = { settings: ShieldSettings };

const textChecksOn = (d: Detectors) => d.phrases || d.keys || d.pages || d.balances;
const anyCheckOn = (d: Detectors) => textChecksOn(d) || d.qr;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Run `fn` in a task of its own, soon. Not setTimeout: while the host is
 * in another window, their studio tab is usually hidden, and Chrome holds
 * a hidden tab's timers to once a second — a posted message isn't held.
 */
const later = (() => {
  let port: MessagePort | null = null;
  const queue: (() => void)[] = [];
  return (fn: () => void) => {
    if (typeof MessageChannel === "undefined") return void setTimeout(fn, 0);
    if (!port) {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => queue.shift()?.();
      port = ch.port2;
    }
    queue.push(fn);
    port.postMessage(0);
  };
})();

interface Ticker {
  stop(): void;
}

/**
 * A steady tick that keeps going in a hidden tab: a worker's timer (a
 * page's own are held to once a second there), with the page's timer as
 * the fallback where a worker can't start (a CSP without `worker-src blob:`).
 */
function startTicker(ms: number, onTick: () => void): Ticker {
  let timer: ReturnType<typeof setInterval> | null = setInterval(onTick, ms);
  let worker: Worker | null = null;
  try {
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${ms});`], { type: "text/javascript" }));
    worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      onTick();
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      timer ??= setInterval(onTick, ms);
    };
  } catch {
    // The page's timer carries on.
  }
  return {
    stop() {
      worker?.terminate();
      worker = null;
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

let transformerSeq = 0;

class ShieldTransformer implements VideoTrackTransformer<ShieldOptions> {
  transformer?: TransformStream;
  options: ShieldOptions;
  readonly id = ++transformerSeq;
  readonly tracker = new FindingTracker();
  stats: ShieldStats = { ...NO_STATS };

  private canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private live = false;
  private startedAt = 0;
  /** The first look at the screen is done (a full read, or all that can be read). */
  private looked = false;
  private slateKey = "";
  // Sending: the last frame in, kept to send again (painted as things stand) between frames.
  private controller: TransformStreamDefaultController<VideoFrame> | null = null;
  private kept: VideoFrame | null = null;
  private keptAt = 0;
  /** Frames in so far: a read of the same frame twice learns nothing new. */
  private inputs = 0;
  /** The plan the last frame out wore, when it went, and its timestamp (µs). */
  private sentKey = "";
  private sentAt = 0;
  private sentTs = -Infinity;
  private ticker: Ticker | null = null;
  private beatQueued = false;
  // Reading the screen.
  private busy = false;
  private lastStart = -Infinity;
  private lastReadMs = 0;
  private lastReadAt = 0;
  private lastLookInput = -1;
  private lastSig: Float32Array | null = null;
  private scanCanvas: OffscreenCanvas | null = null;
  private scanCtx: OffscreenCanvasRenderingContext2D | null = null;
  private engine: OcrEngine | null = null;
  private engineHeld = false;
  private engineToken = 0;
  private engineRetryAt = 0;
  private readFailures = 0;
  private readsOff = false;
  /** Notices that have gone off screen, kept a little while so the host sees what happened. */
  private past = new Map<string, ShieldNotice>();

  constructor(options: ShieldOptions) {
    this.options = options;
  }

  async init({ outputCanvas }: VideoTransformerInitOptions) {
    this.transformer = new TransformStream({
      transform: (frame: VideoFrame, controller) => this.transform(frame, controller),
    });
    this.canvas = outputCanvas;
    try {
      this.ctx = outputCanvas.getContext("2d", { alpha: false }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    } catch {
      this.ctx = null;
    }
    this.live = true;
    this.startedAt = Date.now();
    this.looked = false;
    this.slateKey = "";
    this.sentKey = "";
    this.sentAt = 0;
    this.sentTs = -Infinity;
    this.lastLookInput = -1;
    if (liveTransformers.size === 0) window.addEventListener("keydown", onHideKey);
    liveTransformers.add(this);
    // What the last share was covering carries over: its first reads have to go the hold without it.
    this.tracker.seed(carried, Date.now());
    // A new share starts clean; this one's own trouble is said after.
    setPhase("on");
    // No 2D canvas: frames go out as they are rather than the share stopping — and the host is told.
    if (!this.ctx) failNow("The shield couldn't paint on this device, so your screen goes out as it is.");
    this.syncEngine();
    void qrDetector().then((d) => {
      qrOk = Boolean(d);
      emit();
    });
    this.ticker = startTicker(TICK_MS, () => this.beat());
  }

  async restart(opts: VideoTransformerInitOptions) {
    await this.destroy({ willProcessorRestart: true });
    await this.init(opts);
  }

  async destroy(opts?: TrackTransformerDestroyOptions) {
    this.live = false;
    liveTransformers.delete(this);
    if (liveTransformers.size === 0) window.removeEventListener("keydown", onHideKey);
    this.ticker?.stop();
    this.ticker = null;
    // Whatever this share was covering is where the next one starts.
    this.remember();
    this.kept?.close();
    this.kept = null;
    this.controller = null;
    if (!opts?.willProcessorRestart) {
      this.releaseEngine();
      this.tracker.clear();
      this.past.clear();
      this.scanCanvas = null;
      this.scanCtx = null;
    }
    this.transformer = undefined;
    this.canvas = null;
    this.ctx = null;
    if (liveTransformers.size === 0 && !opts?.willProcessorRestart) setPhase("idle");
    else emit();
  }

  /** New settings, in place: a switched-off check forgets what it found at once, and the change goes out now. */
  update(next: Partial<ShieldOptions>) {
    const prev = this.options.settings;
    this.options = { ...this.options, ...next };
    const cur = this.options.settings;
    if (!cur.enabled) this.tracker.clear();
    else {
      const off = (Object.keys(DETECTOR_OF) as FindingKind[]).filter((k) => !cur.detectors[DETECTOR_OF[k]]);
      if (off.length) this.tracker.drop(off);
    }
    // Something new to look for: read the screen again rather than trusting "unchanged".
    if (JSON.stringify(prev.detectors) !== JSON.stringify(cur.detectors) || prev.enabled !== cur.enabled) {
      this.lastSig = null;
      this.lastLookInput = -1;
    }
    this.syncEngine();
    emit();
    this.nudge();
  }

  /* -- the engine -- */

  private syncEngine() {
    const s = this.options.settings;
    const want = this.live && s.enabled && textChecksOn(s.detectors) && !this.readsOff;
    if (want && !this.engineHeld && Date.now() >= this.engineRetryAt) {
      this.engineHeld = true;
      const token = ++this.engineToken;
      acquireOcr().then(
        (e) => {
          if (!this.engineHeld || token !== this.engineToken) return;
          this.engine = e;
          // A text read can now see what a QR-only look couldn't: look again.
          this.lastLookInput = -1;
          this.nudge();
        },
        () => {
          if (!this.engineHeld || token !== this.engineToken) return;
          // Let go, and ask again once the wait's over — the engine tries a new load then.
          this.releaseEngine();
          this.engineRetryAt = Date.now() + RETRY_AFTER_MS;
          // The raw error (a CDN address, a status code) is for developers: `ocrError()` has it.
          if (ocrError()) console.warn("[privacy shield] text checks didn't load:", ocrError());
          failNow(TEXT_DOWN);
          this.nudge();
        }
      );
    } else if (!want && this.engineHeld) {
      this.releaseEngine();
    }
  }

  private releaseEngine() {
    if (!this.engineHeld) return;
    this.engineHeld = false;
    this.engineToken++;
    this.engine = null;
    releaseOcr();
  }

  /* -- the frames -- */

  transform(frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) {
    const t0 = performance.now();
    this.controller = controller;
    let sent = false;
    try {
      if (!this.live || frame.displayWidth === 0 || frame.displayHeight === 0) {
        controller.enqueue(frame);
        sent = true;
        return;
      }
      this.inputs++;
      // Kept to send again between frames, and to read: a still screen sends none.
      this.kept?.close();
      this.kept = frame.clone();
      this.keptAt = t0;
      const now = Date.now();
      this.maybeRead(frame, now);
      this.send(frame, this.plan(now), frame.timestamp, true);
      sent = true;
    } catch (e) {
      failNow(`The shield hit a snag, so a frame went out as it is: ${message(e)}`);
      if (!sent) {
        try {
          controller.enqueue(frame);
        } catch {
          frame.close();
        }
      }
    } finally {
      const ms = performance.now() - t0;
      this.stats.frameMs = this.stats.frameMs ? this.stats.frameMs * 0.95 + ms * 0.05 : ms;
      this.stats.maxFrameMs = Math.max(this.stats.maxFrameMs, ms);
    }
  }

  /**
   * One frame out: `src` painted as `plan` says (or as it is), stamped `ts`
   * — never earlier than the last one out. `consume`: `src` is the frame
   * that came in, and goes (out as it is, or closed once painted); a
   * repaint of the kept frame leaves the kept frame be.
   */
  private send(src: VideoFrame, plan: Plan | null, ts: number, consume: boolean) {
    const controller = this.controller;
    if (!controller) {
      if (consume) src.close();
      return;
    }
    let out = plan ? this.paint(src, plan, ts) : null;
    if (out) {
      this.stats.painted++;
      if (consume) src.close();
    } else {
      // Nothing to cover — or a paint that failed: the frame as it is, never a stopped share.
      this.stats.passed++;
      out = consume ? src : new VideoFrame(src, { timestamp: ts });
    }
    if (out.timestamp <= this.sentTs) {
      const stamped = new VideoFrame(out, { timestamp: this.sentTs + 1 });
      out.close();
      out = stamped;
    }
    this.sentTs = out.timestamp;
    this.sentAt = performance.now();
    this.sentKey = planKey(plan);
    try {
      controller.enqueue(out);
    } catch {
      // The stream's closed — the share ended before LiveKit took the shield off: nothing more goes out.
      out.close();
      this.controller = null;
    }
  }

  /** Look at the plan now (a tap from Hide, a find, a setting) rather than at the next tick. */
  nudge() {
    if (this.beatQueued || !this.live) return;
    this.beatQueued = true;
    later(() => {
      this.beatQueued = false;
      this.beat();
    });
  }

  /**
   * The tick: retry the text checks if they're due, read the kept frame
   * if a read's due, and send the kept frame again if what it should wear
   * has changed — or if nothing's gone out for `RESEND_MS` (a still
   * screen) — stamped now.
   */
  private beat() {
    if (!this.live) return;
    try {
      this.syncEngine();
      const kept = this.kept;
      if (!kept || !this.controller) return;
      const now = Date.now();
      this.maybeRead(kept, now);
      const plan = this.plan(now);
      const idle = performance.now() - this.sentAt >= RESEND_MS;
      if (planKey(plan) === this.sentKey && !idle) return;
      const ts = Math.max(this.sentTs + 1, kept.timestamp + Math.round((performance.now() - this.keptAt) * 1000));
      this.send(kept, plan, ts, false);
      this.stats.repaints++;
    } catch (e) {
      failNow(`The shield hit a snag: ${message(e)}`);
    }
  }

  private plan(now: number): Plan | null {
    return coverPlan({ panic, settings: this.options.settings, cover: this.tracker.cover(now), checking: this.checking(now) });
  }

  private checking(now: number) {
    const s = this.options.settings;
    if (!CHECK_FIRST_MS || this.looked || now - this.startedAt >= CHECK_FIRST_MS) return false;
    return s.enabled && anyCheckOn(s.detectors);
  }

  /** The slate that's up on this share now, if any. */
  slateNow(now: number): SlateReason | null {
    const p = this.live ? this.plan(now) : null;
    return p && p.slate ? p.slate : null;
  }

  private paint(src: VideoFrame, plan: Plan, ts: number): VideoFrame | null {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return null;
    const w = src.displayWidth;
    const h = src.displayHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      this.slateKey = "";
    }
    if (plan.slate) {
      // The slate doesn't change frame to frame: paint it once per size.
      const key = `${plan.slate}|${w}x${h}`;
      if (this.slateKey !== key) {
        drawSlate(ctx, w, h, plan.slate);
        this.slateKey = key;
      }
    } else {
      this.slateKey = "";
      ctx.drawImage(src, 0, 0, w, h);
      for (const r of plan.rects) drawMask(ctx, r, w, h);
    }
    return new VideoFrame(canvas, { timestamp: ts });
  }

  /* -- reading the screen -- */

  /** Reads start a second apart — or twice the last read's time, so a slow machine's core isn't pinned. */
  private readGap() {
    return Math.max(SCAN_EVERY_MS, 2 * this.lastReadMs);
  }

  private maybeRead(src: VideoFrame, now: number) {
    const s = this.options.settings;
    if (!s.enabled || !anyCheckOn(s.detectors) || this.busy || now - this.lastStart < this.readGap()) return;
    // A read of text needs the engine; until it's here, QR codes are still worth a look.
    const reading = Boolean(this.engine) && textChecksOn(s.detectors);
    if (!reading && !s.detectors.qr) return;
    this.lastStart = now;
    // The very frame the last look read: what it saw is still there.
    if (this.looked && this.inputs === this.lastLookInput) {
      this.tracker.touch(now);
      this.stats.still++;
      this.remember();
      return;
    }
    this.busy = true;
    const input = this.inputs;
    let size: { width: number; height: number };
    try {
      size = this.copyDown(src);
    } catch (e) {
      this.busy = false;
      failNow(`The shield couldn't look at a frame: ${message(e)}`);
      return;
    }
    // Reading the pixels back is the one heavy bit on this thread (~5–7 ms at 1600×900): its own
    // task, so the frame this came from — and the ones behind it — go out without waiting on it.
    later(() => {
      // The share may have ended in the meantime.
      if (!this.live || !this.scanCtx) {
        this.busy = false;
        return;
      }
      let grey: Uint8Array;
      try {
        const g0 = performance.now();
        grey = toGrey(this.scanCtx.getImageData(0, 0, size.width, size.height).data, size.width, size.height);
        this.stats.grabMs = Math.round((performance.now() - g0) * 10) / 10;
        this.stats.maxGrabMs = Math.max(this.stats.maxGrabMs, this.stats.grabMs);
      } catch (e) {
        this.busy = false;
        failNow(`The shield couldn't look at a frame: ${message(e)}`);
        return;
      }
      void this.read({ ...size, grey }, reading, input).finally(() => {
        this.busy = false;
      });
    });
  }

  /**
   * The frame, scaled down onto the read canvas — a GPU draw, taken now,
   * while the frame is still ours. The canvas stays GPU-backed: scaling
   * there and reading back the small copy costs about half what a CPU
   * canvas does.
   */
  private copyDown(frame: VideoFrame) {
    const { width, height } = scanSize(frame.displayWidth, frame.displayHeight);
    if (!this.scanCanvas || !this.scanCtx) {
      this.scanCanvas = new OffscreenCanvas(width, height);
      this.scanCtx = this.scanCanvas.getContext("2d", { alpha: false });
      if (!this.scanCtx) throw new Error("no 2D canvas to read from");
    }
    if (this.scanCanvas.width !== width || this.scanCanvas.height !== height) {
      this.scanCanvas.width = width;
      this.scanCanvas.height = height;
    }
    this.scanCtx.drawImage(frame, 0, 0, width, height);
    return { width, height };
  }

  private async read({ width, height, grey }: { width: number; height: number; grey: Uint8Array }, reading: boolean, input: number) {
    const t0 = performance.now();
    const s = this.options.settings;
    const sig = signature(grey, width, height);
    // A still screen: what the last read saw is still there.
    if (reading && this.stats.scans > 0 && !changed(this.lastSig, sig) && Date.now() - this.lastReadAt < FORCE_RESCAN_MS) {
      this.tracker.touch(Date.now());
      this.stats.still++;
      this.lastLookInput = input;
      this.remember();
      emit();
      return;
    }
    const engine = this.engine;
    let words: Awaited<ReturnType<OcrEngine["recognize"]>> | null = null;
    let failure: unknown = null;
    const [, qr] = await Promise.all([
      reading && engine
        ? engine.recognize(toPgm(grey, width, height)).then(
            (w) => void (words = w),
            (e: unknown) => void (failure = e ?? new Error("the read failed"))
          )
        : Promise.resolve(),
      s.detectors.qr && this.scanCanvas ? detectQr(this.scanCanvas) : Promise.resolve([]),
    ]);
    if (!this.live) return;
    if (failure) this.readFailed(failure, engine);
    else if (words) {
      this.readFailures = 0;
      clearReason(STALLED);
    }
    const now = Date.now();
    const d0 = performance.now();
    const found = scanScreen({ width, height, words: words ?? [], qr }, s.detectors);
    this.stats.detectMs = Math.round((performance.now() - d0) * 10) / 10;
    // Each kind of find ages only on the read that can see it: a QR-only look (the text read down)
    // doesn't let a phrase's hold run out.
    this.tracker.update(found, now, { text: Boolean(words), qr: s.detectors.qr });
    if (words) {
      this.lastSig = sig;
      this.lastReadAt = now;
      this.stats.scans++;
      this.lastReadMs = performance.now() - t0;
    }
    this.lastLookInput = input;
    // The first look is done once text was read — or when no text read is coming (checks off, or down).
    if (words || !textChecksOn(s.detectors) || this.readsOff || !this.engineHeld || ocrState() === "failed") this.looked = true;
    this.stats.lastScanMs = Math.round(performance.now() - t0);
    this.stats.readEveryMs = Math.round(this.readGap());
    this.remember();
    emit();
    this.nudge();
  }

  /** A read that failed or hung: start the worker afresh — and after a few in a row, stop trying. */
  private readFailed(failure: unknown, engine: OcrEngine | null) {
    this.readFailures++;
    console.warn("[privacy shield] a read failed:", failure);
    restartOcr(engine);
    this.releaseEngine();
    if (this.readFailures >= MAX_READ_FAILURES) {
      this.readsOff = true;
      failNow(TEXT_OFF);
    } else {
      failNow(STALLED);
    }
  }

  /** What's held now is where the next share (a re-share, a rejoin) starts. */
  private remember() {
    carried = this.tracker.carry();
  }

  /* -- notices -- */

  notices(now: number): ShieldNotice[] {
    const out: ShieldNotice[] = [];
    const held = new Set<string>();
    for (const h of this.tracker.held) {
      const id = `${this.id}:${h.id}`;
      held.add(id);
      const n: ShieldNotice = { id, kind: h.kind, text: NOTICE_TEXT[h.kind], at: h.firstSeen, active: true, showingUntil: h.shownUntil > now ? h.shownUntil : 0, kept: h.kept };
      this.past.set(id, { ...n, active: false, showingUntil: 0 });
      out.push(n);
    }
    // Gone from the screen: shown a couple of minutes more, as a record.
    for (const [id, n] of this.past) {
      if (held.has(id)) continue;
      if (now - n.at > 120_000) this.past.delete(id);
      else out.push(n);
    }
    return out;
  }

  showAnyway(noticeId: string) {
    const heldId = this.heldIdOf(noticeId);
    return heldId !== null && this.tracker.showAnyway(heldId, Date.now());
  }

  keep(noticeId: string) {
    const heldId = this.heldIdOf(noticeId);
    return heldId !== null && this.tracker.keep(heldId);
  }

  private heldIdOf(noticeId: string) {
    const [t, h] = noticeId.split(":");
    return Number(t) === this.id && Number.isFinite(Number(h)) ? Number(h) : null;
  }
}

/* ---- painting -------------------------------------------------------- */

let eyePath: Path2D | null = null;

function drawSlate(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, w: number, h: number, why: SlateReason) {
  const unit = Math.min(w, h);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const r = unit * 0.07;
  const cy = h / 2 - unit * 0.08;
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  try {
    eyePath ??= new Path2D(EYE_CLOSED);
    const s = (r * 1.05) / 24;
    ctx.save();
    ctx.translate(cx - 12 * s, cy - 12 * s + r * 0.12);
    ctx.scale(s, s);
    ctx.fillStyle = "#ffffff";
    ctx.fill(eyePath, "evenodd");
    ctx.restore();
  } catch {
    // No Path2D: the words carry it.
  }
  const [title, line] = SLATE_COPY[why];
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = `650 ${Math.round(unit * 0.052)}px ${FONT}`;
  ctx.fillText(title, cx, cy + r + unit * 0.1);
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.font = `400 ${Math.round(unit * 0.03)}px ${FONT}`;
  ctx.fillText(line, cx, cy + r + unit * 0.16);
}

function drawMask(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, r: Rect, w: number, h: number) {
  const x0 = Math.max(0, Math.floor(r.x * w));
  const y0 = Math.max(0, Math.floor(r.y * h));
  const x1 = Math.min(w, Math.ceil((r.x + r.w) * w));
  const y1 = Math.min(h, Math.ceil((r.y + r.h) * h));
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  ctx.fillStyle = MASK;
  const radius = Math.max(0, Math.min(10, bw / 4, bh / 4));
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x0, y0, bw, bh, radius);
    ctx.fill();
  } else {
    ctx.fillRect(x0, y0, bw, bh);
  }
  // Big enough to say so: viewers see it's hidden on purpose, not a glitch.
  if (bh >= 22 && bw >= 72) {
    const size = Math.round(Math.max(11, Math.min(18, bh * 0.4)));
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.font = `600 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Hidden", x0 + bw / 2, y0 + bh / 2);
  }
}

/* ---- the processor ------------------------------------------------------ */

export const SHIELD_PROCESSOR_NAME = "xtream-privacy-shield";

type Processors = typeof import("@livekit/track-processors");
let processorsPromise: Promise<Processors> | null = null;
function loadProcessors() {
  // A failed import (a flaky network) isn't cached for the session: the next share tries again.
  processorsPromise ??= import("@livekit/track-processors").catch((e: unknown) => {
    processorsPromise = null;
    throw e;
  });
  return processorsPromise;
}

/** The shield on a screen share: a LiveKit `TrackProcessor` that takes new settings in place. */
export interface ShieldProcessor extends TrackProcessor<Track.Kind> {
  readonly settings: ShieldSettings;
  update(settings: ShieldSettings): void;
}

type ShieldProcessorClass = new (transformer: ShieldTransformer) => ShieldProcessor;
let processorClass: ShieldProcessorClass | null = null;

function createShieldProcessor(mod: Processors, settings: ShieldSettings): ShieldProcessor {
  processorClass ??= class ShieldProcessorImpl extends mod.ProcessorWrapper<ShieldOptions, ShieldTransformer> implements ShieldProcessor {
    constructor(transformer: ShieldTransformer) {
      super(transformer, SHIELD_PROCESSOR_NAME);
    }

    get settings() {
      return this.transformer.options.settings;
    }

    update(settings: ShieldSettings) {
      this.transformer.update({ settings });
    }

    async init(opts: Parameters<TrackProcessor<Track.Kind>["init"]>[0]) {
      await super.init(opts);
      // A screen is text: the encoder should keep it sharp, as the raw share asked, not smooth.
      const hint = (opts.track as MediaStreamTrack | undefined)?.contentHint || "detail";
      try {
        if (this.processedTrack) this.processedTrack.contentHint = hint;
      } catch {
        // An old browser without content hints: the default will do.
      }
    }
  };
  return new processorClass(new ShieldTransformer({ settings }));
}

/** The shield on this track, if it's ours. */
export function getShieldProcessor(track: LocalVideoTrack): ShieldProcessor | null {
  const p = track.getProcessor();
  return p && p.name === SHIELD_PROCESSOR_NAME && "update" in p ? (p as ShieldProcessor) : null;
}

export type ShieldResult = { ok: true } | { ok: false; reason: string };

// One change at a time per track: a quick second call waits for the first.
const chains = new WeakMap<LocalVideoTrack, Promise<unknown>>();

/**
 * Put the shield on a screen share, or give a running one new settings in
 * place. Call it on a share's track before it's published (see
 * `shareShieldedScreen`), and whenever the settings change. Never throws
 * and never stops the share: when the shield can't go on, `reason` says
 * why and the screen goes out as it is. It stays on the track with the
 * Shield switch off too — the zones are still covered and Hide works the
 * instant it's pressed.
 */
export function applyShield(track: LocalVideoTrack, settings: ShieldSettings = getShieldSettings()): Promise<ShieldResult> {
  const run = (chains.get(track) ?? Promise.resolve()).catch(() => {}).then(() => applyNow(track, settings));
  chains.set(track, run);
  return run;
}

async function applyNow(track: LocalVideoTrack, settings: ShieldSettings): Promise<ShieldResult> {
  const running = getShieldProcessor(track);
  if (running) {
    running.update(settings);
    return { ok: true };
  }
  if (!isShieldSupported()) {
    setPhase("unsupported", UNSUPPORTED_REASON);
    return { ok: false, reason: UNSUPPORTED_REASON };
  }
  if (track.getProcessor()) {
    const why = "Something else is already processing this picture, so the shield stayed off.";
    setPhase("failed", why);
    return { ok: false, reason: why };
  }
  let proc: ShieldProcessor | null = null;
  try {
    if (phase !== "on") setPhase("starting");
    const mod = await loadProcessors();
    proc = createShieldProcessor(mod, settings);
    await track.setProcessor(proc);
    return { ok: true };
  } catch (e) {
    const why = `The shield couldn't start, so your screen goes out as it is: ${message(e)}`;
    if (proc && getShieldProcessor(track) === proc) await track.stopProcessor().catch(() => {});
    setPhase(liveTransformers.size ? "on" : "failed", why);
    return { ok: false, reason: why };
  }
}

/** Take the shield off a track, if it's on. */
export async function stopShield(track: LocalVideoTrack) {
  if (getShieldProcessor(track)) await track.stopProcessor().catch(() => {});
}

/** Load the shield's code and the text checks ahead of a share, so the first check is a quick one. */
export function prewarmShield() {
  if (!isShieldSupported()) return;
  void loadProcessors().catch(() => {});
  const s = getShieldSettings();
  if (s.enabled && textChecksOn(s.detectors)) prewarmOcr();
}

/* ---- sharing a screen with the shield on it ------------------------------ */

// LiveKit's own names, as strings: this module only imports its types.
const SCREEN_SHARE = "screen_share" as Track.Source;
const VIDEO = "video" as Track.Kind;

/** The part of a LiveKit room a share needs — a Room, or a stand-in in a test. */
export interface ShareRoom {
  localParticipant: {
    getTrackPublication(source: Track.Source): LocalTrackPublication | undefined;
    createScreenTracks(options?: object): Promise<LocalTrack[]>;
    publishTrack(track: LocalTrack): Promise<LocalTrackPublication>;
    unpublishTrack(track: LocalTrack): Promise<unknown>;
  };
}

// One share at a time per room: a second tap, the dock and Vivid at once — they all wait for the first.
const sharing = new WeakMap<object, Promise<LocalTrackPublication | undefined>>();

/**
 * Share the screen with the privacy shield on it from the first frame:
 * the track is made, shielded, and only then published — publishing first
 * would send a moment of the raw screen. LiveKit's `setScreenShareEnabled`
 * guards, kept: a screen that's already shared is returned (unmuted), not
 * shared twice, and a second call while the picker's open waits for the
 * first rather than opening another. A share stopped from the browser's
 * own bar while the shield went on isn't published at all.
 */
export function shareShieldedScreen(room: Room | ShareRoom): Promise<LocalTrackPublication | undefined> {
  const pending = sharing.get(room);
  if (pending) return pending;
  const run = shareNow(room as ShareRoom).finally(() => {
    if (sharing.get(room) === run) sharing.delete(room);
  });
  sharing.set(room, run);
  return run;
}

async function shareNow(room: ShareRoom): Promise<LocalTrackPublication | undefined> {
  const lp = room.localParticipant;
  const existing = lp.getTrackPublication(SCREEN_SHARE);
  if (existing?.track) {
    await existing.unmute();
    return existing;
  }
  const tracks = await lp.createScreenTracks({});
  const screen = tracks.find((t) => t.kind === VIDEO) as LocalVideoTrack | undefined;
  // The capture itself, from before the shield: its end is the share's end.
  const raw = screen?.mediaStreamTrack;
  const ended = () => raw?.readyState === "ended";
  try {
    if (screen) await applyShield(screen, getShieldSettings());
    // Stopped from the browser's bar while the shield went on: LiveKit only hears a track end
    // once it's published, so publishing it now would leave a dead share nobody takes down.
    if (ended()) throw new Error("The screen share was stopped before it started.");
    const pubs = await Promise.all(tracks.map((t) => lp.publishTrack(t)));
    const pub = pubs.find((p) => p.source === SCREEN_SHARE) ?? pubs[0];
    // Stopped during the publish itself: take it straight down again.
    if (ended()) {
      await Promise.all(tracks.map((t) => lp.unpublishTrack(t).catch(() => {})));
      throw new Error("The screen share was stopped before it started.");
    }
    return pub;
  } catch (err) {
    tracks.forEach((t) => t.stop());
    throw err;
  }
}
