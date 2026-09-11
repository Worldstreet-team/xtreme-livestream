"use client";

import { useCallback, useEffect, useState } from "react";
import { HeartBreak, Broadcast, Clock, MoonStars } from "@phosphor-icons/react";
import { StreamCard } from "@/components/app/stream-card";
import { UpcomingCard } from "@/components/app/upcoming-card";
import { ChannelCard } from "@/components/app/channel-card";
import { AvatarRingsRow } from "@/components/app/avatar-rings-row";
import { Shelf, LiveDot } from "@/components/app/shelf";
import { Empty, GoLiveButton } from "@/components/app/empty";
import { apiFetch, apiUrl } from "@/lib/api-client";
import type { Category } from "@/lib/categories";
import { toCard, type HomePage, type HomeRow } from "@/lib/discovery";
import { resetImpressions } from "@/lib/impressions";

/**
 * The channels you follow — the page a returning viewer opens first.
 *
 * Split hard into live and offline rather than sorted into one list: "who
 * can I watch right now" and "who am I subscribed to" are different
 * questions. Live inventory evaporates hourly, so when nobody you follow is
 * on, the page doesn't go blank: it shows what's coming up from your
 * channels, who's back on air from your history, and what's trending.
 */

const REFRESH_MS = 30_000;

interface FollowedChannel {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followers: number;
  verified: boolean;
  isLive: boolean;
  stream: {
    id: string;
    title: string;
    category: Category;
    viewers: number;
    startedAt: string;
    thumbnailUrl: string | null;
  } | null;
}

export default function FollowingPage() {
  const [channels, setChannels] = useState<FollowedChannel[]>([]);
  const [home, setHome] = useState<HomePage | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [followingRes, homeRes] = await Promise.all([
        apiFetch<{ success: boolean; data: { channels: FollowedChannel[] } }>(`/api/user/me/following`),
        apiFetch<{ success: boolean; data: HomePage }>(`/api/home`).catch(() => null),
      ]);
      setChannels(followingRes.data.channels);
      if (homeRes) setHome(homeRes.data);
    } catch {
      if (!silent) setChannels([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    resetImpressions();
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const live = channels.filter((c) => c.isLive && c.stream);
  const offline = channels.filter((c) => !c.isLive);
  const row = (id: string): HomeRow | undefined => home?.rows.find((r) => r.id === id);
  const upcoming = row("upcoming-followed");
  const backOnAir = row("continue");
  const trending = row("trending");

  const rings = channels.map((c) => ({
    id: c.id,
    username: c.username,
    displayName: c.displayName,
    avatar: c.avatar,
    isLive: c.isLive,
    href: c.isLive && c.stream ? `/stream/${c.stream.id}` : `/c/${c.username}`,
    viewers: c.stream?.viewers ?? null,
  }));

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="w-full">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Following
          </h1>
          <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            {live.length > 0 && <LiveDot />}
            {loading
              ? "Loading…"
              : channels.length === 0
                ? "You don't follow anyone yet"
                : `${live.length} of ${channels.length} live now`}
          </p>
        </div>

        {loading ? (
          <div className="space-y-8">
            <div className="flex gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="size-14 animate-pulse rounded-full bg-white/[0.04]" />
              ))}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="aspect-video animate-pulse rounded-sm bg-white/[0.04]" />
              ))}
            </div>
          </div>
        ) : channels.length === 0 ? (
          <EmptyFollowing trending={trending} />
        ) : (
          <div className="space-y-9">
            {/* Every channel at a glance — live first, rings say who's on. */}
            <section aria-label="Your channels">
              <AvatarRingsRow items={rings} />
            </section>

            {live.length > 0 ? (
              <section>
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
                  <Broadcast size={15} weight="fill" className="text-red-500" />
                  Live now
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
                  {live.map((channel, slot) => (
                    <StreamCard
                      key={channel.id}
                      variant="large"
                      stream={{
                        id: channel.stream!.id,
                        title: channel.stream!.title,
                        category: channel.stream!.category,
                        tags: [],
                        thumbnailUrl: apiUrl(channel.stream!.thumbnailUrl),
                        isLive: true,
                        viewers: channel.stream!.viewers,
                        startedAt: channel.stream!.startedAt,
                        duration: "",
                        streamer: {
                          id: channel.id,
                          username: channel.username,
                          displayName: channel.displayName,
                          avatar: channel.avatar,
                          isLive: true,
                          verified: channel.verified,
                        },
                      }}
                      impression={{ streamId: channel.stream!.id, surface: "following", row: "live", slot }}
                    />
                  ))}
                </div>
              </section>
            ) : (
              <NobodyLive />
            )}

            {upcoming && upcoming.items.length > 0 && (
              <Shelf
                id="upcoming-followed"
                title="Coming up from your channels"
                accent={<Clock size={14} weight="bold" className="text-muted-foreground" />}
              >
                {upcoming.items.map((item, slot) => (
                  <UpcomingCard
                    key={item._id}
                    item={item}
                    impression={{ streamId: item._id, surface: "following", row: "upcoming-followed", slot }}
                  />
                ))}
              </Shelf>
            )}

            {live.length === 0 && backOnAir && backOnAir.items.length > 0 && (
              <Shelf id="continue" title={backOnAir.title} reason={backOnAir.reason} accent={<LiveDot />}>
                {backOnAir.items.map((item, slot) => (
                  <StreamCard
                    key={item._id}
                    stream={toCard(item)}
                    variant="badges"
                    impression={{ streamId: item._id, surface: "following", row: "continue", slot }}
                  />
                ))}
              </Shelf>
            )}

            {live.length === 0 && trending && trending.items.length > 0 && (
              <Shelf id="trending" title={trending.title} reason={trending.reason}>
                {trending.items.map((item, slot) => (
                  <StreamCard
                    key={item._id}
                    stream={toCard(item)}
                    variant="badges"
                    impression={{ streamId: item._id, surface: "following", row: "trending", slot }}
                  />
                ))}
              </Shelf>
            )}

            {offline.length > 0 && (
              <section>
                <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
                  Offline
                  <span className="ml-2 text-xs font-normal text-muted-foreground/60 tabular-nums">
                    {offline.length}
                  </span>
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                  {offline.map((channel) => (
                    <ChannelCard
                      key={channel.id}
                      channel={{
                        id: channel.id,
                        username: channel.username,
                        displayName: channel.displayName,
                        avatar: channel.avatar,
                        bio: channel.bio,
                        followers: channel.followers,
                        verified: channel.verified,
                        isLive: false,
                        isFollowing: true,
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NobodyLive() {
  return (
    <div className="flex items-center gap-4 rounded-sm border border-white/[0.06] px-5 py-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-muted-foreground">
        <MoonStars size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground/90">Nobody you follow is live right now</p>
        <p className="mt-0.5 text-sm text-muted-foreground/70">
          Here&apos;s what&apos;s coming up from your channels, who&apos;s back on air, and what&apos;s moving.
        </p>
      </div>
      {/* Their stage is dark; yours doesn't have to be. */}
      <GoLiveButton className="ml-auto hidden shrink-0 sm:flex" />
    </div>
  );
}

function EmptyFollowing({ trending }: { trending?: HomeRow }) {
  return (
    <div className="space-y-9">
      <Empty
        icon={<HeartBreak size={36} />}
        title="Nothing here yet"
        body="Follow a channel and it shows up here the moment they go live — or start a channel of your own."
        action={{ label: "Find channels", href: "/explore" }}
      />
      {trending && trending.items.length > 0 && (
        <Shelf id="trending" title="Worth following" reason="Growing fastest right now — a good place to start">
          {trending.items.map((item, slot) => (
            <StreamCard
              key={item._id}
              stream={toCard(item)}
              variant="badges"
              showFollow
              impression={{ streamId: item._id, surface: "following", row: "suggested", slot }}
            />
          ))}
        </Shelf>
      )}
    </div>
  );
}
