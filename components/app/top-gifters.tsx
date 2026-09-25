"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Crown } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatUsd } from "@/components/xtream/money";

interface Gifter {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  verified?: boolean;
  totalUsdMinor: number;
  count: number;
}

/** Rank chips on the ember ground: #1 ink, #2 white, #3 Chili. */
const RANK_CHIP = ["bg-on-ember text-ember", "bg-on-ember/[0.16] text-on-ember", "bg-on-ember/[0.16] text-on-ember"];
/** The board's own ground — solid Ember (owner, 2026-09-24: "i just need the solid ember"); ink sits on it. */
const GROUND = "bg-ember";

function Podium({ g, rank }: { g: Gifter; rank: 0 | 1 | 2 }) {
  const first = rank === 0;
  return (
    <Link
      href={`/c/${g.username}`}
      className={cn("group/pod flex min-w-0 flex-col items-center text-center", first ? "-mt-1 flex-[1.3]" : "mt-5 flex-1")}
    >
      {first && <Crown size={18} weight="fill" className="mb-1 text-on-ember" aria-hidden />}
      <span className="relative">
        <UserAvatar
          src={g.avatar}
          name={g.displayName}
          size={first ? 60 : 46}
          ring={first ? "live" : "seen"}
          ringGapClassName={GROUND}
          className="transition-transform duration-300 group-hover/pod:scale-[1.04]"
        />
        <span
          className={cn(
            "absolute -bottom-1.5 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ring-2 ring-ember",
            RANK_CHIP[rank],
          )}
        >
          {rank + 1}
        </span>
      </span>
      <span className={cn("mt-3 w-full truncate px-0.5 font-bold", first ? "text-[13.5px] text-on-ember" : "text-[12.5px] text-on-ember/90")}>
        {g.username}
      </span>
      <span className="w-full truncate px-0.5 text-[11.5px] text-on-ember/65">{g.displayName}</span>
      <span className={cn("mt-1 font-mono tabular-nums", first ? "text-[13px] font-bold text-on-ember" : "text-[12px] font-semibold text-on-ember/75")}>
        {formatUsd(g.totalUsdMinor, true)}
      </span>
    </Link>
  );
}

/**
 * Top gifters this week, as a podium: the top three stand on it — #1 in the
 * middle, raised, in a heat ring under a white crown; #2 and #3 either
 * side — on a solid, glossy Ember board. Four and
 * five follow as rows. Handles lead, nicknames under them, TikTok-style.
 * Lives on the right rail (owner, 2026-09-24). `heading` renders above the
 * board only once there's someone to show.
 */
export function TopGiftersBoard({ heading, className }: { heading?: ReactNode; className?: string }) {
  const [top, setTop] = useState<Gifter[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { top: Gifter[] } }>(`/api/gifts/leaderboard`)
        .then((r) => !cancelled && setTop(r.data.top))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (top.length === 0) return null;
  const [one, two, three] = top;

  return (
    <section aria-label="Top gifters this week" className={className}>
      {heading}
      {/* Solid Ember, glossy: a lit top edge and a soft sheen over the
          upper half, like lacquer. No pattern (owner, 2026-09-24). */}
      <div
        className={cn(
          "relative isolate overflow-hidden rounded-panel px-3 pt-4 pb-2.5",
          GROUND,
        )}
      >
        <div className="flex items-start gap-2">
          {two ? <Podium g={two} rank={1} /> : <span className="flex-1" />}
          <Podium g={one} rank={0} />
          {three ? <Podium g={three} rank={2} /> : <span className="flex-1" />}
        </div>
        {top.length > 3 && (
          <ol start={4} className="mt-4 flex flex-col gap-px border-t border-on-ember/15 pt-2">
            {top.slice(3).map((g, i) => (
              <li key={g.userId}>
                <Link href={`/c/${g.username}`} className="flex items-center gap-3 rounded-control px-1.5 py-1.5 transition-colors hover:bg-on-ember/[0.07]">
                  <span className="w-3 shrink-0 text-center font-mono text-[11.5px] font-bold text-on-ember/50">{i + 4}</span>
                  <UserAvatar src={g.avatar} name={g.displayName} size={28} className="size-7 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[13px] font-bold text-on-ember">{g.username}</span>
                    <span className="truncate text-[11.5px] text-on-ember/65">{g.displayName}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[12px] font-semibold text-on-ember/80 tabular-nums">{formatUsd(g.totalUsdMinor, true)}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
