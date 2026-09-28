import {
  CARD_H,
  CARD_W,
  MARK_ON_CARD,
  backersOf,
  discColors,
  fitLines,
  fitLinesKeepingEnd,
  fitText,
  formatScore,
  initialsOf,
  nameLines,
  resultOf,
  sideFaces,
  type BattleResult,
  type Measure,
} from "@/lib/battle-result";
import type { BattleSide, BattleView } from "@/lib/battles";

/**
 * The battle result as a 1080×1350 PNG — the card drawn again, by hand, on a
 * canvas, to the same design at the portrait feed size. No DOM-to-image
 * library: text is set and fitted here (lib/battle-result.ts does the
 * arithmetic), and faces are photos loaded for the canvas. A photo that
 * can't be had cleanly — a server that won't allow it, one that fails or
 * stalls, one that would taint the canvas — is initials in a disc instead.
 */

/** Afterglow as paint: the tokens in app/design-system.css and globals.css. */
const PAINT = {
  ground: "#0b0708",
  ink: "#f6f1ee",
  muted: "#a89f9a",
  chili: "#e3122a",
  chiliHi: "#ff5a66",
  ember: "#f85810",
  emberHi: "#ff8a4c",
  onEmber: "#1c0a03",
  // Gold is money, and only money.
  value: "#f5c76e",
  // Each side's field: its colour at 14% on the ground, as the page's card has it.
  hostField: "rgba(227, 18, 42, 0.14)",
  challengerField: "rgba(248, 88, 16, 0.14)",
  // What a photo sits on while it's still coming in (RemoteImage's bg-white/10).
  photoBed: "rgba(255, 255, 255, 0.1)",
  trophyInk: "#1a1206",
} as const;

/** The foil the #1 wears (--foil) — the winner's trophy, as on the scoreboard. */
const FOIL: Array<[number, string]> = [
  [0, "#fbe3a6"],
  [0.3, "#d29a45"],
  [0.52, "#f7d58c"],
  [0.78, "#a56f2a"],
  [1, "#e9c06f"],
];

/** The trophy the app's Trophy icon draws (Solar's cup-star, bold) on its 24-unit grid. */
const TROPHY: Array<[string, CanvasFillRule]> = [
  [
    "M21.9999 8.16234L21.9999 8.23487C21.9999 9.09561 21.9999 9.52598 21.7927 9.8781C21.5855 10.2302 21.2093 10.4392 20.4569 10.8572L19.6636 11.298C20.2102 9.44984 20.3926 7.46414 20.4601 5.76597C20.4629 5.69316 20.4662 5.61945 20.4695 5.54497L20.4718 5.49279C21.1231 5.71896 21.4887 5.88758 21.7168 6.20408C22 6.59692 22 7.11873 21.9999 8.16234Z",
    "nonzero",
  ],
  [
    "M2 8.16234L2 8.23487C2.00003 9.09561 2.00004 9.52598 2.20723 9.8781C2.41442 10.2302 2.79063 10.4392 3.54305 10.8572L4.33681 11.2982C3.79007 9.45001 3.60767 7.46422 3.54025 5.76597C3.53736 5.69316 3.5341 5.61945 3.53081 5.54497L3.5285 5.49266C2.87701 5.7189 2.51126 5.88752 2.2831 6.20408C1.99996 6.59692 1.99997 7.11873 2 8.16234Z",
    "nonzero",
  ],
  [
    "M12.0002 2C13.7837 2 15.2531 2.15709 16.3771 2.34674C17.5159 2.53887 18.0852 2.63494 18.5609 3.22083C19.0367 3.80673 19.0115 4.43998 18.9612 5.70647C18.7886 10.0545 17.8503 15.4853 12.75 15.9657V19.5H14.1802C14.6569 19.5 15.0673 19.8365 15.1608 20.3039L15.35 21.25H18C18.4142 21.25 18.75 21.5858 18.75 22C18.75 22.4142 18.4142 22.75 18 22.75H6C5.58579 22.75 5.25 22.4142 5.25 22C5.25 21.5858 5.58579 21.25 6 21.25H8.65L8.83922 20.3039C8.93271 19.8365 9.34312 19.5 9.8198 19.5H11.25V15.9657C6.14996 15.4851 5.21169 10.0544 5.03907 5.70647C4.98879 4.43998 4.96365 3.80673 5.43937 3.22083C5.91508 2.63494 6.48445 2.53887 7.62318 2.34674C8.74724 2.15709 10.2166 2 12.0002 2ZM12.9524 6.19887L12.8541 6.02251C12.4741 5.34084 12.2841 5 12 5C11.7159 5 11.5259 5.34084 11.1459 6.02251L11.0476 6.19887C10.9397 6.39258 10.8857 6.48944 10.8015 6.55334C10.7173 6.61725 10.6125 6.64097 10.4028 6.68841L10.2119 6.73161C9.47396 6.89857 9.10501 6.98205 9.01723 7.26432C8.92945 7.54659 9.18097 7.84072 9.68403 8.42898L9.81418 8.58117C9.95713 8.74833 10.0286 8.83191 10.0608 8.93532C10.0929 9.03872 10.0821 9.15023 10.0605 9.37327L10.0408 9.57632C9.96476 10.3612 9.92674 10.7536 10.1565 10.9281C10.3864 11.1025 10.7318 10.9435 11.4227 10.6254L11.6014 10.5431C11.7978 10.4527 11.8959 10.4075 12 10.4075C12.1041 10.4075 12.2022 10.4527 12.3986 10.5431L12.5773 10.6254C13.2682 10.9435 13.6136 11.1025 13.8435 10.9281C14.0733 10.7536 14.0352 10.3612 13.9592 9.57632L13.9395 9.37327C13.9179 9.15023 13.9071 9.03872 13.9392 8.93532C13.9714 8.83191 14.0429 8.74833 14.1858 8.58117L14.316 8.42898C14.819 7.84072 15.0706 7.54659 14.9828 7.26432C14.895 6.98205 14.526 6.89857 13.7881 6.73161L13.5972 6.68841C13.3875 6.64097 13.2827 6.61725 13.1985 6.55334C13.1143 6.48944 13.0603 6.39258 12.9524 6.19887Z",
    "evenodd",
  ],
];

/** Xtream's mark (BrandMark), from this origin — it never taints the canvas. */
const LOGO = { src: "/images/xtream-logo.png", ratio: 289 / 220 };


/** How long a photo gets before its face is drawn as initials. */
const PHOTO_WAIT_MS = 5000;
const FONT_WAIT_MS = 3000;

/* ---- the grid, in image pixels ---------------------------------------- */

const PAD = 64;
const HEADER_H = 60;
/** From the header to the first line of the headline. */
const HEADER_GAP = 36;
/** Between blocks, at least — the room left over is shared out after. */
const GAP = 24;
const MIN_GAP = 12;
const MAX_EXTRA_GAP = 44;
const SUBLINE_H = 48;
const PANEL_GAP = 16;
const PANEL_RADIUS = 32;
const PANEL_PAD_TOP = 36;
const PANEL_PAD_BOTTOM = 30;
const PANEL_PAD_X = 28;
/** A lone face's radius grows into whatever room is left, within these. */
const FACE_MIN = 72;
const FACE_MAX = 168;
const RING = 8;
/** Face ring to name, the name's line, a pair's second line, then the score. */
const NAME_GAP = 22;
const NAME_LINE = 48;
const PARTNER_LINE = 38;
const SCORE_GAP = 14;
const BAR_H = 18;
const LAP_PAD_X = 36;
const LAP_PAD_Y = 20;
const BACKERS_LABEL = 24;
const BACKERS_LABEL_GAP = 18;
const BACKER_R = 24;
const BACKER_ROW_GAP = 12;

type Face = "display" | "money" | "sans" | "mono";
export interface Families {
  display: string;
  sans: string;
  mono: string;
}

/** The app's own faces, by the names next/font gave them on this page. */
export function families(): Families {
  const read = (el: Element, name: string) => getComputedStyle(el).getPropertyValue(name).trim();
  return {
    display: read(document.documentElement, "--font-display") || "Archivo",
    sans: read(document.documentElement, "--font-sans") || "system-ui",
    mono: read(document.body, "--font-geist-mono") || "ui-monospace",
  };
}

/**
 * Setting type the way the app's CSS does: `font-wide` is Archivo stretched
 * (118% there, the nearest keyword here), `font-money` stretched furthest
 * and thin, eyebrows in mono caps spaced 0.16em. The stretch goes in the
 * font shorthand too, for a canvas with no fontStretch; one that honours
 * neither sets it plain — every width is measured in the same context, so
 * the fitting holds either way.
 */
export function typesetter(ctx: CanvasRenderingContext2D, fam: Families) {
  const set = (face: Face, size: number, weight: number) => {
    const family = face === "sans" ? fam.sans : face === "mono" ? fam.mono : fam.display;
    const stretch = face === "money" ? "expanded" : face === "display" ? "semi-expanded" : "normal";
    ctx.font = `${weight} ${stretch === "normal" ? "" : `${stretch} `}${size}px ${family}, sans-serif`;
    if ("fontStretch" in ctx) ctx.fontStretch = stretch;
    const tracking = face === "mono" ? 0.16 : face === "money" ? -0.03 : face === "display" ? -0.02 : 0;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking * size}px`;
  };
  const measure =
    (face: Face, weight: number): Measure =>
    (text, size) => {
      set(face, size, weight);
      return ctx.measureText(text).width;
    };
  const write = (text: string, x: number, y: number, color: string, align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "alphabetic") => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, x, y);
  };
  return { set, measure, write };
}
type Type = ReturnType<typeof typesetter>;

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

type Photos = Map<string, HTMLImageElement | null>;

/**
 * A face: its photo cropped square into a circle, or its initials on the
 * fill UserAvatar would give it. `under` is what the face sits on — the
 * disc fills are see-through, as they are on the page.
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  type: Type,
  photos: Photos,
  person: { name: string; avatar: string },
  cx: number,
  cy: number,
  r: number,
  ring: string,
  ringWidth: number,
  under: string[],
) {
  disc(ctx, cx, cy, r + ringWidth, ring);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  for (const fill of under) {
    ctx.fillStyle = fill;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  const photo = person.avatar ? photos.get(person.avatar) : null;
  if (photo) {
    ctx.fillStyle = PAINT.photoBed;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const s = Math.min(photo.naturalWidth, photo.naturalHeight);
    ctx.drawImage(photo, (photo.naturalWidth - s) / 2, (photo.naturalHeight - s) / 2, s, s, cx - r, cy - r, r * 2, r * 2);
  } else {
    const { fill, ink } = discColors(person.name);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    // UserAvatar sets initials at 40% of the face's width.
    type.set("sans", Math.round(r * 0.8), 600);
    type.write(initialsOf(person.name), cx, cy + r * 0.03, ink, "center", "middle");
  }
  ctx.restore();
}

/** The winner's badge: the trophy on foil, ringed in the ground, at the face's top corner. */
function drawTrophy(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  disc(ctx, cx, cy, r + 6, PAINT.ground);
  const foil = ctx.createLinearGradient(cx - r, cy - r * 0.45, cx + r, cy + r * 0.45);
  for (const [at, color] of FOIL) foil.addColorStop(at, color);
  disc(ctx, cx, cy, r, foil);
  const s = (r * 1.2) / 24;
  ctx.save();
  ctx.translate(cx - 12 * s, cy - 12 * s);
  ctx.scale(s, s);
  ctx.fillStyle = PAINT.trophyInk;
  for (const [d, rule] of TROPHY) ctx.fill(new Path2D(d), rule);
  ctx.restore();
}

/**
 * The whole card. Blocks run top to bottom — headline, the two sides, the
 * bar, the victory lap, the backers — and whatever room they leave goes
 * first into bigger faces, then into the gaps, then around the lot, so a
 * sparse result (no backers, no forfeit) still fills the card.
 */
function drawCard(ctx: CanvasRenderingContext2D, battle: BattleView, result: BattleResult, fam: Families, photos: Photos, logo: HTMLImageElement | null) {
  const type = typesetter(ctx, fam);
  const W = CARD_W;
  const inner = W - 2 * PAD;
  const half = (inner - PANEL_GAP) / 2;
  const sides = [
    { key: "host" as const, side: battle.host, x: PAD, field: PAINT.hostField, ring: PAINT.chili, label: PAINT.chiliHi, align: "left" as const },
    { key: "challenger" as const, side: battle.challenger, x: PAD + half + PANEL_GAP, field: PAINT.challengerField, ring: PAINT.ember, label: PAINT.emberHi, align: "right" as const },
  ];

  ctx.fillStyle = PAINT.ground;
  ctx.fillRect(0, 0, W, CARD_H);

  // ---- the header: the mark and the wordmark; what this is, and when.
  const logoW = HEADER_H * LOGO.ratio;
  if (logo) ctx.drawImage(logo, PAD, PAD, logoW, HEADER_H);
  type.set("sans", 44, 700);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-1px";
  type.write("Xtream", logo ? PAD + logoW + 14 : PAD, PAD + HEADER_H / 2 + 2, PAINT.ink, "left", "middle");
  type.set("mono", 22, 500);
  type.write((result.pair ? "2v2 battle result" : "Battle result").toUpperCase(), W - PAD, PAD + 15, PAINT.muted, "right", "middle");
  type.set("sans", 28, 500);
  type.write(result.date, W - PAD, PAD + 47, PAINT.ink, "right", "middle");

  // ---- measure every block before placing any.
  const headline = fitLinesKeepingEnd(result.headline.slice(0, result.headline.length - result.headlineEnd.length), result.headlineEnd, inner, type.measure("display", 800), {
    max: 112,
    min: 60,
    maxLines: 2,
    oneLineMin: 84,
    wrapMax: 80,
  });
  const headLine = Math.round(headline.size * 1.02);
  const headlineH = headline.lines.length * headLine + (result.subline ? SUBLINE_H : 0);

  const textWidth = half - 2 * PANEL_PAD_X;
  const names = sides.map(({ side }) => {
    const [lead, partner] = nameLines(side);
    return {
      lead: fitText(lead, textWidth, type.measure("display", 700), { max: 46, min: 28 }),
      partner: partner ? fitText(partner, textWidth, type.measure("sans", 600), { max: 32, min: 24 }) : null,
    };
  });
  // Both scores at one size, so neither looks bigger than it is.
  const scoreText = [result.scores.host, result.scores.challenger];
  const scoreMax = result.pair ? 84 : 92;
  const scoreSize = Math.min(...scoreText.map((s) => fitText(s, textWidth, type.measure("money", 300), { max: scoreMax, min: 40 }).size));
  const nameH = NAME_LINE + (result.pair ? PARTNER_LINE : 0);
  const scoreH = Math.round(scoreSize * 0.86);
  const panelFixed = PANEL_PAD_TOP + 2 * RING + NAME_GAP + nameH + SCORE_GAP + scoreH + PANEL_PAD_BOTTOM;

  const lap = result.victoryLap
    ? fitLines(result.victoryLap, inner - 2 * LAP_PAD_X, type.measure("display", 700), { max: 34, min: 26, maxLines: 2 })
    : null;
  const lapLine = lap ? Math.round(lap.size * 1.28) : 0;
  const lapH = lap ? lap.lines.length * lapLine + 2 * LAP_PAD_Y : 0;

  const backers = sides.map(({ side }) => backersOf(side));
  const anyBackers = backers.some((list) => list.length > 0);
  const backersH = anyBackers ? BACKERS_LABEL + BACKERS_LABEL_GAP + 3 * (2 * BACKER_R) + 2 * BACKER_ROW_GAP : 0;

  // The faces take the room first, then the gaps; what's left goes around it all.
  const gaps = 2 + (lap ? 1 : 0) + (anyBackers ? 1 : 0);
  const top = PAD + HEADER_H + HEADER_GAP;
  const room = CARD_H - PAD - top;
  const fixed = headlineH + panelFixed + BAR_H + lapH + backersH;
  const faceR = Math.max(FACE_MIN, Math.min(FACE_MAX, Math.floor((room - fixed - gaps * GAP) / 2)));
  let spare = room - fixed - 2 * faceR - gaps * GAP;
  const gap = spare >= 0 ? GAP + Math.min(MAX_EXTRA_GAP, spare / (gaps + 2)) : Math.max(MIN_GAP, GAP + spare / gaps);
  spare = room - fixed - 2 * faceR - gaps * gap;
  let y = top + Math.max(0, spare / 2);

  // ---- the headline: who won, or that nobody did.
  type.set("display", headline.size, 800);
  headline.lines.forEach((line, i) => type.write(line, W / 2, y + i * headLine + headline.size * 0.8, PAINT.ink, "center"));
  if (result.subline) {
    type.set("sans", 30, 500);
    type.write(result.subline, W / 2, y + headline.lines.length * headLine + 36, PAINT.muted, "center");
  }
  y += headlineH + gap;

  // ---- the two sides: their fields, faces, names and scores.
  const panelH = panelFixed + 2 * faceR;
  const faceY = y + PANEL_PAD_TOP + RING + faceR;
  sides.forEach(({ key, side, x, field, ring, align }, i) => {
    ctx.fillStyle = field;
    roundRect(ctx, x, y, half, panelH, PANEL_RADIUS);
    ctx.fill();
    const cx = x + half / 2;
    const faces = sideFaces(side, align, cx, faceY, faceR);
    for (const face of faces) {
      drawFace(ctx, type, photos, { name: face.name, avatar: face.avatar }, face.cx, face.cy, face.r, ring, RING, [PAINT.ground, field]);
    }
    const lead = faces[faces.length - 1];
    if (result.winner === key) {
      const badge = Math.max(26, Math.round(faceR * 0.25));
      drawTrophy(ctx, lead.cx + lead.r * 0.72, lead.cy - lead.r * 0.72, badge);
    }
    const nameTop = faceY + faceR + RING + NAME_GAP;
    const n = names[i];
    type.set("display", n.lead.size, 700);
    type.write(n.lead.text, cx, nameTop + 36, PAINT.ink, "center");
    if (n.partner) {
      type.set("sans", n.partner.size, 600);
      type.write(n.partner.text, cx, nameTop + NAME_LINE + 28, PAINT.muted, "center");
    }
    type.set("money", scoreSize, 300);
    type.write(scoreText[i], cx, nameTop + nameH + SCORE_GAP + scoreSize * 0.74, PAINT.value, "center");
  });
  // "VS" where the two fields meet, level with the faces.
  disc(ctx, W / 2, faceY, 40, PAINT.ground);
  type.set("display", 28, 800);
  type.write("VS", W / 2, faceY + 1, PAINT.ink, "center", "middle");
  y += panelH + gap;

  // ---- the bar: each side's share, meeting at a white seam.
  ctx.fillStyle = PAINT.ember;
  roundRect(ctx, PAD, y, inner, BAR_H, BAR_H / 2);
  ctx.fill();
  const seam = PAD + Math.max(BAR_H / 2, Math.min(inner - BAR_H / 2, inner * result.hostShare));
  ctx.fillStyle = PAINT.chili;
  roundRect(ctx, PAD, y, seam - PAD + BAR_H / 2, BAR_H, BAR_H / 2);
  ctx.fill();
  disc(ctx, seam, y + BAR_H / 2, 17, PAINT.ground);
  disc(ctx, seam, y + BAR_H / 2, 11, "#ffffff");
  y += BAR_H + gap;

  // ---- the victory lap: what the loser owes, on ember.
  if (lap) {
    type.set("display", lap.size, 700);
    const widest = Math.max(...lap.lines.map((l) => ctx.measureText(l).width));
    const w = Math.min(inner, widest + 2 * LAP_PAD_X);
    ctx.fillStyle = PAINT.ember;
    roundRect(ctx, (W - w) / 2, y, w, lapH, lap.lines.length > 1 ? 28 : lapH / 2);
    ctx.fill();
    lap.lines.forEach((line, i) => type.write(line, W / 2, y + LAP_PAD_Y + i * lapLine + lapLine / 2 + 1, PAINT.onEmber, "center", "middle"));
    y += lapH + gap;
  }

  // ---- each side's top backers, in its colour, with what their gifts scored.
  if (anyBackers) {
    sides.forEach(({ x, label, ring }, i) => {
      type.set("mono", 22, 500);
      type.write("TOP BACKERS", x + 6, y + BACKERS_LABEL / 2, label, "left", "middle");
      const list = backers[i];
      const rows = y + BACKERS_LABEL + BACKERS_LABEL_GAP;
      if (list.length === 0) {
        type.set("sans", 26, 500);
        type.write("No backers this time", x + 6, rows + BACKER_R, PAINT.muted, "left", "middle");
        return;
      }
      list.forEach((b, row) => {
        const rowY = rows + row * (2 * BACKER_R + BACKER_ROW_GAP);
        const cy = rowY + BACKER_R;
        drawFace(ctx, type, photos, { name: b.displayName, avatar: b.avatar }, x + 6 + BACKER_R, cy, BACKER_R - 3, ring, 3, [PAINT.ground]);
        const amount = formatScore(b.usdMinor);
        type.set("money", 28, 300);
        const amountW = ctx.measureText(amount).width;
        type.write(amount, x + half - 6, cy + 1, PAINT.value, "right", "middle");
        const nameX = x + 6 + 2 * BACKER_R + 16;
        const fit = fitText(b.displayName, x + half - 6 - amountW - 20 - nameX, type.measure("sans", 600), { max: 28, min: 22 });
        type.set("sans", fit.size, 600);
        type.write(fit.text, nameX, cy + 1, PAINT.ink, "left", "middle");
      });
    });
  }
}

/** Everyone whose face is on the card. */
function faces(battle: BattleView): Array<{ name: string; avatar: string }> {
  const sidePeople = (s: BattleSide) => [
    { name: s.displayName, avatar: s.avatar },
    ...(s.partner ? [{ name: s.partner.displayName, avatar: s.partner.avatar }] : []),
    ...backersOf(s).map((b) => ({ name: b.displayName, avatar: b.avatar })),
  ];
  return [...sidePeople(battle.host), ...sidePeople(battle.challenger)];
}

/**
 * A photo for the canvas, or null. Asked for with CORS, so a server that
 * allows it gives a clean image and one that doesn't fails here — rather
 * than tainting the canvas later — and a slow one is given up on.
 */
function loadPhoto(src: string, wait = PHOTO_WAIT_MS): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(ok && img.naturalWidth > 0 ? img : null);
    };
    const timer = setTimeout(() => finish(false), wait);
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    img.src = src;
  });
}

/** The faces the card sets, loaded for what it says — a canvas won't wait for a font. */
export async function loadFonts(fam: Families, text: string) {
  if (typeof document === "undefined" || !document.fonts) return;
  const specs = [`800 64px ${fam.display}`, `700 64px ${fam.display}`, `300 64px ${fam.display}`, `500 64px ${fam.sans}`, `600 64px ${fam.sans}`, `700 64px ${fam.sans}`, `500 64px ${fam.mono}`];
  const loading = Promise.all(specs.map((spec) => document.fonts.load(spec, text).catch(() => [])));
  await Promise.race([loading, new Promise((r) => setTimeout(r, FONT_WAIT_MS))]);
}

export function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The image came out empty"))), "image/png");
    } catch (error) {
      // A tainted canvas throws here, synchronously.
      reject(error);
    }
  });
}

function freshCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the image");
  return { canvas, ctx };
}

/**
 * Draw the battle's result at 1080×1350 and hand back the PNG. If the canvas
 * ends up tainted anyway, the card is drawn again on a fresh one with
 * initials for every face — a tainted canvas stays tainted — so there is
 * always an image to save.
 */
export async function renderBattleResultPng(battle: BattleView, result: BattleResult = resultOf(battle)): Promise<Blob> {
  const fam = families();
  const people = faces(battle);
  const text = [result.headline, result.subline ?? "", result.victoryLap ?? "", result.date, ...people.map((p) => p.name), "Xtream VS TOP BACKERS 2V2 BATTLE RESULT $0123456789,.M&·…"].join(" ");
  const avatars = [...new Set(people.map((p) => p.avatar).filter(Boolean))];
  const [, loaded, logo] = await Promise.all([
    loadFonts(fam, text),
    Promise.all(avatars.map((src) => loadPhoto(src))),
    MARK_ON_CARD ? loadPhoto(LOGO.src) : Promise.resolve(null),
  ]);
  const photos: Photos = new Map(avatars.map((src, i) => [src, loaded[i]]));

  const first = freshCanvas();
  drawCard(first.ctx, battle, result, fam, photos, logo);
  try {
    return await toPng(first.canvas);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "SecurityError")) throw error;
    const again = freshCanvas();
    drawCard(again.ctx, battle, result, fam, new Map(), logo);
    return toPng(again.canvas);
  }
}
