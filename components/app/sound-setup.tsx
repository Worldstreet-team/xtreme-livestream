"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Microphone, MicrophoneSlash } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { SwitchField } from "@/components/ui/selection-controls";
import { Tip } from "@/components/ui/tip";
import { PRESETS, type VoiceSettings } from "@/lib/voice";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
/** The meter's bars; the whole row lights at full scale. */
const BARS = 12;
/** On the meter's 0–1 scale, this much counts as "picking you up" — a voice lands well over it, room tone under. */
const HEARD = 0.35;
const HEARD_FOR_MS = 2000;

export interface SoundSetupProps {
  settings: VoiceSettings;
  onChange: (next: VoiceSettings) => void;
  supported: { noiseFilter: boolean };
  /** The mic's level, 0–1 on a meter scale (the desk's `meters().mic`), or null while there's no mic. Read every frame. */
  meter?: () => number | null;
  /** Compare: the studio takes the desk out of the mic's path while the pill is held. */
  compare?: { start(): void; stop(): void } | null;
  /** On air: the filter and presets change at once; Music mode's capture and bitrate wait for the next stream. */
  live?: boolean;
  className?: string;
}

/**
 * The Sound half of the setup screen's "Sound & look": the noise filter,
 * Music mode, a voice preset, a meter to see the mic's picking you up, and
 * Compare — hold it to hear your mic without any of it. A leaf: it owns no
 * audio; the studio passes what to show and takes what was chosen.
 */
export function SoundSetup({ settings, onChange, supported, meter, compare, live = false, className }: SoundSetupProps) {
  const music = settings.musicMode;
  const filterOn = settings.noiseFilter && supported.noiseFilter && !music;
  const filterHint = !supported.noiseFilter
    ? "Not available on this browser."
    : music
      ? "Off in Music mode."
      : filterOn
        ? "Keyboards, fans and the street stay out of your voice."
        : "Keeps keyboards, fans and the street out of your voice.";
  const preset = PRESETS.find((p) => p.id === settings.preset) ?? PRESETS[0];

  return (
    <div className={cn("@container", className)}>
      <div className="grid grid-cols-1 gap-3.5 @[560px]:grid-cols-2 @[560px]:gap-x-6 @[560px]:gap-y-4">
        {/* The two switches. Music mode wants the mic as it is, so the filter and presets sit out while it's on. */}
        <div className="divide-y divide-white/[0.05] rounded-[12px] bg-white/[0.045] px-3.5 py-1">
          <SwitchField
            label="Noise filter"
            description={filterHint}
            checked={filterOn}
            disabled={!supported.noiseFilter || music}
            onCheckedChange={(v) => onChange({ ...settings, noiseFilter: v })}
          />
          <SwitchField
            label="Music mode"
            description={`For DJs and instruments — no noise or echo processing, stereo, higher bitrate.${live ? " Stereo and the bitrate kick in next time you go live." : ""}`}
            checked={music}
            onCheckedChange={(v) => onChange({ ...settings, musicMode: v })}
          />
        </div>

        {/* The preset: four pills, the one you're on in white, and a line on what it does. */}
        <div className={cn("min-w-0 px-0.5 @[560px]:pt-1", music && "opacity-40")}>
          <p id="sound-setup-voice" className={LABEL}>
            Your voice
          </p>
          <div role="group" aria-labelledby="sound-setup-voice" className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = p.id === settings.preset;
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  disabled={music}
                  onClick={() => onChange({ ...settings, preset: p.id })}
                  className={cn(
                    "press h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:pointer-events-none",
                    active ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/80 hover:bg-white/[0.1] hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground" aria-live="polite">
            {music ? "Presets sit out in Music mode." : preset.hint}
          </p>
        </div>

        {(meter || compare) && (
          <div className="flex items-center gap-3 rounded-[12px] bg-white/[0.045] px-3.5 py-3 @[560px]:col-span-2">
            {meter && <MicMeter meter={meter} />}
            {compare !== undefined && <ComparePill compare={compare} />}
          </div>
        )}
      </div>
    </div>
  );
}

/** Twelve bars, ember as they light, and a line saying what they mean — the device check's meter, fed a level. */
function MicMeter({ meter }: { meter: () => number | null }) {
  const [lit, setLit] = useState(0);
  const [heard, setHeard] = useState(false);
  const [hasMic, setHasMic] = useState(true);

  useEffect(() => {
    let raf = 0;
    let lastHeard = 0;
    const tick = () => {
      const level = meter();
      const present = level !== null;
      setHasMic((cur) => (cur === present ? cur : present));
      // Only a change in lit bars re-renders — not every frame.
      const next = present ? Math.min(BARS, Math.round(level * BARS)) : 0;
      setLit((cur) => (cur === next ? cur : next));
      const now = performance.now();
      if (present && level >= HEARD) lastHeard = now;
      const heardNow = now - lastHeard < HEARD_FOR_MS;
      setHeard((cur) => (cur === heardNow ? cur : heardNow));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [meter]);

  const status = !hasMic ? "No mic yet — turn it on to see it here" : heard ? "Mic's picking you up" : "Mic's quiet — say something";
  return (
    <>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", hasMic ? "bg-white/[0.06] text-foreground" : "bg-chili/15 text-chili-hi")}>
        {hasMic ? <Microphone size={17} /> : <MicrophoneSlash size={17} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex h-4 items-end gap-[3px]" aria-hidden>
          {Array.from({ length: BARS }, (_, i) => (
            <span
              key={i}
              className={cn("w-full rounded-[2px] transition-colors duration-75", i < lit ? "bg-ember" : "bg-white/[0.1]")}
              // Bars rise across the meter, so a whisper reads low and a shout reads tall.
              style={{ height: `${40 + (i / (BARS - 1)) * 60}%` }}
            />
          ))}
        </div>
        <p role="status" aria-live="polite" className={cn("mt-1.5 truncate text-[12px] leading-snug", heard ? "text-foreground" : "text-muted-foreground")}>
          {status}
        </p>
      </div>
    </>
  );
}

/**
 * Hold to hear your mic as it is; let go and the desk is back. Pointer,
 * touch and keyboard (Space or Enter) all hold it; anything that could
 * lose the release — the pointer wandering, focus leaving, unmounting —
 * lets go too, so the desk is never left bypassed.
 */
function ComparePill({ compare }: { compare: SoundSetupProps["compare"] }) {
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);

  const begin = () => {
    if (!compare || holdingRef.current) return;
    holdingRef.current = true;
    setHolding(true);
    compare.start();
  };
  const end = () => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    compare?.stop();
  };
  useEffect(
    () => () => {
      if (holdingRef.current) {
        holdingRef.current = false;
        compare?.stop();
      }
    },
    [compare]
  );

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    begin();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (!e.repeat) begin();
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    end();
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Tip label="Hold to hear your mic without the desk" touch={false}>
        <Pill
          size="sm"
          variant={holding ? "ember" : "glass"}
          disabled={!compare}
          aria-pressed={holding}
          aria-label={holding ? "Comparing: this is your mic as it is" : "Compare — hold to hear your mic without the desk"}
          onPointerDown={onPointerDown}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={end}
          onContextMenu={(e) => e.preventDefault()}
          className="touch-none select-none"
          style={{ WebkitTouchCallout: "none" }}
        >
          {holding ? "As it is" : "Compare"}
        </Pill>
      </Tip>
      <span className="hidden text-[10.5px] text-muted-foreground @[560px]:block" aria-hidden>
        Hold
      </span>
    </div>
  );
}
