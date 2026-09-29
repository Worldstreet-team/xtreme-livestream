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
  /** The target's own corner radius, when it has one of its own to follow. */
  r?: number;
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

/**
 * The hole around a target: its real box, a little air, and its own corner
 * grown by that air, so the ring runs parallel to the element's edge. A
 * target with no corner of its own gets a round hole when it's small (a tab,
 * an avatar) and a card's corner when it's big.
 */
export function holeFor(target: Box, vp: Viewport): Hole {
  const pad = target.w < 64 && target.h < 64 ? 6 : 8;
  const x = Math.max(4, target.x - pad);
  const y = Math.max(4, target.y - pad);
  const right = Math.min(vp.w - 4, target.x + target.w + pad);
  const bottom = Math.min(vp.h - 4, target.y + target.h + pad, y + vp.h * TALL);
  const w = Math.max(0, right - x);
  const h = Math.max(0, bottom - y);
  const short = Math.min(w, h);
  const own = target.r;
  const round = own !== undefined && own >= Math.min(target.w, target.h) / 2 - 1;
  const r =
    round || (own === undefined || own === 0 ? short <= 72 : false)
      ? short / 2
      : own !== undefined && own > 0
        ? Math.min(own + pad, short / 2)
        : Math.min(12, short / 2);
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

/* ---- Phones: a compact card docked to one end ---------------------- */

export type Dock = "top" | "bottom";

export interface DockPlacement {
  /** The card's top edge, in viewport pixels. */
  y: number;
  /** The end it's docked to; null when it's centred (no target). */
  dock: Dock | null;
  /** The hole as lit (a target too big to clear is lit where the card isn't). */
  hole: Hole | null;
  /** The pointer: a line at `x` from the card's edge (`from`) to the hole's (`to`). */
  pointer: { x: number; from: number; to: number } | null;
}

/** Clear air between the card and the hole, so the pointer has room to be a pointer. */
export const DOCK_GAP = 30;
/** The pointer starts this far off the card and stops this far short of the ring. */
const POINTER_OFF_CARD = 4;
const POINTER_OFF_RING = 9;

/**
 * Phones: the card never covers what it names. A target in the lower half
 * (the tab bar, Go live, the studio's tools) puts the card at the top of the
 * screen; one in the upper half puts it at the foot. `edges` are the card's
 * margins from the screen's top and bottom (safe areas included). `keep` is
 * the end it's at now: while the page merely scrolls, it stays put for as
 * long as the target stays clear of it, rather than flapping at the midline.
 *
 * A target too big to clear from either end (a grid of covers) is lit only
 * where the card isn't, a gap short of it.
 */
export function placeDock(
  hole: Hole | null,
  card: { h: number },
  vp: Viewport,
  edges: { top: number; bottom: number },
  keep: Dock | null = null,
): DockPlacement {
  if (!hole || hole.w === 0) return { y: Math.round((vp.h - card.h) / 2), dock: null, hole: null, pointer: null };

  const topY = edges.top;
  const bottomY = vp.h - edges.bottom - card.h;
  const room = (d: Dock, h: Hole) => (d === "top" ? h.y - (topY + card.h) : bottomY - (h.y + h.h));
  const docked = (d: Dock, h: Hole): DockPlacement => {
    const x = clamp(h.x + h.w / 2, MARGIN + CORNER / 2, vp.w - MARGIN - CORNER / 2);
    const pointer =
      d === "top"
        ? { x, from: topY + card.h + POINTER_OFF_CARD, to: h.y - POINTER_OFF_RING }
        : { x, from: bottomY - POINTER_OFF_CARD, to: h.y + h.h + POINTER_OFF_RING };
    return { y: d === "top" ? topY : bottomY, dock: d, hole: h, pointer: Math.abs(pointer.to - pointer.from) >= 8 ? pointer : null };
  };

  const byHalf: Dock = hole.y + hole.h / 2 > vp.h / 2 ? "top" : "bottom";
  const other: Dock = byHalf === "top" ? "bottom" : "top";
  const order: Dock[] = keep && room(keep, hole) >= DOCK_GAP ? [keep] : [byHalf, other];
  for (const d of order) if (room(d, hole) >= DOCK_GAP) return docked(d, hole);

  // Too big to clear: light it down to a gap above the card, or failing that, up from below it.
  const belowEnd = bottomY - DOCK_GAP; // card at the foot: light down to here
  const aboveStart = topY + card.h + DOCK_GAP; // card at the top: light from here
  const litBottom = Math.min(hole.y + hole.h, belowEnd) - hole.y;
  const litTop = hole.y + hole.h - Math.max(hole.y, aboveStart);
  if (Math.max(litBottom, litTop) >= MIN_LIT) {
    // Its top is where its heading is: keep that in the light when there's enough of it.
    if (litBottom >= MIN_LIT) return docked("bottom", { ...hole, h: litBottom, r: Math.min(hole.r, litBottom / 2) });
    const y = Math.max(hole.y, aboveStart);
    return docked("top", { ...hole, y, h: litTop, r: Math.min(hole.r, litTop / 2) });
  }
  // Nothing sensible to light around it: keep the card clear of its middle at least.
  return { ...docked(byHalf, hole), pointer: null };
}

/* ---- A lone tip ------------------------------------------------------ */

export interface TipPlacement {
  x: number;
  y: number;
  /** Where the bubble is: "above" the target (arrow on its foot), "below" (arrow on its top), or "over" a target too big to clear (no arrow). */
  at: "above" | "below" | "over";
  /** The arrow's tip, along the bubble's edge, from its left. */
  along: number;
}

/** Target edge to bubble edge; the arrow sits in this gap. */
export const TIP_GAP = 10;
/** The closest the bubble comes to the screen's edges (and the app's bars). */
export const TIP_MARGIN = 12;
/** The arrow keeps clear of the bubble's rounded corners. */
const TIP_CORNER = 16;

/**
 * A lone tip beside its target: above or below it, whichever has room (the
 * side it's on now, while that still fits, so scrolling doesn't flip it),
 * slid along to stay inside the screen and clear of the app's bars, with its
 * arrow at the target's middle. A target too tall to clear either way gets
 * the bubble over its top, pointing nowhere.
 */
export function placeTip(
  target: Box,
  bubble: { w: number; h: number },
  vp: Viewport,
  bars: { top: number; bottom: number },
  keep: TipPlacement["at"] | null = null,
): TipPlacement {
  const lo = bars.top + TIP_MARGIN;
  const hi = vp.h - bars.bottom - TIP_MARGIN;
  const need = bubble.h + TIP_GAP;
  const room = { above: target.y - lo, below: hi - (target.y + target.h) };
  const fits = (s: "above" | "below") => room[s] >= need;

  const cx = target.x + target.w / 2;
  const x = clamp(cx - bubble.w / 2, TIP_MARGIN, vp.w - TIP_MARGIN - bubble.w);
  const along = clamp(cx - x, TIP_CORNER, bubble.w - TIP_CORNER);

  let at: TipPlacement["at"];
  if ((keep === "above" || keep === "below") && fits(keep)) at = keep;
  else if (fits("below") && (room.below >= room.above || !fits("above"))) at = "below";
  else if (fits("above")) at = "above";
  else at = "over";

  if (at === "above") return { x, y: target.y - TIP_GAP - bubble.h, at, along };
  if (at === "below") return { x, y: target.y + target.h + TIP_GAP, at, along };
  const y = clamp(Math.max(target.y, lo) + TIP_GAP, lo, hi - bubble.h);
  return { x, y, at, along };
}
