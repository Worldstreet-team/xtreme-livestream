"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Play } from "@/components/icons";
import { formatNumber } from "@/lib/categories";
import type { RowItem } from "@/lib/discovery";
import { MOTION_VARS } from "@/lib/motion";
import { usePlayOnView } from "@/lib/use-play-on-view";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamArt } from "@/components/app/stream-art";
import u from "./unfold.module.css";

/** "Tue 23 Sep" — the day the broadcast ran. */
function dayOf(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The week's biggest broadcast, on the right rail — in the unfold language
 * the bell and the gifters board share. It arrives through a mask that
 * opens from the foot while the picture settles from a slight zoom. On
 * hover the picture pushes in slowly, the title rides up to show a second
 * line (peak viewers and the day it ran), and a play mark draws in: its
 * ring opening like an iris, then the triangle. On a touch screen the
 * second line simply shows.
 */
export function HighlightCard({ stream }: { stream: RowItem }) {
  // Watched from a wrapper: the card itself starts fully clipped, and an
  // observer may count a clipped-away element as unseen.
  const [ref, play] = usePlayOnView<HTMLDivElement>(true, 0.4);
  const name = stream.streamerId.displayName || stream.streamerId.username;
  const day = dayOf(stream.endedAt ?? stream.startedAt);

  return (
    <div ref={ref}>
      <Link
        href={`/c/${stream.streamerId.username}`}
        data-play={play}
        style={MOTION_VARS}
        aria-label={`${stream.title} — ${name}, ${formatNumber(stream.peakViewers)} peak viewers${day ? `, ${day}` : ""}`}
        className={cn(u.highlight, "group relative block aspect-video overflow-hidden rounded-[10px] bg-tint/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember")}
      >
        <span className={cn(u.picWrap, "absolute inset-0 block")}>
          <span className={cn(u.pic, "absolute inset-0 block")}>
            <StreamArt src={stream.thumbnailUrl} category={stream.category} alt="" seed={stream._id} size={{ w: 640, h: 360 }} />
          </span>
        </span>
        {/* Legibility over the picture, as on every stream card. */}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        {/* The play mark, drawn in on hover. */}
        <span className="pointer-events-none absolute top-[42%] left-1/2 size-12 -translate-x-1/2 -translate-y-1/2" aria-hidden>
          <span className={cn(u.playRing, "absolute inset-0 rounded-full border-2 border-white/90")} />
          <span className={cn(u.playTri, "absolute inset-0 flex items-center justify-center")}>
            <Play size={18} weight="fill" className="ml-0.5 text-white" />
          </span>
        </span>

        <span
          className="absolute inset-x-0 bottom-0 flex items-end gap-2.5 overflow-hidden p-3 text-white"
          style={{ "--meta-h": "19px" } as CSSProperties}
        >
          <UserAvatar src={stream.streamerId.avatar} name={name} size={28} className="size-7 shrink-0 ring-2 ring-white/20" />
          {/* The words ride up on hover to show the second line; the face stays put. */}
          <span className={cn(u.caption, "flex min-w-0 flex-col leading-tight")}>
            <span className="line-clamp-1 text-[13px] font-semibold">{stream.title}</span>
            <span className="truncate text-[11px] text-white/70">
              {name} · {stream.category}
            </span>
            <span className={cn(u.meta, "mt-1 flex items-center gap-1.5 truncate text-[11px] font-medium text-white/85 tabular-nums")}>
              <span>{formatNumber(stream.peakViewers)} peak viewers</span>
              {day && (
                <>
                  <span className="size-[3px] rounded-full bg-white/50" aria-hidden />
                  <span>{day}</span>
                </>
              )}
            </span>
          </span>
        </span>
      </Link>
    </div>
  );
}
