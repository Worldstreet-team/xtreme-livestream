/**
 * Which markets exist (Phase 3, market layer): every USD market Coinbase
 * trades, refreshed every few hours — what a $cashtag in chat can become a
 * chart of. Majors stand in if the list can't be read.
 */

const SOURCE = "https://api.exchange.coinbase.com";
/** Majors to fall back on if the product list can't be read. */
const MAJORS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "DOT", "LTC", "BCH", "SHIB", "PEPE", "SUI", "POL", "UNI", "AAVE", "USDT", "USDC"];
const MARKETS_TTL_MS = 6 * 3_600_000;
let markets: { at: number; ids: Set<string> } | null = null;
let marketsPending: Promise<Set<string>> | null = null;

/** Every USD market Coinbase trades, refreshed every few hours — what a cashtag can become a chart of. */
export async function knownMarkets(now = Date.now()): Promise<Set<string>> {
  if (markets && now - markets.at < MARKETS_TTL_MS) return markets.ids;
  if (marketsPending) return marketsPending;
  marketsPending = (async () => {
    try {
      const res = await fetch(`${SOURCE}/products`, { headers: { "User-Agent": "xtream-live/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`products ${res.status}`);
      const rows = (await res.json()) as Array<{ id?: string; quote_currency?: string; trading_disabled?: boolean }>;
      const ids = new Set(rows.filter((r) => r.quote_currency === "USD" && !r.trading_disabled && r.id).map((r) => r.id!));
      if (ids.size === 0) throw new Error("no products");
      markets = { at: Date.now(), ids };
      return ids;
    } catch {
      const ids = markets?.ids ?? new Set(MAJORS.map((m) => `${m}-USD`));
      markets = { at: Date.now() - MARKETS_TTL_MS + 10 * 60_000, ids };
      return ids;
    } finally {
      marketsPending = null;
    }
  })();
  return marketsPending;
}

/** For tests: set which markets exist. */
export function setKnownMarkets(ids: string[] | null) {
  markets = ids ? { at: Date.now(), ids: new Set(ids) } : null;
}

