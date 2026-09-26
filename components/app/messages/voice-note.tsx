"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "@/components/icons";
import { cn } from "@/lib/utils";
import { durationLabel, waveformBars } from "@/lib/messaging";

const BARS = 34;
const SPEEDS = [1, 1.5, 2] as const;

/**
 * A voice note: play, a waveform you can scrub, the time, and the speed.
 * The bars are the note's own peaks (WorldSpace records them), or a stable
 * shape from its id when it has none. In your own Ember bubble everything
 * reads in Ember's dark ink; in theirs, in white.
 */
export function VoiceNote({
  id,
  src,
  durationSec,
  peaks,
  mine,
}: {
  id: string;
  src: string;
  durationSec?: number;
  peaks?: number[];
  mine: boolean;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [bars] = useState(() => waveformBars(peaks, BARS, id));

  // One note at a time, like every chat app: starting this one stops the rest.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onOther = (e: Event) => {
      if ((e as CustomEvent<HTMLAudioElement>).detail !== el) el.pause();
    };
    window.addEventListener("xtream-voice-play", onOther);
    return () => window.removeEventListener("xtream-voice-play", onOther);
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      window.dispatchEvent(new CustomEvent("xtream-voice-play", { detail: el }));
      el.playbackRate = speed;
      void el.play().catch(() => setPlaying(false));
    } else el.pause();
  };

  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setProgress(ratio);
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const remaining = playing || progress > 0 ? duration * (1 - progress) : duration;

  return (
    <div className="flex w-[min(15.5rem,62vw)] items-center gap-2.5 py-0.5" onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setProgress(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (duration) setProgress(Math.min(1, el.currentTime / duration));
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={cn(
          "msg-press flex size-9 shrink-0 items-center justify-center rounded-full",
          mine ? "bg-on-ember text-ember" : "bg-white text-[#0b0708]",
        )}
      >
        {playing ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" className="translate-x-px" />}
      </button>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Voice note position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(progress * duration)}
        onPointerDown={seek}
        onKeyDown={(e) => {
          const el = audioRef.current;
          if (!el || !duration) return;
          if (e.key === "ArrowRight") el.currentTime = Math.min(duration, el.currentTime + 3);
          if (e.key === "ArrowLeft") el.currentTime = Math.max(0, el.currentTime - 3);
        }}
        className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ember/60 rounded"
      >
        {bars.map((v, i) => {
          const played = (i + 0.5) / BARS <= progress;
          return (
            <span
              key={i}
              aria-hidden
              style={{ height: `${Math.round(v * 100)}%` }}
              className={cn(
                "w-[3px] shrink-0 rounded-full transition-colors duration-150",
                mine ? (played ? "bg-on-ember" : "bg-on-ember/30") : played ? "bg-white" : "bg-white/30",
              )}
            />
          );
        })}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={cn("text-[11.5px] font-medium tabular-nums", mine ? "text-on-ember/80" : "text-white/70")}>
          {durationLabel(remaining)}
        </span>
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}×`}
          className={cn(
            "msg-press rounded-full px-1.5 text-[10.5px] leading-4 font-bold tabular-nums",
            mine ? "bg-on-ember/15 text-on-ember" : "bg-white/10 text-white/80",
          )}
        >
          {speed}×
        </button>
      </span>
    </div>
  );
}
