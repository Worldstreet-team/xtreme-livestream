/**
 * A settled battle as a card worth posting: the words, the numbers and the
 * geometry that the page's card (components/app/battle-result-card.tsx) and
 * its 1080×1350 image (lib/battle-result-png.ts) are both drawn from.
 *
 * Pure on purpose — no DOM, no canvas — so the fitting and the arithmetic
 * are tested in Node (services/api/test/battle-result.test.ts). Anything
 * that needs a text width takes a `Measure` from whoever draws.
 */
import { hostShare, teamName, type BattleSide, type BattleView } from "./battles";

/** The portrait feed size, 4:5. */
export const CARD_W = 1080;
/**
 * Whether the result card wears the chili mark. Off until the chili's
 * artwork is licensed: the card is made to be posted, and a posted image
 * leaves the app — so it wears the wordmark alone until then, in the page
 * and in the image alike.
 */
export const MARK_ON_CARD = false;
export const CARD_H = 1350;

export type SideKey = "host" | "challenger";

/* ---- numbers ---------------------------------------------------------- */

type Precision = "short" | "dollars" | "cents";

const grouped = (n: number) => n.toLocaleString("en-US");

/**
 * A score as the card writes it, from USD cents: cents while they matter
 * ("$0.30", "$12.50"), whole dollars from $100 ("$1,234"), and short from a
 * million ("$1.25M") — each side gets half the card's width.
 */
export function formatScore(minor: number, precision: Precision = "short"): string {
  const cents = Math.max(0, Math.round(Number.isFinite(minor) ? minor : 0));
  if (precision === "short" && cents >= 100_000_000) {
    const m = cents / 100_000_000;
    return `$${Number(m.toFixed(m >= 100 ? 0 : m >= 10 ? 1 : 2))}M`;
  }
  if (precision !== "cents" && cents >= 10_000) return `$${grouped(Math.round(cents / 100))}`;
  const rest = cents % 100;
  return `$${grouped(Math.floor(cents / 100))}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/**
 * Both sides' scores, written so they never say what the numbers don't:
 * when rounding makes two different scores look the same, both are written
 * finer until they differ ("$1.2M" becomes "$1,234,500", "$1,234" becomes
 * "$1,234.40"). Rounding never swaps who's ahead — it can only tie them.
 */
export function formatScorePair(host: number, challenger: number): { host: string; challenger: string } {
  const same = Math.round(host) === Math.round(challenger);
  let pair = { host: "", challenger: "" };
  for (const p of ["short", "dollars", "cents"] as const) {
    pair = { host: formatScore(host, p), challenger: formatScore(challenger, p) };
    if (same || pair.host !== pair.challenger) break;
  }
  return pair;
}

/* ---- faces ------------------------------------------------------------ */

/**
 * Up to two initials for a face with no photo, picked the way UserAvatar
 * picks them ("Ada K" → "AK", "suya_sam" → "SS", "Kemi" → "KE") — but only
 * from letters and digits, so an emoji or an "@" never becomes half of one.
 */
export function initialsOf(name: string): string {
  const words = (name ?? "")
    .split(/[\s_]+/u)
    .map((w) => Array.from(w).filter((c) => /[\p{L}\p{N}]/u.test(c)))
    .filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  const picked = words.length >= 2 ? [words[0][0], words[1][0]] : words[0].slice(0, 2);
  return picked.join("").toUpperCase();
}

/**
 * UserAvatar's fills for a face with no photo — warm neutrals and the two
 * brand tints — as colours a canvas can paint, chosen by the same hash so
 * a face without a photo looks the same on the image as in the app.
 */
const DISCS = [
  { fill: "#261e1f", ink: "rgba(246, 241, 238, 0.85)" },
  { fill: "#30272a", ink: "rgba(246, 241, 238, 0.85)" },
  { fill: "#3a2c2d", ink: "rgba(246, 241, 238, 0.85)" },
  { fill: "rgba(227, 18, 42, 0.25)", ink: "#ff5a66" },
  { fill: "rgba(248, 88, 16, 0.2)", ink: "#ff8a4c" },
] as const;

export function discColors(name: string): { fill: string; ink: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return DISCS[Math.abs(hash) % DISCS.length];
}

/** A 2v2 pair's two faces, as shares of a lone face's radius, and how far they overlap (of the partner's). */
export const PAIR_LEAD = 0.82;
export const PAIR_PARTNER = 0.64;
export const PAIR_OVERLAP = 0.4;

export interface FaceSpot {
  role: "lead" | "partner";
  name: string;
  avatar: string;
  cx: number;
  cy: number;
  r: number;
}

/**
 * Where a side's faces sit in its half. A 1v1 side is one face of radius
 * `r` on (cx, cy). A 2v2 pair is the side's streamer, a little smaller, on
 * the outside and their partner tucked in lower toward the middle — the way
 * the scoreboard draws a pair — so the two pairs face each other across the
 * card. A pair keeps a lone face's bottom edge, so the names under both
 * sides start on one line. Listed in drawing order: the partner goes under.
 */
export function sideFaces(
  side: Pick<BattleSide, "displayName" | "avatar" | "partner">,
  align: "left" | "right",
  cx: number,
  cy: number,
  r: number,
): FaceSpot[] {
  const lead = { role: "lead" as const, name: side.displayName, avatar: side.avatar };
  if (!side.partner) return [{ ...lead, cx, cy, r }];
  const r1 = Math.round(r * PAIR_LEAD);
  const r2 = Math.round(r * PAIR_PARTNER);
  const overlap = Math.round(r2 * PAIR_OVERLAP);
  const width = 2 * r1 + 2 * r2 - overlap;
  const inward = align === "left" ? 1 : -1;
  const leadX = cx - inward * (width / 2 - r1);
  const bottom = cy + r;
  return [
    { role: "partner", name: side.partner.displayName, avatar: side.partner.avatar, cx: leadX + inward * (r1 + r2 - overlap), cy: bottom - r2, r: r2 },
    { ...lead, cx: leadX, cy: bottom - r1, r: r1 },
  ];
}

/** A side's name as the card sets it: the streamer, and a pair's partner on a line of their own. */
export function nameLines(side: Pick<BattleSide, "displayName" | "partner">): string[] {
  return side.partner ? [side.displayName, `& ${side.partner.displayName}`] : [side.displayName];
}

/* ---- text ------------------------------------------------------------- */

/** How wide `text` sets at `size` px, in whatever face the caller measures with. */
export type Measure = (text: string, size: number) => number;

const ELLIPSIS = "…";

/** Letters as a reader counts them — an accent stays on its letter, an emoji stays whole. */
function graphemes(text: string): string[] {
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** No dangling "Ada &…" or "Kemi,…": a cut ends on a word. */
const trimCut = (s: string) => s.replace(/[\s&·,:;\-–—]+$/u, "");

/** `text` cut to fit `maxWidth` with an ellipsis, if it has to be. */
export function ellipsize(text: string, maxWidth: number, width: (t: string) => number): string {
  if (width(text) <= maxWidth) return text;
  const parts = graphemes(text);
  const cut = (n: number) => trimCut(parts.slice(0, n).join(""));
  // The longest start that still fits with its ellipsis.
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(cut(mid) + ELLIPSIS) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const head = cut(lo);
  return head ? head + ELLIPSIS : ELLIPSIS;
}

/**
 * One line at the biggest size from `max` down to `min` that fits
 * `maxWidth`. Past `min` it stays at `min` and loses its end to an ellipsis.
 */
export function fitText(text: string, maxWidth: number, measure: Measure, { max, min }: { max: number; min: number }) {
  const t = text.trim();
  const full = measure(t, max);
  if (full <= maxWidth) return { text: t, size: max, cut: false };
  // Width grows with size near enough in proportion: guess, then walk to the truth.
  let size = Math.min(max - 1, Math.max(min, Math.floor((max * maxWidth) / full)));
  while (size > min && measure(t, size) > maxWidth) size--;
  while (size < max - 1 && measure(t, size + 1) <= maxWidth) size++;
  if (measure(t, size) <= maxWidth) return { text: t, size, cut: false };
  return { text: ellipsize(t, maxWidth, (s) => measure(s, min)), size: min, cut: true };
}

/**
 * Words into at most `maxLines` lines no wider than `maxWidth`. Two lines
 * are balanced — the break that leaves the longer line shortest — so a name
 * never leaves one word dangling on its own; a word too long for a line is
 * broken where it must be, and what still won't fit ends in an ellipsis.
 */
export function wrapLines(text: string, maxWidth: number, width: (t: string) => number, maxLines: number): { lines: string[]; cut: boolean } {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return { lines: [], cut: false };
  const all = words.join(" ");
  if (width(all) <= maxWidth) return { lines: [all], cut: false };
  if (maxLines <= 1) return { lines: [ellipsize(all, maxWidth, width)], cut: true };

  if (maxLines === 2) {
    let best: string[] | null = null;
    let bestWidth = Infinity;
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(" "), words.slice(i).join(" ")];
      const w = Math.max(width(pair[0]), width(pair[1]));
      if (w <= maxWidth && w < bestWidth) {
        best = pair;
        bestWidth = w;
      }
    }
    if (best) return { lines: best, cut: false };
  }

  const lines: string[] = [];
  let rest = words;
  while (rest.length > 0) {
    if (lines.length === maxLines - 1) {
      // The last line takes whatever's left, cut to fit.
      const tail = rest.join(" ");
      const fits = width(tail) <= maxWidth;
      lines.push(fits ? tail : ellipsize(tail, maxWidth, width));
      return { lines, cut: !fits };
    }
    let n = 0;
    while (n < rest.length && width(rest.slice(0, n + 1).join(" ")) <= maxWidth) n++;
    if (n > 0) {
      lines.push(rest.slice(0, n).join(" "));
      rest = rest.slice(n);
      continue;
    }
    // One word wider than a whole line: break it where it has to break.
    const parts = graphemes(rest[0]);
    let k = parts.length - 1;
    while (k > 1 && width(parts.slice(0, k).join("")) > maxWidth) k--;
    lines.push(parts.slice(0, k).join(""));
    rest = [parts.slice(k).join(""), ...rest.slice(1)];
  }
  return { lines, cut: false };
}

export interface LineFit {
  max: number;
  min: number;
  maxLines: number;
  /** One line is kept while it can stay at least this big. */
  oneLineMin?: number;
  /** Once it wraps, no bigger than this — two lines at full size would crowd everything under them. */
  wrapMax?: number;
}

/**
 * The biggest size from `max` to `min` at which `text` sets in at most
 * `maxLines` lines. One line comes first while it can stay at `oneLineMin`
 * or bigger — a headline reads best on one — then the widest wrap.
 */
export function fitLines(text: string, maxWidth: number, measure: Measure, { max, min, maxLines, oneLineMin = min, wrapMax = max }: LineFit) {
  const one = fitText(text, maxWidth, measure, { max, min: Math.max(min, oneLineMin) });
  if (!one.cut) return { lines: [one.text], size: one.size, cut: false };
  for (let size = Math.min(max, wrapMax); size >= min; size--) {
    const wrapped = wrapLines(text, maxWidth, (t) => measure(t, size), maxLines);
    if (!wrapped.cut) return { lines: wrapped.lines, size, cut: false };
  }
  const wrapped = wrapLines(text, maxWidth, (t) => measure(t, min), maxLines);
  return { lines: wrapped.lines, size: min, cut: wrapped.cut };
}

/**
 * `fitLines` for "<name> wins": if even the smallest size can't take it all,
 * the name gives up its end and the verb stays — "Oluwaseun Adebayo… wins",
 * never "Oluwaseun Adebayo-Williams the…".
 */
export function fitLinesKeepingEnd(head: string, end: string, maxWidth: number, measure: Measure, fit: LineFit) {
  const whole = fitLines(`${head}${end}`, maxWidth, measure, fit);
  if (!whole.cut || !end) return whole;
  const parts = graphemes(head);
  const attempt = (n: number) => wrapLines(`${trimCut(parts.slice(0, n).join(""))}${ELLIPSIS}${end}`, maxWidth, (t) => measure(t, fit.min), fit.maxLines);
  let lo = 0;
  let hi = parts.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (!attempt(mid).cut) lo = mid;
    else hi = mid - 1;
  }
  return { lines: attempt(lo).lines, size: fit.min, cut: true };
}

/**
 * A name cut to `max` letters at most — at a word where one is near — for
 * the places a whole 80-letter name can't go: the headline, the victory lap.
 */
export function clipName(name: string, max: number): string {
  const t = name.trim();
  const parts = graphemes(t);
  if (parts.length <= max) return t;
  const head = parts.slice(0, max - 1).join("");
  // Back to the last whole word, unless that loses too much of it — and
  // then past any "of the", which can't end a cut name.
  const atWord = head.replace(/\s+\S*$/u, "");
  const cut = atWord.length >= head.length * 0.6 ? atWord.replace(/(?:\s+(?:the|of|and|a|an))+$/iu, "") : head;
  return `${trimCut(cut)}${ELLIPSIS}`;
}

/** A side as the headline says it: a lone name up to 36 letters, a pair's up to 18 each. */
export function shortTeamName(side: Pick<BattleSide, "displayName" | "partner">) {
  return side.partner ? `${clipName(side.displayName, 18)} & ${clipName(side.partner.displayName, 18)}` : clipName(side.displayName, 36);
}

/* ---- the result ------------------------------------------------------- */

/** Which side won — null for a draw. The server names the winner; a name the view can't place falls back to the scores. */
export function winnerSide(b: Pick<BattleView, "winnerId" | "host" | "challenger">): SideKey | null {
  if (!b.winnerId) return null;
  if (b.winnerId === b.host.userId) return "host";
  if (b.winnerId === b.challenger.userId) return "challenger";
  if (b.host.usdMinor === b.challenger.usdMinor) return null;
  return b.host.usdMinor > b.challenger.usdMinor ? "host" : "challenger";
}

/** "27 Sep 2026", in the reader's own way of writing dates unless told otherwise. */
export function formatResultDate(iso: string | null | undefined, { locale, timeZone }: { locale?: string; timeZone?: string } = {}) {
  const at = iso ? new Date(iso) : new Date();
  const when = Number.isNaN(at.getTime()) ? new Date() : at;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", ...(timeZone ? { timeZone } : {}) }).format(when);
}

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/, "");

/** "xtream-battle-ada-vs-tolu-2026-09-27.png" — the handles, then the day, so a rematch doesn't overwrite the first. */
export function resultFileName(b: Pick<BattleView, "host" | "challenger" | "endsAt">) {
  const name = (s: BattleSide, fallback: string) => slug(s.username) || slug(s.displayName) || fallback;
  const day = (b.endsAt ?? "").slice(0, 10);
  return `xtream-battle-${name(b.host, "host")}-vs-${name(b.challenger, "challenger")}${/^\d{4}-\d{2}-\d{2}$/.test(day) ? `-${day}` : ""}.png`;
}

/** A side's top backers as the card lists them — three at most. */
export function backersOf(side: Pick<BattleSide, "top">) {
  return (side.top ?? []).slice(0, 3);
}

export interface BattleResult {
  winner: SideKey | null;
  /** "Ada K wins", "Ada K & Tolu win", or "It's a draw" — long names cut. */
  headline: string;
  /** The headline's verb (" wins", " win"), kept whole when the name has to give. */
  headlineEnd: string;
  /** Overtime, said once: "Won in overtime", "Still level after overtime". */
  subline: string | null;
  /** "Victory lap · Tolu sings the loser's song" — only with a winner and a forfeit. */
  victoryLap: string | null;
  scores: { host: string; challenger: string };
  /** The host's share of the total, for the bar; a battle nobody scored in sits at half. */
  hostShare: number;
  /** A 2v2: a second line under each side's name. */
  pair: boolean;
  date: string;
  /** What goes with the image when it's shared: who beat whom, and by what. */
  shareText: string;
  fileName: string;
}

/** Everything the card says about a settled battle. */
export function resultOf(b: BattleView, dateOptions: { locale?: string; timeZone?: string } = {}): BattleResult {
  const winner = winnerSide(b);
  const scores = formatScorePair(b.host.usdMinor, b.challenger.usdMinor);
  const won = winner ? b[winner] : null;
  const lost = winner ? b[winner === "host" ? "challenger" : "host"] : null;
  const forfeit = (b.forfeit ?? "").trim();
  const end = won ? ` win${won.partner ? "" : "s"}` : "";
  return {
    winner,
    headline: won ? `${shortTeamName(won)}${end}` : "It's a draw",
    headlineEnd: end,
    subline: b.overtimeUsed ? (won ? "Won in overtime" : "Still level after overtime") : null,
    victoryLap: won && lost && forfeit ? `Victory lap · ${shortTeamName(lost)} ${forfeit}` : null,
    scores,
    hostShare: hostShare(b),
    pair: Boolean(b.host.partner || b.challenger.partner),
    date: formatResultDate(b.endsAt ?? b.startsAt, dateOptions),
    shareText:
      won && lost && winner
        ? `${teamName(won)} beat ${teamName(lost)} ${scores[winner]} to ${scores[winner === "host" ? "challenger" : "host"]} in a battle on Xtream`
        : `${teamName(b.host)} vs ${teamName(b.challenger)}: a draw at ${scores.host} each, on Xtream`,
    fileName: resultFileName(b),
  };
}
