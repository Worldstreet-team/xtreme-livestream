"use client";

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * An entrance that waits to be seen: "idle" until the element is at least
 * `threshold` on screen, then "go", once. Put the value on the element as
 * `data-play` and let CSS run the entrance from it (unfold.module.css,
 * art/podium.module.css).
 *
 * It goes at once when there's nothing to wait for — less motion wanted,
 * a hidden tab (frames don't run there), or no observer. `ready` lets a
 * section that renders nothing until its data arrives start observing then.
 */
export function usePlayOnView<T extends Element>(ready = true, threshold = 0.3) {
  const ref = useRef<T>(null);
  const [play, setPlay] = useState<"idle" | "go">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    if (prefersReducedMotion() || document.hidden || typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setPlay("go"), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPlay("go");
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ready, threshold]);
  return [ref, play] as const;
}
