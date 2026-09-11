"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Broadcast, Fire, UserPlus, Eye, SealCheck, Sparkle, Play, Gift, Trophy, ClockCounterClockwise, Sword, Ticket, Question, Coins } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatClock, hostShare, secondsLeft, type BattleView } from "@/lib/battles";
import { formatNumber } from "@/lib/categories";
import { categoryArt } from "@/lib/category-art";
import { formatStartsIn, type CategorySummary, type RowItem } from "@/lib/discovery";
import { GAME_LABEL, formatPoints, type LiveGameItem } from "@/lib/games";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { PillLink } from "@/components/ui/pill";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";
import { WolfIcon } from "@/components/ui/wolf-icon";
import { MarketSquareLockup } from "@/components/ui/market-mark";
import { WorldSpaceLockup } from "@/components/ui/worldspace-mark";

/**
 * The right rail — the column the socials app runs beside its feed, tuned
 * for live video. Top to bottom:
 *
 *  1. Stories: battles as merged rings (two faces in one capsule), games as
 *     badged rings, then the channels you follow, live ones first. Signed
 *     out, the biggest live rooms stand in.
 *  2. Spotlight: the house — live games, Market Square, Wolf of WorldStreet,
 *     WorldSpace, and Go live. No streams; the stories and rows do that.
 *  3. Battles, then Continue watching, Happening now, Top gifters, Top
 *     players, Highlight of the week, Who to follow.
 *
 * Flat eyebrows, no boxes: one column of content, not a stack of cards.
 */

const ROTATE_MS = 5500;
const REFRESH_MS = 45_000;
const WEEK_MS = 7 * 86_400_000;

interface FollowedRow {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  stream: { id: string; title: string; viewers: number; startedAt?: string } | null;
}
interface TopStreamer {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  followers: number;
  isLive: boolean;
  verified?: boolean;
}
interface Gifter {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  verified: boolean;
  totalUsdMinor: number;
  count: number;
}
interface ContinueItem {
  item: RowItem;
  watchedAt: string;
  live: boolean;
}
interface Player {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  verified: boolean;
  won: number;
  games: number;
}

function Eyebrow({ icon, label, live, trailing }: { icon?: ReactNode; label: string; live?: boolean; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-2.5">
      {icon && <span className="flex shrink-0 items-center text-muted-foreground/70">{icon}</span>}
      {live && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
      )}
      <h3 className="flex-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">{label}</h3>
      {trailing}
    </div>
  );
}

function SeeAll({ href }: { href: string }) {
  return (
    <Link href={href} className="text-[11px] font-semibold text-primary hover:underline">
      See all
    </Link>
  );
}

function ago(iso: string, now: number) {
  const h = Math.max(1, Math.floor((now - new Date(iso).getTime()) / 3_600_000));
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function usd(minor: number) {
  return minor >= 100_000 ? `$${(minor / 100_000).toFixed(1)}K` : `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)}`;
}

/** A live ring around one face. */
function Ring({ avatar, name, live, badge }: { avatar: string; name: string; live: boolean; badge?: ReactNode }) {
  return (
    <span className={cn("relative rounded-full p-[2.5px]", live ? "bg-gradient-to-br from-red-500 via-red-600 to-amber-500" : "bg-white/[0.12]")}>
      <span className="block rounded-full bg-background p-[2px]">
        <UserAvatar src={avatar} name={name} size={52} className="size-[52px]" />
      </span>
      {badge}
    </span>
  );
}

/**
 * Two faces in one ring: the ring is a capsule, so each face keeps its
 * outer curve and the two meet in the middle with no ring between them —
 * the "merged circles" a battle reads as.
 */
function MergedRing({ a, b }: { a: { avatar: string; name: string }; b: { avatar: string; name: string } }) {
  return (
    <span className="relative rounded-full bg-gradient-to-r from-red-500 via-amber-400 to-sky-400 p-[2.5px]">
      <span className="flex rounded-full bg-background p-[2px]">
        <span className="relative z-10 rounded-full ring-2 ring-background">
          <UserAvatar src={a.avatar} name={a.name} size={52} className="size-[52px]" />
        </span>
        <span className="-ml-3 rounded-full">
          <UserAvatar src={b.avatar} name={b.name} size={52} className="size-[52px]" />
        </span>
      </span>
      <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[4px] bg-red-600 px-1 py-px text-[8px] font-bold tracking-wide text-white uppercase ring-2 ring-background">
        <Sword size={8} weight="fill" />
        Battle
      </span>
    </span>
  );
}

export function RightRail() {
  const { isAuthenticated, user } = useAuth();
  const [followed, setFollowed] = useState<FollowedRow[]>([]);
  const [live, setLive] = useState<RowItem[]>([]);
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  const [top, setTop] = useState<TopStreamer[]>([]);
  const [gifters, setGifters] = useState<Gifter[]>([]);
  const [ended, setEnded] = useState<RowItem[]>([]);
  const [resume, setResume] = useState<ContinueItem[]>([]);
  const [battles, setBattles] = useState<BattleView[]>([]);
  const [games, setGames] = useState<LiveGameItem[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loadedAt, setLoadedAt] = useState(0);
  const tick = useNow(battles.some((b) => b.status === "live" || b.status === "overtime"));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const get = <T,>(path: string) => apiFetch<{ success: boolean; data: T }>(path).then((r) => r.data).catch(() => null);
      const [l, c, s, g, e, bl, bu, gl, lb] = await Promise.all([
        get<{ streams: RowItem[] }>(`/api/streams?live=true&sort=viewers&limit=12`),
        get<{ categories: CategorySummary[] }>(`/api/streams/categories`),
        get<{ streamers: TopStreamer[] }>(`/api/users/top?limit=8`),
        get<{ top: Gifter[] }>(`/api/gifts/leaderboard`),
        get<{ streams: RowItem[] }>(`/api/streams?status=ended&sort=recent&limit=48`),
        get<{ battles: BattleView[] }>(`/api/battles/live`),
        get<{ battles: BattleView[] }>(`/api/battles/upcoming`),
        get<{ items: LiveGameItem[] }>(`/api/games/live`),
        get<{ top: Player[] }>(`/api/games/leaderboard`),
      ]);
      if (cancelled) return;
      if (l) setLive(l.streams);
      if (c) setCategories(c.categories);
      if (s) setTop(s.streamers);
      if (g) setGifters(g.top);
      if (e) setEnded(e.streams);
      setBattles([...(bl?.battles ?? []), ...(bu?.battles ?? [])].slice(0, 3));
      if (gl) setGames(gl.items.slice(0, 4));
      if (lb) setPlayers(lb.top);
      setLoadedAt(Date.now());
    };
    void load();
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    const load = () =>
      Promise.all([
        apiFetch<{ success: boolean; data: { channels: FollowedRow[] } }>(`/api/user/me/following`).then((r) => r.data.channels).catch(() => null),
        apiFetch<{ success: boolean; data: { items: ContinueItem[] } }>(`/api/user/me/continue`).then((r) => r.data.items).catch(() => null),
      ]).then(([f, r]) => {
        if (cancelled) return;
        if (f) setFollowed(f);
        if (r) setResume(r);
      });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  // Stories: followed channels live first; signed out, the biggest rooms.
  const stories = useMemo(() => {
    if (isAuthenticated && followed.length > 0) {
      return [...followed]
        .sort((a, b) => Number(b.isLive) - Number(a.isLive) || (b.stream?.viewers ?? 0) - (a.stream?.viewers ?? 0))
        .slice(0, 12)
        .map((c) => ({ key: c.id, href: c.isLive && c.stream ? `/stream/${c.stream.id}` : `/c/${c.username}`, name: c.displayName || c.username, avatar: c.avatar, live: c.isLive }));
    }
    const seen = new Set<string>();
    return live
      .filter((s) => (seen.has(s.streamerId.username) ? false : (seen.add(s.streamerId.username), true)))
      .slice(0, 12)
      .map((s) => ({ key: s._id, href: `/stream/${s._id}`, name: s.streamerId.displayName || s.streamerId.username, avatar: s.streamerId.avatar, live: true }));
  }, [isAuthenticated, followed, live]);

  const liveBattles = useMemo(() => battles.filter((b) => b.status === "live" || b.status === "overtime"), [battles]);
  const busiest = useMemo(() => [...categories].sort((a, b) => b.viewers - a.viewers).slice(0, 6), [categories]);
  const followingIds = useMemo(() => new Set(followed.map((c) => c.id)), [followed]);
  const suggestions = useMemo(
    () => top.filter((s) => !followingIds.has(s.id) && s.username !== user?.username).slice(0, 4),
    [top, followingIds, user?.username]
  );
  const highlight = useMemo(() => {
    const since = loadedAt - WEEK_MS;
    return ended
      .filter((s) => s.endedAt && new Date(s.endedAt).getTime() >= since)
      .sort((a, b) => b.peakViewers - a.peakViewers)[0];
  }, [ended, loadedAt]);

  const hasStories = liveBattles.length + games.length + stories.length > 0;

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[340px] shrink-0 flex-col gap-8 overflow-y-auto px-5 py-6 scrollbar-none 2xl:flex">
      {/* 1 · Stories */}
      {hasStories && (
        <section className="animate-rise" style={{ animationDelay: "60ms" }}>
          <Eyebrow
            icon={<Broadcast size={13} weight="duotone" />}
            label={isAuthenticated && followed.length > 0 ? "Your channels" : "Live now"}
            live={liveBattles.length + games.length > 0 || stories.some((s) => s.live)}
            trailing={<SeeAll href={isAuthenticated ? "/following" : "/browse?tab=live"} />}
          />
          <div className="-mx-1 flex gap-3 overflow-x-auto px-1 py-1 scrollbar-none">
            {liveBattles.map((b) => (
              <Link key={`battle-${b.id}`} href={`/stream/${b.host.streamId}`} className="flex shrink-0 flex-col items-center gap-1.5" title={`${b.host.displayName} vs ${b.challenger.displayName}`}>
                <MergedRing a={{ avatar: b.host.avatar, name: b.host.displayName }} b={{ avatar: b.challenger.avatar, name: b.challenger.displayName }} />
                <span className="w-24 truncate text-center text-[11px] text-muted-foreground">{b.host.displayName.split(" ")[0]} vs {b.challenger.displayName.split(" ")[0]}</span>
              </Link>
            ))}
            {games.map(({ game, stream }) => (
              <Link key={`game-${game.id}`} href={`/stream/${stream.id}`} className="flex w-16 shrink-0 flex-col items-center gap-1.5" title={game.question}>
                <Ring
                  avatar={stream.streamer.avatar}
                  name={stream.streamer.displayName}
                  live
                  badge={
                    <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[4px] bg-amber-400 px-1 py-px text-[8px] font-bold tracking-wide text-neutral-950 uppercase ring-2 ring-background">
                      {game.type === "raffle" ? <Ticket size={8} weight="fill" /> : game.type === "quiz" ? <Question size={8} weight="bold" /> : <Sparkle size={8} weight="fill" />}
                      {game.type === "raffle" ? "Raffle" : game.type === "quiz" ? "Quiz" : "Predict"}
                    </span>
                  }
                />
                <span className="w-full truncate text-center text-[11px] text-muted-foreground">{stream.streamer.displayName}</span>
              </Link>
            ))}
            {stories.map((s) => (
              <Link key={s.key} href={s.href} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                <Ring
                  avatar={s.avatar}
                  name={s.name}
                  live={s.live}
                  badge={
                    s.live ? (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[4px] bg-red-600 px-1 py-px text-[8px] font-bold tracking-wide text-white uppercase ring-2 ring-background">Live</span>
                    ) : undefined
                  }
                />
                <span className="w-full truncate text-center text-[11px] text-muted-foreground">{s.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 2 · Spotlight: the house */}
      <section className="animate-rise" style={{ animationDelay: "120ms" }}>
        <Eyebrow icon={<Sparkle size={13} weight="fill" />} label="Spotlight" />
        <Spotlight games={games} />
      </section>

      {/* 3 · Battles: running first, then booked */}
      {battles.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "135ms" }}>
          <Eyebrow icon={<Sword size={13} weight="fill" />} label="Battles" live={liveBattles.length > 0} />
          <div className="flex flex-col gap-1.5">
            {battles.map((b) => {
              const isLive = b.status === "live" || b.status === "overtime";
              const share = hostShare(b);
              return (
                <Link key={b.id} href={isLive ? `/stream/${b.host.streamId}` : `/c/${b.host.username}`} className="group rounded-sm bg-white/[0.04] px-3 py-2.5 transition-colors hover:bg-white/[0.07]">
                  <div className="flex items-center gap-2">
                    <UserAvatar src={b.host.avatar} name={b.host.displayName} size={28} className="size-7 ring-2 ring-red-500" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">{b.host.displayName}</span>
                    <span className="text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">vs</span>
                    <span className="min-w-0 flex-1 truncate text-right text-[12.5px] font-medium text-foreground">{b.challenger.displayName}</span>
                    <UserAvatar src={b.challenger.avatar} name={b.challenger.displayName} size={28} className="size-7 ring-2 ring-sky-400" />
                  </div>
                  {isLive ? (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.12]">
                        <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500 to-amber-400" style={{ width: `${share * 100}%` }} />
                        <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-violet-500 to-sky-400" style={{ width: `${(1 - share) * 100}%` }} />
                      </div>
                      <span className="rounded-full bg-white px-1.5 py-px text-[10.5px] font-bold text-neutral-950 tabular-nums">{formatClock(secondsLeft(b, tick))}</span>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11px] text-muted-foreground">{b.scheduledAt ? formatStartsIn(b.scheduledAt, loadedAt) : "Booked"} · starts when both are live</p>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 4 · Continue watching */}
      {resume.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "150ms" }}>
          <Eyebrow icon={<ClockCounterClockwise size={13} weight="bold" />} label="Continue watching" trailing={<SeeAll href="/following" />} />
          <div className="flex flex-col gap-1.5">
            {resume.map(({ item, watchedAt, live: isLive }) => {
              const name = item.streamerId.displayName || item.streamerId.username;
              return (
                <Link key={item._id} href={isLive ? `/stream/${item._id}` : `/c/${item.streamerId.username}`} className="group flex items-center gap-3 rounded-sm px-1 py-1 transition-colors hover:bg-white/[0.04]">
                  <span className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded-[6px]">
                    <StreamArt src={item.thumbnailUrl} category={item.category} alt="" seed={item._id} size={{ w: 320, h: 180 }} />
                    {isLive && <LiveBadge size="xs" className="absolute top-1 left-1" />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[13px] font-medium text-foreground/90 group-hover:text-foreground">{item.title}</span>
                    <span className="truncate text-[11.5px] text-muted-foreground">
                      {name} · {isLive ? <span className="text-red-400">live now</span> : `watched ${ago(watchedAt, loadedAt)}`}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 5 · Happening now */}
      {busiest.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "180ms" }}>
          <Eyebrow icon={<Fire size={13} weight="fill" />} label="Happening now" trailing={<SeeAll href="/browse" />} />
          <div className="flex flex-col">
            {busiest.map((c, i) => (
              <Link key={c.category} href={`/browse?category=${encodeURIComponent(c.category)}`} className="group flex items-center gap-3 rounded-sm px-1 py-1.5 transition-colors hover:bg-white/[0.04]">
                <span className="w-4 shrink-0 text-center text-[11px] font-semibold text-muted-foreground/50 tabular-nums">{i + 1}</span>
                <span className="relative h-[52px] w-[39px] shrink-0 overflow-hidden rounded-[6px]">
                  <StreamArt src={categoryArt(c.category, { w: 156, h: 208 })} category={c.category} alt="" seed={c.category} size={{ w: 156, h: 208 }} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[13.5px] font-medium text-foreground/90 group-hover:text-foreground">{c.category}</span>
                  <span className="flex items-center gap-2 text-[11.5px] text-muted-foreground tabular-nums">
                    <span className="flex items-center gap-1"><Eye size={11} />{formatNumber(c.viewers)}</span>
                    <span className="flex items-center gap-1 text-red-400"><span className="size-1.5 rounded-full bg-red-500" />{c.live} live</span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 6 · Top gifters */}
      {gifters.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "240ms" }}>
          <Eyebrow icon={<Gift size={13} weight="fill" />} label="Top gifters this week" />
          <div className="flex flex-col">
            {gifters.map((g, i) => (
              <div key={g.userId} className="flex items-center gap-3 rounded-sm px-1 py-1.5">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums", i === 0 ? "bg-amber-400 text-neutral-950" : i === 1 ? "bg-neutral-300 text-neutral-950" : i === 2 ? "bg-amber-700 text-white" : "bg-white/[0.08] text-muted-foreground")}>{i + 1}</span>
                <UserAvatar src={g.avatar} name={g.displayName} size={34} className="size-[34px]" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="flex items-center gap-1 truncate text-[13.5px] font-medium text-foreground/90">
                    <span className="truncate">{g.displayName}</span>
                    {g.verified && <SealCheck size={12} weight="fill" className="shrink-0 text-sky-400" />}
                  </span>
                  <span className="truncate text-[11.5px] text-muted-foreground tabular-nums">{g.count} gift{g.count === 1 ? "" : "s"}</span>
                </span>
                <span className="shrink-0 text-[13px] font-semibold text-foreground tabular-nums">{usd(g.totalUsdMinor)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 7 · Top players */}
      {players.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "255ms" }}>
          <Eyebrow icon={<Trophy size={13} weight="fill" />} label="Top players this week" />
          <div className="flex flex-col">
            {players.map((p, i) => (
              <div key={p.userId} className="flex items-center gap-3 rounded-sm px-1 py-1.5">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums", i === 0 ? "bg-amber-400 text-neutral-950" : "bg-white/[0.08] text-muted-foreground")}>{i + 1}</span>
                <UserAvatar src={p.avatar} name={p.displayName} size={34} className="size-[34px]" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[13.5px] font-medium text-foreground/90">{p.displayName}</span>
                  <span className="truncate text-[11.5px] text-muted-foreground tabular-nums">{p.games} win{p.games === 1 ? "" : "s"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-foreground tabular-nums"><Coins size={12} weight="fill" className="text-amber-300" />{formatPoints(p.won)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 8 · Highlight of the week */}
      {highlight && (
        <section className="animate-rise" style={{ animationDelay: "270ms" }}>
          <Eyebrow icon={<Trophy size={13} weight="fill" />} label="Highlight of the week" />
          <Link href={`/c/${highlight.streamerId.username}`} className="group relative block aspect-video overflow-hidden rounded-sm bg-white/[0.03]">
            <StreamArt src={highlight.thumbnailUrl} category={highlight.category} alt={highlight.title} seed={highlight._id} size={{ w: 640, h: 360 }} imgClassName="transition-transform duration-500 group-hover:scale-[1.04]" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
            <Badge variant="glass" size="xs" icon={<Eye size={10} weight="bold" />} className="absolute top-2 left-2">
              {formatNumber(highlight.peakViewers)} peak
            </Badge>
            <span className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 p-3 text-white">
              <UserAvatar src={highlight.streamerId.avatar} name={highlight.streamerId.displayName || highlight.streamerId.username} size={28} className="size-7 shrink-0 ring-2 ring-white/20" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="line-clamp-1 text-[13px] font-semibold">{highlight.title}</span>
                <span className="truncate text-[11px] text-white/70">{highlight.streamerId.displayName || highlight.streamerId.username} · {highlight.category}</span>
              </span>
            </span>
          </Link>
        </section>
      )}

      {/* 9 · Who to follow */}
      {suggestions.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "300ms" }}>
          <Eyebrow icon={<UserPlus size={13} weight="bold" />} label="Who to follow" />
          <div className="flex flex-col gap-1">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-sm px-1 py-1.5">
                <Link href={`/c/${s.username}`} className="relative shrink-0">
                  <UserAvatar src={s.avatar} name={s.displayName || s.username} size={38} className="size-[38px]" />
                  {s.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-background" />}
                </Link>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <Link href={`/c/${s.username}`} className="flex items-center gap-1 truncate text-[13.5px] font-medium text-foreground/90 hover:text-foreground">
                    <span className="truncate">{s.displayName || s.username}</span>
                    {s.verified && <SealCheck size={12} weight="fill" className="shrink-0 text-sky-400" />}
                  </Link>
                  <span className="truncate text-[11.5px] text-muted-foreground tabular-nums">{formatNumber(s.followers)} followers{s.isLive ? " · Live" : ""}</span>
                </span>
                <FollowButton username={s.username} initialFollowing={false} size="sm" />
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-auto px-1 pt-2 text-[11px] text-muted-foreground/50">Xtream · a WorldStreet product</p>
    </aside>
  );
}

/**
 * One house slide, drawn on the WorldSpace promo card (its `PromoBanners`):
 * the socials' stone surface, the ambience photograph filling the card with
 * the mark riding its crisp top half, Poppins for the title, a white pill
 * CTA, and the soft flare sweeping across. Same card in both apps.
 */
function HouseSlide({ href, mark, eyebrow, title, sub, cta, ctaClassName }: { href: string; mark: ReactNode; eyebrow?: string; title?: string; sub?: string; cta: string; ctaClassName?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="shine-soft relative block h-[236px] w-[68%] shrink-0 overflow-hidden rounded-sm bg-[#1C1917] text-left">
      {/* eslint-disable-next-line @next/next/no-img-element -- static, pre-blurred, ~2KB */}
      <img src="/images/promo/ambience-dark.webp" alt="" aria-hidden="true" className="promo-amb" />
      <span className="relative flex h-full flex-col p-3.5 text-[#FAFAF9]">
        <span className="flex flex-1 items-center justify-center pb-1">{mark}</span>
        {eyebrow && <span className="block text-[9.5px] font-bold tracking-[0.14em] text-[#FAFAF9]/55 uppercase">{eyebrow}</span>}
        {title && <span className="mt-1 block font-poppins text-[15px] font-semibold leading-tight">{title}</span>}
        {sub && <span className="mt-0.5 block text-[11px] text-[#FAFAF9]/55">{sub}</span>}
        <span className={cn("mt-3 flex h-8 w-full items-center justify-center rounded-full bg-[#FAFAF9] text-[12px] font-semibold text-[#0C0A09]", ctaClassName)}>{cta}</span>
      </span>
    </a>
  );
}

/**
 * The rail's carousel: the house slides — plus whatever games are running —
 * a card and a half showing at a time, auto-advancing until hovered.
 */
function Spotlight({ games }: { games: LiveGameItem[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useRef(false);
  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  const HOUSE = ["Market Square", "Wolf of WorldStreet", "WorldSpace", "Go live"];
  const count = games.length + HOUSE.length;
  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);
  useEffect(() => {
    if (paused || reduce.current) return;
    const id = setInterval(next, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused, next]);

  const card = "relative flex h-[236px] w-[68%] shrink-0 flex-col overflow-hidden rounded-sm p-3.5 text-white";
  const cta = "mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold";

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <div className="overflow-hidden">
        <div className="flex gap-2.5 transition-transform duration-500 ease-[cubic-bezier(0.2,0,0,1)]" style={{ transform: `translateX(calc(${-index} * (68% + 0.625rem)))` }}>
          {games.map(({ game, stream }) => (
            <Link key={game.id} href={`/stream/${stream.id}`} className={cn(card, "justify-end bg-[#0e0e14]")}>
              <StreamArt src={stream.thumbnailUrl} category={stream.category} alt="" seed={game.id} size={{ w: 480, h: 640 }} />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                <Badge variant="live" size="xs" icon={game.type === "raffle" ? <Ticket size={10} weight="fill" /> : game.type === "quiz" ? <Question size={10} weight="bold" /> : <Sparkle size={10} weight="fill" />} className="uppercase">
                  {GAME_LABEL[game.type]}
                </Badge>
              </div>
              <span className="relative line-clamp-2 text-[13.5px] font-semibold leading-snug">{game.question}</span>
              <span className="relative mt-1 truncate text-[11.5px] text-white/75">{stream.streamer.displayName} · {game.entries} in</span>
              <span className={cn(cta, "relative bg-white text-neutral-950")}><Play size={12} weight="fill" />Play</span>
            </Link>
          ))}

          {/* Market Square — the socials' own slide: the lockup is the headline. */}
          <HouseSlide href="https://tsionark.com" mark={<MarketSquareLockup markClassName="h-[27px] w-auto" wordClassName="font-poppins text-[22px] font-semibold leading-none" />} cta="Visit" />

          {/* Wolf of WorldStreet — the socials' own slide. */}
          <HouseSlide
            href="https://social.worldstreetgold.com/votes"
            mark={<WolfIcon size={46} />}
            eyebrow="Competition"
            title="Wolf of WorldStreet"
            cta="Enter the pack"
          />

          {/* WorldSpace — the feed itself, in its own stone-and-cyan theme. */}
          <HouseSlide
            href="https://social.worldstreetgold.com"
            mark={<WorldSpaceLockup size={40} wordSize={20} />}
            eyebrow="The feed"
            title="Where the conversation lives"
            sub="Every stream posts to the feed."
            cta="Open WorldSpace"
            ctaClassName="bg-[#22B8D6] text-[#0C0A09]"
          />

          {/* Go live. */}
          <div className={cn(card, "justify-end bg-gradient-to-br from-red-600 via-red-700 to-[#3a0d0a]")}>
            <Broadcast size={40} weight="fill" className="absolute top-5 right-4 text-white/25" />
            <span className="text-[9.5px] font-bold tracking-[0.14em] text-white/60 uppercase">Your turn</span>
            <span className="mt-1 text-[15px] font-semibold leading-tight">Go live in under a minute</span>
            <span className="mt-0.5 text-[11px] text-white/70">Camera or OBS. Your followers get told the moment you start.</span>
            <PillLink href="/studio" size="sm" variant="primary" className="mt-3 w-full" icon={<Broadcast size={13} weight="fill" />}>
              Go live
            </PillLink>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-1.5">
        {Array.from({ length: count }).map((_, i) => (
          <button key={i} type="button" aria-label={i < games.length ? games[i]!.game.question : HOUSE[i - games.length]} aria-current={i === index} onClick={() => setIndex(i)} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-foreground" : "w-1.5 bg-white/25 hover:bg-white/45")} />
        ))}
      </div>
    </div>
  );
}
