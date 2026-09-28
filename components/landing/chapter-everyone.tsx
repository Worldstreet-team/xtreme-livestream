"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { GoLiveLink } from "@/components/app/go-live-link";
import { PillLink } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import styles from "./everyone.module.css";

const WORDS = ["Everyone’s", "going", "live", "on"];
const MARK = "Xtream";

/**
 * "Everyone's going live on Xtream" over a wall of live rooms, with the call
 * to action beneath it. It shows at rest: its scroll-in reveal is off for now
 * (owner, 2026-09-27), until the page's scroll motion is redone.
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
  const video = useRef<HTMLVideoElement>(null);
  const [lit, setLit] = useState(false);
  const [armed, setArmed] = useState(false);
  const [played, setPlayed] = useState(false);
  const [hover, setHover] = useState<"go" | "watch" | null>(null);

  // The film (sketch 03, restored and made cheaper, owner 2026-09-28): once
  // the section is properly on screen — over half of it, not merely near —
  // the words build one after another, "Xtream" swings in letter by letter
  // with depth, then the wall blooms and the calls to action rise. Every
  // move is transform and opacity on the compositor (Web Animations), so it
  // costs no layout; it plays once. Without script or with reduced motion
  // the section is simply at rest, lit.
  useEffect(() => {
    const asked = process.env.NODE_ENV === "development" ? new URLSearchParams(location.search).get("everyone") : null;
    const el = root.current;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("static");
    const frame = requestAnimationFrame(() => {
      if (asked === "left" || asked === "center") setAlign(asked);
      if (still || !el) {
        setPlayed(true);
        setLit(true);
        return;
      }
      setArmed(true);
    });
    if (still || !el) return () => cancelAnimationFrame(frame);

    let timer = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        const ease = "cubic-bezier(0.16, 1, 0.3, 1)";
        el.querySelectorAll<HTMLElement>("[data-film='word']").forEach((w, i) =>
          w.animate(
            [
              { opacity: 0, transform: "translate3d(0, 0.45em, 0)" },
              { opacity: 1, transform: "none" },
            ],
            { duration: 700, delay: i * 120, easing: ease, fill: "backwards" },
          ),
        );
        const start = 520;
        el.querySelectorAll<HTMLElement>("[data-film='letter']").forEach((l, i) =>
          l.animate(
            [
              { opacity: 0, transform: "translate3d(0, 0.28em, 0) rotateX(-78deg)" },
              { opacity: 1, offset: 0.35 },
              { opacity: 1, transform: "none" },
            ],
            { duration: 950, delay: start + i * 45, easing: ease, fill: "backwards" },
          ),
        );
        setPlayed(true);
        // The name has landed: the wall blooms and the calls to action rise.
        timer = window.setTimeout(() => setLit(true), start + 5 * 45 + 620);
      },
      { threshold: 0.55 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      clearTimeout(timer);
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
          <span aria-hidden className={styles.line}>
            {WORDS.map((w) => (
              <span key={w} data-film="word" className={styles.word}>
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
            <span aria-hidden className={styles.mark}>
              {[...MARK].map((c, i) => (
                <span key={i} data-film="letter" className={styles.letter}>
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
