"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Eye, Lightning, SealCheck, VideoCamera } from "@phosphor-icons/react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";
import { RemoteImage } from "@/components/ui/remote-image";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";

type FeaturedStream = {
  id: string;
  title: string;
  streamer: string;
  viewers: number;
  category: string;
  // Empty thumbnail → generated chart preview
  thumbnail: string;
  avatar: string;
  isLive: boolean;
  verified?: boolean;
};

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
  // `null` = still loading. This used to seed six fabricated streams as a
  // "curated fallback", which shipped invented viewer counts to the landing
  // page and — because each card linked to /stream/demo-N, an id the API
  // rejects as a malformed ObjectId — meant every card was a dead link
  // whenever nobody was actually live.
  const [streams, setStreams] = useState<FeaturedStream[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streams: APIStream[] };
        }>("/api/streams?live=true&sort=viewers&limit=6");
        const live = res.data?.streams ?? [];
        if (cancelled) return;
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
      } catch {
        // Nothing to show is the honest answer when the API is unreachable.
        if (!cancelled) setStreams([]);
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

        {/* Loading skeleton */}
        {streams === null && (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]"
              >
                <div className="aspect-video animate-pulse bg-white/5" />
                <div className="flex gap-3 p-3">
                  <div className="size-9 shrink-0 animate-pulse rounded-full bg-white/5" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Nobody live yet */}
        {streams !== null && streams.length === 0 && (
          <div className="mt-8 flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-16 text-center">
            <VideoCamera size={40} className="text-muted-foreground/30" />
            <p className="mt-4 text-base font-medium text-foreground">
              Nobody&apos;s live right now
            </p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              The platform is quiet at the moment. Be the first to go live and
              you&apos;ll show up right here.
            </p>
            <Link
              href="/studio"
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
            >
              <Lightning size={16} weight="fill" />
              Start Streaming
            </Link>
          </div>
        )}

        {/* Stream grid */}
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(streams ?? []).map((stream) => (
            <Link key={stream.id} href={`/stream/${stream.id}`}>
            <article
              className="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-all hover:border-white/10 hover:bg-white/[0.04]"
            >
              {/* Thumbnail */}
              <div className="relative aspect-video overflow-hidden">
                {stream.thumbnail ? (
                  <RemoteImage
                    src={stream.thumbnail}
                    alt={stream.title}
                    fill
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    fallback={
                      <StreamPreviewThumb seed={stream.id + stream.title} />
                    }
                  />
                ) : (
                  <StreamPreviewThumb seed={stream.id + stream.title} />
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
