"use client";

import { useEffect } from "react";

/**
 * The landing page's scroll motion, second pass (owner, 2026-09-27: the
 * first "animate on scroll" felt terrible; "a proper animate on scroll …
 * rich vibes and high tier feel"). Sections still only declare intent with
 * the same data attributes (`data-reveal`, `data-scrub`, `data-parallax`);
 * this runs one of three directions, styled in scroll-stage.css:
 *
 *   quiet   restraint: short, small, one-shot, and it starts the moment
 *           anything shows, so nothing ever sits hidden waiting.
 *   scroll  tied to the scroll: every reveal is a function of where it is
 *           on screen, so it follows your hand and rewinds when you go back.
 *   focus   cinematic: blur to sharp, and pictures open like a shutter.
 *   blend   quiet for the words, scroll for the pictures: type arrives
 *           once and settles, the big pictures move with your hand.
 *   stage   the one we run (owner, 2026-09-27: "go with D blend and
 *           inertia on and mix with C"): blend's split, with focus's blur
 *           to sharp on the words and its shutter on the pictures (tied to
 *           the scroll), inertia on, plus the card motion below.
 *
 * Two more things any section can declare, in every direction:
 *
 *   data-stage   a group of cards that take the stage one after another:
 *                each rises from below, tilted back and out of focus, and
 *                settles flat with a little overshoot.
 *   data-count   a number that counts up as it comes into view (keeps its
 *                $, commas, decimals and suffix; the attribute's value, if
 *                any, is a delay in ms).
 *
 * Inertia (a weighted glide on the wheel) is on unless `?inertia=0`. The
 * Motion Board switches the direction from the URL (`?motion=`); the page
 * runs `stage`.
 *
 * Nothing is hidden until this has mounted and put `lm2` on <html>, so
 * without JavaScript the page is simply at rest. With reduced motion, or
 * `?static`, none of it runs.
 */
type Direction = "quiet" | "scroll" | "focus" | "blend" | "stage";
const DIRECTIONS: Direction[] = ["quiet", "scroll", "focus", "blend", "stage"];
const DEFAULT: Direction = "stage";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Where an element sits on screen by layout alone, ignoring any transform on it or its ancestors. */
function layoutBox(el: HTMLElement) {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  const top = y - scrollY;
  return { top, bottom: top + el.offsetHeight };
}

export function ScrollStage() {
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const q = new URLSearchParams(location.search);
    if (q.has("static")) return;
    const asked = q.get("motion") as Direction | null;
    const direction: Direction = asked && DIRECTIONS.includes(asked) ? asked : DEFAULT;
    const root = document.documentElement;
    root.dataset.motion = direction;
    root.classList.add("lm2");
    // Which reveals follow the scroll rather than playing once.
    const split = direction === "blend" || direction === "stage";
    // Windows (the app screens) always follow the scroll.
    const scrubs = (el: Element) => {
      const kind = el.getAttribute("data-reveal") ?? "";
      return kind === "window" || direction === "scroll" || (split && (kind === "media" || kind === "zoom"));
    };

    // ---- one-shot reveals: in as soon as any of it shows ----
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.setAttribute("data-in", "");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -4% 0px", threshold: 0 },
    );
    const counts = numbers();
    const watch = (el: Element) => {
      if (el.hasAttribute("data-count")) counts.watch(el as HTMLElement);
      if (el.hasAttribute("data-stage") || (el.hasAttribute("data-reveal") && !scrubs(el))) io.observe(el);
    };
    document.querySelectorAll("[data-reveal], [data-stage], [data-count]").forEach(watch);

    // What moves every frame, listed once (and again when sections fill in
    // late) — never searched for inside the frame itself.
    let moving: { scrubbed: HTMLElement[]; scrub: HTMLElement[]; parallax: HTMLElement[] } = { scrubbed: [], scrub: [], parallax: [] };
    const list = () => {
      moving = {
        scrubbed: Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter(scrubs),
        scrub: Array.from(document.querySelectorAll<HTMLElement>("[data-scrub]")),
        parallax: Array.from(document.querySelectorAll<HTMLElement>("[data-parallax]")),
      };
    };
    list();

    // Sections that fill in after a fetch add their reveals late.
    const mo = new MutationObserver((records) => {
      let added = false;
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.matches("[data-reveal], [data-stage], [data-count]")) watch(n);
          n.querySelectorAll("[data-reveal], [data-stage], [data-count]").forEach(watch);
          added ||= n.matches("[data-reveal], [data-scrub], [data-parallax]") || Boolean(n.querySelector("[data-reveal], [data-scrub], [data-parallax]"));
        });
      if (added) {
        list();
        schedule();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Sections off screen hold their loops (pulses, blinks, marquees): an
    // infinite animation nobody can see still costs a paint every frame.
    const offscreen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.toggleAttribute("data-off", !e.isIntersecting);
      },
      { rootMargin: "25% 0px 25% 0px" },
    );
    document.querySelectorAll("main > *").forEach((el) => offscreen.observe(el));

    // ---- per-frame: scrubbed reveals, the scrubbed sections, parallax ----
    // Every measurement first, then every write: reading a box after a
    // write forces a fresh layout, and doing that per element made each
    // frame lay the whole page out dozens of times.
    let raf = 0;
    const writes: Array<[HTMLElement, string, string]> = [];
    const frame = () => {
      raf = 0;
      const vh = innerHeight;
      writes.length = 0;
      for (const el of moving.scrubbed) {
        // Measure where it sits in the flow, not where its own motion has
        // moved it (a window starts well off to one side).
        const kind = el.dataset.reveal;
        const r = kind === "window" ? layoutBox(el) : el.getBoundingClientRect();
        const top = r.top;
        if (top > vh * 1.5) continue;
        // Reveals run from entering at the bottom to a third of the way up;
        // pictures take longer, arriving as they reach the middle; windows
        // cover most of their way early and settle (cubic out). Anything
        // already above the screen (an anchor jump) is simply there.
        const span = kind === "window" ? vh * 0.8 : kind === "media" || kind === "zoom" ? vh * 0.75 : vh * 0.34;
        let p = r.bottom < 0 ? 1 : clamp01((vh - top) / span);
        if (kind === "window") p = 1 - Math.pow(1 - p, 3);
        writes.push([el, "--p", p.toFixed(4)]);
      }
      for (const el of moving.scrub) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        const p = el.dataset.scrub === "words" ? (vh * 0.85 - r.top) / (vh * 0.55) : (vh - r.top) / (vh * 0.7);
        writes.push([el, "--p", clamp01(p).toFixed(4)]);
      }
      for (const el of moving.parallax) {
        const r = el.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 2) continue;
        writes.push([el, "--pp", (r.top + r.height / 2 - vh / 2).toFixed(1)]);
      }
      // Unchanged values aren't written, so nothing restyles for nothing.
      for (const [el, prop, value] of writes) if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    frame();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);

    // ---- inertia: the wheel glides instead of stepping ----
    let stopInertia = () => {};
    if (q.get("inertia") !== "0" && matchMedia("(pointer: fine)").matches) stopInertia = inertia();

    return () => {
      io.disconnect();
      mo.disconnect();
      offscreen.disconnect();
      counts.stop();
      cancelAnimationFrame(raf);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      stopInertia();
      root.classList.remove("lm2");
      delete root.dataset.motion;
    };
  }, []);

  return null;
}

/**
 * A weighted wheel: each notch moves a target, and the page eases toward it
 * (about 0.1 of the gap a frame). Keys, the scrollbar, anchors and touch stay
 * native; a scroll we didn't make re-syncs the target. Horizontal swipes and
 * pinch-zoom are left alone.
 */
function inertia() {
  let target = scrollY;
  let current = scrollY;
  let raf = 0;
  let last = 0;
  let ours = false;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const step = (now: number) => {
    // A tenth of the gap per 60 Hz frame, measured in time: a slow or
    // dropped frame catches up instead of leaving the page trailing the hand.
    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;
    current += (target - current) * (1 - Math.pow(0.9, dt / 16.7));
    if (Math.abs(target - current) < 0.5) current = target;
    ours = true;
    scrollTo(0, current);
    raf = current === target ? 0 : requestAnimationFrame(step);
    if (!raf) last = 0;
  };
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * innerHeight : e.deltaY;
    target = Math.max(0, Math.min(max(), target + px));
    if (!raf) raf = requestAnimationFrame(step);
  };
  const onScroll = () => {
    if (ours) {
      ours = false;
      return;
    }
    // Someone else scrolled (keys, scrollbar, an anchor): follow them.
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    target = current = scrollY;
  };
  addEventListener("wheel", onWheel, { passive: false });
  addEventListener("scroll", onScroll, { passive: true });
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener("wheel", onWheel);
    removeEventListener("scroll", onScroll);
  };
}

/**
 * Count-ups. A number is set to zero just before it scrolls into view (so
 * nobody sees it jump), then climbs to its value on the page's ease once it's
 * a third in. Only the first run of digits in the element's text moves; the
 * rest ($, "pts", "s", "+", "%") stays put, and the element keeps its final
 * width while it counts so nothing beside it shifts.
 */
function numbers() {
  type Job = { node: Text; pre: string; post: string; to: number; dp: number; grouped: boolean; final: string };
  const jobs = new Map<Element, Job>();
  const rafs = new Set<number>();
  const format = (j: Job, v: number) => {
    const n = j.grouped ? v.toLocaleString("en-US", { minimumFractionDigits: j.dp, maximumFractionDigits: j.dp }) : v.toFixed(j.dp);
    return j.pre + n + j.post;
  };
  const parse = (el: Element): Job | null => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const node = walk.currentNode as Text;
      const m = node.data.match(/^([\s\S]*?)(\d[\d,]*(?:\.\d+)?)([\s\S]*)$/);
      if (!m) continue;
      const [, pre, num, post] = m;
      return { node, pre, post, to: parseFloat(num.replace(/,/g, "")), dp: (num.split(".")[1] ?? "").length, grouped: num.includes(","), final: node.data };
    }
    return null;
  };
  const arm = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        arm.unobserve(e.target);
        const j = parse(e.target);
        if (!j) continue;
        const el = e.target as HTMLElement;
        el.style.minWidth = `${el.getBoundingClientRect().width}px`;
        if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
        j.node.data = format(j, 0);
        jobs.set(el, j);
        run.observe(el);
      }
    },
    { rootMargin: "0px 0px 30% 0px" },
  );
  const run = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        run.unobserve(e.target);
        const j = jobs.get(e.target);
        if (!j) continue;
        const el = e.target as HTMLElement;
        const t0 = performance.now() + (Number(el.dataset.count) || 0);
        const ms = 1300;
        const tick = (now: number) => {
          const p = Math.min(1, Math.max(0, (now - t0) / ms));
          const v = j.to * (1 - Math.pow(1 - p, 5));
          j.node.data = p < 1 ? format(j, v) : j.final;
          if (p < 1) rafs.add(requestAnimationFrame(tick));
          else el.style.minWidth = "";
        };
        rafs.add(requestAnimationFrame(tick));
      }
    },
    { threshold: 0.35 },
  );
  return {
    watch: (el: HTMLElement) => arm.observe(el),
    stop() {
      arm.disconnect();
      run.disconnect();
      rafs.forEach((r) => cancelAnimationFrame(r));
      // Anything mid-count goes back to its real value.
      jobs.forEach((j) => (j.node.data = j.final));
    },
  };
}
