"use client";

import { useEffect, useRef } from "react";
import type { CallState } from "@/lib/call-manager";

/**
 * Call tones, synthesized with Web Audio (WorldSpace's, so both apps sound
 * the same). A ringtone is two sine waves and an envelope: no media files to
 * license, preload or fetch at the exact moment a call is negotiating.
 *
 * Two patterns you can tell apart without looking:
 *  - incoming — a warbling two-tone ring, the one that means "answer me"
 *  - outgoing — a single low ringback pulse, the one in the earpiece
 *
 * The ring on screen beats in time with them (the owner's pick, 2026-09-26):
 * both read one clock, ringClock(), so picture and sound start together and
 * never drift apart. Pulses go onto the audio clock a couple of seconds
 * ahead, so a busy or backgrounded tab keeps the beat.
 */

export const RING = { a: 660, b: 520, on: 1.0, gap: 2.0, gain: 0.16 };
export const RINGBACK = { a: 420, b: 0, on: 1.1, gap: 2.9, gain: 0.09 };

export type RingMode = "incoming" | "outgoing";
/** One cycle of each, in ms: the tone, then its quiet. */
export const RING_CYCLE_MS: Record<RingMode, number> = {
  incoming: (RING.on + RING.gap) * 1000,
  outgoing: (RINGBACK.on + RINGBACK.gap) * 1000,
};

const clock = { mode: null as RingMode | null, start: 0 };

/** When this ringing began (page time): whichever of the tone and the ring asks first starts it. */
export function ringClock(mode: RingMode): number {
  if (clock.mode !== mode) {
    clock.mode = mode;
    clock.start = performance.now();
  }
  return clock.start;
}

type AudioCtor = typeof AudioContext;

/** One ring of the tone at `at` on the audio clock, soft-edged (a square gate on a sine reads as a click). */
function pulse(ctx: AudioContext, out: AudioNode, cfg: typeof RING, at: number) {
  const gain = ctx.createGain();
  gain.connect(out);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(cfg.gain, at + 0.04);
  gain.gain.setValueAtTime(cfg.gain, at + cfg.on - 0.06);
  gain.gain.linearRampToValueAtTime(0, at + cfg.on);
  for (const freq of [cfg.a, cfg.b].filter(Boolean)) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + cfg.on + 0.02);
  }
}

export function useCallTones(state: Pick<CallState, "status" | "isIncoming">) {
  const ctxRef = useRef<AudioContext | null>(null);
  const mode: RingMode | null = state.status === "ringing" ? (state.isIncoming ? "incoming" : "outgoing") : null;

  useEffect(() => {
    if (!mode || typeof window === "undefined") return;
    const Ctor: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    const ctx = ctxRef.current;
    // Autoplay policy suspends a context made without a gesture; an incoming
    // call has none, so ask and carry on if refused.
    void ctx.resume().catch(() => {});

    const cfg = mode === "incoming" ? RING : RINGBACK;
    const period = cfg.on + cfg.gap;
    // Everything goes through one gain, so hanging up silences what's queued too.
    const out = ctx.createGain();
    out.connect(ctx.destination);
    // The first ring lands where the clock started (the picture may have asked first).
    const t0 = ctx.currentTime + (ringClock(mode) - performance.now()) / 1000;
    let n = 0;
    const schedule = () => {
      if (ctx.state === "closed") return;
      const horizon = ctx.currentTime + 2.5;
      for (; t0 + n * period < horizon; n++) pulse(ctx, out, cfg, Math.max(ctx.currentTime, t0 + n * period));
    };
    schedule();
    const timer = setInterval(schedule, 500);

    return () => {
      clearInterval(timer);
      out.disconnect();
      if (clock.mode === mode) clock.mode = null;
    };
  }, [mode]);

  // Release the audio hardware once calling is over.
  useEffect(() => {
    if (state.status !== "idle") return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctxRef.current = null;
    void ctx.close().catch(() => {});
  }, [state.status]);
}
