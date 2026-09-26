"use client";

import { Check, MonitorPlay, Waveform } from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { nairaAmount, nairaPerHour, NAIRA_PER_GB, PICTURE_MODES, type PictureMode } from "@/lib/data-mode";

/**
 * How much picture to take (Phase 1, data saver): Auto, Data saver (up to
 * 360p) or Radio (just the sound), each with what an hour roughly costs in
 * naira — the number people on mobile data actually weigh.
 */
export function PictureMenu({ mode, onPick, className }: { mode: PictureMode; onPick: (mode: PictureMode) => void; className?: string }) {
  return (
    <div role="radiogroup" aria-label="Picture" className={cn("flex flex-col gap-1", className)}>
      {PICTURE_MODES.map((m) => {
        const on = m.id === mode;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(m.id)}
            className={cn(
              "press flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors",
              on ? "bg-white/[0.1]" : "hover:bg-white/[0.06]"
            )}
          >
            <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", on ? "bg-ember text-on-ember" : "bg-white/[0.08]")}>
              {on && <Check size={11} weight="bold" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-white">{m.label}</span>
              <span className="block text-[12px] text-white/60">{m.hint}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-[13px] font-bold text-white tabular-nums">≈ {nairaAmount(m.id)}</span>
              <span className="block text-[11px] text-white/50">an hour</span>
            </span>
          </button>
        );
      })}
      <p className="px-3 pt-1 text-[11px] text-white/45">Estimates at about ₦{NAIRA_PER_GB} a gigabyte.</p>
    </div>
  );
}

/** The icon for the picture setting, as it stands. */
export function PictureIcon({ mode, size = 18 }: { mode: PictureMode; size?: number }) {
  return mode === "radio" ? <Waveform size={size} weight="bold" /> : <MonitorPlay size={size} weight={mode === "saver" ? "bold" : "regular"} />;
}

/**
 * Radio: the picture is off and the room plays on — the host's face in its
 * ring, the bars moving so it never reads as frozen, and the way back.
 */
export function RadioCard({ name, avatar, onPicture }: { name: string; avatar?: string | null; onPicture: () => void }) {
  return (
    // Above the chat lane's shade, under the scoreboard and controls.
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0b0708] px-6 text-center">
      <div className="flex max-w-full flex-col items-center">
        <UserAvatar src={avatar} name={name} size={84} ring="live" ringGapClassName="bg-[#0b0708]" />
        <span aria-hidden className="mt-5 flex h-6 items-end gap-1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className="w-1 origin-bottom rounded-full bg-ember motion-safe:animate-[scene-bars_1.1s_ease-in-out_infinite]"
              style={{ height: "100%", animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
        <p className="mt-4 font-wide text-[19px] leading-tight font-bold tracking-[-0.02em] text-white">Listening to {name}</p>
        <p className="mt-1.5 max-w-[34ch] text-[13px] text-white/60">Radio saves your data — {nairaPerHour("radio")}. Chat and gifts work as usual.</p>
        <button
          type="button"
          onClick={onPicture}
          className="press mt-5 flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[14px] font-semibold text-[#0b0708]"
        >
          <MonitorPlay size={16} />
          Bring the picture back
        </button>
      </div>
    </div>
  );
}
