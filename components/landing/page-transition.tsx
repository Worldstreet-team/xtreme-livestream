"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { ADV, WORD_PATHS } from "./transition-outlines";
import {
  CSS_EXPO,
  DOT,
  EZ,
  N_IN,
  align,
  circle,
  clamp01,
  dotTransform,
  layout,
  lerpInto,
  parseColor,
  point,
  releaseAt,
  rgb,
  rng32,
  toPath,
  type Channel,
  type Ease,
  type Item,
  type Layout,
  type Outline,
  type Piece,
  type RGB,
  type Sample,
} from "./transition-engine";
import { SAMPLES } from "./transition-samples";
import "./page-transition.css";

/**
 * Which take plays on the landing, A to E (the transition lookbook,
 * 2026-09-28; the owner picked E, "Aperture"). A one-letter switch. Any take
 * can be previewed with `?transition=A` … `?transition=E`.
 */
export const LANDING_TRANSITION: Sample["id"] = "E";

/**
 * The ground under the word. "night" is the landing's own dark ground (the
 * landing is always dark: DARK_PAGES in lib/theme-script.ts); "paper" is the
 * light paper sample E was first shown on; "sample" gives each take its
 * lookbook ground (B and E paper, the rest night). Preview with
 * `?ground=paper` or `?ground=night`.
 */
export const TRANSITION_GROUND: GroundChoice = "night";
type GroundChoice = "night" | "paper" | "sample";

/*
 * The page transition: three dots bounce while the landing loads, turn into
 * "Xtream", a little scenery rises at the foot of the frame, and the frame
 * leaves in pieces (Camera.js-style, easeInOutExpo) to show the page, which
 * has been loading and rendering underneath the whole time.
 *
 *   first visit in a session   the whole sequence (about 4.5 s when the
 *                              page is already loaded; the dots keep
 *                              bouncing while it isn't, for at most 4 s)
 *   later visits               trimmed: the word is there from the first
 *                              paint and the frame opens at once (~0.9–1.2 s)
 *   reduced motion             the word, then a 0.3 s fade (CSS only)
 *   ?static                    nothing
 *   ?intro=full|trim|fade      forces a mode, for previews
 *
 * The gate script (below the overlay) decides before the first paint and
 * puts `data-xt-intro` on <html>; the CSS shows the overlay and bounces the
 * dots from that moment, before React has hydrated. The component then
 * picks the CSS bounce up at a landing and runs the morph (point-wise on a
 * rAF driver that runs only for the run), the scenery (Web Animations on
 * transform) and the exit (clones of the frame, cut with clip-path).
 */

const KEY = "xtream:intro";
const ATTR = "data-xt-intro";
/** The longest the dots wait for the page, from their first bounce. */
const READY_CAP = 4000;
/** If the component hasn't mounted by then (a script error), the gate takes the overlay away. */
const FAILSAFE = 8000;
/** The hold on the finished frame before it opens. */
const HOLD = 380;
/** Camera's timing × this is the lookbook's "Page" pace; the trimmed run goes a little quicker. */
const PACE = 0.5;
const PACE_TRIM = 0.35;

type Mode = "full" | "trim" | "fade";
type XtWindow = Window & { __xtIntroOn?: boolean; __xtIntroStats?: unknown };

const META = Object.fromEntries(Object.values(SAMPLES).map((s) => [s.id, { g: s.ground, x: s.xChili ? 1 : 0 }]));

/** Runs as the overlay is parsed, before the first paint: which take, which ground, which mode. */
const GATE = `(function(){try{var el=document.currentScript&&document.currentScript.previousElementSibling,d=document.documentElement,q=new URLSearchParams(location.search);if(!el||q.has("static"))return;var S=${JSON.stringify(META)},id=(q.get("transition")||"").toUpperCase();if(!S[id])id=${JSON.stringify(LANDING_TRANSITION)};var g=q.get("ground");if(g!=="night"&&g!=="paper")g=${JSON.stringify(TRANSITION_GROUND)};if(g==="sample")g=S[id].g;el.setAttribute("data-sample",id);el.setAttribute("data-ground",g);el.setAttribute("data-x",S[id].x?"chili":"ink");var m=q.get("intro");if(m==="off")return;if(m!=="full"&&m!=="trim"&&m!=="fade"){if(matchMedia("(prefers-reduced-motion: reduce)").matches)m="fade";else{var s=null;try{s=sessionStorage.getItem(${JSON.stringify(KEY)})}catch(e){}m=s?"trim":"full"}}d.setAttribute(${JSON.stringify(ATTR)},m);setTimeout(function(){if(!window.__xtIntroOn)d.removeAttribute(${JSON.stringify(ATTR)})},${FAILSAFE})}catch(e){}})();`;

const groundFor = (g: GroundChoice, id: Sample["id"]) => (g === "sample" ? SAMPLES[id].ground : g);
const defaultGround = groundFor(TRANSITION_GROUND, LANDING_TRANSITION);

/** Mounted once, at the top of the landing's <main>. */
export function PageTransition() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const mode = document.documentElement.getAttribute(ATTR) as Mode | null;
    if (!root || !mode) return;
    (window as XtWindow).__xtIntroOn = true;
    const run = new Run(root, mode);
    mounts++;
    return () => {
      mounts--;
      run.dispose();
      // A real unmount (not React's dev double-mount) must not leave the page locked.
      setTimeout(() => {
        if (mounts === 0) document.documentElement.removeAttribute(ATTR);
      }, 0);
    };
  }, []);

  return (
    <>
      <div
        ref={rootRef}
        className="xti"
        data-sample={LANDING_TRANSITION}
        data-ground={defaultGround}
        data-x={SAMPLES[LANDING_TRANSITION].xChili ? "chili" : "ink"}
        style={{ "--xi-adv": ADV } as CSSProperties}
        aria-hidden="true"
        suppressHydrationWarning
      >
        <Sprite />
        <div className="xti-tiles" />
        <div className="xti-ld">
          <div className="xti-ground" />
          <div className="xti-lay" />
          <div className="xti-lay" />
          <svg className="xti-word" />
          <svg className="xti-static" viewBox={`0 -690 ${ADV} 690`} preserveAspectRatio="none">
            {WORD_PATHS.map((d, i) => (
              <path key={i} d={d} className={i === 0 ? "xti-x" : undefined} />
            ))}
          </svg>
          <div className="xti-lay" />
          <div className="xti-dots">
            {[0, 1, 2].map((k) => (
              <span key={k} className="xti-dot" style={{ "--k": k } as CSSProperties}>
                <i />
              </span>
            ))}
          </div>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: GATE }} suppressHydrationWarning />
    </>
  );
}

let mounts = 0;

/* ======================================================================
   The run
   ====================================================================== */

const NS = "http://www.w3.org/2000/svg";

type Tween = { ch: Channel; t0: number; dur: number; target: Outline | RGB; ease: Ease; started: boolean; done: boolean; from?: ArrayLike<number>; to?: ArrayLike<number> };
type Part = { g: SVGGElement; path: SVGPathElement; o: Outline; i: Outline; col: RGB; tw: Tween[]; dirty: boolean; tr: string };
type Plan = {
  G: Layout;
  M: number;
  formed: number;
  S1: number;
  X0: number;
  X1: number;
  partsEnd: number;
  pieces: Piece[];
  items: (Item & { el: HTMLElement })[];
  group?: (st: number) => string | null;
};

class Run {
  root: HTMLElement;
  mode: Mode;
  sample: Sample;
  ld: HTMLElement;
  tilesEl: HTMLElement;
  layers: HTMLElement[];
  word: SVGSVGElement;
  wordG: SVGGElement | null = null;
  parts: Part[] = [];
  anims: Animation[] = [];
  timers: number[] = [];
  raf = 0;
  T0 = 0;
  plan: Plan | null = null;
  events: { t: number; fn: () => void }[] = [];
  building: { i: number; per: number } | null = null;
  swapped = false;
  lastGroup: string | null = null;
  frames: number[] = [];
  lastFrame = 0;
  disposed = false;
  finished = false;
  size: [number, number];
  offs: (() => void)[] = [];

  constructor(root: HTMLElement, mode: Mode) {
    this.root = root;
    this.mode = mode;
    const id = (root.dataset.sample ?? LANDING_TRANSITION) as Sample["id"];
    this.sample = SAMPLES[id] ?? SAMPLES[LANDING_TRANSITION];
    this.ld = root.querySelector(".xti-ld") as HTMLElement;
    this.tilesEl = root.querySelector(".xti-tiles") as HTMLElement;
    this.layers = Array.from(root.querySelectorAll<HTMLElement>(".xti-lay"));
    this.word = root.querySelector(".xti-word") as SVGSVGElement;
    this.size = [root.clientWidth, root.clientHeight];

    if (mode === "fade") {
      const fade = root.getAnimations().find((a) => (a as CSSAnimation).animationName === "xti-fade");
      if (!fade || fade.playState === "finished") this.finish();
      else fade.finished.then(() => this.finish(), () => {});
      return;
    }

    try {
      sessionStorage.setItem(KEY, "1");
    } catch {}
    this.lock();
    if (mode === "trim") this.startTrim();
    else void this.startFull();
  }

  /* ---------- scroll lock: overflow is hidden by the CSS; this stops wheel glides and touch ---------- */
  lock() {
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const keys = new Set([" ", "PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End"]);
    const onKey = (e: KeyboardEvent) => {
      if (keys.has(e.key)) e.preventDefault();
    };
    const onResize = () => {
      const [w, h] = this.size;
      if (Math.abs(this.root.clientWidth - w) > 2 || Math.abs(this.root.clientHeight - h) > 120) this.bail();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: false };
    addEventListener("wheel", block, opts);
    addEventListener("touchmove", block, opts);
    addEventListener("keydown", onKey, true);
    addEventListener("resize", onResize);
    this.offs.push(() => {
      removeEventListener("wheel", block, opts);
      removeEventListener("touchmove", block, opts);
      removeEventListener("keydown", onKey, true);
      removeEventListener("resize", onResize);
    });
  }

  /** The window changed shape mid-run: fade what's there and get out of the way. */
  bail() {
    if (this.finished || this.disposed) return;
    const a = this.root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease", fill: "forwards" });
    this.anims.push(a);
    a.finished.then(() => this.finish(), () => {});
  }

  /* ---------- the ready signal ---------- */

  /** Resolves (with the time) when the window has loaded, or the fonts and the hero's picture are ready, or at the cap. */
  ready(capAt: number) {
    return new Promise<number>((resolve) => {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        resolve(performance.now());
      };
      if (document.readyState === "complete") return go();
      addEventListener("load", go, { once: true });
      this.offs.push(() => removeEventListener("load", go));
      const poster = document.querySelector<HTMLImageElement>("#hero-title")?.closest("section")?.querySelector("img");
      const media = !poster || poster.complete ? Promise.resolve() : new Promise<void>((r) => (poster.addEventListener("load", () => r(), { once: true }), poster.addEventListener("error", () => r(), { once: true })));
      Promise.all([document.fonts?.ready, media]).then(go, go);
      this.timers.push(window.setTimeout(go, Math.max(0, capAt - performance.now())));
    });
  }

  /* ---------- full: dots → word → scenery → exit ---------- */

  async startFull() {
    const dot = this.root.querySelector<HTMLElement>(".xti-dot > i");
    const hop = dot?.getAnimations().find((a) => (a as CSSAnimation).animationName === "xti-hop");
    if (hop) {
      try {
        await hop.ready;
      } catch {}
    }
    if (this.disposed) return;
    this.T0 = hop && hop.startTime != null ? Number(hop.startTime) : performance.now();
    const readyAt = await this.ready(this.T0 + READY_CAP);
    if (this.disposed) return;
    const now = performance.now() - this.T0;
    const M = releaseAt(Math.max(readyAt - this.T0, now + 80, 1));
    this.build(M);
    // Start the driver a couple of frames before the dots land.
    this.timers.push(window.setTimeout(() => this.loopStart(), Math.max(0, this.T0 + M - 50 - performance.now())));
  }

  build(M: number) {
    const { root, sample } = this;
    const [W, H] = this.size;
    const G = layout(W, H);
    const cs = getComputedStyle(root);
    const ink = parseColor(cs.getPropertyValue("--xi-ink"), [246, 241, 238]);
    const chili = parseColor(cs.getPropertyValue("--xi-chili"), [227, 18, 42]);

    // The six letter parts, each an outer outline plus a counter (evenodd), starting as their dots.
    const svg = this.word;
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.style.visibility = "hidden";
    svg.replaceChildren();
    const wordG = document.createElementNS(NS, "g");
    svg.appendChild(wordG);
    this.wordG = wordG;
    this.parts = [];
    for (let j = 0; j < 6; j++) {
      const d = G.dots[sample.dotOf(j)];
      const g = document.createElementNS(NS, "g");
      const path = document.createElementNS(NS, "path");
      path.setAttribute("fill-rule", "evenodd");
      g.appendChild(path);
      wordG.appendChild(g);
      this.parts.push({ g, path, o: circle(d.cx, d.cy, d.r), i: point(d.cx, d.cy, N_IN), col: [ink[0], ink[1], ink[2]], tw: [], dirty: true, tr: "" });
    }
    const morph = sample.morph(G, M, ink, chili);
    for (const t of morph.tweens) this.parts[t.part].tw.push({ ch: t.ch, t0: t.t0, dur: t.dur, target: t.target, ease: t.ease, started: false, done: false });
    // Counters ride with their letters: until a letter's counter grows, it is a point at the counter's centre.
    this.parts.forEach((p, j) => {
      const L = G.letters[j];
      const first = p.tw.find((t) => t.ch === "o" && t.target === L.outer);
      if (L.inner && L.ic && first) p.tw.push({ ch: "i", t0: first.t0, dur: first.dur * 0.6, target: point(L.ic[0], L.ic[1], N_IN), ease: EZ.morph, started: false, done: false });
      p.tw.sort((a, b) => a.t0 - b.t0);
      this.paint(p);
    });
    const partsEnd = Math.max(...this.parts.flatMap((p) => p.tw.map((t) => t.t0 + t.dur)));

    // Scenery: Web Animations on transform (and opacity to fade a piece in), on the document clock.
    const S0 = M + sample.sceneryLead;
    let S1 = S0;
    const items = sample.scenery(G, rng32(0x51ce + sample.id.charCodeAt(0) * 977)).map((it) => {
      const el = this.itemEl(it);
      this.wa(el, it.kf, S0 + it.delay, it.dur);
      if (it.fade) this.wa(el, [{ opacity: 0 }, { opacity: it.op ?? 1, offset: it.fade }, { opacity: it.op ?? 1 }], S0 + it.delay, it.dur);
      S1 = Math.max(S1, S0 + it.delay + it.dur);
      if (it.lit) {
        const lit = el.querySelector(".xti-lit") as HTMLElement;
        this.wa(lit, [{ opacity: 0 }, { opacity: 0.9, offset: 0.25 }, { opacity: 0.25, offset: 0.42 }, { opacity: 1, offset: 0.6 }, { opacity: 0.7, offset: 0.75 }, { opacity: 1 }], S0 + it.lit.at, 380);
        S1 = Math.max(S1, S0 + it.lit.at + 380);
      }
      return Object.assign(it, { el });
    });

    const X0 = Math.max(morph.formed, S1) + HOLD;
    const pieces = sample.pieces(G, PACE);
    const X1 = X0 + Math.max(...pieces.map((p) => p.delay + p.dur));
    this.plan = { G, M, formed: morph.formed, S1, X0, X1, partsEnd, pieces, items, group: morph.group };
    this.schedule(X0, X1, X0 - 300);
  }

  /* ---------- trimmed: the resting word, then straight to the exit ---------- */

  startTrim() {
    this.T0 = performance.now();
    const [W, H] = this.size;
    const G = layout(W, H);
    // The word has been on screen since the first paint; give it a beat if we got here very early.
    const X0 = Math.max(120, 450 - this.T0);
    const pieces = this.sample.pieces(G, PACE_TRIM);
    const X1 = X0 + Math.max(...pieces.map((p) => p.delay + p.dur));
    this.plan = { G, M: 0, formed: 0, S1: 0, X0, X1, partsEnd: -1, pieces, items: [] };
    this.swapped = true;
    this.schedule(X0, X1, 0);
    this.loopStart();
  }

  schedule(X0: number, X1: number, prepareAt: number) {
    this.events = [
      { t: prepareAt, fn: () => this.prepareTiles() },
      { t: X0, fn: () => this.open() },
      { t: X1 + 40, fn: () => this.finish() },
    ].sort((a, b) => a.t - b.t);
  }

  /* ---------- the driver ---------- */

  loopStart() {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  loop = (now: number) => {
    this.raf = 0;
    const plan = this.plan;
    if (this.disposed || this.finished || !plan) return;
    if (this.lastFrame) this.frames.push(now - this.lastFrame);
    this.lastFrame = now;
    const st = now - this.T0;
    while (this.events.length && this.events[0].t <= st) this.events.shift()!.fn();
    if (this.finished) return;
    if (this.building) this.buildSomeTiles();

    if (this.mode === "full") {
      // Hand over from the CSS dots at the landing.
      if (!this.swapped && st >= plan.M) {
        this.swapped = true;
        this.word.style.visibility = "";
        this.root.dataset.phase = "morph";
      }
      if (this.swapped) {
        if (st < plan.M + DOT.SQ + 60) {
          this.parts.forEach((p, j) => {
            const k = this.sample.dotOf(j);
            const tr = dotTransform(plan.G.dots[k], k, st, plan.M);
            if (tr !== p.tr) {
              p.tr = tr;
              if (tr) p.g.setAttribute("transform", tr);
              else p.g.removeAttribute("transform");
            }
          });
        }
        if (plan.group && this.wordG) {
          const g = plan.group(st);
          if (g !== null && g !== this.lastGroup) {
            this.lastGroup = g;
            if (g) this.wordG.setAttribute("transform", g);
            else this.wordG.removeAttribute("transform");
          }
        }
        if (st <= plan.partsEnd + 50) this.tick(st);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  tick(st: number) {
    for (const p of this.parts) {
      for (let n = 0; n < p.tw.length; n++) {
        const t = p.tw[n];
        if (t.done || st < t.t0) continue;
        if (!t.started) {
          t.started = true;
          for (let m = 0; m < n; m++) if (p.tw[m].ch === t.ch) p.tw[m].done = true; // hand over
          if (t.ch === "o") {
            t.from = p.o.slice();
            t.to = align(p.o, t.target as Outline);
          } else if (t.ch === "i") {
            t.from = p.i.slice();
            t.to = t.target;
          } else {
            t.from = p.col.slice();
            t.to = t.target;
          }
        }
        const k = clamp01((st - t.t0) / t.dur),
          e = t.ease(k);
        const from = t.from!,
          to = t.to!;
        if (t.ch === "c") {
          const c = clamp01(e);
          for (let q = 0; q < 3; q++) p.col[q] = from[q] + (to[q] - from[q]) * c;
        } else lerpInto(t.ch === "o" ? p.o : p.i, from, to, e);
        p.dirty = true;
        if (k >= 1) t.done = true;
      }
      if (p.dirty) this.paint(p);
    }
  }

  paint(p: Part) {
    p.path.setAttribute("d", toPath(p.o) + toPath(p.i));
    p.path.style.fill = rgb(p.col);
    p.dirty = false;
  }

  /** One Web Animation, started at run time `start` (ms) on the document clock. */
  wa(el: Element, kf: Keyframe[], start: number, duration: number, easing = "linear") {
    const a = el.animate(kf, { duration: Math.max(1, duration), easing, fill: "both" });
    a.startTime = this.T0 + start;
    this.anims.push(a);
    return a;
  }

  itemEl(it: Item) {
    const el = document.createElement("div");
    el.className = "xti-it";
    el.innerHTML =
      it.html ??
      '<svg viewBox="' +
        it.vb +
        '"><use href="#' +
        it.sym +
        '"/></svg>' +
        (it.lit ? '<div class="xti-lit"><svg viewBox="' + it.lit.vb + '"><use href="#' + it.lit.sym + '"/></svg></div>' : "");
    const st = el.style;
    st.width = it.w.toFixed(1) + "px";
    st.height = it.h.toFixed(1) + "px";
    if (it.op != null) st.opacity = String(it.op);
    if (it.origin) st.transformOrigin = it.origin;
    st.transform = String(it.kf[0].transform);
    for (const [k, v] of Object.entries(it.vars ?? {})) st.setProperty(k, v);
    this.layers[it.depth].appendChild(el);
    return el;
  }

  /* ---------- the exit ---------- */

  /** Freeze the scenery at its end so each clone matches the live frame, then start cloning a few per frame. */
  prepareTiles() {
    const plan = this.plan!;
    for (const it of plan.items) {
      it.el.style.transform = String(it.kf[it.kf.length - 1].transform);
      if (it.fade) it.el.style.opacity = String(it.op ?? 1);
      const lit = it.lit ? (it.el.querySelector(".xti-lit") as HTMLElement) : null;
      if (lit) lit.style.opacity = "1";
      for (const a of it.el.getAnimations({ subtree: true })) a.cancel();
    }
    this.building = { i: 0, per: Math.ceil(plan.pieces.length / 12) };
  }

  buildSomeTiles(all = false) {
    const b = this.building,
      plan = this.plan;
    if (!b || !plan) return;
    const { pieces, G } = plan;
    const end = all ? pieces.length : Math.min(pieces.length, b.i + b.per);
    for (; b.i < end; b.i++) {
      const pc = pieces[b.i];
      const tile = document.createElement("div");
      tile.className = "xti-tile";
      const r = pc.rect,
        st = tile.style;
      st.left = r.x + "px";
      st.top = r.y + "px";
      st.width = r.w + "px";
      st.height = r.h + "px";
      if (pc.clip) st.clipPath = pc.clip;
      if (pc.origin) st.transformOrigin = pc.origin;
      const tin = document.createElement("div");
      tin.className = "xti-tin";
      tin.style.left = -r.x + "px";
      tin.style.top = -r.y + "px";
      tin.style.width = G.W + "px";
      tin.style.height = G.H + "px";
      const clone = this.ld.cloneNode(true) as HTMLElement;
      clone.style.visibility = "";
      tin.appendChild(clone);
      tile.appendChild(tin);
      this.tilesEl.appendChild(tile);
      this.wa(tile, pc.kf, plan.X0 + pc.delay, pc.dur, CSS_EXPO);
    }
    if (b.i >= pieces.length) {
      this.building = null;
      this.tilesEl.style.visibility = "visible";
    }
  }

  /** The pieces take over from the live frame. */
  open() {
    if (this.building) this.buildSomeTiles(true);
    this.ld.style.visibility = "hidden";
  }

  /* ---------- the end ---------- */

  finish() {
    if (this.finished) return;
    this.finished = true;
    document.documentElement.removeAttribute(ATTR);
    if (process.env.NODE_ENV !== "production" && this.plan) {
      const f = this.frames.slice(3).sort((a, b) => a - b);
      const q = (x: number) => f[Math.min(f.length - 1, Math.floor(x * f.length))];
      const { M, formed, S1, X0, X1 } = this.plan;
      (window as XtWindow).__xtIntroStats = {
        sample: this.sample.id,
        mode: this.mode,
        T0: this.T0,
        marks: { M, formed, S1, X0, X1 },
        frames: f.length,
        p50: q(0.5),
        p95: q(0.95),
        max: f[f.length - 1],
        over20: f.filter((v) => v > 20).length,
        deltas: this.frames,
      };
    }
    this.cleanup();
  }

  cleanup() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const off of this.offs) off();
    this.offs = [];
    for (const a of this.anims) a.cancel();
    this.anims = [];
    this.tilesEl.replaceChildren();
    this.tilesEl.style.visibility = "";
    for (const l of this.layers) l.replaceChildren();
    this.word.replaceChildren();
    this.word.style.visibility = "";
    this.ld.style.visibility = "";
    this.root.style.opacity = "";
    delete this.root.dataset.phase;
  }

  /** Unmounted (or React's dev double-mount): undo everything, leave <html> to the effect. */
  dispose() {
    this.disposed = true;
    this.cleanup();
  }
}

/* ======================================================================
   The art: flat, token paint, heat only on the rings, gold only on coins.
   ====================================================================== */

const fill = (v: string): CSSProperties => ({ fill: v });
const HEART = "M50 90 C 22 71, 5 53, 5 33 C 5 18, 17 7, 31 7 C 40 7, 46 12, 50 19 C 54 12, 60 7, 69 7 C 83 7, 95 18, 95 33 C 95 53, 78 71, 50 90 Z";
const STRING = "M50 96 C 42 116, 60 132, 49 150 S 44 170, 52 178";
const LIVE_TEXT: CSSProperties = { fontFamily: "var(--font-sans), system-ui, sans-serif" };

function Sprite() {
  return (
    <svg className="xti-sprite" width="0" height="0" aria-hidden="true">
      <defs>
        <linearGradient id="xti-heat" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff2b45" />
          <stop offset="0.52" stopColor="#f85810" />
          <stop offset="1" stopColor="#f8a008" />
        </linearGradient>
        <clipPath id="xti-av">
          <circle cx="50" cy="50" r="37.5" />
        </clipPath>
        <symbol id="xti-ring" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="45.5" fill="none" stroke="url(#xti-heat)" strokeWidth="7" />
          <circle cx="50" cy="50" r="37.5" style={fill("var(--a)")} />
          <g clipPath="url(#xti-av)">
            <circle cx="50" cy="42" r="14" style={fill("var(--b)")} />
            <ellipse cx="50" cy="88" rx="28" ry="24" style={fill("var(--b)")} />
          </g>
        </symbol>
        <symbol id="xti-ring-live" viewBox="0 0 100 100">
          <use href="#xti-ring" width="100" height="100" />
          <rect x="29" y="82" width="42" height="16" rx="5" style={fill("var(--xi-chili)")} />
          <text x="50" y="93.6" textAnchor="middle" fontSize="10.5" fontWeight="800" letterSpacing="0.6" fill="#fff" style={LIVE_TEXT}>
            LIVE
          </text>
        </symbol>
        <symbol id="xti-balloon" viewBox="0 0 100 178">
          <path d={STRING} fill="none" style={{ stroke: "var(--xi-stem)" }} strokeWidth="2" strokeLinecap="round" />
          <path d="M44 99 L56 99 L50 92 Z" style={fill("var(--xi-stem)")} />
          <use href="#xti-ring" width="100" height="100" />
        </symbol>
        <symbol id="xti-balloon-live" viewBox="0 0 100 178">
          <path d={STRING} fill="none" style={{ stroke: "var(--xi-stem)" }} strokeWidth="2" strokeLinecap="round" />
          <use href="#xti-ring-live" width="100" height="100" />
        </symbol>
        <symbol id="xti-flower" viewBox="0 0 100 230">
          <path d="M50 96 C 47 140, 55 180, 50 230" fill="none" style={{ stroke: "var(--xi-stem)" }} strokeWidth="5" strokeLinecap="round" />
          <path d="M51 176 C 60 156, 80 150, 92 156 C 84 172, 66 180, 51 176 Z" style={fill("var(--xi-stem)")} />
          <use href="#xti-ring" width="100" height="100" />
        </symbol>
        <symbol id="xti-heart" viewBox="0 0 100 100">
          <path d={HEART} style={fill("var(--c)")} />
        </symbol>
        <symbol id="xti-sparkle" viewBox="0 0 100 100">
          <path d="M50 3 C 54 33, 67 46, 97 50 C 67 54, 54 67, 50 97 C 46 67, 33 54, 3 50 C 33 46, 46 33, 50 3 Z" style={fill("var(--c)")} />
        </symbol>
        <symbol id="xti-coin" viewBox="0 0 100 100">
          <circle cx="50" cy="52" r="46" fill="#a16207" />
          <circle cx="50" cy="48" r="46" fill="#eab308" />
          <circle cx="50" cy="48" r="34" fill="none" stroke="#ca8a04" strokeWidth="4.5" />
          <path d="M50 26 L56.5 40 L71 41.5 L60 51.5 L63.5 66 L50 58.5 L36.5 66 L40 51.5 L29 41.5 L43.5 40 Z" fill="#ca8a04" />
        </symbol>
        <symbol id="xti-cf-rect" viewBox="0 0 20 40">
          <rect x="1" y="1" width="18" height="38" rx="3" style={fill("var(--c)")} />
        </symbol>
        <symbol id="xti-cf-dot" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r="18" style={fill("var(--c)")} />
        </symbol>
        <symbol id="xti-cf-tri" viewBox="0 0 40 40">
          <path d="M20 3 L37 35 L3 35 Z" style={fill("var(--c)")} strokeLinejoin="round" />
        </symbol>
        <symbol id="xti-cf-squig" viewBox="0 0 60 30">
          <path d="M5 20 C 12 4, 20 4, 26 15 S 40 26, 55 10" fill="none" style={{ stroke: "var(--c)" }} strokeWidth="7" strokeLinecap="round" />
        </symbol>
        <symbol id="xti-phone" viewBox="0 0 60 120">
          <rect x="0" y="0" width="60" height="120" rx="11" style={fill("var(--xi-body)")} />
          <rect x="4" y="7" width="52" height="106" rx="7" style={fill("var(--xi-off)")} />
          <rect x="24" y="10" width="12" height="3.2" rx="1.6" style={fill("var(--xi-body)")} />
        </symbol>
        <symbol id="xti-lit" viewBox="0 0 60 120">
          <rect x="4" y="7" width="52" height="106" rx="7" style={fill("var(--xi-lit)")} />
          <circle cx="30" cy="48" r="15" fill="none" stroke="url(#xti-heat)" strokeWidth="3.2" />
          <circle cx="30" cy="48" r="11.4" style={fill("var(--xi-t2)")} />
          <circle cx="30" cy="45" r="4.4" style={fill("var(--xi-t3)")} />
          <path d="M21.5 56 Q30 47 38.5 56 Q34 59.4 30 59.4 Q26 59.4 21.5 56 Z" style={fill("var(--xi-t3)")} />
          <rect x="9" y="16" width="17" height="8" rx="2.5" style={fill("var(--xi-chili)")} />
          <text x="17.5" y="22" textAnchor="middle" fontSize="5.2" fontWeight="800" fill="#fff" style={LIVE_TEXT}>
            LIVE
          </text>
          <rect x="10" y="80" width="30" height="4" rx="2" style={fill("var(--xi-t2)")} />
          <rect x="10" y="88" width="22" height="4" rx="2" style={fill("var(--xi-t2)")} />
        </symbol>
      </defs>
    </svg>
  );
}
