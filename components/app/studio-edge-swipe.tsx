"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Broadcast } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { signInHref } from "@/lib/auth-urls";
import { usePhone } from "@/components/app/live-rings";

/**
 * Phones: swipe in from the left edge on Home, Browse or Messages and the
 * studio opens — Instagram's swipe-to-camera. A Chili Go live mark follows
 * your thumb in from the edge so you can see what the swipe will do, and
 * letting go short of the mark (or turning the swipe into a scroll) cancels
 * it. Signed out, it goes to sign in, then the studio.
 *
 * It only starts near the edge, and never in a field or inside something
 * that scrolls sideways (the rings, shelves, carousels) once it has been
 * scrolled along — at its start, a rightward swipe has nothing to move. iOS Safari keeps the
 * outermost strip for its own back swipe, so there the zone starts 24px in
 * rather than at the edge; installed to the home screen there is no back
 * swipe, and the zone runs from the edge.
 */

const ROUTES = ["/explore", "/browse", "/messages"];
/** How far the thumb travels before letting go opens the studio. */
const TRIGGER_PX = 80;
/** Mostly sideways: the vertical drift may be at most this share of the travel. */
const MAX_SLOPE = 0.6;
/** The mark's size, and how far it rides in with the thumb. */
const MARK = 44;

function edgeZone(): [number, number] {
  const ua = navigator.userAgent;
  const ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone ? [24, 44] : [0, 28];
}

/** A field, an open sheet or menu, or anything that scrolls sideways owns this touch. */
function claimedElsewhere(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [data-no-edge-swipe]")) return true;
  for (let el: Element | null = target; el && el !== document.body; el = el.parentElement) {
    // A scroller already at its start has nothing to do with a rightward
    // swipe — a shelf on Home only owns it once it has been scrolled along.
    if (el.scrollWidth > el.clientWidth + 1 && Math.abs(el.scrollLeft) > 1) {
      const x = getComputedStyle(el).overflowX;
      if (x === "auto" || x === "scroll") return true;
    }
  }
  return false;
}

export function StudioEdgeSwipe({ disabled = false }: { disabled?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const phone = usePhone();
  const { user, isLoading } = useAuth();
  const markRef = useRef<HTMLDivElement>(null);
  const on = phone && !disabled && !isLoading && ROUTES.includes(pathname);
  const signedIn = Boolean(user);

  useEffect(() => {
    if (!on) return;
    const [min, max] = edgeZone();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let start: { x: number; y: number; id: number } | null = null;
    let armed = false;

    const show = (dx: number) => {
      const mark = markRef.current;
      if (!mark) return;
      const p = Math.min(1, dx / TRIGGER_PX);
      if (still) {
        // No thumb-following: the mark is simply there once the swipe will count.
        mark.style.opacity = p >= 1 ? "1" : "0";
        mark.style.transform = `translate3d(12px, -50%, 0)`;
        return;
      }
      mark.style.opacity = String(Math.min(1, p * 1.4));
      mark.style.transform = `translate3d(${-MARK + Math.min(dx, TRIGGER_PX) * 0.7}px, -50%, 0) scale(${0.8 + p * 0.2})`;
    };
    const hide = () => {
      const mark = markRef.current;
      if (!mark) return;
      mark.style.opacity = "0";
      mark.style.transform = `translate3d(${-MARK}px, -50%, 0)`;
    };

    const onStart = (e: TouchEvent) => {
      start = null;
      armed = false;
      if (e.touches.length !== 1) return;
      const t = e.touches[0]!;
      if (t.clientX < min || t.clientX > max) return;
      if (claimedElsewhere(e.target)) return;
      start = { x: t.clientX, y: t.clientY, id: t.identifier };
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = [...e.touches].find((x) => x.identifier === start!.id);
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = Math.abs(t.clientY - start.y);
      // Turned into a scroll (or went back the other way): not ours.
      if (dy > 12 && dy > Math.abs(dx) * MAX_SLOPE) {
        start = null;
        armed = false;
        hide();
        return;
      }
      armed = dx >= TRIGGER_PX && dy <= dx * MAX_SLOPE;
      show(Math.max(0, dx));
    };
    const onEnd = () => {
      const go = armed;
      start = null;
      armed = false;
      hide();
      if (!go) return;
      const to = signedIn ? "/studio" : signInHref("/studio");
      if (to.startsWith("/")) router.push(to);
      else window.location.assign(to);
    };
    const onCancel = () => {
      start = null;
      armed = false;
      hide();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onCancel);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [on, signedIn, router]);

  if (!on) return null;
  return (
    <div
      ref={markRef}
      aria-hidden
      style={{ opacity: 0, transform: `translate3d(${-MARK}px, -50%, 0)`, width: MARK, height: MARK }}
      className="pointer-events-none fixed top-1/2 left-0 z-50 flex items-center justify-center rounded-full bg-chili text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.55)] md:hidden"
    >
      <Broadcast size={20} weight="fill" />
    </div>
  );
}
