"use client";

/**
 * The market layer on the client (Phase 3): live quotes for the price
 * strip and what chat's talking about. Filled in by the market-layer work;
 * this stub only fixes the shapes the studio and console build against.
 */

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
