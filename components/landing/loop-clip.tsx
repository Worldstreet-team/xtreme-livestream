"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A short, seamless product loop for a landing card (public/landing/loops,
 * rendered from the Motion Design Ideas notebook at 2x the card's size).
 * Muted and looping. By default it plays while it's on screen; with
 * `play="hover"` it rests on its first frame (the card at rest) and plays
 * while the pointer is over its card (the nearest `[data-hover-play]`),
 * rewinding when the pointer leaves. Screens without hover (phones) fall back
 * to playing while on screen. Anyone who asked for less motion sees the
 * first frame.
 *
 *   <LoopClip name="get-paid" label="A gift lands in the wallet: the balance rolls up and the gift joins the history." />
 */
export function LoopClip({
  name,
  label,
  play = "view",
  className,
}: {
  name: "get-paid" | "wolf-race" | (string & {});
  label: string;
  play?: "view" | "hover";
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = () => void v.play().catch(() => {});

    if (play === "hover" && matchMedia("(hover: hover)").matches) {
      const root = (v.closest("[data-hover-play]") as HTMLElement | null) ?? v;
      const stop = () => {
        v.pause();
        v.currentTime = 0;
      };
      root.addEventListener("pointerenter", start);
      root.addEventListener("pointerleave", stop);
      root.addEventListener("focusin", start);
      root.addEventListener("focusout", stop);
      return () => {
        root.removeEventListener("pointerenter", start);
        root.removeEventListener("pointerleave", stop);
        root.removeEventListener("focusin", start);
        root.removeEventListener("focusout", stop);
      };
    }

    const io = new IntersectionObserver(([e]) => (e?.isIntersecting ? start() : v.pause()), { threshold: 0.25 });
    io.observe(v);
    return () => io.disconnect();
  }, [play]);
  return (
    <video
      ref={ref}
      src={`/landing/loops/${name}.mp4`}
      poster={`/landing/loops/${name}.jpg`}
      muted
      loop
      playsInline
      preload={play === "hover" ? "auto" : "metadata"}
      role="img"
      aria-label={label}
      className={cn("block h-auto w-full", className)}
    />
  );
}
