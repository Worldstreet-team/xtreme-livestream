import {
  DEFAULT_FILTER_LEVELS,
  FILTER_CATEGORIES,
  type FilterCategory,
  type FilterLevel,
} from "@xtreme/contracts";
import { LINK_PATTERNS, SCAM_PATTERNS, TERMS } from "./terms.js";

/**
 * The chat filter (safety kit). A message is checked against each category
 * at the channel's level for it — off, hold (a moderator approves it
 * first) or block (never sent) — plus the creator's own terms; the
 * strictest hit decides. Shield raises the floor for every category.
 *
 * Terms match whole words, in any case or accent, and see through the
 * usual dodges: repeated letters ("fuuuck"), separators ("f.u.c.k",
 * "f u c k") and look-alikes ("sh1t", "$hit"). Links and scams are
 * patterns, read from the message as written.
 */

export interface FilterSettings {
  filters?: Partial<Record<FilterCategory, FilterLevel>>;
  blockedTerms?: string[];
  blockedTermsLevel?: "hold" | "block";
}

export interface FilterVerdict {
  level: "hold" | "block";
  category: FilterCategory | "custom" | "new-account" | "evasion";
}

/** Look-alikes read as the letters they stand in for — only when matching terms. */
const LOOKALIKES: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };

/** Lower case, accents off ("wèrè" reads "were"), look-alikes read as letters. */
export function normalize(text: string) {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[0134573@$]/g, (ch) => LOOKALIKES[ch] ?? ch);
}

function escape(ch: string) {
  return ch.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * One term as a pattern: each letter may repeat, letters may be split by
 * one separator, a space in the term is any run of separators, and `*`
 * is the rest of a word. Whole words only, unless a wildcard opens the
 * term up at that end.
 */
export function compileTerm(term: string): string | null {
  const t = normalize(term.trim()).replace(/\s+/g, " ");
  if (!t.replace(/[*\s]/g, "")) return null;
  const chars = [...t];
  let src = "";
  chars.forEach((ch, i) => {
    if (ch === "*") {
      src += "[\\p{L}\\p{N}]*";
      return;
    }
    if (ch === " ") {
      src += "[^\\p{L}\\p{N}]+";
      return;
    }
    src += `${escape(ch)}+`;
    const next = chars[i + 1];
    if (next && next !== "*" && next !== " ") src += "[^\\p{L}\\p{N}]?";
  });
  const open = t.startsWith("*") ? "" : "(?<![\\p{L}\\p{N}])";
  const close = t.endsWith("*") ? "" : "(?![\\p{L}\\p{N}])";
  return `${open}(?:${src})${close}`;
}

/** Many terms as one pattern, kept once built — the built-in lists never change. */
const compiled = new Map<string, RegExp | null>();
function termsPattern(key: string, terms: string[]) {
  if (!compiled.has(key)) {
    const parts = terms.map(compileTerm).filter((p): p is string => Boolean(p));
    compiled.set(key, parts.length ? new RegExp(parts.join("|"), "u") : null);
    // Creators' lists change; don't let the cache grow without bound.
    if (compiled.size > 500) compiled.delete(compiled.keys().next().value!);
  }
  return compiled.get(key) ?? null;
}

function hits(category: FilterCategory, raw: string, normalized: string) {
  if (category === "links") return LINK_PATTERNS.some((p) => p.test(raw));
  if (category === "scams") return SCAM_PATTERNS.some((p) => p.test(raw));
  return termsPattern(`builtin:${category}`, TERMS[category])?.test(normalized) ?? false;
}

const RANK: Record<FilterLevel, number> = { off: 0, hold: 1, block: 2 };

/** Shield's floor: nothing looser than this while it's up. */
const SHIELD_FLOOR: Record<FilterCategory, FilterLevel> = {
  profanity: "hold",
  insults: "hold",
  slurs: "block",
  sexual: "hold",
  links: "block",
  scams: "block",
};

/** An account younger than this is held while Shield is up. */
export const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;

/**
 * The verdict on a message, or null to let it through. `options.shield`
 * raises every category to Shield's floor; `options.newAccount` holds
 * anything from an account a day old while Shield is up.
 */
export function checkMessage(
  content: string,
  settings: FilterSettings | null,
  options: { shield?: boolean; newAccount?: boolean } = {},
): FilterVerdict | null {
  const raw = content;
  const normalized = normalize(content);
  let verdict: FilterVerdict | null = null;
  const consider = (level: FilterLevel, category: FilterVerdict["category"]) => {
    if (level === "off") return;
    if (!verdict || RANK[level] > RANK[verdict.level]) verdict = { level, category };
  };

  for (const category of FILTER_CATEGORIES) {
    let level: FilterLevel = settings ? (settings.filters?.[category] ?? DEFAULT_FILTER_LEVELS[category]) : "off";
    if (options.shield && RANK[SHIELD_FLOOR[category]] > RANK[level]) level = SHIELD_FLOOR[category];
    if (level === "off" || (verdict && RANK[level] <= RANK[(verdict as FilterVerdict).level])) continue;
    if (hits(category, raw, normalized)) consider(level, category);
  }

  const own = settings?.blockedTerms ?? [];
  if (own.length) {
    const pattern = termsPattern(`custom:${own.join("\u0000")}`, own);
    if (pattern?.test(normalized)) consider(settings?.blockedTermsLevel ?? "block", "custom");
  }

  if (options.shield && options.newAccount) consider("hold", "new-account");
  return verdict;
}

/** What a held line is shown as, to the moderators deciding on it. */
export const HELD_REASON_LABELS: Record<FilterVerdict["category"], string> = {
  profanity: "Swearing",
  insults: "Insult",
  slurs: "Hate or slur",
  sexual: "Sexual",
  links: "Link",
  scams: "Scam or wallet address",
  custom: "Your blocked terms",
  "new-account": "New account (Shield)",
  evasion: "Looks like a banned account",
};
