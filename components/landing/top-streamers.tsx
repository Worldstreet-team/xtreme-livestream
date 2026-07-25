"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown, TrendUp, Eye, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";

type TopStreamer = {
  rank: number;
  username: string;
  name: string;
  avatar: string;
  followers: string;
  /** Peak concurrent viewers, summed across their streams. */
  peakViewers: string;
  category: string;
  isLive: boolean;
  verified: boolean;
};

interface APITopStreamer {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  followers: number;
  totalPeakViewers: number;
  isLive: boolean;
  verified: boolean;
  category: string | null;
}

export function TopStreamers() {
  // `null` = still loading. Previously seeded with eight invented streamers
  // (fabricated follower and view counts) that stayed on screen whenever the
  // platform had no real users or the API was unreachable.
  const [topStreamers, setTopStreamers] = useState<TopStreamer[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streamers: APITopStreamer[] };
        }>("/api/users/top?limit=8");
        const streamers = res.data?.streamers ?? [];
        if (cancelled) return;
        setTopStreamers(
          streamers.map((s) => ({
            rank: s.rank,
            username: s.username,
            name: s.displayName || s.username,
            avatar: s.avatar,
            followers: formatNumber(s.followers),
            peakViewers: formatNumber(s.totalPeakViewers),
            category: s.category ?? "New Streamer",
            isLive: s.isLive,
            verified: s.verified,
          })),
        );
      } catch {
        if (!cancelled) setTopStreamers([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="top-streamers" className="relative py-20 sm:py-28 overflow-hidden">
      {/* Background glow */}
      <div className="absolute bottom-0 left-1/3 w-[250px] h-[250px] sm:w-[350px] sm:h-[350px] md:size-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <Crown size={14} weight="fill" />
            Leaderboard
          </div>
          <h2 className="mt-4 text-2xl font-bold text-foreground sm:text-3xl">
            Top Streamers
          </h2>
          <p className="mt-2 text-muted-foreground">
            Ranked by followers across the platform
          </p>
        </div>

        {/* Nobody on the board yet */}
        {topStreamers !== null && topStreamers.length === 0 && (
          <div className="mx-auto mt-10 max-w-3xl rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-14 text-center">
            <Crown size={36} className="mx-auto text-muted-foreground/30" />
            <p className="mt-4 text-base font-medium text-foreground">
              The leaderboard is wide open
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              No streamers yet — the first to build an audience takes the top
              spot.
            </p>
          </div>
        )}

        {/* Streamer list */}
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {topStreamers === null &&
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4"
              >
                <div className="size-8 shrink-0 animate-pulse rounded-lg bg-white/5" />
                <div className="size-11 shrink-0 animate-pulse rounded-full bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 animate-pulse rounded bg-white/5" />
                  <div className="h-3 w-1/4 animate-pulse rounded bg-white/5" />
                </div>
              </div>
            ))}
          {(topStreamers ?? []).map((streamer) => (
            <Link
              key={streamer.rank}
              href={`/explore?search=${encodeURIComponent(streamer.username)}`}
              className="group flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04]"
            >
              {/* Rank */}
              <div
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                  streamer.rank === 1
                    ? "bg-yellow-500/20 text-yellow-400"
                    : streamer.rank === 2
                    ? "bg-gray-300/20 text-gray-300"
                    : streamer.rank === 3
                    ? "bg-orange-500/20 text-orange-400"
                    : "bg-white/5 text-muted-foreground"
                }`}
              >
                {streamer.rank}
              </div>

              {/* Avatar */}
              <div className="relative">
                <UserAvatar
                  src={streamer.avatar}
                  name={streamer.name}
                  size={44}
                  className="size-11"
                />
                {streamer.isLive && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full border-2 border-background bg-red-500">
                    <span className="size-1.5 rounded-full bg-white" />
                  </span>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {streamer.name}
                  </h3>
                  {streamer.verified && (
                    <SealCheck
                      size={14}
                      weight="fill"
                      className="shrink-0 text-sky-400"
                      aria-label="Verified streamer"
                    />
                  )}
                  {streamer.isLive && (
                    <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[0.6rem] font-semibold text-red-400">
                      LIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {streamer.category}
                </p>
              </div>

              {/* Stats */}
              <div className="hidden items-center gap-6 sm:flex">
                <div className="text-right">
                  <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    <TrendUp size={14} className="text-green-400" />
                    {streamer.followers}
                  </div>
                  <div className="text-[0.65rem] text-muted-foreground">
                    Followers
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1 text-sm font-semibold text-foreground">
                    <Eye size={14} className="text-primary" />
                    {streamer.peakViewers}
                  </div>
                  <div className="text-[0.65rem] text-muted-foreground">
                    Peak Viewers
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
