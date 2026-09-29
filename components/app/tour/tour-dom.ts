import { useSyncExternalStore } from "react";
import type { Box, Viewport } from "@/lib/tour/geometry";

/**
 * The walkthrough's eyes on the page, shared by the host (tour-host.tsx),
 * the tour itself (tour-overlay.tsx) and the lone tips (tour-tip.tsx):
 * finding a step's target, reading its box, the app's own bars, and whether
 * the page is still loading or has something modal up.
 */

/** Targets smaller than this are measured with whatever pokes out of them (the tab bar's raised Go live). */
const SMALL = 120;

/* ---- Small stores --------------------------------------------------- */

function mediaStore(query: string) {
  return {
    subscribe(cb: () => void) {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    get: () => window.matchMedia(query).matches,
  };
}
const reducedStore = mediaStore("(prefers-reduced-motion: reduce)");
const phoneStore = mediaStore("(max-width: 767px)");

export function useReducedMotion() {
  return useSyncExternalStore(reducedStore.subscribe, reducedStore.get, () => false);
}
export function usePhoneLayout() {
  return useSyncExternalStore(phoneStore.subscribe, phoneStore.get, () => false);
}
/** The same test, outside React: the phone layout is screens under 768px. */
export function isPhoneLayout(): boolean {
  return typeof window !== "undefined" && phoneStore.get();
}

/* ---- Targets ---------------------------------------------------------- */

export const viewport = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight });

/**
 * The first element named `data-tour=<name>` that's rendered to be seen —
 * anywhere on the page, even below the fold (the tour scrolls to it).
 * Hidden, inert or zero-size copies don't count.
 */
export function findTarget(names: string[]): HTMLElement | null {
  for (const name of names) {
    const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
    for (const el of all) {
      if (el.closest("[data-tour-root]")) continue;
      if (el.closest("[aria-hidden='true'], [inert]")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      return el;
    }
  }
  return null;
}

/** Still there to be pointed at: in the page, with a size, not hidden. */
export function stillThere(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.closest("[aria-hidden='true'], [inert]")) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/** Inside something position: fixed (the tab bar, a floating button): it never scrolls, so it's never scrolled to. */
export function pinned(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).position === "fixed") return true;
  }
  return false;
}

/** Part of the app's own chrome (a top bar, the tab bar, a floating button): fixed or sticky, so always on screen. */
export function inBar(el: HTMLElement): boolean {
  for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === "fixed" || pos === "sticky") return true;
  }
  return false;
}

export interface Bars {
  top: number;
  bottom: number;
}

/**
 * How much of the screen the app's own bars hold at its top and foot (the
 * top bar, the tab bar): whatever fixed or sticky thing is uppermost at the
 * very edge. Scrolling a target into view keeps it out from under them.
 */
export function barInsets(vp: Viewport): Bars {
  const at = (y: number): DOMRect | null => {
    for (const el of document.elementsFromPoint(vp.w / 2, y)) {
      if (!(el instanceof HTMLElement) || el.closest("[data-tour-root]")) continue;
      for (let n: HTMLElement | null = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === "fixed" || pos === "sticky") return n.getBoundingClientRect();
      }
      return null;
    }
    return null;
  };
  const top = at(1);
  const foot = at(vp.h - 1);
  return {
    top: top && top.top <= 1 ? Math.min(Math.max(0, top.bottom), vp.h * 0.3) : 0,
    bottom: foot && foot.bottom >= vp.h - 1 ? Math.min(Math.max(0, vp.h - foot.top), vp.h * 0.3) : 0,
  };
}

/** An element's own corner, in px (a round one reads as half its short side). */
function radiusOf(el: HTMLElement, r: DOMRect): number {
  const raw = getComputedStyle(el).borderTopLeftRadius;
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const px = raw.trim().endsWith("%") ? (Math.min(r.width, r.height) * n) / 100 : n;
  return Math.min(px, Math.min(r.width, r.height) / 2);
}

/**
 * The target's box. A small one counts whatever pokes out of it, so the tab
 * bar's Go live is lit round its raised circle, not just its cell. Null when
 * it's gone, or scrolled right out of view.
 */
export function boxOf(el: HTMLElement | null, vp: Viewport): Box | null {
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  let { left, top, right, bottom } = r;
  if (r.width < SMALL && r.height < SMALL) {
    const kids = el.querySelectorAll<HTMLElement>("*");
    for (let i = 0; i < kids.length && i < 40; i++) {
      const k = kids[i].getBoundingClientRect();
      if (k.width < 1 || k.height < 1) continue;
      left = Math.min(left, k.left);
      top = Math.min(top, k.top);
      right = Math.max(right, k.right);
      bottom = Math.max(bottom, k.bottom);
    }
  }
  if (bottom < 0 || top > vp.h || right < 0 || left > vp.w) return null;
  // Its own corner, unless something poking out of it set the shape.
  const grown = left < r.left - 0.5 || top < r.top - 0.5 || right > r.right + 0.5 || bottom > r.bottom + 0.5;
  return { x: left, y: top, w: right - left, h: bottom - top, r: grown ? undefined : radiusOf(el, r) };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.75;
export function sameBox(a: Box, b: Box) {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h) && a.r === b.r;
}

/**
 * How much of a box is on screen, clear of the bars, from 0 to 1. A box
 * bigger than the room it could have (a grid of covers) counts as fully
 * seen once it fills that room.
 */
export function visibleShare(box: Box | null, vp: Viewport, bars: Bars): number {
  if (!box || box.w <= 0 || box.h <= 0) return 0;
  const top = bars.top;
  const bottom = vp.h - bars.bottom;
  const h = Math.max(0, Math.min(box.y + box.h, bottom) - Math.max(box.y, top));
  const w = Math.max(0, Math.min(box.x + box.w, vp.w) - Math.max(box.x, 0));
  const needH = Math.min(box.h, Math.max(1, bottom - top));
  const needW = Math.min(box.w, vp.w);
  return Math.min(1, h / needH) * Math.min(1, w / needW);
}

/* ---- The page -------------------------------------------------------- */

/**
 * Something on screen is still loading: a skeleton, a spinner, a region
 * marked busy. Small pulsing things (a live dot) don't count.
 */
export function pageBusy(): boolean {
  const vp = viewport();
  const all = document.querySelectorAll<HTMLElement>('[aria-busy="true"], [data-loading="true"], .animate-pulse, .animate-spin');
  for (const el of all) {
    if (el.closest("[data-tour-root]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) continue;
    if (r.bottom <= 0 || r.top >= vp.h || r.right <= 0 || r.left >= vp.w) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    return true;
  }
  return false;
}

/** The page has finished loading: the document and its fonts are in, and no skeleton or spinner is showing. */
export function pageReady(): boolean {
  if (document.readyState !== "complete") return false;
  if (document.fonts && document.fonts.status !== "loaded") return false;
  return !pageBusy();
}

/** Something modal is already up: a dialog, a sheet, a menu, a listbox (the walkthrough's own don't count). */
export function somethingOpen(allow?: string): boolean {
  const open = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
  for (const el of open) {
    if (el.closest("[data-tour-root]")) continue;
    if (allow && (el.closest(`[data-tour="${allow}"]`) || el.querySelector(`[data-tour="${allow}"]`))) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return true;
  }
  return false;
}
