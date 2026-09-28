import {
  arcLine,
  at,
  bar,
  bubble,
  bust,
  bustOn,
  circle,
  crescent,
  crown,
  digit,
  dollar,
  flame,
  halfDisc,
  handset,
  line,
  outline,
  Pen,
  rotate,
  roundPoly,
  rrect,
  scale,
  shield,
  sparkle,
  stroke,
  translate,
  type Outline,
  type Pt,
} from "./tour-art-morph";

/**
 * The walkthrough's scenes, all cast from the same twelve actors (see
 * ./tour-art.tsx). Each actor is one outline of the same structure in every
 * scene, so moving between scenes it travels and reshapes into its next
 * job: the phone's screen becomes the lit ring, the LIVE tag becomes the
 * gift's ribbon, the ribbon the coin, and so on.
 *
 * Coordinates are SVG user units in the viewBox "20 10 200 160", the
 * ground disc centred on (120, 90). The story (which scene is which, and
 * where the tour shows it) is the owner's brief, 2026-09-28.
 */

export const TOUR_SCENES = [
  "play",
  "phone-live",
  "countdown",
  "rings",
  "gift",
  "coin",
  "bubble",
  "call",
  "theme",
  "more",
  "layers",
  "stage",
  "second-cam",
  "vivid",
  "shield",
  "streak",
  "podium",
  "calendar",
  "wallet",
  "practice",
] as const;
export type TourScene = (typeof TOUR_SCENES)[number];

/** The cast, bottom to top by default. Names say what each usually plays; any actor can play anything. */
export const ACTORS = ["shell", "panel", "s1", "s2", "s3", "s4", "s5", "s6", "glyph", "stroke", "hero", "mark"] as const;
export type ActorId = (typeof ACTORS)[number];

/** Paint classes in ./tour-art.module.css. Every colour is a theme token. */
export const PAINTS = [
  "card",
  "card2",
  "screen",
  "line",
  "soft",
  "dashed",
  "slot",
  "link",
  "dotRing",
  "dots",
  "dots3",
  "bar",
  "ink",
  "inkLine",
  "hi",
  "onHi",
  "onHiDot",
  "live",
  "liveHalo",
  "heat",
  "ribbon",
  "onLive",
  "onLiveBar",
  "ember",
  "emberLine",
  "coin",
  "coinLine",
] as const;
export type PaintName = (typeof PAINTS)[number];

/** Idle beats: CSS loops on a part at rest (./tour-art.module.css), never the path driver. */
export type IdleKind =
  | "press"
  | "tap"
  | "ping"
  | "beat"
  | "pingTick"
  | "tick1"
  | "tick2"
  | "tick3"
  | "blink"
  | "lid"
  | "drop"
  | "flip"
  | "breathe"
  | "crown"
  | "spin"
  | "spinBack"
  | "twinkle"
  | "typing"
  | "wiggle"
  | "waves"
  | "ripple"
  | "fanBack"
  | "fanMid"
  | "nod"
  | "keyPress"
  | "hover"
  | "shimmer"
  | "flicker"
  | "pop"
  | "coinIn"
  | "swell"
  | "halo"
  | "travel";

/**
 * Loops that start on a shared clock the moment the morph starts (holding
 * their first frame until it lands), so parts that beat together stay in
 * step: the thumb and the Go live button, the countdown's digits and pings.
 */
export const EARLY: ReadonlySet<IdleKind> = new Set<IdleKind>(["press", "tap", "ping", "beat", "pingTick", "tick1", "tick2", "tick3", "halo", "travel"]);

/** Loops whose part is invisible at rest (they only show while looping): hidden outright when motion is reduced. */
export const LOOP_ONLY: ReadonlySet<IdleKind> = new Set<IdleKind>(["ping", "pingTick", "tick2", "tick3", "halo", "travel"]);

export type Idle = {
  kind: IdleKind;
  /** Seconds into the loop's own cycle (negative starts it part-way), so parts that share a loop fall out of step. */
  offset?: number;
  /** Turn or scale about this point (user units) — for parts that move as one — or the part's own base. */
  origin?: Pt | "bottom";
};

export type Pose = { d: Outline; paint: PaintName; opacity?: number; idle?: Idle };
/** A part this scene doesn't need: it folds into a point here and fades. */
export type Fold = { fold: Pt };
export type Cast = Partial<Record<ActorId, Pose | Fold>>;

export type Scene = {
  /** One per actor, in ACTORS order. */
  parts: (Pose | Fold)[];
  /** Where the change starts: parts nearest move first. */
  focus: Pt;
  /** Paint order, bottom to top, as actor indexes. */
  z: number[];
};

export const isPose = (p: Pose | Fold): p is Pose => "d" in p;

const P = (d: Outline, paint: PaintName, more?: { opacity?: number; idle?: Idle }): Pose => ({ d, paint, ...more });
const idle = (kind: IdleKind, offset?: number, origin?: Idle["origin"]): { idle: Idle } => ({ idle: { kind, offset, origin } });

function scene(cast: Cast, opts: { focus: Pt; tuck?: Pt; z?: ActorId[] }): Scene {
  const tuck = opts.tuck ?? opts.focus;
  const parts = ACTORS.map((id) => cast[id] ?? { fold: tuck });
  const order = opts.z ?? ACTORS;
  // Parts not named in `z` sit underneath (they're folded away anyway).
  const z = [...ACTORS.filter((id) => !order.includes(id)), ...order].map((id) => ACTORS.indexOf(id));
  return { parts, focus: opts.focus, z };
}

/* ---- shared drawings ---------------------------------------------------------- */

const PLAY_MARK = () => roundPoly([[108, 68], [145, 90], [108, 112]], 7);

/** The phone for Go live and the countdown. */
const phoneBody = () => rrect(88, 24, 64, 132, 15);
const phoneScreen = () => rrect(95, 38, 50, 110, 8);
const phoneNotch = () => bar(111, 29.5, 18, 4);

function thumb() {
  const t = rotate(rrect(-11, 0, 22, 56, 11), -36, 0, 0);
  return translate(t, 131, 112);
}

/** Radius whose circumference holds a whole number of dash periods, so a dashed ring has no seam. */
const seamless = (r: number, period: number) => (Math.round((2 * Math.PI * r) / period) * period) / (2 * Math.PI);

function bow(cx: number, y: number) {
  const k = 1.17;
  const p = new Pen(cx, y);
  p.c(cx - 4.7 * k, y - 12 * k, cx - 19 * k, y - 15 * k, cx - 20 * k, y - 6 * k);
  p.c(cx - 21 * k, y, cx - 9 * k, y + 1 * k, cx, y);
  p.c(cx + 4.7 * k, y - 12 * k, cx + 19 * k, y - 15 * k, cx + 20 * k, y - 6 * k);
  p.c(cx + 21 * k, y, cx + 9 * k, y + 1 * k, cx, y);
  return outline(p.close());
}

function popover() {
  const [x, y, w, h, r] = [62, 28, 116, 84, 16];
  const p = new Pen(x + r, y);
  p.to(x + w - r, y).arc(x + w - r, y + r, r, r, -90, 0);
  p.to(x + w, y + h - r).arc(x + w - r, y + h - r, r, r, 0, 90);
  p.to(127, y + h).to(121.6, y + h + 5.4);
  p.c(120.7, y + h + 6.3, 119.3, y + h + 6.3, 118.4, y + h + 5.4);
  p.to(113, y + h).to(x + r, y + h).arc(x + r, y + h - r, r, r, 90, 180);
  p.to(x, y + r).arc(x + r, y + r, r, r, 180, 270);
  return outline(p.close());
}

function micStand() {
  const p = new Pen(107, 106);
  p.to(133, 106).to(120, 106).to(120, 92);
  p.arc(120, 70, 22, 22, 90, 0).arc(120, 70, 22, 22, 0, 90).arc(120, 70, 22, 22, 90, 180);
  return stroke(p.open());
}

/* ---- the scenes ------------------------------------------------------------------- */

const BUILD: Record<TourScene, () => Scene> = {
  /** Our play mark in a heat ring: "Xtream". */
  play: () =>
    scene(
      {
        panel: P(circle(120, 90, 40), "card"),
        hero: P(PLAY_MARK(), "hi"),
        stroke: P(circle(120, 90, 52), "heat", idle("swell")),
        s1: P(circle(120, 90, 52), "liveHalo", idle("halo")),
      },
      { focus: [120, 90] },
    ),

  /** A phone whose screen holds a big red Go live button, a thumb tapping it. */
  "phone-live": () =>
    scene(
      {
        shell: P(phoneBody(), "card"),
        panel: P(phoneScreen(), "screen"),
        glyph: P(phoneNotch(), "bar"),
        s1: P(bar(103, 50, 34), "bar"),
        s2: P(bar(103, 59, 22), "bar"),
        s3: P(bar(106, 128, 28), "bar"),
        stroke: P(circle(120, 102, 17), "liveHalo", idle("ping")),
        hero: P(circle(120, 102, 17), "live", idle("press")),
        mark: P(thumb(), "card", idle("tap")),
      },
      { focus: [120, 102], tuck: [120, 102] },
    ),

  /** The phone with 3·2·1 in the button: going live. */
  countdown: () =>
    scene(
      {
        shell: P(phoneBody(), "card"),
        panel: P(phoneScreen(), "screen"),
        glyph: P(phoneNotch(), "bar"),
        s4: P(bar(100, 133, 40), "bar"),
        stroke: P(circle(120, 94, 26), "liveHalo", idle("pingTick")),
        hero: P(circle(120, 94, 26), "live", idle("beat")),
        s1: P(at(digit(3), 120, 94, 1.1), "onLive", idle("tick1")),
        s2: P(at(digit(2), 120, 94, 1.1), "onLive", idle("tick2")),
        s3: P(at(digit(1), 120, 94, 1.1), "onLive", idle("tick3")),
        mark: { fold: [168, 168] },
      },
      {
        focus: [120, 94],
        z: ["shell", "panel", "glyph", "s4", "stroke", "hero", "s1", "s2", "s3", "mark"],
      },
    ),

  /** A row of avatar rings, the first one lit with heat, a LIVE tag. */
  rings: () =>
    scene(
      {
        panel: P(circle(62, 88, 21), "card"),
        glyph: P(bust(62, 88, 21), "bar"),
        stroke: P(circle(62, 88, 27), "heat"),
        hero: P(rrect(46, 107, 32, 13, 6.5), "live", idle("blink")),
        mark: P(bar(54, 111.75, 16, 3.5), "onLiveBar", idle("blink")),
        s1: P(circle(112, 88, 18), "card"),
        s2: P(circle(154, 88, 18), "card"),
        s3: P(circle(196, 88, 18), "card", { opacity: 0.45 }),
        s4: P(bust(112, 88, 18), "bar"),
        s5: P(bust(154, 88, 18), "bar"),
        s6: P(bust(196, 88, 18), "bar", { opacity: 0.45 }),
      },
      { focus: [62, 88] },
    ),

  /** A gift box, Chili ribbon, lid lifting. */
  gift: () => {
    const lid = idle("lid", 0, [72, 79]);
    return scene(
      {
        panel: P(rrect(79, 77, 82, 62, 10), "card"),
        s1: P(rrect(114, 78, 12, 60, 0), "live"),
        s2: P(rrect(72, 58, 96, 21, 8), "card", lid),
        stroke: P(bow(120, 58), "ribbon", lid),
        hero: P(rrect(114, 59, 12, 19, 0), "live", lid),
      },
      { focus: [120, 70], tuck: [120, 108] },
    );
  },

  /** The gift opens into a coin stack: money, points to $. */
  coin: () => {
    const flip = idle("flip", 0, [152, 92]);
    const edge = (y: number) => rrect(60, y, 62, 13, 6.5);
    return scene(
      {
        s1: P(edge(112), "coin"),
        s2: P(edge(100), "coin"),
        s3: P(edge(88), "coin"),
        s4: P(edge(76), "coin", idle("drop")),
        hero: P(circle(152, 92, 28), "coin", flip),
        stroke: P(circle(152, 92, 19), "coinLine", flip),
        glyph: P(at(dollar(), 152, 92, 1.05), "coinLine", flip),
      },
      {
        focus: [152, 92],
        z: ["shell", "panel", "s1", "s2", "s3", "s4", "s5", "s6", "hero", "stroke", "glyph", "mark"],
      },
    );
  },

  /** Two chat bubbles, one tail each side (Xtream + WorldSpace). */
  bubble: () =>
    scene(
      {
        shell: P(bubble(36, 34, 112, 48, 16, "left"), "card"),
        s1: P(bar(52, 50, 64, 5), "bar"),
        s2: P(bar(52, 62, 40, 5), "bar"),
        panel: P(bubble(94, 96, 108, 44, 16, "right"), "hi"),
        s3: P(circle(134, 118, 3.8), "onHiDot", idle("typing", 0)),
        s4: P(circle(148, 118, 3.8), "onHiDot", idle("typing", 0.16)),
        s5: P(circle(162, 118, 3.8), "onHiDot", idle("typing", 0.32)),
      },
      { focus: [92, 58], tuck: [120, 90] },
    ),

  /** The bubbles fold into a phone handset, ringing. */
  call: () => {
    const phone = rotate(translate(scale(handset(), 1.12, 5, 29), 108, 69), -45, 113, 98);
    return scene(
      {
        shell: P(circle(120, 90, 46), "card"),
        panel: P(phone, "hi", idle("wiggle")),
        stroke: P(arcLine(113, 97, 27, -80, -10), "line", idle("waves", 0)),
        glyph: P(arcLine(113, 97, 37, -78, -12), "line", idle("waves", 0.1)),
      },
      { focus: [113, 97], tuck: [113, 97] },
    );
  },

  /** A disc half sun, half moon: light and dark. */
  theme: () => {
    const ray = (a: number) => {
      const r = (a * Math.PI) / 180;
      return line([120 + 53 * Math.cos(r), 90 + 53 * Math.sin(r)], [120 + 62 * Math.cos(r), 90 + 62 * Math.sin(r)]);
    };
    return scene(
      {
        shell: P(circle(120, 90, 44), "card"),
        panel: P(halfDisc(120, 90, 44), "hi"),
        s1: P(ray(136), "inkLine", idle("twinkle", -0.2)),
        s2: P(ray(158), "inkLine", idle("twinkle", -0.9)),
        s3: P(ray(180), "inkLine", idle("twinkle", -1.6)),
        s4: P(ray(202), "inkLine", idle("twinkle", -2.3)),
        s5: P(ray(224), "inkLine", idle("twinkle", -3.0)),
        hero: P(crescent(141, 80, 13, 5.5, -3.5, 11.5), "hi"),
        s6: P(sparkle(152, 109, 5.5), "hi", idle("twinkle", -1.2)),
        mark: P(sparkle(162, 94, 3.2), "hi", idle("twinkle", -2.4)),
      },
      { focus: [120, 90] },
    );
  },

  /** Three dots that fan out into a small tray of tiles: the More menu. */
  more: () => {
    const tile = (x: number, y: number, k: number) => P(rrect(x, y, 30, 30, 9), "card2", idle("ripple", -3.6 + k * 0.08));
    return scene(
      {
        shell: P(popover(), "card"),
        s1: tile(70, 38, 0),
        s2: tile(105, 38, 1),
        s3: tile(140, 38, 2),
        s4: tile(70, 72, 3),
        s5: tile(105, 72, 4),
        s6: tile(140, 72, 5),
        panel: P(circle(120, 138, 13), "card"),
        glyph: P(line([111, 138], [129, 138]), "dots3"),
      },
      { focus: [120, 138] },
    );
  },

  /** Three stacked cards shifting: scenes and layouts. */
  layers: () => {
    const card = () => rrect(66, 58, 118, 80, 12);
    const back = (k: number, deg: number) => rotate(translate(card(), -8 * k, -8 * k), deg, 125 - 8 * k, 98 - 8 * k);
    return scene(
      {
        s1: P(back(2, -8), "card2", idle("fanBack")),
        s2: P(back(1, -4), "card2", idle("fanMid")),
        shell: P(card(), "card"),
        panel: P(rrect(76, 68, 64, 60, 7), "bar"),
        s3: P(rrect(146, 68, 28, 28, 6), "bar"),
        s4: P(rrect(146, 100, 28, 28, 6), "bar"),
        hero: P(circle(86, 78, 3.6), "live", idle("blink")),
      },
      {
        focus: [125, 98],
        z: ["s1", "s2", "shell", "panel", "s3", "s4", "s5", "s6", "glyph", "stroke", "hero", "mark"],
      },
    );
  },

  /** Figures in frames: guests on stage. */
  stage: () => {
    const frame = (x: number, y: number) => rrect(x, y, 62, 46, 10);
    return scene(
      {
        panel: P(frame(54, 40), "card"),
        s1: P(frame(124, 40), "card"),
        s2: P(frame(54, 94), "card"),
        s3: P(frame(124, 94), "slot"),
        s4: P(bust(85, 63, 24, 85), "bar", idle("nod", -0.4)),
        s5: P(bust(155, 63, 24, 85), "bar", idle("nod", -2.1)),
        s6: P(bust(85, 117, 24, 139), "bar", idle("nod", -3.3)),
        glyph: P(line([155, 109], [155, 125], [155, 117], [147, 117], [163, 117]), "inkLine", idle("twinkle")),
        hero: P(circle(64, 50, 3.6), "live", idle("blink")),
      },
      { focus: [85, 63], tuck: [120, 90] },
    );
  },

  /** A laptop and a phone side by side, a line linking them: the phone as a second camera. */
  "second-cam": () =>
    scene(
      {
        shell: P(rrect(34, 46, 100, 66, 10), "card"),
        panel: P(rrect(26, 114, 116, 9, [2, 2, 5, 5]), "card2"),
        s1: P(rrect(42, 54, 84, 50, 6), "bar"),
        s2: P(rrect(96, 76, 24, 22, 5), "card"),
        s3: P(bust(108, 87, 11, 97), "bar"),
        s4: P(rrect(164, 46, 38, 74, 10), "card"),
        glyph: P(bar(176, 52, 14, 3.5), "bar"),
        s5: P(circle(183, 83, 9), "line"),
        stroke: P(line([160, 83], [136, 83]), "link"),
        hero: P(circle(183, 83, 4), "live", idle("blink")),
        mark: P(circle(158, 83, 2.6), "ink", idle("travel")),
      },
      { focus: [183, 83], tuck: [150, 83] },
    ),

  /** A soft voice wave rising from a mic: Vivid (never the dot sphere). */
  vivid: () => {
    const level = (x: number, h: number, offset: number) => P(bar(x - 3.5, 64 - h / 2, 7, h), "ink", idle("breathe", offset));
    const key = idle("keyPress");
    return scene(
      {
        panel: P(rrect(106, 38, 28, 52, 14), "card"),
        stroke: P(micStand(), "line"),
        s1: level(66, 14, -0.2),
        s2: level(79, 30, -0.65),
        s3: level(92, 20, -1.05),
        s4: level(148, 20, -0.45),
        s5: level(161, 30, -0.9),
        s6: level(174, 14, -0.1),
        hero: P(rrect(150, 106, 30, 28, 8), "card2", key),
        glyph: P(line([158, 114], [165, 126], [172, 114]), "emberLine", key),
      },
      { focus: [120, 64], z: ["shell", "panel", "s1", "s2", "s3", "s4", "s5", "s6", "stroke", "hero", "glyph", "mark"] },
    );
  },

  /** A shield over a screen with a blurred card: the privacy shield. */
  shield: () => {
    const hover = idle("hover");
    return scene(
      {
        shell: P(rrect(38, 40, 128, 90, 12), "card"),
        panel: P(rrect(52, 54, 80, 50, 8), "card2"),
        s1: P(bar(62, 65, 50, 8), "bar", idle("shimmer")),
        s2: P(bar(62, 80, 34, 8), "bar", idle("shimmer", -1.2)),
        s3: P(bar(52, 114, 58, 5), "bar"),
        hero: P(shield(166, 70, 50, 62), "hi", hover),
        glyph: P(line([156.5, 99], [162.5, 105], [175, 92.5]), "onHi", hover),
      },
      { focus: [166, 100], tuck: [100, 80], z: ["shell", "panel", "s1", "s2", "s3", "s4", "s5", "s6", "stroke", "hero", "glyph", "mark"] },
    );
  },

  /** Seven dots in a row lighting like flames: streaks and quests. */
  streak: () => {
    const x = (k: number) => 44 + k * (152 / 6);
    const fire = (k: number, offset: number) => P(flame(x(k), 91.5, k === 3 ? 11 : 9.5), "ember", idle("flicker", offset, "bottom"));
    return scene(
      {
        shell: P(rrect(26, 70, 188, 40, 20), "card"),
        s1: fire(0, -0.3),
        s2: fire(1, -0.9),
        s3: fire(2, -1.4),
        hero: fire(3, 0),
        s4: P(circle(x(4), 90, 6), "soft", idle("blink")),
        s5: P(circle(x(5), 90, 6), "soft"),
        s6: P(circle(x(6), 90, 6), "soft"),
        glyph: P(bar(88, 124, 64, 5), "bar"),
      },
      { focus: [x(3), 90] },
    );
  },

  /** Three steps, a crown dropping: top gifters. */
  podium: () =>
    scene(
      {
        stroke: P(line([40, 140], [200, 140]), "line"),
        s1: P(rrect(52, 100, 40, 40, [7, 7, 2, 2]), "card2"),
        s2: P(rrect(96, 84, 48, 56, [8, 8, 2, 2]), "card"),
        s3: P(rrect(148, 110, 40, 30, [7, 7, 2, 2]), "card2"),
        s4: P(bustOn(72, 99, 22), "bar"),
        s5: P(bustOn(120, 83, 26), "bar"),
        s6: P(bustOn(168, 109, 20), "bar"),
        glyph: P(bar(112, 94, 16, 5), "bar"),
        hero: P(crown(120, 49, 25, 16), "ember", idle("crown", 0, "bottom")),
      },
      { focus: [120, 44], tuck: [120, 112] },
    ),

  /** A calendar card with one day lit: schedule. */
  calendar: () =>
    scene(
      {
        shell: P(rrect(54, 38, 132, 106, 12), "card"),
        panel: P(rrect(54, 38, 132, 26, [12, 12, 0, 0]), "card2"),
        s1: P(rrect(82, 30, 8, 16, 4), "card"),
        s2: P(rrect(150, 30, 8, 16, 4), "card"),
        glyph: P(bar(100, 48.75, 40), "bar"),
        s3: P(line([76, 82], [164, 82]), "dots"),
        s4: P(line([76, 104], [164, 104]), "dots"),
        s5: P(line([76, 126], [164, 126]), "dots"),
        hero: P(rrect(132, 94, 20, 20, 6), "ember", idle("pop")),
      },
      { focus: [142, 104], tuck: [120, 104] },
    ),

  /** A wallet card with a balance line and a coin going in. */
  wallet: () => {
    const coinIn = idle("coinIn");
    return scene(
      {
        shell: P(rrect(50, 48, 132, 82, 14), "card2"),
        hero: P(circle(150, 56, 14), "coin", coinIn),
        mark: P(circle(150, 56, 8.5), "coinLine", coinIn),
        panel: P(rrect(42, 68, 148, 72, 14), "card"),
        s1: P(rrect(146, 88, 50, 32, 10), "card2"),
        glyph: P(circle(164, 104, 4), "ink"),
        s2: P(bar(56, 82, 50, 6), "bar"),
        stroke: P(line([56, 124], [72, 116], [86, 120], [102, 106], [116, 110], [132, 96]), "coinLine"),
      },
      {
        focus: [150, 56],
        tuck: [116, 104],
        z: ["shell", "hero", "mark", "panel", "s1", "glyph", "s2", "stroke"],
      },
    );
  },

  /** The play mark in a dashed ring: a practice run nobody sees. */
  practice: () =>
    scene(
      {
        panel: P(circle(120, 90, 40), "card"),
        hero: P(PLAY_MARK(), "ink"),
        stroke: P(circle(120, 90, seamless(52, 11)), "dashed", idle("spin")),
        s1: P(circle(120, 90, seamless(63, 9)), "dotRing", idle("spinBack")),
      },
      { focus: [120, 90] },
    ),
};

const cache = new Map<TourScene, Scene>();

/** A scene's cast, built once. Unknown ids fall back to the play mark. */
export function sceneOf(id: TourScene): Scene {
  const key = id in BUILD ? id : "play";
  let s = cache.get(key);
  if (!s) {
    s = BUILD[key]();
    cache.set(key, s);
  }
  return s;
}
