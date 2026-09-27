"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Gift, Lightning, Trophy, ArrowSquareOut, ShareNetwork } from "@/components/icons";
import { formatClock, hostShare, inMultiplierWindow, isBattleActive, secondsLeft, sideOf, teamName, type BattleView } from "@/lib/battles";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill, PillLink } from "@/components/ui/pill";
import { BattleResultSheet } from "@/components/app/battle-result-card";

function usd(minor: number) {
  // A million reads as one ("$9.9M"), not "$9876.5K".
  if (minor >= 100_000_000) return `$${(minor / 100_000_000).toFixed(1)}M`;
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
 * stays up for a while after the clock so nobody misses who won, with the
 * card to post it (Share result).
 */
export function BattleBar({
  battle,
  streamId,
  actionsEnd,
  className,
  onShare,
}: {
  battle: BattleView;
  /** The stream this bar is rendered in — decides which side "you" are on. */
  streamId: string;
  /** More controls at the end of the actions row (a phone's like and share, in a battle). */
  actionsEnd?: ReactNode;
  className?: string;
  /**
   * Open the result card somewhere that outlives the scoreboard — the watch
   * page drops an ended battle after a while, and a sheet mid-post mustn't
   * go with it. Unset, the scoreboard opens its own.
   */
  onShare?: (battle: BattleView) => void;
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
  const loser = ended && battle.winnerId ? (battle.winnerId === battle.host.userId ? battle.challenger : battle.host) : null;

  // A late gift just reset the clock: say so beside it for a moment.
  const [resetSeen, setResetSeen] = useState(Boolean(battle.lateResetUsed));
  const [flashUntil, setFlashUntil] = useState(0);
  if (Boolean(battle.lateResetUsed) !== resetSeen) {
    setResetSeen(Boolean(battle.lateResetUsed));
    if (battle.lateResetUsed) setFlashUntil(now + 3000);
  }
  const resetFlash = !ended && now < flashUntil;

  // The result card, as it was when it was opened: the scoreboard carries on
  // underneath (and may move to the next battle) while someone posts it.
  const [sharing, setSharing] = useState<BattleView | null>(null);

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
          ) : resetFlash ? (
            "+15s"
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
        <span className="flex items-center gap-1.5">
          <span className="font-money text-[17px]">{usd(battle.host.usdMinor)}</span>
          {!ended && lead > 0 && <span className="text-[10.5px] font-bold text-ember-hi">▲ {usd(lead)}</span>}
          <Backers backers={battle.host.top} ring="ring-chili" />
        </span>
        {ended ? (
          <span className="min-w-0 truncate rounded-full bg-black/55 px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap">
            {tie ? "Nobody took it — a draw" : iWon ? `${teamName(me)} win${me.partner ? "" : "s"}` : `${teamName(them)} win${them.partner ? "" : "s"}`}
            {battle.bonusUsdMinor > 0 && !tie ? ` · +${usd(battle.bonusUsdMinor)} bonus` : ""}
          </span>
        ) : (
          <span className="min-w-0 truncate rounded-full bg-black/55 px-2.5 py-0.5 text-[12px] font-semibold whitespace-nowrap">
            {!hot && battle.forfeit ? (
              `Loser: ${battle.forfeit}`
            ) : hot ? (
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
        <span className="flex items-center gap-1.5">
          <Backers backers={battle.challenger.top} ring="ring-ember" />
          {!ended && lead < 0 && <span className="text-[10.5px] font-bold text-ember-hi">▲ {usd(-lead)}</span>}
          <span className="font-money text-[17px]">{usd(battle.challenger.usdMinor)}</span>
        </span>
      </div>

      {/* The victory lap: what the loser owes, for the minute the result stays up. */}
      {loser && battle.forfeit && (
        <div className="flex justify-center">
          <span className="max-w-full truncate rounded-full bg-ember px-3 py-1 text-[12px] font-bold text-on-ember">
            Victory lap · {teamName(loser)} {battle.forfeit}
          </span>
        </div>
      )}

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
            <span className="block max-w-[34vw] truncate sm:max-w-none">Back {teamName(me)}</span>
          </Pill>
          <PillLink href={`/stream/${them.streamId}`} size="sm" variant="glass" trailing={<ArrowSquareOut size={13} />}>
            <span className="sm:hidden">Their side</span>
            <span className="hidden sm:inline">Watch from {teamName(them)}&apos;s side</span>
          </PillLink>
          {actionsEnd && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actionsEnd}</div>}
        </div>
      )}

      {/* After the clock, the one thing to do here is post it. */}
      {ended && (
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          <Pill size="sm" variant="primary" icon={<ShareNetwork size={14} weight="fill" />} onClick={() => (onShare ? onShare(battle) : setSharing(battle))}>
            Share result
          </Pill>
          {actionsEnd && <div className="ml-auto flex shrink-0 items-center gap-1.5">{actionsEnd}</div>}
        </div>
      )}
      {sharing && <BattleResultSheet battle={sharing} streamId={streamId} onClose={() => setSharing(null)} />}
    </div>
  );
}

/**
 * A side's top three backers, their faces small and overlapping, in the
 * side's colour. From a small tablet up: a phone's scoreboard row has no
 * room, and its header already shows the room's top faces.
 */
function Backers({ backers, ring }: { backers?: BattleView["host"]["top"]; ring: string }) {
  if (!backers || backers.length === 0) return null;
  return (
    <span className="hidden -space-x-1.5 sm:flex" aria-label={`Top backers: ${backers.map((b) => b.displayName).join(", ")}`}>
      {backers.map((b) => (
        <UserAvatar key={b.userId} src={b.avatar} name={b.displayName} size={18} className={cn("size-[18px] ring-[1.5px]", ring)} />
      ))}
    </span>
  );
}

function Side({ side, won, align }: { side: BattleView["host"]; won: boolean; align: "left" | "right" }) {
  const ring = align === "left" ? "ring-chili" : "ring-ember";
  return (
    <Link
      href={`/c/${side.username}`}
      className={cn("flex shrink-0 items-center gap-2", align === "right" && "flex-row-reverse text-right")}
      title={teamName(side)}
    >
      <span className={cn("relative flex", align === "right" && "flex-row-reverse")}>
        <UserAvatar src={side.avatar} name={side.displayName} size={30} className={cn("size-[30px] ring-2", ring)} />
        {/* A 2v2's partner, tucked in behind. */}
        {side.partner && (
          <UserAvatar
            src={side.partner.avatar}
            name={side.partner.displayName}
            size={24}
            className={cn("size-6 self-end ring-2", ring, align === "left" ? "-ml-2" : "-mr-2")}
          />
        )}
        {won && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-foil text-[#1a1206] ring-2 ring-black">
            <Trophy size={9} weight="fill" />
          </span>
        )}
      </span>
      <span className="hidden max-w-[130px] truncate text-[12.5px] font-semibold sm:block">{teamName(side)}</span>
    </Link>
  );
}
