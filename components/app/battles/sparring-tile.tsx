"use client";

import { hostShare, inMultiplierWindow, isBattleActive, leaderOf, SPARRING_NAME, type BattleView } from "@/lib/battles";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PracticeBadge } from "@/components/app/practice-preview";
import { BattleField } from "./battle-field";

/**
 * A practice battle's other side, where a real opponent's picture would
 * be: the sparring partner is nobody, so there's no video to show. It's
 * drawn instead — the battle's own ground (./battle-field.tsx), answering
 * the score as the clash view's does — with the stand-in's face and name,
 * and a Practice badge so nobody mistakes it for a host.
 *
 * Always dark, like every picture tile on the stage.
 */
export function SparringTile({ battle, label = "opponent", className }: { battle: BattleView; label?: string; className?: string }) {
  const live = isBattleActive(battle);
  const now = useNow(live);
  const lead = live ? leaderOf(battle.host.usdMinor, battle.challenger.usdMinor) : null;
  return (
    <div data-theme="dark" className={cn("relative isolate size-full overflow-hidden bg-[#120c0d] text-white", className)}>
      {/* The art kit's canvas sizes itself by its width; a tile is as tall as the stage makes it. */}
      <BattleField id={battle.id} share={hostShare(battle)} lead={lead} tone={live ? "live" : "ended"} hot={live && inMultiplierWindow(battle, now)} className="h-full!" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-3 text-center">
        <UserAvatar name={SPARRING_NAME} size={64} className="size-16 ring-[3px] ring-ember ring-offset-[3px] ring-offset-[#120c0d]" />
        <span className="max-w-full truncate font-wide text-[15px] font-bold tracking-[-0.02em]">{SPARRING_NAME}</span>
        {/* Under the name, not in a corner: the scoreboard rides over the top of the stage. */}
        <PracticeBadge size="xs" />
      </div>
      <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold">
        {SPARRING_NAME} <span className="font-medium text-white/60">· {label}</span>
      </span>
    </div>
  );
}
