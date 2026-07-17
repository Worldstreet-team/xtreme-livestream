"use client";

import { useEffect, useState } from "react";
import { Crown, TrendUp, Eye, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/mock-data";

type TopStreamer = {
  rank: number;
  name: string;
  avatar: string;
  followers: string;
  totalViews: string;
  category: string;
  isLive: boolean;
  verified: boolean;
};

// Curated fallback shown until real streamers exist
const demoStreamers: TopStreamer[] = [
  {
    rank: 1,
    name: "Marcus Delgado",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=marcustrades",
    followers: "12.4K",
    totalViews: "471K",
    category: "Bitcoin Trading",
    isLive: true,
    verified: true,
  },
  {
    rank: 2,
    name: "0xKenji",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=0xKenji",
    followers: "8.9K",
    totalViews: "356K",
    category: "DeFi Protocols",
    isLive: true,
    verified: true,
  },
  {
    rank: 3,
    name: "LenaChartLab",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=LenaChartLab",
    followers: "8.1K",
    totalViews: "289K",
    category: "Market Analysis",
    isLive: false,
    verified: true,
  },
  {
    rank: 4,
    name: "SatsPerDay",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=SatsPerDay",
    followers: "6.7K",
    totalViews: "232K",
    category: "Bitcoin Trading",
    isLive: true,
    verified: false,
  },
  {
    rank: 5,
    name: "priya.hodl",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=priya.hodl",
    followers: "5.9K",
    totalViews: "178K",
    category: "Crypto Education",
    isLive: false,
    verified: true,
  },
  {
    rank: 6,
    name: "TheQuietTrader",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=TheQuietTrader",
    followers: "4.2K",
    totalViews: "149K",
    category: "Futures & Perps",
    isLive: true,
    verified: false,
  },
  {
    rank: 7,
    name: "block_amara",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=block_amara",
    followers: "3.8K",
    totalViews: "117K",
    category: "NFT Markets",
    isLive: false,
    verified: false,
  },
  {
    rank: 8,
    name: "DeFiDante",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=DeFiDante",
    followers: "3.4K",
    totalViews: "94K",
    category: "Yield Strategies",
    isLive: false,
    verified: false,
  },
];

interface APITopStreamer {
  rank: number;
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  followers: number;
  totalViews: number;
  isLive: boolean;
  verified: boolean;
  category: string | null;
}

export function TopStreamers() {
  const [topStreamers, setTopStreamers] = useState<TopStreamer[]>(demoStreamers);

  // Swap in real streamers when the platform has them
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streamers: APITopStreamer[] };
        }>("/api/users/top?limit=8");
        const streamers = res.data?.streamers ?? [];
        if (!cancelled && streamers.length > 0) {
          setTopStreamers(
            streamers.map((s) => ({
              rank: s.rank,
              name: s.displayName || s.username,
              avatar: s.avatar,
              followers: formatNumber(s.followers),
              totalViews: formatNumber(s.totalViews),
              category: s.category ?? "New Streamer",
              isLive: s.isLive,
              verified: s.verified,
            })),
          );
        }
      } catch {
        // API unavailable — keep the curated fallback
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
            The most-watched crypto streamers this month
          </p>
        </div>

        {/* Streamer list */}
        <div className="mx-auto mt-10 max-w-3xl space-y-3">
          {topStreamers.map((streamer) => (
            <div
              key={streamer.rank}
              className="group flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04] cursor-pointer"
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
                    {streamer.totalViews}
                  </div>
                  <div className="text-[0.65rem] text-muted-foreground">
                    Total Views
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
