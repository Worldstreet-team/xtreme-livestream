"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import s from "./xtream-loader.module.css";

const MARK = "Xtream";
/** The wordmark's depth on arrival, as the landing's "Everyone's going live on Xtream" draws it. */
const DEPTH = 10;
const EXTRUDED = Array.from({ length: DEPTH }, (_, i) => `${(-0.0045 * (i + 1)).toFixed(4)}em ${(0.013 * (i + 1)).toFixed(4)}em 0 #b30e1f`).join(", ");
const FLAT = Array.from({ length: DEPTH }, () => "0 0 0 transparent").join(", ");
const STANDARD = "cubic-bezier(0.2, 0, 0, 1)";
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
/** How long each line of the caption stays. */
const LINE_MS = 1700;

/**
 * Xtream's loading moment (owner, 2026-09-29): the landing's wordmark swings
 * in extruded and flattens, heat rings go out from it for as long as the
 * wait lasts, and a wave runs through the letters now and then so it never
 * looks stuck. Lines of `messages` take turns beneath it.
 *
 * `page` fills its container (a whole screen); `inline` is a compact mark
 * for a panel. Reduced motion gets the flat wordmark and the words, still.
 */
export function XtreamLoader({
  messages = [],
  size = "page",
  label = "Loading",
  className,
}: {
  messages?: string[];
  size?: "page" | "inline";
  /** For screen readers when there are no messages. */
  label?: string;
  className?: string;
}) {
  const mark = useRef<HTMLSpanElement>(null);
  const [line, setLine] = useState(0);

  useEffect(() => {
    const el = mark.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const letters = [...el.children] as HTMLElement[];
    const anims: Animation[] = [];
    letters.forEach((l, i) => {
      const t = i / (letters.length - 1);
      const from = `translateY(${(Math.sin(i * 0.9) * 0.18).toFixed(3)}em) rotateX(55deg) rotateY(${-35 + t * 55}deg) rotateZ(${(Math.sin(i * 1.3) * 6).toFixed(2)}deg) scale(1.25)`;
      anims.push(l.animate([{ transform: from, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 120 + i * 45, easing: OUT, fill: "both" }));
      anims.push(l.animate([{ textShadow: EXTRUDED }, { textShadow: EXTRUDED, offset: 0.2 }, { textShadow: FLAT }], { duration: 820, delay: 120 + i * 45, easing: STANDARD, fill: "both" }));
    });
    // Then, while it waits, a wave through the letters every few seconds.
    const wave = window.setTimeout(() => {
      letters.forEach((l, i) => {
        anims.push(
          l.animate(
            // The lift takes the first quarter; the rest of the cycle is the pause between waves.
            [
              { transform: "none" },
              { transform: "translateY(-0.07em)", offset: 0.09 },
              { transform: "none", offset: 0.25 },
              { transform: "none" },
            ],
            { duration: 3600, delay: i * 70, easing: "linear", iterations: Infinity },
          ),
        );
      });
    }, 1300);
    return () => {
      clearTimeout(wave);
      anims.forEach((a) => a.cancel());
    };
  }, []);

  useEffect(() => {
    if (messages.length < 2) return;
    const t = window.setInterval(() => setLine((n) => (n + 1) % messages.length), LINE_MS);
    return () => clearInterval(t);
  }, [messages.length]);

  const words = messages.length ? messages[line % messages.length] : null;
  return (
    <div className={cn(s.loader, size === "inline" ? s.inline : s.page, className)} role="status" aria-live="polite">
      <span className={s.markWrap}>
        <svg aria-hidden className={s.rings} viewBox="0 0 100 100">
          <defs>
            <linearGradient id="xtream-loader-heat" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff2b45" />
              <stop offset="0.52" stopColor="#f85810" />
              <stop offset="1" stopColor="#f8a008" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx="50" cy="50" r={16 + i * 8} style={{ "--i": i } as CSSProperties} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <span ref={mark} aria-hidden className={s.mark}>
          {[...MARK].map((c, i) => (
            <span key={i} className={s.letter}>
              {c}
            </span>
          ))}
        </span>
      </span>
      {words ? (
        <p className={s.words} key={line}>
          {words}
        </p>
      ) : (
        <span className="sr-only">{label}</span>
      )}
    </div>
  );
}
