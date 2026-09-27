"use client";

import { useEffect, useState } from "react";
import { CALL_NOTE_MAX } from "@xtreme/contracts";
import { ArrowDown, ArrowUp, MagnifyingGlass } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { marketBase, useQuotes } from "@/lib/market";
import {
  callWords,
  fetchCallMarkets,
  formatCallPrice,
  formatCallTime,
  postCall,
  useCallsEnabled,
  type CallDirection,
  type CallLayer,
} from "@/lib/market-calls";
import { CHART_MARKETS } from "@/lib/scene";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const FIELD =
  "h-10 w-full rounded-full bg-white/[0.06] px-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-white/[0.09]";
/** Somewhere to start when the price strip is empty. */
const STARTERS = CHART_MARKETS.filter((m) => m !== "USDT-USD").slice(0, 4);
const DIRECTIONS: { id: CallDirection; label: string; Icon: typeof ArrowUp }[] = [
  { id: "up", label: "Up", Icon: ArrowUp },
  { id: "down", label: "Down", Icon: ArrowDown },
];

/**
 * Make a call (call receipts), in the graphics panel: a market — the price
 * strip's first, any other a search away — which way, and a line on why.
 * Then a plain-words check before anything is written, because it's for
 * good: the API notes the price and the time itself, the card goes up on
 * the stream, and the channel's Calls show how it went at 1 h, 24 h and
 * 7 d. Hidden entirely while the platform's switch is off.
 */
export function MakeACall({
  streamId,
  strip,
  up,
  carded,
  battle,
  onPut,
  onTake,
}: {
  /** The live stream the call is made on. */
  streamId: string;
  /** The markets on the price strip: offered first. */
  strip: string[];
  /** The call card on screen now, if there is one. */
  up: CallLayer | undefined;
  carded: boolean;
  battle: boolean;
  /** Put a call card up (through the panel's layers). */
  onPut: (layer: CallLayer) => void;
  /** Take the card down — the call itself stays on the record. */
  onTake: () => void;
}) {
  const on = useCallsEnabled();
  const [symbol, setSymbol] = useState<string | null>(null);
  const [direction, setDirection] = useState<CallDirection | null>(null);
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [known, setKnown] = useState<string[] | null>(null);
  const [marketsFailed, setMarketsFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The last call made here, so a card taken down can go back up. */
  const [made, setMade] = useState<CallLayer | null>(null);
  const { quotes } = useQuotes(on && confirming && symbol ? [symbol] : []);

  // The whole list only once someone searches (and again on the next search, if it couldn't be had).
  const searching = query.trim().length > 0;
  useEffect(() => {
    if (!searching || known) return;
    let live = true;
    void fetchCallMarkets().then((m) => {
      if (!live) return;
      setMarketsFailed(m === null);
      if (m) setKnown(m);
    });
    return () => {
      live = false;
    };
  }, [searching, known]);

  if (!on) return null;

  const offered = strip.length > 0 ? strip : STARTERS;
  const chips = symbol && !offered.includes(symbol) ? [...offered, symbol] : offered;
  const q = query.trim().toUpperCase().replace(/^\$/, "");
  const found = searching && known ? known.filter((m) => marketBase(m).startsWith(q) || m.startsWith(q)).slice(0, 8) : [];
  const price = symbol ? quotes.find((x) => x.symbol === symbol)?.last : undefined;
  const ready = Boolean(symbol && direction);
  const waiting = battle ? "A battle has the top of the picture — the card shows when it ends." : carded ? "A card is up — the call shows when it comes down." : null;

  const pick = (m: string) => {
    setSymbol(m);
    setQuery("");
    setConfirming(false);
  };

  const make = async () => {
    if (!symbol || !direction) return;
    setBusy(true);
    setError(null);
    try {
      const { layer } = await postCall(streamId, { symbol, direction, note: note.trim() });
      setMade(layer);
      onPut(layer);
      setConfirming(false);
      setDirection(null);
      setNote("");
    } catch (err) {
      setConfirming(false);
      setError(err instanceof Error ? err.message : "Couldn't make that call — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("rounded-[12px] p-3 transition-colors", up ? "bg-white/[0.07]" : "bg-white/[0.04]")}>
      <div className="flex min-h-8 items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold">Make a call</span>
          {up && (
            <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-medium text-ember-hi">
              <span aria-hidden className="size-1.5 rounded-full bg-ember" />
              {callWords(up)} · {waiting ? "waiting to show" : "on screen"}
            </span>
          )}
        </span>
        {up ? (
          <button
            type="button"
            onClick={onTake}
            className="press h-8 shrink-0 rounded-full bg-white/[0.08] px-3.5 text-[12px] font-bold text-foreground transition-colors hover:bg-white/[0.12]"
          >
            Hide
          </button>
        ) : made ? (
          <button type="button" onClick={() => onPut(made)} className="press h-8 shrink-0 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708]">
            Show again
          </button>
        ) : null}
      </div>

      <div className="mt-2.5 flex flex-col gap-2.5">
        <p className="text-[12px] leading-snug text-muted-foreground">
          Say where a market&apos;s going. Xtream notes the price and the time itself, and your channel shows how it went.
        </p>

        <div className="flex flex-col gap-2">
          <p className={LABEL}>Market</p>
          <div className="flex flex-wrap gap-1.5" aria-label="Markets">
            {chips.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={symbol === m}
                onClick={() => pick(m)}
                className={cn(
                  "press h-8 rounded-full px-3 font-mono text-[11.5px] font-semibold transition-colors",
                  symbol === m ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
                )}
              >
                {m.replace("-", "/")}
              </button>
            ))}
          </div>
          <label className="relative block">
            <span className="sr-only">Search markets</span>
            <MagnifyingGlass size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && found[0] && pick(found[0])}
              placeholder="Another coin, like ADA or PEPE"
              maxLength={12}
              className="h-9 w-full rounded-full bg-white/[0.06] pr-3.5 pl-9 font-mono text-[12.5px] text-foreground uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground focus:bg-white/[0.09]"
            />
          </label>
          {searching &&
            (known === null ? (
              <p className="text-[11.5px] text-muted-foreground">
                {marketsFailed ? "Couldn't load Coinbase's markets just now — clear the search and try again." : "Looking through Coinbase's markets…"}
              </p>
            ) : found.length === 0 ? (
              <p className="text-[11.5px] text-muted-foreground">Coinbase doesn&apos;t trade that in dollars.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5" aria-label="Markets found">
                {found.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => pick(m)}
                    className="press h-8 rounded-full bg-white/[0.06] px-3 font-mono text-[11.5px] font-semibold text-foreground/85 transition-colors hover:bg-white/[0.1]"
                  >
                    {m.replace("-", "/")}
                  </button>
                ))}
              </div>
            ))}
        </div>

        <div role="radiogroup" aria-label="Which way" className="grid grid-cols-2 gap-1.5">
          {DIRECTIONS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={direction === id}
              onClick={() => {
                setDirection(id);
                setConfirming(false);
              }}
              className={cn(
                "press flex h-10 items-center justify-center gap-1.5 rounded-full text-[13px] font-bold transition-colors",
                direction === id ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
              )}
            >
              <Icon size={15} weight="bold" />
              {label}
            </button>
          ))}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={CALL_NOTE_MAX}
          placeholder="Why, in a line (optional)"
          aria-label="Why you're calling it"
          className={FIELD}
        />

        {confirming && symbol && direction ? (
          <div role="group" aria-label="Check the call" className="rounded-[10px] bg-white/[0.06] p-3">
            <p className="text-[13px] leading-snug text-foreground">
              <span className="font-bold">{callWords({ symbol, direction })}</span>,{" "}
              {price ? (
                <>
                  from about <span className="font-money tabular-nums">{formatCallPrice(symbol, price)}</span>
                </>
              ) : (
                "at Coinbase's price the moment you confirm"
              )}
              .
            </p>
            {note.trim() && <p className="mt-1 line-clamp-2 text-[12px] break-words text-foreground/75">&ldquo;{note.trim()}&rdquo;</p>}
            <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
              It goes on your channel&apos;s Calls with how it went at 1 hour, 24 hours and 7 days — it can&apos;t be edited or deleted.
            </p>
            <div className="mt-3 flex gap-1.5">
              <Pill variant="primary" size="sm" onClick={() => void make()} disabled={busy}>
                {busy ? "Making it…" : "Make the call"}
              </Pill>
              <Pill variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                Back
              </Pill>
            </div>
          </div>
        ) : (
          <Pill
            variant="primary"
            size="md"
            className="w-full"
            disabled={!ready}
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            {ready ? `Call ${callWords({ symbol: symbol!, direction: direction! })}` : "Make a call"}
          </Pill>
        )}

        {error && (
          <p role="alert" className="rounded-[10px] bg-chili/[0.12] px-3 py-2 text-[12px] text-chili-hi">
            {error}
          </p>
        )}
        {made && !confirming && (
          // What was written down: the API's price and time, which can differ a touch from the "about" above.
          <p role="status" className="text-[12px] leading-snug text-muted-foreground">
            Recorded: <span className="font-semibold text-foreground/85">{callWords(made)}</span> from {formatCallPrice(made.symbol, made.entryPrice)} at{" "}
            {formatCallTime(made.entryAt)} — it&apos;s on your channel&apos;s Calls.
          </p>
        )}
        {up && waiting && <p className="text-[12px] leading-snug text-muted-foreground">{waiting}</p>}
        <p className="text-[12px] leading-snug text-muted-foreground">
          On screen with &ldquo;Not financial advice&rdquo;, always. No links, no buy buttons.
        </p>
      </div>
    </div>
  );
}
