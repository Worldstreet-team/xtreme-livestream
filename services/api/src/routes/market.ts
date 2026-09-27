import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { marketCandlesQuerySchema, marketQuotesQuerySchema, streamIdParamsSchema, type ChartInterval, type MarketQuote } from "@xtreme/contracts";
import { ApiError } from "../errors.js";
import { authenticate } from "../auth.js";
import { Stream } from "../models.js";
import { requireChannelRole } from "../safety/roles.js";
import { trendingOf } from "../tickers.js";

/**
 * Market candles for Chart + face (scene engine). Every viewer's screen
 * draws the chart itself, so each asks here; the API asks the market's
 * public feed once per market and interval every 15 seconds and shares
 * the answer — a thousand viewers cost one upstream call, and there's no
 * cross-origin or regional block for a browser to hit.
 *
 * Source: Coinbase Exchange's public candles (crypto pairs such as
 * BTC-USD; no key). Rows come back newest first as
 * [time, low, high, open, close, volume].
 */

const GRANULARITY: Record<ChartInterval, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
const CANDLES = 90;
const TTL_MS = 15_000;
const SOURCE = "https://api.exchange.coinbase.com";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface MarketView {
  symbol: string;
  interval: ChartInterval;
  candles: Candle[];
  last: number;
  changePct: number;
  source: "Coinbase";
  asOf: string;
}

const cache = new Map<string, { at: number; view?: MarketView | undefined; pending?: Promise<MarketView> | undefined }>();

/** For tests: forget everything cached. */
export function clearMarketCache() {
  cache.clear();
}

async function fetchMarket(symbol: string, interval: ChartInterval): Promise<MarketView> {
  let res: Response;
  try {
    res = await fetch(`${SOURCE}/products/${symbol}/candles?granularity=${GRANULARITY[interval]}`, {
      headers: { "User-Agent": "xtream-live/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
  }
  if (res.status === 404 || res.status === 400) {
    throw new ApiError(404, `There's no ${symbol} market to chart`, "UNKNOWN_MARKET");
  }
  if (!res.ok) {
    throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
  }
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
  }
  const candles: Candle[] = rows
    .slice(0, CANDLES)
    .filter((r): r is [number, number, number, number, number, number] =>
      Array.isArray(r) && r.length >= 6 && r.every((n) => typeof n === "number"),
    )
    .map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v }))
    .reverse();
  if (candles.length === 0) {
    throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
  }
  const first = candles[0]!.o;
  const last = candles[candles.length - 1]!.c;
  return {
    symbol,
    interval,
    candles,
    last,
    changePct: first ? ((last - first) / first) * 100 : 0,
    source: "Coinbase",
    asOf: new Date().toISOString(),
  };
}

/** The market, from the cache while it's fresh; one upstream call in flight per market at most. */
export async function getMarket(symbol: string, interval: ChartInterval, now = Date.now()): Promise<MarketView> {
  const key = `${symbol}:${interval}`;
  const hit = cache.get(key);
  if (hit?.view && now - hit.at < TTL_MS) return hit.view;
  if (hit?.pending) return hit.pending;
  const pending = fetchMarket(symbol, interval);
  cache.set(key, { at: hit?.at ?? 0, view: hit?.view, pending });
  try {
    const view = await pending;
    cache.set(key, { at: Date.now(), view });
    if (cache.size > 200) cache.delete(cache.keys().next().value!);
    return view;
  } catch (error) {
    // A stale chart beats none: keep serving the last good one for a while.
    if (hit?.view && now - hit.at < TTL_MS * 20) {
      cache.set(key, { at: hit.at, view: hit.view });
      return hit.view;
    }
    cache.delete(key);
    throw error;
  }
}

/* ---- Quotes, for the price strip (Phase 3, market layer) ---- */

const quoteCache = new Map<string, { at: number; quote?: MarketQuote | undefined; pending?: Promise<MarketQuote | null> | undefined }>();

/** One market's last price and its 24-hour move, from Coinbase's public stats. Null when there's no such market. */
async function fetchQuote(symbol: string): Promise<MarketQuote | null> {
  let res: Response;
  try {
    res = await fetch(`${SOURCE}/products/${symbol}/stats`, {
      headers: { "User-Agent": "xtream-live/1.0", Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
  } catch {
    throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
  }
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
  const stats = (await res.json()) as { open?: string; last?: string };
  const open = Number(stats.open);
  const last = Number(stats.last);
  if (!Number.isFinite(last) || last <= 0) return null;
  return { symbol, last, changePct: Number.isFinite(open) && open > 0 ? ((last - open) / open) * 100 : 0 };
}

/** When the quote a market's cache holds was fetched — a stale fallback keeps its old time. */
export function quoteTime(symbol: string): number | null {
  const hit = quoteCache.get(symbol);
  return hit?.quote ? hit.at : null;
}

/** A market's quote, shared for 15 seconds like the candles; a stale one beats none for a while. */
export async function getQuote(symbol: string, now = Date.now()): Promise<MarketQuote | null> {
  const hit = quoteCache.get(symbol);
  if (hit && !hit.pending && now - hit.at < TTL_MS) return hit.quote ?? null;
  if (hit?.pending) return hit.pending;
  const pending = fetchQuote(symbol);
  quoteCache.set(symbol, { at: hit?.at ?? 0, quote: hit?.quote, pending });
  try {
    const quote = await pending;
    quoteCache.set(symbol, { at: Date.now(), quote: quote ?? undefined });
    if (quoteCache.size > 300) quoteCache.delete(quoteCache.keys().next().value!);
    return quote;
  } catch (error) {
    if (hit?.quote && now - hit.at < TTL_MS * 20) {
      quoteCache.set(symbol, { at: hit.at, quote: hit.quote });
      return hit.quote;
    }
    quoteCache.delete(symbol);
    throw error;
  }
}

/**
 * A market's price as of now, for a record that keeps it — a call's entry
 * (calls.ts). Fetched afresh, or shared with a fetch already on its way,
 * and never the cached or stale one a strip makes do with: a price even
 * fifteen seconds old can be called against in a fast market. The strip
 * gets the fresh one too. Null when there's no such market.
 */
export async function freshQuote(symbol: string): Promise<MarketQuote | null> {
  const hit = quoteCache.get(symbol);
  if (hit?.pending) return hit.pending;
  const pending = fetchQuote(symbol);
  quoteCache.set(symbol, { at: hit?.at ?? 0, quote: hit?.quote, pending });
  try {
    const quote = await pending;
    quoteCache.set(symbol, { at: Date.now(), quote: quote ?? undefined });
    return quote;
  } catch (error) {
    // The strip keeps what it had; the record waits for a real price.
    if (hit?.quote) quoteCache.set(symbol, { at: hit.at, quote: hit.quote });
    else quoteCache.delete(symbol);
    throw error;
  }
}

/** For tests: forget the quotes. */
export function clearQuoteCache() {
  quoteCache.clear();
}

export const marketRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/market/candles",
    {
      schema: {
        tags: ["Market"],
        summary: "Recent candles for a market (Chart + face), shared and cached 15 seconds",
        querystring: marketCandlesQuerySchema,
      },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const view = await getMarket(request.query.symbol, request.query.interval);
      reply.header("Cache-Control", "public, max-age=10");
      return { success: true, data: view };
    },
  );

  app.get(
    "/market/quotes",
    {
      schema: {
        tags: ["Market"],
        summary: "The latest price and 24-hour move of up to five markets (the price strip), shared and cached 15 seconds",
        querystring: marketQuotesQuerySchema,
      },
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const symbols = request.query.symbols;
      const results = await Promise.allSettled(symbols.map((s) => getQuote(s)));
      const quotes = results.flatMap((r) => (r.status === "fulfilled" && r.value ? [r.value] : []));
      // Markets whose feed couldn't be read just now (not ones that don't exist): the strip says it's paused.
      const unavailable = symbols.filter((_, i) => results[i]!.status === "rejected");
      if (quotes.length === 0 && unavailable.length > 0) {
        throw new ApiError(502, "Market data is unavailable right now", "MARKET_UNAVAILABLE");
      }
      reply.header("Cache-Control", "public, max-age=10");
      return { success: true, data: { quotes, unavailable, source: "Coinbase", asOf: new Date().toISOString() } };
    },
  );

  app.get(
    "/streams/:id/tickers",
    {
      schema: {
        tags: ["Market"],
        summary: "The markets chat is talking about right now ($cashtags), for the host and their producers to chart",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("streamerId").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      await requireChannelRole(stream, dbUser._id, "producer");
      return { success: true, data: { tickers: trendingOf(stream._id) } };
    },
  );
};
