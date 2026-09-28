"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { GoLiveLink } from "@/components/app/go-live-link";
import { PillLink } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import styles from "./everyone.module.css";

const WORDS = ["Everyone’s", "going", "live", "on"];
const MARK = "Xtream";

/** The wordmark's depth on arrival: 14 stacked shadows in chili-lo that collapse flat. */
const DEPTH = 14;
const EXTRUDED = Array.from({ length: DEPTH }, (_, i) => `${(-0.0045 * (i + 1)).toFixed(4)}em ${(0.013 * (i + 1)).toFixed(4)}em 0 #b30e1f`).join(", ");
const FLAT = Array.from({ length: DEPTH }, () => "0 0 0 transparent").join(", ");
const STANDARD = "cubic-bezier(0.2, 0, 0, 1)";
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * "Everyone's going live on Xtream", played like a film the first time it
 * comes into view (sketch 03 in the Motion Design Ideas notebook, on the
 * WorldSpace timing): the line builds a word at a time and re-centres, then
 * the wordmark swings in extruded and flattens. As it lands, the wall of
 * live rooms behind it blooms from grey into colour, heat rings go out from
 * the name, and the call to action rises beneath it. (Restored as it was,
 * owner 2026-09-28.)
 *
 * The call to action steers the film: hovering Go live leans the wall in and
 * keeps the rings going, and hovering Watch runs the rooms past faster. The
 * wall drifts against the pointer. Anyone who asked for less motion gets the
 * last frame, with the wall's poster and nothing moving.
 */
export function ChapterEveryone({ align: alignProp = "left" }: { align?: "left" | "center" }) {
  const root = useRef<HTMLElement>(null);
  // In development the Motion Board can preview the other layout with ?everyone=center|left.
  const [align, setAlign] = useState(alignProp);
  const line = useRef<HTMLSpanElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [played, setPlayed] = useState(false);
  const [lit, setLit] = useState(false);
  const [hover, setHover] = useState<"go" | "watch" | null>(null);

  // Arm, wait for the section to be half in view, then play the film once.
  useEffect(() => {
    const el = root.current;
    // Reduced motion: stay un-armed, which is the film's last frame at rest.
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const anims: Animation[] = [];
    const timers: number[] = [];
    const arming = requestAnimationFrame(() => {
      const asked = process.env.NODE_ENV === "development" ? new URLSearchParams(location.search).get("everyone") : null;
      if (asked === "left" || asked === "center") setAlign(asked);
      setArmed(true);
    });
    const play = () => {
      const lineEl = line.current!, markEl = mark.current!;
      const words = [...lineEl.children] as HTMLElement[];
      const letters = [...markEl.children] as HTMLElement[];
      // Centred, keep the words that are showing centred as the line grows;
      // on the gutter they simply append.
      const centred = el.dataset.align === "center";
      const x0 = words[0].offsetLeft;
      const full = words[words.length - 1].offsetLeft + words[words.length - 1].offsetWidth - x0;
      const shift = (k: number) => (centred ? (full - (words[k].offsetLeft + words[k].offsetWidth - x0)) / 2 : 0);
      lineEl.style.transform = `translateX(${shift(0)}px)`;
      words.forEach((w, k) => {
        anims.push(w.animate([{ opacity: 0, transform: "translateY(0.3em)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 280, delay: k * 340, easing: OUT, fill: "both" }));
        if (k > 0) {
          anims.push(lineEl.animate([{ transform: `translateX(${shift(k - 1)}px)` }, { transform: `translateX(${shift(k)}px)` }], { duration: 320, delay: k * 340, easing: STANDARD, fill: "forwards" }));
        }
      });
      // The wordmark swings in on a wave, extruded, and settles flat.
      letters.forEach((l, i) => {
        const t = i / (letters.length - 1);
        const from = `translateY(${(Math.sin(i * 0.9) * 0.18).toFixed(3)}em) rotateX(55deg) rotateY(${-35 + t * 55}deg) rotateZ(${(Math.sin(i * 1.3) * 6).toFixed(2)}deg) scale(1.25)`;
        anims.push(l.animate([{ transform: from, opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: "none", opacity: 1 }], { duration: 700, delay: 1450 + i * 35, easing: OUT, fill: "both" }));
        anims.push(l.animate([{ textShadow: EXTRUDED }, { textShadow: EXTRUDED, offset: 0.2 }, { textShadow: FLAT }], { duration: 820, delay: 1450 + i * 35, easing: STANDARD, fill: "both" }));
      });
      timers.push(window.setTimeout(() => setLit(true), 2250));
      timers.push(
        window.setTimeout(() => {
          setPlayed(true);
          lineEl.style.transform = "";
          anims.forEach((a) => a.cancel());
        }, 2700),
      );
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        play();
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(arming);
      io.disconnect();
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
    };
  }, []);

  // The wall only runs while it can be seen, and never for reduced motion.
  useEffect(() => {
    const el = root.current, v = video.current;
    if (!el || !v || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) v.play().catch(() => {});
      else v.pause();
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Hovering Watch runs the rooms past faster.
  useEffect(() => {
    if (video.current) video.current.playbackRate = hover === "watch" ? 2.2 : 1;
  }, [hover]);

  // The wall drifts against a fine pointer; the words drift a little with it.
  const frame = useRef(0);
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse" || !root.current) return;
    const r = root.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * 2 - 1, py = ((e.clientY - r.top) / r.height) * 2 - 1;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      root.current?.style.setProperty("--px", px.toFixed(3));
      root.current?.style.setProperty("--py", py.toFixed(3));
    });
  };

  const steer = (what: "go" | "watch") => ({
    onPointerEnter: () => setHover(what),
    onPointerLeave: () => setHover(null),
    onFocus: () => setHover(what),
    onBlur: () => setHover(null),
  });

  return (
    <section
      ref={root}
      id="everyone"
      aria-labelledby="everyone-title"
      data-hover={hover ?? undefined}
      data-align={align}
      onPointerMove={onPointerMove}
      className={cn(styles.section, armed && styles.armed, played && styles.played, lit && styles.lit)}
    >
      <div aria-hidden className={styles.wall}>
        <video ref={video} muted loop playsInline preload="metadata" poster="/landing/everyone-wall.jpg">
          <source src="/landing/everyone-wall.mp4" type="video/mp4" />
        </video>
      </div>
      <div aria-hidden className={styles.scrim} />

      <div className={styles.inner}>
        <h2 id="everyone-title" className={styles.title}>
          <span className="sr-only">Everyone&apos;s going live on Xtream</span>
          <span ref={line} aria-hidden className={styles.line}>
            {WORDS.map((w) => (
              <span key={w} className={styles.word}>
                {w}
              </span>
            ))}
          </span>
          <span className={styles.markWrap}>
            <svg aria-hidden className={styles.rings} viewBox="0 0 100 100">
              <defs>
                <linearGradient id="everyone-heat" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ff2b45" />
                  <stop offset="0.52" stopColor="#f85810" />
                  <stop offset="1" stopColor="#f8a008" />
                </linearGradient>
              </defs>
              {[0, 1, 2, 3, 4].map((i) => (
                <circle key={i} cx="50" cy="50" r={14 + i * 7} style={{ "--i": i } as CSSProperties} vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <span ref={mark} aria-hidden className={styles.mark}>
              {[...MARK].map((c, i) => (
                <span key={i} className={styles.letter}>
                  {c}
                </span>
              ))}
            </span>
          </span>
        </h2>
        <div className={styles.cta}>
          <span className="inline-flex" {...steer("go")}>
            <GoLiveLink className="h-[52px] w-auto px-7 text-[16px]" />
          </span>
          <span className="inline-flex" {...steer("watch")}>
            <PillLink href="/explore" variant="glass" size="xl" className="bg-white/[0.12] hover:bg-white/[0.18]">
              Watch who&apos;s live
            </PillLink>
          </span>
        </div>
        <p className={styles.note}>
          <i aria-hidden />
          Every kind of room, live right now
        </p>
      </div>
    </section>
  );
}
