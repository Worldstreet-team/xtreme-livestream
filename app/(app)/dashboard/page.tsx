"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Eye,
  Users,
  CurrencyDollar,
  Clock,
  CalendarBlank,
  Play,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CATEGORY_COLORS, formatNumber, type Category } from "@/lib/categories";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { UserAvatar } from "@/components/ui/user-avatar";
import { RemoteImage } from "@/components/ui/remote-image";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";

type Tab = "overview" | "streams" | "analytics";

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
  thumbnail: string;
  /** Current concurrent viewers — 0 for any stream that has ended. */
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

/** Format USD minor units (cents) as "$12.34". */
function formatUsd(minor: number) {
  return `$${(minor / 100).toFixed(2)}`;
}

/**
 * The API stores durations as "m:ss" or "h:mm:ss", which reads as hours and
 * minutes at a glance ("2:09" is 2 minutes 9 seconds, not 2 hours 9 minutes).
 * Add units so short streams aren't mistaken for long ones.
 */
function formatStreamDuration(duration: string) {
  const parts = duration.split(":");
  if (parts.length === 3) {
    const [h, m] = parts;
    return `${Number(h)}h ${m}m`;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return `${Number(m)}m ${s}s`;
  }
  return duration;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch<{ success: boolean; data: DashboardData }>(
        "/api/dashboard/stats"
      );
      setData(res.data);
    } catch (err) {
      console.error("Failed to load dashboard:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading || !data || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const { stats, recentStreams, dailyViews } = data;

  const statCards = [
    {
      label: "Peak Viewers",
      value: formatNumber(stats.totalPeakViewers ?? stats.totalViews),
      icon: Eye,
      color: "text-primary",
      hint: "Highest concurrent viewers, summed across your streams",
    },
    {
      label: "Followers",
      value: formatNumber(stats.followers),
      icon: Users,
      color: "text-blue-400",
      hint: undefined,
    },
    {
      label: "Earnings",
      // Absent (rather than zero) when the backend doesn't track gifting.
      value:
        stats.earningsUsdMinor === undefined
          ? "—"
          : formatUsd(stats.earningsUsdMinor),
      icon: CurrencyDollar,
      color: "text-green-400",
      hint:
        stats.earningsUsdMinor === undefined
          ? "Earnings aren't available from this API"
          : "Gift earnings, net of commission",
    },
    {
      label: "Stream Hours",
      value: `${stats.totalHours}h`,
      icon: Clock,
      color: "text-purple-400",
      hint: undefined,
    },
  ];

  const maxDailyViews = Math.max(...dailyViews.map((d) => d.views), 1);
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Prefer the server's time-weighted average; fall back to averaging the
  // per-stream averages when talking to an API that doesn't send it.
  const avgViewers =
    stats.avgViewers ??
    (recentStreams.length > 0
      ? Math.round(
          recentStreams.reduce((sum, s) => sum + (s.avgViewers ?? 0), 0) /
            recentStreams.length
        )
      : 0);

  const topStreams = [...recentStreams]
    .sort((a, b) => b.peakViewers - a.peakViewers)
    .slice(0, 3);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
      {/* Profile header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <UserAvatar
            src={user.avatar}
            name={user.displayName || user.username}
            size={56}
            className="size-14"
          />
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {user.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">
              @{user.username} · Joined{" "}
              {new Date(user.createdAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-sm">{user.bio}</p>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-white/5">
        {(["overview", "streams", "analytics"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition-colors",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ── */}
      {tab === "overview" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.map((stat) => (
              <div
                key={stat.label}
                title={stat.hint}
                className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {stat.label}
                  </span>
                  <stat.icon size={18} className={stat.color} />
                </div>
                <div className="mt-2 text-2xl font-bold text-foreground">
                  {stat.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8">
            <h2 className="mb-4 text-base font-semibold text-foreground">
              Recent Streams
            </h2>
            {recentStreams.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No streams yet. Go live from the Studio to get started!
              </p>
            ) : (
              <div className="space-y-3">
                {recentStreams.slice(0, 3).map((stream) => (
                  <div
                    key={stream.id}
                    className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                  >
                    <RemoteImage
                      src={stream.thumbnail}
                      alt={stream.title}
                      width={120}
                      height={68}
                      className="h-[68px] w-[120px] shrink-0 rounded-lg object-cover"
                      fallback={
                        <div className="h-[68px] w-[120px] shrink-0 overflow-hidden rounded-lg">
                          <StreamPreviewThumb seed={stream.id + stream.title} />
                        </div>
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {stream.title}
                      </h3>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarBlank size={12} />
                          {formatDate(stream.date)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {stream.duration
                            ? formatStreamDuration(stream.duration)
                            : "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye size={12} />
                          {formatNumber(stream.peakViewers)} peak
                        </span>
                        {stream.earningsUsdMinor ? (
                          <span className="flex items-center gap-1 text-green-400">
                            <CurrencyDollar size={12} />
                            {formatUsd(stream.earningsUsdMinor)}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[0.6rem] font-medium",
                          CATEGORY_COLORS[stream.category]
                        )}
                      >
                        {stream.category}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Streams Tab ── */}
      {tab === "streams" && (
        <div>
          {recentStreams.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No streams yet. Go live from the Studio to get started!
            </p>
          ) : (
            <div className="space-y-3">
              {recentStreams.map((stream) => (
                <div
                  key={stream.id}
                  className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                >
                  <RemoteImage
                    src={stream.thumbnail}
                    alt={stream.title}
                    width={140}
                    height={79}
                    className="h-[79px] w-[140px] shrink-0 rounded-lg object-cover"
                    fallback={
                      <div className="h-[79px] w-[140px] shrink-0 overflow-hidden rounded-lg">
                        <StreamPreviewThumb seed={stream.id + stream.title} />
                      </div>
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {stream.title}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarBlank size={12} />
                        {formatDate(stream.date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {stream.duration
                          ? formatStreamDuration(stream.duration)
                          : "—"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye size={12} />
                        {formatNumber(stream.avgViewers ?? 0)} avg ·{" "}
                        {formatNumber(stream.peakViewers)} peak
                      </span>
                      {stream.earningsUsdMinor ? (
                        <span className="flex items-center gap-1 text-green-400">
                          <CurrencyDollar size={12} />
                          {formatUsd(stream.earningsUsdMinor)}
                        </span>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[0.6rem] font-medium",
                        CATEGORY_COLORS[stream.category]
                      )}
                    >
                      {stream.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled
                      title="Replays coming soon — stream recording isn't available yet"
                      className="flex size-8 cursor-not-allowed items-center justify-center rounded-lg border border-white/10 text-muted-foreground/30"
                    >
                      <Play size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Total Streams
              </h3>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {stats.totalStreams}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Avg. Viewers
              </h3>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {formatNumber(avgViewers)}
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tips Received
              </h3>
              <p className="mt-2 text-3xl font-bold text-foreground">
                {stats.tipsGrossUsdMinor === undefined
                  ? "—"
                  : formatUsd(stats.tipsGrossUsdMinor)}
              </p>
              {stats.tipsCount !== undefined && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {stats.tipsCount} {stats.tipsCount === 1 ? "gift" : "gifts"} ·
                  before commission
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Peak Viewers (Last 7 Days)
            </h3>
            <div className="flex h-48 items-end gap-2">
              {dailyViews.map((day) => {
                const pct =
                  maxDailyViews > 0
                    ? Math.max((day.views / maxDailyViews) * 100, 4)
                    : 4;
                // Buckets are UTC days on the server; label them in UTC too,
                // or the weekday shifts by one for negative-offset viewers.
                const d = new Date(day.date + "T00:00:00Z");
                return (
                  <div
                    key={day.date}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <div
                      className="w-full rounded-t-md bg-primary/30 transition-all hover:bg-primary/50"
                      style={{ height: `${pct}%` }}
                      title={`${day.date} · ${day.views} peak viewers`}
                    />
                    <span className="text-[0.6rem] text-muted-foreground">
                      {dayLabels[d.getUTCDay()]}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Top Performing Streams
            </h3>
            {topStreams.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No stream data yet.
              </p>
            ) : (
              <div className="space-y-3">
                {topStreams.map((stream, i) => (
                  <div key={stream.id} className="flex items-center gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-xs font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {stream.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(stream.date)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {formatNumber(stream.peakViewers)} peak
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
