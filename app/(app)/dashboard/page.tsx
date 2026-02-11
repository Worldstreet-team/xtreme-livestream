"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  Eye,
  Users,
  CurrencyDollar,
  Clock,
  CalendarBlank,
  Play,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { CATEGORY_COLORS, formatNumber, type Category } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { UserAvatar } from "@/components/ui/user-avatar";

type Tab = "overview" | "streams" | "analytics";

interface DashboardStats {
  totalViews: number;
  followers: number;
  totalHours: number;
  totalStreams: number;
  currentlyLive: boolean;
}

interface RecentStream {
  id: string;
  title: string;
  category: Category;
  thumbnail: string;
  viewers: number;
  peakViewers: number;
  duration: string;
  date: string;
  earnings: number;
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
      label: "Total Views",
      value: formatNumber(stats.totalViews),
      icon: Eye,
      color: "text-primary",
    },
    {
      label: "Followers",
      value: formatNumber(stats.followers),
      icon: Users,
      color: "text-blue-400",
    },
    {
      label: "Earnings",
      value: "$0.00",
      icon: CurrencyDollar,
      color: "text-green-400",
    },
    {
      label: "Stream Hours",
      value: `${stats.totalHours}h`,
      icon: Clock,
      color: "text-purple-400",
    },
  ];

  const maxDailyViews = Math.max(...dailyViews.map((d) => d.views), 1);
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const avgViewers =
    recentStreams.length > 0
      ? Math.round(
          recentStreams.reduce((sum, s) => sum + s.viewers, 0) /
            recentStreams.length
        )
      : 0;

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
                    <Image
                      src={
                        stream.thumbnail ||
                        "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=800&auto=format&fit=crop"
                      }
                      alt={stream.title}
                      width={120}
                      height={68}
                      className="h-[68px] w-[120px] shrink-0 rounded-lg object-cover"
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
                          {stream.duration || "—"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Eye size={12} />
                          {formatNumber(stream.viewers)} avg
                        </span>
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
                  <Image
                    src={
                      stream.thumbnail ||
                      "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=800&auto=format&fit=crop"
                    }
                    alt={stream.title}
                    width={140}
                    height={79}
                    className="h-[79px] w-[140px] shrink-0 rounded-lg object-cover"
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
                        {stream.duration || "—"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye size={12} />
                        {formatNumber(stream.viewers)} avg ·{" "}
                        {formatNumber(stream.peakViewers)} peak
                      </span>
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
                      title="Replay"
                      className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
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
              <p className="mt-2 text-3xl font-bold text-foreground">$0.00</p>
            </div>
          </div>

          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Viewer Trend (Last 7 Days)
            </h3>
            <div className="flex h-48 items-end gap-2">
              {dailyViews.map((day) => {
                const pct =
                  maxDailyViews > 0
                    ? Math.max((day.views / maxDailyViews) * 100, 4)
                    : 4;
                const d = new Date(day.date + "T00:00:00");
                return (
                  <div
                    key={day.date}
                    className="flex flex-1 flex-col items-center gap-2"
                  >
                    <div
                      className="w-full rounded-t-md bg-primary/30 transition-all hover:bg-primary/50"
                      style={{ height: `${pct}%` }}
                      title={`${day.views} views`}
                    />
                    <span className="text-[0.6rem] text-muted-foreground">
                      {dayLabels[d.getDay()]}
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
