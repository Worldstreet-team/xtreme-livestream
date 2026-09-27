"use client";

import type { TransparencyReport } from "@xtreme/contracts";
import { cn } from "@/lib/utils";

/**
 * The transparency report's figures (Phase 3, deeper moderation), laid out
 * to be read on screen and printed as it is.
 */

const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const TILE = "rounded-panel bg-surface p-5 md:p-6 print:border print:border-black/20 print:bg-white";

const REASONS: Record<string, string> = {
  spam: "Spam or misleading",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech",
  violence: "Violence or dangerous acts",
  sexual_content: "Sexual content",
  scam_or_fraud: "Scam or fraud",
  copyright: "Copyright",
  other: "Other",
};

const words = (key: string) => key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const n = (v: number) => v.toLocaleString("en-US");

function Figure({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className={EYEBROW}>{label}</p>
      <p className="mt-1.5 font-money text-[28px] leading-none tabular-nums">{typeof value === "number" ? n(value) : value}</p>
      {hint && <p className="mt-1 text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A count per kind as bars, biggest first. */
function Bars({ counts, labels }: { counts: Record<string, number>; labels?: Record<string, string> }) {
  const rows = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...rows.map(([, v]) => v));
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">None this year.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[minmax(0,11rem)_1fr_4rem] items-center gap-3 text-[13px]">
          <span className="truncate">{labels?.[k] ?? words(k)}</span>
          <span className="h-2 overflow-hidden rounded-full bg-tint/[0.06] print:bg-black/10">
            <span className="block h-full rounded-full bg-ember print:bg-black" style={{ width: `${(v / top) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-[12px] tabular-nums">{n(v)}</span>
        </li>
      ))}
    </ul>
  );
}

export function TransparencySections({ report: r }: { report: TransparencyReport }) {
  const resolved = r.reports.actioned + r.reports.dismissed;
  return (
  <div className="flex flex-col gap-3">
    <section className={cn(TILE, "grid grid-cols-1 gap-5 sm:grid-cols-3")} aria-label="Scale">
      <Figure label="Streams" value={r.scale.streams} />
      <Figure label="Creators who went live" value={r.scale.creators} />
      <Figure label="Chat lines" value={r.scale.chatLines} />
    </section>

    <section className={TILE} aria-labelledby="t-reports">
      <h2 id="t-reports" className="font-wide text-[19px] font-bold tracking-[-0.02em]">
        Reports
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Figure label="Received" value={r.reports.total} />
        <Figure label="Acted on" value={r.reports.actioned} />
        <Figure label="Reviewed, kept up" value={r.reports.dismissed} />
        <Figure label="Still open" value={r.reports.open} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Figure
          label="Resolved in time"
          value={resolved ? `${Math.round((r.reports.onTime / resolved) * 100)}%` : "—"}
          hint={resolved ? `${n(r.reports.onTime)} of ${n(resolved)} resolved, inside the 48 hours each report is given` : undefined}
        />
        <Figure label="Median time to resolve" value={r.reports.medianHoursToResolve === null ? "—" : `${r.reports.medianHoursToResolve} h`} />
      </div>
      <p className={cn(EYEBROW, "mt-6 mb-3")}>By reason</p>
      <Bars counts={r.reports.byReason} labels={REASONS} />
    </section>

    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <section className={TILE} aria-labelledby="t-down">
        <h2 id="t-down" className="font-wide text-[19px] font-bold tracking-[-0.02em]">
          What came down
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-5">
          <Figure label="Streams" value={r.platform.streamTakedowns} />
          <Figure label="Chat lines" value={r.platform.chatTakedowns} />
        </div>
      </section>
      <section className={TILE} aria-labelledby="t-appeals">
        <h2 id="t-appeals" className="font-wide text-[19px] font-bold tracking-[-0.02em]">
          Appeals
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Figure label="Received" value={r.appeals.received} />
          <Figure label="Reversed" value={r.appeals.reversed} />
          <Figure label="Upheld" value={r.appeals.upheld} />
          <Figure label="Open" value={r.appeals.open} />
        </div>
      </section>
    </div>

    <section className={TILE} aria-labelledby="t-rooms">
      <h2 id="t-rooms" className="font-wide text-[19px] font-bold tracking-[-0.02em]">
        In creators&apos; rooms
      </h2>
      <p className="mt-1 max-w-[62ch] text-[13px] text-muted-foreground">
        What creators and the moderators they named did — and what each room&apos;s filter held back for them to review.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Figure label="Bans" value={r.rooms.bans} />
        <Figure label="Timeouts" value={r.rooms.timeouts} />
        <Figure label="Lines deleted" value={r.rooms.deletions} />
        <Figure label="Shield raised" value={r.rooms.shieldRaised} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-4">
        <Figure label="Lines held by filters" value={r.rooms.heldLines} />
        <Figure label="Held, then let through" value={r.rooms.heldApproved} />
        <Figure label="Held, then removed" value={r.rooms.heldDenied} />
      </div>
      <p className={cn(EYEBROW, "mt-6 mb-3")}>Held, by what the filter caught</p>
      <Bars counts={r.heldByReason} />
    </section>

    <p className="px-1 text-[12px] leading-relaxed text-muted-foreground">
      Counted from report records, appeals and the moderation audit trail. A takedown that closed several reports counts once. Every
      report is given 48 hours at intake; notices from an authorised agency, which the Code gives 24 hours, aren&apos;t separated out yet.
    </p>
  </div>
  );
}
