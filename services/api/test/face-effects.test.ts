import { describe, expect, it } from "vitest";
import { ART, FACE_EFFECTS, artFor, faceGeom, isFaceEffect, mixGeom, placeEffect } from "../../../lib/face-effects";
import { readLookSettings, isPlainLook, DEFAULT_LOOK_SETTINGS } from "../../../lib/looks";

/**
 * Face effects (lib/face-effects.ts): which there are, and where their
 * pieces land on a face. A stand-in face is built from the landmarks the
 * maths reads, placed on a 1000×1000 frame, so positions are easy to reason about.
 */

function standIn({ tilt = 0 } = {}) {
  const pts = new Float32Array(478 * 2).fill(0.5);
  const set = (i: number, x: number, y: number) => {
    // Turn about the frame's centre by `tilt`, to test a leaning head.
    const dx = x - 0.5;
    const dy = y - 0.5;
    pts[i * 2] = 0.5 + dx * Math.cos(tilt) - dy * Math.sin(tilt);
    pts[i * 2 + 1] = 0.5 + dx * Math.sin(tilt) + dy * Math.cos(tilt);
  };
  set(10, 0.5, 0.3); // top of the forehead
  set(152, 0.5, 0.7); // chin
  set(1, 0.5, 0.52); // nose tip
  set(13, 0.5, 0.6); // upper lip
  for (const i of [33, 133, 159, 145]) set(i, 0.42, 0.45); // the eye on the frame's left
  for (const i of [263, 362, 386, 374]) set(i, 0.58, 0.45);
  set(205, 0.4, 0.55);
  set(425, 0.6, 0.55);
  set(234, 0.35, 0.5); // cheek edges
  set(454, 0.65, 0.5);
  return pts;
}

describe("the effects", () => {
  it("are listed with a way off first, and every recipe's art exists", () => {
    expect(FACE_EFFECTS[0]).toMatchObject({ id: "none", icon: null });
    for (const fx of FACE_EFFECTS) {
      expect(isFaceEffect(fx.id)).toBe(true);
      for (const art of artFor(fx.id)) expect(ART[art]).toBeDefined();
    }
    expect(artFor("none")).toEqual([]);
    expect(artFor("puppy").sort()).toEqual(["puppyEar", "puppyNose"]);
    expect(isFaceEffect("glitter")).toBe(false);
  });

  it("are part of the look, off unless picked", () => {
    expect(readLookSettings({ face: "crown" }).face).toBe("crown");
    expect(readLookSettings({ face: "laser-eyes" }).face).toBe("none");
    expect(isPlainLook({ ...DEFAULT_LOOK_SETTINGS, face: "shades" })).toBe(false);
  });
});

describe("the face", () => {
  it("is measured in pixels, level when the eyes are", () => {
    const g = faceGeom(standIn(), 1000, 1000)!;
    expect(g.w).toBeCloseTo(300);
    expect(g.h).toBeCloseTo(400);
    expect(g.roll).toBeCloseTo(0);
    expect(g.up.y).toBeCloseTo(-1);
    expect(g.eyeL.x).toBeCloseTo(420);
  });

  it("knows which way a leaning head is tilted", () => {
    const g = faceGeom(standIn({ tilt: 0.3 }), 1000, 1000)!;
    expect(g.roll).toBeCloseTo(0.3, 3);
  });

  it("needs a whole face", () => {
    expect(faceGeom(new Float32Array(20), 1000, 1000)).toBeNull();
  });

  it("blends halfway between two looks, turning the short way round", () => {
    const a = faceGeom(standIn(), 1000, 1000)!;
    const b = { ...a, top: { x: a.top.x + 100, y: a.top.y }, roll: a.roll + 0.2 };
    const m = mixGeom(a, b, 0.5);
    expect(m.top.x).toBeCloseTo(a.top.x + 50);
    expect(m.roll).toBeCloseTo(0.1);
    const wrap = mixGeom({ ...a, roll: 3.1 }, { ...a, roll: -3.1 }, 0.5);
    expect(Math.abs(Math.abs(wrap.roll) - Math.PI)).toBeLessThan(0.05);
  });
});

describe("where the pieces go", () => {
  const g = faceGeom(standIn(), 1000, 1000)!;

  it("puts a crown above the forehead, about as wide as the face", () => {
    const [crown] = placeEffect("crown", g, 0);
    expect(crown.art).toBe("crown");
    expect(crown.y).toBeLessThan(g.top.y);
    expect(crown.x).toBeCloseTo(g.top.x, 0);
    expect(crown.w).toBeGreaterThan(g.w * 0.85);
  });

  it("puts heart eyes on the eyes", () => {
    const [l, r] = placeEffect("hearts", g, 0);
    expect(l.x).toBeCloseTo(g.eyeL.x, 0);
    expect(r.x).toBeCloseTo(g.eyeR.x, 0);
  });

  it("mirrors the right-hand ear and keeps the pair either side of the head", () => {
    const [left, right, nose] = placeEffect("puppy", g, 0);
    expect(left.flip).toBe(false);
    expect(right.flip).toBe(true);
    expect(left.x).toBeLessThan(g.top.x);
    expect(right.x).toBeGreaterThan(g.top.x);
    expect(nose.x).toBeCloseTo(g.nose.x, 0);
  });

  it("leans with the head", () => {
    const tilted = faceGeom(standIn({ tilt: 0.3 }), 1000, 1000)!;
    const [shades] = placeEffect("shades", tilted, 0);
    expect(shades.rot).toBeCloseTo(0.3, 2);
  });

  it("carries the fade, and draws nothing for none", () => {
    expect(placeEffect("shades", g, 0, 0.4)[0].alpha).toBe(0.4);
    expect(placeEffect("none", g, 0)).toEqual([]);
  });
});
