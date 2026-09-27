"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StreamCard } from "@/components/app/stream-card";
import { apiFetch, apiUrl } from "@/lib/api-client";
import type { Category, Stream } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { EMBER_ON_PAPER, GUTTER, INK_MUTED, PAPER, SECTION_Y, ChapterTitle } from "./story-ui";
import styles from "./landing.module.css";

interface APIStream {
  _id: string;
  title: string;
  category: string;
  tags?: string[];
  thumbnailUrl: string | null;
  isLive: boolean;
  viewers: number;
  peakViewers?: number;
  startedAt: string;
  duration: string;
  streamerId: { _id: string; username: string; displayName: string; avatar: string; isLive: boolean; verified?: boolean };
  guests?: Array<{ username: string; avatar: string; status: "requested" | "live" }>;
}

function toStream(s: APIStream): Stream {
  return {
    id: s._id,
    title: s.title,
    category: s.category as Category,
    tags: s.tags ?? [],
    thumbnailUrl: apiUrl(s.thumbnailUrl),
    liveGuests: (s.guests ?? []).filter((g) => g.status === "live").map((g) => ({ username: g.username, avatar: g.avatar })),
    isLive: s.isLive,
    viewers: s.viewers,
    peakViewers: s.peakViewers,
    startedAt: s.startedAt,
    duration: s.duration,
    streamer: {
      id: s.streamerId._id,
      username: s.streamerId.username,
      displayName: s.streamerId.displayName,
      avatar: s.streamerId.avatar,
      isLive: s.streamerId.isLive,
      verified: s.streamerId.verified ?? false,
    },
  };
}

/** The kinds of room, each a door into Browse filtered to what's live. */
const ROOMS: Array<{ category: string; label: string; image: string }> = [
  { category: "Crypto Markets", label: "Markets", image: "/images/stage/streamer.webp" },
  { category: "Football (Soccer)", label: "Football", image: "/images/stage/deck.webp" },
  { category: "Electronic & Dance", label: "DJs", image: "/images/stage/dj.webp" },
  { category: "Afrobeats & Amapiano", label: "Amapiano", image: "/images/stage/p-performer.webp" },
  { category: "Esports", label: "Esports", image: "/images/stage/p-group.webp" },
  { category: "Just Chatting", label: "Just chatting", image: "/images/stage/film.webp" },
  { category: "Memecoins & Degen", label: "Memecoins", image: "/images/stage/p-streamer.webp" },
  { category: "Food & Cooking", label: "Kitchens", image: "/images/stage/group.webp" },
];

const roomHref = (category: string) => `/browse?tab=live&category=${encodeURIComponent(category)}`;

/**
 * Tonight on Xtream: the only place the landing page shows streams, and
 * only real ones: what's live right now, most-watched first, on the same
 * StreamCard the app uses. The deck drifts sideways and stops when you
 * reach for it; its second copy (the seamless loop) is inert.
 *
 * When nobody's live it says so plainly; either way, with nothing to show
 * (or the API unreachable) it shows the kinds of room instead: pictures and
 * names, no invented viewer counts, each a door into Browse.
 */
export function Tonight() {
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: { streams: APIStream[] } }>("/api/streams?live=true&sort=viewers&limit=10")
      .then((res) => !cancelled && setStreams((res.data?.streams ?? []).map(toStream)))
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setStreams([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const liveCount = streams?.length ?? 0;
  // Enough to fill a drifting deck; fewer sit still in a row.
  const drift = liveCount >= 5;

  return (
    <section aria-labelledby="tonight-title" className={cn("overflow-hidden", PAPER, SECTION_Y)}>
      <div className={cn("mx-auto flex max-w-[90rem] flex-col items-center gap-5 text-center", GUTTER)}>
        <p className={cn("caps font-mono text-[12px]", EMBER_ON_PAPER)}>Tonight on Xtream</p>
        <ChapterTitle id="tonight-title" lines={["Every kind of room."]} />
        <p className={cn("max-w-[40rem] text-[17px] leading-[1.55]", INK_MUTED)}>
          {streams === null || liveCount > 0 || failed
            ? "Markets and memecoins, football and fight nights, DJs, kitchens and the city at 2am."
            : "Nobody's live this minute, which means the first stream of the night could be yours."}
        </p>
        <nav data-stage aria-label="Rooms" className="mt-6 flex max-w-full flex-wrap justify-center gap-2">
          <Link href="/browse?tab=live" className="press rounded-full bg-[#0b0708] px-[18px] py-2.5 text-[14px] font-semibold text-white">
            All live
          </Link>
          {ROOMS.map((r) => (
            <Link
              key={r.category}
              href={roomHref(r.category)}
              className="press rounded-full bg-black/[0.07] px-[18px] py-2.5 text-[14px] font-semibold transition-colors hover:bg-black/[0.12]"
            >
              {r.label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="mt-14">
        {streams === null && (
          <div className={cn("mx-auto grid max-w-[90rem] gap-5 sm:grid-cols-2 lg:grid-cols-4", GUTTER)}>
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-sm bg-black/[0.07]" />
            ))}
          </div>
        )}

        {streams !== null && liveCount > 0 && (
          <div className={cn(!drift && cn("mx-auto max-w-[90rem]", GUTTER))}>
            <ul data-stage className={cn("flex w-max gap-5 text-foreground", drift ? cn(styles.marquee, "pl-5") : "flex-wrap")}>
              {(drift ? [...streams, ...streams] : streams).map((s, i) => (
                <li
                  key={`${s.id}-${i}`}
                  inert={drift && i >= liveCount ? true : undefined}
                  className="w-[20rem] rounded-panel bg-[#0b0708] p-3 sm:w-[22rem]"
                >
                  <StreamCard stream={s} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {streams !== null && liveCount === 0 && (
          <ul data-stage className={cn("flex w-max gap-5", styles.marquee, "pl-5")}>
            {[...ROOMS, ...ROOMS].map((r, i) => (
              <li key={`${r.category}-${i}`} inert={i >= ROOMS.length ? true : undefined}>
                <Link
                  href={roomHref(r.category)}
                  className="group relative isolate flex h-[27.5rem] w-[21.25rem] flex-col justify-end overflow-hidden rounded-panel p-5"
                >
                  <Image src={r.image} alt="" fill sizes="340px" className="-z-10 object-cover transition-transform duration-500 group-hover:scale-105" />
                  <span className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                  <span className="font-wide text-[26px] leading-none font-bold tracking-[-0.03em] text-white">{r.label}</span>
                  <span className="mt-1.5 text-[14px] text-white/75">{r.category}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
