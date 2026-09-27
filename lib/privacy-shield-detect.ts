/**
 * The privacy shield's eyes (Phase 4): what on a shared screen is a secret.
 * Words and QR codes in — read off a downscaled frame by Tesseract and the
 * browser's BarcodeDetector (lib/privacy-shield-ocr.ts) — findings out, as
 * boxes on the frame's 0..1 square. Pure, so it runs in Node for the tests;
 * lib/privacy-shield.ts paints what it finds.
 *
 * What counts, and how it's treated:
 *   - A recovery phrase — a run of 8+ BIP-39 English words in reading
 *     order, list numbers and bullets skipped, OCR slop allowed (a misread
 *     letter, "rn" for "m", a word or two garbled) — hides the whole screen.
 *   - A page about revealing one — "Secret Recovery Phrase", "Export
 *     private key", "Reveal" near "Seed phrase" — hides the whole screen too:
 *     that's the page right before the words appear, so the slate is
 *     already up when detection's second of lag would matter most.
 *   - Private keys get a solid box: 64 hex characters, WIF (5, K or L;
 *     51–52 characters), Solana-style base58 of 87–88, a Solana keypair's
 *     byte array, and extended private keys (xprv, yprv, zprv, tprv…).
 *   - Wallet QR codes (a payment URI or a bare address) get a box.
 *   - Balances (off unless asked): an amount beside a ticker or currency
 *     sign, with a "balance" word next to it. Prices on a chart have no such
 *     word beside them, so they're left alone.
 *
 * Public data stays on screen. A 0x-prefixed 64-hex string is what an
 * explorer shows for a transaction or block hash (and what an Aptos or Sui
 * address looks like) — public, so it's left alone unless the words beside
 * it say "private" or "secret". A bare 64-hex string is how wallets show a
 * private key, so it's covered — unless the words beside it say it's a
 * transaction or block hash (a Bitcoin explorer shows txids bare); 87–88
 * base58 the same way (a Solana signature is that long too). Over-covering
 * is the cheaper mistake, so anything in doubt is covered.
 */

import { BIP39_ENGLISH } from "./bip39-english";

/* ---- shapes ----------------------------------------------------------- */

/** A word as OCR read it, in the analysed image's pixels, in the order it was read. */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0–100. */
  confidence?: number;
}

/** A QR code as the barcode detector found it. */
export interface QrHit {
  rawValue: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ScanInput {
  /** The analysed image's size, in pixels. */
  width: number;
  height: number;
  words: OcrWord[];
  qr?: QrHit[];
}

/** A box on the frame, each side 0..1 of the frame's width or height. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type FindingKind = "phrase" | "private-key" | "extended-key" | "wallet-qr" | "key-page" | "balance";

export interface Finding {
  kind: FindingKind;
  /** Where it is, padded a little past the text. */
  rect: Rect;
  /** Hide the whole screen, not just this box. */
  whole: boolean;
}

export interface Detectors {
  /** Recovery phrases: hide the whole screen. */
  phrases: boolean;
  /** Private keys and extended private keys. */
  keys: boolean;
  /** Wallet QR codes: payment requests and addresses. */
  qr: boolean;
  /** Pages that reveal or export a phrase or key: hide the whole screen. */
  pages: boolean;
  /** Balances on wallet screens. Off by default. */
  balances: boolean;
}

export const DEFAULT_DETECTORS: Detectors = { phrases: true, keys: true, qr: true, pages: true, balances: false };

/** What the host is told, in so many words. */
export const NOTICE_TEXT: Record<FindingKind, string> = {
  phrase: "Hidden: a recovery phrase",
  "key-page": "Hidden: a key export page",
  "private-key": "Hidden: a private key",
  "extended-key": "Hidden: an extended private key",
  "wallet-qr": "Hidden: a wallet QR code",
  balance: "Hidden: a balance",
};

/** Which detector finds each kind — turning one off drops what it found. */
export const DETECTOR_OF: Record<FindingKind, keyof Detectors> = {
  phrase: "phrases",
  "key-page": "pages",
  "private-key": "keys",
  "extended-key": "keys",
  "wallet-qr": "qr",
  balance: "balances",
};

/* ---- the BIP-39 words, and how OCR gets them wrong -------------------- */

const WORDS = new Set(BIP39_ENGLISH);

/** Every word of five letters or more with one letter blanked: a misread letter finds its word. */
const ONE_OFF = new Map<string, true>();
for (const w of BIP39_ENGLISH) {
  if (w.length < 5) continue;
  for (let i = 0; i < w.length; i++) ONE_OFF.set(w.slice(0, i) + "*" + w.slice(i + 1), true);
}

/** Digits and symbols OCR puts in place of letters. */
const AS_LETTER: Record<string, string> = { "0": "o", "1": "l", "|": "l", "!": "l", "5": "s", "$": "s", "4": "a", "@": "a", "3": "e", "8": "b", "9": "g", "6": "b", "7": "t", "2": "z" };

/**
 * The list's words that are also English's glue — "that", "this", "you",
 * "can", "will", "only" — and code's commonest ("true", "type", "error").
 * A sentence that strings eight list words together leans on these; a
 * real phrase, drawn at random, almost never does (66 of the 2048 are
 * here: the chance that half of a 12-word phrase is from here is under
 * one in a million). The rest of these are English that a misread list
 * word can't be ("value" isn't a botched "valve").
 */
const EVERYDAY = new Set(
  (
    "the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all " +
    "would there their what so up out if about who get which go me when make can like time no just him know take people into year your " +
    "good some could them see other than then now look only come its over think also back after use two how our work first well way " +
    "even new want because any these give day most us is are was were has had been being did does done said made went got let may " +
    "might must shall should very much many more such own same too here where why each few both those every again still never always " +
    "often down off once under while true false type error message value name string number null class return function default const case"
  ).split(" ")
);

export type WordMatch = "exact" | "fuzzy";

/**
 * Is this token a BIP-39 word, as OCR might have read it? "exact" when it
 * is one; "fuzzy" for a digit in a letter's place, "rn" for "m" (and the
 * other way), or — at five letters and up — one wrong letter.
 */
export function matchBip39(token: string): WordMatch | null {
  const t = token.toLowerCase();
  if (t.length < 3 || t.length > 9) return null;
  if (WORDS.has(t)) return "exact";
  if (EVERYDAY.has(t)) return null;
  if (/[^a-z]/.test(t) && /[a-z]/.test(t)) {
    const mapped = t.replace(/[^a-z]/g, (c) => AS_LETTER[c] ?? c);
    if (/^[a-z]+$/.test(mapped) && WORDS.has(mapped)) return "fuzzy";
    return null;
  }
  if (!/^[a-z]+$/.test(t)) return null;
  for (const [from, to] of [["rn", "m"], ["m", "rn"], ["cl", "d"], ["vv", "w"], ["li", "h"]] as const) {
    if (t.includes(from) && WORDS.has(t.replaceAll(from, to))) return "fuzzy";
  }
  if (t.length >= 5) {
    for (let i = 0; i < t.length; i++) if (ONE_OFF.has(t.slice(0, i) + "*" + t.slice(i + 1))) return "fuzzy";
  }
  return null;
}

/* ---- layout ----------------------------------------------------------- */

interface W {
  /** Position in OCR's reading order. */
  i: number;
  raw: string;
  /** Quotes, brackets and trailing punctuation off. */
  clean: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  h: number;
  row: number;
}

interface Layout {
  width: number;
  height: number;
  words: W[];
  /** Words grouped into rows by where they sit, top to bottom, each left to right. */
  rows: W[][];
  /** The typical word height — the unit for "near" and "beside". */
  unit: number;
}

const cleanToken = (raw: string) =>
  raw
    .replace(/^[\s"'“”‘’`([{<«]+/u, "")
    .replace(/[\s"'“”‘’`)\]}>».,;:!?]+$/u, "");

function median(values: number[]) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function buildLayout(input: ScanInput): Layout {
  const words: W[] = [];
  input.words.forEach((ow, i) => {
    const raw = (ow.text ?? "").trim();
    if (!raw || !(ow.x1 > ow.x0) || !(ow.y1 > ow.y0)) return;
    words.push({
      i,
      raw,
      clean: cleanToken(raw),
      x0: ow.x0,
      y0: ow.y0,
      x1: ow.x1,
      y1: ow.y1,
      cx: (ow.x0 + ow.x1) / 2,
      cy: (ow.y0 + ow.y1) / 2,
      h: ow.y1 - ow.y0,
      row: -1,
    });
  });
  const unit = Math.max(4, median(words.map((w) => w.h)));

  // Rows: a word joins the row whose middle it shares.
  const byY = [...words].sort((a, b) => a.cy - b.cy);
  const rows: { cy: number; h: number; words: W[] }[] = [];
  for (const w of byY) {
    let home: (typeof rows)[number] | null = null;
    for (let r = rows.length - 1; r >= 0 && r >= rows.length - 4; r--) {
      const row = rows[r];
      if (Math.abs(row.cy - w.cy) <= 0.5 * Math.max(Math.min(row.h, w.h), unit * 0.6)) {
        home = row;
        break;
      }
    }
    if (home) {
      home.words.push(w);
      home.cy = home.words.reduce((s, x) => s + x.cy, 0) / home.words.length;
      home.h = Math.max(home.h, w.h);
    } else {
      rows.push({ cy: w.cy, h: w.h, words: [w] });
    }
  }
  const sorted = rows.sort((a, b) => a.cy - b.cy).map((r) => r.words.sort((a, b) => a.x0 - b.x0));
  sorted.forEach((row, r) => row.forEach((w) => (w.row = r)));
  return { width: input.width, height: input.height, words, rows: sorted, unit };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function union(ws: Box[]): Box {
  return ws.reduce(
    (b, w) => ({ x0: Math.min(b.x0, w.x0), y0: Math.min(b.y0, w.y0), x1: Math.max(b.x1, w.x1), y1: Math.max(b.y1, w.y1) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  );
}

/** A pixel box to the 0..1 square, padded by `pad` pixels (a margin past the glyphs; OCR boxes hug them). */
function toRect(b: Box, L: { width: number; height: number }, pad: number): Rect {
  const x0 = Math.max(0, b.x0 - pad);
  const y0 = Math.max(0, b.y0 - pad);
  const x1 = Math.min(L.width, b.x1 + pad);
  const y1 = Math.min(L.height, b.y1 + pad);
  return { x: x0 / L.width, y: y0 / L.height, w: Math.max(0, x1 - x0) / L.width, h: Math.max(0, y1 - y0) / L.height };
}

/* ---- recovery phrases --------------------------------------------------- */

type Cls = "exact" | "fuzzy" | "pair" | "skip" | "gap" | "stop";
interface Classed {
  cls: Cls;
  /** Title Case: a menu label or a sentence's start, not a phrase word. */
  title: boolean;
  /** One of English's glue words. */
  everyday: boolean;
}

/** A list number ("1", "12.", "#3", "07)") or a bullet: invisible to a run. */
const isFiller = (clean: string, raw: string) => /^#?\d{1,2}[.):]?$/.test(clean) || /^[•·\-–—|*°¦:.,]+$/.test(raw);

function classify(w: W): Classed {
  const t = w.clean;
  if (isFiller(t, w.raw)) return { cls: "skip", title: false, everyday: false };
  // "1.abandon", "12)zoo": the number came along with the word.
  const numbered = /^#?\d{1,2}[.):]?([A-Za-z][A-Za-z0-9|$@!]{2,})$/.exec(t);
  const word = numbered ? numbered[1] : t;
  const title = /^[A-Z][a-z]+$/.test(word);
  const lower = word.toLowerCase();
  const everyday = EVERYDAY.has(lower);
  // Quotes, colons and brackets are code and prose ("message":, 'Bar',), never a phrase on a wallet's screen.
  const rawBody = numbered ? w.raw.replace(/^#?\d{1,2}[.):]?/, "") : w.raw;
  if (/["'“”‘’`:=()[\]{}<>]/.test(rawBody)) return { cls: "stop", title, everyday };
  const m = matchBip39(word);
  if (m) return { cls: m, title, everyday };
  // Two words run together ("abandonability").
  if (/^[a-z]{6,16}$/.test(word)) {
    for (let k = 3; k <= word.length - 3; k++) {
      const a = word.slice(0, k);
      const b = word.slice(k);
      if (WORDS.has(a) && WORDS.has(b)) return { cls: "pair", title: false, everyday: EVERYDAY.has(a) || EVERYDAY.has(b) };
    }
  }
  // A word the OCR mangled past reading can sit inside a run: mostly letters, with a symbol or a digit
  // or two in them ("th#nk"). A clean English word can't — it's what makes a sentence a sentence.
  const odd = (word.match(/[^a-z]/gi) ?? []).length;
  if (word.length >= 3 && word.length <= 10 && odd >= 1 && odd <= 2 && odd <= 0.4 * word.length) return { cls: "gap", title, everyday };
  return { cls: "stop", title, everyday };
}

/** Words that can sit right before a phrase on its line: "Mnemonic: …", "Seed phrase …". */
const LEADS_A_PHRASE = /^(mnemonic|seed|phrase|recovery|secret|words|backup|passphrase)$/i;

/**
 * A phrase is shown as a thing of its own — a grid, a box, a line after a
 * label. A run of list words with words right beside it on both sides, at
 * a word's spacing, on the same line, is the middle of a sentence.
 */
function embedded(L: Layout, run: W[], cls: Map<W, Classed>): boolean {
  const words = run.filter((w) => cls.get(w)?.cls !== "skip");
  if (!words.length) return false;
  const first = words[0];
  const last = words[words.length - 1];
  const tight = L.unit * 1.5;
  const wordish = (w: W | undefined) => Boolean(w && /[a-z]{2,}/i.test(w.clean) && cls.get(w)?.cls === "stop" && !LEADS_A_PHRASE.test(w.clean));
  const row = (w: W) => L.rows[w.row] ?? [];
  const before = row(first).filter((w) => w.x1 <= first.x0 + 1).pop();
  const after = row(last).find((w) => w.x0 >= last.x1 - 1);
  // Both sides: a phrase pasted at the end of a chat line ("my seed is …") still counts.
  return wordish(before) && first.x0 - before!.x1 <= tight && wordish(after) && after!.x0 - last.x1 <= tight;
}

/** Runs of 8+ BIP-39 words in a sequence of words. */
function phraseRuns(seq: W[], cls: Map<W, Classed>): W[][] {
  const out: W[][] = [];
  let run: W[] = [];
  let matched = 0;
  let exact = 0;
  let titles = 0;
  let everyday = 0;
  let gaps = 0;
  let pending: W | null = null;
  /** List numbers since the last word: part of the phrase's box once a word follows them. */
  let fillers: W[] = [];
  const close = () => {
    // Eight words, mostly read cleanly, few in Title Case, not leaning on English's glue, and not
    // the same few words over and over (a menu, a log): a random 12-word phrase repeats three
    // words about once in 30,000 — the famous all-"abandon" test phrases are public anyway.
    const distinct = new Set(run.filter((w) => cls.get(w)?.cls !== "skip").map((w) => w.clean.toLowerCase())).size;
    if (matched >= 8 && exact >= 0.6 * matched && titles <= 0.25 * matched && everyday < 0.5 * matched && distinct >= 0.8 * matched) out.push(run);
    run = [];
    matched = exact = titles = everyday = gaps = 0;
    pending = null;
  };
  for (const w of seq) {
    const c = cls.get(w)!;
    if (c.cls === "skip") {
      fillers.push(w);
      continue;
    }
    const before = fillers;
    fillers = [];
    if (c.cls === "exact" || c.cls === "fuzzy" || c.cls === "pair") {
      if (pending) {
        run.push(pending);
        gaps++;
        pending = null;
      }
      run.push(...before, w);
      matched += c.cls === "pair" ? 2 : 1;
      exact += c.cls === "exact" ? 1 : c.cls === "pair" ? 2 : 0;
      titles += c.title ? 1 : 0;
      everyday += c.everyday ? 1 : 0;
      continue;
    }
    // One garbled word at a time, and a few per phrase: 1 after 4 words, 2 after 12, 3 after 20.
    if (c.cls === "gap" && matched >= 4 && !pending && gaps < Math.floor((matched + 4) / 8)) {
      pending = w;
      continue;
    }
    close();
  }
  close();
  return out;
}

/**
 * Reading order by cuts (the classic XY-cut): split the words at the
 * widest empty gutter — a sidebar's edge, the gap between a grid's
 * columns, the space between blocks — again and again, then read each
 * piece row by row. A sidebar's labels never land in the middle of a
 * phrase grid this way, and a grid's columns read whole.
 */
function cutOrder(L: Layout): W[] {
  const X_GAP = L.unit * 3;
  const Y_GAP = L.unit * 1.8;
  const out: W[] = [];
  const widest = (ws: W[], start: (w: W) => number, end: (w: W) => number) => {
    const s = [...ws].sort((a, b) => start(a) - start(b));
    let reach = end(s[0]);
    let best = { gap: 0, at: 0 };
    for (let i = 1; i < s.length; i++) {
      const gap = start(s[i]) - reach;
      if (gap > best.gap) best = { gap, at: start(s[i]) };
      reach = Math.max(reach, end(s[i]));
    }
    return best;
  };
  const cut = (ws: W[], depth: number) => {
    const x = ws.length > 1 ? widest(ws, (w) => w.x0, (w) => w.x1) : { gap: 0, at: 0 };
    const y = ws.length > 1 ? widest(ws, (w) => w.y0, (w) => w.y1) : { gap: 0, at: 0 };
    const sx = x.gap >= X_GAP ? x.gap / X_GAP : 0;
    const sy = y.gap >= Y_GAP ? y.gap / Y_GAP : 0;
    if ((!sx && !sy) || depth > 40) {
      out.push(...[...ws].sort((a, b) => a.row - b.row || a.x0 - b.x0));
      return;
    }
    const before = (w: W) => (sx >= sy ? w.x0 < x.at : w.y0 < y.at);
    cut(ws.filter(before), depth + 1);
    cut(ws.filter((w) => !before(w)), depth + 1);
  };
  if (L.words.length) cut(L.words, 0);
  return out;
}

function findPhrases(L: Layout): Finding[] {
  const cls = new Map<W, Classed>();
  for (const w of L.words) cls.set(w, classify(w));
  // Reading order three ways: as OCR read it, row by row (a grid read across), and by the page's gutters
  // (a grid's columns read down, whatever sits beside it kept out).
  const runs = [...phraseRuns(L.words, cls), ...phraseRuns(L.rows.flat(), cls), ...phraseRuns(cutOrder(L), cls)].filter((r) => !embedded(L, r, cls));
  return mergeBoxes(runs.map((r) => union(r))).map((b) => ({ kind: "phrase" as const, rect: toRect(b, L, L.unit * 0.6), whole: true }));
}

/** Overlapping boxes as one. */
function mergeBoxes(boxes: Box[]): Box[] {
  const out: Box[] = [];
  for (const b of boxes) {
    const hit = out.find((o) => b.x0 <= o.x1 && b.x1 >= o.x0 && b.y0 <= o.y1 && b.y1 >= o.y0);
    if (hit) Object.assign(hit, union([hit, b]));
    else out.push({ ...b });
  }
  return out;
}

/* ---- keys ------------------------------------------------------------- */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
const NOT_BASE58 = /[^1-9A-HJ-NP-Za-km-z]/g;
const HEX_FIX: Record<string, string> = { O: "0", o: "0", Q: "0", l: "1", I: "1", i: "1", "|": "1", S: "5", s: "5", Z: "2", z: "2", G: "6", g: "9", q: "9" };

/**
 * A hex string OCR nearly got right, look-alikes put back. Tesseract reads
 * a random 64-hex key with an "l" for a "1" or an "o" for a "0" every ten
 * characters or so — and a different few each time — so a long run can
 * carry up to 12% of them. Nothing else that long is that hex-heavy:
 * base58 and base64 are two-thirds letters that aren't hex at all.
 */
function asHex(s: string): string | null {
  if (/^[0-9a-f]+$/i.test(s)) return s;
  let fixes = 0;
  const out = s.replace(/[^0-9a-f]/gi, (c) => {
    fixes++;
    return HEX_FIX[c] ?? "#";
  });
  return fixes <= Math.max(3, Math.floor(s.length * 0.12)) && /^[0-9a-f]+$/i.test(out) ? out : null;
}

const badBase58 = (s: string) => (s.match(NOT_BASE58) ?? []).length;

export type KeyKind = "private-key" | "extended-key" | "tx-hash" | null;

/**
 * What a string on screen is, keys-wise, before looking at what's beside
 * it: a private key, an extended private key, a 0x hash (public until the
 * words beside it say otherwise), or nothing.
 */
export function keyShape(raw: string): { kind: KeyKind; bareHex?: boolean; base58Long?: boolean } {
  const s = raw.trim();
  if (/^[xyztuvXYZTUV]prv[1-9A-HJ-NP-Za-km-z]{16,}/.test(s) && badBase58(s) <= 3) return { kind: "extended-key" };
  // 64 hex, give or take the character or two OCR drops or doubles.
  if (/^0[xX]/.test(s)) {
    const hex = asHex(s.slice(2));
    if (hex && hex.length >= 62 && hex.length <= 67) return { kind: "tx-hash" };
    return { kind: null };
  }
  const hex = asHex(s);
  // Read cleanly as 66 hex starting 02 or 03, it's a compressed public key — public by design.
  const publicKey = hex === s && s.length === 66 && /^0[23]/.test(s);
  if (hex && hex.length >= 62 && hex.length <= 67 && /\d/.test(hex) && /[a-f]/i.test(hex) && !publicKey) return { kind: "private-key", bareHex: true };
  if (/^[5KLc9]/.test(s) && badBase58(s) <= 2 && /^[0-9A-Za-z]+$/.test(s)) {
    const n = s.length;
    const wif = ((s[0] === "5" || s[0] === "9") && n >= 50 && n <= 52) || ((s[0] === "K" || s[0] === "L" || s[0] === "c") && n >= 51 && n <= 53);
    if (wif && /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s)) return { kind: "private-key" };
  }
  if (s.length >= 86 && s.length <= 89 && badBase58(s) <= 2 && /^[0-9A-Za-z]+$/.test(s) && /\d/.test(s)) return { kind: "private-key", base58Long: true };
  return { kind: null };
}

const KEY_WORDS = /\b(private|secret|priv|privkey|wif|mnemonic|seed|keystore|export)\b|private_?key|secret_?key/i;
const TX_WORDS = /\b(tx|txn|txid|txhash|transaction|transactions|hash|signature|sig|block|blockhash|parent|root|receipt)\b/i;

/** The words beside a string: its own row, and the rows just above it (where a label sits). */
function contextOf(L: Layout, row: number, box: Box, self: W[]): string {
  const parts: string[] = [];
  for (let r = row; r >= 0 && r >= row - 3; r--) {
    const words = L.rows[r];
    if (!words.length) continue;
    const rowY = words[0].cy;
    if (r !== row && box.y0 - rowY > L.unit * 4) break;
    for (const w of words) {
      if (self.includes(w)) continue;
      // Above: only what's over the string or to its left, as a label would be.
      if (r !== row && (w.x0 > box.x1 + L.unit * 2 || w.x1 < box.x0 - L.unit * 30)) continue;
      parts.push(w.raw);
    }
  }
  return parts.join(" ");
}

/** A long string of one alphabet, as a candidate for a key broken over lines. */
const chunkish = (s: string) => s.length >= 4 && (/^(0x)?[0-9a-fA-F]+$/.test(s) || BASE58.test(s));

function findKeys(L: Layout): Finding[] {
  const out: Finding[] = [];
  const used = new Set<W>();
  const pad = L.unit * 0.45;

  const judge = (s: string, parts: W[], row: number): FindingKind | null => {
    const shape = keyShape(s);
    if (!shape.kind) return null;
    if (shape.kind === "extended-key") return "extended-key";
    const box = union(parts);
    const inToken = parts.map((p) => p.raw).join(" ");
    const beside = contextOf(L, row, box, parts) + " " + inToken.replace(/[0-9a-fA-F]{20,}/g, " ");
    const keyish = KEY_WORDS.test(beside);
    const txish = TX_WORDS.test(beside) || /\/(tx|txid|block|transaction)\//i.test(inToken);
    if (shape.kind === "tx-hash") return keyish ? "private-key" : null;
    if ((shape.bareHex || shape.base58Long) && txish && !keyish) return null;
    return "private-key";
  };
  const take = (kind: FindingKind, parts: W[]) => {
    parts.forEach((p) => used.add(p));
    out.push({ kind, rect: toRect(union(parts), L, pad), whole: false });
  };

  for (let r = 0; r < L.rows.length; r++) {
    const row = L.rows[r];
    for (let k = 0; k < row.length; k++) {
      const w = row[k];
      if (used.has(w)) continue;
      let hit: FindingKind | null = null;
      // A key broken over lines: the lines under it that start where it
      // starts (or where its row starts, past a label) and read the same
      // alphabet. The longest reading that's a key wins, so the mask
      // covers the whole key, not its first line.
      if (chunkish(w.clean) && w.clean.length >= 12) {
        const parts = [w];
        let last = w;
        for (let rr = r + 1; rr < L.rows.length && rr <= r + 3 && parts.length < 4; rr++) {
          const next = L.rows[rr].find(
            (n) =>
              !used.has(n) &&
              (Math.abs(n.x0 - w.x0) <= L.unit * 2.5 || Math.abs(n.x0 - row[0].x0) <= L.unit * 2.5) &&
              n.cy - last.cy <= L.unit * 2.6 &&
              chunkish(n.clean)
          );
          if (!next) break;
          parts.push(next);
          last = next;
        }
        for (let n = parts.length; n >= 2 && !hit; n--) {
          hit = judge(parts.slice(0, n).map((p) => p.clean).join(""), parts.slice(0, n), r);
          if (hit) take(hit, parts.slice(0, n));
        }
        if (hit) continue;
      }
      // The string on its own, or pulled out of a URL or an assignment ("PRIVATE_KEY=0x…", ".../tx/5a2b…").
      const pieces = [w.clean, ...(w.clean.match(/(0x)?[0-9a-fA-F]{60,}|[1-9A-HJ-NP-Za-km-z]{50,}/g) ?? [])];
      for (const p of pieces) if ((hit = judge(p, [w], r))) break;
      if (hit) {
        take(hit, [w]);
        continue;
      }
      // A key shown in groups ("7f3a 91bc …") along the row.
      if (/^[0-9a-fA-F]{2,16}$/.test(w.clean)) {
        let joined = w.clean;
        const parts = [w];
        for (let j = k + 1; j < row.length && joined.length < 66; j++) {
          const n = row[j];
          if (!/^[0-9a-fA-F]{2,16}$/.test(n.clean) || n.x0 - parts[parts.length - 1].x1 > L.unit * 2.5) break;
          joined += n.clean;
          parts.push(n);
          if (joined.length === 64 && (hit = judge(joined, parts, r))) break;
        }
        if (hit) take(hit, parts);
      }
    }
    // A Solana keypair file: "[174,47,154, …]" — 64 bytes as numbers.
    const text = row.map((w) => w.raw).join(" ");
    const bytes = /\[\s*(\d{1,3}\s*,\s*){23,}\d{1,3}/.exec(text);
    if (bytes && bytes[0].match(/\d+/g)!.every((n) => Number(n) <= 255)) {
      const parts = row.filter((w) => /\[|\d/.test(w.raw) && !used.has(w));
      const below = L.rows.slice(r + 1, r + 4).flat().filter((w) => /^\d{1,3},?\]?,?$/.test(w.clean) || /^(\d{1,3},)+\d{0,3}\]?$/.test(w.raw));
      if (parts.length) take("private-key", [...parts, ...below]);
    }
  }
  return out;
}

/* ---- key export pages -------------------------------------------------- */

const NOUNS: string[][] = [
  ["secret", "recovery", "phrase"],
  ["recovery", "phrase"],
  ["seed", "phrase"],
  ["secret", "phrase"],
  ["backup", "phrase"],
  ["mnemonic", "phrase"],
  ["recovery", "words"],
  ["seed", "words"],
  ["private", "key"],
  ["secret", "key"],
  ["mnemonic"],
];
/** Words that make a title an action: "Reveal Secret Recovery Phrase", "Export private key". */
const VERBS = new Set(["reveal", "show", "export", "view", "display", "copy", "backup", "hide", "unhide"]);
const FILLERS = new Set(["your", "my", "the", "this", "wallet", "account", "a"]);
/** Words that, near a title, mean the reveal is one click away. */
const NEAR_ACTION = /^(reveal|show|export|view|copy|hide|unhide|password|revealed)$/;

/** A word as the title check reads it: lower case, look-alike digits as letters, punctuation off. */
const titleWord = (raw: string) =>
  cleanToken(raw)
    .toLowerCase()
    .replace(/[0-9|$@!]/g, (c) => AS_LETTER[c] ?? c)
    .replace(/[^a-z-]/g, "");

/** Two words the same, give or take one misread letter at five letters and up. */
function sameWord(a: string, b: string) {
  if (a === b) return true;
  if (a.length !== b.length || a.length < 5) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false;
  return true;
}

function findPages(L: Layout, keyish: Box[]): Finding[] {
  const out: Box[] = [];
  const near = (a: Box, b: Box) => {
    const dx = (a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2;
    const dy = (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2;
    return Math.hypot(dx, dy) <= 0.35 * Math.max(L.width, L.height);
  };
  const actions = L.words.filter((w) => NEAR_ACTION.test(titleWord(w.raw)));

  for (const row of L.rows) {
    const words = row.map((w) => titleWord(w.raw));
    for (const noun of NOUNS) {
      for (let j = 0; j + noun.length <= words.length; j++) {
        if (!noun.every((n, k) => sameWord(words[j + k], n))) continue;
        const span = row.slice(j, j + noun.length);
        const box = union(span);
        // "Export private key", "Reveal your Secret Recovery Phrase": the action is the title.
        let verbAt = j - 1;
        if (verbAt >= 0 && FILLERS.has(words[verbAt])) verbAt--;
        const verb = verbAt >= 0 && VERBS.has(words[verbAt]);
        // "back up" and "write down" come in two words.
        const twoWord = j >= 2 && ((words[j - 2] === "back" && words[j - 1] === "up") || (words[j - 2] === "write" && words[j - 1] === "down"));
        // A heading or a button reads as one on its own row, or stands taller than the text around it.
        const others = row.filter((w) => !span.includes(w) && /[a-z]/i.test(w.raw)).length;
        const tall = median(span.map((w) => w.h)) >= 1.25 * L.unit;
        const titleLike = others <= 2 || tall;
        const strong = (verb || twoWord) && others <= 4;
        const nearAction = actions.some((a) => !span.includes(a) && near(a, box));
        const nearSecret = keyish.some((k) => near(k, box));
        if (strong || (titleLike && (nearAction || nearSecret || noun.length === 3))) out.push(box);
      }
    }
  }
  // "Secret Recovery Phrase" holds "Recovery Phrase" too: one title, one find.
  return mergeBoxes(out).map((b) => ({ kind: "key-page" as const, rect: toRect(b, L, L.unit * 0.6), whole: true }));
}

/* ---- wallet QR codes --------------------------------------------------- */

const PAY_URI = /^(bitcoin|ethereum|solana|litecoin|dogecoin|bitcoincash|monero|tron|cardano|ripple|xrp|ton|bnb|polygon|avalanche|cosmos|tether|usdt|lightning|lnurl[pwc]?|wc):/i;
const ADDRESS = [
  /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/, // Bitcoin, legacy and P2SH
  /^(bc1|tb1|ltc1)[02-9ac-hj-np-z]{8,87}$/i, // bech32 and bech32m
  /^0x[0-9a-fA-F]{40}$/, // Ethereum and the EVM chains
  /^T[1-9A-HJ-NP-Za-km-z]{33}$/, // Tron
  /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/, // XRP
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, // Solana
  /^ln(bc|tb)[0-9a-z]{20,}$/i, // a Lightning invoice
  /^lnurl[0-9a-z]{20,}$/i,
];

/**
 * Is what this QR code says a wallet's business? A payment URI, a bare
 * address, a key, a phrase or a SeedQR (4-digit word numbers) — yes. A
 * link to a channel or a shop — no, streamers show those on purpose.
 */
export function isWalletQr(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (PAY_URI.test(s)) return true;
  if (ADDRESS.some((re) => re.test(s))) return true;
  if (keyShape(s).kind) return true;
  if (/^\d{48}$|^\d{96}$/.test(s)) return true;
  const words = s.toLowerCase().split(/\s+/);
  if (words.length >= 12 && words.filter((w) => WORDS.has(w)).length >= words.length - 1) return true;
  return false;
}

function findQr(input: ScanInput): Finding[] {
  return (input.qr ?? [])
    .filter((q) => isWalletQr(q.rawValue))
    .map((q) => {
      // The detector's box hugs the modules; the quiet zone round them (four modules, ~12%) goes too,
      // or a dark page shows a hollow white frame where the code was.
      const pad = Math.max(4, (q.x1 - q.x0) * 0.14);
      return { kind: "wallet-qr" as const, rect: toRect(q, input, pad), whole: false };
    });
}

/* ---- balances (off unless asked) ---------------------------------------- */

const TICKERS = new Set(
  (
    "BTC ETH SOL USDT USDC BNB XRP ADA DOGE TRX TON DOT MATIC POL AVAX LINK LTC BCH SHIB PEPE ARB OP ATOM NEAR APT SUI " +
    "WBTC STETH DAI BUSD FDUSD TUSD PYUSD JUP BONK WIF XLM XMR ETC FIL HBAR ICP INJ SEI TIA RNDR RENDER FET UNI AAVE " +
    "USD NGN EUR GBP CAD AUD JPY KES GHS ZAR"
  ).split(" ")
);
const CURRENCY = /^[$€£₦¥₹]/;
const AMOUNT = /^[-+]?[$€£₦¥₹]?\d{1,3}(,\d{3})*(\.\d+)?$|^[-+]?[$€£₦¥₹]?\d+(\.\d+)?$/;
const BALANCE_WORDS = /^(balance|balances|total|portfolio|available|avbl|avail|holdings|equity|worth|assets|estimated|spendable|wallet)$/i;
/** A market, not a holding: "BTC/USDT", "ETH-PERP", "SOLUSDT". */
const PAIR = /^[A-Z]{2,6}[/-][A-Z]{2,6}$|^[A-Z]{2,6}(USDT|USDC|USD|BUSD|PERP)$/;

function findBalances(L: Layout): Finding[] {
  const out: Finding[] = [];
  const pad = L.unit * 0.45;
  for (let r = 0; r < L.rows.length; r++) {
    const row = L.rows[r];
    // A row with a market pair in it is a quote, not a holding.
    if (row.some((w) => PAIR.test(w.clean))) continue;
    for (let k = 0; k < row.length; k++) {
      const w = row[k];
      const glued = /^([$€£₦¥₹]?\d[\d,]*(?:\.\d+)?)([A-Za-z]{2,6})$/.exec(w.clean);
      const amount = AMOUNT.test(w.clean) || (glued !== null && TICKERS.has(glued[2].toUpperCase()));
      if (!amount || w.clean.includes("%") || row[k + 1]?.clean === "%") continue;
      const next = row[k + 1];
      const prev = row[k - 1];
      const beside = (n?: W) => n && Math.abs(n.cx - w.cx) <= w.x1 - w.x0 + L.unit * 4 && TICKERS.has(n.clean.toUpperCase()) && /^[A-Z]{2,6}$/.test(n.clean);
      const tickerNext = beside(next);
      const tickerPrev = beside(prev);
      if (!CURRENCY.test(w.clean) && !glued && !tickerNext && !tickerPrev) continue;
      const parts = [w, ...(tickerNext ? [next!] : []), ...(tickerPrev ? [prev!] : [])];
      const box = union(parts);
      // A balance word on this row, or just above in the same column.
      const labelled = L.rows.slice(Math.max(0, r - 3), r + 1).some((rw) =>
        rw.some(
          (x) =>
            !parts.includes(x) &&
            BALANCE_WORDS.test(cleanToken(x.raw)) &&
            box.y0 - x.cy <= L.unit * 5 &&
            (x.row === r || (x.x0 <= box.x1 + L.unit * 4 && x.x1 >= box.x0 - L.unit * 20))
        )
      );
      if (labelled) out.push({ kind: "balance", rect: toRect(box, L, pad), whole: false });
    }
  }
  return out;
}

/* ---- the scan --------------------------------------------------------- */

/**
 * Everything on this screen the shield should cover, given which detectors
 * are on. Boxes are on the 0..1 square, so they fit any frame size.
 */
export function scanScreen(input: ScanInput, detectors: Detectors = DEFAULT_DETECTORS): Finding[] {
  if (!(input.width > 0) || !(input.height > 0)) return [];
  const L = buildLayout(input);
  const out: Finding[] = [];
  const phrases = detectors.phrases || detectors.pages ? findPhrases(L) : [];
  const keys = detectors.keys || detectors.pages ? findKeys(L) : [];
  if (detectors.phrases) out.push(...phrases);
  if (detectors.keys) out.push(...keys);
  if (detectors.pages) {
    const px = (r: Rect): Box => ({ x0: r.x * L.width, y0: r.y * L.height, x1: (r.x + r.w) * L.width, y1: (r.y + r.h) * L.height });
    const long = L.words.filter((w) => w.clean.length >= 24 && chunkish(w.clean));
    out.push(...findPages(L, [...phrases.map((f) => px(f.rect)), ...keys.map((f) => px(f.rect)), ...long]));
  }
  if (detectors.qr) out.push(...findQr(input));
  if (detectors.balances) out.push(...findBalances(L));
  return out;
}

/* ---- holding what was found --------------------------------------------- */

/** How long a find stays covered after it was last seen. */
export const HOLD_MS = 8_000;
/** "Show anyway" lasts this long. */
export const SHOW_ANYWAY_MS = 10_000;

export interface HeldFinding {
  id: number;
  kind: FindingKind;
  rect: Rect;
  whole: boolean;
  firstSeen: number;
  lastSeen: number;
  /** "Show anyway": not painted until then. */
  shownUntil: number;
  /** "Keep hidden": the host has seen the notice. */
  kept: boolean;
}

/** How much two boxes share, as a share of the smaller one. */
const overlap = (a: Rect, b: Rect) => {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const smaller = Math.min(a.w * a.h, b.w * b.h);
  return smaller > 0 ? (ix * iy) / smaller : 0;
};

const unionRect = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * What's been found, held: each find stays covered until reads of the
 * screen have gone `HOLD_MS` without seeing it, so a missed read (OCR isn't
 * the same twice) or a scroll doesn't flash it back on. The hold runs on
 * reads, not the clock: a still screen sends no frames and gets no reads,
 * and the first frame after a quiet spell must still be covered. A find
 * seen again in the same place — or, for the whole-screen kinds, anywhere
 * — is the same find.
 */
export class FindingTracker {
  held: HeldFinding[] = [];
  private nextId = 1;
  private lastScan = -Infinity;

  constructor(private readonly holdMs = HOLD_MS) {}

  /** A scan's findings; returns the ones that are new. */
  update(findings: Finding[], now: number): HeldFinding[] {
    this.lastScan = Math.max(this.lastScan, now);
    // One whole-screen find per kind is plenty: the heading and the button on one page are one notice.
    const merged: Finding[] = [];
    for (const f of findings) {
      const twin = f.whole ? merged.find((m) => m.whole && m.kind === f.kind) : null;
      if (twin) twin.rect = unionRect(twin.rect, f.rect);
      else merged.push({ ...f });
    }
    const fresh: HeldFinding[] = [];
    const matched = new Set<HeldFinding>();
    for (const f of merged) {
      // The same find: same kind, still held, not already claimed by this scan, and — for boxes — in the same place.
      let same: HeldFinding | null = null;
      let best = 0.3;
      for (const h of this.held) {
        if (h.kind !== f.kind || matched.has(h)) continue;
        if (f.whole) {
          same = h;
          break;
        }
        const o = overlap(h.rect, f.rect);
        if (o >= best) {
          best = o;
          same = h;
        }
      }
      if (same) {
        matched.add(same);
        same.rect = f.rect;
        same.lastSeen = now;
        continue;
      }
      const h: HeldFinding = { id: this.nextId++, kind: f.kind, rect: f.rect, whole: f.whole, firstSeen: now, lastSeen: now, shownUntil: 0, kept: false };
      this.held.push(h);
      matched.add(h);
      fresh.push(h);
    }
    this.prune();
    return fresh;
  }

  /** The screen hasn't changed since the last scan: what that scan saw is still there. */
  touch(now: number) {
    for (const h of this.held) if (h.lastSeen >= this.lastScan) h.lastSeen = now;
    this.lastScan = Math.max(this.lastScan, now);
    this.prune();
  }

  /** Let go of finds the reads have gone the hold without seeing. */
  private prune() {
    this.held = this.held.filter((h) => this.lastScan - h.lastSeen <= this.holdMs);
  }

  /** Forget a detector's finds at once — it was switched off. */
  drop(kinds: FindingKind[]) {
    this.held = this.held.filter((h) => !kinds.includes(h.kind));
  }

  clear() {
    this.held = [];
    this.lastScan = -Infinity;
  }

  showAnyway(id: number, now: number, ms = SHOW_ANYWAY_MS): boolean {
    const h = this.held.find((x) => x.id === id);
    if (!h) return false;
    h.shownUntil = now + ms;
    h.kept = false;
    return true;
  }

  keep(id: number): boolean {
    const h = this.held.find((x) => x.id === id);
    if (!h) return false;
    h.kept = true;
    h.shownUntil = 0;
    return true;
  }

  /** What to paint now: the whole screen, or these boxes. */
  cover(now: number): { whole: boolean; rects: Rect[] } {
    let whole = false;
    const rects: Rect[] = [];
    for (const h of this.held) {
      if (h.shownUntil > now) continue;
      if (h.whole) whole = true;
      else rects.push(h.rect);
    }
    return { whole, rects };
  }
}

/* ---- zones -------------------------------------------------------------- */

/** The smallest zone: 2% of the frame a side. */
export const MIN_ZONE = 0.02;
export const MAX_ZONES = 12;

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A box kept inside the frame and at least `min` a side. */
export function clampRect(r: Rect, min = MIN_ZONE): Rect {
  const w = Math.min(1, Math.max(min, clamp01(r.w)));
  const h = Math.min(1, Math.max(min, clamp01(r.h)));
  return { x: Math.min(clamp01(r.x), 1 - w), y: Math.min(clamp01(r.y), 1 - h), w, h };
}

/** The box two corners make, either way round. */
export function rectFromCorners(ax: number, ay: number, bx: number, by: number): Rect {
  const x0 = clamp01(Math.min(ax, bx));
  const y0 = clamp01(Math.min(ay, by));
  return { x: x0, y: y0, w: clamp01(Math.max(ax, bx)) - x0, h: clamp01(Math.max(ay, by)) - y0 };
}

/**
 * Where a picture of `aspect` (width ÷ height) sits in a box, the way
 * object-fit: contain puts it — the zone editor lays itself over exactly
 * the shared screen, not the letterbox around it.
 */
export function containRect(boxW: number, boxH: number, aspect: number): { x: number; y: number; w: number; h: number } {
  if (!(boxW > 0) || !(boxH > 0) || !(aspect > 0)) return { x: 0, y: 0, w: Math.max(0, boxW), h: Math.max(0, boxH) };
  if (boxW / boxH > aspect) {
    const w = boxH * aspect;
    return { x: (boxW - w) / 2, y: 0, w, h: boxH };
  }
  const h = boxW / aspect;
  return { x: 0, y: (boxH - h) / 2, w: boxW, h };
}

/** A zone in words, for its label and screen readers: "top right, 24% × 12%". */
export function describeZone(r: Rect): string {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const v = cy < 1 / 3 ? "top" : cy > 2 / 3 ? "bottom" : "middle";
  const hz = cx < 1 / 3 ? "left" : cx > 2 / 3 ? "right" : "centre";
  const where = v === "middle" && hz === "centre" ? "centre" : v === "middle" ? `middle ${hz}` : `${v} ${hz}`;
  return `${where}, ${Math.round(r.w * 100)}% × ${Math.round(r.h * 100)}%`;
}
