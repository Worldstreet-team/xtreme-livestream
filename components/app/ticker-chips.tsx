"use client";

import { marketBase, type Trending } from "@/lib/market";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

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
  if (tickers.length === 0) return null;
  return (
    <div>
      <p className={LABEL}>Chat&apos;s talking about</p>
      <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Markets chat is mentioning">
        {tickers.map((t) => {
          const base = marketBase(t.symbol);
          const onStripAlready = strip.includes(t.symbol);
          return (
            <li key={t.symbol} className="flex h-8 max-w-full items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pr-0.5 pl-3">
              <span className="font-mono text-[11.5px] font-semibold text-foreground/85">${base}</span>
              {/* How often, so a lone mention doesn't read like a movement. */}
              <span className="font-mono text-[10.5px] text-muted-foreground tabular-nums" aria-label={`${t.mentions} mentions`}>
                ×{t.mentions}
              </span>
              <button
                type="button"
                onClick={() => onChart(t.symbol)}
                aria-label={`Chart ${base}`}
                className="press ml-1 h-7 shrink-0 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-[#0b0708]"
              >
                Chart it
              </button>
              {onStrip &&
                (onStripAlready ? (
                  <span className="px-2 text-[10.5px] font-medium text-muted-foreground">On strip</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onStrip(t.symbol)}
                    aria-label={`Add ${base} to the price strip`}
                    className="press h-7 shrink-0 rounded-full bg-white/[0.08] px-2.5 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-white/[0.12]"
                  >
                    + Strip
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
