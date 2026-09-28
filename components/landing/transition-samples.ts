/**
 * The five takes on the landing's page transition, from the transition
 * lookbook (2026-09-28). All five share the engine: the dots, the morph
 * driver, the ready signal and the exit machinery (page-transition.tsx).
 * What differs is here: each sample's dots-to-Xtream choreography (kept as
 * the lookbook had it), a deliberately small layer of scenery at the foot
 * of the frame (owner: "make the contents under it minimal, not overly"),
 * and how the frame leaves (Camera.js-style pieces on easeInOutExpo).
 *
 *   A  Stampede       the dots split in two and pop into letters; three live
 *                     rings float up; a 6 × 4 grid shrinks away corner to corner
 *   B  Curtain call   the dots become curtain pleats; a few pieces of
 *                     confetti from one corner; twelve slices drop away
 *   C  Mosaic spiral  the dots orbit and fling out; hearts drift up the right;
 *                     the grid spirals in and the word leaves last
 *   D  Blinds         the dots become slats; a short skyline of phones, one
 *                     lit LIVE; the blinds wipe off, alternating
 *   E  Aperture       the dots gather into the play mark, which beats and
 *                     bursts into the word; the lookbook's meadow, lightly
 *                     trimmed (two hills, five rings on stems, two flags, the
 *                     coin sun, one tossed coin, a few sparkles); eight wedges
 *                     open like a lens iris
 */

import {
  EZ,
  T,
  cameraTiming,
  circle,
  gridRects,
  inflate,
  riseKF,
  roundPoly,
  rrect,
  scatter,
  spiralOrder,
  type Item,
  type Layout,
  type Piece,
  type Rng,
  type Sample,
  type TweenSpec,
} from "./transition-engine";

const CHILI = "var(--xi-chili)";
const EMBER = "var(--xi-ember)";
const INK = "var(--xi-ink)";
const TONES: [string, string][] = [
  ["var(--xi-t1)", "var(--xi-t3)"],
  ["var(--xi-t2)", "var(--xi-t1)"],
  ["var(--xi-t3)", "var(--xi-t4)"],
  ["var(--xi-t4)", "var(--xi-t2)"],
];
const pick = <V>(rng: Rng, arr: V[]) => arr[Math.floor(rng() * arr.length)];
const tone = (t: [string, string]) => ({ "--a": t[0], "--b": t[1] });

/** Order the six letters by distance from x, nearest first. */
const fromCentre = (G: Layout, x: number) => [0, 1, 2, 3, 4, 5].sort((a, b) => Math.abs(G.letters[a].c[0] - x) - Math.abs(G.letters[b].c[0] - x));

/* ------------------------------------------------------------------ A */
const A: Sample = {
  id: "A",
  name: "Stampede",
  ground: "night",
  xChili: false,
  dotOf: (j) => j >> 1,
  // Each dot splits in two, the six drops slide to their letters, then pop into Xtream left to right.
  morph(G, M) {
    const { letters: L, dots: D } = G;
    const tweens: TweenSpec[] = [];
    for (let j = 0; j < 6; j++) {
      const k = j >> 1;
      tweens.push({ part: j, ch: "o", t0: M + k * 40, dur: 420, target: circle(L[j].c[0], L[j].c[1] + G.fs * 0.06, D[0].r * 0.86), ease: EZ.morph });
      const t = M + 380 + j * 55;
      tweens.push({ part: j, ch: "o", t0: t, dur: 760, target: L[j].outer, ease: EZ.settle });
      const inner = L[j].inner;
      if (inner) tweens.push({ part: j, ch: "i", t0: t + 400, dur: 460, target: inner, ease: EZ.settle });
    }
    return { tweens, formed: M + 380 + 5 * 55 + 760 };
  },
  sceneryLead: 520,
  // Three live rings on strings float up at the sides (two on a phone).
  scenery(G, rng) {
    const { W, H, u, phone } = G;
    const k = phone ? 1.25 : 1;
    const spots = phone
      ? [
          { x: 0.18, y: 0.8, w: 96, live: true },
          { x: 0.82, y: 0.74, w: 80, live: false },
        ]
      : [
          { x: 0.12, y: 0.75, w: 96, live: true },
          { x: 0.225, y: 0.84, w: 70, live: false },
          { x: 0.87, y: 0.73, w: 84, live: false },
        ];
    return spots.map((p, i) => {
      const w = u * p.w * k,
        h = w * 1.78,
        ringY = H * p.y;
      const it: Item = {
        depth: 1,
        sym: p.live ? "xti-balloon-live" : "xti-balloon",
        vb: "0 0 100 178",
        w,
        h,
        x: W * p.x,
        y: ringY + (h - w) / 2,
        r: (rng() - 0.5) * 12,
        s: 1,
        vars: tone(pick(rng, TONES)),
        kf: [],
        dur: 1250 + rng() * 150,
        delay: 120 + i * 140,
      };
      const from = { x: it.x + (rng() - 0.5) * 60 * u, y: H + h * 0.55, r: it.r + (rng() - 0.5) * 20 };
      it.kf = riseKF(it, from, H * 0.035, (i % 2 ? -1 : 1) * 5);
      return it;
    });
  },
  // 6 × 4 grid, top-left to bottom-right: every tile shrinks away from the centre, twisting.
  pieces(G, pace) {
    const { W, H } = G,
      tm = cameraTiming({ T: 1500, D: 250, couples: 6, blocks: 24 }, pace);
    return gridRects(W, H, 6, 4).map((r, i): Piece => {
      const cx = r.x + r.w / 2,
        cy = r.y + r.h / 2;
      const rot = ((i * 7919) % 17) - 8 + (cx < W / 2 ? -8 : 8);
      return {
        rect: r,
        delay: tm.step * (r.col + r.row),
        dur: tm.dur,
        kf: [
          { transform: "translate(0px,0px) rotate(0deg) scale(1)" },
          { transform: "translate(" + ((cx - W / 2) * 0.42).toFixed(1) + "px," + ((cy - H / 2) * 0.42).toFixed(1) + "px) rotate(" + rot + "deg) scale(0)" },
        ],
      };
    });
  },
};

/* ------------------------------------------------------------------ B */
const CONFETTI: { sym: string; vb: string; ar: number; k: number }[] = [
  { sym: "xti-cf-rect", vb: "0 0 20 40", ar: 2, k: 1 },
  { sym: "xti-cf-dot", vb: "0 0 40 40", ar: 1, k: 1 },
  { sym: "xti-cf-squig", vb: "0 0 60 30", ar: 0.5, k: 1.8 },
  { sym: "xti-cf-rect", vb: "0 0 20 40", ar: 2, k: 1 },
  { sym: "xti-cf-tri", vb: "0 0 40 40", ar: 1, k: 1 },
  { sym: "xti-sparkle", vb: "0 0 100 100", ar: 1, k: 1.3 },
];
const B: Sample = {
  id: "B",
  name: "Curtain call",
  ground: "paper",
  xChili: false,
  dotOf: (j) => j >> 1,
  // Each dot splits into two pleats, tall rounded bars like curtain folds, which open into letters left to right.
  morph(G, M) {
    const { letters: L, dots: D } = G;
    const tweens: TweenSpec[] = [];
    for (let j = 0; j < 6; j++) {
      const b = L[j].box;
      const w = D[0].r * 1.35,
        h = b.h * 0.92;
      tweens.push({ part: j, ch: "o", t0: M + (j & 1) * 30, dur: 460, target: rrect(b.cx - w / 2, b.cy - h / 2, w, h, w / 2), ease: EZ.morph });
      const t = M + 430 + j * 60;
      tweens.push({ part: j, ch: "o", t0: t, dur: 720, target: L[j].outer, ease: EZ.morph });
      const inner = L[j].inner;
      if (inner) tweens.push({ part: j, ch: "i", t0: t + 360, dur: 440, target: inner, ease: EZ.settle });
    }
    return { tweens, formed: M + 430 + 5 * 60 + 720 };
  },
  sceneryLead: 480,
  // A few pieces of confetti fired from the bottom-left corner arc up and drift down into place.
  scenery(G, rng) {
    const { W, H, u, phone } = G;
    const k = phone ? 1.3 : 1;
    const avoid = [inflate(G.rect, 26 * u, 20 * u)];
    const cols = [CHILI, EMBER, INK, CHILI, EMBER, "var(--xi-t3)"];
    const o = { x: W * 0.03, y: H + 30 };
    return scatter(rng, phone ? 6 : 9, { x0: W * 0.05, x1: W * (phone ? 0.6 : 0.42), y0: H * 0.5, y1: H * 0.9 }, () => u * k * (18 + rng() * 14), avoid, [], 1.9).map((p, i): Item => {
      const c = CONFETTI[i % CONFETTI.length];
      const w = p.s * c.k,
        h = w * c.ar,
        r = rng() * 360,
        spin = (rng() < 0.5 ? -1 : 1) * (240 + rng() * 360);
      return {
        depth: 1,
        sym: c.sym,
        vb: c.vb,
        w,
        h,
        x: p.x,
        y: p.y,
        r,
        s: 1,
        vars: { "--c": cols[i % cols.length] },
        kf: [
          { transform: T(o.x, o.y, r - spin, 0.5, 0.5, w, h), easing: "cubic-bezier(0.08, 0.72, 0.26, 1)" },
          { transform: T(p.x + (p.x - o.x) * 0.06, p.y - H * (0.07 + rng() * 0.06), r - spin * 0.2, 1, 1, w, h), offset: 0.58, easing: "cubic-bezier(0.42, 0, 0.58, 1)" },
          { transform: T(p.x, p.y, r, 1, 1, w, h) },
        ],
        dur: 1250 + rng() * 400,
        delay: rng() * 160,
      };
    });
  },
  // 12 vertical slices, left to right: each hangs, then plunges off the bottom.
  pieces(G, pace) {
    const { W, H } = G,
      tm = cameraTiming({ T: 1500, D: 0, couples: 1, blocks: 12 }, pace);
    return gridRects(W, H, 12, 1).map((r, i) => ({ rect: r, delay: tm.step * i, dur: tm.dur, kf: [{ transform: "translateY(0px)" }, { transform: "translateY(" + (H + 12) + "px)" }] }));
  },
};

/* ------------------------------------------------------------------ C */
const C: Sample = {
  id: "C",
  name: "Mosaic spiral",
  ground: "night",
  xChili: false,
  dotOf: (j) => j >> 1,
  // The dots draw in and orbit once and a bit, then fling out into letters from the middle while the word unwinds its last 30°.
  morph(G, M) {
    const { letters: L, dots: D } = G;
    const cx = D[1].cx,
      cy = D[0].cy;
    const tweens: TweenSpec[] = [];
    for (let j = 0; j < 6; j++) {
      const k = j >> 1;
      tweens.push({ part: j, ch: "o", t0: M, dur: 520, target: circle(cx + (k - 1) * D[0].r * 2.5, cy, D[0].r * 1.05), ease: EZ.inout });
    }
    fromCentre(G, cx).forEach((j, rank) => {
      const t = M + 600 + rank * 50;
      tweens.push({ part: j, ch: "o", t0: t, dur: 820, target: L[j].outer, ease: EZ.settle });
      const inner = L[j].inner;
      if (inner) tweens.push({ part: j, ch: "i", t0: t + 420, dur: 440, target: inner, ease: EZ.settle });
    });
    const group = (st: number) => {
      const t = st - M;
      if (t < 0) return null;
      let a: number;
      if (t < 700) a = 390 * EZ.inout(t / 700) * 0.92 + 390 * 0.08 * (t / 700);
      else if (t < 1650) a = 390 - 30 * EZ.out((t - 700) / 950);
      else return "";
      return "rotate(" + a.toFixed(2) + " " + cx.toFixed(1) + " " + cy.toFixed(1) + ")";
    };
    return { tweens, formed: M + 600 + 5 * 50 + 820, group };
  },
  sceneryLead: 300,
  // Three hearts drift up the right edge, the way hearts rise on a live stream; the highest is faint.
  scenery(G, rng) {
    const { W, H, u, phone } = G;
    const k = phone ? 1.3 : 1;
    const n = phone ? 2 : 3;
    const cols = [CHILI, EMBER, CHILI];
    return [...Array(n)].map((_, i): Item => {
      const f = i / Math.max(1, n - 1);
      const y = H * (0.88 - f * 0.3);
      const x = W * (phone ? 0.86 : 0.9) + Math.sin(f * 5.5) * W * 0.02;
      const w = u * k * (40 - f * 12);
      const r = (rng() - 0.5) * 24,
        amp = 16 * u;
      return {
        depth: 1,
        sym: "xti-heart",
        vb: "0 0 100 100",
        w,
        h: w,
        x,
        y,
        r,
        s: 1,
        op: f > 0.6 ? 0.6 : 1,
        vars: { "--c": cols[i % cols.length] },
        kf: [
          { transform: T(x - amp, H + w, r - 18, 0.5, 0.5, w, w), easing: "ease-in-out" },
          { transform: T(x + amp, y + (H - y) * 0.55, r + 14, 0.9, 0.9, w, w), offset: 0.3, easing: "ease-in-out" },
          { transform: T(x - amp * 0.6, y + (H - y) * 0.18, r - 9, 1.08, 1.08, w, w), offset: 0.6, easing: "ease-in-out" },
          { transform: T(x + amp * 0.2, y - 6 * u, r + 4, 1, 1, w, w), offset: 0.84, easing: "ease-in-out" },
          { transform: T(x, y, r, 1, 1, w, w) },
        ],
        dur: 1300 + f * 300,
        delay: 160 + f * 300 + rng() * 60,
      };
    });
  },
  // 6 × 4 grid in a spiral: the outer ring first, clockwise from the top-left, so the word's tiles leave last.
  pieces(G, pace) {
    const { W, H } = G,
      tm = cameraTiming({ T: 1500, D: 250, couples: 1.7, blocks: 24 }, pace),
      rank = spiralOrder(6, 4);
    return gridRects(W, H, 6, 4).map((r, i) => ({ rect: r, delay: tm.step * rank[i], dur: tm.dur, kf: [{ transform: "rotate(0deg) scale(1)" }, { transform: "rotate(-90deg) scale(0)" }] }));
  },
};

/* ------------------------------------------------------------------ D */
const D: Sample = {
  id: "D",
  name: "Blinds",
  ground: "night",
  xChili: false,
  dotOf: (j) => j % 3,
  // The dots flatten into three slats split at the middle, which tilt open into the letters, top row first.
  morph(G, M) {
    const { letters: L, dots: Dt, rect } = G;
    const gapY = G.fs * 0.24,
      hh = Math.max(6, G.fs * 0.11),
      mid = G.W / 2,
      gx = G.fs * 0.06;
    const tweens: TweenSpec[] = [];
    for (let j = 0; j < 6; j++) {
      const row = j % 3,
        left = j < 3;
      const y = Dt[0].cy + (row - 1) * gapY - hh / 2;
      const x0 = left ? rect.x0 : mid + gx / 2,
        x1 = left ? mid - gx / 2 : rect.x1;
      tweens.push({ part: j, ch: "o", t0: M + row * 55, dur: 500, target: rrect(x0, y, x1 - x0, hh, hh / 2), ease: EZ.morph });
      const t = M + 560 + row * 80;
      tweens.push({ part: j, ch: "o", t0: t, dur: 760, target: L[j].outer, ease: EZ.morph });
      const inner = L[j].inner;
      if (inner) tweens.push({ part: j, ch: "i", t0: t + 380, dur: 460, target: inner, ease: EZ.settle });
    }
    return { tweens, formed: M + 560 + 160 + 760 };
  },
  sceneryLead: 420,
  // One low skyline of phones rising from the foot of the frame; one screen flickers on, LIVE.
  scenery(G, rng) {
    const { W, H, u, phone } = G;
    const n = phone ? 3 : 5;
    const litAt = phone ? 0 : 1;
    return [...Array(n)].map((_, i): Item => {
      const top = H * (0.78 + rng() * 0.05);
      const h = Math.max(u * 200, (H - top) * 1.35),
        w = h / 2;
      const x = ((i + 0.5 + (rng() - 0.5) * 0.4) / n) * W;
      const y = top + h / 2;
      const rise = H - top + 30 * u;
      const dur = 1100 + rng() * 150,
        delay = (Math.abs(x - W / 2) / W) * 420 + rng() * 60;
      return {
        depth: 1,
        sym: "xti-phone",
        vb: "0 0 60 120",
        w,
        h,
        x,
        y,
        r: 0,
        s: 1,
        kf: [
          { transform: T(x, y + rise, 0, 1, 1, w, h), easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
          { transform: T(x, y - 6 * u, 0, 1, 1, w, h), offset: 0.7, easing: "ease-in-out" },
          { transform: T(x, y, 0, 1, 1, w, h) },
        ],
        dur,
        delay,
        lit: i === litAt ? { sym: "xti-lit", vb: "0 0 60 120", at: delay + dur * 0.7 + 120 } : undefined,
      };
    });
  },
  // 8 horizontal slices, bottom first: even rows wipe off to the left, odd to the right, each window narrowing.
  pieces(G, pace) {
    const { W, H } = G,
      tm = cameraTiming({ T: 1500, D: 0, couples: 1, blocks: 8 }, pace);
    return gridRects(W, H, 1, 8).map((r, i) => {
      const dir = i % 2 === 0 ? -1 : 1;
      return {
        rect: r,
        delay: tm.step * (7 - i),
        dur: tm.dur,
        kf: [
          { transform: "translateX(0px)", clipPath: "inset(0px 0px 0px 0px)" },
          { transform: "translateX(" + (dir * W * 0.35).toFixed(1) + "px)", clipPath: dir > 0 ? "inset(0px 0px 0px 100%)" : "inset(0px 100% 0px 0px)" },
        ],
      };
    });
  },
};

/* ------------------------------------------------------------------ E */
const E: Sample = {
  id: "E",
  name: "Aperture",
  ground: "paper",
  xChili: true,
  dotOf: (j) => j >> 1,
  // The dots flow together into the Chili play mark; it beats once, then bursts into the letters from the centre,
  // turning from Chili to ink. The X keeps its Chili.
  morph(G, M, ink, chili) {
    const { letters: L, dots: Dt } = G;
    const cx = Dt[1].cx,
      cy = Dt[1].cy,
      sz = G.fs * 0.66;
    const tri = roundPoly(
      [
        [cx - sz * 0.36, cy - sz * 0.5],
        [cx + sz * 0.5, cy],
        [cx - sz * 0.36, cy + sz * 0.5],
      ],
      sz * 0.12,
    );
    const tweens: TweenSpec[] = [];
    for (let j = 0; j < 6; j++) {
      const k = j >> 1;
      tweens.push({ part: j, ch: "o", t0: M + k * 45, dur: 540, target: tri, ease: EZ.morph });
      tweens.push({ part: j, ch: "c", t0: M + k * 45, dur: 540, target: chili, ease: EZ.morph });
    }
    const B0 = M + 860;
    fromCentre(G, cx).forEach((j, rank) => {
      const t = B0 + rank * 38;
      tweens.push({ part: j, ch: "o", t0: t, dur: 820, target: L[j].outer, ease: EZ.settle });
      if (j !== 0) tweens.push({ part: j, ch: "c", t0: t + 120, dur: 600, target: ink, ease: EZ.morph });
      const inner = L[j].inner;
      if (inner) tweens.push({ part: j, ch: "i", t0: t + 420, dur: 440, target: inner, ease: EZ.settle });
    });
    const at = M + 540;
    const group = (st: number) => {
      const t = st - at;
      if (t < 0) return null;
      if (t > 360) return "";
      const s = 1 + 0.16 * Math.sin(Math.PI * EZ.inout(t / 360));
      return "translate(" + cx.toFixed(1) + " " + cy.toFixed(1) + ") scale(" + s.toFixed(3) + ") translate(" + (-cx).toFixed(1) + " " + (-cy).toFixed(1) + ")";
    };
    return { tweens, formed: B0 + 5 * 38 + 820, group };
  },
  sceneryLead: 700,
  // The lookbook's paper-cut meadow, a touch lighter (owner, 2026-09-28: "a little weeny bit minimal"): two hills
  // rise in parallax, back then front; the coin sun comes up behind the back hill; five live rings sprout on stems
  // (three on a phone); two play flags plant on the front hill (one on a phone); one coin is tossed up; a few sparkles.
  scenery(G, rng) {
    const { W, H, u, phone } = G;
    const k = phone ? 1.3 : 1;
    const items: Item[] = [];
    const hills = [
      { top: H * (phone ? 0.66 : 0.64), amp: H * (phone ? 0.045 : 0.07), f: 1.2, ph: 0.1, fill: "var(--xi-hill)", delay: 0, dur: 1300, depth: 0 as const },
      { top: H * (phone ? 0.87 : 0.86), amp: H * (phone ? 0.03 : 0.045), f: 2.1, ph: 0.3, fill: "var(--xi-hill-front)", delay: 200, dur: 1000, depth: 1 as const },
    ];
    const surf = hills.map(
      (hl) => (x: number) => hl.top + hl.amp * (0.55 * Math.sin(2 * Math.PI * ((x / W) * hl.f + hl.ph)) + 0.45 * Math.sin(2 * Math.PI * ((x / W) * hl.f * 2.3 + hl.ph * 1.7))),
    );
    // The sun first, so the back hill covers its foot.
    const sw = u * (phone ? 140 : 160);
    const sunX = W * (phone ? 0.72 : 0.78);
    items.push({ depth: 0, sym: "xti-coin", vb: "0 0 100 100", w: sw, h: sw, x: sunX, y: hills[0].top - sw * 0.18, r: -10, s: 1, kf: [], dur: 1400, delay: 520, fade: 0.01 });
    const rises: number[] = [];
    hills.forEach((hl, i) => {
      const top = hl.top - hl.amp - 4,
        hh = H - top + 40;
      let d = "M0 " + hh + " L0 " + (surf[i](0) - top).toFixed(1);
      for (let n = 1; n <= 96; n++) {
        const x = (n / 96) * W;
        d += " L" + x.toFixed(1) + " " + (surf[i](x) - top).toFixed(1);
      }
      d += " L" + W + " " + hh + " Z";
      rises.push(items.length);
      items.push({
        depth: hl.depth,
        html: '<svg viewBox="0 0 ' + W + " " + hh + '" preserveAspectRatio="none"><path d="' + d + '" style="fill:' + hl.fill + '"/></svg>',
        w: W,
        h: hh,
        x: W / 2,
        y: top + hh / 2,
        r: 0,
        s: 1,
        kf: [],
        dur: hl.dur,
        delay: hl.delay,
      });
    });
    // Live rings on stems: on the back hill only outside the word, on the front hill anywhere.
    const flowers = phone
      ? [
          { x: 0.12, hl: 0 },
          { x: 0.42, hl: 1 },
          { x: 0.86, hl: 1 },
        ]
      : [
          { x: 0.07, hl: 0 },
          { x: 0.27, hl: 1 },
          { x: 0.45, hl: 1 },
          { x: 0.64, hl: 1 },
          { x: 0.92, hl: 0 },
        ];
    flowers.forEach((p, i) => {
      const hl = hills[p.hl];
      const w = u * k * (p.hl ? 84 : 62) * (0.88 + rng() * 0.24),
        h = w * 2.3;
      const x = W * p.x + (rng() - 0.5) * W * 0.02,
        base = surf[p.hl](x) + 6;
      items.push({
        depth: hl.depth,
        sym: "xti-flower",
        vb: "0 0 100 230",
        w,
        h,
        x,
        y: base - h / 2,
        r: (rng() - 0.5) * 10,
        s: 1,
        vars: tone(pick(rng, TONES)),
        origin: "50% 100%",
        kf: [],
        dur: 760,
        delay: hl.delay + hl.dur * 0.55 + i * 55 + rng() * 80,
      });
    });
    // Play flags planted on the front hill.
    (phone ? [0.64] : [0.15, 0.545]).forEach((fx, i) => {
      const w = u * k * 56,
        h = w * (130 / 70),
        x = W * fx,
        base = surf[1](x) + 4;
      items.push({ depth: 2, sym: "xti-flag", vb: "0 0 70 130", w, h, x, y: base - h / 2, r: i ? 5 : -4, s: 1, origin: "50% 100%", kf: [], dur: 680, delay: hills[1].delay + hills[1].dur * 0.5 + i * 90 });
    });
    // One coin tossed up, and a few sparkles, all clear of the word.
    const avoid = [inflate(G.rect, 26 * u, 22 * u)],
      placed = [{ x: sunX, y: hills[0].top, s: sw }];
    const [c] = scatter(rng, 1, { x0: W * 0.06, x1: W * 0.3, y0: H * 0.1, y1: H * 0.4 }, () => u * k * 44, avoid, placed, 1.6);
    items.push({ depth: 1, sym: "xti-coin", vb: "0 0 100 100", w: c.s, h: c.s, x: c.x, y: c.y, r: (rng() - 0.5) * 20, s: 1, kf: [], dur: 1300, delay: 560 });
    const sparkCols = [CHILI, EMBER, INK];
    scatter(rng, phone ? 3 : 5, { x0: W * 0.04, x1: W * 0.96, y0: H * 0.06, y1: H * 0.55 }, () => u * k * (14 + rng() * 12), avoid, placed, 1.6).forEach((p, i) => {
      items.push({ depth: 1, sym: "xti-sparkle", vb: "0 0 100 100", w: p.s, h: p.s, x: p.x, y: p.y, r: (rng() - 0.5) * 20, s: 1, vars: { "--c": sparkCols[i % 3] }, kf: [], dur: 560, delay: 820 + rng() * 480 });
    });

    for (const [n, it] of items.entries()) {
      const { x, y, r, w, h } = it;
      if (rises.includes(n)) {
        const rise = h * 0.7 + H * 0.1;
        it.kf = [
          { transform: T(x, y + rise, 0, 1, 1, w, h), easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
          { transform: T(x, y - 8 * u, 0, 1, 1, w, h), offset: 0.72, easing: "ease-in-out" },
          { transform: T(x, y, 0, 1, 1, w, h) },
        ];
      } else if (n === 0) {
        // the sun
        it.kf = [
          { transform: T(x, y + h * 1.1, r - 40, 1, 1, w, h), easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
          { transform: T(x, y, r, 1, 1, w, h) },
        ];
      } else if (it.origin) {
        // sprout: grow from the ground with a springy lean
        it.kf = [
          { transform: T(x, y, r - 12, 0.2, 0, w, h), easing: "cubic-bezier(0.3, 1.5, 0.5, 1)" },
          { transform: T(x, y, r + 7, 0.96, 1.1, w, h), offset: 0.5, easing: "ease-in-out" },
          { transform: T(x, y, r - 3, 1.02, 0.97, w, h), offset: 0.78, easing: "ease-in-out" },
          { transform: T(x, y, r, 1, 1, w, h) },
        ];
      } else if (it.sym === "xti-coin") {
        // tossed: up from below the frame, flipping, and a little bounce
        const ox = x + (x < W / 2 ? -1 : 1) * W * 0.12;
        it.kf = [
          { transform: T(ox, H + h, r, 1, 1, w, h), easing: "cubic-bezier(0.15, 0.7, 0.3, 1)" },
          { transform: T(x, y - H * 0.08, r, -1, 1, w, h), offset: 0.5, easing: "cubic-bezier(0.5, 0, 0.5, 1)" },
          { transform: T(x, y + 4 * u, r, 0.4, 1, w, h), offset: 0.78, easing: "ease-in-out" },
          { transform: T(x, y, r, 1, 1, w, h) },
        ];
      } else {
        // sparkle pop
        it.kf = [
          { transform: T(x, y, r - 40, 0, 0, w, h), easing: "cubic-bezier(0.3, 1.4, 0.5, 1)" },
          { transform: T(x, y, r + 6, 1.4, 1.4, w, h), offset: 0.55, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
          { transform: T(x, y, r, 1, 1, w, h) },
        ];
      }
    }
    return items;
  },
  // Camera's slices cut as 8 wedges round the word like iris blades: clockwise from the top, each turns 32° and slides out.
  pieces(G, pace) {
    const { W, H } = G,
      tm = cameraTiming({ T: 1500, D: 0, couples: 1, blocks: 8 }, pace);
    const cx = W / 2,
      cy = G.rect.cy,
      R = Math.hypot(W, H) * 2,
      n = 8,
      out: Piece[] = [];
    const dist = Math.hypot(W, H) * 0.75;
    for (let i = 0; i < n; i++) {
      const a0 = (((i / n) * 360 - 90 - 0.8) * Math.PI) / 180,
        a1 = ((((i + 1) / n) * 360 - 90 + 0.8) * Math.PI) / 180,
        am = (a0 + a1) / 2;
      // The apex sits a few px behind the centre and the edges overlap a little, so no seam shows between blades.
      const ax = cx - Math.cos(am) * 8,
        ay = cy - Math.sin(am) * 8;
      const poly =
        "polygon(" +
        ax.toFixed(1) +
        "px " +
        ay.toFixed(1) +
        "px, " +
        (cx + R * Math.cos(a0)).toFixed(1) +
        "px " +
        (cy + R * Math.sin(a0)).toFixed(1) +
        "px, " +
        (cx + R * Math.cos(a1)).toFixed(1) +
        "px " +
        (cy + R * Math.sin(a1)).toFixed(1) +
        "px)";
      out.push({
        rect: { x: 0, y: 0, w: W, h: H, col: i, row: 0 },
        clip: poly,
        origin: cx.toFixed(1) + "px " + cy.toFixed(1) + "px",
        delay: tm.step * i,
        dur: tm.dur,
        kf: [
          { transform: "translate(0px,0px) rotate(0deg)" },
          { transform: "translate(" + (Math.cos(am) * dist).toFixed(1) + "px," + (Math.sin(am) * dist).toFixed(1) + "px) rotate(32deg)" },
        ],
      });
    }
    return out;
  },
};

export const SAMPLES: Record<Sample["id"], Sample> = { A, B, C, D, E };
