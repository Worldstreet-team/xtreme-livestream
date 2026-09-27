/**
 * The Games panel's market question (Phase 4), before it's asked: which
 * market, where the line sits, and when it's decided. The words, the Yes
 * and No and the settling are the API's; this is picking and arithmetic.
 */

import { MARKET_QUESTION_MAX_MS, MARKET_QUESTION_MIN_MS, roundStep, roundTo } from "@xtreme/contracts";

const MINUTE = 60_000;
const DOLLAR_MARKET = /^[A-Z0-9]{2,10}-USD$/;

/** The markets a host reaches for when nothing else is on: the three a question is most often about. */
export const QUESTION_MAJORS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;

/** The quick times: a quarter of an hour, and an hour. */
export const QUESTION_TIMES = [
  { id: "15", label: "+15 min", minutes: 15 },
  { id: "60", label: "+1 h", minutes: 60 },
] as const;

/** The whole minute at least `minutes` from now — what "+15 min" means (questions are decided to the minute). */
export function minutesFromNow(minutes: number, now: number) {
  return Math.ceil((now + minutes * MINUTE) / MINUTE) * MINUTE;
}

/** "21:05" on this device's clock, the next time it comes round: today, or tomorrow once today's has gone. */
export function nextClockTime(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** Whether a question can be decided then: five minutes to a day from now. */
export function inQuestionRange(at: number, now: number) {
  return at - now >= MARKET_QUESTION_MIN_MS && at - now <= MARKET_QUESTION_MAX_MS;
}

/** What − and + move the line by: a tenth of the market's round step (SOL by $1, BTC by $100). */
export function thresholdNudge(price: number) {
  const step = roundStep(price);
  return roundTo(step / 10, step / 10);
}

/** The line moved one nudge up or down, and kept on the nudge's grid. */
export function nudgeThreshold(value: number, step: number, direction: 1 | -1) {
  const next = roundTo(value + direction * step, step);
  return next > 0 ? next : value;
}

/**
 * The markets to offer first — the price strip's, chat's, the chart's, as
 * the studio hands them over — each once, dollar markets only (a question
 * settles on a dollar price), and the majors after them to fill the row.
 */
export function questionMarkets(offered: string[], max = 6): string[] {
  const out: string[] = [];
  for (const raw of [...offered, ...QUESTION_MAJORS]) {
    const symbol = raw.trim().toUpperCase();
    if (DOLLAR_MARKET.test(symbol) && !out.includes(symbol)) out.push(symbol);
  }
  return out.slice(0, max);
}

/**
 * Known markets for what's typed — "ad" finds ADA-USD — the exact coin
 * first, then those that start with it, then those that merely contain it.
 */
export function searchMarkets(known: string[], query: string, limit = 8): string[] {
  const q = query
    .trim()
    .toUpperCase()
    .replace(/^\$/, "")
    .replace(/-USD$/, "")
    .replace(/[^A-Z0-9]/g, "");
  if (!q) return [];
  const bases = known.filter((s) => DOLLAR_MARKET.test(s)).map((s) => ({ s, base: s.slice(0, -4) }));
  const exact = bases.filter((m) => m.base === q);
  const starts = bases.filter((m) => m.base !== q && m.base.startsWith(q)).sort((a, b) => a.base.length - b.base.length || a.base.localeCompare(b.base));
  const within = bases.filter((m) => !m.base.startsWith(q) && m.base.includes(q)).sort((a, b) => a.base.localeCompare(b.base));
  return [...exact, ...starts, ...within].slice(0, limit).map((m) => m.s);
}

/** A typed line as a price: "150", "$84,500", "0.097" — or null. */
export function readThreshold(text: string): number | null {
  const n = Number(text.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** This device's clock, for the stored question's "at 20:30". */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
