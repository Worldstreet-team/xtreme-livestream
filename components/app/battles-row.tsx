"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sword, Lightning, CalendarBlank, Eye } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { formatClock, hostShare, inMultiplierWindow, secondsLeft, type BattleView } from "@/lib/battles";
import { formatStartsIn } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { LiveBadge, Badge } from "@/components/ui/badge";
import { Shelf } from "@/components/app/shelf";

function usd(minor: number) {
  return minor >= 100_000 ? `$${(minor / 100_000).toFixed(1)}K` : `$${Math.round(minor / 100)}`;
}

/**
 * Battles on the home page: the ones running now first, then the ones
 * booked. A card is two faces, the score bar between them, and the clock.
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
    <Shelf
      id="battles"
      title={live.length > 0 ? "Battles live now" : "Battles coming up"}
      reason="Two creators, one clock — the audience decides with gifts"
      accent={<Sword size={14} weight="fill" className="text-primary" />}
      size="standard"
      className="mb-8"
    >
      {items.map((b) => {
        const isLive = b.status === "live" || b.status === "overtime";
        const hot = isLive && inMultiplierWindow(b, now);
        const share = hostShare(b);
        return (
          <Link
            key={b.id}
            href={isLive ? `/stream/${b.host.streamId}` : `/c/${b.host.username}`}
            className={cn("group relative block overflow-hidden rounded-sm bg-[#141418] p-4 transition-colors hover:bg-[#1b1b21]", hot && "ring-1 ring-amber-400/60")}
          >
            <div className="mb-3 flex items-center justify-between">
              {isLive ? <LiveBadge size="xs">{" · Battle"}</LiveBadge> : <Badge variant="muted" size="xs" icon={<CalendarBlank size={10} weight="bold" />}>Booked</Badge>}
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", hot ? "bg-amber-400 text-neutral-950" : isLive ? "bg-white text-neutral-950" : "bg-white/[0.08] text-muted-foreground")}>
                {isLive ? (
                  <>
                    {hot && <Lightning size={10} weight="fill" className="mr-0.5 inline" />}
                    {b.status === "overtime" ? "OT " : ""}
                    {formatClock(secondsLeft(b, now))}
                  </>
                ) : b.scheduledAt ? (
                  formatStartsIn(b.scheduledAt, now)
                ) : (
                  "Soon"
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                <UserAvatar src={b.host.avatar} name={b.host.displayName} size={56} className="size-14 ring-[3px] ring-red-500" />
                <span className="w-full truncate text-[13px] font-semibold text-foreground">{b.host.displayName}</span>
                {isLive && <span className="text-[11.5px] text-muted-foreground tabular-nums">{usd(b.host.usdMinor)}</span>}
              </span>
              <span className="flex shrink-0 flex-col items-center gap-1">
                <Sword size={18} weight="fill" className="text-muted-foreground/60" />
                <span className="text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">vs</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                <UserAvatar src={b.challenger.avatar} name={b.challenger.displayName} size={56} className="size-14 ring-[3px] ring-sky-400" />
                <span className="w-full truncate text-[13px] font-semibold text-foreground">{b.challenger.displayName}</span>
                {isLive && <span className="text-[11.5px] text-muted-foreground tabular-nums">{usd(b.challenger.usdMinor)}</span>}
              </span>
            </div>
            {isLive && (
              <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-white/[0.12]">
                <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 to-amber-400 transition-[width]" style={{ width: `${share * 100}%` }} />
                <div className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-violet-500 to-sky-400 transition-[width]" style={{ width: `${(1 - share) * 100}%` }} />
              </div>
            )}
            {!isLive && <p className="mt-3 text-center text-[11.5px] text-muted-foreground">Starts by itself when both are live</p>}
            {isLive && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-neutral-950"><Eye size={12} weight="bold" />Watch</span>
              </span>
            )}
          </Link>
        );
      })}
    </Shelf>
  );
}
