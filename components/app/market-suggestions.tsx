"use client";

import { useState } from "react";
import { formatMarketTime, formatMarketUsd, type ChartInterval } from "@xtreme/contracts";
import { X } from "@/components/icons";
import { marketBase } from "@/lib/market";
import type { MarketQuestionPreset, MarketSuggestion } from "@/lib/market-suggestions";
import { cn } from "@/lib/utils";

export { readSuggestion, suggestionsReducer, useMarketSuggestions, SUGGESTION_TTL_MS } from "@/lib/market-suggestions";
export type { SuggestionsAction, SuggestionsState } from "@/lib/market-suggestions";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const PRIMARY = "press h-7 shrink-0 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-[#0b0708]";
const QUIET =
  "press h-7 shrink-0 rounded-full bg-white/[0.08] px-2.5 text-[11.5px] font-semibold text-foreground transition-colors hover:bg-white/[0.12]";
/** How many show before "more". */
const SHOWN = 3;

/** Which way it went: a move by its sign, a round number by the side the price is on now. */
function isUp(s: MarketSuggestion) {
  if (s.kind === "high") return true;
  if (s.kind === "low") return false;
  if (s.kind === "round" && s.level !== null) return s.price >= s.level;
  return s.changePct >= 0;
}

/**
 * The market as director, in the Scenes panel (Phase 4): a market the show
 * cares about just moved — "SOL +3.4% in 15 min", "BTC crossed $85,000", a
 * new high for the stream — and here's a tap to chart it, put a line up as
 * the banner, or ask chat about it. Nothing goes on screen until someone
 * taps; a producer's console leaves out asking chat (games are the host's).
 */
export function MarketSuggestions({
  suggestions,
  onChart,
  onBanner,
  onPredict,
  onDismiss,
  charted = null,
  className,
}: {
  /** Newest first — `useMarketSuggestions(streamId).suggestions`. */
  suggestions: MarketSuggestion[];
  /** Chart + face on this market, at the zoom that shows the move. */
  onChart: (symbol: string, interval: ChartInterval) => void;
  /** Put this line up as the banner. */
  onBanner: (text: string) => void;
  /** Open the Games panel's market question with this filled in; the host still opens it. */
  onPredict?: (preset: MarketQuestionPreset) => void;
  onDismiss: (id: string) => void;
  /** The market Chart + face is showing right now, if it's up — its suggestion says so instead. */
  charted?: string | null;
  className?: string;
}) {
  const [all, setAll] = useState(false);
  if (suggestions.length === 0) return null;
  const shown = all ? suggestions : suggestions.slice(0, SHOWN);
  const more = suggestions.length - shown.length;

  return (
    <section aria-labelledby="market-moves" className={className}>
      <p id="market-moves" className={LABEL}>
        Market moves
      </p>
      <ul className="mt-2 flex flex-col gap-1.5" aria-label="What the markets just did">
        {shown.map((s) => {
          const up = isUp(s);
          const base = marketBase(s.symbol);
          const onChartNow = charted === s.actions.chart.symbol;
          return (
            <li key={s.id} className="rounded-[12px] bg-white/[0.04] py-2.5 pr-1.5 pl-3">
              <div className="flex items-start gap-2">
                <span aria-hidden className={cn("mt-px w-3 shrink-0 font-mono text-[11px] leading-5", up ? "text-success" : "text-chili-hi")}>
                  {up ? "▲" : "▼"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] leading-5 font-semibold text-foreground">
                    <span className="sr-only">{up ? "Up: " : "Down: "}</span>
                    {s.text}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[11.5px] text-muted-foreground">
                    <span className="font-money text-[12px] text-foreground/85 tabular-nums">{formatMarketUsd(s.price)}</span>
                    {s.kind !== "move" && s.windowMin > 0 && (
                      <span className="tabular-nums">
                        · {s.changePct >= 0 ? "+" : "−"}
                        {Math.abs(s.changePct).toFixed(1)}% in {s.windowMin} min
                      </span>
                    )}
                    <span className="tabular-nums">· {formatMarketTime(s.at)}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {onChartNow ? (
                      <span className="px-1 text-[11px] font-medium text-muted-foreground">On chart</span>
                    ) : (
                      <button type="button" onClick={() => onChart(s.actions.chart.symbol, s.actions.chart.interval)} aria-label={`Chart ${base}`} className={PRIMARY}>
                        Chart it
                      </button>
                    )}
                    {s.actions.banner && (
                      <button type="button" onClick={() => onBanner(s.actions.banner)} aria-label={`Banner: ${s.actions.banner}`} className={QUIET}>
                        Banner
                      </button>
                    )}
                    {onPredict && s.actions.question && (
                      <button
                        type="button"
                        onClick={() => onPredict(s.actions.question!)}
                        aria-label={`Ask chat whether ${base} is above ${formatMarketUsd(s.actions.question.above)} in ${s.actions.question.minutes} minutes`}
                        className={QUIET}
                      >
                        Ask chat
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onDismiss(s.id)}
                  aria-label={`Dismiss: ${s.text}`}
                  className="press flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                >
                  <X size={13} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {(more > 0 || all) && suggestions.length > SHOWN && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1.5 px-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground">
          {all ? "Fewer" : `${more} more`}
        </button>
      )}
      <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground/80">Coinbase prices · Not financial advice · nothing goes on screen until you tap.</p>
    </section>
  );
}
