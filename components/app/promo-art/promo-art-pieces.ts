import {
  arcLine,
  at,
  bar,
  bubble,
  bust,
  bustOn,
  circle,
  crown,
  digit,
  line,
  mapPoints,
  outline,
  Pen,
  roundPoly,
  rrect,
  type Outline,
  type Pt,
} from "@/components/app/tour/tour-art-morph";

/**
 * The house slides' art (./promo-art.tsx), as data: one piece per promo in
 * the home stage and the rail's Spotlight. Each piece is its own cast of
 * parts, the same parts in every one of its scenes, told as a short story
 * that plays when its slide takes the stage:
 *
 *   dormant  what a side seat shows, still;
 *   …        the beats of the entrance, each morphing out of the last;
 *   stage    where it lands and keeps living until the slide leaves.
 *
 * The geometry is the walkthrough's (components/app/tour/tour-art-morph.ts):
 * every part one closed outline of 24 cubic segments. Coordinates are user
 * units around the ground disc centred on (120, 90); the canvas frames
 * "30 14 180 144", close round the disc so the art reads at rail size.
 */

export const PROMO_ART = ["golive", "worldspace", "wolf", "prediction", "market"] as const;
export type PromoArtId = (typeof PROMO_ART)[number];

/** Paint classes in ./promo-art.module.css. Every colour is a theme token. */
export const PAINTS = [
  "card",
  "card2",
  "screen",
  "line",
  "soft",
  "slot",
  "bar",
  "ink",
  "inkLine",
  "hi",
  "onHiDots",
  "live",
  "liveHalo",
  "heat",
  "ringFace",
  "onLive",
  "onLiveBar",
  "onLiveDot",
  "ember",
  "emberLine",
  "onEmber",
] as const;
export type PaintName = (typeof PAINTS)[number];

/** Idle beats: CSS loops on a part at rest, never the path driver. */
export type IdleKind =
  | "press"
  | "ping"
  | "swell"
  | "halo"
  | "blink"
  | "hover"
  | "float"
  | "typing"
  | "pop"
  | "crown"
  | "spin"
  | "spinBack"
  | "breathe"
  | "swing"
  | "shimmer"
  | "nod";

/** Loops whose part is invisible at rest: it only shows while looping (and never under reduced motion). */
export const LOOP_ONLY: ReadonlySet<IdleKind> = new Set<IdleKind>(["ping", "halo"]);

export type Idle = {
  kind: IdleKind;
  /** Seconds into the loop's cycle (negative starts it part-way), so parts sharing a loop fall out of step. */
  offset?: number;
  /** Turn or scale about this point (user units), for parts that move as one, or the part's own base. */
  origin?: Pt | "bottom";
};

export type Pose = { d: Outline; paint: PaintName; opacity?: number; idle?: Idle };
/** A part this scene doesn't need: it folds into a point and fades. */
export type Fold = { fold: Pt };

export type Scene = {
  /** One per part, in the piece's cast order. */
  parts: (Pose | Fold)[];
  /** Where the change starts: parts nearest move first. */
  focus: Pt;
  /** Paint order, bottom to top, as cast indexes. */
  z: number[];
  /** During the entrance: how long to rest here before the next beat, in ms. */
  hold: number;
};

export type Piece = {
  id: PromoArtId;
  cast: readonly string[];
  /** Dormant first, stage last. */
  scenes: Scene[];
};

export const isPose = (p: Pose | Fold): p is Pose => "d" in p;

const P = (d: Outline, paint: PaintName, more?: { opacity?: number; idle?: Idle }): Pose => ({ d, paint, ...more });
const idle = (kind: IdleKind, offset?: number, origin?: Idle["origin"]): { idle: Idle } => ({ idle: { kind, offset, origin } });

function scene<C extends string>(
  cast: readonly C[],
  parts: Partial<Record<C, Pose | Fold>>,
  opts: { focus: Pt; tuck?: Pt; z?: C[]; hold?: number },
): Scene {
  const tuck = opts.tuck ?? opts.focus;
  const order = opts.z ?? [...cast];
  return {
    parts: cast.map((id) => parts[id] ?? { fold: tuck }),
    focus: opts.focus,
    z: [...cast.filter((id) => !order.includes(id)), ...order].map((id) => cast.indexOf(id)),
    hold: opts.hold ?? 0,
  };
}

/* ---- shapes of our own ---------------------------------------------------------- */

/** A heart, `s` about half its width, its point at the bottom. */
export function heart(cx: number, cy: number, s: number): Outline {
  const r = 0.5 * s;
  const ly = cy - 0.3 * s;
  const p = new Pen(cx, cy + 0.78 * s);
  p.c(cx - 0.3 * s, cy + 0.52 * s, cx - 0.86 * s, cy + 0.2 * s, cx - 0.933 * s, ly + r * 0.5);
  p.arc(cx - r, ly, r, r, 150, 360);
  p.arc(cx + r, ly, r, r, 180, 390);
  p.c(cx + 0.86 * s, cy + 0.2 * s, cx + 0.3 * s, cy + 0.52 * s, cx, cy + 0.78 * s);
  return outline(p.close());
}

/** The path `heart` draws, for garnish that doesn't morph. */
export function heartPath(cx: number, cy: number, s: number) {
  const r = 0.5 * s;
  const ly = cy - 0.3 * s;
  const f = (v: number) => Math.round(v * 100) / 100;
  return (
    `M${f(cx)} ${f(cy + 0.78 * s)}` +
    `C${f(cx - 0.3 * s)} ${f(cy + 0.52 * s)} ${f(cx - 0.86 * s)} ${f(cy + 0.2 * s)} ${f(cx - 0.933 * s)} ${f(ly + r * 0.5)}` +
    `A${f(r)} ${f(r)} 0 1 1 ${f(cx)} ${f(ly)}` +
    `A${f(r)} ${f(r)} 0 1 1 ${f(cx + 0.933 * s)} ${f(ly + r * 0.5)}` +
    `C${f(cx + 0.86 * s)} ${f(cy + 0.2 * s)} ${f(cx + 0.3 * s)} ${f(cy + 0.52 * s)} ${f(cx)} ${f(cy + 0.78 * s)}Z`
  );
}

/** A small gift bow: two loops meeting over (cx, y). */
function bow(cx: number, y: number, k = 0.5) {
  const p = new Pen(cx, y);
  p.c(cx - 4.7 * k, y - 12 * k, cx - 19 * k, y - 15 * k, cx - 20 * k, y - 6 * k);
  p.c(cx - 21 * k, y, cx - 9 * k, y + 1 * k, cx, y);
  p.c(cx + 4.7 * k, y - 12 * k, cx + 19 * k, y - 15 * k, cx + 20 * k, y - 6 * k);
  p.c(cx + 21 * k, y, cx + 9 * k, y + 1 * k, cx, y);
  return outline(p.close());
}

/** A candle: its body, with the wick running out of the top and bottom (one outline, the wicks there and back). */
function candle(cx: number, wickTop: number, top: number, bottom: number, wickBottom: number, w = 12) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const p = new Pen(cx, wickTop);
  p.to(cx, top).to(x1 - 2, top).arc(x1 - 2, top + 2, 2, 2, -90, 0);
  p.to(x1, bottom - 2).arc(x1 - 2, bottom - 2, 2, 2, 0, 90);
  p.to(cx, bottom).to(cx, wickBottom).to(cx, bottom);
  p.to(x0 + 2, bottom).arc(x0 + 2, bottom - 2, 2, 2, 90, 180);
  p.to(x0, top + 2).arc(x0 + 2, top + 2, 2, 2, 180, 270);
  p.to(cx, top);
  return outline(p.close());
}

/** A market awning: a flat top and a scalloped hem of `n` bells. */
function awning(x: number, y: number, w: number, h: number, n: number) {
  const r = w / n / 2;
  const p = new Pen(x, y);
  p.to(x + w, y).to(x + w, y + h);
  for (let k = 0; k < n; k++) {
    const cx = x + w - r - 2 * r * k;
    p.arc(cx, y + h, r, r * 0.9, 0, 180);
  }
  p.to(x, y);
  return outline(p.close());
}

/** A price tag pointing left, its hole end at (x, y). */
function priceTag(x: number, y: number, w: number, h: number) {
  return roundPoly(
    [
      [x, y],
      [x + h / 2, y - h / 2],
      [x + w, y - h / 2],
      [x + w, y + h / 2],
      [x + h / 2, y + h / 2],
    ],
    [2, 3, 3, 3, 3],
  );
}

/** Map a whole outline from one box into another (the chart shrinking onto a card). */
const into = (o: Outline, [ax, ay]: Pt, [bx, by]: Pt, k: number, ky = k) => mapPoints(o, (x, y) => [bx + (x - ax) * k, by + (y - ay) * ky]);

/* ---- Go live ---------------------------------------------------------------------- */

/**
 * A phone whose Go live button is pressed; the phone becomes the heat ring
 * round your face with the LIVE tag under it; then the room fills: live
 * rings gather round, a gift arrives, hearts rise and the count climbs.
 */
function goLive(): Piece {
  const cast = ["shell", "screen", "face", "ping", "button", "dot", "label", "a1", "f1", "a2", "f2", "a3", "f3", "box", "ribbon", "bow", "h1", "h2"] as const;
  const btn: Pt = [120, 126.5];
  const press = (o?: number) => idle("press", o, btn);
  const dormant = scene(
    cast,
    {
      shell: P(rrect(94, 24, 52, 132, 12), "card"),
      screen: P(rrect(100, 34, 40, 112, 7), "screen"),
      face: P(bust(120, 72, 24), "bar"),
      ping: P(rrect(104, 120, 32, 13, 6.5), "liveHalo", idle("ping", 0, btn)),
      button: P(rrect(104, 120, 32, 13, 6.5), "live", press()),
      dot: P(circle(111.5, 126.5, 1.9), "onLiveDot", press()),
      label: P(bar(116, 124.75, 13, 3.5), "onLiveBar", press()),
    },
    { focus: btn, tuck: [120, 90], hold: 900 },
  );
  const onAir = scene(
    cast,
    {
      shell: P(circle(120, 80, 42), "heat"),
      screen: P(circle(120, 80, 36), "card2"),
      face: P(bust(120, 82, 32, 108), "ink"),
      button: P(rrect(104, 114, 32, 13, 6.5), "live"),
      dot: P(circle(111, 120.5, 1.9), "onLiveDot"),
      label: P(bar(115.5, 118.75, 13, 3.5), "onLiveBar"),
      ping: { fold: [120, 120] },
      a1: { fold: [148, 56] },
      f1: { fold: [148, 56] },
      a2: { fold: [156, 90] },
      f2: { fold: [156, 90] },
      a3: { fold: [84, 72] },
      f3: { fold: [84, 72] },
      box: { fold: [88, 108] },
      ribbon: { fold: [88, 108] },
      bow: { fold: [88, 108] },
      h1: { fold: [140, 52] },
      h2: { fold: [100, 48] },
    },
    { focus: [120, 120], hold: 320, z: ["ping", "shell", "screen", "face", "button", "dot", "label"] },
  );
  const ring: Pt = [110, 80];
  const swell = idle("swell", 0, ring);
  const stage = scene(
    cast,
    {
      ping: P(circle(110, 80, 36), "liveHalo", idle("halo", 0, ring)),
      shell: P(circle(110, 80, 36), "heat", swell),
      screen: P(circle(110, 80, 30.5), "card2", swell),
      face: P(bust(110, 82, 27, 103), "ink", swell),
      button: P(rrect(95, 110, 30, 12, 6), "live"),
      dot: P(circle(101, 116, 1.8), "onLiveDot", idle("blink")),
      label: P(bar(105.5, 114.25, 13, 3.5), "onLiveBar"),
      a1: P(circle(161, 46, 12.5), "ringFace", idle("hover", 0)),
      f1: P(bust(161, 47, 10.5, 55), "ink", idle("hover", 0)),
      a2: P(circle(175, 90, 10), "ringFace", idle("hover", -1.3)),
      f2: P(bust(175, 91, 8.5, 97), "ink", idle("hover", -1.3)),
      a3: P(circle(56, 64, 9.5), "ringFace", idle("hover", -2.4)),
      f3: P(bust(56, 65, 8, 70.5), "ink", idle("hover", -2.4)),
      box: P(rrect(52, 104, 22, 18, 4), "live", idle("hover", -0.7)),
      ribbon: P(line([52, 111], [74, 111], [63, 111], [63, 122]), "onLive", idle("hover", -0.7)),
      bow: P(bow(63, 104, 0.42), "liveHalo", idle("hover", -0.7)),
      h1: P(heart(145, 26, 6), "live", idle("float", 0)),
      h2: P(heart(78, 38, 4.5), "live", idle("float", -2)),
    },
    {
      focus: ring,
      z: ["box", "ribbon", "bow", "a3", "f3", "ping", "shell", "screen", "face", "button", "dot", "label", "a1", "f1", "a2", "f2", "h1", "h2"],
    },
  );
  return { id: "golive", cast, scenes: [dormant, onAir, stage] };
}

/* ---- WorldSpace ------------------------------------------------------------------ */

/**
 * A live tile; the stream ends and becomes a post in the feed (its LIVE tag
 * turning into the like); then the replies come in beside it, one still
 * typing.
 */
function worldSpace(): Piece {
  const cast = ["card", "media", "play", "tag", "avatar", "name", "handle", "caption", "cmt", "b1", "b1bar", "b2", "dots"] as const;
  const dormant = scene(
    cast,
    {
      card: P(rrect(56, 42, 128, 78, 11), "card"),
      media: P(rrect(62, 48, 116, 66, 7), "screen"),
      play: P(roundPoly([[114, 70], [131, 81], [114, 92]], 4), "ink"),
      tag: P(rrect(68, 54, 24, 10, 5), "live", idle("blink")),
      avatar: P(circle(64, 138, 8), "card2"),
      name: P(bar(78, 132, 58, 5), "bar"),
      handle: P(bar(78, 141, 34, 4), "bar", { opacity: 0.6 }),
    },
    { focus: [80, 60], tuck: [120, 81], hold: 600 },
  );
  const posted = scene(
    cast,
    {
      card: P(rrect(70, 22, 100, 136, 12), "card"),
      avatar: P(circle(84, 38, 7), "card2"),
      name: P(bar(96, 33, 44, 4.5), "bar"),
      handle: P(bar(96, 41.5, 26, 4), "bar", { opacity: 0.6 }),
      media: P(rrect(78, 52, 84, 54, 7), "screen"),
      play: P(roundPoly([[115, 72], [128, 79], [115, 86]], 3), "ink"),
      caption: P(bar(78, 114, 70, 4.5), "bar"),
      tag: P(heart(86, 136, 5.5), "ember"),
      cmt: P(rrect(98, 131, 13, 10, 5), "line"),
      b1: { fold: [160, 62] },
      b1bar: { fold: [160, 62] },
      b2: { fold: [160, 100] },
      dots: { fold: [160, 100] },
    },
    { focus: [120, 80], hold: 420 },
  );
  const stage = scene(
    cast,
    {
      card: P(rrect(48, 22, 96, 136, 12), "card"),
      avatar: P(circle(62, 38, 7), "card2"),
      name: P(bar(74, 33, 42, 4.5), "bar"),
      handle: P(bar(74, 41.5, 24, 4), "bar", { opacity: 0.6 }),
      media: P(rrect(56, 52, 80, 52, 7), "screen"),
      play: P(roundPoly([[90, 71], [103, 78], [90, 85]], 3), "ink"),
      caption: P(bar(56, 112, 64, 4.5), "bar"),
      tag: P(heart(64, 136, 5.5), "ember", idle("pop")),
      cmt: P(rrect(76, 131, 13, 10, 5), "line"),
      b1: P(bubble(114, 48, 74, 28, 12, "left"), "card2", idle("hover", 0)),
      b1bar: P(bar(125, 59.75, 50, 4.5), "bar", idle("hover", 0)),
      b2: P(bubble(126, 90, 60, 26, 11, "right"), "hi", idle("hover", -1.6)),
      dots: P(line([145, 103], [165, 103]), "onHiDots", idle("typing")),
    },
    { focus: [150, 80] },
  );
  return { id: "worldspace", cast, scenes: [dormant, posted, stage] };
}

/* ---- Wolf of WorldStreet ------------------------------------------------------------ */

/**
 * Three creators on the start line; the race, someone else ahead; then the
 * podium, the comeback on top, the crown dropping on, and the week's clock
 * running down.
 */
function wolf(): Piece {
  const cast = ["base", "p1", "p2", "p3", "u1", "u2", "u3", "n1", "n2", "n3", "crown", "clock", "hand"] as const;
  const step = (x: number, top: number) => rrect(x, top, 32, 140 - top, [5, 5, 0, 0]);
  const clockAt: Pt = [178, 40];
  const clock = {
    clock: P(circle(clockAt[0], clockAt[1], 10), "slot", idle("spinBack")),
    hand: P(line(clockAt, [clockAt[0], clockAt[1] - 6.5]), "inkLine", idle("spin", 0, clockAt)),
  };
  const dormant = scene(
    cast,
    {
      base: P(line([46, 140], [194, 140]), "soft"),
      p1: P(step(62, 130), "card2"),
      p2: P(step(104, 130), "card2"),
      p3: P(step(146, 130), "card2"),
      u1: P(bustOn(78, 130, 26), "ink"),
      u2: P(bustOn(120, 130, 26), "ink"),
      u3: P(bustOn(162, 130, 26), "ink"),
      ...clock,
    },
    { focus: [120, 140], tuck: [120, 120], hold: 380 },
  );
  const race = scene(
    cast,
    {
      base: P(line([46, 140], [194, 140]), "soft"),
      p1: P(step(62, 96), "card2"),
      p2: P(step(104, 112), "card2"),
      p3: P(step(146, 80), "card2"),
      u1: P(bustOn(78, 96, 26), "ink"),
      u2: P(bustOn(120, 112, 26), "ink"),
      u3: P(bustOn(162, 80, 26), "ink"),
      ...clock,
    },
    { focus: [120, 140], tuck: [120, 110], hold: 460 },
  );
  const stage = scene(
    cast,
    {
      base: P(line([46, 140], [194, 140]), "soft"),
      p1: P(step(62, 98), "card2"),
      p2: P(step(104, 78), "card"),
      p3: P(step(146, 112), "card2"),
      u1: P(bustOn(78, 98, 26), "ink", idle("nod", -0.8)),
      u2: P(bustOn(120, 78, 28), "hi", idle("nod", 0)),
      u3: P(bustOn(162, 112, 26), "ink", idle("nod", -2.1)),
      n1: P(at(digit(2), 78, 120, 0.75), "line"),
      n2: P(at(digit(1), 120, 110, 0.85), "line"),
      n3: P(at(digit(3), 162, 127, 0.6), "line"),
      crown: P(crown(120, 44, 24, 14), "ember", idle("crown", 0, "bottom")),
      ...clock,
    },
    { focus: [120, 60], tuck: [120, 30] },
  );
  return { id: "wolf", cast, scenes: [dormant, race, stage] };
}

/* ---- Prediction -------------------------------------------------------------------- */

/**
 * A candle chart running up to a dashed "now"; the chart folds onto a card
 * and becomes a question with two answers; the call is made: Up fills,
 * ticked, the split bar leaning its way.
 */
function prediction(): Piece {
  const cast = ["c1", "c2", "c3", "c4", "trend", "now", "card", "q", "q2", "yes", "no", "tick", "split", "splitB"] as const;
  const chart = {
    c1: candle(66, 100, 106, 124, 130),
    c2: candle(90, 88, 94, 112, 120),
    c3: candle(114, 68, 76, 98, 106),
    c4: candle(138, 50, 58, 82, 92),
    trend: line([56, 124], [90, 104], [114, 88], [138, 70], [164, 56]),
    now: line([164, 34], [164, 142]),
  };
  // On the card, the card goes under everything.
  const onCard: (typeof cast)[number][] = ["card", "trend", "now", "c1", "c2", "c3", "c4", "q", "q2", "no", "yes", "tick", "split", "splitB"];
  const small = (o: Outline) => into(o, [56, 34], [68, 36], 0.94, 0.42);
  const dormant = scene(
    cast,
    {
      c1: P(chart.c1, "card"),
      c2: P(chart.c2, "ink"),
      c3: P(chart.c3, "card"),
      c4: P(chart.c4, "card", idle("breathe", 0, "bottom")),
      trend: P(chart.trend, "inkLine"),
      now: P(chart.now, "slot"),
    },
    { focus: [138, 70], tuck: [120, 110], hold: 520, z: onCard },
  );
  const cardParts = {
    card: P(rrect(52, 24, 136, 134, 13), "card"),
    c1: P(small(chart.c1), "card"),
    c2: P(small(chart.c2), "ink"),
    c3: P(small(chart.c3), "card"),
    trend: P(small(chart.trend), "inkLine"),
    now: P(small(chart.now), "slot", idle("shimmer")),
    q: P(bar(66, 88, 84, 5.5), "bar"),
    q2: P(bar(66, 98, 54, 4.5), "bar", { opacity: 0.65 }),
    no: P(rrect(122, 110, 52, 20, 10), "line"),
  };
  const call = scene(
    cast,
    {
      ...cardParts,
      c4: P(small(chart.c4), "card"),
      yes: P(rrect(66, 110, 52, 20, 10), "line"),
      tick: { fold: [92, 120] },
      split: { fold: [66, 140] },
      splitB: { fold: [174, 140] },
    },
    { focus: [120, 70], hold: 380, z: onCard },
  );
  const stage = scene(
    cast,
    {
      ...cardParts,
      c4: P(small(chart.c4), "card", idle("breathe", 0, "bottom")),
      yes: P(rrect(66, 110, 52, 20, 10), "ember", idle("pop", 0, [92, 120])),
      tick: P(line([84, 120], [89, 125], [99, 114.5]), "onEmber", idle("pop", 0, [92, 120])),
      split: P(bar(66, 138, 72, 5), "ember"),
      splitB: P(bar(142, 138, 32, 5), "bar"),
    },
    { focus: [92, 120], z: onCard },
  );
  return { id: "prediction", cast, scenes: [dormant, call, stage] };
}

/* ---- Market Square ---------------------------------------------------------------- */

/**
 * A market stall with three goods on the counter; the goods lift and the
 * counter becomes a bag; they drop in, and a price tag swings off the
 * handle.
 */
function market(): Piece {
  const cast = ["awning", "postL", "postR", "i1", "i2", "i3", "counter", "handle", "string", "tag", "hole"] as const;
  const top = (o: Outline) => into(o, [120, 38], [120, 22], 0.72);
  const stall = awning(52, 38, 136, 18, 6);
  const dormant = scene(
    cast,
    {
      postL: P(line([60, 56], [60, 116]), "line"),
      postR: P(line([180, 56], [180, 116]), "line"),
      awning: P(stall, "card"),
      i1: P(rrect(70, 92, 22, 22, 4), "card2"),
      i2: P(circle(118, 101, 13), "card2"),
      i3: P(rrect(144, 82, 18, 32, 5), "card2"),
      counter: P(rrect(48, 114, 144, 24, 6), "card"),
    },
    { focus: [120, 114], tuck: [120, 100], hold: 400 },
  );
  const bag = roundPoly([[90, 86], [150, 86], [157, 148], [83, 148]], 7);
  const lift = scene(
    cast,
    {
      awning: P(top(stall), "card"),
      postL: { fold: [60, 60] },
      postR: { fold: [180, 60] },
      i1: P(rrect(92, 50, 20, 20, 4), "card2"),
      i2: P(circle(122, 50, 11), "card2"),
      i3: P(rrect(136, 40, 14, 26, 4), "card2"),
      counter: P(bag, "card"),
      handle: P(arcLine(120, 86, 16, 180, 360), "line"),
      string: { fold: [136, 86] },
      tag: { fold: [150, 104] },
      hole: { fold: [150, 104] },
    },
    { focus: [120, 100], hold: 300 },
  );
  const swing = (o?: number) => idle("swing", o, [136, 86]);
  const stage = scene(
    cast,
    {
      awning: P(top(stall), "card"),
      i1: P(rrect(94, 68, 20, 20, 4), "card2", idle("hover", 0)),
      i2: P(circle(122, 72, 11), "card2", idle("hover", -0.9)),
      i3: P(rrect(136, 60, 14, 26, 4), "card2", idle("hover", -1.8)),
      counter: P(bag, "card"),
      handle: P(arcLine(120, 86, 16, 180, 360), "line"),
      string: P(line([136, 86], [146, 104]), "line", swing()),
      tag: P(priceTag(146, 106, 28, 16), "ember", swing()),
      hole: P(circle(152, 106, 2), "onEmber", swing()),
    },
    { focus: [140, 100], z: ["awning", "postL", "postR", "handle", "i1", "i2", "i3", "counter", "string", "tag", "hole"] },
  );
  return { id: "market", cast, scenes: [dormant, lift, stage] };
}

/* ---- lookup ------------------------------------------------------------------------ */

const BUILD: Record<PromoArtId, () => Piece> = { golive: goLive, worldspace: worldSpace, wolf, prediction, market };
const cache = new Map<PromoArtId, Piece>();

/** A piece, built once. Unknown ids fall back to Go live. */
export function pieceOf(id: PromoArtId): Piece {
  const key = id in BUILD ? id : "golive";
  let p = cache.get(key);
  if (!p) {
    p = BUILD[key]();
    cache.set(key, p);
  }
  return p;
}
