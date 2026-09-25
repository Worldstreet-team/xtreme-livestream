"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Particle {
  x: number;
  y: number;
  /** Where the particle settles when the prompt is assembled. */
  tx: number;
  ty: number;
  r: number;
  rgb: string;
  a: number;
  /** 0 = scattered, 1 = settled. Only the entrance uses it. */
  t: number;
}

/**
 * WorldSpace's vanishing placeholder, brought over so the two apps' inputs
 * speak the same way (owner, 2026-09-24: "the vanishing animation the one
 * on worldspace has"). Each prompt assembles from particles sweeping left
 * to right, holds a beat, then dissolves right to left into the next. Sits
 * absolutely over its field; render it only while the field is empty.
 *
 * Adapted from the socials' components/ui/VanishingPlaceholder.tsx: the ink
 * and the font are read off the canvas's own computed style, so giving it
 * the input's type classes (font, size, weight, tracking) makes the prompt
 * line up with what the person will type. Reduced motion just swaps prompts.
 */
export function VanishingPlaceholder({ texts, className, holdMs = 2600 }: { texts: string[]; className?: string; holdMs?: number }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Paint `text` and sample it into particles; `paint: false` leaves the canvas blank. */
  const draw = useCallback((text: string, paint = true) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx) return;
    const dpr = 2;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cs = getComputedStyle(canvas);
    ctx.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * dpr}px ${cs.fontFamily}`;
    const spacing = parseFloat(cs.letterSpacing);
    if ("letterSpacing" in ctx && Number.isFinite(spacing)) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${spacing * dpr}px`;
    ctx.fillStyle = cs.color;
    // The ink is translucent, so "part of a glyph" is judged against its own alpha.
    ctx.fillRect(0, 0, 1, 1);
    const inkAlpha = ctx.getImageData(0, 0, 1, 1).data[3] ?? 255;
    ctx.clearRect(0, 0, 1, 1);
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, canvas.height / 2);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const particles: Particle[] = [];
    // Every second pixel: dense enough, a quarter of the work.
    for (let y = 0; y < canvas.height; y += 2) {
      for (let x = 0; x < canvas.width; x += 2) {
        const i = (y * canvas.width + x) * 4;
        const alpha = data[i + 3] ?? 0;
        if (alpha > inkAlpha / 2) {
          particles.push({ x, y, tx: x, ty: y, r: 1.2, rgb: `${data[i]},${data[i + 1]},${data[i + 2]}`, a: alpha / 255, t: 0 });
        }
      }
    }
    particlesRef.current = particles;
    if (!paint) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  /** The entrance: a sweep runs left to right, easing each particle onto its pixel. */
  const assemble = useCallback((onDone: () => void) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || particlesRef.current.length === 0) {
      onDone();
      return;
    }
    // Scatter a fresh set around the targets; the sampled set stays as drawn.
    const spread = 26;
    const parts = particlesRef.current.map((p) => ({ ...p, t: 0, x: p.tx + (Math.random() - 0.5) * spread, y: p.ty + (Math.random() - 0.5) * spread }));
    const maxX = parts.reduce((m, p) => Math.max(m, p.tx), 0);
    const stride = canvas.width / 45;
    const step = (pos: number) => {
      rafRef.current = requestAnimationFrame(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        let pending = 0;
        for (const p of parts) {
          if (p.tx <= pos && p.t < 1) p.t = Math.min(1, p.t + 0.16);
          if (p.t < 1) pending++;
          if (p.t <= 0) continue;
          const e = 1 - (1 - p.t) * (1 - p.t);
          ctx.fillStyle = `rgba(${p.rgb},${p.a * e})`;
          ctx.fillRect(p.x + (p.tx - p.x) * e, p.y + (p.ty - p.y) * e, p.r * (0.4 + 0.6 * e), p.r * (0.4 + 0.6 * e));
        }
        if (pending > 0 || pos < maxX) step(pos + stride);
        else onDone();
      });
    };
    step(0);
  }, []);

  /** The exit: right to left, each particle jitters and shrinks away. */
  const dissolve = useCallback((onDone: () => void) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || particlesRef.current.length === 0) {
      onDone();
      return;
    }
    const maxX = particlesRef.current.reduce((m, p) => Math.max(m, p.x), 0);
    const step = (pos: number) => {
      rafRef.current = requestAnimationFrame(() => {
        const kept: Particle[] = [];
        for (const p of particlesRef.current) {
          if (p.x < pos) {
            kept.push(p);
            continue;
          }
          p.x += Math.random() > 0.5 ? 1.4 : -1.4;
          p.y += Math.random() > 0.5 ? 1.4 : -1.4;
          p.r -= 0.055 * Math.random();
          if (p.r > 0) kept.push(p);
        }
        particlesRef.current = kept;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const p of kept) {
          ctx.fillStyle = `rgba(${p.rgb},${p.a})`;
          ctx.fillRect(p.x, p.y, p.r, p.r);
        }
        if (kept.length > 0) step(pos - canvas.width / 45);
        else onDone();
      });
    };
    step(maxX);
  }, []);

  useEffect(() => {
    if (!visible || texts.length === 0) return;
    const text = texts[index % texts.length] ?? "";
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        draw(text);
        timerRef.current = setTimeout(() => setIndex((i) => (i + 1) % texts.length), holdMs);
        return;
      }
      // assemble in → hold → dissolve out → next prompt
      draw(text, false);
      assemble(() => {
        // Land on the real glyphs — the particle grid alone reads a touch thin.
        draw(text);
        timerRef.current = setTimeout(() => dissolve(() => setIndex((i) => (i + 1) % texts.length)), holdMs);
      });
    };
    // Sampled glyphs in a fallback face would be the wrong shape; wait for the real one.
    if (document.fonts && document.fonts.status !== "loaded") void document.fonts.ready.then(run);
    else run();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [index, visible, texts, holdMs, draw, dissolve, assemble]);

  // No invisible canvas work while the tab is hidden.
  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return <canvas ref={canvasRef} aria-hidden className={cn("pointer-events-none absolute inset-0 h-full w-full", className)} />;
}
