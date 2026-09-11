"use client";

import Link from "next/link";
import { Gift, Lightning, Trophy, ArrowSquareOut } from "@phosphor-icons/react";
import { formatClock, hostShare, inMultiplierWindow, isBattleActive, secondsLeft, sideOf, type BattleView } from "@/lib/battles";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill, PillLink } from "@/components/ui/pill";

function usd(minor: number) {
  return minor >= 100_000 ? `$${(minor / 100_000).toFixed(1)}K` : `$${Math.round(minor / 100)}`;
}

/**
 * The scoreboard over a battle: both faces, two bars meeting in the middle,
 * the clock, and a ×2 flare in the closing window. Below it, the one way to
 * take part — back the side you're watching with a gift — and the door to
 * the other side's room. The result state stays up for a while after the
 * clock so nobody misses who won.
 */
export function BattleBar({
  battle,
  streamId,
  className,
}: {
  battle: BattleView;
  /** The stream this bar is rendered in — decides which side "you" are on. */
  streamId: string;
  className?: string;
}) {
  const now = useNow(isBattleActive(battle));
  const left = secondsLeft(battle, now);
  const hot = inMultiplierWindow(battle, now);
  const share = hostShare(battle);
  const mine = sideOf(battle, streamId) ?? "host";
  const me = mine === "host" ? battle.host : battle.challenger;
  const them = mine === "host" ? battle.challenger : battle.host;
  const ended = battle.status === "ended";
  const iWon = ended && battle.winnerId === me.userId;
  const tie = ended && !battle.winnerId;

  return (
    <div className={cn("pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2 md:inset-x-4 md:top-4", className)}>
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2.5 rounded-full bg-black/60 px-2.5 py-1.5 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)] md:gap-3 md:px-3",
          hot && "ring-1 ring-amber-400/60"
        )}
      >
        <Side side={battle.host} won={ended && battle.winnerId === battle.host.userId} align="left" />

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.14]">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-red-500 to-amber-400 transition-[width] duration-500"
              style={{ width: `${share * 100}%` }}
            />
            <div
              className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-violet-500 to-sky-400 transition-[width] duration-500"
              style={{ width: `${(1 - share) * 100}%` }}
            />
          </div>
        </div>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold tabular-nums",
            ended ? "bg-white/[0.12]" : hot ? "bg-amber-400 text-neutral-950" : "bg-white text-neutral-950"
          )}
        >
          {ended ? (
            <>
              <Trophy size={12} weight="fill" />
              {tie ? "Draw" : "Final"}
            </>
          ) : (
            <>
              {hot && <Lightning size={12} weight="fill" />}
              {battle.status === "overtime" ? "OT " : ""}
              {formatClock(left)}
              {hot && " ×2"}
            </>
          )}
        </span>

        <Side side={battle.challenger} won={ended && battle.winnerId === battle.challenger.userId} align="right" />
      </div>

      {/* Scores under the bar, then the actions. */}
      <div className="flex items-center justify-between px-1 text-[12px] font-semibold text-white/90 tabular-nums drop-shadow">
        <span>{usd(battle.host.usdMinor)}</span>
        {ended ? (
          <span className="rounded-full bg-black/55 px-2.5 py-0.5">
            {tie ? "Nobody took it — a draw" : iWon ? `${me.displayName} wins` : `${them.displayName} wins`}
            {battle.bonusUsdMinor > 0 && !tie ? ` · +${usd(battle.bonusUsdMinor)} bonus` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-black/55 px-2.5 py-0.5">
            {hot ? "Last seconds — gifts count double" : "Gifts decide it"}
          </span>
        )}
        <span>{usd(battle.challenger.usdMinor)}</span>
      </div>

      {!ended && (
        <div className="pointer-events-auto flex items-center gap-2">
          <Pill
            size="sm"
            variant="live"
            icon={<Gift size={14} weight="fill" />}
            onClick={() => window.dispatchEvent(new CustomEvent("xtreme:open-gifts"))}
          >
            Back {me.displayName}
          </Pill>
          <PillLink href={`/stream/${them.streamId}`} size="sm" variant="glass" trailing={<ArrowSquareOut size={13} />}>
            Watch from {them.displayName}&apos;s side
          </PillLink>
        </div>
      )}
    </div>
  );
}

function Side({ side, won, align }: { side: BattleView["host"]; won: boolean; align: "left" | "right" }) {
  return (
    <Link
      href={`/c/${side.username}`}
      className={cn("flex shrink-0 items-center gap-2", align === "right" && "flex-row-reverse text-right")}
      title={side.displayName}
    >
      <span className="relative">
        <UserAvatar src={side.avatar} name={side.displayName} size={30} className={cn("size-[30px] ring-2", align === "left" ? "ring-red-500" : "ring-sky-400")} />
        {won && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-amber-400 text-neutral-950 ring-2 ring-black">
            <Trophy size={9} weight="fill" />
          </span>
        )}
      </span>
      <span className="hidden max-w-[110px] truncate text-[12.5px] font-semibold sm:block">{side.displayName}</span>
    </Link>
  );
}
