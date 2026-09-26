"use client";

import { durationWords, MOMENT_LABELS, minuteStamp, type MomentKind, type StreamAnalytics } from "@/lib/analytics";
import { centsToDollars } from "@/lib/gifts";
import { cn } from "@/lib/utils";

/** What each kind of moment looks like on the curve. */
const DOT: Record<MomentKind, string> = {
  segment: "bg-white",
  guest: "bg-[#7DD3FC]",
  card: "bg-white/55",
  gift: "bg-value",
  battle: "bg-chili-hi",
  goal: "bg-ember-hi",
  peak: "bg-ember",
};

/**
 * The audience curve (live analytics): viewers minute by minute as a line
 * over a flat ember fill, the minute's gifts as gold ticks along the
 * bottom, and dots where something happened — a segment, a guest, a card,
 * a big gift, a battle, the goal, the peak. Where a fifth of the room left,
 * a chili notch. The drawing stretches to its box; its words don't.
 */
export function AudienceCurve({ analytics, height = 170, compact = false }: { analytics: StreamAnalytics; height?: number; compact?: boolean }) {
  const { minutes, moments, dropOffs, summary } = analytics;
  const n = minutes.length;
  const W = Math.max(n - 1, 1);
  const H = 100;
  const top = Math.max(1, ...minutes.map((m) => m.viewers));
  const giftTop = Math.max(1, ...minutes.map((m) => m.giftsMinor));
  const x = (i: number) => (n === 1 ? W / 2 : i);
  const y = (v: number) => H - 3 - (v / top) * (H * 0.84);
  const pct = (i: number) => (n === 1 ? 50 : (i / W) * 100);
  const line = minutes.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(m.viewers).toFixed(2)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z`;
  const shown = compact ? moments.filter((m) => m.kind !== "segment" || moments.length < 12) : moments;
  const label = `Viewers over ${durationWords(summary.durationMinutes)}: peak ${summary.peakViewers} at ${minuteStamp(summary.peakMinute)}, ${summary.avgViewers} on average.`;

  return (
    <figure className="relative">
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="absolute inset-0 size-full overflow-visible">
          {/* Half and full of the peak, faintly. */}
          {[0.5, 1].map((f) => (
            <line key={f} x1={0} x2={W} y1={y(top * f)} y2={y(top * f)} className="stroke-white/[0.07]" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="3 4" />
          ))}
          {minutes.map((m, i) =>
            m.giftsMinor > 0 ? (
              <rect
                key={i}
                x={x(i) - Math.min(0.35, W / Math.max(n, 2) / 2)}
                width={Math.min(0.7, W / Math.max(n, 2))}
                y={H - (m.giftsMinor / giftTop) * 18}
                height={(m.giftsMinor / giftTop) * 18}
                className="fill-value/80"
              />
            ) : null
          )}
          <path d={area} className="fill-ember/[0.16]" />
          <path d={line} className="fill-none stroke-ember" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* Moments, as dots on the line — named on hover, and in the list beside. */}
        {shown.map((m, i) => (
          <span
            key={`${m.kind}-${m.minute}-${i}`}
            title={`${minuteStamp(m.minute)} · ${MOMENT_LABELS[m.kind]} — ${m.label}`}
            className={cn("absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", DOT[m.kind])}
            style={{ left: `${pct(m.minute)}%`, top: `${(y(minutes[m.minute]?.viewers ?? 0) / H) * 100}%` }}
          />
        ))}
        {dropOffs.map((d) => (
          <span
            key={`drop-${d.minute}`}
            title={`${minuteStamp(d.minute)} · ${d.from} → ${d.to} watching${d.during ? ` — during ${d.during}` : ""}`}
            className="absolute flex -translate-x-1/2 items-center rounded-full bg-chili/90 px-1.5 py-px font-mono text-[9.5px] font-bold text-white"
            style={{ left: `${pct(d.minute)}%`, top: `calc(${(y(d.to) / H) * 100}% + 8px)` }}
          >
            −{d.from - d.to}
          </span>
        ))}

        <span className="pointer-events-none absolute top-0 left-0 font-mono text-[10.5px] text-muted-foreground tabular-nums">{top}</span>
      </div>
      <figcaption className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[10.5px] text-muted-foreground tabular-nums">
        <span>0:00</span>
        {!compact && summary.giftsMinor > 0 && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px] bg-value/80" />
            gifts · {centsToDollars(summary.giftsMinor)}
          </span>
        )}
        <span>{analytics.live ? "now" : durationWords(summary.durationMinutes)}</span>
      </figcaption>
    </figure>
  );
}
