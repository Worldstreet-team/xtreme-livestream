"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Eye, SealCheck } from "@phosphor-icons/react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/mock-data";

type FeaturedStream = {
  id: string;
  title: string;
  streamer: string;
  viewers: number;
  category: string;
  // Empty thumbnail → generated chart preview
  thumbnail: string;
  pair?: string;
  avatar: string;
  isLive: boolean;
  verified?: boolean;
};

// Curated fallback shown until real live streams exist
const demoStreams: FeaturedStream[] = [
  {
    id: "demo-1",
    title: "BTC at Resistance: Reading the 4H Chart",
    streamer: "Marcus Delgado",
    viewers: 1284,
    category: "Bitcoin Trading",
    thumbnail: "",
    pair: "BTC/USDT",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=marcustrades",
    isLive: true,
    verified: true,
  },
  {
    id: "demo-2",
    title: "Solana DeFi Deep Dive: LP Risks Explained",
    streamer: "0xKenji",
    viewers: 947,
    category: "Altcoins & DeFi",
    thumbnail: "",
    pair: "SOL/USDT",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=0xKenji",
    isLive: true,
    verified: true,
  },
  {
    id: "demo-3",
    title: "Reading On-Chain Flows Before the Fed",
    streamer: "LenaChartLab",
    viewers: 613,
    category: "Market Analysis",
    thumbnail: "",
    pair: "ETH/USDT",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=LenaChartLab",
    isLive: true,
    verified: true,
  },
  {
    id: "demo-4",
    title: "NFT Market Check: Floor Prices & Volume",
    streamer: "block_amara",
    viewers: 402,
    category: "NFTs & Web3",
    thumbnail: "",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=block_amara",
    isLive: true,
  },
  {
    id: "demo-5",
    title: "Small-Cap Watchlist + My Risk Rules",
    streamer: "TheQuietTrader",
    viewers: 355,
    category: "Altcoins & DeFi",
    thumbnail: "",
    pair: "AVAX/USDT",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=TheQuietTrader",
    isLive: true,
  },
  {
    id: "demo-6",
    title: "Crypto Taxes 101: What Traders Get Wrong",
    streamer: "priya.hodl",
    viewers: 218,
    category: "Crypto Education",
    thumbnail: "",
    avatar: "https://api.dicebear.com/9.x/avataaars/svg?seed=priya.hodl",
    isLive: false,
    verified: true,
  },
];

interface APIStream {
  _id: string;
  title: string;
  category: string;
  thumbnail: string;
  isLive: boolean;
  viewers: number;
  streamerId: {
    _id: string;
    username: string;
    displayName: string;
    avatar: string;
    verified?: boolean;
  };
}

export function FeaturedStreams() {
  const [streams, setStreams] = useState<FeaturedStream[]>(demoStreams);

  // Swap in real live streams when the platform has them
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streams: APIStream[] };
        }>("/api/streams?live=true&sort=viewers&limit=6");
        const live = res.data?.streams ?? [];
        if (!cancelled && live.length > 0) {
          setStreams(
            live.map((s) => ({
              id: s._id,
              title: s.title,
              streamer: s.streamerId.displayName || s.streamerId.username,
              viewers: s.viewers,
              category: s.category,
              thumbnail: s.thumbnail || "",
              avatar: s.streamerId.avatar,
              isLive: s.isLive,
              verified: s.streamerId.verified ?? false,
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
    <section id="explore" className="relative py-20 sm:py-28 overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 right-1/4 w-[250px] h-[250px] sm:w-[350px] sm:h-[350px] md:size-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
              Featured Streams
            </h2>
            <p className="mt-2 text-muted-foreground">
              Trending live streams from the crypto community
            </p>
          </div>
          <Link
            href="/explore"
            className="hidden text-sm font-medium text-primary transition-colors hover:text-primary/80 sm:block"
          >
            View All →
          </Link>
        </div>

        {/* Stream grid */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {streams.map((stream) => (
            <Link key={stream.id} href={`/stream/${stream.id}`}>
            <article
              className="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-all hover:border-white/10 hover:bg-white/[0.04]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video overflow-hidden">
                {stream.thumbnail ? (
                  <Image
                    src={stream.thumbnail}
                    alt={stream.title}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <StreamPreviewThumb
                    seed={stream.id + stream.title}
                    pair={stream.pair}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

                {/* Live badge */}
                {stream.isLive && (
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                    </span>
                    LIVE
                  </div>
                )}

                {/* Viewers */}
                <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                  <Eye size={14} />
                  {formatNumber(stream.viewers)}
                </div>
              </div>

              {/* Info */}
              <div className="flex gap-3 p-3">
                <UserAvatar
                  src={stream.avatar}
                  name={stream.streamer}
                  size={36}
                  className="size-9"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {stream.title}
                  </h3>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    {stream.streamer}
                    {stream.verified && (
                      <SealCheck
                        size={13}
                        weight="fill"
                        className="shrink-0 text-sky-400"
                        aria-label="Verified streamer"
                      />
                    )}
                  </p>
                  <Badge
                    variant="secondary"
                    className="mt-1.5 text-[0.65rem] h-4 bg-white/5 text-muted-foreground border-0"
                  >
                    {stream.category}
                  </Badge>
                </div>
              </div>
            </article>
            </Link>
          ))}
        </div>

        {/* Mobile view all */}
        <div className="mt-6 text-center sm:hidden">
          <Link
            href="/explore"
            className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            View All Streams →
          </Link>
        </div>
      </div>
    </section>
  );
}
