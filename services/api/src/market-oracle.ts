import {
  MARKET_QUESTION_MAX_MS,
  MARKET_QUESTION_MIN_MS,
  marketQuestionClosesAt,
  marketQuestionText,
  type MarketOracleBody,
} from "@xtreme/contracts";
import { ApiError } from "./errors.js";
import { knownMarkets } from "./market-list.js";

/**
 * Market questions (Phase 4): "SOL above $150.00 at 20:30?" — a vote that
 * settles itself from the market. The price at `at` is the close of
 * Coinbase's 1-minute candle containing it (the candle that starts on that
 * minute), read once the minute is over; the game sweep (games.ts) asks
 * here, retrying until the candle is out, and calls the question off if
 * Coinbase still hasn't answered half an hour later.
 *
 * Same source and manners as the chart's candles (routes/market.ts) — the
 * public exchange feed, our user agent, a six-second timeout — but none of
 * its caches: a settled minute never changes, so all that's kept here is
 * the answer once it's final.
 */

const SOURCE = "https://api.exchange.coinbase.com";
const MINUTE = 60_000;

/** Readable: the minute's candle has closed and Coinbase has had half a minute to publish it. */
export const ORACLE_READY_MS = MINUTE + 30_000;
/** How often the sweep asks again about a question still waiting on its price. */
export const ORACLE_RETRY_MS = 15_000;
/** No price half an hour after the minute: the question is called off. */
export const ORACLE_GIVE_UP_MS = 30 * MINUTE;
/** The clock a question is worded on when the host's isn't known — most of Xtream watches from Lagos. */
const DEFAULT_ZONE = "Africa/Lagos";

function zoneOr(tz: string | undefined) {
  if (!tz) return DEFAULT_ZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_ZONE;
  }
}

/**
 * A market question as it will be stored: the oracle (its minute read to
 * the minute), when votes close, and its words on the host's clock. Throws
 * the ApiError the create route hands back when the time or the market
 * won't do.
 */
export async function prepareMarketQuestion(body: MarketOracleBody, now = Date.now()) {
  const at = Math.floor(Date.parse(body.at) / MINUTE) * MINUTE;
  if (!Number.isFinite(at) || at - now < MARKET_QUESTION_MIN_MS || at - now > MARKET_QUESTION_MAX_MS) {
    throw new ApiError(400, "Pick a time between 5 minutes and 24 hours from now", "BAD_QUESTION_TIME");
  }
  const known = await knownMarkets();
  if (!known.has(body.symbol)) {
    throw new ApiError(400, `There's no ${body.symbol} market on Coinbase to settle it from`, "UNKNOWN_MARKET");
  }
  // Ten significant digits: whatever a slider or float left behind isn't part of the question.
  const above = Number(body.above.toPrecision(10));
  const oracle = { symbol: body.symbol, above, at: new Date(at) };
  return {
    oracle,
    closesAt: new Date(marketQuestionClosesAt(at, now)),
    question: marketQuestionText(oracle, { timeZone: zoneOr(body.tz), now }),
  };
}

/* ---- The price at a minute ---- */

const final = new Map<string, number>();
const pending = new Map<string, Promise<number | null>>();

async function readMinute(symbol: string, start: number, now: number): Promise<number | null> {
  // A window around the minute: ten before it (for a minute nobody traded
  // in) and up to five after (to know it's over).
  const from = new Date(start - 10 * MINUTE).toISOString();
  const to = new Date(Math.min(start + 5 * MINUTE, now)).toISOString();
  let res: Response;
  try {
    res = await fetch(`${SOURCE}/products/${symbol}/candles?granularity=60&start=${from}&end=${to}`, {
      headers: { "User-Agent": "xtream-live/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const rows = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(rows)) return null;
  // [time (s), low, high, open, close, volume], newest first.
  const candles = rows
    .filter((r): r is number[] => Array.isArray(r) && r.length >= 5 && r.every((n) => typeof n === "number" && Number.isFinite(n)))
    .map((r) => ({ t: r[0]! * 1000, close: r[4]! }))
    .filter((c) => c.close > 0);
  const exact = candles.find((c) => c.t === start);
  if (exact) return exact.close;
  // Coinbase leaves out a minute nobody traded in. Once a later minute has
  // a candle that one is over for good, and the last trade before it is
  // the price that stood.
  if (candles.some((c) => c.t > start)) {
    const before = candles.filter((c) => c.t < start).sort((a, b) => b.t - a.t)[0];
    if (before) return before.close;
  }
  return null;
}

/**
 * The close of Coinbase's 1-minute candle containing `at` — null until the
 * minute is over and the feed has it. Never throws: a feed that can't be
 * read is a price not in yet.
 */
export async function priceAt(symbol: string, at: Date | number, now = Date.now()): Promise<number | null> {
  const start = Math.floor(Number(at instanceof Date ? at.getTime() : at) / MINUTE) * MINUTE;
  if (!Number.isFinite(start) || now < start + MINUTE) return null;
  const key = `${symbol}:${start}`;
  const hit = final.get(key);
  if (hit !== undefined) return hit;
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const ask = readMinute(symbol, start, now)
    .catch(() => null)
    .then((price) => {
      if (price !== null) {
        final.set(key, price);
        if (final.size > 500) final.delete(final.keys().next().value!);
      }
      return price;
    })
    .finally(() => pending.delete(key));
  pending.set(key, ask);
  return ask;
}

/** For tests: forget every price read. */
export function clearOracleCache() {
  final.clear();
  pending.clear();
}
