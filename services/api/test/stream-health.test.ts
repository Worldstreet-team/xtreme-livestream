import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; this pure helper is exercised
// from here (the repo's only vitest) via a relative import. It turns the
// studio's sender stats into a verdict a creator can act on.
import { assess, levelOf, report, summarize, toSample, type HealthSample, type RawSenderStats } from "../../lib/stream-health";

const raw = (over: Partial<RawSenderStats> = {}): RawSenderStats => ({
  at: 0,
  bytesSent: 0,
  fps: 30,
  width: 1280,
  height: 720,
  roundTripTime: 0.06,
  packetsSent: 0,
  packetsLost: 0,
  limitation: "none",
  ...over,
});

const sample = (over: Partial<HealthSample> = {}): HealthSample => ({
  at: 0,
  kbps: 2_400,
  fps: 30,
  height: 720,
  rttMs: 60,
  lossPct: 0,
  limitation: "none",
  ...over,
});

describe("readings into rates", () => {
  it("works out bitrate and loss between two readings", () => {
    const a = raw({ at: 0, bytesSent: 0, packetsSent: 1_000, packetsLost: 0 });
    const b = raw({ at: 2_000, bytesSent: 600_000, packetsSent: 1_950, packetsLost: 50 });
    expect(toSample(a, b)).toEqual({ at: 2_000, kbps: 2_400, fps: 30, height: 720, rttMs: 60, lossPct: 5, limitation: "none" });
  });

  it("needs two readings, moving forward", () => {
    expect(toSample(null, raw())).toBeNull();
    expect(toSample(raw({ at: 5 }), raw({ at: 5 }))).toBeNull();
  });
});

describe("the verdict", () => {
  it("says good in plain numbers when all's well", () => {
    const v = assess([sample(), sample(), sample()]);
    expect(v).toMatchObject({ level: "good", label: "Good", fix: null });
    expect(v.headline).toContain("720p at 30 fps, 2.4 Mbps");
  });

  it("ignores one hiccup, and names the upload when it's the limit", () => {
    expect(assess([sample(), sample({ kbps: 100 }), sample()]).level).toBe("good");
    const v = assess([sample({ limitation: "bandwidth", kbps: 400 }), sample({ limitation: "bandwidth", kbps: 380 }), sample({ limitation: "bandwidth", kbps: 350 })]);
    expect(v).toMatchObject({ level: "fair", label: "Upload limited" });
    expect(v.fix).toContain("540p");
  });

  it("names the device when the CPU is the limit", () => {
    const v = assess([sample({ limitation: "cpu", fps: 18 }), sample({ limitation: "cpu", fps: 17 }), sample({ limitation: "cpu", fps: 16 })]);
    expect(v).toMatchObject({ level: "fair", label: "Device busy" });
  });

  it("calls heavy loss poor, and silence 'not sending'", () => {
    expect(assess([sample({ lossPct: 12 }), sample({ lossPct: 10 }), sample({ lossPct: 9 })])).toMatchObject({ level: "poor", label: "Upload limited" });
    expect(assess([sample({ kbps: 0 }), sample({ kbps: 5 }), sample({ kbps: 0 })])).toMatchObject({ level: "poor", label: "Not sending" });
  });

  it("grades a single sample", () => {
    expect(levelOf(sample())).toBe("good");
    expect(levelOf(sample({ rttMs: 350 }))).toBe("fair");
    expect(levelOf(sample({ fps: 8 }))).toBe("poor");
  });
});

describe("after the broadcast", () => {
  it("summarises 30 s as the average and the worst it got", () => {
    const w = summarize([sample({ at: 1, kbps: 2_000, lossPct: 1 }), sample({ at: 2, kbps: 1_000, lossPct: 6, height: 540 })]);
    expect(w).toMatchObject({ at: 2, kbps: 1_500, lossPct: 6, height: 540, level: "fair" });
  });

  it("finds the rough patches and the one thing worth changing", () => {
    const start = 0;
    const good = { at: 0, kbps: 2_400, fps: 30, height: 720, rttMs: 60, lossPct: 0, limitation: "none" as const, level: "good" as const };
    const windows = [
      { ...good, at: 30_000 },
      { ...good, at: 60_000 },
      { ...good, at: 600_000, kbps: 200, lossPct: 9, limitation: "bandwidth" as const, level: "poor" as const },
      { ...good, at: 630_000 },
    ];
    const r = report(windows, start)!;
    expect(r).toMatchObject({ minutes: 2, roughPatches: 1, worst: { minuteIn: 10, kbps: 200, lossPct: 9 } });
    expect(r.advice).toContain("upload");
    expect(report(windows.filter((w) => w.level === "good"), start)!.advice).toContain("clean");
  });
});
