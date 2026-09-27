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
  const [hover, setHover] = useState<"go" | "watch" | null>(null);

  // No scroll-in reveal for now (owner, 2026-09-27: "remove the entire
  // animate on scroll"): the section shows at rest, lit, so hover still works.
  // The reveal it had (appended words, then the wordmark swinging in on
  // the WorldSpace timing) is sketch 03 in the Motion Design Ideas notebook.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const asked = process.env.NODE_ENV === "development" ? new URLSearchParams(location.search).get("everyone") : null;
      if (asked === "left" || asked === "center") setAlign(asked);
      setLit(true);
    });
    return () => cancelAnimationFrame(frame);
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
      className={cn(styles.section, lit && styles.lit)}
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
            <span aria-hidden className={styles.mark}>
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
