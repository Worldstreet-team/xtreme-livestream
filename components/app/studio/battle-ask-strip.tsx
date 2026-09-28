"use client";

import { Sword, X } from "@/components/icons";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

/**
 * Going live for a battle ("Start a battle" in the Go live chooser): a line
 * above Go live saying the opponent comes after you're on air — or, in a
 * practice run, that a practice battle waits there. "Practice first" is
 * /studio?practice=1&battle=1 in place: a practice run, the battle still
 * asked for. Over the picture (a phone's) it's a dark glass line.
 */
export function BattleAskStrip({
  practice,
  onPracticeFirst,
  onDismiss,
  onPicture = false,
}: {
  practice: boolean;
  onPracticeFirst: () => void;
  onDismiss: () => void;
  onPicture?: boolean;
}) {
  return (
    <div
      className={cn(
        "mb-2.5 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-snug",
        onPicture ? "bg-black/55 text-white" : "bg-tint/[0.05] text-foreground",
      )}
    >
      <Sword size={14} weight="fill" className="shrink-0" aria-hidden />
      <span className={cn("min-w-0 flex-1", onPicture ? "text-white/80" : "text-muted-foreground")}>
        {practice ? "You'll try a practice battle once you start" : "You'll pick your opponent once you're live"}
      </span>
      {!practice && (
        <button type="button" onClick={onPracticeFirst} className="shrink-0 font-semibold underline-offset-2 hover:underline">
          Practice first
        </button>
      )}
      <Tip label="Not a battle this time">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Not a battle this time"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            onPicture ? "text-white/70 hover:bg-white/10" : "text-muted-foreground hover:bg-tint/[0.08]",
          )}
        >
          <X size={12} weight="bold" />
        </button>
      </Tip>
    </div>
  );
}
