"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, SealCheck, Play, CaretUp, CaretDown, Plus, ChatCircle, Gift, ShareFat } from "@phosphor-icons/react";
import { LivePreview } from "@/components/app/live-preview";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";
import { Empty } from "@/components/app/empty";
import { UserAvatar } from "@/components/ui/user-avatar";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { logImpression, resetImpressions } from "@/lib/impressions";
import type { HomePage, RowItem } from "@/lib/discovery";

/**
 * The vertical live feed: one stream at a time, full screen, muted preview,
 * swipe to the next. The single-item viewport is not an aesthetic choice —
 * it is the cleanest per-item signal there is: a swipe away before the
 * preview has settled is an unambiguous "not this". Preview-before-commit,
 * no pre-roll, tap to open the room.
 *
 * Items come from the rows engine in row order (followed, trending,
 * rising…), so the feed is the home page turned on its side — and the
 * exploration slots are tagged as such on every impression.
 */

interface FeedItem {
  item: RowItem;
  row: string;
  explore: boolean;
}

export default function FeedPage() {
  const [items, setItems] = useState<FeedItem[]>([]);
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
  }, [items.length]);

  useEffect(() => {
    const current = items[index];
    if (!current) return;
    logImpression({
      streamId: current.item._id,
      surface: "home",
      row: `feed:${current.row}`,
      slot: index,
      explore: current.explore,
    });
  }, [index, items]);

  const go = useCallback(
    (dir: 1 | -1) => {
      const el = trackRef.current;
      if (!el) return;
      const next = Math.max(0, Math.min(items.length - 1, index + dir));
      el.scrollTo({ top: next * el.clientHeight, behavior: "smooth" });
    },
    [index, items.length]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "j") go(1);
      if (e.key === "ArrowUp" || e.key === "k") go(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="fixed inset-0 z-30 bg-black md:left-[var(--rail-w,16rem)]">
      <div className="absolute top-4 left-4 z-20 flex items-center gap-3 md:top-6 md:left-6">
        <Link
          href="/explore"
          aria-label="Back to home"
          className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75"
        >
          <ArrowLeft size={18} weight="bold" />
        </Link>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white/90">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
          </span>
          Live feed
        </span>
      </div>

      {/* Desktop paging — phones just swipe. */}
      {items.length > 1 && (
        <div className="absolute top-1/2 right-4 z-20 hidden -translate-y-1/2 flex-col gap-2 md:flex">
          <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous stream" className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 disabled:opacity-30">
            <CaretUp size={18} weight="bold" />
          </button>
          <button type="button" onClick={() => go(1)} disabled={index >= items.length - 1} aria-label="Next stream" className="flex size-10 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 disabled:opacity-30">
            <CaretDown size={18} weight="bold" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-full items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      ) : items.length === 0 ? (
        <Empty
          onDark
          className="h-full"
          icon={<Play size={36} />}
          title="Nobody's live right now"
          body="Nothing to scroll through until someone starts — it could be you."
          action={{ label: "Browse categories", href: "/browse" }}
        />
      ) : (
        <div
          ref={trackRef}
          className="h-full snap-y snap-mandatory overflow-y-auto scrollbar-none"
          style={{ scrollSnapStop: "always" }}
        >
          {items.map((f, i) => (
            <Frame key={f.item._id} item={f.item} active={i === index} near={Math.abs(i - index) <= 1} position={`${i + 1} / ${items.length}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One frame of the feed, laid out the way Kick and TikTok lay out a live
 * card on a phone: the picture sits letterboxed in the middle of the screen
 * on an ambience of itself (a landscape stream is never stretched over a
 * portrait screen), the actions run down the right edge as a column of
 * round buttons, and the words sit bottom-left over a gradient. Desktop
 * keeps the picture full-height in a centred column.
 */
function Frame({
  item,
  active,
  near,
  position,
}: {
  item: RowItem;
  active: boolean;
  near: boolean;
  position: string;
}) {
  const name = item.streamerId.displayName || item.streamerId.username;
  const poster = <StreamArt src={item.thumbnailUrl} category={item.category} alt={item.title} seed={item._id + item.title} />;
  const room = `/stream/${item._id}`;

  const share = async () => {
    const url = `${window.location.origin}${room}`;
    try {
      if (navigator.share) await navigator.share({ title: item.title, url });
      else await navigator.clipboard.writeText(url);
    } catch {
      // Dismissed, or no clipboard: nothing to recover.
    }
  };

  return (
    <section className="relative h-full snap-start snap-always" aria-label={item.title}>
      {/* Ambience: the poster blown up and blurred behind the picture. */}
      <div className="absolute inset-0 overflow-hidden bg-black">
        {near && <div className="absolute -inset-10 scale-110 opacity-60 blur-3xl">{poster}</div>}
      </div>

      {/* The picture. The video only connects for the frame on screen;
          neighbours keep their poster warm so a swipe lands on an image. */}
      {/* Phones: the picture hangs just under the header, so the words and
          the action column sit in the dark below it, never over the video. */}
      <div className="absolute inset-x-0 top-[calc(4.25rem+env(safe-area-inset-top))] md:inset-0 md:mx-auto md:flex md:max-w-[min(100%,calc(100vh*9/16*1.9))] md:items-center md:justify-center">
        <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-black shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] md:absolute md:inset-0 md:aspect-auto md:rounded-none md:shadow-none">
          {active ? (
            <LivePreview streamId={item._id} poster={poster} fallbackSrc={item.previewUrl ?? null} className="absolute inset-0" />
          ) : near ? (
            <div className="absolute inset-0">{poster}</div>
          ) : (
            <div className="absolute inset-0 bg-black" />
          )}
        </div>
      </div>

      {/* Light falls off at both ends so chrome and copy read on any picture. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-black/90 via-black/55 to-transparent" />

      {/* Top right: where you are in the feed. */}
      <span className="absolute top-4 right-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white/85 tabular-nums md:top-6 md:right-20">
        {position}
      </span>

      {/* Right edge: the action column. */}
      <div className="absolute right-3 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-10 flex flex-col items-center gap-4 md:right-6 md:bottom-10">
        <Link href={`/c/${item.streamerId.username}`} className="relative" aria-label={`${name}'s channel`}>
          <UserAvatar src={item.streamerId.avatar} name={name} size={48} className="size-12 ring-2 ring-red-500" />
          <span className="absolute -bottom-1.5 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full bg-red-600 text-white ring-2 ring-black">
            <Plus size={11} weight="bold" />
          </span>
        </Link>
        <Action icon={<Eye size={22} weight="fill" />} label={formatNumber(item.viewers)} href={room} title="Watching now" />
        <Action icon={<ChatCircle size={22} weight="fill" />} label="Chat" href={room} title="Open the chat" />
        <Action icon={<Gift size={22} weight="fill" />} label="Gift" href={`${room}?gift=1`} title="Send a gift" />
        <Action icon={<ShareFat size={22} weight="fill" />} label="Share" onClick={share} title="Share this stream" />
      </div>

      {/* Bottom left: the words. */}
      <div className="absolute inset-x-0 bottom-0 pr-20 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pl-4 text-white md:mx-auto md:max-w-3xl md:px-8 md:pb-8">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-[4px] bg-red-600 px-1.5 py-0.5 text-[10.5px] font-bold tracking-wide">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-white" />
            </span>
            LIVE
          </span>
          <Link href={`/browse?category=${encodeURIComponent(item.category)}`} className="truncate rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[10.5px] font-semibold text-white/90">
            {item.category}
          </Link>
        </div>
        <Link href={`/c/${item.streamerId.username}`} className="mt-2.5 flex items-center gap-1.5 text-[15px] font-semibold">
          <span className="truncate">{name}</span>
          {item.streamerId.verified && <SealCheck size={14} weight="fill" className="shrink-0 text-sky-400" />}
        </Link>
        <Link href={room} className="mt-1 block">
          <h2 className="line-clamp-2 text-[15px] leading-snug text-white/90">{item.title}</h2>
        </Link>
        {item.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-[4px] bg-black/55 px-1.5 py-0.5 text-[10.5px] font-medium text-white/75">
                {tag}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-2">
          <Link href={room} className="flex h-10 items-center gap-2 rounded-full bg-red-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-red-700">
            <Play size={13} weight="fill" />
            Watch
          </Link>
          <FollowButton username={item.streamerId.username} initialFollowing={false} size="sm" className="h-10 rounded-full bg-black/55 px-4 text-white hover:bg-black/75" />
        </div>
      </div>
    </section>
  );
}

/** One round button in the frame's action column, with its word under it. */
function Action({ icon, label, href, onClick, title }: { icon: ReactNode; label: string; href?: string; onClick?: () => void; title: string }) {
  const face = (
    <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75">
      {icon}
    </span>
  );
  const word = <span className="text-[11px] font-semibold text-white/85 tabular-nums">{label}</span>;
  if (href) {
    return (
      <Link href={href} title={title} className="flex flex-col items-center gap-1">
        {face}
        {word}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className="flex flex-col items-center gap-1">
      {face}
      {word}
    </button>
  );
}
