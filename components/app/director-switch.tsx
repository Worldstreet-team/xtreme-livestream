"use client";

import { SwitchField } from "@/components/ui/selection-controls";
import { formatClock } from "@/lib/rundown";
import { useNow } from "@/lib/use-now";
import { REACTION_MS, type DirectorBlock, type Shot } from "@/lib/director";
import { cn } from "@/lib/utils";

const BLOCKED: Record<Exclude<DirectorBlock, null>, string> = {
  alone: "Waiting for a guest — with just you on stage there's no one to cut to.",
  card: "Standing by while a card is up.",
  battle: "Standing by during the battle — both sides stay on screen.",
  content: "Standing by while your screen or chart has the frame.",
};

/**
 * The auto-director's switch, at the top of the Scenes panel: on or off,
 * and what it's doing — watching, on whom, standing by and why, or paused
 * because the host took a shot by hand (with a way to hand it back early).
 */
export function DirectorSwitch({
  on,
  onToggle,
  live,
  blocked,
  pausedUntil,
  onResume,
  shot,
  names,
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  live: boolean;
  blocked: DirectorBlock;
  pausedUntil: number;
  onResume: () => void;
  shot: Shot;
  /** Guests on stage, for saying who's on screen. */
  names: { identity: string; name: string }[];
}) {
  const now = useNow(on && pausedUntil > 0);
  const paused = on && pausedUntil > now;
  const status = !on
    ? `Cuts to whoever's talking — you, or you with the guest who is. A $20+ gift cuts to you for ${REACTION_MS / 1000} s. Anything you frame by hand pauses it for a minute.`
    : !live
      ? "Starts when you go live with a guest on stage."
      : blocked
        ? BLOCKED[blocked]
        : paused
          ? null
          : shot.layout === "solo"
            ? "Watching the room — on you."
            : shot.layout === "split"
              ? `Watching the room — on you and ${names.find((n) => n.identity === shot.spotlight)?.name ?? "a guest"}.`
              : "Watching the room — on everyone.";

  return (
    <div className={cn("rounded-[12px] p-3 transition-colors", on ? "bg-ember/[0.1]" : "bg-white/[0.04]")}>
      <SwitchField label="Auto-director" checked={on} onCheckedChange={onToggle} />
      {paused ? (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] leading-snug text-muted-foreground">
          <span>
            Paused — you framed a shot. Back in <span className="font-mono tabular-nums">{formatClock((pausedUntil - now) / 1000)}</span>
          </span>
          <button type="button" onClick={onResume} className="font-semibold text-ember-hi hover:underline">
            Hand it back now
          </button>
        </p>
      ) : (
        <p className="mt-0.5 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
          {on && live && !blocked && <span aria-hidden className="mt-[5px] size-1.5 shrink-0 animate-pulse rounded-full bg-ember" />}
          <span>{status}</span>
        </p>
      )}
    </div>
  );
}

/**
 * Who's beside you in a Split (or first in a Trio), picked by hand — the
 * same spotlight the auto-director moves.
 */
export function BesideYou({
  guests,
  spotlight,
  onPick,
}: {
  guests: { identity: string; name: string }[];
  spotlight: string | null;
  onPick: (identity: string) => void;
}) {
  const current = guests.some((g) => g.identity === spotlight) ? spotlight : (guests[0]?.identity ?? null);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Beside you">
      <span className="mr-1 text-[12px] text-muted-foreground">Beside you</span>
      {guests.map((g) => {
        const on = g.identity === current;
        return (
          <button
            key={g.identity}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onPick(g.identity)}
            className={cn(
              "press h-8 max-w-[10rem] truncate rounded-full px-3 text-[12px] font-semibold transition-colors",
              on ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
            )}
          >
            {g.name}
          </button>
        );
      })}
    </div>
  );
}
