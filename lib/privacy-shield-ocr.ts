/**
 * The privacy shield's reading (Phase 4): Tesseract, in its own worker
 * thread, and the browser's BarcodeDetector — the parts of the shield that
 * need a browser. A frame reaches them downscaled (at most 1600 px wide),
 * grey, and as a PGM: raw bytes with a header, so there's nothing to
 * encode on this side and nothing to decode on the worker's. The OCR runs
 * in the worker; copying the frame down and turning it grey (~5–7 ms a
 * read at 1600×900) happen on the page's main thread, in a task of their
 * own (lib/privacy-shield.ts).
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
 * Where Tesseract's files come from — the one line to change to self-host
 * them. null: tesseract.js's defaults, its worker script, the wasm core and
 * the English model (~7 MB the first time, cached by the browser and in
 * IndexedDB after) from cdn.jsdelivr.net. A strict CSP or an offline host
 * then means no text checks — zones, QR codes and Hide still work, and the
 * panel says so. To self-host, copy under public/tesseract/:
 *   - node_modules/tesseract.js/dist/worker.min.js → worker.min.js
 *   - node_modules/tesseract.js-core/tesseract-core*.{js,wasm} → core/
 *   - eng.traineddata.gz (@tesseract.js-data/eng, 4.0.0_best_int) → lang/
 * and set this to "/tesseract".
 */
export const TESSERACT_HOME: string | null = null;

/** What tesseract.js is told about where its files are. */
export const OCR_ASSETS: { workerPath?: string; corePath?: string; langPath?: string } = TESSERACT_HOME
  ? { workerPath: `${TESSERACT_HOME}/worker.min.js`, corePath: `${TESSERACT_HOME}/core`, langPath: `${TESSERACT_HOME}/lang` }
  : {};

/** How OCR reads a screen: as scattered text, which is what an app's window is — not one column of prose. */
const PAGE_SEG_MODE = "11";
/** The worker, the core and the model have this long to arrive. */
export const LOAD_TIMEOUT_MS = 45_000;
/** A failed load is tried again after this long, not on every frame. */
export const RETRY_AFTER_MS = 60_000;
/** Nothing shielded for this long: the worker goes, and its memory with it. */
export const IDLE_MS = 30_000;
/**
 * A read that takes longer than this has hung — tesseract.js never settles
 * a read whose worker died — and the worker is started afresh.
 */
export const READ_TIMEOUT_MS = 10_000;

export type OcrState = "idle" | "loading" | "ready" | "failed";

export interface OcrEngine {
  /** Words and their boxes, in reading order, off a PGM. Rejects after `READ_TIMEOUT_MS` rather than hang. */
  recognize(pgm: Uint8Array): Promise<OcrWord[]>;
}

type TesseractWorker = import("tesseract.js").Worker;
type Tesseract = typeof import("tesseract.js");
type Block = { paragraphs?: { lines?: { words?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] };

/**
 * One load of the worker. A load that's given up on — timed out, failed,
 * let go while idle, replaced after a hung read — is `dropped`, and a
 * worker that turns up for it after that is ended on arrival, so no
 * worker is ever left running with nothing holding it.
 */
interface Load {
  gen: number;
  promise: Promise<OcrEngine>;
  worker: TesseractWorker | null;
  dropped: boolean;
}

let generation = 0;
let current: Load | null = null;
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

/** Give up on a load: it stops counting, and its worker — now or whenever it arrives — is ended. */
function drop(load: Load) {
  load.dropped = true;
  if (current === load) current = null;
  const w = load.worker;
  load.worker = null;
  if (w) void w.terminate().catch(() => {});
}

async function openWorker(load: Load): Promise<TesseractWorker> {
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
  // However this load ends, a worker that arrives after it was given up on is ended.
  created.then(
    (w) => {
      if (load.dropped) void w.terminate().catch(() => {});
    },
    () => {}
  );
  const w = await withTimeout(Promise.race([created, failed]), LOAD_TIMEOUT_MS, "The text checks didn't load in time.");
  if (load.dropped) throw new Error("given up on");
  await w.setParameters({ tessedit_pageseg_mode: PAGE_SEG_MODE as Tesseract["PSM"][keyof Tesseract["PSM"]], user_defined_dpi: "96" });
  return w;
}

function start(): Load {
  const load: Load = { gen: ++generation, promise: Promise.resolve(null as unknown as OcrEngine), worker: null, dropped: false };
  current = load;
  setState("loading");
  load.promise = openWorker(load).then(
    (w) => {
      if (load.dropped) {
        void w.terminate().catch(() => {});
        throw new Error("given up on");
      }
      load.worker = w;
      setState("ready");
      return engineFor(load, w);
    },
    (e: unknown) => {
      lastError = e instanceof Error ? e.message : String(e);
      if (current === load) {
        // Given up on: its worker, should it still come, is ended on arrival — and the next ask
        // after RETRY_AFTER_MS starts a new load rather than getting this failure back.
        drop(load);
        failedAt = Date.now();
        setState("failed");
      }
      throw e;
    }
  );
  load.promise.catch(() => {});
  return load;
}

function engineFor(load: Load, w: TesseractWorker): OcrEngine {
  return {
    async recognize(pgm) {
      if (load.dropped) throw new Error("the text checks were restarted");
      // The typings stop at encoded images; raw PGM bytes are what the worker reads best.
      const r = await withTimeout(w.recognize(pgm as unknown as Buffer, {}, { text: false, blocks: true }), READ_TIMEOUT_MS, "A read hung.");
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
 * it can't load — and after a failure, asking again more than a minute
 * later tries again.
 */
export function acquireOcr(): Promise<OcrEngine> {
  users++;
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!current && state === "failed" && Date.now() - failedAt < RETRY_AFTER_MS) return Promise.reject(new Error(lastError ?? "The text checks didn't load."));
  return (current ?? start()).promise;
}

export function releaseOcr() {
  users = Math.max(0, users - 1);
  if (users > 0 || idleTimer) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (users > 0) return;
    // Loaded or still loading, it goes: a load that's still coming is ended when it arrives.
    if (current) drop(current);
    if (state !== "failed") setState("idle");
  }, IDLE_MS);
}

/**
 * A read hung, or the worker's gone: end this worker and start afresh on
 * the next ask. Only the engine that's current — an older one's already gone.
 */
export function restartOcr(engine: OcrEngine | null) {
  const load = current;
  if (!load || !engine) return;
  void load.promise.then((e) => {
    if (e === engine && current === load) {
      drop(load);
      setState("idle");
    }
  }, () => {});
}

/** Start loading Tesseract before the share, so the first check isn't the slow one. */
export function prewarmOcr() {
  if (typeof window === "undefined") return;
  acquireOcr().catch(() => {});
  releaseOcr();
}

/** For the tests: forget every load and start clean. */
export function resetOcrForTests() {
  if (current) drop(current);
  current = null;
  generation = 0;
  users = 0;
  failedAt = 0;
  lastError = null;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  state = "idle";
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
