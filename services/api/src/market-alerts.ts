import crypto from "node:crypto";
import {
  MAX_MARKET_SUGGESTIONS,
  formatMarketUsd,
  roundStep,
  roundTo,
  type ChartInterval,
  type MarketQuote,
  type MarketSuggestion,
  type MarketSuggestionKind,
} from "@xtreme/contracts";
import { sendRoomDataTo } from "./livekit.js";
import { Stream, User } from "./models.js";
import { getMarket, getQuote } from "./routes/market.js";
import { consoleIdentities } from "./safety/roles.js";
import { trendingOf } from "./tickers.js";

/**
 * The market as director (Phase 4): every half minute, a look at the
 * markets each live show cares about — the chart's, the price strip's, and
 * the three chat's naming most — for the moments a trading host would call
 * out: a quick move, a round number crossed, a new high or low for the
 * stream. Each becomes a suggestion for the host's studio and their
 * producers' consoles, with one-tap actions (chart it, a banner line, a
 * market question). Nothing goes on screen by itself.
 *
 * Prices come from the shared quote cache (routes/market.ts `getQuote`):
 * one read per market per sweep however many streams watch it, so never
 * more than one upstream call per market in fifteen seconds. The rolling
 * window of prices is kept per market for the whole process; what each
 * stream has been told, and its range since it started, per stream.
 *
 * Practice runs are watched too: a rehearsal hears the same market it would
 * on the night. Nothing is simulated — market data is never made up — and a
 * suggestion only ever reaches the host and their crew.
 *
 * In-process, like chat's tickers: a restart forgets the window, and the
 * first quarter of an hour after one is quieter while it refills.
 */

export const ALERT_SWEEP_MS = 30_000;
/** At most one suggestion per market per stream in ten minutes… */
export const SYMBOL_GAP_MS = 10 * 60_000;
/** …and one per stream in two. */
export const STREAM_GAP_MS = 2 * 60_000;
/** A new high or low means something once the stream has had this long to set its range. */
export const EXTREME_AFTER_MS = 20 * 60_000;
/** A price older than this isn't "now" — a feed gone quiet decides nothing. */
const FRESH_MS = 90_000;
/** Prices kept per market: enough for the fifteen-minute window. */
const KEEP_MS = 16 * 60_000;
/** What a reloaded studio is handed back: the last few, from the last half hour. */
const RECENT_MS = 30 * 60_000;
/** Markets read per sweep at most, busiest first. */
const MAX_SYMBOLS = 60;
/** How far past a round number a price must be to have crossed it: a twentieth of a step. */
const CROSS_MARGIN = 0.05;

/** The deep, slower markets. Everything else moves about twice as hard. */
const MAJORS = new Set(["BTC", "ETH"]);

/**
 * How far a price has to move to be worth a host's attention, in per cent.
 * BTC and ETH typically realise 40–60% a year — a 5-minute standard move of
 * about 0.15% — so half a per cent inside five minutes, or one per cent
 * inside fifteen, is a 3–4σ move a trading desk would call out. Most other
 * coins run twice as hot or more (SOL around 80% a year, memecoins past
 * 100%), so their bars sit a little over twice as high to mean the same.
 * Lower and it fires on noise; higher and it sleeps through the moves a
 * trading stream talks about.
 */
export const MOVE_THRESHOLDS = {
  major: { 5: 0.5, 15: 1 },
  other: { 5: 1.2, 15: 2.5 },
} as const;

export const tierOf = (symbol: string): keyof typeof MOVE_THRESHOLDS => (MAJORS.has(symbol.split("-")[0] ?? "") ? "major" : "other");

export interface PricePoint {
  t: number;
  p: number;
}

/* ---- The detectors: pure, over a market's recent prices ---- */

export interface Move {
  windowMin: 5 | 15;
  changePct: number;
}

/**
 * A move into the latest price inside the last five minutes, or failing that
 * fifteen: up from the window's low or down from its high, past the market's
 * bar. Prices at or before `since` — the last suggestion about this market —
 * don't count as a start, so one move is told once.
 */
export function detectMove(points: PricePoint[], symbol: string, now: number, since = -Infinity): Move | null {
  const last = points[points.length - 1];
  if (!last || now - last.t > FRESH_MS) return null;
  const bars = MOVE_THRESHOLDS[tierOf(symbol)];
  for (const windowMin of [5, 15] as const) {
    const from = points.filter((pt) => pt.t < last.t && pt.t >= now - windowMin * 60_000 && pt.t > since);
    if (from.length === 0) continue;
    const lo = Math.min(...from.map((pt) => pt.p));
    const hi = Math.max(...from.map((pt) => pt.p));
    const up = ((last.p - lo) / lo) * 100;
    const down = ((last.p - hi) / hi) * 100;
    const changePct = up >= -down ? up : down;
    if (Math.abs(changePct) >= bars[windowMin]) return { windowMin, changePct: Math.round(changePct * 100) / 100 };
  }
  return null;
}

export interface Cross {
  level: number;
  direction: "up" | "down";
}

/**
 * A round number (a multiple of `roundStep`) the price has come through in
 * the last five minutes: clearly on one side of it then, clearly on the
 * other now — by a twentieth of a step each time, so a price sitting on a
 * round number (a stablecoin on its dollar) or poking over one and back
 * doesn't "cross" it every other quote.
 */
export function detectCross(points: PricePoint[], now: number, since = -Infinity): Cross | null {
  const last = points[points.length - 1];
  if (!last || now - last.t > FRESH_MS) return null;
  const before = points.filter((pt) => pt.t < last.t && pt.t >= now - 5 * 60_000 && pt.t > since);
  if (before.length === 0) return null;
  const step = roundStep(last.p);
  const margin = step * CROSS_MARGIN;
  const up = roundTo(last.p - margin, step, "down");
  if (up > 0 && Math.min(...before.map((pt) => pt.p)) < up - margin) return { level: up, direction: "up" };
  const down = roundTo(last.p + margin, step, "up");
  if (Math.max(...before.map((pt) => pt.p)) > down + margin) return { level: down, direction: "down" };
  return null;
}

/** A market's range on one stream: since `from` (the stream's start, when the candles could say). */
export interface StreamRange {
  hi: number;
  lo: number;
  /** The first price of the range. */
  open: number;
  from: number;
}

/**
 * A new high or low for the stream: the price past the range it has kept
 * since the stream started — once there's been twenty minutes to make one,
 * and when it's wider than noise (the market's five-minute bar), so a flat
 * market doesn't make a "high" every tick.
 */
export function detectExtreme(range: StreamRange, price: number, symbol: string, now: number): "high" | "low" | null {
  if (now - range.from < EXTREME_AFTER_MS || !(range.lo > 0)) return null;
  if (((range.hi - range.lo) / range.lo) * 100 < MOVE_THRESHOLDS[tierOf(symbol)][5]) return null;
  if (price > range.hi) return "high";
  if (price < range.lo) return "low";
  return null;
}

/* ---- The throttle ---- */

export interface Throttle {
  /** The last suggestion to this stream, about anything. */
  lastAt: number;
  /** The last one about each market. */
  bySymbol: Map<string, number>;
}

export const newThrottle = (): Throttle => ({ lastAt: -Infinity, bySymbol: new Map() });

/** One suggestion per market per stream in ten minutes, and one per stream in two. */
export function throttleAllows(t: Throttle, symbol: string, now: number) {
  return now - t.lastAt >= STREAM_GAP_MS && now - (t.bySymbol.get(symbol) ?? -Infinity) >= SYMBOL_GAP_MS;
}

export function noteSuggested(t: Throttle, symbol: string, now: number) {
  t.lastAt = now;
  t.bySymbol.set(symbol, now);
}

/* ---- What a stream cares about ---- */

const SYMBOL = /^[A-Z0-9]{2,10}-[A-Z]{3,4}$/;

/** The markets a live show cares about: its chart's, its price strip's, and chat's top three. */
export function interestOf(
  scene: { chart?: { symbol?: unknown } | null; layers?: Array<Record<string, unknown>> } | null | undefined,
  trending: Array<{ symbol: string }>,
): string[] {
  const out = new Set<string>();
  if (typeof scene?.chart?.symbol === "string") out.add(scene.chart.symbol);
  for (const layer of scene?.layers ?? []) {
    if (layer.kind === "prices" && Array.isArray(layer.symbols)) {
      for (const s of layer.symbols) if (typeof s === "string") out.add(s);
    }
  }
  for (const t of trending.slice(0, 3)) out.add(t.symbol);
  return [...out].filter((s) => SYMBOL.test(s));
}

/* ---- Suggestions ---- */

export interface Candidate {
  kind: MarketSuggestionKind;
  symbol: string;
  price: number;
  changePct: number;
  windowMin: number;
  /** A round number crossed, and which way. */
  cross: Cross | null;
}

const RANK: Record<MarketSuggestionKind, number> = { move: 0, round: 1, high: 2, low: 2 };

/** The one to tell first: a move over a round number over a high or low; the bigger move among equals. */
export function rankCandidates(list: Candidate[]) {
  return [...list].sort((a, b) => RANK[a.kind] - RANK[b.kind] || Math.abs(b.changePct) - Math.abs(a.changePct));
}

const baseOf = (symbol: string) => symbol.split("-")[0] ?? symbol;

/** In the market's own money: "$130", or "0.0512 BTC" for a pair priced in something else. */
function money(symbol: string, n: number) {
  const quote = symbol.split("-")[1] ?? "USD";
  return quote === "USD" || quote === "USDT" || quote === "USDC" ? formatMarketUsd(n) : `${formatMarketUsd(n).slice(1)} ${quote}`;
}

const signed = (pct: number) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
const NFA = "Not financial advice";

/** A candidate, in words and with its actions. */
export function buildSuggestion(c: Candidate, now: number): MarketSuggestion {
  const base = baseOf(c.symbol);
  const up = c.changePct >= 0;
  const level = c.cross?.level ?? null;
  let text: string;
  let banner: string;
  if (c.kind === "move") {
    text = `${base} ${signed(c.changePct)} in ${c.windowMin} min`;
    banner = `${base} ${up ? "up" : "down"} ${Math.abs(c.changePct).toFixed(1)}% in the last ${c.windowMin} minutes · ${NFA}`;
  } else if (c.kind === "round" && c.cross) {
    const crossedUp = c.cross.direction === "up";
    text = `${base} ${crossedUp ? "crossed" : "fell below"} ${money(c.symbol, c.cross.level)}`;
    banner = `${base} ${crossedUp ? "breaks above" : "slips below"} ${money(c.symbol, c.cross.level)} · ${NFA}`;
  } else {
    const high = c.kind === "high";
    text = `${base} at the stream's ${high ? "high" : "low"}`;
    banner = `${base} at its ${high ? "high" : "low"} of the stream · ${NFA}`;
  }
  // A market question can only settle on a dollar market Coinbase prices: asked around the
  // round number just crossed, or else the nearest one, a quarter of an hour out.
  const question = c.symbol.endsWith("-USD")
    ? { symbol: c.symbol, above: level ?? roundTo(c.price, roundStep(c.price)), minutes: 15 }
    : null;
  const interval: ChartInterval = c.kind === "high" || c.kind === "low" ? "5m" : "1m";
  return {
    id: crypto.randomUUID(),
    kind: c.kind,
    symbol: c.symbol,
    text,
    price: c.price,
    changePct: Math.round(c.changePct * 100) / 100,
    windowMin: c.windowMin,
    level,
    at: new Date(now).toISOString(),
    actions: { chart: { symbol: c.symbol, interval }, banner: banner.slice(0, 100), question },
  };
}

/* ---- The sweep ---- */

interface StreamWatch {
  throttle: Throttle;
  ranges: Map<string, StreamRange>;
  recent: MarketSuggestion[];
}

const series = new Map<string, PricePoint[]>();
const streams = new Map<string, StreamWatch>();

function record(symbol: string, price: number, now: number) {
  const points = series.get(symbol) ?? [];
  if (points.length > 0 && points[points.length - 1]!.t >= now) return;
  points.push({ t: now, p: price });
  while (points.length > 0 && now - points[0]!.t > KEEP_MS) points.shift();
  series.set(symbol, points);
}

export interface AlertDeps {
  quote: (symbol: string) => Promise<MarketQuote | null>;
  candles: (symbol: string, interval: ChartInterval) => Promise<{ candles: Array<{ t: number; o: number; h: number; l: number }> }>;
}

const FEED: AlertDeps = { quote: (symbol) => getQuote(symbol), candles: (symbol, interval) => getMarket(symbol, interval) };

/**
 * A market's range on a stream, set up the first time the stream cares
 * about it: from the 5-minute candles since the stream started, so "the
 * stream's high" means that even for a market chat only just brought up —
 * or, if the candles can't be read, from now (and armed twenty minutes on).
 */
async function rangeOf(watch: StreamWatch, symbol: string, startedAt: number, price: number, now: number, feed: AlertDeps) {
  const known = watch.ranges.get(symbol);
  if (known) return known;
  let range: StreamRange = { hi: price, lo: price, open: price, from: now };
  try {
    const since = (await feed.candles(symbol, "5m")).candles.filter((c) => c.t + 5 * 60_000 > startedAt);
    if (since.length > 0) {
      range = {
        hi: Math.max(price, ...since.map((c) => c.h)),
        lo: Math.min(price, ...since.map((c) => c.l)),
        open: since[0]!.o,
        from: Math.max(startedAt, since[0]!.t),
      };
    }
  } catch {
    // The range starts here instead.
  }
  watch.ranges.set(symbol, range);
  return range;
}

/**
 * One look: read each market once, then for each live stream find what's
 * worth telling, and tell the best of it — within the throttle — to the
 * host and their consoles. Returns how many suggestions went out.
 */
export async function sweepMarketAlerts(now = Date.now(), feed: Partial<AlertDeps> = {}) {
  const deps = { ...FEED, ...feed };
  const live = await Stream.find({ isLive: true }).select("_id streamerId livekitRoomName scene startedAt").lean();
  const liveIds = new Set(live.map((s) => String(s._id)));
  for (const key of [...streams.keys()]) if (!liveIds.has(key)) streams.delete(key);

  const wanted = live
    .map((s) => ({ s, symbols: interestOf(s.scene as Parameters<typeof interestOf>[0], trendingOf(s._id, now)) }))
    .filter((w) => w.symbols.length > 0);
  const demand = new Map<string, number>();
  for (const w of wanted) for (const symbol of w.symbols) demand.set(symbol, (demand.get(symbol) ?? 0) + 1);
  const reading = [...demand.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SYMBOLS)
    .map(([symbol]) => symbol);

  await Promise.all(
    reading.map(async (symbol) => {
      const quote = await deps.quote(symbol).catch(() => null);
      if (quote && quote.last > 0) record(symbol, quote.last, now);
    }),
  );
  // Markets nobody's watched for a while are forgotten.
  for (const [symbol, points] of series) {
    if (!demand.has(symbol) && (points.length === 0 || now - points[points.length - 1]!.t > KEEP_MS)) series.delete(symbol);
  }

  let told = 0;
  for (const { s, symbols } of wanted) {
    const key = String(s._id);
    const watch = streams.get(key) ?? { throttle: newThrottle(), ranges: new Map(), recent: [] };
    streams.set(key, watch);
    const startedAt = s.startedAt ? new Date(s.startedAt).getTime() : now;
    const found: Candidate[] = [];
    for (const symbol of symbols) {
      const points = series.get(symbol);
      const last = points?.[points.length - 1];
      if (!points || !last || now - last.t > FRESH_MS) continue;
      const range = await rangeOf(watch, symbol, startedAt, last.p, now, deps);
      const since = watch.throttle.bySymbol.get(symbol) ?? -Infinity;
      const move = detectMove(points, symbol, now, since);
      const cross = detectCross(points, now, since);
      const extreme = detectExtreme(range, last.p, symbol, now);
      range.hi = Math.max(range.hi, last.p);
      range.lo = Math.min(range.lo, last.p);
      if (!throttleAllows(watch.throttle, symbol, now)) continue;
      if (move) {
        found.push({ kind: "move", symbol, price: last.p, changePct: move.changePct, windowMin: move.windowMin, cross });
      } else if (cross) {
        const window = points.filter((pt) => pt.t >= now - 5 * 60_000 && pt.t < last.t);
        const from = window[0]?.p ?? last.p;
        found.push({ kind: "round", symbol, price: last.p, changePct: ((last.p - from) / from) * 100, windowMin: 5, cross });
      } else if (extreme) {
        found.push({
          kind: extreme,
          symbol,
          price: last.p,
          changePct: ((last.p - range.open) / range.open) * 100,
          windowMin: Math.max(1, Math.round((now - range.from) / 60_000)),
          cross: null,
        });
      }
    }
    const best = rankCandidates(found)[0];
    if (!best) continue;
    const suggestion = buildSuggestion(best, now);
    noteSuggested(watch.throttle, best.symbol, now);
    watch.recent = [suggestion, ...watch.recent].slice(0, MAX_MARKET_SUGGESTIONS);
    const streamer = await User.findById(s.streamerId).select("safety").lean();
    const to = [String(s.streamerId), ...(streamer ? consoleIdentities(streamer as Parameters<typeof consoleIdentities>[0]) : [])];
    await sendRoomDataTo(s.livekitRoomName, to, { __evt: "suggestion", suggestion }).catch(() => {});
    told += 1;
  }
  return told;
}

/** The last few suggestions a stream was given, newest first — for a studio that reloads. */
export function suggestionsFor(streamId: unknown, now = Date.now()): MarketSuggestion[] {
  const watch = streams.get(String(streamId));
  if (!watch) return [];
  return watch.recent.filter((s) => now - Date.parse(s.at) < RECENT_MS);
}

/** Every thirty seconds, one look — never two at once, however slow the feed. */
export function startMarketAlertSweep() {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void sweepMarketAlerts()
      .catch((e) => console.error("market alert sweep failed:", e))
      .finally(() => {
        running = false;
      });
  }, ALERT_SWEEP_MS);
}

/** For tests: forget every price and every stream. */
export function clearMarketAlerts() {
  series.clear();
  streams.clear();
}
