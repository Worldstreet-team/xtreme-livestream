/**
 * The web app's category covers (lib/cover-art) — a pure generator, tested
 * here because the API's vitest is the repo's only runner (as for
 * lib/ticker.ts). Covers are our own drawing: no third-party art, no
 * remote references, and the same name always draws the same cover.
 */
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_GROUPS } from "../../../lib/categories";
import { coverDataUri, coverFrame, coverSpec, coverSvg } from "../../../lib/cover-art";
import { ICONS, GLYPHS } from "../../../lib/cover-art/assets";
import { FAMILIES, GAMES, GENRES, TOPICS } from "../../../lib/cover-art/catalog";
import { categoryArt, categoryPoster } from "../../../lib/category-art";

const PORTRAIT = { w: 480, h: 640 };
const WIDE = { w: 640, h: 360 };
const THUMB = { w: 72, h: 96 };

/** Every URL-ish thing in an SVG, minus the SVG namespace itself. */
function externalRefs(svg: string) {
  return (svg.replace('xmlns="http://www.w3.org/2000/svg"', "").match(/(https?:|\/\/|url\(|<image|xlink:href|href="(?!#))/g) ?? []);
}

describe("category covers", () => {
  it("draws the same cover for the same name, byte for byte", () => {
    for (const c of ["Just Chatting", "Fortnite", "Crypto Markets", "Some Retired Label"]) {
      for (const size of [PORTRAIT, WIDE, THUMB]) {
        expect(coverSvg(c, size)).toBe(coverSvg(c, { ...size }));
      }
    }
  });

  it("gives every category in the taxonomy its own cover", () => {
    const seen = new Set<string>();
    for (const c of CATEGORIES) {
      const svg = coverSvg(c, PORTRAIT);
      expect(svg.startsWith("<svg")).toBe(true);
      expect(seen.has(svg)).toBe(false);
      seen.add(svg);
    }
    expect(seen.size).toBe(CATEGORIES.length);
  });

  it("files every taxonomy topic: a family for each group, a mark for each topic", () => {
    for (const g of CATEGORY_GROUPS) expect(FAMILIES[g.label], g.label).toBeDefined();
    for (const g of CATEGORY_GROUPS) {
      for (const t of g.topics) {
        if (g.label === "Games") {
          expect(GAMES[t], t).toBeDefined();
        } else {
          expect(TOPICS[t]?.icon, t).toBeDefined();
        }
        const spec = coverSpec(t);
        expect(ICONS[spec.icon], `${t} → ${spec.icon}`).toBeDefined();
        if (spec.genre) expect(ICONS[GENRES[spec.genre].icon]).toBeDefined();
      }
    }
  });

  it("sets every taxonomy name in outlined type, never falling back to a live font", () => {
    for (const c of CATEGORIES) {
      for (const ch of c.toUpperCase().replace(/’/g, "'")) expect(GLYPHS[ch], `${c}: ${ch}`).toBeDefined();
      expect(coverSvg(c, PORTRAIT)).not.toContain("<text");
      expect(coverSvg(c, WIDE)).not.toContain("<text");
    }
  });

  it("references nothing outside itself", () => {
    for (const c of [...CATEGORIES, "ZEVENT", "Pokémon FireRed/LeafGreen", "Слоты"]) {
      for (const size of [PORTRAIT, WIDE, THUMB]) {
        for (const theme of ["dark", "light"] as const) {
          expect(externalRefs(coverSvg(c, { ...size, theme })), c).toEqual([]);
        }
      }
    }
  });

  it("drops the type on thumbs and keeps the mark", () => {
    const thumb = coverSvg("Basketball", THUMB);
    expect(thumb).not.toContain("<use");
    expect(thumb).toContain('fill="currentColor"');
    expect(coverSvg("Basketball", PORTRAIT)).toContain("<use");
  });

  it("frames each shape at its own aspect", () => {
    expect(coverFrame(480, 640)).toEqual({ W: 360, H: 480 });
    expect(coverFrame(640, 360)).toEqual({ W: 640, H: 360 });
    expect(coverSvg("Golf", WIDE)).toContain('viewBox="0 0 640 360"');
  });

  it("swaps dark grounds for paper under the light theme, keeps solid ones", () => {
    const night = CATEGORIES.find((c) => coverSpec(c).scheme === "night")!;
    expect(coverSvg(night, { ...PORTRAIT, theme: "light" })).not.toBe(coverSvg(night, PORTRAIT));
    const chili = CATEGORIES.find((c) => coverSpec(c).scheme === "chili")!;
    expect(coverSvg(chili, { ...PORTRAIT, theme: "light" })).toBe(coverSvg(chili, PORTRAIT));
  });

  it("gives an unknown label a stable monogram cover, and escapes it", () => {
    const spec = coverSpec("Always On");
    expect(spec.mono).toBe("AO");
    const svg = coverSvg('<script>alert("x")</script>', PORTRAIT);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(coverDataUri("Chess", THUMB).startsWith("data:image/svg+xml,")).toBe(true);
  });

  it("builds cover URLs on our own origin", () => {
    const url = categoryArt("R&B, Soul & Jazz", { w: 72, h: 96 });
    expect(url.startsWith("/cover.svg?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("c")).toBe("R&B, Soul & Jazz");
    expect([q.get("w"), q.get("h")]).toEqual(["72", "96"]);
    expect(categoryArt("Golf", { w: 800, h: 450 }, "light")).toContain("t=light");
    expect(categoryPoster("Golf")).toContain("w=480&h=640");
  });
});
