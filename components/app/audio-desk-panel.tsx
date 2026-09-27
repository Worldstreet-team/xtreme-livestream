"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, X } from "@/components/icons";
import { SwitchField } from "@/components/ui/selection-controls";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PADS, type AudioDesk, type DeskLevels, type DeskSettings, type NoiseFilterState, type PadId } from "@/lib/audio-desk";
import { presetLabel, type VoicePreset } from "@/lib/voice";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

/** The desk's header line: what's shaping the voice, for a host who opens it mid-stream. */
const NOISE_LINE: Record<NoiseFilterState, string> = {
  on: "Noise filter on",
  off: "Noise filter off",
  starting: "Noise filter starting…",
  unavailable: "Noise filter isn't available here",
};

/** A fader: the level as a filled ember track and a white knob. */
function Fader({ id, label, value, onChange, hint }: { id: string; label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">{pct}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ember [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.5)]"
        style={{ background: `linear-gradient(to right, var(--ember) ${pct}%, rgba(255,236,230,0.1) ${pct}%)` }}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-[11.5px] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A level meter: green, then amber near the top, chili when it's clipping. */
function Meter({ label, level }: { label: string; level: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-9 shrink-0 text-[11.5px] text-muted-foreground">{label}</span>
      <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full transition-[width] duration-75", level > 0.94 ? "bg-chili-hi" : level > 0.8 ? "bg-warning" : "bg-success")}
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
    </div>
  );
}

export interface DeskMoments {
  /** Play Ka-ching when a gift of this many cents or more lands; 0 is off. */
  giftFromMinor: number;
  /** The airhorn when you win a battle. */
  battleWin: boolean;
}

/**
 * The studio's Sound panel: the audio desk your mic goes through — the
 * switch, meters, faders, the pads, a music bed, and how loud each guest is
 * for everyone. Browser broadcasts only: OBS has its own mixer.
 */
export function AudioDeskPanel({
  desk,
  on,
  starting,
  encoder,
  settings,
  onToggle,
  onSettings,
  moments,
  onMoments,
  guests,
  gains,
  onGain,
}: {
  desk: AudioDesk | null;
  on: boolean;
  starting: boolean;
  /** Broadcasting from an encoder: the desk isn't in the path. */
  encoder: boolean;
  settings: DeskSettings;
  onToggle: (on: boolean) => void;
  onSettings: (s: DeskSettings) => void;
  moments: DeskMoments;
  onMoments: (m: DeskMoments) => void;
  guests: { userId: string; username: string; avatar: string }[];
  gains: Record<string, number>;
  onGain: (identity: string, level: number) => void;
}) {
  const [meters, setMeters] = useState({ mic: 0, out: 0 });
  /** What's shaping the voice, as last read off the desk it came from. */
  const [shaping, setShaping] = useState<{ desk: AudioDesk; noise: NoiseFilterState; preset: VoicePreset } | null>(null);
  const [pressed, setPressed] = useState<PadId | null>(null);
  const [track, setTrack] = useState<File | null>(null);
  const [rights, setRights] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [musicError, setMusicError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The meters, at the screen's pace, while the desk is on — and the
  // header line with them, since the noise filter can change its mind.
  useEffect(() => {
    if (!on || !desk) return;
    let raf = 0;
    const tick = () => {
      setMeters(desk.meters());
      const noise = desk.state.noiseFilter;
      const preset = desk.voice.preset;
      setShaping((cur) => (cur && cur.desk === desk && cur.noise === noise && cur.preset === preset ? cur : { desk, noise, preset }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, desk]);
  const shapingNow = on && desk && shaping?.desk === desk ? shaping : null;

  const level = (which: keyof DeskLevels, v: number) => {
    desk?.setLevel(which, v);
    onSettings({ ...settings, levels: { ...settings.levels, [which]: v } });
  };
  const pad = (id: PadId) => {
    setPressed(id);
    setTimeout(() => setPressed((p) => (p === id ? null : p)), 220);
    void desk?.playPad(id);
  };

  if (encoder) {
    return (
      <div className="px-4 pt-4 pb-4">
        <div className="rounded-[12px] bg-white/[0.04] p-4">
          <p className={LABEL}>Sound</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            You&apos;re broadcasting from an encoder, so your sound is mixed there — OBS has its own mixer, filters and sound board. The desk
            here works when you go live from the browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 pt-4 pb-4">
      <div className="rounded-[12px] bg-white/[0.045] px-3.5 py-1.5">
        <SwitchField
          label="Audio desk"
          description={on ? "Your mic goes out through the desk." : "A noise gate, voice polish, sound pads and a music bed. Off, your mic goes out as it is."}
          checked={on}
          disabled={starting}
          onCheckedChange={onToggle}
        />
        {shapingNow && (
          <p className="-mt-1 pb-2.5 text-[11.5px] text-muted-foreground">
            <span className={cn("font-medium", shapingNow.noise === "on" ? "text-foreground/85" : shapingNow.noise === "unavailable" ? "text-warning" : undefined)}>
              {NOISE_LINE[shapingNow.noise]}
            </span>
            <span aria-hidden> · </span>
            {presetLabel(shapingNow.preset)} voice
          </p>
        )}
      </div>

      {on && (
        <>
          <section aria-label="Levels" className="space-y-2">
            <Meter label="Mic" level={meters.mic} />
            <Meter label="Out" level={meters.out} />
          </section>

          <section aria-labelledby="desk-mic" className="space-y-4">
            <p id="desk-mic" className={LABEL}>
              Your voice
            </p>
            <Fader id="desk-mic-level" label="Mic" value={settings.levels.mic} onChange={(v) => level("mic", v)} />
            <div className="-my-1 divide-y divide-white/[0.05]">
              <SwitchField
                label="Noise gate"
                description="Quiets the room between your words."
                checked={settings.gate}
                onCheckedChange={(v) => {
                  desk?.setGate(v);
                  onSettings({ ...settings, gate: v });
                }}
              />
              <SwitchField
                label="Voice polish"
                description="Cuts rumble and evens out your level."
                checked={settings.polish}
                onCheckedChange={(v) => {
                  desk?.setPolish(v);
                  onSettings({ ...settings, polish: v });
                }}
              />
            </div>
          </section>

          <section aria-labelledby="desk-pads">
            <div className="mb-2.5 flex items-baseline justify-between">
              <p id="desk-pads" className={LABEL}>
                Pads
              </p>
              <span className="text-[11.5px] text-muted-foreground">Everyone hears them</span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {PADS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pad(p.id)}
                  className={cn(
                    "press flex aspect-square flex-col items-center justify-center gap-1 rounded-[12px] text-center transition-colors",
                    pressed === p.id ? "bg-ember text-on-ember" : "bg-white/[0.06] hover:bg-white/[0.1]"
                  )}
                >
                  <span aria-hidden className="text-[22px] leading-none">
                    {p.emoji}
                  </span>
                  <span className="px-1 text-[10.5px] leading-tight font-semibold">{p.label}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-4">
              <Fader id="desk-pads-level" label="Pads" value={settings.levels.pads} onChange={(v) => level("pads", v)} />
            </div>
            <div className="mt-2 -mb-1 divide-y divide-white/[0.05]">
              <SwitchField
                label="Ka-ching for big gifts"
                description="Plays when a gift of $5 or more lands."
                checked={moments.giftFromMinor > 0}
                onCheckedChange={(v) => onMoments({ ...moments, giftFromMinor: v ? 500 : 0 })}
              />
              <SwitchField
                label="Airhorn when you win a battle"
                checked={moments.battleWin}
                onCheckedChange={(v) => onMoments({ ...moments, battleWin: v })}
              />
            </div>
          </section>

          <section aria-labelledby="desk-music" className="space-y-3">
            <p id="desk-music" className={LABEL}>
              Music bed
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file || !desk) return;
                desk.loadMusic(file);
                setTrack(file);
                setPlaying(false);
                setMusicError(null);
              }}
            />
            {track ? (
              <div className="flex items-center gap-2 rounded-[12px] bg-white/[0.045] py-2 pr-1.5 pl-3">
                <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{track.name}</p>
                <button
                  type="button"
                  disabled={!rights}
                  title={rights ? undefined : "Confirm you have the rights first"}
                  onClick={async () => {
                    if (!desk) return;
                    setMusicError(null);
                    if (desk.musicPlaying) {
                      desk.pauseMusic();
                      setPlaying(false);
                      return;
                    }
                    try {
                      await desk.playMusic();
                      setPlaying(true);
                    } catch {
                      setMusicError("That file won't play here — try an MP3 or M4A.");
                    }
                  }}
                  className="press flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white px-3 text-[12px] font-bold text-[#0b0708] disabled:opacity-40"
                >
                  {playing ? <Pause size={12} weight="fill" /> : <Play size={12} weight="fill" />}
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  aria-label="Remove the track"
                  onClick={() => {
                    desk?.unloadMusic();
                    setTrack(null);
                    setPlaying(false);
                  }}
                  className="press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
                >
                  <X size={13} weight="bold" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="press flex h-9 items-center rounded-full bg-white/[0.07] px-3.5 text-[12.5px] font-semibold hover:bg-white/[0.11]"
              >
                Choose a track from this computer
              </button>
            )}
            <label className="flex items-start gap-2.5 text-[12.5px] leading-snug">
              <input
                type="checkbox"
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ember)]"
              />
              <span>
                I have the rights to play this on stream.
                <span className="block text-[11.5px] text-muted-foreground">It plays from here — nothing is uploaded — and dips while you talk.</span>
              </span>
            </label>
            {musicError && <p className="text-[12px] text-chili-hi">{musicError}</p>}
            <Fader id="desk-music-level" label="Music" value={settings.levels.music} onChange={(v) => level("music", v)} />
            <div>
              <SwitchField
                label="Dip the music when I talk"
                checked={settings.duck}
                onCheckedChange={(v) => {
                  desk?.setDuck(v);
                  onSettings({ ...settings, duck: v });
                }}
              />
            </div>
            <Fader
              id="desk-monitor-level"
              label="In your ears"
              value={settings.levels.monitor}
              onChange={(v) => level("monitor", v)}
              hint="What you hear of pads and music. Wear headphones, or your mic picks it up twice."
            />
          </section>
        </>
      )}

      {guests.length > 0 && (
        <section aria-labelledby="desk-guests" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p id="desk-guests" className={LABEL}>
              Guests
            </p>
            <span className="text-[11.5px] text-muted-foreground">Everyone hears these levels</span>
          </div>
          {guests.map((g) => (
            <div key={g.userId} className="flex items-center gap-3">
              <UserAvatar src={g.avatar} name={g.username} size={28} className="size-7 shrink-0" />
              <div className="min-w-0 flex-1">
                <Fader id={`desk-guest-${g.userId}`} label={g.username} value={gains[g.userId] ?? 1} onChange={(v) => onGain(g.userId, v)} />
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
