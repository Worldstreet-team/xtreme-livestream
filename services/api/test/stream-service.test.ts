import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "../src/stream-service.js";

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
