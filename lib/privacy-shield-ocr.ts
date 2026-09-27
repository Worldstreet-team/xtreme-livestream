/**
 * The privacy shield's reading (Phase 4): Tesseract, in its own worker
 * thread, and the browser's BarcodeDetector — the parts of the shield that
 * need a browser. A frame reaches them downscaled (at most 1600 px wide),
 * grey, and as a PGM: raw bytes with a header, so there's nothing to
 * encode on this side and nothing to decode on the worker's.
 *
 * The frame helpers are pure and run in Node for the tests; Tesseract is a
 * dynamic import, so the studio's bundle only carries it once a screen is
 * shared with the shield on.
 */

import type { OcrWord, QrHit } from "./privacy-shield-detect";

/* ---- frames ------------------------------------------------------------ */

/** OCR reads a copy at most this wide: sharp enough for a 14 px wallet font on a 1080p share. */
export const MAX_SCAN_WIDTH = 1600;

/** The size a frame is read at: the frame itself, or scaled down to `max` wide. */
export function scanSize(width: number, height: number, max = MAX_SCAN_WIDTH): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  if (width <= max) return { width: Math.round(width), height: Math.round(height) };
  return { width: max, height: Math.max(1, Math.round((height * max) / width)) };
}

/** RGBA to one grey byte a pixel (Rec. 601 luma, integer maths). */
export function toGrey(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const n = width * height;
  const out = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  return out;
}

/** Grey bytes as a binary PGM (P5): Tesseract's Leptonica reads it as it is. */
export function toPgm(grey: Uint8Array, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`);
  const out = new Uint8Array(header.length + width * height);
  out.set(header, 0);
  out.set(grey.subarray(0, width * height), header.length);
  return out;
}

/**
 * A frame in miniature — the mean grey of each cell of a grid — to tell a
 * still screen from a changed one without reading it again.
 */
export function signature(grey: Uint8Array, width: number, height: number, cols = 48, rows = 27): Float32Array {
  const sums = new Float64Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  // Every other pixel each way is plenty for a mean.
  for (let y = 0; y < height; y += 2) {
    const cy = Math.min(rows - 1, Math.floor((y * rows) / height));
    const row = y * width;
    for (let x = 0; x < width; x += 2) {
      const c = cy * cols + Math.min(cols - 1, Math.floor((x * cols) / width));
      sums[c] += grey[row + x];
      counts[c]++;
    }
  }
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? sums[i] / counts[i] : 0;
  return out;
}

/**
 * Has the screen changed? Any cell moving by more than `threshold` grey
 * levels — a line of text appearing moves its cells by ten or more; a
 * blinking caret by a few, which counts too.
 */
export function changed(before: Float32Array | null, after: Float32Array, threshold = 1.5): boolean {
  if (!before || before.length !== after.length) return true;
  for (let i = 0; i < after.length; i++) if (Math.abs(after[i] - before[i]) > threshold) return true;
  return false;
}

/* ---- Tesseract ----------------------------------------------------------- */

/**
 * Where Tesseract's files come from. Empty means tesseract.js's defaults:
 * its worker script, the wasm core and the English model (~3 MB, cached in
 * IndexedDB after the first load) from cdn.jsdelivr.net. A strict CSP or an
 * offline host means no text checks — zones, QR codes and Hide still work,
 * and the panel says so. To self-host, copy node_modules/tesseract.js/dist/
 * worker.min.js, node_modules/tesseract.js-core and eng.traineddata.gz
 * (from @tesseract.js-data/eng) under /public and point these at them.
 */
export const OCR_ASSETS: { workerPath?: string; corePath?: string; langPath?: string } = {};

/** How OCR reads a screen: as scattered text, which is what an app's window is — not one column of prose. */
const PAGE_SEG_MODE = "11";
/** The worker, the core and the model have this long to arrive. */
const LOAD_TIMEOUT_MS = 45_000;
/** A failed load is tried again after this long, not on every frame. */
const RETRY_AFTER_MS = 60_000;
/** Nothing shielded for this long: the worker goes, and its memory with it. */
const IDLE_MS = 30_000;

export type OcrState = "idle" | "loading" | "ready" | "failed";

export interface OcrEngine {
  /** Words and their boxes, in reading order, off a PGM. */
  recognize(pgm: Uint8Array): Promise<OcrWord[]>;
}

type TesseractWorker = import("tesseract.js").Worker;
type Block = { paragraphs?: { lines?: { words?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] };

let enginePromise: Promise<OcrEngine> | null = null;
let worker: TesseractWorker | null = null;
let state: OcrState = "idle";
let failedAt = 0;
let lastError: string | null = null;
let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const stateListeners = new Set<(s: OcrState) => void>();

function setState(next: OcrState) {
  if (state === next) return;
  state = next;
  stateListeners.forEach((l) => l(next));
}

export const ocrState = () => state;
export const ocrError = () => lastError;
export function onOcrState(listener: (s: OcrState) => void) {
  stateListeners.add(listener);
  return () => void stateListeners.delete(listener);
}

function withTimeout<T>(p: Promise<T>, ms: number, why: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(why)), ms);
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

type Tesseract = typeof import("tesseract.js");

async function load(): Promise<OcrEngine> {
  setState("loading");
  // A CommonJS package: bundlers hand it over as the namespace or under `default`.
  const mod = (await import("tesseract.js")) as Tesseract & { default?: Tesseract };
  const T: Tesseract = "createWorker" in mod && typeof mod.createWorker === "function" ? mod : (mod.default as Tesseract);
  // Without an error handler tesseract.js throws inside the worker's message handler — an uncaught
  // error on the page — and a model that won't download never settles createWorker at all.
  const failure: { reject: (why: string) => void } = { reject: () => {} };
  const failed = new Promise<never>((_, reject) => (failure.reject = (why) => reject(new Error(why))));
  failed.catch(() => {});
  const created = T.createWorker("eng", T.OEM.LSTM_ONLY, {
    ...OCR_ASSETS,
    logger: () => {},
    errorHandler: (e: unknown) => {
      lastError = String(e);
      failure.reject(lastError);
    },
  });
  const w = await withTimeout(Promise.race([created, failed]), LOAD_TIMEOUT_MS, "Text checks didn't load in time.");
  await w.setParameters({ tessedit_pageseg_mode: PAGE_SEG_MODE as Tesseract["PSM"][keyof Tesseract["PSM"]], user_defined_dpi: "96" });
  worker = w;
  setState("ready");
  return {
    async recognize(pgm) {
      // The typings stop at encoded images; raw PGM bytes are what the worker reads best.
      const r = await w.recognize(pgm as unknown as Buffer, {}, { text: false, blocks: true });
      const words: OcrWord[] = [];
      for (const block of (r.data.blocks ?? []) as Block[]) {
        for (const par of block.paragraphs ?? []) {
          for (const line of par.lines ?? []) {
            for (const word of line.words ?? []) {
              if (!word.text?.trim()) continue;
              words.push({ text: word.text, x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1, confidence: word.confidence });
            }
          }
        }
      }
      return words;
    },
  };
}

/**
 * The shared OCR engine: one worker for every shielded track, loaded on
 * the first ask and let go 30 s after the last `releaseOcr`. Rejects when
 * it can't load (then again, at most once a minute).
 */
export function acquireOcr(): Promise<OcrEngine> {
  users++;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (state === "failed" && Date.now() - failedAt > RETRY_AFTER_MS) enginePromise = null;
  if (!enginePromise) {
    enginePromise = load().catch((e) => {
      lastError = e instanceof Error ? e.message : String(e);
      failedAt = Date.now();
      setState("failed");
      throw e;
    });
  }
  return enginePromise;
}

export function releaseOcr() {
  users = Math.max(0, users - 1);
  if (users > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (users > 0) return;
    const w = worker;
    worker = null;
    enginePromise = null;
    if (state !== "failed") setState("idle");
    void w?.terminate().catch(() => {});
  }, IDLE_MS);
}

/** Start loading Tesseract before the share, so the first check isn't the slow one. */
export function prewarmOcr() {
  if (typeof window === "undefined") return;
  acquireOcr().catch(() => {});
  releaseOcr();
}

/* ---- QR codes ------------------------------------------------------------ */

interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string; boundingBox: DOMRectReadOnly }[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
}

let detectorPromise: Promise<BarcodeDetectorLike | null> | null = null;

/** The browser's QR reader, where it has one (Chrome on a Mac, ChromeOS and Android); null elsewhere. */
export function qrDetector(): Promise<BarcodeDetectorLike | null> {
  detectorPromise ??= (async () => {
    const BD = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
    if (!BD) return null;
    try {
      const formats = await BD.getSupportedFormats();
      return formats.includes("qr_code") ? new BD({ formats: ["qr_code"] }) : null;
    } catch {
      return null;
    }
  })();
  return detectorPromise;
}

/** QR codes in an image, in its pixels; none where the browser can't look. */
export async function detectQr(source: ImageBitmapSource): Promise<QrHit[]> {
  const detector = await qrDetector();
  if (!detector) return [];
  try {
    const found = await detector.detect(source);
    return found.map((b) => ({
      rawValue: b.rawValue,
      x0: b.boundingBox.x,
      y0: b.boundingBox.y,
      x1: b.boundingBox.x + b.boundingBox.width,
      y1: b.boundingBox.y + b.boundingBox.height,
    }));
  } catch {
    return [];
  }
}
