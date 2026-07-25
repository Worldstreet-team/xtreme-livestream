import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accrueViewerSeconds,
  averageViewers,
  formatDuration,
} from "../src/stream-service.js";
import type { IStream } from "../src/models.js";

/** Minimal stand-in for the fields the viewer-time helpers touch. */
function streamStub(overrides: Partial<IStream> = {}) {
  return {
    viewers: 0,
    viewerSeconds: 0,
    viewerSampledAt: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: null,
    ...overrides,
  } as unknown as IStream;
}

describe("formatDuration", () => {
  afterEach(() => vi.useRealTimers());

  it("formats minute-length streams", () => {
    vi.setSystemTime(new Date("2026-01-01T00:01:05.000Z"));
    expect(formatDuration(new Date("2026-01-01T00:00:00.000Z"))).toBe("1:05");
  });

  it("formats hour-length streams", () => {
    vi.setSystemTime(new Date("2026-01-01T01:02:03.000Z"));
    expect(formatDuration(new Date("2026-01-01T00:00:00.000Z"))).toBe(
      "1:02:03",
    );
  });
});

describe("accrueViewerSeconds", () => {
  it("banks the previous count over the elapsed window", () => {
    const stream = streamStub({ viewers: 10 });

    // First window runs from startedAt, since nothing has been sampled yet.
    accrueViewerSeconds(stream, new Date("2026-01-01T00:01:00.000Z").getTime());

    expect(stream.viewerSeconds).toBe(600);
    expect(stream.viewerSampledAt).toEqual(
      new Date("2026-01-01T00:01:00.000Z"),
    );
  });

  it("accumulates across successive windows", () => {
    const stream = streamStub({ viewers: 10 });

    accrueViewerSeconds(stream, new Date("2026-01-01T00:01:00.000Z").getTime());
    stream.viewers = 4;
    accrueViewerSeconds(stream, new Date("2026-01-01T00:02:00.000Z").getTime());

    expect(stream.viewerSeconds).toBe(600 + 240);
  });

  it("ignores a window that would run backwards", () => {
    const stream = streamStub({
      viewers: 10,
      viewerSampledAt: new Date("2026-01-01T00:05:00.000Z"),
    });

    accrueViewerSeconds(stream, new Date("2026-01-01T00:04:00.000Z").getTime());

    expect(stream.viewerSeconds).toBe(0);
  });
});

describe("averageViewers", () => {
  it("divides accrued viewer-seconds by the stream's duration", () => {
    expect(
      averageViewers({
        viewerSeconds: 900,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        endedAt: new Date("2026-01-01T00:05:00.000Z"),
      }),
    ).toBe(3);
  });

  it("returns 0 for streams recorded before viewer-time tracking", () => {
    expect(
      averageViewers({
        viewerSeconds: 0,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        endedAt: new Date("2026-01-01T00:05:00.000Z"),
      }),
    ).toBe(0);
  });

  it("measures a live stream against the elapsed time so far", () => {
    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    expect(
      averageViewers({
        viewerSeconds: 1200,
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        endedAt: null,
      }),
    ).toBe(2);
    vi.useRealTimers();
  });
});
