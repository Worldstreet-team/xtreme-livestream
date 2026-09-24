"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Eye,
  SealCheck,
  Users,
  VideoCamera,
  Broadcast,
  CalendarBlank,
  Clock,
  ChartBar,
  House,
  Info,
} from "@phosphor-icons/react";
import { StreamCard } from "@/components/app/stream-card";
import { UpcomingCard, RemindButton } from "@/components/app/upcoming-card";
import { FollowButton } from "@/components/app/follow-button";
import { MessageButton } from "@/components/app/message-button";
import { useAuth } from "@/lib/auth-context";
import { StreamArt } from "@/components/app/stream-art";
import { Empty } from "@/components/app/empty";
import { PillTabs } from "@/components/ui/tabs";
import { LivePreview } from "@/components/app/live-preview";
import { Shelf, LiveDot } from "@/components/app/shelf";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { formatStartsIn, formatUptime, toCard, type RowItem } from "@/lib/discovery";
import { resetImpressions } from "@/lib/impressions";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * A channel — the platform's unit of identity. A stream is something a
 * channel is doing right now and vanishes when it ends; everything durable
 * about a streamer lives here.
 *
 * Live: the broadcast is the hero, as a muted preview. Offline: the last
 * broadcast leads, dimmed and dated, beside the next scheduled one — so the
 * page is never a dead end, and a follow has something to wait for.
 */

type Tab = "home" | "videos" | "schedule" | "about";

interface ChannelUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followers: number;
  following: number;
  isLive: boolean;
  verified: boolean;
  createdAt: string;
  /** Clerk id: what WorldSpace messaging resolves the channel by. */
  authUserId?: string;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function timeAgo(iso: string, now: number) {
  const diff = now - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "less than an hour ago";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return `${Math.floor(d / 7)} weeks ago`;
}

export default function ChannelPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);

  const [channel, setChannel] = useState<ChannelUser | null>(null);
  const { user: viewer } = useAuth();
  const [isFollowing, setIsFollowing] = useState(false);
  const [streams, setStreams] = useState<RowItem[]>([]);
  const [also, setAlso] = useState<RowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const now = useNow(true);

  const load = useCallback(async () => {
    try {
      const [profile, streamList] = await Promise.all([
        apiFetch<{ success: boolean; data: { user: ChannelUser; isFollowing: boolean } }>(
          `/api/user/${username}`
        ),
        apiFetch<{ success: boolean; data: { streams: RowItem[] } }>(
          `/api/streams?streamer=${encodeURIComponent(username)}&sort=recent&limit=48`
        ),
      ]);
      setChannel(profile.data.user);
      setIsFollowing(profile.data.isFollowing);
      setStreams(streamList.data.streams);

      const seed = streamList.data.streams[0];
      if (seed) {
        apiFetch<{ success: boolean; data: { streams: RowItem[] } }>(
          `/api/streams/${seed._id}/also-watched`
        )
          .then((r) => setAlso(r.data.streams))
          .catch(() => setAlso([]));
      }
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    resetImpressions();
    void load();
  }, [load]);

  const liveStream = streams.find((s) => s.isLive);
  const upcoming = useMemo(
    () =>
      streams
        .filter((s) => s.status === "upcoming" && s.scheduledStartAt)
        .sort((a, b) => new Date(a.scheduledStartAt!).getTime() - new Date(b.scheduledStartAt!).getTime()),
    [streams]
  );
  const past = useMemo(
    () => streams.filter((s) => !s.isLive && s.status !== "upcoming"),
    [streams]
  );
  const nextUp = upcoming[0];
  const lastBroadcast = past[0];

  // "Usually streams" — which weekday hours their past broadcasts started
  // in. A schedule you can read even when nothing is booked.
  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array<number>(4).fill(0));
    past.forEach((s) => {
      if (!s.startedAt) return;
      const d = new Date(s.startedAt);
      const day = (d.getDay() + 6) % 7;
      const block = Math.floor(d.getHours() / 6);
      grid[day][block] += 1;
    });
    const max = Math.max(1, ...grid.flat());
    return { grid, max, total: past.length };
  }, [past]);

  if (loading) {
    return (
      <div className="min-h-screen p-4 md:p-6">
        <div className="w-full">
          <div className="aspect-[6/1] animate-pulse rounded-sm bg-white/[0.04]" />
          <div className="mt-5 flex gap-4">
            <div className="size-20 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="flex-1 space-y-3 pt-2">
              <div className="h-5 w-56 animate-pulse rounded bg-white/[0.04]" />
              <div className="h-3.5 w-80 animate-pulse rounded bg-white/[0.04]" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !channel) {
    return (
      <Empty
        className="min-h-screen"
        icon={<Users size={40} />}
        title={`No channel called @${username}`}
        body="The name may have changed, or the account no longer exists."
        action={{ label: "Browse live channels", href: "/explore" }}
      />
    );
  }

  const name = channel.displayName || channel.username;
  const memberSince = new Date(channel.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const peak = past.reduce((m, s) => Math.max(m, s.peakViewers), 0);

  const TABS: [Tab, string, typeof House][] = [
    ["home", "Home", House],
    ["videos", `Videos`, VideoCamera],
    ["schedule", "Schedule", CalendarBlank],
    ["about", "About", Info],
  ];

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="w-full">
        {/* Hero */}
        {liveStream ? (
          <Link
            href={`/stream/${liveStream._id}`}
            className="group relative block aspect-[16/6] overflow-hidden rounded-sm bg-white/[0.03] md:aspect-[16/5]"
          >
            <LivePreview
              streamId={liveStream._id}
              fallbackSrc={liveStream.previewUrl ?? null}
              className="absolute inset-0"
              poster={
                <StreamArt src={liveStream.thumbnailUrl} category={liveStream.category} alt={liveStream.title} seed={liveStream._id + liveStream.title} size={{ w: 1280, h: 720 }} />
              }
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/5" />
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-[0.65rem] font-semibold tracking-wide text-white">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                </span>
                LIVE
              </span>
              <span className="rounded bg-black/70 px-2 py-1 text-[0.65rem] font-medium text-white/90 tabular-nums">
                {formatUptime(liveStream.startedAt, now)}
              </span>
            </div>
            <span className="absolute top-3 right-3 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[0.65rem] font-medium text-white/90 tabular-nums">
              <Eye size={12} />
              {formatNumber(liveStream.viewers)}
            </span>
            <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
              <h2 className="max-w-3xl truncate text-base font-semibold text-white md:text-lg">{liveStream.title}</h2>
              <p className="mt-1 text-xs text-white/70 md:text-sm">{liveStream.category}</p>
            </div>
          </Link>
        ) : (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {/* Last broadcast, dimmed and dated — the channel's most recent self. */}
            <Link
              href={lastBroadcast ? `/stream/${lastBroadcast._id}` : `/c/${channel.username}`}
              className="group relative block aspect-[16/7] overflow-hidden rounded-sm bg-white/[0.03] md:aspect-auto md:min-h-[220px]"
            >
              <div className="absolute inset-0 opacity-60 grayscale-[30%] transition-opacity group-hover:opacity-75">
                <StreamArt
                  src={lastBroadcast?.thumbnailUrl ?? null}
                  category={lastBroadcast?.category ?? ""}
                  alt={lastBroadcast?.title ?? `${channel.displayName || channel.username}'s channel`}
                  seed={channel.username + channel.id}
                  size={{ w: 1280, h: 720 }}
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <span className="absolute top-3 left-3 rounded bg-black/70 px-2 py-1 text-[0.65rem] font-medium text-white/85">
                {lastBroadcast ? `Last live ${timeAgo(lastBroadcast.endedAt ?? lastBroadcast.startedAt ?? channel.createdAt, now)}` : "Offline"}
              </span>
              {lastBroadcast && (
                <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
                  <p className="text-[0.65rem] font-medium tracking-wider text-white/60 uppercase">Last broadcast</p>
                  <h2 className="mt-0.5 max-w-2xl truncate text-base font-semibold text-white">{lastBroadcast.title}</h2>
                  <p className="mt-1 text-xs text-white/70 tabular-nums">
                    {lastBroadcast.duration} · peaked at {formatNumber(lastBroadcast.peakViewers)} viewers
                  </p>
                </div>
              )}
            </Link>

            {/* Next up — a reason to come back, with the one action that helps. */}
            <div className="flex flex-col justify-between rounded-sm border border-white/[0.06] p-5">
              <div>
                <p className="flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wider text-muted-foreground/70 uppercase">
                  <Clock size={12} weight="bold" />
                  Next up
                </p>
                {nextUp ? (
                  <>
                    <h3 className="mt-2 line-clamp-2 text-base font-semibold text-foreground">{nextUp.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {nextUp.category} · <span className="text-foreground/90">{formatStartsIn(nextUp.scheduledStartAt!, now)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground/60">
                      {new Date(nextUp.scheduledStartAt!).toLocaleString(undefined, { weekday: "long", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="mt-2 text-base font-semibold text-foreground">Nothing scheduled</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {heat.total > 0 ? "See when they usually stream in the schedule tab." : "Follow to hear the moment they go live."}
                    </p>
                  </>
                )}
              </div>
              <div className="mt-4 flex items-center gap-2">
                {nextUp && <RemindButton streamId={nextUp._id} initial={nextUp.reminded ?? false} size="default" />}
                {!nextUp && <FollowButton username={channel.username} initialFollowing={isFollowing} />}
              </div>
            </div>
          </div>
        )}

        {/* Identity bar */}
        <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start">
          <span className="relative w-fit shrink-0">
            <UserAvatar src={channel.avatar} name={name} size={80} className={cn("size-20 ring-4", liveStream ? "ring-red-600" : "ring-white/[0.08]")} />
            {liveStream && (
              <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-red-600 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wide text-white">LIVE</span>
            )}
          </span>

          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-xl font-semibold tracking-tight text-foreground">
              {name}
              {channel.verified && <SealCheck size={17} weight="fill" className="shrink-0 text-sky-400" aria-label="Verified streamer" />}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">@{channel.username}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Users size={13} />
                <span className="font-medium text-foreground/90 tabular-nums">{formatNumber(channel.followers)}</span> followers
              </span>
              <span className="flex items-center gap-1.5">
                <VideoCamera size={13} />
                <span className="font-medium text-foreground/90 tabular-nums">{past.length + (liveStream ? 1 : 0)}</span>
                {past.length + (liveStream ? 1 : 0) === 1 ? "broadcast" : "broadcasts"}
              </span>
              <span className="flex items-center gap-1.5">
                <CalendarBlank size={13} />
                Since {memberSince}
              </span>
            </div>
            {channel.bio && <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{channel.bio}</p>}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {liveStream && (
              <Link href={`/stream/${liveStream._id}`} className="flex h-9 items-center gap-2 rounded-sm bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700">
                <Broadcast size={15} weight="fill" />
                Watch live
              </Link>
            )}
            {viewer && channel.authUserId && viewer.id !== channel.id && (
              <MessageButton
                recipient={channel.authUserId}
                context={{
                  kind: "channel",
                  id: channel.id,
                  title: channel.displayName,
                  url: typeof window === "undefined" ? undefined : window.location.href,
                }}
              />
            )}
            <FollowButton
              username={channel.username}
              initialFollowing={isFollowing}
              onChange={(next) =>
                setChannel((c) => (c ? { ...c, followers: Math.max(0, c.followers + (next ? 1 : -1)) } : c))
              }
            />
          </div>
        </div>

        {/* Tabs */}
        <PillTabs
          className="mt-8"
          label="Channel"
          items={TABS.map(([id, label, Icon]) => ({
            id,
            label,
            icon: Icon,
            count: id === "videos" ? past.length : id === "schedule" ? upcoming.length : null,
          }))}
          value={tab}
          onChange={setTab}
        />

        <div className="mt-8 space-y-9">
          {tab === "home" && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat icon={Users} value={formatNumber(channel.followers)} label="Followers" />
                <Stat icon={Eye} value={formatNumber(peak || liveStream?.peakViewers || 0)} label="Peak viewers" />
                <Stat icon={VideoCamera} value={String(past.length + (liveStream ? 1 : 0))} label="Broadcasts" />
                <Stat icon={CalendarBlank} value={memberSince.split(" ")[1] ?? memberSince} label="Streaming since" />
              </div>

              {upcoming.length > 0 && (
                <Shelf id="chan-upcoming" title="Coming up" accent={<Clock size={14} weight="bold" className="text-muted-foreground" />} href={undefined}>
                  {upcoming.map((item, slot) => (
                    <UpcomingCard key={item._id} item={item} impression={{ streamId: item._id, surface: "channel", row: "upcoming", slot }} />
                  ))}
                </Shelf>
              )}

              {past.length > 0 && (
                <section>
                  <div className="mb-4 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold tracking-tight text-foreground">Recent broadcasts</h2>
                    {past.length > 4 && (
                      <button type="button" onClick={() => setTab("videos")} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                        See all {past.length}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
                    {past.slice(0, 4).map((s, slot) => (
                      <StreamCard key={s._id} stream={toCard(s)} impression={{ streamId: s._id, surface: "channel", row: "recent", slot }} />
                    ))}
                  </div>
                </section>
              )}

              {also.length > 0 && (
                <Shelf
                  id="also-watched"
                  title="Viewers also watch"
                  reason={`People who watch ${name} also watch these channels`}
                  accent={<LiveDot />}
                >
                  {also.map((s, slot) => (
                    <StreamCard key={s._id} stream={toCard(s)} variant="badges" impression={{ streamId: s._id, surface: "channel", row: "also-watched", slot }} />
                  ))}
                </Shelf>
              )}

              {past.length === 0 && !liveStream && upcoming.length === 0 && (
                <EmptyBroadcasts name={name} />
              )}
            </>
          )}

          {tab === "videos" && (
            past.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
                {past.map((s, slot) => (
                  <StreamCard key={s._id} stream={toCard(s)} impression={{ streamId: s._id, surface: "channel", row: "videos", slot }} />
                ))}
              </div>
            ) : (
              <EmptyBroadcasts name={name} />
            )
          )}

          {tab === "schedule" && (
            <>
              <section>
                <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">Scheduled</h2>
                {upcoming.length > 0 ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
                    {upcoming.map((item, slot) => (
                      <UpcomingCard key={item._id} item={item} impression={{ streamId: item._id, surface: "channel", row: "schedule", slot }} />
                    ))}
                  </div>
                ) : (
                  <p className="rounded-sm border border-dashed border-white/[0.1] px-6 py-10 text-center text-sm text-muted-foreground/70">
                    Nothing on the calendar yet. Follow to hear the moment they go live.
                  </p>
                )}
              </section>

              {heat.total >= 3 && (
                <section>
                  <div className="mb-4 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold tracking-tight text-foreground">Usually streams</h2>
                    <span className="text-xs text-muted-foreground/60">From {heat.total} past broadcasts · your local time</span>
                  </div>
                  <div className="overflow-x-auto">
                    <div className="grid min-w-[520px] grid-cols-[3rem_repeat(7,minmax(0,1fr))] gap-1.5">
                      <span />
                      {DAYS.map((d) => (
                        <span key={d} className="text-center text-[0.65rem] font-medium tracking-wider text-muted-foreground/70 uppercase">{d}</span>
                      ))}
                      {["Night", "Morning", "Afternoon", "Evening"].map((label, block) => (
                        <div key={label} className="contents">
                          <span className="flex items-center text-[0.65rem] text-muted-foreground/70">{label}</span>
                          {DAYS.map((_, day) => {
                            const n = heat.grid[day][block];
                            const a = n / heat.max;
                            return (
                              <span
                                key={day}
                                title={`${DAYS[day]} ${label.toLowerCase()}: ${n} broadcast${n === 1 ? "" : "s"}`}
                                className="h-9 rounded-sm border border-white/[0.06]"
                                style={{ backgroundColor: n ? `rgba(220, 38, 38, ${0.15 + a * 0.6})` : "transparent" }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {tab === "about" && (
            <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <section>
                <h2 className="mb-3 text-sm font-semibold tracking-tight text-foreground">About {name}</h2>
                <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                  {channel.bio || `${name} hasn't written a bio yet.`}
                </p>
                {streams.length > 0 && (
                  <div className="mt-6">
                    <h3 className="mb-2 text-xs font-medium tracking-wider text-muted-foreground/70 uppercase">Streams about</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {[...new Set(streams.map((s) => s.category))].slice(0, 6).map((c) => (
                        <Link key={c} href={`/browse?category=${encodeURIComponent(c)}`} className="rounded-sm bg-white/[0.05] px-2.5 py-1 text-xs text-foreground/85 transition-colors hover:bg-white/[0.08]">
                          {c}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </section>
              <section className="grid grid-cols-2 gap-3">
                <Stat icon={Users} value={formatNumber(channel.followers)} label="Followers" />
                <Stat icon={Users} value={formatNumber(channel.following)} label="Following" />
                <Stat icon={Eye} value={formatNumber(peak)} label="Peak viewers" />
                <Stat icon={ChartBar} value={String(past.length)} label="Past broadcasts" />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Users; value: string; label: string }) {
  return (
    <div className="rounded-sm border border-white/[0.06] px-4 py-3">
      <p className="flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wider text-muted-foreground/70 uppercase">
        <Icon size={12} />
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
    </div>
  );
}

/** Somebody else's shelf: no Go live here, it isn't the viewer's stage. */
function EmptyBroadcasts({ name }: { name: string }) {
  return (
    <Empty
      goLive={false}
      className="rounded-sm border border-white/[0.06] py-14"
      icon={<VideoCamera size={32} />}
      title={`${name} hasn't streamed yet.`}
      body="Follow to get a notification when they go live."
    />
  );
}
