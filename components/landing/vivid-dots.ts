/**
 * The dots of the Vivid row's last card (owner, 2026-09-27: "the dots around
 * turn into the Vivid text"). Ink dots drift all round the card; on
 * `converge` most of them leave their places, so the field visibly empties,
 * and fly into the letters of the word element they're given, letter by
 * letter on the WorldSpace wordmark's timing (M06: 35 ms apart, 700 ms each,
 * ease-out). The word stays made of dots, breathing a little, and follows its
 * element when the layout moves it. A few dots stay behind and keep drifting.
 *
 * The letters are sampled from the word itself: drawn off-screen in its
 * computed font, then fitted to where the browser put the word, so the dots
 * land on the glyphs whatever the card's size. Only the canvas is drawn here;
 * the card's state machine lives in chapter-vivid.tsx.
 */

type Dot = {
  hx: number; // home, 0..1 of the card
  hy: number;
  a: number; // resting alpha
  r: number; // resting radius
  w1: number;
  w2: number;
  p1: number;
  p2: number;
  amp: number;
  target: number; // index into targets, or -1 for a dot that stays behind
  delay: number;
  curl: number;
};

type Target = { x: number; y: number; letter: number };

const INK = "11,7,8";
/** Xtream's `out` token, the swift one. */
const SWIFT = bezier(0.2, 0.8, 0.2, 1);
const LETTER_GAP = 0.035;
const FLIGHT = 0.7;

function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = ((ax * t + bx) * t + cx) * t - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(e) < 1e-5 || Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s & 0xffff) / 0x10000;
  };
}

type Stretchy = CanvasRenderingContext2D & { fontStretch: string; letterSpacing: string };

/** Where the word's ink is, in card pixels (one point per `step` px), and where the word was when measured. */
function sampleWord(card: HTMLElement, word: HTMLElement, step: number) {
  const cs = getComputedStyle(word);
  const size = parseFloat(cs.fontSize);
  const text = word.textContent?.trim() || "Vivid";
  const stretch = parseFloat(cs.fontStretch) || 100;
  const off = document.createElement("canvas");
  const g = off.getContext("2d") as Stretchy | null;
  if (!g) return { points: [] as Target[], at: { x: 0, y: 0 } };
  const setFont = () => {
    g.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    // Canvas takes stretch keywords only; the fit to the word's width below makes up the rest.
    if ("fontStretch" in g) g.fontStretch = stretch >= 118 ? "expanded" : stretch >= 110 ? "semi-expanded" : "normal";
    if ("letterSpacing" in g) g.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
  };
  setFont();
  const m = g.measureText(text);
  // Where each letter ends along the pen, to know which letter a point is in.
  const ends = [...text].map((_, i) => g.measureText(text.slice(0, i + 1)).width);
  const pad = 4;
  off.width = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight) + pad * 2;
  off.height = Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + pad * 2;
  setFont();
  g.fillStyle = "#000";
  g.fillText(text, pad + m.actualBoundingBoxLeft, pad + m.actualBoundingBoxAscent);
  const px = g.getImageData(0, 0, off.width, off.height).data;

  // Fit: the word's content box across, its baseline down.
  const cr = card.getBoundingClientRect();
  const wr = word.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft), padR = parseFloat(cs.paddingRight), padT = parseFloat(cs.paddingTop);
  const lineH = parseFloat(cs.lineHeight) || size * 1.1;
  const sx = (wr.width - padL - padR) / m.width;
  const fontAsc = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
  const fontDesc = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
  const baseY = wr.top - cr.top + padT + (lineH - (fontAsc + fontDesc)) / 2 + fontAsc;
  const originX = wr.left - cr.left + padL;

  const points: Target[] = [];
  for (let y = 0; y < off.height; y += step) {
    for (let x = 0; x < off.width; x += step) {
      // The step is fractional; read the pixel it lands in.
      if (px[(Math.floor(y) * off.width + Math.floor(x)) * 4 + 3] > 120) {
        const gx = x - pad - m.actualBoundingBoxLeft; // from the pen's origin
        const gy = y - pad - m.actualBoundingBoxAscent; // from the baseline
        const letter = Math.max(0, ends.findIndex((e) => gx < e));
        points.push({ x: originX + gx * sx, y: baseY + gy, letter });
      }
    }
  }
  return { points, at: { x: wr.left - cr.left, y: wr.top - cr.top } };
}

export function startDots(canvas: HTMLCanvasElement, card: HTMLElement, word: HTMLElement) {
  const ctx = canvas.getContext("2d");
  const rand = rng(11);
  let W = 0, H = 0, dpr = 1;
  let targets: Target[] = [];
  let sampledAt = { x: 0, y: 0 };
  let dots: Dot[] = [];
  let convergeAt = Infinity;
  let raf = 0;
  let running = false;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  // One dot per few pixels of the word's ink, tied to its size.
  const stepFor = () => Math.max(2.6, parseFloat(getComputedStyle(word).fontSize) / 21);

  const home = () => {
    // Anywhere on the card, thinner through the middle so the words read.
    for (let k = 0; k < 6; k++) {
      const x = rand(), y = rand();
      const dx = (x - 0.5) / 0.36, dy = (y - 0.48) / 0.24;
      if (dx * dx + dy * dy > 1 || rand() < 0.2) return [x, y];
    }
    return [rand(), rand()];
  };

  const sample = () => {
    const s = sampleWord(card, word, stepFor());
    if (!s.points.length) return;
    // Keep the dot count; map each target onto the fresh letters.
    targets = targets.length ? targets.map((_, i) => s.points[Math.floor((i / targets.length) * s.points.length)]) : s.points;
    sampledAt = s.at;
  };

  const build = () => {
    sample();
    // Most of the field becomes the word; a few dots stay behind.
    const behind = Math.round(targets.length * 0.18) + 30;
    dots = Array.from({ length: targets.length + behind }, (_, i) => {
      const [hx, hy] = home();
      const t = i < targets.length ? i : -1;
      return {
        hx, hy,
        a: 0.22 + rand() * 0.4,
        r: 1.2 + rand() * 1,
        w1: 0.25 + rand() * 0.6,
        w2: 0.25 + rand() * 0.6,
        p1: rand() * 6.283,
        p2: rand() * 6.283,
        amp: 5 + rand() * 12,
        target: t,
        // Letter by letter, 35 ms apart, with a little scatter inside each letter.
        delay: (t >= 0 ? targets[t].letter : 0) * LETTER_GAP + rand() * 0.14,
        curl: (rand() - 0.5) * 70,
      };
    });
  };

  const resize = () => {
    const r = card.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (dots.length) sample();
  };

  const draw = () => {
    if (!ctx) return;
    const t = now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // The word may have moved since it was measured (the phrase folding away): follow it.
    const cr = card.getBoundingClientRect();
    const wr = word.getBoundingClientRect();
    const ox = wr.left - cr.left - sampledAt.x;
    const oy = wr.top - cr.top - sampledAt.y;
    // Landed dots just touch their neighbours, so the word reads as dots.
    const landR = stepFor() * 0.5;
    ctx.fillStyle = `rgb(${INK})`;
    for (const d of dots) {
      let x = d.hx * W + Math.sin(d.w1 * t + d.p1) * d.amp;
      let y = d.hy * H + Math.cos(d.w2 * t + d.p2) * d.amp;
      let a = d.a;
      let r = d.r;
      if (d.target >= 0 && t > convergeAt) {
        const e = SWIFT((t - convergeAt - d.delay) / FLIGHT);
        if (e > 0) {
          const tg = targets[d.target];
          // Once home, a dot still breathes a little: the word is made of them.
          const tx = tg.x + ox + Math.sin(t * 1.7 + d.p1) * 0.35;
          const ty = tg.y + oy + Math.cos(t * 1.5 + d.p2) * 0.35;
          // A curved flight: swing off the straight line, then settle on it.
          const dx = tx - x, dy = ty - y;
          const len = Math.hypot(dx, dy) || 1;
          const bend = Math.sin(Math.PI * e) * d.curl;
          x += dx * e - (dy / len) * bend;
          y += dy * e + (dx / len) * bend;
          a += (0.92 - a) * e;
          r += (landR - r) * e;
        }
      }
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const loop = () => {
    draw();
    raf = requestAnimationFrame(loop);
  };

  let ready = false;
  const ro = new ResizeObserver(() => ready && resize());
  void document.fonts.ready.then(() => {
    resize();
    build();
    ready = true;
    ro.observe(card);
    if (running) raf = requestAnimationFrame(loop);
  });

  return {
    /** Draw (the card is on screen) or rest (it isn't). */
    play(on: boolean) {
      if (on === running) return;
      running = on;
      if (!ready) return;
      if (on) raf = requestAnimationFrame(loop);
      else cancelAnimationFrame(raf);
    },
    /** The field takes off for the word in `after` seconds. */
    converge(after: number) {
      if (ready) sample(); // the card may have moved since mount
      convergeAt = now() + after;
    },
    stop() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      running = false;
    },
  };
}
