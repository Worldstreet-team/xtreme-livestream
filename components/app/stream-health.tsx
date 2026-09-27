"use client";

import { cn } from "@/lib/utils";
import type { EncoderReading, HealthLevel, HealthReport, HealthSample, HealthVerdict, HealthWindow } from "@/lib/stream-health";

/**
 * Stream health on screen (Phase 1): a chip in the studio's live bar, the
 * Connection section of its Stats panel, and the report tile on Your
 * channel afterwards. Semantic colours, not the brand's: green is good,
 * amber is worth a look, chili is hurting the stream.
 */

const DOT: Record<HealthLevel, string> = { good: "bg-success", fair: "bg-warning", poor: "bg-chili-hi" };
const STROKE: Record<HealthLevel, string> = { good: "var(--success)", fair: "var(--warning)", poor: "var(--chili-hi)" };
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

const mbps = (kbps: number) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`);

/** The live bar's chip: how it's going in a word; a tap opens the detail. */
export function HealthChip({ verdict, onOpen }: { verdict: HealthVerdict; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={verdict.headline}
      className="obj press flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold text-white/85 hover:text-white"
    >
      <span className={cn("size-1.5 rounded-full", DOT[verdict.level], verdict.level === "poor" && "animate-pulse")} />
      {verdict.label}
    </button>
  );
}

/** The last minute's bitrate, drawn small, in the verdict's colour. */
function Sparkline({ samples, level }: { samples: HealthSample[]; level: HealthLevel }) {
  if (samples.length < 2) return <div className="h-11" />;
  const W = 100;
  const H = 40;
  const top = Math.max(500, ...samples.map((s) => s.kbps)) * 1.1;
  const x = (i: number) => (i / (samples.length - 1)) * W;
  const y = (kbps: number) => H - (kbps / top) * H;
  const line = samples.map((s, i) => `${x(i).toFixed(2)},${y(s.kbps).toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-11 w-full" role="img" aria-label="Upload over the last minute">
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={STROKE[level]} opacity={0.12} />
      <polyline points={line} fill="none" stroke={STROKE[level]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** "video/h264" → "H.264"; the names people see in OBS. */
function codecName(mime: string | undefined) {
  const c = (mime ?? "").split("/").pop()?.toLowerCase() ?? "";
  return ({ h264: "H.264", h265: "HEVC", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1", opus: "Opus", aac: "AAC", "mp4a-latm": "AAC" } as Record<string, string>)[c] ?? (c ? c.toUpperCase() : "—");
}

/**
 * The Stats panel's Connection section: the verdict, the fix, the numbers.
 * From an encoder, the numbers are what LiveKit is receiving from it.
 */
export function HealthSection({ samples, verdict, encoder = null }: { samples: HealthSample[]; verdict: HealthVerdict; encoder?: EncoderReading | null }) {
  const last = samples[samples.length - 1];
  // From an encoder, what it's sending now — nothing, once it stops.
  const video = encoder?.status === "publishing" ? encoder.video : null;
  const audio = encoder?.status === "publishing" ? encoder.audio : null;
  const stats: [string, string][] = encoder
    ? [
        ["Picture", video ? `${video.width}×${video.height}` : "—"],
        ["Frame rate", video ? `${video.fps} fps` : "—"],
        ["Bitrate", video ? mbps(video.kbps) : "—"],
        ["Video", video ? codecName(video.codec) : "—"],
        ["Audio", audio ? `${codecName(audio.codec)} · ${audio.kbps}k` : "—"],
        ["Via", encoder.protocol === "whip" ? "WHIP" : "RTMP"],
      ]
    : last
      ? [
          ["Picture", `${last.height}p`],
          ["Frame rate", `${last.fps} fps`],
          ["Upload", mbps(last.kbps)],
          ["Round trip", last.rttMs === null ? "—" : `${last.rttMs} ms`],
          ["Loss", `${last.lossPct}%`],
        ]
      : [];
  return (
    <section aria-labelledby="studio-health" className="rounded-[12px] bg-tint/[0.04] p-4">
      <p id="studio-health" className={EYEBROW}>
        {encoder ? "Encoder" : "Connection"}
      </p>
      <p className="mt-2.5 flex items-center gap-2 text-[15px] font-bold">
        <span className={cn("size-2 rounded-full", DOT[verdict.level])} />
        {verdict.label}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-foreground/80">{verdict.headline}</p>
      {verdict.fix && <p className="mt-1.5 text-[13px] leading-snug font-semibold text-foreground">{verdict.fix}</p>}
      <div className="mt-3">
        <Sparkline samples={samples} level={verdict.level} />
      </div>
      {stats.length > 0 && (
        <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5">
          {stats.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="font-mono text-[13px] font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/**
 * On Your channel after a broadcast: how it ran, as a timeline of its
 * half-minutes, the worst stretch, and the one change worth making.
 */
export function HealthReportTile({ report, windows, title }: { report: HealthReport; windows: HealthWindow[]; title: string }) {
  return (
    <section aria-labelledby="health-report" className="rounded-panel bg-surface p-6 md:p-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p id="health-report" className={EYEBROW}>
            How your last broadcast ran
          </p>
          <p className="mt-2 truncate text-[14px] text-muted-foreground">{title}</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              ["On air", `${report.minutes} min`],
              ["Average upload", mbps(report.avgKbps)],
              ["Rough patches", String(report.roughPatches)],
            ] as const
          ).map(([label, value]) => (
            <div key={label}>
              <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
              <dd className="font-money text-[22px] leading-tight tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Every half-minute of the broadcast, in its colour. */}
      <div className="mt-5 flex h-7 items-stretch gap-px overflow-hidden rounded-[6px]" role="img" aria-label={`${report.roughPatches} rough patches across ${report.minutes} minutes`}>
        {windows.map((w) => (
          <span key={w.at} className={cn("min-w-px flex-1", DOT[w.level], w.level === "good" && "opacity-70")} title={`${mbps(w.kbps)} · ${w.lossPct}% loss`} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10.5px] text-muted-foreground tabular-nums">
        <span>0:00</span>
        <span>{report.minutes} min</span>
      </div>

      <p className="mt-4 text-[14px] leading-relaxed">
        {report.worst && (
          <span className="text-muted-foreground">
            Worst at minute {report.worst.minuteIn}: {mbps(report.worst.kbps)}, {report.worst.lossPct}% lost.{" "}
          </span>
        )}
        <span className="font-semibold">{report.advice}</span>
      </p>
    </section>
  );
}
