"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * One creator's camera inside a landing mockup: a short, muted, looping
 * talk-to-camera clip (public/promo, 540×960) that fills its box and only
 * plays while it's on screen. Anyone who asked for less motion sees the
 * poster, its first frame. Decorative: the mockup around it carries the label.
 *
 *   <LiveFeed name="battle-host" />  →  /promo/battle-host.mp4 + -poster.jpg
 */
export function LiveFeed({ name, className }: { name: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.2 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      aria-hidden
      src={`/promo/${name}.mp4`}
      poster={`/promo/${name}-poster.jpg`}
      muted
      loop
      playsInline
      preload="metadata"
      className={cn("absolute inset-0 size-full object-cover", className)}
    />
  );
}
