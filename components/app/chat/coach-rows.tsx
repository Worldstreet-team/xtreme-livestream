"use client";

import { Bell, CellSignalLow, Lock, ShareNetwork, Sparkle, TextAa, UserPlus, X } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { dismissCoach, useCoachLines, type CoachIcon } from "@/lib/coach";
import { cn } from "@/lib/utils";
import { ON_VIDEO, type ChatSkin } from "./chat-lines";

const ICONS: Record<CoachIcon, typeof Bell> = {
  bell: Bell,
  share: ShareNetwork,
  invite: UserPlus,
  title: TextAa,
  signal: CellSignalLow,
  spark: Sparkle,
  lock: Lock,
};

/**
 * The coach's lines (lib/coach.ts) in the host's own chat, just above the
 * composer: "We're telling your 212 followers you're live", with the one
 * button that does the thing. Only the host's studio mounts it, and the
 * lines never leave this tab.
 */
export function CoachRows({ streamId, skin }: { streamId: string; skin: ChatSkin }) {
  const lines = useCoachLines(streamId);
  if (lines.length === 0) return null;
  const overlay = skin === "overlay";
  return (
    <div className={cn("flex flex-col gap-1.5", overlay ? "pointer-events-auto mb-1.5" : "px-3 pb-2")} aria-live="polite" data-coach-rows>
      {lines.map((line) => {
        const Icon = ICONS[line.icon];
        return (
          <div
            key={line.id}
            data-coach={line.id}
            className={cn(
              "flex animate-in items-center gap-2.5 rounded-[12px] py-2 pr-1.5 pl-2.5 duration-300 fade-in slide-in-from-bottom-1",
              overlay ? "w-fit max-w-full bg-black/60" : "bg-tint/[0.05]"
            )}
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ember/[0.14] text-ember-hi">
              <Icon size={14} weight="fill" />
            </span>
            <p className={cn("min-w-0 flex-1 text-[12.5px] leading-snug font-medium", overlay ? cn("text-white/90", ON_VIDEO) : "text-foreground/90")}>
              {line.text}
            </p>
            {line.action && (
              <Pill size="sm" variant="ember" onClick={line.action.run} className="h-7 px-2.5">
                {line.action.label}
              </Pill>
            )}
            <button
              type="button"
              onClick={() => dismissCoach(line.id)}
              aria-label="Dismiss"
              className={cn(
                "press flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                overlay ? "text-white/60 hover:text-white" : "text-muted-foreground hover:bg-tint/[0.06] hover:text-foreground"
              )}
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
