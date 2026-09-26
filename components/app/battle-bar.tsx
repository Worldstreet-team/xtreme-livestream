"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Gift, Lightning, Trophy, ArrowSquareOut } from "@/components/icons";
import { formatClock, hostShare, inMultiplierWindow, isBattleActive, secondsLeft, sideOf, type BattleView } from "@/lib/battles";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill, PillLink } from "@/components/ui/pill";

function usd(minor: number) {
  if (minor >= 100_000) return `$${(minor / 100_000).toFixed(1)}K`;
  // Under a dollar keeps its cents: a 30¢ bonus isn't "+$0".
  if (minor > 0 && minor < 100) return `$${(minor / 100).toFixed(2)}`;
  return `$${Math.round(minor / 100)}`;
}

/**
 * The scoreboard over a battle — Afterglow, with the other two directions'
 * best flow folded in:
 *   B  a lit pill on the picture; two solid sides meeting at a white-hot
 *      seam — Chili for the host, gold for the challenger
 *   A  the clock as a white scoreboard chip (Ember with ×2 in the closing
 *      window)
 *   C  the totals in thin, wide money numerals, with the lead called out
 * Below it, the one way to take part — back your side with a gift (a gift
 * moment, so heat) — and the door to the other side's room. The result
 * stays up for a while after the clock so nobody misses who won.
 */
export function BattleBar({
  battle,
  streamId,
  actionsEnd,
  className,
}: {
  battle: BattleView;
  /** The stream this bar is rendered in — decides which side "you" are on. */
  streamId: string;
  /** More controls at the end of the actions row (a phone's like and share, in a battle). */
  actionsEnd?: ReactNode;
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
  const lead = battle.host.usdMinor - battle.challenger.usdMinor;

  return (
    <div className={cn("pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col gap-2 md:inset-x-4 md:top-4", className)}>
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2.5 rounded-full bg-black/55 px-2.5 py-1.5 text-white md:gap-3 md:px-3",
          hot && "shadow-[inset_0_0_0_1.5px_var(--ember)]"
        )}
      >
        <Side side={battle.host} won={ended && battle.winnerId === battle.host.userId} align="left" />

        <div className="relative h-2.5 min-w-0 flex-1 rounded-full bg-ember">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-chili transition-[width] duration-700 [transition-timing-function:var(--ease-spring)]"
            style={{ width: `${share * 100}%` }}
          />
          {/* The seam: where the two sides meet, burning white. */}
          <span
            aria-hidden
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,#fff_0_28%,rgba(255,224,170,0.9)_44%,rgba(248,88,16,0)_72%)] transition-[left] duration-700 [transition-timing-function:var(--ease-spring)]"
            style={{ left: `${share * 100}%` }}
          />
        </div>

        <span
          className={cn(
            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[12px] font-bold tabular-nums",
            ended ? "bg-control text-white" : hot ? "bg-ember text-on-ember" : "bg-white text-[#0b0708]"
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

      {/* The totals in money numerals, the lead called out, then the actions. */}
      <div className="flex items-center justify-between gap-2 px-1 text-white drop-shadow">
        <span className="flex items-baseline gap-1.5">
          <span className="font-money text-[17px]">{usd(battle.host.usdMinor)}</span>
          {!ended && lead > 0 && <span className="text-[10.5px] font-bold text-ember-hi">▲ {usd(lead)}</span>}
        </span>
        {ended ? (
          <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-[12px] font-semibold">
            {tie ? "Nobody took it — a draw" : iWon ? `${me.displayName} wins` : `${them.displayName} wins`}
            {battle.bonusUsdMinor > 0 && !tie ? ` · +${usd(battle.bonusUsdMinor)} bonus` : ""}
          </span>
        ) : (
          <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap">
            {hot ? (
              <>
                {/* The clock already says ×2; a phone keeps the line to one row. */}
                <span className="hidden sm:inline">Last seconds — </span>
                <span className="sm:hidden">G</span>
                <span className="hidden sm:inline">g</span>ifts count double
              </>
            ) : (
              "Gifts decide it"
            )}
          </span>
        )}
        <span className="flex items-baseline gap-1.5">
          {!ended && lead < 0 && <span className="text-[10.5px] font-bold text-ember-hi">▲ {usd(-lead)}</span>}
          <span className="font-money text-[17px]">{usd(battle.challenger.usdMinor)}</span>
        </span>
      </div>

      {!ended && (
        // On a phone the names give way: "Back Ada" keeps its length in check
        // and the other room is just "Their side".
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <Pill
            size="sm"
            variant="heat"
            icon={<Gift size={14} weight="fill" />}
            onClick={() => window.dispatchEvent(new CustomEvent("xtreme:open-gifts"))}
            className="min-w-0"
          >
            <span className="block max-w-[34vw] truncate sm:max-w-none">Back {me.displayName}</span>
          </Pill>
          <PillLink href={`/stream/${them.streamId}`} size="sm" variant="glass" trailing={<ArrowSquareOut size={13} />}>
            <span className="sm:hidden">Their side</span>
            <span className="hidden sm:inline">Watch from {them.displayName}&apos;s side</span>
          </PillLink>
          {actionsEnd && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actionsEnd}</div>}
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
        <UserAvatar src={side.avatar} name={side.displayName} size={30} className={cn("size-[30px] ring-2", align === "left" ? "ring-chili" : "ring-ember")} />
        {won && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foil text-[#1a1206] ring-2 ring-black">
            <Trophy size={9} weight="fill" />
          </span>
        )}
      </span>
      <span className="hidden max-w-[110px] truncate text-[12.5px] font-semibold sm:block">{side.displayName}</span>
    </Link>
  );
}
