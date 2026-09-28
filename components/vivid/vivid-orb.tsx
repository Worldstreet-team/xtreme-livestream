"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";

/**
 * The Vivid orb: the dot sphere from vividai.worldstreetgold.com, ported
 * from worldwork's `components/vivid-orb.tsx` so Vivid wears the same body
 * on every WorldStreet site. It is Vivid's sign everywhere in Xtream now
 * (owner, 2026-09-26), replacing the heat "silk" orb: heat stays for rings,
 * Go live and gifts. Fibonacci spacing over the shell (no seam, no
 * crowded pole), a physical turn about an axis that slowly leans, two sines
 * of per-dot drift, a radial breath, perspective with depth shading, and
 * glow sprites drawn additively. Every so often a wave of hue travels round
 * the ball and drains back to white: the connect shimmer, unhurried.
 *
 * In a session it wakes: the hue holds while Vivid is live, the turn
 * hurries, and the voice level swells the ball.
 *
 * Xtream is dark-only, so only the dark skin came along. Reduced motion
 * gets one still sphere rather than nothing.
 */
const DOT_R = 1.5; // css px at z = 0, at the 320px reference size
const CAM = 1.9; // perspective distance, in box heights
const DEPTH_SHADE = 0.42;

/** Deterministic layout: the same ball every mount. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0xffff) / 0x10000;
  };
}

function makeSprite(core: string, edge: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const S = 32;
  c.width = c.height = S;
  const s = c.getContext("2d")!;
  const g = s.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, core);
  g.addColorStop(0.62, core);
  g.addColorStop(1, edge);
  s.fillStyle = g;
  s.fillRect(0, 0, S, S);
  return c;
}

/** The colour wheel, pre-stamped: one sprite per 15° of hue (deeper on paper, so it reads). */
function hueRing(lightness = 62): HTMLCanvasElement[] {
  const out: HTMLCanvasElement[] = [];
  for (let h = 0; h < 360; h += 15) out.push(makeSprite(`hsla(${h},100%,${lightness}%,1)`, `hsla(${h},100%,${lightness}%,0)`));
  return out;
}

/**
 * Fills whatever box it's given. The measurement is stepped to 16px before
 * it may rebuild the shell, so a resize doesn't re-seed thousands of dots
 * every frame. Small orbs (under 96px) track their box exactly and keep a
 * floor of dots, drawn larger, so a 32px orb in a button still reads.
 */
export function VividOrb({
  minSize = 24,
  live = false,
  getAudioLevels,
  onColor,
  className,
}: {
  minSize?: number;
  /** A session is running: the hue holds and the turn hurries. */
  live?: boolean;
  /** Vivid's voice (and the mic): read every frame, drives the swell. */
  getAudioLevels?: () => Uint8Array;
  /**
   * Called every frame with the eased colour level (0 = white rest, 1 = full
   * hue) so something outside the canvas can ride the same wave. It fires at
   * frame rate: write to the DOM, don't lift it into React state.
   */
  onColor?: (k: number) => void;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Light or dark where the orb actually sits: a room (the studio, a player)
  // stays dark in light mode, so read the nearest themed ancestor, not <html>.
  const appTheme = useTheme();
  const onPaperRef = useRef(false);
  useEffect(() => {
    const el = canvasRef.current;
    const host = el?.closest<HTMLElement>("[data-theme]");
    onPaperRef.current = (host?.dataset.theme ?? appTheme) === "light";
  }, [appTheme]);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(minSize);
  const onColorRef = useRef(onColor);
  const liveRef = useRef(live);
  const levelsRef = useRef(getAudioLevels);
  useEffect(() => {
    onColorRef.current = onColor;
    liveRef.current = live;
    levelsRef.current = getAudioLevels;
  }, [onColor, live, getAudioLevels]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      const edge = Math.min(entry.contentRect.width, entry.contentRect.height);
      const stepped = Math.max(minSize, edge < 96 ? Math.round(edge) : Math.round(edge / 16) * 16);
      setSize((current) => (current === stepped ? current : stepped));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [minSize]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // A 320px orb lands around 1400 dots, a 700px one at the cap; a small
    // one keeps enough dots to read as a sphere, drawn a little larger.
    const N = Math.max(220, Math.min(4200, Math.round(size * 4.4)));
    const dotScale = Math.max(size / 320, 0.34);
    const R = 0.4 * size;
    const cx = size / 2;
    const cy = size / 2;
    const cam = CAM * size;
    const zref = R * 1.09;

    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pz = new Float32Array(N);
    const pb = new Float32Array(N);
    const w1 = new Float32Array(N * 3);
    const w2 = new Float32Array(N * 3);
    const ph1 = new Float32Array(N * 3);
    const ph2 = new Float32Array(N * 3);

    const rand = rng(9);
    const GOLD = Math.PI * (1 + Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const k = i + 0.5;
      const phi = Math.acos(1 - (2 * k) / N);
      const theta = GOLD * k;
      const jitter = 0.94 + rand() * 0.12;
      const sinp = Math.sin(phi);
      px[i] = R * jitter * sinp * Math.cos(theta);
      py[i] = R * jitter * Math.cos(phi);
      pz[i] = R * jitter * sinp * Math.sin(theta);
      pb[i] = 0.5 + rand() * 0.34;
    }
    for (let i = 0; i < N * 3; i++) {
      w1[i] = (0.25 + rand() * 0.35) * Math.PI;
      w2[i] = (0.7 + rand() * 0.6) * Math.PI;
      ph1[i] = rand() * Math.PI * 2;
      ph2[i] = rand() * Math.PI * 2;
    }

    // Light, added together on a dark ground; ink, laid over, on paper
    // (additive white vanishes on a light page).
    const sprite = makeSprite("rgba(255,255,255,1)", "rgba(255,255,255,0)");
    const ink = makeSprite("rgba(27,20,22,1)", "rgba(27,20,22,0)");
    const hues = hueRing();
    const huesOnPaper = hueRing(46);
    const driftAmp = size / 320;
    let colorK = 0;
    let level = 0;
    // Average of the analyser bins, 0..1, eased so the swell doesn't flicker.
    const readLevel = () => {
      const bins = liveRef.current ? levelsRef.current?.() : undefined;
      let want = 0;
      if (bins && bins.length) {
        let sum = 0;
        for (let i = 0; i < bins.length; i++) sum += bins[i];
        want = Math.min(1, (sum / bins.length / 255) * 2.2);
      }
      level += (want - level) * (want > level ? 0.35 : 0.08);
      return level;
    };

    // A long white rest, a swell of hue, a slower drain back.
    const COLOR_PERIOD = 15;
    const COLOR_RISE = 2.2;
    const COLOR_HOLD = 2.4;
    const COLOR_FALL = 3.6;
    const colorAt = (t: number) => {
      const p = ((t % COLOR_PERIOD) + COLOR_PERIOD) % COLOR_PERIOD;
      if (p < COLOR_RISE) return p / COLOR_RISE;
      if (p < COLOR_RISE + COLOR_HOLD) return 1;
      const d = p - COLOR_RISE - COLOR_HOLD;
      return d < COLOR_FALL ? 1 - d / COLOR_FALL : 0;
    };

    let lastT = 0;
    const drawAt = (t: number) => {
      // The turn is physical: the dots orbit a tilted axis that slowly leans.
      const dtF = Math.min(0.05, Math.max(0, t - lastT));
      lastT = t;
      const tiltNow = 0.42 + 0.28 * Math.sin(t * 0.13);
      const cosTl = Math.cos(tiltNow);
      const sinTl = Math.sin(tiltNow);
      const lv = readLevel();
      const dA = dtF * (liveRef.current ? 0.5 + lv * 0.9 : 0.22);
      const caD = Math.cos(dA);
      const saD = Math.sin(dA);
      for (let i = 0; i < N; i++) {
        const rx = px[i];
        const ry = py[i];
        const rz = pz[i];
        const v1 = ry * cosTl - rz * sinTl;
        let v2 = ry * sinTl + rz * cosTl;
        const nx1 = rx * caD + v2 * saD;
        v2 = -rx * saD + v2 * caD;
        px[i] = nx1;
        py[i] = v1 * cosTl + v2 * sinTl;
        pz[i] = -v1 * sinTl + v2 * cosTl;
      }

      const breath = 1 + 0.022 * Math.sin(t * 1.15) + lv * 0.09;
      const wantColor = liveRef.current ? 1 : colorAt(t);
      colorK += (wantColor - colorK) * (wantColor > colorK ? 0.05 : 0.014);
      onColorRef.current?.(colorK);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const paper = onPaperRef.current;
      ctx.globalCompositeOperation = paper ? "source-over" : "lighter";
      const dot = paper ? ink : sprite;
      const ring = paper ? huesOnPaper : hues;
      // Ink dots stack darker than light ones add up: a touch less of each.
      const inkK = paper ? 0.78 : 1;

      for (let i = 0; i < N; i++) {
        const a = i * 3;
        const dx = (Math.sin(w1[a] * t + ph1[a]) + 0.6 * Math.sin(w2[a] * t + ph2[a])) * 0.625;
        const dy = (Math.sin(w1[a + 1] * t + ph1[a + 1]) + 0.6 * Math.sin(w2[a + 1] * t + ph2[a + 1])) * 0.625;
        const dz = (Math.sin(w1[a + 2] * t + ph1[a + 2]) + 0.6 * Math.sin(w2[a + 2] * t + ph2[a + 2])) * 0.625;

        const x = (px[i] + dx * driftAmp) * breath;
        const y = (py[i] + dy * driftAmp) * breath;
        const z = (pz[i] + dz * driftAmp) * breath;

        const zc = Math.min(z, 0.8 * cam);
        const persp = cam / (cam - zc);
        const znorm = Math.max(-1, Math.min(1, z / zref));
        const shade = 1 + znorm * DEPTH_SHADE * (znorm > 0 ? 0.35 : 1);
        const av = pb[i] * shade;
        if (av <= 0.004) continue;
        const r = DOT_R * persp * dotScale;

        if (colorK > 0.01) {
          // The hue is a wave read from where each dot is, travelling round.
          ctx.globalAlpha = Math.min(1, av * inkK * (1 - colorK * 0.7));
          ctx.drawImage(dot, cx + x - r, cy + y - r, r * 2, r * 2);
          const huePos = (((Math.atan2(z, x) / 6.2832 + t * 0.4) % 1) + 1) % 1;
          ctx.globalAlpha = Math.min(1, av * colorK);
          ctx.drawImage(ring[(huePos * ring.length) | 0], cx + x - r, cy + y - r, r * 2, r * 2);
        } else {
          ctx.globalAlpha = Math.min(1, av * inkK);
          ctx.drawImage(dot, cx + x - r, cy + y - r, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      drawAt(0);
      return;
    }

    // Off-screen orbs don't need to spin: pause the loop while hidden.
    let raf = 0;
    let running = false;
    const loop = (now: number) => {
      drawAt(now / 1000);
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!entry.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(canvas);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // A theme change repaints (and, with reduced motion, redraws the one still frame).
  }, [size, appTheme]);

  return (
    <div ref={boxRef} className={`grid size-full place-items-center ${className ?? ""}`}>
      <canvas ref={canvasRef} aria-hidden="true" style={{ width: size, height: size }} className="select-none" />
    </div>
  );
}
