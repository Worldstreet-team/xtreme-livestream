/**
 * Builds lib/cover-art/assets.ts: the outlines the category covers draw
 * with, so a cover needs no font and no image at runtime.
 *
 *   node_modules/.bin/tsx scripts/build-cover-assets.ts [path/to/Archivo.woff2]
 *
 * - Type: Archivo (OFL) at the brand's display instance — weight 800, width
 *   118% — outlined to paths, capitals, figures and the punctuation our
 *   category names use. Without an argument the script looks for the
 *   variable Archivo that next/font serves in .next/static/media (run the
 *   dev server once first).
 * - Marks: the Solar icons (CC BY 4.0) the catalog names, rounded to one
 *   decimal on their 24-unit grid.
 *
 * fontkit is the copy Next vendors for next/font; its WOFF2 glyphs skip the
 * variation step, so `_decode` is wrapped below to apply the gvar deltas.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "../lib/categories";
import { iconNames } from "../lib/cover-art/catalog";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const WGHT = 800;
const WDTH = 118;

// ── font ────────────────────────────────────────────────────────────────
type Pt = { x: number; y: number; constructor: new (...a: unknown[]) => Pt };
type Glyph = { id: number; advanceWidth: number; path: { commands: { command: string; args: number[] }[] } };
type Font = {
  familyName: string;
  variationAxes: Record<string, unknown>;
  variationCoords?: number[];
  glyphForCodePoint(cp: number): Glyph;
  hasGlyphForCodePoint(cp: number): boolean;
};

function fontkit(): (buf: Buffer) => Font {
  const nextDir = dirname(require.resolve("next/package.json"));
  return require(join(nextDir, "dist/compiled/@next/font/dist/fontkit/index.js")).default;
}

function findArchivo(open: (b: Buffer) => Font): string {
  const dir = join(root, ".next/static/media");
  if (!existsSync(dir)) throw new Error("no .next/static/media — run the dev server once, or pass the font path");
  let best: { file: string; n: number } | undefined;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".woff2")) continue;
    const font = open(readFileSync(join(dir, f)));
    if (font.familyName.startsWith("Archivo") && "wdth" in font.variationAxes && font.hasGlyphForCodePoint(65)) {
      const n = [..."ÉÈÁÄÖÜÑÇ"].filter((c) => font.hasGlyphForCodePoint(c.codePointAt(0)!)).length;
      if (!best || n > best.n) best = { file: join(dir, f), n };
    }
  }
  if (!best) throw new Error("no variable Archivo (latin) in .next/static/media");
  return best.file;
}

let PointClass: (new (...a: unknown[]) => Pt) | undefined;

function instance(open: (b: Buffer) => Font, file: string): Font {
  const font = open(readFileSync(file));
  font.variationCoords = [WGHT, WDTH]; // fvar order: wght, wdth
  const probe = font.glyphForCodePoint(65) as unknown as { constructor: { prototype: Record<string, unknown> } };
  // Borrow the Point class from a glyph decoded before the wrap goes on.
  const plain = (probe as unknown as { _decode(): { points: Pt[] } })._decode();
  PointClass = plain.points[0].constructor;
  const proto = probe.constructor.prototype;
  if (!proto.__varied) {
    const decode = proto._decode as (this: unknown) => unknown;
    proto.__varied = true;
    proto._decode = function (this: { id: number; _font: { _variationProcessor?: { transformPoints(id: number, p: unknown[]): void }; __done?: Set<number> } }) {
      const g = decode.call(this) as { numberOfContours: number; points?: Pt[]; components?: { dx: number; dy: number }[] } | null;
      const vp = this._font._variationProcessor;
      if (!g || !vp) return g;
      const done = (this._font.__done ??= new Set());
      if (done.has(this.id)) return g;
      done.add(this.id);
      if (g.points?.length) PointClass ??= g.points[0].constructor;
      const P = PointClass!;
      const phantom = () => new P(false, true, 0, 0); // as fontkit's own phantoms
      if (g.numberOfContours > 0 && g.points) {
        const pts: unknown[] = [...g.points, phantom(), phantom(), phantom(), phantom()];
        vp.transformPoints(this.id, pts);
      } else if (g.numberOfContours < 0 && g.components) {
        const pts = g.components.map((c) => new P(true, true, c.dx, c.dy));
        pts.push(phantom(), phantom(), phantom(), phantom());
        vp.transformPoints(this.id, pts);
        g.components.forEach((c, i) => {
          c.dx = pts[i].x;
          c.dy = pts[i].y;
        });
      }
      return g;
    };
  }
  return font;
}

const r0 = (n: number) => Math.round(n);

/** Path in y-down font units (baseline at 0, caps reach about -690). */
function glyphPath(g: Glyph): string {
  let d = "";
  for (const c of g.path.commands) {
    const a = c.args.map((v, i) => (i % 2 ? r0(-v) : r0(v)));
    switch (c.command) {
      case "moveTo": d += `M${a[0]} ${a[1]}`; break;
      case "lineTo": d += `L${a[0]} ${a[1]}`; break;
      case "quadraticCurveTo": d += `Q${a[0]} ${a[1]} ${a[2]} ${a[3]}`; break;
      case "bezierCurveTo": d += `C${a[0]} ${a[1]} ${a[2]} ${a[3]} ${a[4]} ${a[5]}`; break;
      case "closePath": d += "Z"; break;
    }
  }
  return d.replace(/ -/g, "-");
}

// ── icons ───────────────────────────────────────────────────────────────
function iconBody(name: string): string {
  const dir = dirname(require.resolve("@iconify-icons/solar/package.json"));
  const file = join(dir, "data", name[0], `${name}-bold.js`);
  const src = readFileSync(file, "utf8");
  const m = src.match(/"body":\s*("(?:[^"\\]|\\.)*")/);
  if (!m) throw new Error(`no body in ${file}`);
  let body: string = JSON.parse(m[1]);
  // One decimal on a 24-unit grid is well under a pixel at cover sizes.
  body = body.replace(/-?\d*\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10));
  body = body.replace(/\s*fill="currentColor"/g, "").replace(/<g>([\s\S]*)<\/g>/, "$1");
  return body.replace(/"/g, "'");
}

// ── write ───────────────────────────────────────────────────────────────
const open = fontkit();
const file = process.argv[2] ?? findArchivo(open);
const font = instance(open, file);

const chars = new Set<string>([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 &'.,:!?-+/()#%·ÉÈÊÁÀÂÄÖÓÔÜÚÑÇÍ"]);
for (const c of CATEGORIES) for (const ch of c.toUpperCase()) chars.add(ch === "’" ? "'" : ch);

const glyphs: Record<string, [number, string]> = {};
for (const ch of [...chars].sort()) {
  const cp = ch.codePointAt(0)!;
  if (!font.hasGlyphForCodePoint(cp)) {
    console.warn("no glyph for", JSON.stringify(ch));
    continue;
  }
  const g = font.glyphForCodePoint(cp);
  glyphs[ch] = [r0(g.advanceWidth), ch === " " ? "" : glyphPath(g)];
}

const icons: Record<string, string> = {};
for (const name of iconNames()) icons[name] = iconBody(name);

const out = `// Generated by scripts/build-cover-assets.ts — do not edit by hand.
// Type: Archivo (SIL Open Font License 1.1), weight ${WGHT}, width ${WDTH}%, outlined.
// Icons: Solar by 480 Design (CC BY 4.0), bold style, 24-unit grid.

/** [advance, path] per character, 1000 units per em, y-down, baseline 0. */
export const GLYPHS: Record<string, readonly [number, string]> = ${JSON.stringify(glyphs)};

/** Cap height in the same units. */
export const CAP_HEIGHT = ${r0(-Math.min(...(glyphs.H?.[1].match(/-\d+/g) ?? ["-690"]).map(Number)))};

/** SVG body per icon (24×24, paints with currentColor). */
export const ICONS: Record<string, string> = ${JSON.stringify(icons, null, 0)};
`;
writeFileSync(join(root, "lib/cover-art/assets.ts"), out);
console.log(`font ${file}\n${Object.keys(glyphs).length} glyphs, ${Object.keys(icons).length} icons, ${(out.length / 1024).toFixed(1)} KB`);
