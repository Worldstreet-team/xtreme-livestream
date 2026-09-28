"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Broadcast, SealCheck, Sparkle, Play, Trophy, ClockCounterClockwise, Sword, Ticket, Question, Coins } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import type { BattleView } from "@/lib/battles";
import { formatNumber } from "@/lib/categories";
import type { RowItem } from "@/lib/discovery";
import { GAME_LABEL, formatPoints, questionOf, type LiveGameItem } from "@/lib/games";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { PillLink } from "@/components/ui/pill";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";
import { TopGiftersBoard } from "@/components/app/top-gifters";
import { HighlightCard } from "@/components/app/highlight-card";
import { GiftMark, HighlightMark } from "@/components/app/art";
import { WolfIcon } from "@/components/ui/wolf-icon";
import { MarketSquareLockup } from "@/components/ui/market-mark";
import { WorldSpaceLockup } from "@/components/ui/worldspace-mark";
import { Tip } from "@/components/ui/tip";
import { PromoArt, type PromoArtId } from "@/components/app/promo-art/promo-art";

/**
 * The right rail — the column the socials app runs beside its feed, tuned
 * for live video. Top to bottom:
 *
 *  1. Stories: battles as merged rings (two faces in one capsule), games as
 *     badged rings, then the channels you follow, live ones first. Signed
 *     out, the biggest live rooms stand in.
 *  2. Spotlight: the house — live games, Market Square, Wolf of WorldStreet,
 *     WorldSpace, and Go live. No streams; the stories and rows do that.
 *  3. Continue watching, Top gifters (the podium), Top players, Highlight
 *     of the week, Who to follow. Battles show once, as merged rings in the
 *     stories; categories are the home's chips — neither repeats here.
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

/**
 * A section's title, set like the feed's shelf headers. `icon` is kept for
 * callers but not drawn; `mark` is one of our own drawn marks
 * (components/app/art), for the sections that carry art.
 */
function Eyebrow({ label, live, mark, trailing }: { icon?: ReactNode; label: string; live?: boolean; mark?: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-3">
      {mark}
      {live && (
        <span className="relative flex size-1.5 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-chili opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-chili" />
        </span>
      )}
      <h3 className="flex-1 font-wide text-[15px] font-bold tracking-[-0.02em] text-foreground">{label}</h3>
      {trailing}
    </div>
  );
}

function SeeAll({ href }: { href: string }) {
  return (
    <Link href={href} className="text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
      See all
    </Link>
  );
}

/** The small LIVE tag that sits under a live face, TikTok-style. */
function LiveTag({ className }: { className?: string }) {
  return (
    <span className={cn("absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[4px] bg-chili px-1 py-px text-[8px] leading-none font-bold tracking-[0.06em] text-white uppercase ring-2 ring-background", className)}>
      Live
    </span>
  );
}

function ago(iso: string, now: number) {
  const h = Math.max(1, Math.floor((now - new Date(iso).getTime()) / 3_600_000));
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

/** A live ring around one face. */
function Ring({ avatar, name, live, badge }: { avatar: string; name: string; live: boolean; badge?: ReactNode }) {
  return (
    <span className={cn("relative rounded-full p-[2.5px]", live ? "bg-heat" : "bg-tint/[0.12]")}>
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
    <span className="relative rounded-full bg-heat p-[2.5px]">
      <span className="flex rounded-full bg-background p-[2px]">
        <span className="relative z-10 rounded-full ring-2 ring-background">
          <UserAvatar src={a.avatar} name={a.name} size={52} className="size-[52px]" />
        </span>
        <span className="-ml-3 rounded-full">
          <UserAvatar src={b.avatar} name={b.name} size={52} className="size-[52px]" />
        </span>
      </span>
      <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[4px] bg-chili px-1 py-px text-[8px] font-bold tracking-wide text-white uppercase ring-2 ring-background">
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
  const [top, setTop] = useState<TopStreamer[]>([]);
  const [ended, setEnded] = useState<RowItem[]>([]);
  const [resume, setResume] = useState<ContinueItem[]>([]);
  const [battles, setBattles] = useState<BattleView[]>([]);
  const [games, setGames] = useState<LiveGameItem[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loadedAt, setLoadedAt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const get = <T,>(path: string) => apiFetch<{ success: boolean; data: T }>(path).then((r) => r.data).catch(() => null);
      const [l, s, e, bl, bu, gl, lb] = await Promise.all([
        get<{ streams: RowItem[] }>(`/api/streams?live=true&sort=viewers&limit=12`),
        get<{ streamers: TopStreamer[] }>(`/api/users/top?limit=8`),
        get<{ streams: RowItem[] }>(`/api/streams?status=ended&sort=recent&limit=48`),
        get<{ battles: BattleView[] }>(`/api/battles/live`),
        get<{ battles: BattleView[] }>(`/api/battles/upcoming`),
        get<{ items: LiveGameItem[] }>(`/api/games/live`),
        get<{ top: Player[] }>(`/api/games/leaderboard`),
      ]);
      if (cancelled) return;
      if (l) setLive(l.streams);
      if (s) setTop(s.streamers);
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
        .map((c) => ({ key: c.id, href: c.isLive && c.stream ? `/stream/${c.stream.id}` : `/c/${c.username}`, name: c.displayName || c.username, handle: c.username, avatar: c.avatar, live: c.isLive }));
    }
    const seen = new Set<string>();
    return live
      .filter((s) => (seen.has(s.streamerId.username) ? false : (seen.add(s.streamerId.username), true)))
      .slice(0, 12)
      .map((s) => ({ key: s._id, href: `/stream/${s._id}`, name: s.streamerId.displayName || s.streamerId.username, handle: s.streamerId.username, avatar: s.streamerId.avatar, live: true }));
  }, [isAuthenticated, followed, live]);

  const liveBattles = useMemo(() => battles.filter((b) => b.status === "live" || b.status === "overtime"), [battles]);
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
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-[340px] shrink-0 flex-col gap-8 overflow-y-auto bg-surface px-5 py-6 scrollbar-none 2xl:flex">
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
              <Tip key={`battle-${b.id}`} label={`Battle: ${b.host.displayName} vs ${b.challenger.displayName}`} side="bottom">
                <Link href={`/stream/${b.host.streamId}`} className="flex shrink-0 flex-col items-center gap-1.5">
                  <MergedRing a={{ avatar: b.host.avatar, name: b.host.displayName }} b={{ avatar: b.challenger.avatar, name: b.challenger.displayName }} />
                  <span className="w-24 truncate text-center text-[11px] text-muted-foreground">{b.host.displayName.split(" ")[0]} vs {b.challenger.displayName.split(" ")[0]}</span>
                </Link>
              </Tip>
            ))}
            {games.map(({ game, stream }) => (
              <Tip key={`game-${game.id}`} label={questionOf(game)} side="bottom">
              <Link href={`/stream/${stream.id}`} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                <Ring
                  avatar={stream.streamer.avatar}
                  name={stream.streamer.displayName}
                  live
                  badge={
                    <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-[4px] bg-ember px-1 py-px text-[8px] font-bold tracking-wide text-on-ember uppercase ring-2 ring-background">
                      {game.type === "raffle" ? <Ticket size={8} weight="fill" /> : game.type === "quiz" ? <Question size={8} weight="bold" /> : <Sparkle size={8} weight="fill" />}
                      {game.oracle ? "Vote" : game.type === "raffle" ? "Raffle" : game.type === "quiz" ? "Quiz" : "Predict"}
                    </span>
                  }
                />
                <span className="w-full truncate text-center text-[11px] font-medium text-foreground/80">{stream.streamer.username}</span>
              </Link>
              </Tip>
            ))}
            {stories.map((s) => (
              <Link key={s.key} href={s.href} className="flex w-16 shrink-0 flex-col items-center gap-1.5">
                <Ring
                  avatar={s.avatar}
                  name={s.name}
                  live={s.live}
                  badge={
                    s.live ? <LiveTag /> : undefined
                  }
                />
                <span className="w-full truncate text-center text-[11px] font-medium text-foreground/80">{s.handle}</span>
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

      {/* 4 · Continue watching */}
      {resume.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "150ms" }}>
          <Eyebrow icon={<ClockCounterClockwise size={13} weight="bold" />} label="Continue watching" trailing={<SeeAll href="/following" />} />
          <div className="flex flex-col gap-1.5">
            {resume.map(({ item, watchedAt, live: isLive }) => {
              const name = item.streamerId.displayName || item.streamerId.username;
              return (
                <Link key={item._id} href={isLive ? `/stream/${item._id}` : `/c/${item.streamerId.username}`} className="group flex items-center gap-3 rounded-sm px-1 py-1 transition-colors hover:bg-tint/[0.04]">
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

      {/* 6 · Top gifters this week — the podium */}
      <TopGiftersBoard
        className="animate-rise"
        heading={(seeAll) => <Eyebrow mark={<GiftMark />} label="Top gifters this week" trailing={seeAll} />}
      />

      {/* 7 · Top players */}
      {players.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "255ms" }}>
          <Eyebrow icon={<Trophy size={13} weight="fill" />} label="Top players this week" />
          <div className="flex flex-col">
            {players.map((p, i) => (
              <div key={p.userId} className="flex items-center gap-3 rounded-sm px-1 py-1.5">
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold tabular-nums", i === 0 ? "bg-ember text-on-ember" : "bg-tint/[0.08] text-muted-foreground")}>{i + 1}</span>
                <UserAvatar src={p.avatar} name={p.displayName} size={34} className="size-[34px]" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[13.5px] font-bold text-foreground">{p.username}</span>
                  <span className="truncate text-[11.5px] text-muted-foreground tabular-nums">{p.games} win{p.games === 1 ? "" : "s"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-foreground tabular-nums"><Coins size={12} weight="fill" className="text-ember-hi" />{formatPoints(p.won)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 8 · Highlight of the week */}
      {highlight && (
        <section className="animate-rise" style={{ animationDelay: "270ms" }}>
          <Eyebrow mark={<HighlightMark />} label="Highlight of the week" />
          <HighlightCard stream={highlight} />
        </section>
      )}

      {/* 9 · Who to follow — TikTok's flow: the handle leads, the nickname
          and followers under it, the face in a heat ring when they're on. */}
      {suggestions.length > 0 && (
        <section className="animate-rise" style={{ animationDelay: "300ms" }}>
          <Eyebrow label="Who to follow" trailing={<SeeAll href="/browse?tab=live" />} />
          <div className="flex flex-col gap-0.5 rounded-panel bg-surface p-1.5">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-control px-2 py-2 transition-colors hover:bg-tint/[0.03]">
                <Link href={`/c/${s.username}`} className="relative shrink-0">
                  <UserAvatar src={s.avatar} name={s.displayName || s.username} size={40} ring={s.isLive ? "live" : "none"} ringGapClassName="bg-surface" className={s.isLive ? undefined : "size-10"} />
                  {s.isLive && <LiveTag className="ring-surface" />}
                </Link>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <Link href={`/c/${s.username}`} className="flex items-center gap-1 truncate text-[14px] font-bold text-foreground hover:text-foreground/80">
                    <span className="truncate">{s.username}</span>
                    {s.verified && <SealCheck size={13} weight="fill" className="shrink-0 text-sky-400" />}
                  </Link>
                  <span className="mt-0.5 truncate text-[12px] text-muted-foreground tabular-nums">
                    {s.displayName} · {formatNumber(s.followers)}
                  </span>
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
 * One house slide, on the WorldSpace promo card's frame (its `PromoBanners`):
 * the socials' stone surface, Poppins for the title, a white pill CTA. Where
 * that card had the ambience photograph drifting behind a mark, ours has its
 * own drawn art (components/app/promo-art): the slide's first scene while it
 * waits, its story when it becomes the active slide, then a gentle life
 * until the carousel moves on. The brand's mark rides the art's corner.
 */
function HouseSlide({
  href,
  art,
  active,
  badge,
  headline,
  eyebrow,
  title,
  sub,
  cta,
  ctaClassName,
}: {
  href: string;
  art: PromoArtId;
  active: boolean;
  badge?: ReactNode;
  headline?: ReactNode;
  eyebrow?: string;
  title?: string;
  sub?: string;
  cta: string;
  ctaClassName?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" data-theme="dark" className="relative block h-[236px] w-[68%] shrink-0 overflow-hidden rounded-sm bg-[#1C1917] text-left">
      <span className="relative flex h-full flex-col p-3.5 text-[#FAFAF9]">
        <HouseArt art={art} active={active} badge={badge} />
        {headline && <span className="mt-1 block">{headline}</span>}
        {eyebrow && <span className="mt-1 block text-[9.5px] font-bold tracking-[0.14em] text-[#FAFAF9]/55 uppercase">{eyebrow}</span>}
        {title && <span className="mt-1 block font-poppins text-[15px] font-semibold leading-tight">{title}</span>}
        {sub && <span className="mt-0.5 block text-[11px] text-[#FAFAF9]/55">{sub}</span>}
        <span className={cn("mt-3 flex h-8 w-full shrink-0 items-center justify-center rounded-full bg-[#FAFAF9] text-[12px] font-semibold text-[#0C0A09]", ctaClassName)}>{cta}</span>
      </span>
    </a>
  );
}

/** The art's zone: whatever the copy leaves at the top of a house slide, the mark in its corner. */
function HouseArt({ art, active, badge }: { art: PromoArtId; active: boolean; badge?: ReactNode }) {
  return (
    <span className="relative -mx-1 -mt-1 block min-h-0 flex-1">
      <PromoArt piece={art} active={active} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {badge && <span className="absolute top-0 left-0 flex items-center">{badge}</span>}
    </span>
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
            <Link key={game.id} href={`/stream/${stream.id}`} className={cn(card, "justify-end bg-card")}>
              <StreamArt src={stream.thumbnailUrl} category={stream.category} alt="" seed={game.id} size={{ w: 480, h: 640 }} />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                <Badge variant="live" size="xs" icon={game.type === "raffle" ? <Ticket size={10} weight="fill" /> : game.type === "quiz" ? <Question size={10} weight="bold" /> : <Sparkle size={10} weight="fill" />} className="uppercase">
                  {game.oracle ? "Market vote" : GAME_LABEL[game.type]}
                </Badge>
              </div>
              <span className="relative line-clamp-2 text-[13.5px] font-semibold leading-snug">{questionOf(game)}</span>
              <span className="relative mt-1 truncate text-[11.5px] text-white/75">
                {stream.streamer.displayName} · {game.entries} {game.oracle ? "voted · Not financial advice" : "in"}
              </span>
              <span className={cn(cta, "relative bg-white text-neutral-950")}><Play size={12} weight="fill" />{game.oracle ? "Vote" : "Play"}</span>
            </Link>
          ))}

          {/* Market Square — the socials' own slide: the lockup is the headline, under its art. */}
          <HouseSlide
            href="https://tsionark.com"
            art="market"
            active={index === games.length}
            headline={<MarketSquareLockup markClassName="h-[20px] w-auto" wordClassName="font-poppins text-[17px] font-semibold leading-none" />}
            cta="Visit"
          />

          {/* Wolf of WorldStreet — the socials' own slide. */}
          <HouseSlide
            href="https://social.worldstreetgold.com/votes"
            art="wolf"
            active={index === games.length + 1}
            badge={<WolfIcon size={22} />}
            eyebrow="Competition"
            title="Wolf of WorldStreet"
            cta="Enter the pack"
          />

          {/* WorldSpace — the feed itself, in its own stone-and-cyan theme. */}
          <HouseSlide
            href="https://social.worldstreetgold.com"
            art="worldspace"
            active={index === games.length + 2}
            headline={<WorldSpaceLockup size={16} wordSize={12} className="gap-1.5" />}
            title="Where the conversation lives"
            sub="Every stream posts to the feed."
            cta="Open WorldSpace"
            ctaClassName="bg-[#22B8D6] text-[#0C0A09]"
          />

          {/* Go live: the call to action, on the same stone card. Its art is the
              story of going live, so it gets the room a line of small print took. */}
          <div data-theme="dark" className={cn(card, "bg-[#1C1917]")}>
            <HouseArt art="golive" active={index === games.length + 3} />
            <span className="mt-1 text-[9.5px] font-bold tracking-[0.14em] text-white/60 uppercase">Your turn</span>
            <span className="mt-1 text-[15px] font-semibold leading-tight">Go live in under a minute</span>
            <PillLink href="/studio" size="sm" variant="primary" className="mt-3 w-full shrink-0" icon={<Broadcast size={13} weight="fill" />}>
              Go live
            </PillLink>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-center gap-1.5">
        {Array.from({ length: count }).map((_, i) => (
          <button key={i} type="button" aria-label={i < games.length ? questionOf(games[i]!.game) : HOUSE[i - games.length]} aria-current={i === index} onClick={() => setIndex(i)} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-foreground" : "w-1.5 bg-tint/25 hover:bg-tint/45")} />
        ))}
      </div>
    </div>
  );
}
