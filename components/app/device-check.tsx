"use client";

import { useEffect, useRef, useState } from "react";
import { Microphone, MicrophoneSlash, VideoCamera, VideoCameraSlash } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { Tip } from "@/components/ui/tip";
import type { AttachableVideoTrack } from "@/components/app/stage-tile";
import { cn } from "@/lib/utils";

/** The meter's bars, and the RMS that lights them all. */
const BARS = 12;
const FULL_RMS = 0.25;
/** RMS above this counts as "picking you up" — a voice in a quiet room lands well over it, room tone under. */
const HEARD_RMS = 0.03;
/** How long a peak keeps the status line on "picking you up". */
const HEARD_FOR_MS = 2000;

/**
 * "Is my camera on, is my mic picking me up?" — a mirrored preview of a
 * local video track and a level meter on a local audio track. A leaf: it
 * owns the elements it renders into and the analyser it listens with, and
 * nothing else — no room, no API. Backstage builds on it; a pre-live check
 * could too.
 */
export function DeviceCheck({
  video,
  audio,
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  className,
}: {
  /** My published camera track (LiveKit's LocalVideoTrack), or null before it's up or while it's off. */
  video: AttachableVideoTrack | null;
  /** My mic as a MediaStreamTrack (a LocalAudioTrack's `.mediaStreamTrack`), or null. */
  audio: MediaStreamTrack | null;
  micOn: boolean;
  camOn: boolean;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  /** How many bars the analyser last lit, 0..BARS — shown only while it's listening. */
  const [lit, setLit] = useState(0);
  /** Something crossed the threshold in the last couple of seconds. */
  const [heard, setHeard] = useState(false);
  /** The meter listens while there's a mic and it's on; otherwise it reads flat. */
  const listening = Boolean(audio) && micOn;

  // The preview: attach on arrival, release on change or unmount.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !video || !camOn) return;
    video.attach(el);
    return () => {
      video.detach(el);
    };
  }, [video, camOn]);

  // The meter: an analyser on the mic, read every frame, never played back
  // (the analyser isn't wired to the speakers, so no echo). Torn down and
  // rebuilt whenever the track changes — LiveKit hands out a new one after
  // an unmute — and idle while the mic is off.
  useEffect(() => {
    if (!audio || !micOn) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      // No Web Audio here (an old WebView): the preview still works, the meter stays flat.
      return;
    }
    const source = ctx.createMediaStreamSource(new MediaStream([audio]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let raf = 0;
    let lastHeard = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      // Only a change in lit bars re-renders — not every frame.
      const next = Math.min(BARS, Math.round((rms / FULL_RMS) * BARS));
      setLit((cur) => (cur === next ? cur : next));
      const now = performance.now();
      if (rms >= HEARD_RMS) lastHeard = now;
      const heardNow = now - lastHeard < HEARD_FOR_MS;
      setHeard((cur) => (cur === heardNow ? cur : heardNow));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Some browsers start a context suspended until a gesture; the tap that
    // put us here counts, and resuming is a no-op otherwise.
    void ctx.resume().catch(() => {});
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => {});
    };
  }, [audio, micOn]);

  const showingVideo = Boolean(video) && camOn;
  const litNow = listening ? lit : 0;
  const heardNow = listening && heard;
  const status = !micOn
    ? "Mic's off"
    : heardNow
      ? "Mic's picking you up"
      : "Mic's quiet — say something, or check it's not muted";

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* The preview: mirrored, like a mirror — what people expect to see of themselves. */}
      <div className="relative aspect-video overflow-hidden rounded-[12px] bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={cn("size-full -scale-x-100 object-cover", !showingVideo && "hidden")}
        />
        {!showingVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-white/60">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/[0.08]">
              {camOn ? <VideoCamera size={19} /> : <VideoCameraSlash size={19} />}
            </span>
            <span className="text-[12.5px] font-semibold">{camOn ? "Starting your camera…" : "Camera's off"}</span>
          </div>
        )}
        {showingVideo && (
          <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">You</span>
        )}
      </div>

      {/* The meter: twelve bars, ember as they light, and a line saying what they mean. */}
      <div className="flex items-center gap-3 rounded-[12px] bg-white/[0.045] px-3.5 py-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            micOn ? "bg-white/[0.06] text-foreground" : "bg-chili/15 text-chili-hi"
          )}
        >
          {micOn ? <Microphone size={17} /> : <MicrophoneSlash size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex h-4 items-end gap-[3px]" aria-hidden>
            {Array.from({ length: BARS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "w-full rounded-[2px] transition-colors duration-75",
                  i < litNow ? "bg-ember" : "bg-white/[0.1]"
                )}
                // Bars rise across the meter, so a whisper reads low and a shout reads tall.
                style={{ height: `${40 + (i / (BARS - 1)) * 60}%` }}
              />
            ))}
          </div>
          <p role="status" aria-live="polite" className={cn("mt-1.5 text-[12.5px] leading-snug", heardNow ? "text-foreground" : "text-muted-foreground")}>
            {status}
          </p>
        </div>
      </div>

      {(onToggleMic || onToggleCam) && (
        <div className="flex flex-wrap gap-2">
          {onToggleMic && (
            <Tip label={micOn ? "Mute your mic" : "Unmute your mic"}>
              <Pill
                size="sm"
                variant="soft"
                tone={micOn ? "green" : "red"}
                icon={micOn ? <Microphone size={14} /> : <MicrophoneSlash size={14} />}
                onClick={onToggleMic}
                aria-pressed={micOn}
              >
                {micOn ? "Mic on" : "Mic off"}
              </Pill>
            </Tip>
          )}
          {onToggleCam && (
            <Tip label={camOn ? "Turn your camera off" : "Turn your camera on"}>
              <Pill
                size="sm"
                variant="soft"
                tone={camOn ? "green" : "red"}
                icon={camOn ? <VideoCamera size={14} /> : <VideoCameraSlash size={14} />}
                onClick={onToggleCam}
                aria-pressed={camOn}
              >
                {camOn ? "Camera on" : "Camera off"}
              </Pill>
            </Tip>
          )}
        </div>
      )}
    </div>
  );
}
