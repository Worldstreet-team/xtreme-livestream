"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CaretDown, CaretUp, ChatCircle, Check, Eye, Gift, Play, Plus, SealCheck, ShareFat } from "@/components/icons";
import { LivePreview } from "@/components/app/live-preview";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";
import { Empty } from "@/components/app/empty";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { CapsuleTabs } from "@/components/ui/capsule-tabs";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { logImpression, resetImpressions } from "@/lib/impressions";
import type { HomePage, RowItem } from "@/lib/discovery";
import { cn } from "@/lib/utils";

/**
 * The vertical live feed: one stream at a time, full screen, muted preview,
 * swipe to the next. The single-item viewport is not an aesthetic choice —
 * it is the cleanest per-item signal there is: a swipe away before the
 * preview has settled is an unambiguous "not this". Preview-before-commit,
 * no pre-roll, tap to open the room.
 *
 * Items come from the rows engine in row order (followed, trending,
 * rising…), so the feed is the home page turned on its side — and the
 * exploration slots are tagged as such on every impression. "Following"
 * narrows it to the channels you follow that are on right now.
 *
 * Afterglow pass (owner, 2026-09-24: "touch up our live feed section to
 * match our new modern design"): on desktop the picture is framed and
 * centred over an ambience of itself, the words sit on the picture and the
 * actions stand beside it; phones keep the picture under the header with
 * the words and actions in the dark below.
 */

interface FeedItem {
  item: RowItem;
  row: string;
  explore: boolean;
}

type Tab = "for-you" | "following";

export default function FeedPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [tab, setTab] = useState<Tab>("for-you");
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resetImpressions();
    apiFetch<{ success: boolean; data: HomePage }>(`/api/home`)
      .then((res) => {
        const seen = new Set<string>();
        const out: FeedItem[] = [];
        for (const row of res.data.rows) {
          if (row.kind !== "streams") continue;
          for (const item of row.items) {
            if (!item.isLive || seen.has(item._id)) continue;
            seen.add(item._id);
            out.push({ item, row: row.id, explore: row.explore ?? false });
          }
        }
        setItems(out);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const following = useMemo(() => items.filter((f) => f.row === "followed-live"), [items]);
  const shown = tab === "following" ? following : items;

  const pickTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    setIndex(0);
    trackRef.current?.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };

  // Track which frame is on screen from the scroller itself, so touch swipes,
  // keyboard and buttons all end up in the same place.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollTop / el.clientHeight);
      setIndex((prev) => (prev === i ? prev : i));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [shown.length]);

  useEffect(() => {
    const current = shown[index];
    if (!current) return;
    logImpression({
      streamId: current.item._id,
      surface: "home",
      row: `feed:${current.row}`,
      slot: index,
      explore: current.explore,
    });
  }, [index, shown]);

  const go = (to: number) => {
    const el = trackRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(shown.length - 1, to));
    el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
  };

  // Arrow keys (and j/k) page the feed; the scroller itself says where we are.
  const count = shown.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
      const el = trackRef.current;
      if (!dir || !el) return;
      const at = Math.round(el.scrollTop / el.clientHeight);
      const next = Math.max(0, Math.min(count - 1, at + dir));
      el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count]);

  return (
    <div className="fixed inset-0 z-30 bg-black md:left-[var(--rail-w,16rem)]">
      {/* Header: the way back and which feed — no counter, no indicator
          (owner, 2026-09-25: "why am i even seeing indicator in the live
          feed or count?"). The arrows are the only way-finding. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-6 md:pt-6">
        <Link href="/explore" aria-label="Back to home" className="obj press pointer-events-auto flex size-10 items-center justify-center rounded-full text-white">
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <p className="font-wide text-[15px] font-bold tracking-[-0.01em] text-white">Live feed</p>
        {following.length > 0 && (
          <CapsuleTabs
            onDark
            label="Which feed"
            className="pointer-events-auto md:absolute md:left-1/2 md:-translate-x-1/2"
            items={[
              { id: "for-you" as const, label: "For you" },
              { id: "following" as const, label: "Following" },
            ]}
            value={tab}
            onChange={pickTab}
          />
        )}
      </div>

      {/* Desktop: the way up and down — just the arrows (owner, 2026-09-24). */}
      {shown.length > 1 && (
        <div className="absolute top-1/2 right-5 z-20 hidden -translate-y-1/2 flex-col items-center gap-2.5 md:flex">
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous stream" className="obj press flex size-10 items-center justify-center rounded-full text-white disabled:pointer-events-none disabled:opacity-30">
            <CaretUp size={17} weight="bold" />
          </button>
          <button type="button" onClick={() => go(index + 1)} disabled={index >= shown.length - 1} aria-label="Next stream" className="obj press flex size-10 items-center justify-center rounded-full text-white disabled:pointer-events-none disabled:opacity-30">
            <CaretDown size={17} weight="bold" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-full items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : shown.length === 0 ? (
        tab === "following" ? (
          <Empty onDark className="h-full" icon={<Play size={36} />} title="Nobody you follow is live" body="The moment one of them starts, they're first in this feed." action={{ label: "Back to For you", href: "/feed" }} />
        ) : (
          <Empty onDark className="h-full" icon={<Play size={36} />} title="Nobody's live right now" body="Nothing to scroll through until someone starts — it could be you." action={{ label: "Browse categories", href: "/browse" }} />
        )
      ) : (
        <div ref={trackRef} className="h-full snap-y snap-mandatory overflow-y-auto scrollbar-none" style={{ scrollSnapStop: "always" }}>
          {shown.map((f, i) => (
            <Frame key={f.item._id} item={f.item} active={i === index} near={Math.abs(i - index) <= 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One frame of the feed. Phones: the picture hangs under the header on an
 * ambience of its own poster (a landscape stream is never stretched over a
 * portrait screen), the actions run down the right edge and the words sit
 * in the dark below it. Desktop: the picture framed and centred, the words
 * on it, the actions standing beside it.
 */
function Frame({ item, active, near }: { item: RowItem; active: boolean; near: boolean }) {
  const name = item.streamerId.displayName || item.streamerId.username;
  const poster = <StreamArt src={item.thumbnailUrl} category={item.category} alt={item.title} seed={item._id + item.title} />;
  const room = `/stream/${item._id}`;
  const channel = `/c/${item.streamerId.username}`;
  const [copied, setCopied] = useState(false);

  const share = async () => {
    const url = `${window.location.origin}${room}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }
    } catch {
      // Dismissed, or no clipboard: nothing to recover.
    }
  };

  const words = (
    <div className="text-white">
      <div className="flex flex-wrap items-center gap-2">
        <LiveBadge size="md" />
        <Link href={`/browse?category=${encodeURIComponent(item.category)}`} className="press">
          <Badge variant="glass" size="md">
            {item.category}
          </Badge>
        </Link>
      </div>
      <Link href={channel} className="mt-3 flex w-fit max-w-full items-center gap-2">
        <span className="truncate font-wide text-[18px] font-bold tracking-[-0.02em] md:text-[20px]">{name}</span>
        {item.streamerId.verified && <SealCheck size={16} weight="fill" className="shrink-0 text-sky-400" aria-label="Verified" />}
      </Link>
      <Link href={room} className="mt-1 block">
        <h2 className="line-clamp-2 max-w-[62ch] text-[15px] leading-snug text-white/85 md:text-[16px]">{item.title}</h2>
      </Link>
      {item.tags.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {item.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full bg-white/[0.1] px-2.5 py-0.5 text-[11.5px] font-semibold text-white/80">
              #{tag}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <Link href={room} className="press flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-semibold text-[#0b0708]">
          <Play size={14} weight="fill" />
          Watch live
        </Link>
        <FollowButton username={item.streamerId.username} initialFollowing={false} size="sm" className="obj h-11 rounded-full px-5 text-white hover:bg-black/70" />
      </div>
    </div>
  );

  const actions = (
    <div className="flex flex-col items-center gap-4">
      <Link href={channel} className="press relative mb-1" aria-label={`${name}'s channel`}>
        <UserAvatar src={item.streamerId.avatar} name={name} size={48} ring="live" ringGapClassName="bg-black" />
        <span className="absolute -bottom-1.5 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full bg-chili text-white ring-2 ring-black">
          <Plus size={11} weight="bold" />
        </span>
      </Link>
      <Action icon={<Eye size={21} weight="fill" />} label={formatNumber(item.viewers)} href={room} title="Watching now" mono />
      <Action icon={<ChatCircle size={21} weight="fill" />} label="Chat" href={room} title="Open the chat" />
      <Action icon={<Gift size={21} weight="fill" />} label="Gift" href={`${room}?gift=1`} title="Send a gift" />
      <Action icon={copied ? <Check size={20} weight="bold" /> : <ShareFat size={21} weight="fill" />} label={copied ? "Copied" : "Share"} onClick={share} title="Share this stream" />
    </div>
  );

  return (
    <section className="relative h-full snap-start snap-always overflow-hidden" aria-label={item.title}>
      {/* Ambience: the poster blown up, blurred and dimmed behind the picture. */}
      <div className="absolute inset-0 overflow-hidden bg-black">
        {near && <div className="absolute -inset-10 scale-110 opacity-55 blur-3xl">{poster}</div>}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(0,0,0,0.55)_75%)]" />
      </div>

      {/* The picture — one player per frame, placed by breakpoint. The video
          only connects for the frame on screen; neighbours keep their poster
          warm so a swipe lands on an image. */}
      <div className="absolute inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] md:inset-0 md:flex md:items-center md:justify-center md:gap-6 md:px-24 md:pt-20 md:pb-10">
        <div className="relative aspect-video w-full overflow-hidden bg-black shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] md:max-w-[min(1120px,calc((100dvh-8rem)*16/9))] md:rounded-[20px] md:shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)]">
          {active ? (
            <LivePreview streamId={item._id} poster={poster} fallbackSrc={item.previewUrl ?? null} className="absolute inset-0" />
          ) : near ? (
            <div className="absolute inset-0">{poster}</div>
          ) : (
            <div className="absolute inset-0 bg-black" />
          )}
          {/* Desktop: the words on the picture, over a fall of shadow. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-3/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent md:block" />
          <div className="absolute inset-x-0 bottom-0 hidden p-6 md:block lg:p-8">{words}</div>
        </div>
        <div className="hidden shrink-0 self-end pb-2 md:block">{actions}</div>
      </div>

      {/* Phones: light falls off at both ends; the words and actions sit in the dark. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent md:hidden" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/90 via-black/55 to-transparent md:hidden" />
      <div className="absolute right-3 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-10 md:hidden">{actions}</div>
      <div className="absolute inset-x-0 bottom-0 pr-20 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pl-4 md:hidden">{words}</div>
    </section>
  );
}

/** One round button in the action column, with its word under it. */
function Action({ icon, label, href, onClick, title, mono = false }: { icon: ReactNode; label: string; href?: string; onClick?: () => void; title: string; mono?: boolean }) {
  const face = <span className="obj flex size-12 items-center justify-center rounded-full text-white transition-colors hover:bg-black/70">{icon}</span>;
  const word = <span className={cn("text-[11.5px] font-semibold text-white/85", mono && "font-mono tabular-nums")}>{label}</span>;
  if (href) {
    return (
      <Link href={href} title={title} className="press flex flex-col items-center gap-1">
        {face}
        {word}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className="press flex flex-col items-center gap-1">
      {face}
      {word}
    </button>
  );
}
