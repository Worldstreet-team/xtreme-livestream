"use client";

import { useEffect, useRef } from "react";

/**
 * Behind a battle's chat on a phone: the live picture itself — both sides,
 * as they sit in the band above — blurred and darkened until it's felt
 * more than seen, with a soft fall-off into the band. The chat reads on
 * it; the room's colour carries down the screen.
 *
 * Cheap on purpose: a few times a second the band's pictures are drawn into
 * a 48 × 32 canvas, and the browser stretches that (which is most of the
 * blur) under a small CSS blur. No second decode, no full-size filter.
 */
const W = 48;
const H = 32;
const EVERY_MS = 350;

export function ChatBackdrop({ root, className }: { root: () => HTMLElement | null; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d", { alpha: false });
    if (!c || !ctx) return;
    ctx.fillStyle = "#0b0708";
    ctx.fillRect(0, 0, W, H);
    let timer: ReturnType<typeof setTimeout> | null = null;

    const draw = () => {
      timer = null;
      const scope = root();
      // The band: the stage grid the watch page places with --band-top/--band-h.
      const band = scope?.querySelector<HTMLElement>('[style*="band-top"]');
      if (band && document.visibilityState === "visible") {
        const b = band.getBoundingClientRect();
        if (b.width > 0 && b.height > 0) {
          // The feeds' pictures: videos, and stills where a feed shows one (away, stalled).
          for (const el of band.querySelectorAll<HTMLVideoElement | HTMLImageElement>("video, img")) {
            const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 && el.videoWidth > 0 : el.complete && el.naturalWidth > 0;
            if (!ready) continue;
            const r = el.getBoundingClientRect();
            const x = ((r.left - b.left) / b.width) * W;
            const y = ((r.top - b.top) / b.height) * H;
            const w = (r.width / b.width) * W;
            const h = (r.height / b.height) * H;
            try {
              ctx.drawImage(el, x, y, w, h);
            } catch {
              // A cross-origin or not-yet-ready frame: keep the last one.
            }
          }
        }
      }
      timer = setTimeout(draw, EVERY_MS);
    };
    draw();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [root]);

  return (
    <div aria-hidden className={className}>
      <canvas
        ref={canvas}
        width={W}
        height={H}
        // Stretched well past the edges so the blur has no rim, and turned
        // upside down so its top is the band's bottom: the picture seems to
        // run on down the screen, like a reflection.
        className="absolute -inset-[12%] h-[124%] w-[124%] scale-y-[-1] [filter:blur(18px)_saturate(1.25)]"
      />
      {/* Dark enough that the picture is almost gone, but not quite. */}
      <div className="absolute inset-0 bg-[#0b0708]/[0.7]" />
      {/* The fall-off: black at the band's edge, fading into the room. */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0b0708] to-transparent" />
    </div>
  );
}
