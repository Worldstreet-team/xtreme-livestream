import { describe, expect, it } from "vitest";
import { LAB_STAGES, frameRates, resultsText, soakSummary, verdict, type StageResult } from "../../../lib/effects-lab";

/**
 * The effects test's arithmetic (/labs/effects): frame rates from the
 * preview's frame stamps, what a stage's numbers mean, and the text a
 * tester pastes back to us.
 */

const every = (ms: number, count: number, from = 0) => Array.from({ length: count }, (_, i) => from + i * ms);
const result = (over: Partial<StageResult>): StageResult => ({ id: "look", fps: 30, lowFps: 29, passMs: 2, faceMs: 0, faceHz: 0, ...over });

describe("frame rates", () => {
  it("counts a steady 30 as 30", () => {
    const { fps, lowFps } = frameRates(every(1000 / 30, 301));
    expect(fps).toBeCloseTo(30, 0);
    expect(lowFps).toBeGreaterThanOrEqual(29);
  });

  it("shows a stall in the worst window even when the average looks fine", () => {
    // Ten seconds at 30, with one second where only 5 frames came.
    const times = [...every(1000 / 30, 150), ...every(200, 5, 5000), ...every(1000 / 30, 120, 6000)];
    const { fps, lowFps } = frameRates(times);
    expect(fps).toBeGreaterThan(20);
    expect(lowFps).toBeLessThanOrEqual(6);
  });

  it("gives nothing for nothing", () => {
    expect(frameRates([])).toEqual({ fps: 0, lowFps: 0 });
    expect(frameRates([100])).toEqual({ fps: 0, lowFps: 0 });
  });
});

describe("the verdict", () => {
  it("calls it smooth when it keeps up with the camera", () => {
    expect(verdict(result({ fps: 29, lowFps: 26 }), 30)).toBe("smooth");
  });

  it("judges against a camera a dim room holds at 15", () => {
    expect(verdict(result({ fps: 14, lowFps: 13 }), 15)).toBe("smooth");
  });

  it("calls 15 to 24 usable, under 15 too slow, and an error a failure", () => {
    expect(verdict(result({ fps: 18, lowFps: 12 }), 30)).toBe("usable");
    expect(verdict(result({ fps: 9, lowFps: 6 }), 30)).toBe("slow");
    expect(verdict(result({ fps: 0, error: "needs Chrome or Edge" }), 30)).toBe("failed");
  });

  it("won't call a stuttering run smooth", () => {
    expect(verdict(result({ fps: 27, lowFps: 10 }), 30)).toBe("usable");
  });
});

describe("the shared text", () => {
  it("names the device, then one line a stage, then the battery", () => {
    const text = resultsText(
      { browser: "TECNO KI5q · Android 13", cores: 8, memoryGb: 4, gpu: "Mali-G57", screen: "720×1612 at 2x" },
      [result({ id: "camera", fps: 30, lowFps: 30, passMs: 0 }), result({ id: "smooth", fps: 22, lowFps: 18, passMs: 6.5, faceMs: 24, faceHz: 9 }), result({ id: "blur", fps: 0, error: "needs Chrome or Edge" })],
      { start: { level: 0.8, charging: false }, end: { level: 0.77, charging: false } },
    );
    expect(text).toContain("TECNO KI5q");
    expect(text).toContain("Camera alone: Smooth, 30 fps");
    expect(text).toContain("Skin smoothing: Usable, 22 fps (low 18), pass 6.5 ms, face 24 ms at 9/s");
    expect(text).toContain("Background blur: Didn't run (needs Chrome or Edge)");
    expect(text).toContain("Battery: 80% to 77% (−3)");
  });

  it("covers every stage the test runs, in order", () => {
    expect(LAB_STAGES.map((s) => s.id)).toEqual(["camera", "look", "blur", "face", "smooth", "all"]);
  });
});

describe("the soak", () => {
  it("compares the start with the end and keeps the low point", () => {
    const s = soakSummary([30, 30, 29, 28, 26, 24, 22, 21, 21], 10);
    expect(s.firstFps).toBeCloseTo(29.7, 1);
    expect(s.lastFps).toBeCloseTo(21.3, 1);
    expect(s.minFps).toBe(21);
  });
});
