"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PaperPlaneRight, Trash } from "@/components/icons";
import { durationLabel } from "@/lib/messaging";

/**
 * Voice notes, recorded in the browser.
 *
 * MediaRecorder captures the audio; an analyser samples the level every
 * 60ms, which feeds the live bars while you speak and becomes the note's
 * `peaks` when it's sent — the waveform WorldSpace draws on the other side.
 * Five minutes at most; it sends itself at the limit rather than losing it.
 */

const SAMPLE_MS = 60;
const LIVE_BARS = 32;
const PEAKS_OUT = 64;
export const MAX_VOICE_SEC = 5 * 60;

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
  const [levels, setLevels] = useState<number[]>(() => Array(LIVE_BARS).fill(0.08));
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
          setLevels((cur) => [...cur.slice(1), Math.max(0.08, level)]);
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
          setLevels(Array(LIVE_BARS).fill(0.08));
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

/** The composer while you record: discard, the clock, your voice, send. */
export function RecorderBar({
  elapsed,
  levels,
  onCancel,
  onSend,
}: {
  elapsed: number;
  levels: number[];
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
        <span aria-hidden className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden">
          {levels.map((v, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-foreground/80 transition-[height] duration-75"
              style={{ height: `${Math.round(Math.max(0.1, v) * 100)}%` }}
            />
          ))}
        </span>
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
