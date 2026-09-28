/**
 * The walkthrough's geometry, kept pure so it can be reasoned about (and
 * tested) away from the DOM: the spotlight's cut-out as a clip-path, and
 * where the card sits beside it.
 *
 * The cut-out is a `polygon()` — the whole screen, then the rounded hole
 * traced the other way round, joined by a zero-width seam — so the dim
 * layer animates between targets with nothing but a clip-path transition,
 * on any easing curve, in every browser that interpolates polygons. Every
 * polygon has the same number of points (the corners are always drawn with
 * the same number of segments, even at radius 0), which is what lets one
 * glide into the next.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Hole extends Box {
  /** Corner radius. */
  r: number;
}

export interface Viewport {
  w: number;
  h: number;
}

/** Segments per corner: smooth at 16px and cheap to interpolate. */
const ARC = 7;

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

/** A rounded rectangle's outline, clockwise from the top-left corner's top end. */
function outline({ x, y, w, h, r }: Hole): [number, number][] {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  const corners: [number, number, number][] = [
    // centre x, centre y, start angle (radians) — clockwise in screen space
    [x + w - rad, y + rad, -Math.PI / 2],
    [x + w - rad, y + h - rad, 0],
    [x + rad, y + h - rad, Math.PI / 2],
    [x + rad, y + rad, Math.PI],
  ];
  const pts: [number, number][] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= ARC; i++) {
      const a = a0 + (i / ARC) * (Math.PI / 2);
      pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
  }
  return pts;
}

/**
 * The dim layer: everything, minus the hole. The screen is traced clockwise
 * and the hole anticlockwise, so under the default non-zero rule the hole
 * stays clear.
 */
export function scrimClip(hole: Hole): string {
  const ring = outline(hole).reverse();
  const [sx, sy] = ring[0];
  const parts = [
    "0 0",
    "100% 0",
    "100% 100%",
    "0 100%",
    "0 0",
    ...ring.map(([x, y]) => `${px(x)} ${px(y)}`),
    `${px(sx)} ${px(sy)}`,
    "0 0",
  ];
  return `polygon(${parts.join(", ")})`;
}

/** A thin ring hugging the hole: its outline grown by `width`, minus the hole. */
export function ringClip(hole: Hole, width = 1.5): string {
  const outer = outline({ x: hole.x - width, y: hole.y - width, w: hole.w + width * 2, h: hole.h + width * 2, r: hole.r + width });
  const inner = outline(hole).reverse();
  const [ox, oy] = outer[0];
  const [ix, iy] = inner[0];
  const parts = [
    ...outer.map(([x, y]) => `${px(x)} ${px(y)}`),
    `${px(ox)} ${px(oy)}`,
    `${px(ix)} ${px(iy)}`,
    ...inner.map(([x, y]) => `${px(x)} ${px(y)}`),
    `${px(ix)} ${px(iy)}`,
    `${px(ox)} ${px(oy)}`,
  ];
  return `polygon(${parts.join(", ")})`;
}

/** A target taller than this share of the screen is lit from its top down, leaving room for the card. */
const TALL = 0.56;

/** The hole around a target: a little air, and a radius that suits its size. */
export function holeFor(target: Box, vp: Viewport): Hole {
  const pad = target.w < 64 && target.h < 64 ? 6 : 8;
  const x = Math.max(4, target.x - pad);
  const y = Math.max(4, target.y - pad);
  const right = Math.min(vp.w - 4, target.x + target.w + pad);
  const bottom = Math.min(vp.h - 4, target.y + target.h + pad, y + vp.h * TALL);
  const w = Math.max(0, right - x);
  const h = Math.max(0, bottom - y);
  // Round things stay round (a Go live button, an avatar); panels get a panel's corner.
  const r = Math.min(w, h) <= 72 ? Math.min(w, h) / 2 : 16;
  return { x, y, w, h, r };
}

/** No target: the hole closes to a point behind the card. */
export function closedHole(at: { x: number; y: number }): Hole {
  return { x: at.x, y: at.y, w: 0, h: 0, r: 0 };
}

/** Before the tour starts, and as it leaves: a hole bigger than the screen, so nothing's dimmed. */
export function openHole(vp: Viewport): Hole {
  return { x: -48, y: -48, w: vp.w + 96, h: vp.h + 96, r: 48 };
}

/* ---- Placing the card ------------------------------------------------ */

export type Side = "top" | "right" | "bottom" | "left";

export interface Placement {
  x: number;
  y: number;
  /** Which of the card's edges carries the arrow; null when it doesn't point. */
  side: Side | null;
  /** How far along that edge the arrow's tip sits. */
  along: number;
  /** The hole as lit: a big target is lit from its top down, so the card has room below. */
  hole: Hole | null;
}

const GAP = 18;
const MARGIN = 16;
/** The arrow stays clear of the card's rounded corners. */
const CORNER = 26;
/** A big target is never trimmed shorter than this. */
const MIN_LIT = 96;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/**
 * Desktop: beside the hole, on the side with room. Against an edge (the
 * rail, the chat column) the card sits beside it, out in the open; wide
 * things (a row of tabs) get it below or above; a target too big for any
 * of that (a grid of covers) is lit from its top, with the card under it.
 */
export function placeCard(hole: Hole | null, card: { w: number; h: number }, vp: Viewport): Placement {
  const centred: Placement = { x: (vp.w - card.w) / 2, y: (vp.h - card.h) / 2, side: null, along: 0, hole: null };
  if (!hole || hole.w === 0) return centred;

  const fitsX = (x: number) => x >= MARGIN && x + card.w <= vp.w - MARGIN;
  const fitsY = (y: number) => y >= MARGIN && y + card.h <= vp.h - MARGIN;

  const around = (h: Hole): Record<Side, () => Placement | null> => {
    const cx = h.x + h.w / 2;
    const cy = h.y + h.h / 2;
    const alongY = (y: number) => clamp(cy - y, CORNER, card.h - CORNER);
    const alongX = (x: number) => clamp(cx - x, CORNER, card.w - CORNER);
    const rowY = clamp(cy - card.h / 2, MARGIN, vp.h - card.h - MARGIN);
    const colX = clamp(cx - card.w / 2, MARGIN, vp.w - card.w - MARGIN);
    return {
      // The card's left edge points at a target on its left.
      left: () => {
        const x = h.x + h.w + GAP;
        return fitsX(x) ? { x, y: rowY, side: "left", along: alongY(rowY), hole: h } : null;
      },
      right: () => {
        const x = h.x - GAP - card.w;
        return fitsX(x) ? { x, y: rowY, side: "right", along: alongY(rowY), hole: h } : null;
      },
      top: () => {
        const y = h.y + h.h + GAP;
        return fitsY(y) ? { x: colX, y, side: "top", along: alongX(colX), hole: h } : null;
      },
      bottom: () => {
        const y = h.y - GAP - card.h;
        return fitsY(y) ? { x: colX, y, side: "bottom", along: alongX(colX), hole: h } : null;
      },
    };
  };

  const cx = hole.x + hole.w / 2;
  const wide = hole.w > hole.h * 2.2;
  const order: Side[] =
    cx < vp.w * 0.28
      ? ["left", "top", "bottom", "right"]
      : cx > vp.w * 0.72
        ? ["right", "top", "bottom", "left"]
        : wide
          ? ["top", "bottom", "left", "right"]
          : ["left", "right", "top", "bottom"];
  const options = around(hole);
  for (const side of order) {
    const p = options[side]();
    if (p) return p;
  }

  // Too big for anything beside it: light its top and put the card under that.
  const room = vp.h - MARGIN - card.h - GAP - hole.y;
  if (room >= MIN_LIT) {
    const p = around({ ...hole, h: Math.min(hole.h, room) }).top();
    if (p) return p;
  }
  // Nowhere at all: over it, low and centred, not pointing.
  return { x: (vp.w - card.w) / 2, y: vp.h - card.h - MARGIN * 2, side: null, along: 0, hole };
}

/**
 * Phones: a sheet floating at the foot of the screen. When the target sits
 * where the sheet would cover it (the tab bar, the Go live button), the
 * sheet lifts to sit just above it and points down at it; a big target
 * (a grid) is lit down to the sheet's top edge instead.
 */
export function placeSheet(
  hole: Hole | null,
  sheet: { h: number },
  vp: Viewport,
  inset: number,
  safeBottom: number,
): { lift: number; along: number | null; hole: Hole | null } {
  if (!hole || hole.w === 0) return { lift: 0, along: null, hole: null };
  const top = vp.h - safeBottom - inset - sheet.h;
  if (hole.y + hole.h <= top - 8) return { lift: 0, along: null, hole };
  const lift = vp.h - safeBottom - inset - (hole.y - 12);
  if (top - lift >= MARGIN) {
    const cx = hole.x + hole.w / 2 - inset;
    return { lift, along: clamp(cx, CORNER, vp.w - inset * 2 - CORNER), hole };
  }
  // Can't lift over it: light what's above the sheet, if that's enough to see.
  const room = top - 12 - hole.y;
  if (room >= MIN_LIT) return { lift: 0, along: null, hole: { ...hole, h: Math.min(hole.h, room) } };
  return { lift: 0, along: null, hole };
}
