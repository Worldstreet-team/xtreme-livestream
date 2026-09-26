"use client";

import type { ReactNode } from "react";
import { ChatText } from "@/components/icons";
import { AudienceCurve } from "@/components/app/audience-curve";
import { durationWords, MOMENT_LABELS, minuteStamp, useStreamAnalytics, type StreamAnalytics } from "@/lib/analytics";
import { centsToDollars } from "@/lib/gifts";
import { cn } from "@/lib/utils";

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/** One number and what it is. */
function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "value" }) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW}>{label}</p>
      <p className={cn("mt-1.5 truncate font-money text-[24px] leading-none tabular-nums md:text-[26px]", tone === "value" && "text-value")}>{value}</p>
    </div>
  );
}

/**
 * The recap (live analytics): how a broadcast went, minute by minute — the
 * audience curve with what happened on it, the numbers that matter, where
 * people left and what was on then, and what the chat asked.
 */
export function RecapTile({
  analytics,
  title,
  eyebrow = "Recap",
  action,
}: {
  analytics: StreamAnalytics;
  title: string;
  eyebrow?: string;
  /** A small control beside the date — Your channel uses it for "Back to latest". */
  action?: ReactNode;
}) {
  const { summary, moments, dropOffs, questions } = analytics;
  const listed = moments.filter((m) => m.kind !== "peak").slice(0, 12);
  return (
    <div className={cn(TILE, "p-6 md:p-7")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className={EYEBROW}>{eyebrow}</p>
          <p className="mt-1.5 font-wide text-[20px] font-bold tracking-[-0.02em] text-balance md:text-[22px]">{title}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <p className="text-[12.5px] text-muted-foreground">
            {new Date(analytics.startedAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · {durationWords(summary.durationMinutes)} on air
          </p>
          {action}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Peak" value={summary.peakViewers} />
        <Stat label="Average" value={summary.avgViewers} />
        <Stat label="Watched by" value={summary.uniqueViewers} />
        <Stat label="Stayed" value={`${summary.avgWatchMinutes} min`} />
        <Stat label="Chats" value={summary.chats} />
        <Stat label="Chatters" value={summary.chatters} />
        <Stat label="Gifts" value={centsToDollars(summary.giftsMinor)} tone="value" />
        <Stat label="New allies" value={summary.newAllies} />
      </div>

      <div className="mt-6">
        {analytics.minutes.some((m) => m.viewers > 0) ? (
          <AudienceCurve analytics={analytics} />
        ) : (
          // Broadcasts from before the curve was kept have their totals, not their minutes.
          <p className="rounded-[14px] bg-white/[0.03] px-4 py-6 text-center text-[13px] text-muted-foreground">
            The minute-by-minute curve starts with your next broadcast.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-3">
        <section aria-label="What happened">
          <p className={EYEBROW}>What happened</p>
          {listed.length === 0 ? (
            <p className="mt-2 text-[13px] leading-snug text-muted-foreground">Segments, guests, cards, big gifts and battles land here as they happen.</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-1.5">
              {listed.map((m, i) => (
                <li key={i} className="flex items-baseline gap-2.5 text-[13px] leading-snug">
                  <span className="w-11 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">{minuteStamp(m.minute)}</span>
                  <span className="min-w-0">
                    <span className="text-muted-foreground">{MOMENT_LABELS[m.kind]} · </span>
                    {m.label}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-label="Where people left">
          <p className={EYEBROW}>Where people left</p>
          {dropOffs.length === 0 ? (
            <p className="mt-2 text-[13px] leading-snug text-muted-foreground">No big drops — the room held.</p>
          ) : (
            <ol className="mt-2 flex flex-col gap-2">
              {dropOffs.map((d) => (
                <li key={d.minute} className="rounded-[12px] bg-chili/[0.08] px-3 py-2.5 text-[13px] leading-snug">
                  <span className="font-semibold">
                    {minuteStamp(d.minute)} · {d.from} → {d.to}
                  </span>
                  <span className="block text-[12px] text-muted-foreground">{d.during ? `During ${d.during}` : "Nothing was marked just before"}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-label="What the chat asked">
          <p className={EYEBROW}>What the chat asked</p>
          {questions.length === 0 ? (
            <p className="mt-2 text-[13px] leading-snug text-muted-foreground">No questions in chat this time.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {questions.slice(0, 5).map((q, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] leading-snug">
                  <ChatText size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="font-semibold">{q.user}</span> <span className="text-foreground/85">{q.text}</span>
                    <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground tabular-nums">{minuteStamp(q.minute)}</span>
                  </span>
                </li>
              ))}
              {questions.length > 5 && <li className="text-[12px] text-muted-foreground">and {questions.length - 5} more</li>}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The audience while live, in the studio's numbers panel: the curve so far
 * with what happened on it, the latest fall and what the chat's asking.
 * Mounted only while the panel's open, so it only polls then.
 */
export function LiveAudience({ streamId }: { streamId: string }) {
  const { analytics } = useStreamAnalytics(streamId, true);
  const lastDrop = analytics?.dropOffs[analytics.dropOffs.length - 1];
  return (
    <div className="mt-2 rounded-[12px] bg-white/[0.04] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className={EYEBROW}>Audience</p>
        {analytics && analytics.summary.peakViewers > 0 && (
          <p className="text-[11.5px] text-muted-foreground tabular-nums">
            peak {analytics.summary.peakViewers} at {minuteStamp(analytics.summary.peakMinute)}
          </p>
        )}
      </div>
      <div className="mt-3">
        {analytics ? <AudienceCurve analytics={analytics} height={110} compact /> : <div className="h-[110px] animate-pulse rounded-[8px] bg-white/[0.04]" />}
      </div>
      {analytics && (lastDrop || analytics.questions.length > 0) && (
        <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
          {lastDrop && (
            <>
              Lost {lastDrop.from - lastDrop.to} at {minuteStamp(lastDrop.minute)}
              {lastDrop.during ? `, during ${lastDrop.during}` : ""}.{" "}
            </>
          )}
          {analytics.questions.length > 0 && `${analytics.questions.length} ${analytics.questions.length === 1 ? "question" : "questions"} in chat so far.`}
        </p>
      )}
    </div>
  );
}

/** The recap of one broadcast, loaded — nothing while it loads or if it can't. */
export function StreamRecap({
  streamId,
  title,
  eyebrow,
  action,
}: {
  streamId: string;
  title: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  const { analytics } = useStreamAnalytics(streamId, false);
  if (!analytics) return null;
  return <RecapTile analytics={analytics} title={title} eyebrow={eyebrow} action={action} />;
}
