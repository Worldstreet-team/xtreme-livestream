"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Broadcast,
  CalendarBlank,
  ChartLineUp,
  Check,
  Eye,
  House,
  Info,
  SealCheck,
  ShareNetwork,
  Users,
  VideoCamera,
} from "@/components/icons";
import { StreamCard } from "@/components/app/stream-card";
import { EventCard } from "@/components/app/event-card";
import { RemindButton } from "@/components/app/upcoming-card";
import { FollowButton } from "@/components/app/follow-button";
import { MessageButton } from "@/components/app/message-button";
import { StreamArt } from "@/components/app/stream-art";
import { CallReceipts } from "@/components/app/call-receipts";
import { Empty } from "@/components/app/empty";
import { PillTabs } from "@/components/ui/tabs";
import { LiveBadge } from "@/components/ui/badge";
import { Pill, PillLink, pillClass } from "@/components/ui/pill";
import { Chip, ChipRow } from "@/components/xtream/chip";
import { LivePreview } from "@/components/app/live-preview";
import { Shelf, LiveDot } from "@/components/app/shelf";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { formatUptime, toCard, type RowItem } from "@/lib/discovery";
import { resetImpressions } from "@/lib/impressions";
import { fetchCalls, type CallsPage } from "@/lib/market-calls";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * A channel — the platform's unit of identity, and the public twin of
 * Your channel (/dashboard): the same masthead, tiles and rows, turned to
 * face a visitor. A stream is something a channel is doing right now;
 * everything durable about a streamer lives here.
 *
 * Live, the broadcast is the hero. Off air, the last broadcast leads beside
 * a solid Ember "Next up" — the booking with its countdown and a reminder,
 * or when they usually go live — so the page is never a dead end, and a
 * follow has something to wait for. The numbers sit in one line under the
 * name; the big tiles are the About tab's.
 */

type Tab = "home" | "videos" | "calls" | "schedule" | "about";
type Sort = "recent" | "top";

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
}

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PARTS = ["Night", "Morning", "Afternoon", "Evening"];
const PART_PHRASES = ["late at night", "in the morning", "in the afternoon", "in the evening"];

function timeAgo(iso: string, now: number) {
  const diff = now - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "less than an hour ago";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"} ago`;
  return `${Math.floor(d / 7)} weeks ago`;
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

/** "1:29:00" reads as minutes to some eyes; say the units. */
function spoken(duration: string | undefined) {
  if (!duration) return "";
  const parts = duration.split(":");
  if (parts.length === 3) return `${Number(parts[0])}h ${parts[1]}m`;
  if (parts.length === 2) return `${Number(parts[0])}m ${parts[1]}s`;
  return duration;
}

export default function ChannelPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = use(params);

  const [channel, setChannel] = useState<ChannelUser | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [streams, setStreams] = useState<RowItem[]>([]);
  const [also, setAlso] = useState<RowItem[]>([]);
  // Market calls (call receipts): null while switched off, or until they load.
  const [calls, setCalls] = useState<Extract<CallsPage, { enabled: true }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [sort, setSort] = useState<Sort>("recent");
  const [copied, setCopied] = useState(false);
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
      fetchCalls(username)
        .then((page) => setCalls(page.enabled ? page : null))
        .catch(() => setCalls(null));

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
  const videos = useMemo(
    () => (sort === "top" ? [...past].sort((a, b) => b.peakViewers - a.peakViewers) : past),
    [past, sort]
  );
  const nextUp = upcoming[0];
  const lastBroadcast = past[0];

  // When their past broadcasts started — weekday by part of the day. A
  // schedule you can read even when nothing is booked.
  const heat = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array<number>(4).fill(0));
    past.forEach((s) => {
      if (!s.startedAt) return;
      const d = new Date(s.startedAt);
      grid[(d.getDay() + 6) % 7]![Math.floor(d.getHours() / 6)]! += 1;
    });
    const days = grid.map((row) => row.reduce((a, b) => a + b, 0));
    let best = { day: 0, part: 0, n: 0 };
    grid.forEach((row, day) =>
      row.forEach((n, part) => {
        if (n > best.n) best = { day, part, n };
      })
    );
    // A habit rather than a one-off: the slot has two of their broadcasts,
    // or a third of them, out of at least three.
    const usual =
      past.length >= 3 && (best.n >= 2 || best.n / past.length >= 0.34)
        ? { day: best.day, part: best.part, phrase: `${DAY_NAMES[best.day]}s ${PART_PHRASES[best.part]}` }
        : null;
    return { grid, days, max: Math.max(1, ...grid.flat()), total: past.length, usual };
  }, [past]);

  // What they stream about, most-streamed first.
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    streams.forEach((s) => counts.set(s.category, (counts.get(s.category) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 5);
  }, [streams]);

  if (loading) return <ChannelSkeleton />;

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
  const peak = Math.max(liveStream?.peakViewers ?? 0, ...past.map((s) => s.peakViewers));
  const broadcasts = past.length + (liveStream ? 1 : 0);
  const watchHref = liveStream ? `/stream/${liveStream._id}` : null;
  // Off air with something to show, the masthead is a tile pair; on a phone
  // it follows the name rather than leading — who this is comes first.
  const offAirMasthead = !liveStream && Boolean(lastBroadcast || nextUp || heat.usual);

  /** The native share sheet where there is one; the clipboard, said out loud, where there isn't. */
  const share = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: name, text: `${name} on Xtream`, url }).catch(() => {});
      return;
    }
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  // Calls get a tab once there are some to show (and only while they're switched on).
  const callCount = calls?.summary?.total ?? 0;
  // None left to show while their tab is open (another channel's page, say): back to Home.
  if (tab === "calls" && callCount === 0) setTab("home");
  const TABS: [Tab, string, typeof House][] = [
    ["home", "Home", House],
    ["videos", "Videos", VideoCamera],
    ...(callCount > 0 ? [["calls", "Calls", ChartLineUp] as [Tab, string, typeof House]] : []),
    ["schedule", "Schedule", CalendarBlank],
    ["about", "About", Info],
  ];

  return (
    <div className="min-h-screen px-4 pt-4 pb-16 md:px-8 md:pt-6">
      <div className="mx-auto flex max-w-[1280px] flex-col">
        {/* ── Masthead ── */}
        {liveStream && watchHref ? (
          <LiveHero stream={liveStream} href={watchHref} now={now} />
        ) : (
          offAirMasthead && (
            <div className="order-2 mt-6 grid grid-cols-1 gap-3 md:order-1 md:mt-0 lg:grid-cols-12">
              {lastBroadcast && <LastLive stream={lastBroadcast} now={now} fallbackAt={channel.createdAt} className={cn("hidden md:block", nextUp || heat.usual ? "lg:col-span-8" : "lg:col-span-12")} />}
              {(nextUp || heat.usual) && (
                <NextUpTile
                  next={nextUp ?? null}
                  more={Math.max(0, upcoming.length - 1)}
                  usual={heat.usual}
                  days={heat.days}
                  now={now}
                  onMore={() => setTab("schedule")}
                  className={lastBroadcast ? "lg:col-span-4" : "lg:col-span-12"}
                />
              )}
            </div>
          )
        )}

        {/* ── Who this is ── */}
        <header
          className={cn(
            "flex flex-col items-center gap-5 text-center md:flex-row md:items-start md:justify-between md:gap-8 md:text-left",
            liveStream || offAirMasthead ? "mt-6 md:mt-8" : "mt-2 md:mt-4",
            offAirMasthead ? "order-1 md:order-2" : "order-2"
          )}
        >
          <div className="flex min-w-0 flex-col items-center gap-4 md:flex-row md:items-center md:gap-6">
            {watchHref ? (
              <Link href={watchHref} aria-label={`Watch ${name} live`} className="relative shrink-0">
                <UserAvatar src={channel.avatar} name={name} size={96} className="size-[88px] md:size-24" ring="live" />
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-[5px] bg-chili px-1.5 py-px text-[10px] font-bold tracking-[0.06em] text-white">
                  LIVE
                </span>
              </Link>
            ) : (
              <UserAvatar src={channel.avatar} name={name} size={96} className="size-[88px] md:size-24" />
            )}
            <div className="min-w-0">
              <h1 className="flex min-w-0 items-center justify-center gap-2 font-wide text-[clamp(1.75rem,3.4vw,2.6rem)] leading-[1.05] font-bold tracking-[-0.04em] md:justify-start">
                <span className="truncate">{name}</span>
                {channel.verified && (
                  <SealCheck size={22} weight="fill" className="shrink-0 text-sky-400" aria-label="Verified streamer" />
                )}
              </h1>
              <p className="mt-1.5 text-[14px] text-muted-foreground">@{channel.username}</p>
              <dl className="mt-3.5 flex items-start justify-center gap-7 md:justify-start md:gap-5">
                <Count value={channel.followers} label={channel.followers === 1 ? "follower" : "followers"} />
                {peak > 0 && <Count value={peak} label="peak viewers" />}
                <Count value={broadcasts} label={broadcasts === 1 ? "broadcast" : "broadcasts"} />
              </dl>
              {channel.bio && (
                <p className="mx-auto mt-3.5 line-clamp-3 max-w-[60ch] text-[14.5px] leading-relaxed text-foreground/75 md:mx-0">
                  {channel.bio}
                </p>
              )}
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center justify-center gap-2 md:w-auto md:shrink-0 md:flex-nowrap md:justify-end md:pt-2">
            {watchHref && (
              <PillLink href={watchHref} variant="live" size="lg" icon={<Broadcast size={18} weight="fill" />} className="w-full md:hidden">
                Watch live
              </PillLink>
            )}
            <FollowButton
              username={channel.username}
              initialFollowing={isFollowing}
              onChange={(next) =>
                setChannel((c) => (c ? { ...c, followers: Math.max(0, c.followers + (next ? 1 : -1)) } : c))
              }
            />
            <MessageButton username={channel.username} name={name} />
            <Pill variant="glass" iconOnly aria-label={copied ? "Link copied" : "Share channel"} title={copied ? "Link copied" : "Share"} onClick={share} icon={copied ? <Check size={16} weight="bold" className="text-ember-hi" /> : <ShareNetwork size={16} />} />
          </div>
        </header>

        {/* What they stream about — a way in, not a label. */}
        {topics.length > 0 && (
          // Centred under a centred phone header while it fits; from the start once it scrolls.
          <ChipRow label="Streams about" className="order-3 mt-5 justify-center-safe md:mt-6 md:justify-start">
            {topics.map((c) => (
              <Chip key={c} href={`/browse?category=${encodeURIComponent(c)}`} live={liveStream?.category === c}>
                {c}
              </Chip>
            ))}
          </ChipRow>
        )}

        <PillTabs
          className="order-4 mt-8"
          label="Channel"
          items={TABS.map(([id, label, Icon]) => ({
            id,
            label,
            icon: Icon,
            count: id === "videos" ? past.length : id === "schedule" ? upcoming.length : id === "calls" ? callCount : null,
          }))}
          value={tab}
          onChange={setTab}
        />

        <div className="order-5 mt-8 flex flex-col gap-10 md:gap-12">
          {tab === "home" && (
            <>
              {/* Live, the booking isn't in the masthead — list it here. Off
                  air, the first is on the Next up tile; the rest follow. */}
              {(liveStream ? upcoming : upcoming.slice(1)).length > 0 && (
                <Shelf
                  id="chan-events"
                  title={liveStream ? "Events" : "More events"}
                  reason={`Booked by ${name} — set a reminder and you're in the room when it starts`}
                >
                  {(liveStream ? upcoming : upcoming.slice(1)).map((item, slot) => (
                    <EventCard key={item._id} item={item} impression={{ streamId: item._id, surface: "channel", row: "upcoming", slot }} />
                  ))}
                </Shelf>
              )}

              {past.length > 0 && (
                <Shelf id="chan-recent" title="Recent broadcasts" reason={`The last ${Math.min(past.length, 12)} on ${name}'s channel`} peek>
                  {past.slice(0, 12).map((s, slot) => (
                    <StreamCard key={s._id} stream={toCard(s)} impression={{ streamId: s._id, surface: "channel", row: "recent", slot }} />
                  ))}
                </Shelf>
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

              {past.length === 0 && !liveStream && upcoming.length === 0 && <EmptyBroadcasts name={name} />}
            </>
          )}

          {tab === "videos" &&
            (past.length > 0 ? (
              <section aria-label="Past broadcasts">
                <ChipRow label="Sort broadcasts">
                  <Chip active={sort === "recent"} onClick={() => setSort("recent")}>
                    Most recent
                  </Chip>
                  <Chip active={sort === "top"} onClick={() => setSort("top")}>
                    Most watched
                  </Chip>
                </ChipRow>
                <div className="mt-5 grid grid-cols-1 gap-x-3 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {videos.map((s, slot) => (
                    <StreamCard key={s._id} stream={toCard(s)} impression={{ streamId: s._id, surface: "channel", row: "videos", slot }} />
                  ))}
                </div>
              </section>
            ) : (
              <EmptyBroadcasts name={name} />
            ))}

          {tab === "calls" && calls?.summary && callCount > 0 && (
            <CallReceipts username={channel.username} name={name} calls={calls.calls} next={calls.next} summary={calls.summary} now={now} />
          )}

          {tab === "schedule" && (
            <>
              <section aria-labelledby="chan-booked">
                <h2 id="chan-booked" className="mb-4 font-wide text-[20px] font-bold tracking-[-0.025em]">
                  Booked
                </h2>
                {upcoming.length > 0 ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {upcoming.map((item, slot) => (
                      <EventCard key={item._id} item={item} impression={{ streamId: item._id, surface: "channel", row: "schedule", slot }} />
                    ))}
                  </div>
                ) : (
                  <div className={cn(TILE, "px-6 py-8")}>
                    <p className="font-wide text-[18px] font-bold tracking-[-0.02em]">Nothing on the calendar yet.</p>
                    <p className="mt-1.5 text-[14px] text-muted-foreground">Follow and you&apos;ll hear the moment {name} goes live.</p>
                  </div>
                )}
              </section>

              {heat.total >= 3 && <HabitTile heat={heat} />}
            </>
          )}

          {tab === "about" && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <section className={cn(TILE, "flex flex-col p-6 md:p-7 lg:col-span-7")}>
                <p className={EYEBROW}>About {name}</p>
                <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-foreground/80">
                  {channel.bio || `${name} hasn't written a bio yet.`}
                </p>
                <dl className="mt-6 grid gap-3 border-t border-white/[0.06] pt-5 text-[14px]">
                  <div className="flex items-center gap-3">
                    <dt className="w-32 shrink-0 text-muted-foreground">On Xtream since</dt>
                    <dd className="font-semibold">{memberSince}</dd>
                  </div>
                  {heat.usual && (
                    <div className="flex items-center gap-3">
                      <dt className="w-32 shrink-0 text-muted-foreground">Usually live</dt>
                      <dd className="font-semibold">{heat.usual.phrase}</dd>
                    </div>
                  )}
                  {topics[0] && (
                    <div className="flex items-center gap-3">
                      <dt className="w-32 shrink-0 text-muted-foreground">Mostly streams</dt>
                      <dd className="min-w-0 truncate font-semibold">{topics[0]}</dd>
                    </div>
                  )}
                </dl>
              </section>
              <div className="grid grid-cols-2 gap-3 lg:col-span-5">
                <StatTile label="Followers" value={channel.followers} />
                <StatTile label="Following" value={channel.following} />
                <StatTile label="Peak viewers" value={peak} />
                <StatTile label="Broadcasts" value={broadcasts} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** A number and what it counts: stacked and centred on a phone, one line on a wide screen. */
function Count({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 md:flex-row md:items-baseline md:gap-1.5">
      <dd className="order-1 font-wide text-[18px] leading-none font-bold tracking-[-0.02em] tabular-nums md:text-[15px]">{formatNumber(value)}</dd>
      <dt className="order-2 text-[12.5px] text-muted-foreground md:text-[14px]">{label}</dt>
    </div>
  );
}

/** On air: the broadcast is the hero, muted, one tap from the room. */
function LiveHero({ stream, href, now }: { stream: RowItem; href: string; now: number }) {
  return (
    <Link href={href} className="group relative order-1 block aspect-video overflow-hidden rounded-xl bg-surface md:aspect-[21/8]">
      <LivePreview
        streamId={stream._id}
        fallbackSrc={stream.previewUrl ?? null}
        className="absolute inset-0"
        poster={<StreamArt src={stream.thumbnailUrl} category={stream.category} alt={stream.title} seed={stream._id + stream.title} size={{ w: 1280, h: 720 }} />}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30" />
      <div className="absolute top-3 left-3 flex items-center gap-1.5 md:top-4 md:left-4">
        <LiveBadge />
        <span className="obj rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold text-white tabular-nums">
          {formatUptime(stream.startedAt, now)}
        </span>
      </div>
      <span className="obj absolute top-3 right-3 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums md:top-4 md:right-4">
        <Eye size={13} />
        {formatNumber(stream.viewers)}
      </span>
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-4 md:p-6">
        <div className="min-w-0">
          <p className="truncate font-wide text-[17px] leading-tight font-bold tracking-[-0.02em] text-white md:text-[26px]">{stream.title}</p>
          <p className="mt-1 text-[12.5px] text-white/70 md:text-[14px]">{stream.category}</p>
        </div>
        {/* The whole picture is the link; this is its label. */}
        <span className={pillClass({ variant: "live", size: "lg", className: "hidden group-hover:brightness-110 md:inline-flex" })}>
          <Broadcast size={18} weight="fill" />
          Watch live
        </span>
      </div>
    </Link>
  );
}

/** Off air: their most recent self, dimmed and dated. */
function LastLive({ stream, now, fallbackAt, className }: { stream: RowItem; now: number; fallbackAt: string; className?: string }) {
  return (
    <Link href={`/stream/${stream._id}`} className={cn("group relative min-h-[300px] overflow-hidden rounded-xl bg-surface", className)}>
      <div className="absolute inset-0 opacity-55 transition-opacity duration-300 group-hover:opacity-70">
        <StreamArt src={stream.thumbnailUrl} category={stream.category} alt={stream.title} seed={stream._id + stream.title} size={{ w: 1280, h: 720 }} />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
      <span className="obj absolute top-4 left-4 rounded-full px-2.5 py-1 text-[11.5px] font-semibold text-white/90">
        Last live {timeAgo(stream.endedAt ?? stream.startedAt ?? fallbackAt, now)}
      </span>
      <div className="absolute inset-x-0 bottom-0 p-6">
        <p className="caps font-mono text-[10.5px] text-white/60">Last broadcast</p>
        <p className="mt-1.5 max-w-[40ch] truncate font-wide text-[24px] leading-tight font-bold tracking-[-0.025em] text-white">{stream.title}</p>
        <p className="mt-1.5 text-[13.5px] text-white/70 tabular-nums">
          {[spoken(stream.duration), stream.peakViewers ? `peaked at ${formatNumber(stream.peakViewers)} viewers` : "", stream.category].filter(Boolean).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

/**
 * What's next, on the one solid Ember surface: the booking and its
 * countdown with a reminder, or — nothing booked — when they usually go
 * live, with the week drawn small.
 */
function NextUpTile({
  next,
  more,
  usual,
  days,
  now,
  onMore,
  className,
}: {
  next: RowItem | null;
  more: number;
  usual: { day: number; phrase: string } | null;
  days: number[];
  now: number;
  onMore: () => void;
  className?: string;
}) {
  const busiest = Math.max(1, ...days);
  return (
    <div className={cn("relative isolate flex min-h-[260px] flex-col overflow-hidden rounded-xl bg-ember p-6 text-on-ember md:min-h-[300px] md:p-7", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="caps font-mono text-[10.5px] text-on-ember/70">{next ? "Next up" : "Usually live"}</p>
        {next && more > 0 && (
          <button type="button" onClick={onMore} className="press rounded-full bg-on-ember/10 px-2.5 py-1 text-[11.5px] font-semibold text-on-ember/85 hover:text-on-ember">
            +{more} more booked
          </button>
        )}
      </div>

      {next?.scheduledStartAt ? (
        <>
          <div className="mt-auto pt-6">
            {/* Past its time and not on yet: a booking runs late, it doesn't read "Now". */}
            {new Date(next.scheduledStartAt).getTime() <= now ? (
              <>
                <p className="font-money text-[clamp(2.1rem,3.4vw,2.75rem)] leading-none">Any minute</p>
                <p className="mt-1.5 text-[13px] text-on-ember/65">they&apos;re due on</p>
              </>
            ) : (
              <>
                <p className="font-money text-[clamp(2.75rem,5vw,4rem)] leading-none tabular-nums" suppressHydrationWarning>
                  {countdown(next.scheduledStartAt, now)}
                </p>
                <p className="mt-1.5 text-[13px] text-on-ember/65">until they&apos;re on</p>
              </>
            )}
            <p className="mt-5 line-clamp-2 font-wide text-[19px] leading-tight font-bold tracking-[-0.02em]">{next.title}</p>
            <p className="mt-1.5 text-[13.5px] text-on-ember/75" suppressHydrationWarning>
              {new Date(next.scheduledStartAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} ·{" "}
              {new Date(next.scheduledStartAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </p>
          </div>
          <div className="mt-6">
            <RemindButton streamId={next._id} initial={next.reminded ?? false} size="lg" onEmber />
          </div>
        </>
      ) : (
        usual && (
          <>
            <p className="mt-auto pt-6 font-wide text-[clamp(1.6rem,2.6vw,2.1rem)] leading-[1.05] font-bold tracking-[-0.035em] text-balance">
              {usual.phrase.charAt(0).toUpperCase() + usual.phrase.slice(1)}.
            </p>
            <p className="mt-2 text-[13.5px] text-on-ember/75">Nothing booked yet — follow to hear the moment they start.</p>
            {/* Their week, drawn small: how often each day has had them on. */}
            <div className="mt-6 grid grid-cols-7 gap-2" role="img" aria-label={days.map((n, i) => `${DAY_NAMES[i]}: ${n}`).join(", ")}>
              {days.map((n, i) => (
                <div key={DAYS[i]} className="flex flex-col items-center gap-1.5">
                  <div className="relative h-10 w-full">
                    <div
                      className={cn("absolute inset-x-0 bottom-0 rounded-[4px]", i === usual.day ? "bg-on-ember" : n ? "bg-on-ember/40" : "bg-on-ember/12")}
                      style={{ height: n ? `${24 + (n / busiest) * 76}%` : "3px" }}
                    />
                  </div>
                  <span className={cn("text-[11px] font-semibold", i === usual.day ? "text-on-ember" : "text-on-ember/60")}>{DAYS[i]!.charAt(0)}</span>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </div>
  );
}

/** When they tend to be on — weekday by part of the day, in the viewer's time. */
function HabitTile({ heat }: { heat: { grid: number[][]; max: number; total: number; usual: { day: number; part: number; phrase: string } | null } }) {
  return (
    <section className={cn(TILE, "p-6 md:p-7")} aria-labelledby="chan-habit">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={EYEBROW}>Usually live</p>
          <h2 id="chan-habit" className="mt-2 font-wide text-[22px] font-bold tracking-[-0.03em]">
            {heat.usual ? heat.usual.phrase.charAt(0).toUpperCase() + heat.usual.phrase.slice(1) : "No regular slot yet"}
          </h2>
        </div>
        <p className="text-[12.5px] text-muted-foreground">From {heat.total} past broadcasts · your local time</p>
      </div>
      <div className="mt-6 overflow-x-auto">
        <div className="grid min-w-[520px] grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] gap-1.5">
          <span />
          {DAYS.map((d) => (
            <span key={d} className="pb-1 text-center text-[11px] font-semibold text-muted-foreground">
              {d}
            </span>
          ))}
          {PARTS.map((label, part) => (
            <div key={label} className="contents">
              <span className="flex items-center text-[12px] text-muted-foreground">{label}</span>
              {DAYS.map((_, day) => {
                const n = heat.grid[day]![part]!;
                const best = heat.usual?.day === day && heat.usual.part === part;
                return (
                  <span
                    key={day}
                    title={`${DAY_NAMES[day]} ${label.toLowerCase()}: ${n} broadcast${n === 1 ? "" : "s"}`}
                    className={cn("h-10 rounded-[8px]", best ? "bg-ember" : n ? "" : "bg-white/[0.04]")}
                    style={n && !best ? { backgroundColor: `color-mix(in oklab, var(--color-ember) ${22 + (n / heat.max) * 50}%, transparent)` } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className={cn(TILE, "@container flex min-h-[132px] flex-col p-5 md:p-6")}>
      <p className={EYEBROW}>{label}</p>
      <p className="mt-auto pt-5 font-money text-[clamp(1.35rem,13cqw,2.4rem)] leading-none whitespace-nowrap tabular-nums">{formatNumber(value)}</p>
    </div>
  );
}

/** Somebody else's shelf: no Go live here, it isn't the viewer's stage. */
function EmptyBroadcasts({ name }: { name: string }) {
  return (
    <Empty
      goLive={false}
      className="rounded-panel bg-surface py-14"
      icon={<VideoCamera size={32} />}
      title={`${name} hasn't streamed yet.`}
      body="Follow to get a notification when they go live."
    />
  );
}

function ChannelSkeleton() {
  return (
    <div aria-busy className="min-h-screen animate-pulse px-4 pt-4 pb-16 md:px-8 md:pt-6">
      <div className="mx-auto max-w-[1280px]">
        <div className="aspect-video rounded-xl bg-surface md:aspect-[21/8]" />
        <div className="mt-8 flex flex-col items-center gap-5 md:flex-row">
          <div className="size-[88px] rounded-full bg-surface md:size-24" />
          <div className="flex flex-col items-center gap-3 md:items-start">
            <div className="h-8 w-56 rounded-[8px] bg-surface" />
            <div className="h-4 w-32 rounded-[6px] bg-surface" />
            <div className="h-4 w-72 rounded-[6px] bg-surface" />
          </div>
        </div>
      </div>
    </div>
  );
}
