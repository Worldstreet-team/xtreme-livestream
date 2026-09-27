import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The privacy shield's Tesseract worker, its whole life (lib/privacy-shield-ocr.ts):
 * tesseract.js is a stand-in here whose worker arrives when the test says,
 * so each way a load can go wrong — let go while it loads, too slow, a
 * download that fails, a read that hangs — is played out, and no worker is
 * ever left running with nothing holding it.
 */

interface FakeWorker {
  setParameters: ReturnType<typeof vi.fn>;
  recognize: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => ({
  loads: [] as { resolve: (w: unknown) => void; reject: (e: unknown) => void; errorHandler?: (e: unknown) => void }[],
}));

vi.mock("tesseract.js", () => ({
  createWorker: vi.fn(
    (_langs: string, _oem: number, opts: { errorHandler?: (e: unknown) => void }) =>
      new Promise((resolve, reject) => h.loads.push({ resolve, reject, errorHandler: opts.errorHandler }))
  ),
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: "11" },
}));

import {
  IDLE_MS,
  LOAD_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  RETRY_AFTER_MS,
  acquireOcr,
  ocrState,
  releaseOcr,
  resetOcrForTests,
  restartOcr,
} from "../../../lib/privacy-shield-ocr";

const worker = (read: () => Promise<unknown> = async () => ({ data: { blocks: [] } })): FakeWorker => ({
  setParameters: vi.fn(async () => ({})),
  recognize: vi.fn(read),
  terminate: vi.fn(async () => ({})),
});

/** Let the loader's awaits run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  h.loads.length = 0;
  resetOcrForTests();
});

afterEach(() => {
  resetOcrForTests();
  vi.useRealTimers();
});

describe("the OCR worker", () => {
  it("loads once for everyone, and goes 30 s after the last one lets go", async () => {
    const a = acquireOcr();
    const b = acquireOcr();
    await settle();
    expect(h.loads).toHaveLength(1);
    const w = worker();
    h.loads[0].resolve(w);
    expect(await a).toBe(await b);
    expect(ocrState()).toBe("ready");
    releaseOcr();
    releaseOcr();
    await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
    expect(w.terminate).toHaveBeenCalledTimes(1);
    expect(ocrState()).toBe("idle");
  });

  it("ends a worker that arrives after its load was let go — and the next ask gets a new one", async () => {
    const first = acquireOcr();
    first.catch(() => {});
    await settle();
    releaseOcr();
    // Idle for the full 30 s while the model was still coming.
    await vi.advanceTimersByTimeAsync(IDLE_MS + 1);
    const late = worker();
    h.loads[0].resolve(late);
    await settle();
    expect(late.terminate).toHaveBeenCalledTimes(1);
    const next = acquireOcr();
    await settle();
    expect(h.loads).toHaveLength(2);
    const w2 = worker();
    h.loads[1].resolve(w2);
    await expect(next).resolves.toBeTruthy();
    expect(w2.terminate).not.toHaveBeenCalled();
  });

  it("gives up on a load that takes too long, and ends its worker when it finally comes", async () => {
    const slow = acquireOcr();
    slow.catch(() => {});
    await settle();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS + 1);
    await expect(slow).rejects.toThrow(/in time/);
    expect(ocrState()).toBe("failed");
    const late = worker();
    h.loads[0].resolve(late);
    await settle();
    expect(late.terminate).toHaveBeenCalledTimes(1);
  });

  it("after a failed download, answers at once for a minute — then tries a new load", async () => {
    const first = acquireOcr();
    first.catch(() => {});
    await settle();
    h.loads[0].errorHandler?.("Network error while fetching eng.traineddata.gz");
    await expect(first).rejects.toThrow(/Network error/);
    releaseOcr();
    // Within the minute: no new load.
    const soon = acquireOcr();
    await expect(soon).rejects.toThrow();
    releaseOcr();
    expect(h.loads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_MS + 1);
    const again = acquireOcr();
    await settle();
    expect(h.loads).toHaveLength(2);
    h.loads[1].resolve(worker());
    await expect(again).resolves.toBeTruthy();
    expect(ocrState()).toBe("ready");
  });

  it("times out a read that hangs — tesseract.js never settles one whose worker died — and starts afresh on restart", async () => {
    const hung = worker(() => new Promise(() => {}));
    const engine = acquireOcr();
    await settle();
    h.loads[0].resolve(hung);
    const e = await engine;
    const read = e.recognize(new Uint8Array([80, 53, 10]));
    read.catch(() => {});
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    await expect(read).rejects.toThrow(/hung/);
    restartOcr(e);
    await settle();
    expect(hung.terminate).toHaveBeenCalledTimes(1);
    // The next ask loads a fresh worker.
    const fresh = acquireOcr();
    await settle();
    expect(h.loads).toHaveLength(2);
    h.loads[1].resolve(worker());
    await expect(fresh).resolves.not.toBe(e);
  });
});
