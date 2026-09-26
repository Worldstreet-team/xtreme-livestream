"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CaretUp, Lock, PaperPlaneRight, Trash } from "@/components/icons";
import { durationLabel } from "@/lib/messaging";
import { cn } from "@/lib/utils";
import { EASE, done, play, reducedMotion } from "./motion";

/**
 * Voice notes, recorded in the browser.
 *
 * MediaRecorder captures the audio; an analyser samples the level every
 * 60ms, which feeds the live bars while you speak and becomes the note's
 * `peaks` when it's sent — the waveform WorldSpace draws on the other side.
 * Five minutes at most; it sends itself at the limit rather than losing it.
 *
 * Hold & slide (the owner's pick, voice C): hold the mic and it swells into
 * a Chili orb while the recorder unfurls leftward out of it, the waveform
 * rising bar by bar from the right. Slide left to cancel — the hint follows
 * your thumb, a bin opens, the take shrinks into it and the lid shuts.
 * Slide up to lock and talk hands-free. Let go and it folds back into the
 * mic as the note springs up in the thread. A tap records hands-free.
 */

const SAMPLE_MS = 60;
const LIVE_BARS = 40;
const PEAKS_OUT = 64;
export const MAX_VOICE_SEC = 5 * 60;
/** How far to slide: left to throw the take away, up to keep it going hands-free. */
export const CANCEL_PX = 110;
export const LOCK_PX = 70;

/** One bar of the live waveform; its id keeps it the same bar as newer ones push in. */
export interface Level {
  id: number;
  v: number;
}

export interface VoiceClip {
  blob: Blob;
  durationSec: number;
  peaks: number[];
  mimeType: string;
}

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const t of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

/** Squash many samples into `n` peaks, normalised so the loudest is 1. */
function downsample(samples: number[], n: number): number[] {
  if (!samples.length) return [];
  const out = Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * samples.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / n));
    return samples.slice(from, to).reduce((a, b) => Math.max(a, b), 0);
  });
  const max = Math.max(...out, 0.001);
  return out.map((v) => Math.round((v / max) * 100) / 100);
}

export function useVoiceRecorder(onLimit: () => void) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Empty to start: the bars arrive one by one from the right as you talk.
  const [levels, setLevels] = useState<Level[]>([]);
  const nextBar = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const chunks = useRef<Blob[]>([]);
  const samples = useRef<number[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const onLimitRef = useRef(onLimit);
  useEffect(() => {
    onLimitRef.current = onLimit;
  }, [onLimit]);

  const release = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    recorder.current = null;
    setRecording(false);
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("This browser can't record voice notes");
      return false;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = media;
      const mimeType = pickMime();
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      chunks.current = [];
      samples.current = [];
      rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      rec.start(250);
      recorder.current = rec;

      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        audioCtx.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(media).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        startedAt.current = Date.now();
        ticker.current = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          // RMS, lifted so a normal speaking voice fills most of the bar.
          const level = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
          samples.current.push(level);
          const bar = { id: nextBar.current++, v: Math.max(0.08, level) };
          setLevels((cur) => [...cur.slice(-(LIVE_BARS - 1)), bar]);
          const sec = (Date.now() - startedAt.current) / 1000;
          setElapsed(sec);
          if (sec >= MAX_VOICE_SEC) onLimitRef.current();
        }, SAMPLE_MS);
      } else {
        startedAt.current = Date.now();
        ticker.current = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 250);
      }
      setElapsed(0);
      setRecording(true);
      return true;
    } catch (err) {
      release();
      const name = (err as { name?: string })?.name;
      setError(name === "NotAllowedError" ? "Your microphone is blocked for this site" : "Couldn't start recording");
      return false;
    }
  }, [release]);

  /** Stop and hand back the clip (or nothing, when cancelled or too short). */
  const stop = useCallback(
    (keep: boolean) =>
      new Promise<VoiceClip | null>((resolve) => {
        const rec = recorder.current;
        const durationSec = (Date.now() - startedAt.current) / 1000;
        if (!rec) {
          release();
          return resolve(null);
        }
        rec.onstop = () => {
          const mimeType = rec.mimeType || "audio/webm";
          const blob = new Blob(chunks.current, { type: mimeType });
          const peaks = downsample(samples.current, PEAKS_OUT);
          release();
          setLevels([]);
          // Under half a second is a slip of the thumb, not a note.
          resolve(keep && durationSec >= 0.5 && blob.size > 0 ? { blob, durationSec, peaks, mimeType } : null);
        };
        try {
          rec.stop();
        } catch {
          release();
          resolve(null);
        }
      }),
    [release],
  );

  return { recording, elapsed, levels, error, clearError: () => setError(null), start, stop };
}

/** The live waveform: bars rise from the right as your voice comes in. */
function Wave({ levels, className }: { levels: Level[]; className?: string }) {
  return (
    <span aria-hidden className={cn("flex h-7 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden", className)}>
      {levels.map((l) => (
        <span
          key={l.id}
          className="rec-bar-in w-[3px] shrink-0 rounded-full bg-foreground/80"
          style={{ height: `${Math.round(Math.max(0.1, l.v) * 100)}%` }}
        />
      ))}
    </span>
  );
}

/** The composer while you record hands-free: discard, the clock, your voice, send. */
export function RecorderBar({
  elapsed,
  levels,
  onCancel,
  onSend,
}: {
  elapsed: number;
  levels: Level[];
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div className="msg-fade flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        aria-label="Discard voice note"
        className="msg-press flex size-11 shrink-0 items-center justify-center rounded-full bg-control text-chili-hi hover:bg-control-hover"
      >
        <Trash size={19} />
      </button>
      <div className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-[24px] bg-white/[0.06] pr-4 pl-4">
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden className="rec-blink size-2.5 rounded-full bg-chili" />
          <span className="text-[14px] font-semibold text-foreground tabular-nums" aria-live="off">
            {durationLabel(elapsed)}
          </span>
        </span>
        <Wave levels={levels} />
        <span className="sr-only">Recording a voice note</span>
      </div>
      <button
        type="button"
        onClick={onSend}
        aria-label="Send voice note"
        className="msg-press flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-[#0b0708] hover:bg-white/90"
      >
        <PaperPlaneRight size={19} weight="fill" />
      </button>
    </div>
  );
}

/**
 * The recorder while you hold the mic: it unfurls leftward out of the orb.
 * `dx` is how far your thumb has slid left (the hint follows it). When
 * you cancel, the take goes into a bin; when you let go, it folds back into
 * the mic. `onDone` runs once it has gone. Leaving, it's given the take as
 * it was when you let go: the recorder has already moved on.
 */
export function HoldRecorder({
  phase,
  elapsed,
  levels,
  dx,
  onDone,
}: {
  phase: "hold" | "cancel" | "send";
  elapsed: number;
  levels: Level[];
  dx: number;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const takeRef = useRef<HTMLSpanElement>(null);
  const binRef = useRef<SVGSVGElement>(null);
  const lidRef = useRef<SVGGElement>(null);
  const hintRef = useRef<HTMLSpanElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useLayoutEffect(() => {
    play(rootRef.current, [{ clipPath: "inset(0 0 0 100% round 22px)" }, { clipPath: "inset(0 0 0 0 round 22px)" }], 280, EASE.glide);
  }, []);

  useLayoutEffect(() => {
    if (phase === "hold") return;
    const root = rootRef.current;
    const fold = () => done(play(root, [{ clipPath: "inset(0 0 0 0 round 22px)" }, { clipPath: "inset(0 0 0 100% round 22px)" }], 200, EASE.in, 0, { fill: "forwards" }));
    let live = true;
    void (async () => {
      if (reducedMotion()) return;
      if (phase === "cancel") {
        const bin = binRef.current;
        const take = takeRef.current;
        if (bin && take) {
          // The bin opens, the take shrinks into it, the lid shuts, the bin drops.
          bin.style.visibility = "visible";
          play(hintRef.current, [{ opacity: Number(getComputedStyle(hintRef.current!).opacity) }, { opacity: 0 }], 120, EASE.in, 0, { fill: "forwards" });
          play(lidRef.current, [{ transform: "rotate(-35deg)" }, { transform: "rotate(-35deg)" }], 1, EASE.out, 0, { fill: "forwards" });
          await done(play(bin, [{ transform: "scale(0)", opacity: 0 }, { transform: "none", opacity: 1 }], 180, EASE.out, 0, { fill: "forwards" }));
          const b = bin.getBoundingClientRect();
          const t = take.getBoundingClientRect();
          await done(
            play(take, [{ transform: "none", opacity: 1 }, { transform: `translateX(${b.left + b.width / 2 - t.left}px) scale(0)`, opacity: 0 }], 280, EASE.in, 0, {
              fill: "forwards",
            }),
          );
          await done(play(lidRef.current, [{ transform: "rotate(-35deg)" }, { transform: "rotate(0deg)" }], 160, EASE.out, 0, { fill: "forwards" }));
          await done(play(bin, [{ transform: "none", opacity: 1 }, { transform: "translateY(10px)", opacity: 0 }], 180, EASE.in, 0, { fill: "forwards" }));
        }
      }
      await fold();
    })().then(() => live && doneRef.current());
    return () => {
      live = false;
    };
  }, [phase]);

  const pull = Math.min(1, -dx / CANCEL_PX);
  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-y-0 right-[52px] left-0 z-10 flex items-center gap-3 overflow-hidden rounded-[22px] bg-control pr-4 pl-4"
    >
      <span ref={takeRef} className="flex min-w-0 flex-1 items-center gap-3" style={{ transformOrigin: "0 50%" }}>
        <span className="flex shrink-0 items-center gap-2">
          <span aria-hidden className="rec-blink size-2.5 rounded-full bg-chili" />
          <span className="text-[14px] font-semibold text-foreground tabular-nums" aria-live="off">
            {durationLabel(elapsed)}
          </span>
        </span>
        <span
          ref={hintRef}
          className="shrink-0 text-[12.5px] whitespace-nowrap text-muted-foreground"
          style={{ transform: `translateX(${dx * 0.5}px)`, opacity: 1 - pull * 0.9 }}
        >
          ‹ Slide to cancel
        </span>
        <Wave levels={levels} className="h-6" />
      </span>
      {/* The bin the take goes into when you slide it away. */}
      <svg
        ref={binRef}
        aria-hidden
        viewBox="0 0 24 24"
        className="invisible absolute top-1/2 left-3.5 size-6 -translate-y-1/2 text-chili-hi"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g ref={lidRef} style={{ transformOrigin: "5px 7px", transformBox: "view-box" }}>
          <path d="M4 7h16M9.5 7V4.5h5V7" />
        </g>
        <path d="M6.5 7.5l1 12h9l1-12" />
      </svg>
      <span className="sr-only">Recording a voice note. Slide left to cancel, up to lock.</span>
    </div>
  );
}

/** Above the orb while you hold: slide up to lock. */
export function LockHint({ dy }: { dy: number }) {
  const lift = Math.max(-LOCK_PX, dy) * 0.35;
  return (
    <span
      aria-hidden
      className="msg-lock-in pointer-events-none absolute right-0 bottom-[60px] z-10 flex h-[58px] w-11 flex-col items-center justify-center gap-0.5 rounded-full bg-surface-raised text-muted-foreground shadow-[0_10px_30px_-12px_rgba(0,0,0,0.9)]"
      style={{ transform: `translateY(${lift}px)` }}
    >
      <Lock size={16} />
      <CaretUp size={12} className="opacity-60" />
    </span>
  );
}
