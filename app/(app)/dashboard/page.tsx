"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Broadcast, CalendarPlus, Warning } from "@/components/icons";
import { cn } from "@/lib/utils";
import { formatNumber, type Category } from "@/lib/categories";
import type { RowItem } from "@/lib/discovery";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { useCountUp } from "@/lib/use-count-up";
import { formatUsd } from "@/components/xtream/money";
import { UserAvatar } from "@/components/ui/user-avatar";
import { RemoteImage } from "@/components/ui/remote-image";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";
import { GoLiveLink } from "@/components/app/go-live-link";
import { Shelf } from "@/components/app/shelf";

/**
 * Your channel — the channel and its numbers in one place (owner,
 * 2026-09-24: "merge the your channel and dashboard"). Who you are and the
 * three things you'd do next sit on top; below them, what's next, how it's
 * going, what worked, and everything you've aired. The public page is one
 * tap away rather than a second place to manage.
 */

interface DashboardStats {
  /** Sum of peak concurrent viewers across streams. */
  totalPeakViewers?: number;
  /** Legacy alias for `totalPeakViewers`. */
  totalViews: number;
  followers: number;
  totalHours: number;
  totalStreams: number;
  currentlyLive: boolean;
  /** Time-weighted mean concurrent viewers across all streams. */
  avgViewers?: number;
  /**
   * Money fields are USD minor units, and are absent on the legacy in-process
   * API (gifting lives only in the standalone service) — hence optional.
   */
  earningsUsdMinor?: number;
  tipsGrossUsdMinor?: number;
  tipsCount?: number;
}

interface RecentStream {
  id: string;
  title: string;
  category: Category;
  /** API-relative path, or null when the stream has no thumbnail. */
  thumbnailUrl: string | null;
  viewers: number;
  peakViewers: number;
  avgViewers?: number;
  duration: string;
  date: string;
  earningsUsdMinor?: number;
}

interface DailyView {
  date: string;
  views: number;
}

interface DashboardData {
  stats: DashboardStats;
  recentStreams: RecentStream[];
  dailyViews: DailyView[];
}

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * The API stores durations as "m:ss" or "h:mm:ss", which reads as hours and
 * minutes at a glance ("2:09" is 2 minutes 9 seconds, not 2 hours 9 minutes).
 * Add units so short streams aren't mistaken for long ones.
 */
function formatStreamDuration(duration: string) {
  const parts = duration.split(":");
  if (parts.length === 3) return `${Number(parts[0])}h ${parts[1]}m`;
  if (parts.length === 2) return `${Number(parts[0])}m ${parts[1]}s`;
  return duration;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** "2d 04h", "3h 12m", "12 min" — the dial on the Next up tile. */
function countdown(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${String(h % 24).padStart(2, "0")}h`;
  if (h >= 1) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${Math.max(1, m)} min`;
}

export default function ChannelHubPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [booked, setBooked] = useState<RowItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: DashboardData }>("/api/dashboard/stats");
      setData(res.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    apiFetch<{ success: boolean; data: { streams: RowItem[] } }>(
      `/api/streams?status=upcoming&streamer=${encodeURIComponent(user.username)}&limit=50`,
    )
      .then((r) => alive && setBooked(r.data.streams.filter((s) => s.scheduledStartAt)))
      .catch(() => {
        // No bookings to show is the same as none booked.
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!user || (!data && !failed)) return <Shell><Skeleton /></Shell>;

  const live = user.isLive || Boolean(data?.stats.currentlyLive);
  const name = user.displayName || user.username;

  return (
    <Shell>
      {/* ── Masthead: who you are, and the three things you'd do next ── */}
      <header className="mb-8 flex flex-col gap-6 md:mb-10 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <UserAvatar src={user.avatar} name={name} size={88} className="size-[76px] md:size-[88px]" ring={live ? "live" : "none"} />
          <div className="min-w-0">
            <p className={EYEBROW}>Your channel</p>
            <h1 className="mt-1.5 truncate font-wide text-[clamp(1.9rem,4vw,3rem)] leading-[1.02] font-bold tracking-[-0.04em]">{name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-muted-foreground">
              <span>@{user.username}</span>
              <span aria-hidden className="text-foreground/20">·</span>
              <span>
                <span className="font-semibold text-foreground tabular-nums">{formatNumber(data?.stats.followers ?? user.followers)}</span> followers
              </span>
              <span aria-hidden className="text-foreground/20">·</span>
              <span>On Xtream since {new Date(user.createdAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span>
            </p>
            {user.bio ? (
              <p className="mt-2 line-clamp-2 max-w-[62ch] text-[14px] leading-relaxed text-foreground/75">{user.bio}</p>
            ) : (
              <Link href="/settings" className="mt-2 inline-block text-[13.5px] font-semibold text-ember-hi hover:underline">
                Add a bio — it&apos;s the first thing people read on your page
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:shrink-0 md:justify-end">
          <GoLiveLink className="w-auto px-6" />
          <Link href="/schedule" className="press flex h-11 items-center gap-2 rounded-full bg-control px-5 text-[14.5px] font-semibold hover:bg-control-hover">
            <CalendarPlus size={17} />
            Schedule
          </Link>
          <Link
            href={`/c/${user.username}`}
            className="press flex h-11 items-center gap-2 rounded-full bg-control px-5 text-[14.5px] font-semibold hover:bg-control-hover"
          >
            View public page
            <ArrowUpRight size={15} weight="bold" />
          </Link>
        </div>
      </header>

      {failed && !data ? (
        <div className={cn(TILE, "grid place-items-center px-6 py-20 text-center")}>
          <Warning size={28} className="text-chili-hi" />
          <p className="mt-3 font-wide text-[20px] font-bold tracking-[-0.02em]">Your numbers didn&apos;t load</p>
          <p className="mt-1 max-w-[42ch] text-[14px] text-muted-foreground">Nothing&apos;s lost — it&apos;s just this page. Try again in a moment.</p>
          <button type="button" onClick={() => void load()} className="press mt-5 h-10 rounded-full bg-white px-5 text-[14px] font-semibold text-[#0b0708]">
            Try again
          </button>
        </div>
      ) : data ? (
        <Hub data={data} booked={booked} live={live} now={now} />
      ) : null}
    </Shell>
  );
}

function Hub({ data, booked, live, now }: { data: DashboardData; booked: RowItem[]; live: boolean; now: number }) {
  const { stats, recentStreams, dailyViews } = data;
  // Prefer the server's time-weighted average; fall back to averaging the
  // per-stream averages when talking to an API that doesn't send it.
  const avgViewers =
    stats.avgViewers ??
    (recentStreams.length > 0 ? Math.round(recentStreams.reduce((sum, s) => sum + (s.avgViewers ?? 0), 0) / recentStreams.length) : 0);
  const top = [...recentStreams].sort((a, b) => b.peakViewers - a.peakViewers).slice(0, 3);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <NextUpTile next={booked[0] ?? null} more={Math.max(0, booked.length - 1)} live={live} now={now} />
        <div className="grid grid-cols-2 gap-3 lg:col-span-7">
          <StatTile label="Followers" value={stats.followers} note="They hear the second you go live." />
          <StatTile
            label="Earned"
            value={stats.earningsUsdMinor ?? null}
            money
            note={
              stats.earningsUsdMinor === undefined
                ? "Gift earnings show up here."
                : `From ${formatNumber(stats.tipsCount ?? 0)} ${stats.tipsCount === 1 ? "gift" : "gifts"}, after commission.`
            }
          />
          <StatTile label="Hours live" value={stats.totalHours} suffix="h" note={`Across ${formatNumber(stats.totalStreams)} ${stats.totalStreams === 1 ? "broadcast" : "broadcasts"}.`} />
          <StatTile label="Avg. viewers" value={avgViewers} note="In the room at any moment, on average." />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
        <WeekTile days={dailyViews} />
        <TopTile top={top} />
      </div>

      <section aria-label="Recent broadcasts" className="mt-10 md:mt-14">
        {recentStreams.length === 0 ? (
          <div className={cn(TILE, "flex flex-col items-start gap-4 p-7 md:flex-row md:items-center md:justify-between md:p-8")}>
            <div>
              <p className="font-wide text-[22px] font-bold tracking-[-0.03em]">Your first broadcast lands here.</p>
              <p className="mt-1.5 max-w-[52ch] text-[14px] text-muted-foreground">End a stream and it shows up with its peak, its length and what it earned — the start of your record.</p>
            </div>
            <GoLiveLink className="w-auto px-6" />
          </div>
        ) : (
          <Shelf id="recent-broadcasts" title="Recent broadcasts" reason={`Your last ${recentStreams.length} on air`} size="standard">
            {recentStreams.map((s) => (
              <BroadcastCard key={s.id} stream={s} />
            ))}
          </Shelf>
        )}
      </section>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NextUpTile({ next, more, live, now }: { next: RowItem | null; more: number; live: boolean; now: number }) {
  return (
    <div className="relative isolate flex min-h-[300px] flex-col overflow-hidden rounded-panel bg-ember text-on-ember p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_24px_60px_-30px_rgba(0,0,0,0.9)] md:p-7 lg:col-span-5">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-1/2 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0))]" />
      <div className="flex items-center justify-between gap-3">
        <p className="caps font-mono text-[10.5px] text-on-ember/70">{live ? "On air" : "Next up"}</p>
        {!live && more > 0 && (
          <Link href="/schedule" className="rounded-full bg-on-ember/10 px-2.5 py-1 text-[11.5px] font-semibold text-on-ember/85 hover:text-on-ember">
            +{more} more booked
          </Link>
        )}
      </div>

      {live ? (
        <>
          <div className="mt-auto">
            <p className="flex items-center gap-3 font-wide text-[clamp(2rem,3.6vw,2.75rem)] leading-none font-bold tracking-[-0.04em] text-on-ember">
              <span className="relative flex size-3">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-chili-hi opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-chili-hi" />
              </span>
              You&apos;re live.
            </p>
            <p className="mt-3 max-w-[40ch] text-[14px] leading-relaxed text-on-ember/80">Your room is open. Chat, guests and gifts are waiting in the studio.</p>
          </div>
          <div className="mt-6">
            <Link href="/studio" className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-[#0b0708]">
              <Broadcast size={17} weight="fill" />
              Back to the studio
            </Link>
          </div>
        </>
      ) : next?.scheduledStartAt ? (
        <>
          <div className="mt-auto">
            <p className="font-money text-[clamp(3rem,6vw,4.5rem)] leading-none text-on-ember tabular-nums">{countdown(next.scheduledStartAt, now)}</p>
            <p className="mt-1.5 text-[13px] text-on-ember/65">until you&apos;re on</p>
            <p className="mt-6 line-clamp-2 font-wide text-[21px] leading-tight font-bold tracking-[-0.02em] text-on-ember">{next.title}</p>
            <p className="mt-1.5 text-[13.5px] text-on-ember/75">
              {new Date(next.scheduledStartAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} ·{" "}
              {new Date(next.scheduledStartAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {next.category}
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href={`/studio?scheduled=${next._id}`} className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-[#0b0708]">
              Go live now
            </Link>
            <Link href="/schedule" className="press inline-flex h-11 items-center rounded-full bg-on-ember/10 px-5 text-[14.5px] font-semibold text-on-ember/90 hover:bg-on-ember/15">
              Your schedule
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="mt-auto">
            <p className="font-wide text-[clamp(1.75rem,3.2vw,2.35rem)] leading-[1.02] font-bold tracking-[-0.035em] text-balance text-on-ember">
              Nothing booked. Give them a date.
            </p>
            <p className="mt-3 max-w-[40ch] text-[14px] leading-relaxed text-on-ember/80">
              A booked stream shows up in Events. Followers set a reminder, and they&apos;re in the room when you start.
            </p>
          </div>
          <div className="mt-6">
            <Link href="/schedule" className="press inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-[#0b0708]">
              <CalendarPlus size={17} weight="bold" />
              Book a stream
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  note,
  suffix = "",
  money = false,
}: {
  label: string;
  /** null reads as "not tracked here" — a dash, not a zero. */
  value: number | null;
  note: string;
  suffix?: string;
  money?: boolean;
}) {
  const shown = useCountUp(value ?? 0, 900, 0);
  return (
    <div className={cn(TILE, "@container flex min-h-[142px] flex-col p-5 md:p-6")}>
      <p className={EYEBROW}>{label}</p>
      <div className="mt-auto pt-5">
        {/* Sized to the tile, not the screen: a half-width tile on a phone
            still fits "$1,842.50" whole. Five figures and up go compact. */}
        <p className={cn("font-money text-[clamp(1.35rem,13cqw,2.6rem)] leading-none whitespace-nowrap tabular-nums", money && value !== null && "text-value")}>
          {value === null ? "—" : money ? formatUsd(shown, shown >= 1_000_000) : `${formatNumber(shown)}${suffix}`}
        </p>
        <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{note}</p>
      </div>
    </div>
  );
}

function WeekTile({ days }: { days: DailyView[] }) {
  const max = Math.max(1, ...days.map((d) => d.views));
  const best = days.reduce((b, d, i) => (d.views > (days[b]?.views ?? 0) ? i : b), 0);
  const quiet = days.every((d) => d.views === 0);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 80);
    return () => clearTimeout(t);
  }, []);
  // Buckets are UTC days on the server; label them in UTC too, or the
  // weekday shifts by one for anyone west of Greenwich.
  const weekday = (date: string, style: "short" | "long") => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { weekday: style, timeZone: "UTC" });

  return (
    <div className={cn(TILE, "p-6 md:p-7 lg:col-span-8")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={EYEBROW}>Peak viewers · last 7 days</p>
          {quiet ? (
            <p className="mt-2 font-wide text-[24px] font-bold tracking-[-0.03em]">A quiet week.</p>
          ) : (
            <p className="mt-2 flex items-baseline gap-2.5">
              <span className="font-money text-[40px] leading-none tabular-nums">{formatNumber(days[best]!.views)}</span>
              <span className="text-[14px] text-muted-foreground">at once, {weekday(days[best]!.date, "long")} — your best night</span>
            </p>
          )}
        </div>
        {quiet && <p className="max-w-[34ch] text-[13px] text-muted-foreground">Go live and this fills in: every stream&apos;s peak lands on its day.</p>}
      </div>

      <div className="mt-7 grid grid-cols-7 gap-2 md:gap-3" role="img" aria-label={days.map((d) => `${weekday(d.date, "long")} ${d.views}`).join(", ")}>
        {days.map((d, i) => {
          // Top out at 80% so the value above the tallest bar has room.
          const pct = (d.views / max) * 80;
          const isBest = !quiet && i === best;
          return (
            <div key={d.date} className="flex flex-col items-center gap-2.5">
              <div className="relative h-[168px] w-full">
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 rounded-[8px] transition-[height] duration-700 ease-out motion-reduce:transition-none",
                    isBest ? "bg-ember" : "bg-white/[0.08]",
                  )}
                  style={{ height: `${grown ? Math.max(pct, 2.5) : 2.5}%`, transitionDelay: `${i * 45}ms` }}
                />
                {d.views > 0 && (
                  <span
                    className={cn(
                      "absolute inset-x-0 text-center font-mono text-[11.5px] tabular-nums transition-[bottom] duration-700 ease-out motion-reduce:transition-none",
                      isBest ? "font-bold text-ember-hi" : "text-muted-foreground",
                    )}
                    style={{ bottom: `calc(${grown ? Math.max(pct, 2.5) : 2.5}% + 6px)`, transitionDelay: `${i * 45}ms` }}
                  >
                    {formatNumber(d.views)}
                  </span>
                )}
              </div>
              <span className={cn("text-[12px] font-semibold", isBest ? "text-foreground" : "text-muted-foreground")}>{weekday(d.date, "short")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopTile({ top }: { top: RecentStream[] }) {
  return (
    <div className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-4")}>
      <p className={EYEBROW}>What worked</p>
      <p className="mt-2 text-[14px] text-muted-foreground">Your biggest rooms, by peak.</p>
      {top.length === 0 ? (
        <p className="mt-auto pt-8 text-[14px] leading-relaxed text-muted-foreground">Your best nights line up here once you&apos;ve aired a few.</p>
      ) : (
        <ol className="mt-5 flex flex-col">
          {top.map((s, i) => (
            <li key={s.id} className={cn("flex items-center gap-4 py-3.5", i > 0 && "border-t border-white/[0.06]")}>
              <span className={cn("w-6 shrink-0 font-money text-[28px] leading-none tabular-nums", i === 0 ? "text-ember-hi" : "text-foreground/35")}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-bold">{s.title}</p>
                <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                  {shortDate(s.date)} · {s.category}
                </p>
              </div>
              <span className="shrink-0 text-right">
                <span className="block font-mono text-[14px] font-bold tabular-nums">{formatNumber(s.peakViewers)}</span>
                <span className="block text-[11px] text-muted-foreground">peak</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function BroadcastCard({ stream: s }: { stream: RecentStream }) {
  return (
    <article className="min-w-0">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-surface">
        <RemoteImage
          src={apiUrl(s.thumbnailUrl)}
          alt=""
          fill
          className="object-cover"
          fallback={<StreamPreviewThumb seed={s.id + s.title} showTicker={false} />}
        />
        {s.duration && (
          <span className="absolute right-2 bottom-2 rounded-[6px] bg-black/65 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-white tabular-nums backdrop-blur-sm">
            {formatStreamDuration(s.duration)}
          </span>
        )}
      </div>
      <p className="mt-2.5 truncate text-[15px] font-bold">{s.title}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
        <span>{shortDate(s.date)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatNumber(s.peakViewers)} peak</span>
        {s.earningsUsdMinor ? (
          <>
            <span aria-hidden>·</span>
            <span className="font-money text-value">{formatUsd(s.earningsUsdMinor)}</span>
          </>
        ) : null}
      </p>
    </article>
  );
}

function Skeleton() {
  return (
    <div aria-busy className="animate-pulse">
      <div className="mb-10 flex items-center gap-5">
        <div className="size-[88px] rounded-full bg-surface" />
        <div className="flex-1">
          <div className="h-3 w-24 rounded bg-surface" />
          <div className="mt-3 h-9 w-72 max-w-full rounded bg-surface" />
          <div className="mt-3 h-3 w-56 rounded bg-surface" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="h-[300px] rounded-panel bg-surface lg:col-span-5" />
        <div className="grid grid-cols-2 gap-3 lg:col-span-7">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[142px] rounded-panel bg-surface" />
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="h-[290px] rounded-panel bg-surface lg:col-span-8" />
        <div className="h-[290px] rounded-panel bg-surface lg:col-span-4" />
      </div>
    </div>
  );
}
