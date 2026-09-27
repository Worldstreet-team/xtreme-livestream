import { describe, expect, it } from "vitest";
import { BRAND_ACCENTS, BRAND_FONTS, LOWER_THIRD_STYLES, SCENE_LAYOUTS } from "@xtreme/contracts";
import { GIFT_CATALOG } from "../../../lib/gifts";
import { PADS } from "../../../lib/audio-desk";
import { LOOKS } from "../../../lib/looks";
import { DEFAULT_BRAND, readBrand } from "../../../lib/scene";
import { fallbackFace, type FaceGeo } from "../../../lib/face-anchors";
import {
  SETS,
  brandWithSet,
  effectForGift,
  giftsFor,
  readSetId,
  setArt,
  setById,
  setEffects,
  setUsesFace,
  soundForGift,
  soundGate,
  type SetManifest,
} from "../../../lib/sets";
import { EFFECTS, MAX_PER_KIND, MAX_RUNNING, admitEffect, effectDef, posePiece, startEffect, type EffectRun } from "../../../lib/gift-effects";
import { stingerMs } from "../../../components/app/set-stinger";

/**
 * Sets (Phase 4): four first-party packs that point only at things the app
 * already has — accents, looks, layouts, pads, the gifts' own art — and the
 * effect library they draw from: where a crown sits, how a flurry stacks.
 */

const owambe = setById("owambe")!;
const desk = setById("trading-desk")!;

describe("the four sets", () => {
  it("are four, each once, and say what they are", () => {
    expect(SETS.map((s) => s.id)).toEqual(["owambe", "trading-desk", "game-night", "soft-hours"]);
    for (const s of SETS) {
      expect(s.version).toBeGreaterThanOrEqual(1);
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.blurb.length).toBeLessThanOrEqual(110);
      expect(s.palette).toHaveLength(3);
      for (const c of s.palette) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.stinger).toBeTruthy();
    }
  });

  it("only point at things the app has: gifts, pads, looks, layouts and the brand kit's choices", () => {
    const gifts = new Set(GIFT_CATALOG.map((g) => g.id));
    const pads = new Set(PADS.map((p) => p.id));
    const effects = new Set(EFFECTS.map((e) => e.id));
    for (const s of SETS) {
      for (const [gift, effect] of Object.entries(s.effects)) {
        expect(gifts.has(gift), `${s.id}: ${gift}`).toBe(true);
        expect(effects.has(effect!)).toBe(true);
      }
      for (const [gift, pad] of Object.entries(s.sounds)) {
        expect(gifts.has(gift), `${s.id}: ${gift}`).toBe(true);
        expect(pads.has(pad!)).toBe(true);
      }
      if (s.look) expect(LOOKS.some((l) => l.id === s.look)).toBe(true);
      if (s.layout) expect(SCENE_LAYOUTS).toContain(s.layout);
      if (s.accent) expect(BRAND_ACCENTS).toContain(s.accent);
      if (s.font) expect(BRAND_FONTS).toContain(s.font);
      if (s.lowerThird) expect(LOWER_THIRD_STYLES).toContain(s.lowerThird);
    }
  });

  it("feel different: each its own colour, look and stinger, three effects or more", () => {
    expect(new Set(SETS.map((s) => s.accent)).size).toBe(4);
    expect(new Set(SETS.map((s) => s.look)).size).toBe(4);
    expect(new Set(SETS.map((s) => s.stinger)).size).toBe(4);
    for (const s of SETS) expect(setEffects(s).length).toBeGreaterThanOrEqual(3);
    expect(setEffects(owambe)).toEqual(expect.arrayContaining(["crown", "confetti"]));
    expect(setEffects(desk)).toEqual(expect.arrayContaining(["rocket", "diamonds"]));
    expect(desk.layout).toBe("chart-face");
    expect(desk.look).toBe("mono");
  });

  it("keep their art small: four pieces of gift art at most", () => {
    for (const s of SETS) expect(setArt(s).length).toBeLessThanOrEqual(4);
    // Shades are drawn, not fetched.
    expect(setArt(desk)).not.toContain(null);
  });
});

describe("a set's effect and sound for a gift", () => {
  it("by the gift's id, or by the emoji its chat line carries", () => {
    expect(effectForGift(owambe, "crown")).toBe("crown");
    expect(effectForGift(owambe, "👑")).toBe("crown");
    expect(effectForGift(owambe, { emoji: "🎉" })).toBe("confetti");
    expect(effectForGift(owambe, { giftId: "heart", emoji: "💰" })).toBe("hearts");
    expect(soundForGift(desk, { emoji: "🚀" })).toBe("whoosh");
    expect(soundForGift(desk, "diamond")).toBe("kaching");
  });

  it("nothing for a gift the set doesn't answer, an amount with no gift, or no set", () => {
    expect(effectForGift(desk, "heart")).toBeNull();
    expect(effectForGift(owambe, "💰")).toBeNull();
    expect(effectForGift(owambe, { emoji: "📣" })).toBeNull();
    expect(effectForGift(owambe, "not-a-gift")).toBeNull();
    expect(effectForGift(null, "crown")).toBeNull();
    expect(effectForGift(owambe, null)).toBeNull();
    expect(soundForGift(undefined, "crown")).toBeNull();
  });

  it("lists which gifts play an effect, cheapest first", () => {
    expect(giftsFor(owambe, "crown")).toEqual(["crown", "lion", "whale", "bank"]);
    expect(giftsFor(null, "crown")).toEqual([]);
  });

  it("follows the face only when a set has effects that sit on it", () => {
    for (const s of SETS) expect(setUsesFace(s)).toBe(true);
    const confettiOnly: SetManifest = { ...owambe, effects: { party: "confetti" } };
    expect(setUsesFace(confettiOnly)).toBe(false);
    expect(setUsesFace(null)).toBe(false);
  });
});

describe("the set on the brand kit", () => {
  it("reads a set it knows, and anything else as none", () => {
    expect(readSetId("owambe")).toBe("owambe");
    expect(readSetId("soft-hours")).toBe("soft-hours");
    expect(readSetId("Owambe")).toBeNull();
    expect(readSetId("designer-drop")).toBeNull();
    expect(readSetId(null)).toBeNull();
    expect(readSetId(undefined)).toBeNull();
    expect(readSetId(7)).toBeNull();
    expect(setById("retro-vhs")).toBeNull();
  });

  it("comes through readBrand, off the stream and off the room", () => {
    expect(readBrand({ accent: "sky", set: "game-night" }).set).toBe("game-night");
    expect(readBrand({ accent: "sky", set: "retro-vhs" }).set).toBeNull();
    expect(readBrand({ accent: "sky" }).set).toBeNull();
    expect(DEFAULT_BRAND.set).toBeNull();
  });

  it("dresses the graphics in the set's colour while it's on, and hands the creator's own back after", () => {
    const own = { ...DEFAULT_BRAND, accent: "chili" as const, font: "clean" as const };
    const worn = brandWithSet({ ...own, set: "trading-desk" });
    expect(worn).toMatchObject({ accent: "mint", font: "mono", lowerThird: "bar", set: "trading-desk" });
    expect(brandWithSet({ ...own, set: null })).toEqual({ ...own, set: null });
    expect(brandWithSet(own)).toBe(own);
  });
});

describe("gift sounds without a pile-up", () => {
  it("plays a pad once per gap, each pad on its own", () => {
    const ok = soundGate(700);
    expect(ok("applause", 1000)).toBe(true);
    expect(ok("applause", 1300)).toBe(false);
    expect(ok("airhorn", 1300)).toBe(true);
    expect(ok("applause", 1700)).toBe(true);
  });
});

describe("the effects", () => {
  const tile = { w: 1280, h: 720 };
  const face: FaceGeo = { cx: 640, cy: 330, fw: 200, fh: 260, roll: 0, ex: 640, ey: 300, ed: 84, mx: 640, my: 390, known: true };
  const run = (effect: EffectRun["effect"], g = face) => startEffect(effect, g, tile, { now: 0, key: effect, seed: 42 });
  const pieceOf = (r: EffectRun, role: string) => r.pieces.find((p) => p.role === role)!;

  it("each play for 3–6 s", () => {
    expect(EFFECTS.map((e) => e.id)).toEqual(expect.arrayContaining(["crown", "shades", "hearts", "confetti", "fire", "rocket"]));
    for (const e of EFFECTS) {
      expect(e.ms).toBeGreaterThanOrEqual(3000);
      expect(e.ms).toBeLessThanOrEqual(6000);
    }
  });

  it("put a crown on the head once it's landed, leaning with it", () => {
    const r = run("crown");
    const crown = pieceOf(r, "crown");
    const pose = posePiece(r, crown, 1600, face, tile)!;
    expect(Math.abs(pose.x - face.cx)).toBeLessThan(1);
    // Above the brow's top.
    expect(pose.y).toBeLessThan(face.cy - face.fh / 2);
    expect(pose.o).toBe(1);

    const tilted = { ...face, roll: 0.3 };
    const lean = posePiece(r, crown, 1600, tilted, tile)!;
    expect(lean.x).toBeGreaterThan(face.cx + 20);
    expect(Math.abs(lean.rot - (0.3 * 180) / Math.PI)).toBeLessThan(3);
  });

  it("drop shades onto the eyes", () => {
    const r = run("shades");
    const pose = posePiece(r, pieceOf(r, "shades"), 2000, face, tile)!;
    expect(Math.abs(pose.x - face.ex)).toBeLessThan(1);
    expect(Math.abs(pose.y - face.ey)).toBeLessThan(face.ed * 0.2);
    // And they start above the tile.
    expect(posePiece(r, pieceOf(r, "shades"), 1, face, tile)!.y).toBeLessThan(0);
  });

  it("ring the face with fire, and send a rocket past it", () => {
    const fire = run("fire");
    const flames = fire.pieces.map((p) => posePiece(fire, p, 2000, face, tile)!);
    expect(flames).toHaveLength(12);
    for (const f of flames) expect(Math.hypot(f.x - face.cx, f.y - face.cy)).toBeGreaterThan(face.fw * 0.4);

    const rocket = run("rocket");
    const mid = posePiece(rocket, pieceOf(rocket, "rocket"), 1300, face, tile)!;
    expect(mid.x).toBeGreaterThan(face.cx);
    expect(posePiece(rocket, pieceOf(rocket, "rocket"), 2400, face, tile)).toBeNull();
  });

  it("sit centre-frame when no face is known", () => {
    const g = fallbackFace({ x: 0, y: 0, w: 1280, h: 720 });
    const r = run("crown", g);
    const pose = posePiece(r, pieceOf(r, "crown"), 1600, g, tile)!;
    expect(Math.abs(pose.x - 640)).toBeLessThan(1);
    expect(pose.y).toBeGreaterThan(0);
  });

  it("are gone once they're done", () => {
    for (const e of EFFECTS) {
      const r = run(e.id);
      for (const p of r.pieces) expect(posePiece(r, p, e.ms + 1, face, tile)).toBeNull();
    }
  });

  it("scatter the same way from the same seed", () => {
    const a = startEffect("confetti", face, tile, { now: 0, key: "a", seed: 9 });
    const b = startEffect("confetti", face, tile, { now: 0, key: "b", seed: 9 });
    expect(a.pieces.map((p) => p.vx)).toEqual(b.pieces.map((p) => p.vx));
    expect(a.pieces.filter((p) => p.role === "bit")).toHaveLength(56);
    expect(a.pieces.filter((p) => p.role === "popper")).toHaveLength(2);
  });
});

describe("a flurry of gifts", () => {
  const tile = { w: 390, h: 844 };
  const g = fallbackFace({ x: 0, y: 0, w: 390, h: 844 });
  const at = (effect: EffectRun["effect"], now: number, key = `${effect}-${now}`) => startEffect(effect, g, tile, { now, key });

  it("keeps a crown up longer and pulses it rather than stacking a second", () => {
    const runs = [at("crown", 0, "c1")];
    const first = runs[0].end;
    const a = admitEffect(runs, "crown", 1000);
    expect(a).toEqual({ kind: "extend", key: "c1" });
    expect(runs[0].end).toBeGreaterThan(first);
    expect(runs[0].pulse).toBe(1000);
    // …but not for ever.
    for (let t = 2000; t < 20_000; t += 1000) admitEffect(runs, "crown", Math.min(t, runs[0].end - 800));
    expect(runs[0].end - runs[0].start).toBeLessThanOrEqual(9000);
  });

  it("starts a new crown once the last is leaving", () => {
    const runs = [at("crown", 0, "c1")];
    expect(admitEffect(runs, "crown", effectDef("crown").ms - 300).kind).toBe("add");
  });

  it("cuts the oldest short past three of a kind, and past eight in all", () => {
    const runs = [at("confetti", 0, "a"), at("confetti", 100, "b"), at("confetti", 200, "c")];
    expect(admitEffect(runs, "confetti", 300).kind).toBe("add");
    expect(runs[0].end).toBeLessThanOrEqual(300 + 260);
    expect(runs[1].end).toBe(100 + effectDef("confetti").ms);
    expect(MAX_PER_KIND).toBe(3);

    const many = ["hearts", "hearts", "rocket", "rocket", "confetti", "confetti", "crown", "fire"].map((e, i) => at(e as EffectRun["effect"], i * 10, `m${i}`));
    expect(admitEffect(many, "shades", 100).kind).toBe("add");
    expect(many[0].end).toBeLessThanOrEqual(100 + 260);
    expect(MAX_RUNNING).toBe(8);
  });
});

describe("the stingers", () => {
  it("each run in under 600 ms", () => {
    for (const s of SETS) expect(stingerMs(s.stinger!)).toBeLessThanOrEqual(600);
  });
});
