/**
 * Cover art for every category, live or not — our own, drawn from the name.
 *
 * The categories endpoint supplies a cover only for categories with someone
 * streaming in them (the busiest live thumbnail). Everything else, and every
 * category card, uses the category's generated cover: a flat poster in the
 * brand palette with the family's motif, the category's mark and its name
 * (see lib/cover-art). No third-party artwork, no photographs.
 *
 * The drawing happens in the /cover.svg route, so this module stays tiny on
 * the client: it only builds the URL. Any shape works — portrait for box
 * art, landscape for tiles and stream fallbacks, and small thumbs (under
 * 200px on the short side) drop the type and keep the mark.
 */

import { COVER_VERSION } from "@/lib/cover-art/version";

export type CoverTheme = "dark" | "light";

/** The cover for a category at the requested size (and ground). */
export function categoryArt(
  category: string,
  size: { w: number; h: number } = { w: 800, h: 450 },
  theme: CoverTheme = "dark"
) {
  const q = new URLSearchParams({
    c: category,
    w: String(Math.round(size.w)),
    h: String(Math.round(size.h)),
    v: String(COVER_VERSION),
  });
  if (theme === "light") q.set("t", "light");
  return `/cover.svg?${q}`;
}

/** Portrait box art, the shape category cards use. */
export function categoryPoster(category: string) {
  return categoryArt(category, { w: 480, h: 640 });
}
