"use client";

import type { Trending } from "@/lib/market";

/**
 * What chat's talking about (market layer): the $cashtags mentioned most
 * in the last five minutes, each a tap from a chart — the host or a
 * producer decides; chat never puts a ticker up by itself.
 */
export function TickerChips({
  tickers,
  strip,
  onChart,
  onStrip,
}: {
  tickers: Trending[];
  /** Markets already on the price strip, so a chip can say so. */
  strip: string[];
  /** Chart + face with this market. */
  onChart: (symbol: string) => void;
  /** Add this market to the price strip. */
  onStrip?: (symbol: string) => void;
}) {
  void strip;
  void onChart;
  void onStrip;
  if (tickers.length === 0) return null;
  return null;
}
