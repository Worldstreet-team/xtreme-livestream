import { describe, expect, it } from "vitest";
import {
  BACKGROUNDS,
  DEFAULT_LOOK_SETTINGS,
  FACE_OVAL,
  LOOKS,
  LUT_SIZE,
  SMOOTH_STEPS,
  changesAppearance,
  gradeColor,
  isPlainLook,
  makeLut,
  readLookSettings,
  skinShape,
  smoothRadius,
} from "../../../lib/looks";

/**
 * The looks' maths, in Node: six colour grades as 17³ cubes, generated
 * with no assets. Natural must be a true identity, Mono must throw colour
 * away, Punch must push contrast — and every cube must be the size a
 * WebGL TEXTURE_3D takes as-is.
 */

const N = LUT_SIZE;
const at = (lut: Uint8Array, r: number, g: number, b: number) => {
  const i = ((b * N + g) * N + r) * 4;
  return [lut[i], lut[i + 1], lut[i + 2], lut[i + 3]] as const;
};
const grey = (v: number) => [v, v, v] as const;

describe("the looks' cubes", () => {
  it("are 17 a side, RGBA, red running fastest", () => {
    for (const { id } of LOOKS) {
      const lut = makeLut(id);
      expect(lut).toBeInstanceOf(Uint8Array);
      expect(lut.length).toBe(N * N * N * 4);
    }
    // The last texel of the first row is pure red in, so red out for Natural.
    expect(at(makeLut("natural"), N - 1, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(at(makeLut("natural"), 0, N - 1, 0)).toEqual([0, 255, 0, 255]);
    expect(at(makeLut("natural"), 0, 0, N - 1)).toEqual([0, 0, 255, 255]);
  });

  it("Natural is the identity, everywhere", () => {
    const lut = makeLut("natural");
    for (let b = 0; b < N; b++) {
      for (let g = 0; g < N; g++) {
        for (let r = 0; r < N; r++) {
          const want = [r, g, b].map((v) => Math.round((v / (N - 1)) * 255));
          expect(at(lut, r, g, b)).toEqual([...want, 255]);
        }
      }
    }
  });

  it("Mono has equal channels, and keeps black and white", () => {
    const lut = makeLut("mono");
    for (let i = 0; i < lut.length; i += 4) {
      expect(lut[i + 1]).toBe(lut[i]);
      expect(lut[i + 2]).toBe(lut[i]);
    }
    expect(at(lut, 0, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(at(lut, N - 1, N - 1, N - 1)).toEqual([255, 255, 255, 255]);
    // Green carries more light than blue, as it does to the eye.
    expect(at(lut, 0, N - 1, 0)[0]).toBeGreaterThan(at(lut, 0, 0, N - 1)[0]);
  });

  it("Punch raises contrast, and colour with it", () => {
    const [dark] = gradeColor("punch", ...grey(0.25));
    const [light] = gradeColor("punch", ...grey(0.75));
    expect(light - dark).toBeGreaterThan(0.5);
    // A muted red comes out redder: the gap between its channels widens.
    const [r, g] = gradeColor("punch", 0.6, 0.4, 0.4);
    expect(r - g).toBeGreaterThan(0.2);
    // Mid-grey stays put, so the picture doesn't go lighter or darker overall.
    expect(gradeColor("punch", ...grey(0.5)).map((v) => Math.round(v * 255))).toEqual([128, 128, 128]);
  });

  it("Warm raises red over blue; Cool the other way", () => {
    const [wr, , wb] = gradeColor("warm", ...grey(0.5));
    expect(wr).toBeGreaterThan(wb);
    const [cr, , cb] = gradeColor("cool", ...grey(0.5));
    expect(cb).toBeGreaterThan(cr);
  });

  it("Film lifts the blacks and eases colour back", () => {
    const [black] = gradeColor("film", 0, 0, 0);
    expect(black).toBeGreaterThan(0.03);
    expect(black).toBeLessThan(0.1);
    expect(gradeColor("film", 1, 1, 1)).toEqual([1, 1, 1]);
    const [r, g] = gradeColor("film", 0.6, 0.4, 0.4);
    expect(r - g).toBeLessThan(0.2);
  });

  it("every look stays in range and is monotonic in brightness", () => {
    for (const { id } of LOOKS) {
      const lut = makeLut(id);
      for (const v of lut) expect(v >= 0 && v <= 255).toBe(true);
      let last = -1;
      for (let i = 0; i < N; i++) {
        const [r, g, b] = at(lut, i, i, i);
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        expect(y).toBeGreaterThanOrEqual(last);
        last = y;
      }
    }
  });
});

describe("the settings", () => {
  it("start with nothing on", () => {
    expect(DEFAULT_LOOK_SETTINGS).toEqual({ background: "none", look: "natural", smooth: 0 });
    expect(BACKGROUNDS.map((b) => b.id)).toEqual(["none", "blur-soft", "blur-strong", "brand", "image", "green"]);
    expect(SMOOTH_STEPS[0]).toEqual({ value: 0, label: "Off" });
    expect(isPlainLook(DEFAULT_LOOK_SETTINGS)).toBe(true);
    expect(changesAppearance(DEFAULT_LOOK_SETTINGS)).toBe(false);
    expect(LOOKS.map((l) => l.id)).toEqual(["natural", "warm", "cool", "film", "mono", "punch"]);
  });

  it("read what this browser kept, and shrug at anything else", () => {
    expect(readLookSettings(JSON.stringify({ background: "blur-soft", look: "film" }))).toEqual({ background: "blur-soft", look: "film", smooth: 0 });
    expect(readLookSettings({ background: "brand", look: "mono" })).toEqual({ background: "brand", look: "mono", smooth: 0 });
    expect(readLookSettings(null)).toEqual(DEFAULT_LOOK_SETTINGS);
    expect(readLookSettings("not json")).toEqual(DEFAULT_LOOK_SETTINGS);
    expect(readLookSettings({ background: "sparkles", look: 7 })).toEqual(DEFAULT_LOOK_SETTINGS);
    expect(readLookSettings({ background: "image" })).toEqual({ background: "image", look: "natural", smooth: 0 });
  });

  it("keep smoothing between 0 and 1, and anything that isn't a number off", () => {
    expect(readLookSettings({ smooth: 0.6 }).smooth).toBe(0.6);
    expect(readLookSettings({ smooth: 4 }).smooth).toBe(1);
    expect(readLookSettings({ smooth: -1 }).smooth).toBe(0);
    expect(readLookSettings({ smooth: "lots" }).smooth).toBe(0);
    expect(readLookSettings({ smooth: Number.NaN }).smooth).toBe(0);
  });

  it("count smoothing as something on the camera, and as something viewers are told about", () => {
    const smoothed = { ...DEFAULT_LOOK_SETTINGS, smooth: 0.35 };
    expect(isPlainLook(smoothed)).toBe(false);
    expect(changesAppearance(smoothed)).toBe(true);
    // A colour grade or a background isn't a change to the face.
    expect(changesAppearance({ smooth: 0 })).toBe(false);
    expect(isPlainLook({ ...DEFAULT_LOOK_SETTINGS, background: "green" })).toBe(false);
  });
});

describe("where the skin is", () => {
  // A stand-in face: every point on a circle round the frame's centre, in index order.
  const face = (cx = 0.5, cy = 0.5, r = 0.2) => {
    const pts = new Float32Array(478 * 2);
    for (let i = 0; i < 478; i++) {
      const a = (i / 478) * Math.PI * 2;
      pts[i * 2] = cx + Math.cos(a) * r;
      pts[i * 2 + 1] = cy + Math.sin(a) * r;
    }
    return pts;
  };

  it("needs a whole face", () => {
    expect(skinShape(new Float32Array(10))).toBeNull();
  });

  it("fans the outline into triangles and cuts eyes, brows and lips back out", () => {
    const shape = skinShape(face())!;
    // A fan of n points is n triangles of 3 points of 2 numbers.
    expect(shape.face.length).toBe(FACE_OVAL.length * 6);
    // Two eyes (16 each), two brows (10 each), the lips (20).
    expect(shape.holes.length).toBe((16 + 16 + 10 + 10 + 20) * 6);
    for (const v of shape.face) expect(Number.isFinite(v)).toBe(true);
  });

  it("measures the face's height off its outline", () => {
    const shape = skinShape(face(0.5, 0.5, 0.2))!;
    expect(shape.height).toBeGreaterThan(0.3);
    expect(shape.height).toBeLessThanOrEqual(0.4 + 1e-6);
  });

  it("reaches further on a bigger face, within bounds", () => {
    expect(smoothRadius(300)).toBeCloseTo(6);
    expect(smoothRadius(20)).toBe(1.5);
    expect(smoothRadius(5000)).toBe(9);
  });
});
