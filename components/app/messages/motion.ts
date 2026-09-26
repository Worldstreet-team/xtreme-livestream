"use client";

/**
 * Messages in motion — the choreography the owner picked (2026-09-26),
 * one small kit so every moment moves on the same curves:
 *
 *   out     settling in: things arriving, the thread making room
 *   spring  your own action landing: "Sent", a reaction, a badge
 *   glide   travel between places: a face into a header, a photo from its tile
 *   in      leaving: exits are quicker than entrances, and never stagger
 *
 * Theirs never overshoots unless the pick says so; heat stays on the call
 * ring. With reduced motion every move here is a cut: play() does nothing
 * and the caller is already showing the end state.
 *
 * Components hand each other a moment through handOff()/receive(): the
 * composer knows where your words were, the thread knows where they land.
 */

export const EASE = {
  out: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  std: "cubic-bezier(0.2, 0, 0, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  glide: "cubic-bezier(0.22, 1, 0.36, 1)",
  in: "cubic-bezier(0.4, 0, 1, 1)",
  io: "cubic-bezier(0.45, 0, 0.55, 1)",
} as const;

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * One animation on one element, or nothing under reduced motion. The first
 * frame holds through any delay; afterwards the element is back on its own
 * styles, so the last frame should match them.
 */
export function play(
  el: Element | null | undefined,
  frames: Keyframe[],
  ms: number,
  ease: string = EASE.out,
  delay = 0,
  extra?: KeyframeAnimationOptions,
): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== "function" || reducedMotion()) return null;
  return (el as HTMLElement).animate(frames, { duration: ms, delay, easing: ease, fill: "backwards", ...extra });
}

/** Resolves when it ends or is cancelled (null resolves at once). */
export function done(a: Animation | null | undefined): Promise<void> {
  return a ? a.finished.then(
    () => undefined,
    () => undefined,
  ) : Promise.resolve();
}

/** Keyframes along an arc: a parabola lifted `lift` px at its middle, scaling s0 → s1. */
export function arc(dx: number, dy: number, lift: number, s0 = 1, s1 = 1, n = 16): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = dy * t - lift * 4 * t * (1 - t);
    frames.push({ offset: t, transform: `translate(${dx * t}px, ${y}px) scale(${s0 + (s1 - s0) * t})` });
  }
  return frames;
}

/** Where `el` sits inside `within` — scroll-proof, since both move together. */
export function offsetIn(el: Element, within: Element): { x: number; y: number; w: number; h: number } {
  const a = el.getBoundingClientRect();
  const b = within.getBoundingClientRect();
  return { x: a.left - b.left, y: a.top - b.top, w: a.width, h: a.height };
}

/** Stop whatever is moving `el`, so it can be measured where it really is. */
export function settle(el: Element | null | undefined) {
  el?.getAnimations?.().forEach((a) => a.cancel());
}

/* ---------------- FLIP: things keep their place while the list changes ---------------- */

export type Snapshot = Map<string, DOMRect>;

/** Where each keyed element is right now (viewport boxes). */
export function snapshot(els: Iterable<HTMLElement>, keyOf: (el: HTMLElement) => string | null | undefined): Snapshot {
  const out: Snapshot = new Map();
  for (const el of els) {
    const k = keyOf(el);
    if (k) out.set(k, el.getBoundingClientRect());
  }
  return out;
}

/** Slide every element that moved from where it was to where it is. */
export function flip(before: Snapshot, els: Iterable<HTMLElement>, keyOf: (el: HTMLElement) => string | null | undefined, ms: number, ease: string = EASE.out, delay = 0) {
  const moves: Animation[] = [];
  for (const el of els) {
    const k = keyOf(el);
    const b = k ? before.get(k) : undefined;
    if (!b) continue;
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) + Math.abs(dy) < 0.5) continue;
    const anim = play(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], ms, ease, delay);
    if (anim) moves.push(anim);
  }
  return moves;
}

/* ---------------- Ghosts: a copy that travels while the real one changes ---------------- */

const TEXT_STYLE = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "color", "textAlign", "whiteSpace", "wordBreak", "overflowWrap"] as const;

/**
 * A copy of `el` floating over everything at exactly its place, dressed in
 * its computed text styles (a clone would otherwise inherit the page's).
 * Remove it when the move is over.
 */
export function ghost(el: HTMLElement, box: { left: number; top: number; width: number; height: number } = el.getBoundingClientRect()): HTMLElement {
  const g = el.cloneNode(true) as HTMLElement;
  g.removeAttribute("id");
  g.querySelectorAll("[id]").forEach((n) => n.removeAttribute("id"));
  const cs = getComputedStyle(el);
  for (const p of TEXT_STYLE) g.style[p] = cs[p];
  Object.assign(g.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: "0",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: "90",
    transformOrigin: "0 0",
    contain: "layout paint",
  });
  g.setAttribute("aria-hidden", "true");
  g.inert = true;
  document.body.appendChild(g);
  // New to the page, a copy would replay its entrances; it travels as it looked.
  g.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  return g;
}

/* ---------------- Hand-offs between components ---------------- */

const handoffs = new Map<string, { value: unknown; at: number }>();

/** Leave a moment for whoever draws the next frame (the composer → the thread). */
export function handOff<T>(key: string, value: T) {
  handoffs.set(key, { value, at: performance.now() });
}

/** Pick it up once, if it's still fresh; stale moments are dropped, never played late. */
export function receive<T>(key: string, maxAgeMs = 1200): T | null {
  const h = handoffs.get(key);
  if (!h) return null;
  handoffs.delete(key);
  return performance.now() - h.at <= maxAgeMs ? (h.value as T) : null;
}

/** Look without taking. */
export function peek<T>(key: string, maxAgeMs = 1200): T | null {
  const h = handoffs.get(key);
  return h && performance.now() - h.at <= maxAgeMs ? (h.value as T) : null;
}

/** A box as plain numbers, so it survives being handed on. */
export function boxOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
export type Box = ReturnType<typeof boxOf>;
