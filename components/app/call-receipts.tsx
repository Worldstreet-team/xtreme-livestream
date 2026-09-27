"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import {
  CALL_CHECKPOINT_WORDS,
  CALL_CHECKPOINTS,
  callWords,
  checkpointState,
  fetchCalls,
  formatCallDate,
  formatCallPrice,
  formatCallTime,
  formatIn,
  formatMove,
  type CallCheckpoint,
  type CallSummary,
  type CallView,
} from "@/lib/market-calls";
import { cn } from "@/lib/utils";

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * A channel's calls (call receipts), on its Calls tab: "Not financial
 * advice" first, then the record in one strip — how many, how many went
 * the called way at 24 hours, the average move — then each call with the
 * price it was made at and its three checks. Every number is the API's;
 * the creator can't edit or delete any of it.
 */
export function CallReceipts({
  username,
  name,
  calls: first,
  next: firstNext,
  summary,
  now,
}: {
  username: string;
  /** The channel's name, as the page shows it. */
  name: string;
  calls: CallView[];
  next: string | null;
  summary: CallSummary;
  now: number;
}) {
  const [more, setMore] = useState<CallView[]>([]);
  const [next, setNext] = useState(firstNext);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const calls = [...first, ...more];

  const loadMore = async () => {
    if (!next) return;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchCalls(username, next);
      if (page.enabled) {
        setMore((cur) => [...cur, ...page.calls]);
        setNext(page.next);
      } else {
        setNext(null);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-labelledby="chan-calls" className="flex flex-col gap-4">
      <h2 id="chan-calls" className="sr-only">
        Calls
      </h2>
      <div role="note" className="rounded-[12px] bg-tint/[0.04] px-4 py-3.5">
        <p className="caps font-mono text-[10.5px] font-bold text-foreground">Not financial advice</p>
        <p className="mt-1.5 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
          Calls are {name}&apos;s own view of where a market goes, noted by Xtream the moment they were made — the prices are Coinbase&apos;s, and
          nobody can change them afterwards. How past calls went says nothing about the next one.
        </p>
      </div>

      <SummaryStrip summary={summary} />

      {/* Two across until the screen's truly wide: a checkpoint's price is never cut short. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {calls.map((c) => (
          <CallCard key={c.id} call={c} now={now} />
        ))}
      </div>

      {(next || failed) && (
        <div className="flex flex-col items-center gap-2">
          {failed && <p className="text-[12.5px] text-chili-hi">Couldn&apos;t load more just now.</p>}
          {next && (
            <Pill variant="glass" onClick={() => void loadMore()} disabled={loading}>
              {loading ? "Loading…" : "Show more calls"}
            </Pill>
          )}
        </div>
      )}
    </section>
  );
}

/** The record in one strip: how many, how many went the called way at 24 h, and the average move that way. */
function SummaryStrip({ summary }: { summary: CallSummary }) {
  const share = summary.rightShare24h;
  const avg = summary.avgMove24hPct;
  return (
    <div className="rounded-panel bg-surface p-4 md:p-5">
      <dl className="grid grid-cols-3 divide-x divide-tint/[0.06]">
        <Stat label={summary.total === 1 ? "call" : "calls"} value={String(summary.total)} />
        <Stat
          label="went the called way at 24 h"
          value={share === null ? "—" : `${Math.round(share * 100)}%`}
          sub={summary.checked24h ? `${summary.right24h} of ${summary.checked24h} checked` : "None checked yet"}
        />
        <Stat
          label="average move the called way, 24 h"
          value={avg === null ? "—" : `${avg > 0 ? "+" : avg < 0 ? "−" : ""}${formatMove(avg)}`}
        />
      </dl>
      <p className="mt-4 border-t border-tint/[0.06] pt-3 text-[12px] leading-snug text-muted-foreground">
        Checked against Coinbase&apos;s price 1 hour, 24 hours and 7 days after each call.{" "}
        <span className="text-success">Green</span> is the price having moved the way it was called.
        {summary.hidden > 0 && ` ${summary.hidden} ${summary.hidden === 1 ? "call was" : "calls were"} hidden by Xtream's moderators.`}
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col px-3 first:pl-0 last:pr-0 md:px-5">
      <dd className="order-1 font-money text-[clamp(1.4rem,5vw,2.1rem)] leading-none tabular-nums">{value}</dd>
      <dt className="order-2 mt-2 text-[12px] leading-snug text-muted-foreground md:text-[13px]">{label}</dt>
      {sub && <dd className="order-3 mt-1 text-[11.5px] text-muted-foreground/80">{sub}</dd>}
    </div>
  );
}

/** One call: what was called and from where, why, and its three checks. */
function CallCard({ call, now }: { call: CallView; now: number }) {
  const Mark = call.direction === "up" ? ArrowUp : ArrowDown;
  return (
    <article className="flex flex-col rounded-panel bg-surface p-4" aria-label={`${callWords(call)} from ${formatCallPrice(call.symbol, call.entry.price)}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-tint/[0.07] text-foreground">
          <Mark size={18} weight="bold" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-wide text-[17px] leading-tight font-bold tracking-[-0.02em]">{callWords(call)}</p>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground" suppressHydrationWarning>
            from <span className="font-money text-[13.5px] text-foreground">{formatCallPrice(call.symbol, call.entry.price)}</span> ·{" "}
            {formatCallDate(call.entry.at)}, {formatCallTime(call.entry.at)}
          </p>
        </div>
      </div>
      {call.note && <p className="mt-3 line-clamp-2 text-[13.5px] leading-snug break-words text-foreground/80">&ldquo;{call.note}&rdquo;</p>}
      <dl className="mt-auto grid grid-cols-3 gap-1.5 pt-4">
        {CALL_CHECKPOINTS.map((k) => (
          <Checkpoint key={k} call={call} k={k} now={now} />
        ))}
      </dl>
    </article>
  );
}

function Checkpoint({ call, k, now }: { call: CallView; k: CallCheckpoint; now: number }) {
  const s = checkpointState(call, k, now);
  return (
    <div className="min-w-0 rounded-[10px] bg-tint/[0.04] px-2.5 py-2">
      <dt className={EYEBROW}>{CALL_CHECKPOINT_WORDS[k]}</dt>
      {s.state === "done" ? (
        <dd className="mt-1">
          <span className={cn("block font-mono text-[13px] font-bold whitespace-nowrap tabular-nums", s.calledWay ? "text-success" : "text-foreground/60")}>
            <span aria-hidden className="text-[0.72em]">{s.changePct > 0 ? "▲" : s.changePct < 0 ? "▼" : "·"}</span>
            <span className="sr-only">{s.changePct > 0 ? "up" : s.changePct < 0 ? "down" : "flat"}</span> {formatMove(s.changePct)}
            <span className="sr-only">{s.calledWay ? ", the way it was called" : ", not the way it was called"}</span>
          </span>
          <span className="mt-0.5 block font-mono text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums">{formatCallPrice(call.symbol, s.price)}</span>
        </dd>
      ) : (
        <dd className="mt-1 text-[12.5px] font-semibold text-foreground/60" suppressHydrationWarning title={s.state === "unavailable" ? "Coinbase had no price for that minute" : undefined}>
          {s.state === "pending" ? formatIn(s.inMs) : s.state === "checking" ? "Checking…" : "No price"}
        </dd>
      )}
    </div>
  );
}
