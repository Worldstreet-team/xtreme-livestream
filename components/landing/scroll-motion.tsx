"use client";

import { useEffect } from "react";

/**
 * The landing page's motion, in one place. Sections only declare intent
 * with data attributes; this runs it:
 *
 *  - `data-reveal` (up · lines · media · stagger · zoom) is one-shot: an
 *    IntersectionObserver marks the element `data-in` as it enters, and
 *    motion.css does the rest with transitions.
 *  - `data-scrub` (words · expand) is tied to scroll: each frame writes the
 *    element's progress through the viewport to `--p`, 0 → 1.
 *  - `data-parallax="0.2"` writes `--pp`, the element's distance from the
 *    viewport's centre in px; motion.css multiplies it by the speed.
 *
 * Nothing is hidden until this has mounted and put `lm-ready` on <html>, so
 * without JavaScript the page is simply static. With reduced motion, or
 * `?static` in the URL, none of it runs and motion.css leaves everything in
 * its final state.
 */
function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function ScrollMotion() {
  useEffect(() => {
    // `?static` shows every section in its final state: for design imports,
    // screenshots and anyone who wants the page without the choreography.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (new URLSearchParams(window.location.search).has("static")) return;
    const root = document.documentElement;
    root.classList.add("lm-ready");

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-in", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    // Sections that fill in after a fetch (the Wolf board) add their
    // reveals late; watch for them so they don't stay hidden.
    const mo = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.matches("[data-reveal]")) io.observe(node);
          node.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    const scrubs = Array.from(document.querySelectorAll<HTMLElement>("[data-scrub]"));
    const parallax = Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]"));

    let raf = 0;
    const frame = () => {
      raf = 0;
      const vh = window.innerHeight;
      for (const el of scrubs) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        const kind = el.dataset.scrub;
        // Words fill as the block's top travels from 85% to 30% of the
        // screen; a picture expands over its first 70% of a screen.
        const p = kind === "words" ? (vh * 0.85 - r.top) / (vh * 0.55) : (vh - r.top) / (vh * 0.7);
        el.style.setProperty("--p", clamp01(p).toFixed(4));
      }
      for (const el of parallax) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        el.style.setProperty("--pp", (r.top + r.height / 2 - vh / 2).toFixed(1));
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    frame();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      io.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      root.classList.remove("lm-ready");
    };
  }, []);

  return null;
}
