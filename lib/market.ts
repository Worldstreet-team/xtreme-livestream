"use client";

import { useEffect, useMemo, useState } from "react";
import type { MarketQuote } from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";

/**
 * The market layer on the client (Phase 3): live quotes for the price
 * strip and what chat's talking about. The numbers come from our shared
 * feed (/market/quotes, cached 15 s on the API, so every viewer sees the
 * same ones); this file reads them off the wire and puts them into words.
 */

export type { MarketQuote };

/** A market chat keeps mentioning, and how often in the last five minutes. */
export interface Trending {
  symbol: string;
  mentions: number;
}

/** Tickers off the wire (`__evt: "tickers"`, GET /streams/:id/tickers), as far as they make sense. */
export function readTickers(raw: unknown): Trending[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is { symbol: string; mentions: number } => Boolean(t) && typeof t === "object" && typeof (t as { symbol?: unknown }).symbol === "string")
    .map((t) => ({ symbol: String(t.symbol).toUpperCase().slice(0, 15), mentions: Math.max(0, Number(t.mentions) || 0) }))
    .slice(0, 5);
}

/** "SOL-USD" → "SOL": the coin, as chat writes it. */
export function marketBase(symbol: string) {
  return symbol.split("-")[0] ?? symbol;
}

/** Prices at the scale they're read at: 83,741.2 · 2,713.88 · 0.1734. */
export function formatPrice(n: number) {
  // Below a cent (PEPE, SHIB) four decimals read as nothing: significant figures instead.
  if (n > 0 && n < 0.01) return n.toLocaleString("en-US", { minimumSignificantDigits: 2, maximumSignificantDigits: 4 });
  const digits = n >= 1000 ? 1 : n >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** A dollar sign for markets priced in dollars ("$83,741.2"); any other quote is named after the number ("0.0523 BTC"). */
export function formatQuote(symbol: string, last: number) {
  const quote = symbol.split("-")[1] ?? "";
  return quote === "USD" || quote === "USDT" || quote === "USDC" ? `$${formatPrice(last)}` : `${formatPrice(last)} ${quote}`.trim();
}

/** How often the strip asks for fresh prices — as long as the API keeps them. */
const QUOTES_MS = 15_000;

export interface QuotesView {
  /** One per market that exists, in the strip's order. */
  quotes: MarketQuote[];
  /** Whose numbers they are, for the disclosure. */
  source: string;
  asOf: string | null;
  /** The last fetch didn't land: what's shown is the last good set. */
  failed: boolean;
}

const NO_QUOTES: QuotesView = { quotes: [], source: "Coinbase", asOf: null, failed: false };

/**
 * The latest prices for some markets, fresh every 15 s. Nothing is asked
 * for an empty list. When a fetch fails, the last good prices stay up,
 * marked as such, rather than the strip going blank mid-show; a market
 * that doesn't exist is simply missing.
 */
export function useQuotes(symbols: string[]): QuotesView {
  // The list as a string: the same markets in the same order is the same list.
  const key = symbols.join(",");
  const [view, setView] = useState<QuotesView>(NO_QUOTES);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await apiFetch<{ success: boolean; data: { quotes: MarketQuote[]; unavailable?: string[]; source: string; asOf: string } }>(
          `/api/market/quotes?symbols=${encodeURIComponent(key)}`
        );
        if (cancelled) return;
        // A market the feed couldn't read just now: the strip shows the rest, and says it's paused.
        setView({ quotes: r.data.quotes, source: r.data.source || "Coinbase", asOf: r.data.asOf || null, failed: (r.data.unavailable?.length ?? 0) > 0 });
      } catch {
        if (!cancelled) setView((cur) => ({ ...cur, failed: true }));
      }
    };
    void load();
    const t = setInterval(() => void load(), QUOTES_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key]);

  // Only the markets asked for, in their order: a market taken off the strip
  // goes at once, and one just added shows as soon as its price lands.
  return useMemo(() => {
    const wanted = key ? key.split(",") : [];
    const quotes = wanted.flatMap((symbol) => {
      const q = view.quotes.find((x) => x.symbol === symbol);
      return q ? [q] : [];
    });
    return { ...view, quotes };
  }, [key, view]);
}
