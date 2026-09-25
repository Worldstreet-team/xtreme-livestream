import { describe, expect, it } from "vitest";
import { qrModules } from "../../../lib/qr";

/**
 * The QR encoder behind the scene's call-to-action card (lib/qr.ts — a web
 * helper tested here, like lib/ticker.ts). Decoding was checked end to end
 * with Chrome's BarcodeDetector across versions 1–12; these pin the
 * structure every scanner relies on.
 */

describe("QR codes", () => {
  it("picks the smallest version that fits", () => {
    expect(qrModules("HELLO")).toHaveLength(21); // version 1
    expect(qrModules("https://xtream.live/c/amara")).toHaveLength(29); // version 3
    expect(qrModules("https://x.co/" + "a".repeat(250))).toHaveLength(65); // version 12
  });

  it("draws the three finder patterns and the timing lines", () => {
    const m = qrModules("https://shop.example.com/merch");
    const n = m.length;
    const finderAt = (x0: number, y0: number) => {
      for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
          const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          expect(m[y0 + dy][x0 + dx], `finder at ${x0},${y0}`).toBe(ring !== 2);
        }
      }
    };
    finderAt(0, 0);
    finderAt(n - 7, 0);
    finderAt(0, n - 7);
    for (let i = 8; i < n - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
    // The module that's always dark.
    expect(m[n - 8][8]).toBe(true);
  });

  it("is the same code every time, and a different one for different text", () => {
    expect(qrModules("https://a.example")).toEqual(qrModules("https://a.example"));
    expect(qrModules("https://a.example")).not.toEqual(qrModules("https://b.example"));
  });
});
