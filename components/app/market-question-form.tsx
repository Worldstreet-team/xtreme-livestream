"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatMarketTime,
  formatMarketUsd,
  marketQuestionClosesAt,
  marketQuestionText,
  marketThreshold,
  type MarketOracleBody,
  type MarketQuestionPreset,
} from "@xtreme/contracts";
import { ChartLineUp, MagnifyingGlass, Minus, Plus } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api-client";
import { formatQuote, marketBase, useQuotes } from "@/lib/market";
import {
  QUESTION_TIMES,
  deviceTimeZone,
  inQuestionRange,
  minutesFromNow,
  nextClockTime,
  nudgeThreshold,
  questionMarkets,
  readThreshold,
  searchMarkets,
  thresholdNudge,
} from "@/lib/market-questions";
import { serverOffset } from "@/lib/server-clock";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const FIELD = "text-[11px] text-muted-foreground";
const CHIP = "press h-7 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors";
const chipTone = (on: boolean) => (on ? "bg-white text-neutral-950" : "bg-control text-foreground/90 hover:bg-control-hover");

/** Known markets for the search, fetched once per page. */
let knownCache: Promise<string[]> | null = null;
function loadKnown() {
  knownCache ??= apiFetch<{ success: boolean; data: { symbols: string[] } }>("/api/market/known")
    .then((r) => r.data.symbols)
    .catch(() => {
      knownCache = null;
      return [];
    });
  return knownCache;
}

type When = (typeof QUESTION_TIMES)[number]["id"] | "custom";

/** A preset's time as the quick choice it matches, or a custom one. */
const whenOf = (preset: MarketQuestionPreset | null): When => (preset ? (QUESTION_TIMES.find((t) => t.minutes === preset.minutes)?.id ?? "custom") : "15");

/**
 * The Games panel's market question: pick a market (what's on the strip,
 * what chat's naming, or any Coinbase dollar market), where the line sits
 * (the price rounded to a real question), and when it's decided — and see
 * the question exactly as it will read. It opens as a vote that settles
 * itself from Coinbase; nobody settles it by hand.
 */
export function MarketQuestionForm({
  markets = [],
  preset = null,
  busy = false,
  onOpen,
}: {
  /** Markets to offer first: the price strip's, chat's, the chart's. */
  markets?: string[];
  /** A question filled in from elsewhere (a market move's "Ask chat"); a new object each time. */
  preset?: MarketQuestionPreset | null;
  busy?: boolean;
  onOpen: (oracle: MarketOracleBody) => void;
}) {
  // The seconds tick while the form is open: "+15 min" means from now.
  const now = useNow(true) + serverOffset();
  const offered = useMemo(() => questionMarkets(markets), [markets]);
  const [symbol, setSymbol] = useState(() => preset?.symbol ?? offered[0] ?? "BTC-USD");
  /** The line as the host typed or nudged it; null follows the price. */
  const [typedLine, setTypedLine] = useState<string | null>(() => (preset ? String(preset.above) : null));
  const [when, setWhen] = useState<When>(() => whenOf(preset));
  const [clock, setClock] = useState(() => (preset && whenOf(preset) === "custom" ? formatMarketTime(minutesFromNow(preset.minutes, now)) : ""));
  const [query, setQuery] = useState("");
  const [known, setKnown] = useState<string[] | null>(null);

  // A market move's "Ask chat" while the form is open: its market, its line and its time.
  const [seenPreset, setSeenPreset] = useState(preset);
  if (preset !== seenPreset) {
    setSeenPreset(preset);
    if (preset) {
      setSymbol(preset.symbol);
      setTypedLine(String(preset.above));
      setWhen(whenOf(preset));
      if (whenOf(preset) === "custom") setClock(formatMarketTime(minutesFromNow(preset.minutes, now)));
    }
  }

  const { quotes, failed } = useQuotes([symbol]);
  const price = quotes[0]?.last ?? null;
  // Until the host sets it, the line follows the price — rounded to a real question.
  const lineText = typedLine ?? (price !== null ? String(marketThreshold(price)) : "");

  useEffect(() => {
    if (!query || known) return;
    let alive = true;
    void loadKnown().then((list) => alive && setKnown(list));
    return () => {
      alive = false;
    };
  }, [query, known]);

  const pick = (next: string) => {
    if (next === symbol) return;
    setSymbol(next);
    setTypedLine(null);
    setQuery("");
  };

  const found = useMemo(() => {
    if (!query.trim()) return [];
    const hits = searchMarkets(known ?? [], query);
    // The list can't be read: offer what was typed; the API says if it's no market.
    const typed = `${query.trim().toUpperCase().replace(/^\$/, "").replace(/-USD$/, "")}-USD`;
    return hits.length > 0 || !/^[A-Z0-9]{2,10}-USD$/.test(typed) || (known && known.length > 0) ? hits : [typed];
  }, [known, query]);

  const line = readThreshold(lineText);
  const minutes = QUESTION_TIMES.find((t) => t.id === when)?.minutes ?? null;
  const at = minutes !== null ? minutesFromNow(minutes, now) : nextClockTime(clock, now);
  const timeOk = at !== null && inQuestionRange(at, now);
  const step = thresholdNudge(price ?? line ?? 1);
  const question = line !== null && at !== null ? marketQuestionText({ symbol, above: line, at }, { now }) : null;
  const closes = at !== null ? marketQuestionClosesAt(at, now) : null;
  const ready = line !== null && timeOk && !busy;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className={FIELD}>Market</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Market">
          {[...offered, ...(offered.includes(symbol) ? [] : [symbol])].map((m) => (
            <button key={m} type="button" role="radio" aria-checked={m === symbol} onClick={() => pick(m)} className={cn(CHIP, "font-mono", chipTone(m === symbol))}>
              {marketBase(m)}
            </button>
          ))}
        </div>
        <label className="mt-2 flex h-9 items-center gap-2 rounded-sm bg-white/[0.06] px-3 focus-within:bg-white/[0.09]">
          <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={14}
            placeholder="Another market — ADA, LINK…"
            aria-label="Search markets"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground uppercase outline-none placeholder:normal-case placeholder:text-muted-foreground/60"
          />
        </label>
        {query.trim() && (
          <div className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Markets found">
            {found.length > 0 ? (
              found.map((m) => (
                <button key={m} type="button" onClick={() => pick(m)} className={cn(CHIP, "font-mono", chipTone(false))}>
                  {marketBase(m)}
                </button>
              ))
            ) : (
              <span className="text-[11.5px] text-muted-foreground">{known ? "No dollar market by that name on Coinbase." : "Looking…"}</span>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className={FIELD}>Above</p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {price !== null ? (
              <>
                Now <span className="font-money text-foreground/85">{formatQuote(symbol, price)}</span>
                {failed && " · paused"}
              </>
            ) : failed ? (
              "Price unavailable"
            ) : (
              "Getting the price…"
            )}
          </p>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Lower the line by ${formatMarketUsd(step)}`}
            disabled={line === null}
            onClick={() => line !== null && setTypedLine(String(nudgeThreshold(line, step, -1)))}
            className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground transition-colors hover:bg-white/[0.1] disabled:opacity-40"
          >
            <Minus size={14} />
          </button>
          <label className="flex h-9 min-w-0 flex-1 items-center gap-1 rounded-sm bg-white/[0.06] px-3 focus-within:bg-white/[0.09]">
            <span className="text-sm text-muted-foreground">$</span>
            <input
              value={lineText}
              onChange={(e) => setTypedLine(e.target.value)}
              inputMode="decimal"
              maxLength={16}
              aria-label="The line: the question asks if the price is above this"
              className="h-full min-w-0 flex-1 bg-transparent font-money text-sm text-foreground tabular-nums outline-none"
            />
          </label>
          <button
            type="button"
            aria-label={`Raise the line by ${formatMarketUsd(step)}`}
            disabled={line === null}
            onClick={() => line !== null && setTypedLine(String(nudgeThreshold(line, step, 1)))}
            className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground transition-colors hover:bg-white/[0.1] disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      <div>
        <p className={FIELD}>Decided</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="When it's decided">
          {QUESTION_TIMES.map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={when === t.id} onClick={() => setWhen(t.id)} className={cn(CHIP, chipTone(when === t.id))}>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={when === "custom"}
            onClick={() => {
              setWhen("custom");
              if (!clock) setClock(formatMarketTime(minutesFromNow(30, now)));
            }}
            className={cn(CHIP, chipTone(when === "custom"))}
          >
            Custom
          </button>
          {when === "custom" && (
            <input
              type="time"
              value={clock}
              onChange={(e) => setClock(e.target.value)}
              aria-label="Decided at"
              className="h-7 rounded-full bg-white/[0.06] px-2.5 text-[12px] text-foreground tabular-nums outline-none [color-scheme:dark] focus:bg-white/[0.09]"
            />
          )}
        </div>
        {at !== null && !timeOk && <p className="mt-1.5 text-[11.5px] text-chili-hi">Pick a time 5 minutes to 24 hours from now.</p>}
      </div>

      {/* The question exactly as it will read — the host can't edit the words. */}
      <div className="rounded-[10px] bg-white/[0.04] px-3 py-2.5" aria-live="polite">
        <p className="caps flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <ChartLineUp size={12} />
          Viewers see
        </p>
        <p className="mt-1.5 text-[14px] leading-snug font-semibold text-foreground">{question ?? "Set the line to see the question"}</p>
        <div className="mt-2 flex gap-1.5">
          {["Yes", "No"].map((o) => (
            <span key={o} className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[11.5px] font-semibold text-foreground/85">
              {o}
            </span>
          ))}
        </div>
        {closes !== null && at !== null && timeOk && (
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground tabular-nums">
            Votes close {formatMarketTime(closes)} · settles itself at {formatMarketTime(at)} from Coinbase&apos;s price
          </p>
        )}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground/80">
        A vote: nobody stakes or wins points. It settles itself from Coinbase — you can&apos;t settle it by hand, only call it off. Not financial advice.
      </p>

      <div className="flex justify-end">
        <Pill
          size="sm"
          variant="primary"
          disabled={!ready}
          onClick={() => {
            if (!ready || line === null || at === null) return;
            onOpen({ symbol, above: line, at: new Date(at).toISOString(), tz: deviceTimeZone() });
          }}
        >
          Open vote
        </Pill>
      </div>
    </div>
  );
}
