"use client";

import { PICKS, type ViewerPick } from "@/lib/angles";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * The viewer's angle, in the player's Picture menu: Director follows the
 * host's cuts; Main, Phone and Split pin one for this viewer alone, and
 * only the tile they're looking at comes in sharp. Only there while a
 * phone camera is in the room — otherwise there's nothing to choose
 * between, and the menu says nothing about it.
 */
export function AnglePicker({
  pick,
  onPick,
  phoneAvailable,
}: {
  pick: ViewerPick;
  onPick: (pick: ViewerPick) => void;
  /** A `cam-<hostId>` participant is publishing right now. */
  phoneAvailable: boolean;
}) {
  if (!phoneAvailable) return null;
  return (
    <div>
      <p className={LABEL}>Angle</p>
      <div role="radiogroup" aria-label="Camera angle" className="mt-2 flex flex-col gap-1">
        {PICKS.map((p) => {
          const on = p.id === pick;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => !on && onPick(p.id)}
              className={cn(
                "press flex items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left transition-colors",
                on ? "bg-white text-[#0b0708]" : "bg-white/[0.05] text-foreground hover:bg-white/[0.08]"
              )}
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{p.label}</span>
                <span className={cn("block text-[11.5px] leading-snug", on ? "text-[#0b0708]/65" : "text-muted-foreground")}>{p.hint}</span>
              </span>
              {on && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ember" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
