"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Lightning, CalendarBlank } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { formatClock, hostShare, inMultiplierWindow, secondsLeft, type BattleView } from "@/lib/battles";
import { formatStartsIn } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { LiveBadge, Badge } from "@/components/ui/badge";
import { Shelf } from "@/components/app/shelf";

/**
 * Battles on the home page: the ones running now first, then the ones
 * booked, as a sliding row of battle cards (below).
 */
export function BattlesRow() {
  const [live, setLive] = useState<BattleView[]>([]);
  const [upcoming, setUpcoming] = useState<BattleView[]>([]);
  const now = useNow(live.length > 0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [l, u] = await Promise.all([
        apiFetch<{ success: boolean; data: { battles: BattleView[] } }>(`/api/battles/live`).then((r) => r.data.battles).catch(() => []),
        apiFetch<{ success: boolean; data: { battles: BattleView[] } }>(`/api/battles/upcoming`).then((r) => r.data.battles).catch(() => []),
      ]);
      if (cancelled) return;
      setLive(l);
      setUpcoming(u);
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const items = [...live, ...upcoming];
  if (items.length === 0) return null;

  return (
    <Shelf id="battles" title="Battles" size="standard" peek>
      {items.map((b) => (
        <BattleCard key={b.id} battle={b} now={now} />
      ))}
    </Shelf>
  );
}

/** The seam: from 55% across the top to 45% across the bottom. */
const LEFT = "[clip-path:polygon(0_0,55%_0,45%_100%,0_100%)]";
const RIGHT = "[clip-path:polygon(55%_0,100%_0,100%_100%,45%_100%)]";

/** Faint rings around a face — depth without a picture. */
function Rings({ x }: { x: string }) {
  return (
    <span aria-hidden className="pointer-events-none absolute top-[44%] -translate-x-1/2 -translate-y-1/2" style={{ left: x }}>
      {[92, 132, 176].map((d, i) => (
        <span
          key={d}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white"
          style={{ width: d, height: d, opacity: [0.09, 0.055, 0.03][i] }}
        />
      ))}
    </span>
  );
}

/**
 * A battle, drawn rather than photographed (owner, 2026-09-23: no stream
 * pictures — the faces, with a faint pattern for depth). The card splits
 * on a slant: a whisper of Chili behind the host, of Ember behind the
 * challenger, a seam that burns white, a fine dot grid over both, and
 * rings spreading out from each face. The clock sits in the corner and
 * the score is a lit bar near the foot, Chili against Ember. Under it,
 * just who's fighting. A booked battle is the same card, quieter, with
 * when instead of the clock.
 */
function BattleCard({ battle: b, now }: { battle: BattleView; now: number }) {
  const isLive = b.status === "live" || b.status === "overtime";
  const hot = isLive && inMultiplierWindow(b, now);
  const share = hostShare(b);
  const face = (side: BattleView["host"], ring: string) => (
    <UserAvatar
      src={side.avatar}
      name={side.displayName}
      size={64}
      className={cn("size-16 shadow-popover ring-[3px] ring-offset-[3px] ring-offset-surface", ring, !isLive && "opacity-80")}
    />
  );

  return (
    <Link href={isLive ? `/stream/${b.host.streamId}` : `/c/${b.host.username}`} className="group block">
      <div className="relative isolate aspect-video overflow-hidden rounded-sm bg-surface transition-colors group-hover:bg-surface-raised">
        {/* Two solid tints, split on the slant. */}
        <div className={cn("absolute inset-0 -z-20", LEFT, isLive ? "bg-chili/[0.13]" : "bg-chili/[0.06]")} />
        <div className={cn("absolute inset-0 -z-20", RIGHT, isLive ? "bg-ember/[0.12]" : "bg-ember/[0.05]")} />
        {/* A fine dot grid, fading toward the edges. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.16] [background-image:radial-gradient(rgba(255,255,255,0.9)_1px,transparent_1.2px)] [background-size:14px_14px] [mask-image:radial-gradient(ellipse_70%_75%_at_50%_45%,#000_30%,transparent_85%)]"
        />
        <Rings x="27%" />
        <Rings x="73%" />
        <svg aria-hidden className="absolute inset-0 -z-10 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="55" y1="-2" x2="45" y2="102" stroke="white" strokeOpacity={isLive ? 0.7 : 0.3} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>

        <span className="absolute top-[44%] left-[27%] -translate-x-1/2 -translate-y-1/2">{face(b.host, "ring-chili")}</span>
        <span className="absolute top-[44%] left-[73%] -translate-x-1/2 -translate-y-1/2">{face(b.challenger, "ring-ember")}</span>
        <span className="absolute top-[44%] left-1/2 -translate-x-1/2 -translate-y-1/2 font-wide text-[18px] font-black tracking-[-0.04em] text-foreground/90 italic">
          VS
        </span>

        <span className="absolute top-2 left-2">
          {isLive ? <LiveBadge>{" · Battle"}</LiveBadge> : <Badge variant="glass" icon={<CalendarBlank size={11} weight="bold" />}>Booked</Badge>}
        </span>
        <span
          className={cn(
            "absolute top-2 right-2 flex h-[22px] items-center gap-1 rounded-full px-2 font-mono text-[11px] font-bold tabular-nums",
            hot ? "bg-ember text-on-ember" : isLive ? "bg-inverse text-on-inverse" : "bg-control text-foreground/80",
          )}
        >
          {isLive ? (
            <>
              {hot && <Lightning size={10} weight="fill" />}
              {b.status === "overtime" ? "OT " : ""}
              {formatClock(secondsLeft(b, now))}
            </>
          ) : b.scheduledAt ? (
            <span suppressHydrationWarning>{formatStartsIn(b.scheduledAt, now)}</span>
          ) : (
            "Soon"
          )}
        </span>

        {/* The score, as a lit bar of its own — inset from the edges, glowing
            on both sides of the white seam — and no amounts (owner). */}
        {isLive && (
          <span className="absolute inset-x-5 bottom-3.5 flex h-2 overflow-hidden rounded-full bg-black/40 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
            <span className="h-full rounded-l-full bg-chili transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
            <span className="h-full w-[2px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]" />
            <span className="h-full flex-1 rounded-r-full bg-ember" />
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-[14px] font-semibold text-foreground">
        {b.host.displayName} <span className="font-medium text-muted-foreground">vs</span> {b.challenger.displayName}
      </p>
      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
        {isLive ? "Live battle · gifts decide it" : "Starts by itself when both are live"}
      </p>
    </Link>
  );
}
