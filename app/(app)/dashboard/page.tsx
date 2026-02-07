"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Eye,
  Users,
  CurrencyDollar,
  Clock,
  TrendUp,
  CalendarBlank,
  Play,
  Trash,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  CURRENT_USER,
  MOCK_PAST_STREAMS,
  CATEGORY_COLORS,
  formatNumber,
} from "@/lib/mock-data";

type Tab = "overview" | "streams" | "analytics";

export default function DashboardPage() {
  const [tab, setTab] = useState<Tab>("overview");

  const stats = [
    {
      label: "Total Views",
      value: formatNumber(CURRENT_USER.totalViews),
      change: "+12.5%",
      icon: Eye,
      color: "text-primary",
    },
    {
      label: "Followers",
      value: formatNumber(CURRENT_USER.followers),
      change: "+8.2%",
      icon: Users,
      color: "text-blue-400",
    },
    {
      label: "Earnings",
      value: "$512.90",
      change: "+24.1%",
      icon: CurrencyDollar,
      color: "text-green-400",
    },
    {
      label: "Stream Hours",
      value: "42h",
      change: "+5.3%",
      icon: Clock,
      color: "text-purple-400",
    },
  ];

  return (
    <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
      {/* Profile header */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image
            src={CURRENT_USER.avatar}
            alt={CURRENT_USER.username}
            width={56}
            height={56}
            className="size-14 rounded-full bg-white/10"
          />
          <div>
            <h1 className="text-xl font-bold text-foreground">
              {CURRENT_USER.displayName}
            </h1>
            <p className="text-sm text-muted-foreground">
              @{CURRENT_USER.username} · Joined{" "}
              {new Date(CURRENT_USER.joinedAt).toLocaleDateString("en-US", {
                month: "short",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-sm">
          {CURRENT_USER.bio}
        </p>
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
          {/* Stats grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
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
                <div className="mt-1 flex items-center gap-1 text-xs text-green-400">
                  <TrendUp size={12} />
                  {stat.change} this month
                </div>
              </div>
            ))}
          </div>

          {/* Recent streams */}
          <div className="mt-8">
            <h2 className="mb-4 text-base font-semibold text-foreground">
              Recent Streams
            </h2>
            <div className="space-y-3">
              {MOCK_PAST_STREAMS.slice(0, 3).map((stream) => (
                <div
                  key={stream.id}
                  className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
                >
                  <Image
                    src={stream.thumbnail}
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
                        {stream.date}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {stream.duration}
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
                  <div className="hidden text-right sm:block">
                    <p className="text-sm font-semibold text-green-400">
                      {stream.earnings}
                    </p>
                    <p className="text-[0.65rem] text-muted-foreground">
                      earned
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── Streams Tab ── */}
      {tab === "streams" && (
        <div className="space-y-3">
          {MOCK_PAST_STREAMS.map((stream) => (
            <div
              key={stream.id}
              className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.04]"
            >
              <Image
                src={stream.thumbnail}
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
                    {stream.date}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    {stream.duration}
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
                <span className="hidden text-sm font-semibold text-green-400 sm:block">
                  {stream.earnings}
                </span>
                <button
                  title="Replay"
                  className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Play size={14} />
                </button>
                <button
                  title="Delete"
                  className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:text-red-400 hover:border-red-500/20"
                >
                  <Trash size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {tab === "analytics" && (
        <div className="space-y-6">
          {/* Analytics cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Avg. Stream Duration
              </h3>
              <p className="mt-2 text-3xl font-bold text-foreground">2h 05m</p>
              <p className="mt-1 text-xs text-green-400 flex items-center gap-1">
                <TrendUp size={12} /> +12min vs last month
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Avg. Viewers
              </h3>
              <p className="mt-2 text-3xl font-bold text-foreground">2,058</p>
              <p className="mt-1 text-xs text-green-400 flex items-center gap-1">
                <TrendUp size={12} /> +18.4% vs last month
              </p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tips Received
              </h3>
              <p className="mt-2 text-3xl font-bold text-foreground">$512.90</p>
              <p className="mt-1 text-xs text-green-400 flex items-center gap-1">
                <TrendUp size={12} /> +24.1% vs last month
              </p>
            </div>
          </div>

          {/* Viewer chart placeholder */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Viewer Trend (Last 7 Days)
            </h3>
            <div className="flex h-48 items-end gap-2">
              {[65, 45, 80, 55, 90, 72, 95].map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-md bg-primary/30 transition-all hover:bg-primary/50"
                    style={{ height: `${h}%` }}
                  />
                  <span className="text-[0.6rem] text-muted-foreground">
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Top performing streams */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-5">
            <h3 className="mb-4 text-sm font-semibold text-foreground">
              Top Performing Streams
            </h3>
            <div className="space-y-3">
              {MOCK_PAST_STREAMS.sort((a, b) => b.peakViewers - a.peakViewers)
                .slice(0, 3)
                .map((stream, i) => (
                  <div
                    key={stream.id}
                    className="flex items-center gap-3"
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-xs font-bold text-muted-foreground">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {stream.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {stream.date}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-foreground">
                      {formatNumber(stream.peakViewers)} peak
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
