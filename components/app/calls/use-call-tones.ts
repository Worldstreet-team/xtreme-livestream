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
 */

const RING = { a: 660, b: 520, on: 1.0, gap: 2.0, gain: 0.16 };
const RINGBACK = { a: 420, b: 0, on: 1.1, gap: 2.9, gain: 0.09 };

type AudioCtor = typeof AudioContext;

export function useCallTones(state: Pick<CallState, "status" | "isIncoming">) {
  const ctxRef = useRef<AudioContext | null>(null);
  const mode = state.status === "ringing" ? (state.isIncoming ? "incoming" : "outgoing") : null;

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
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const pulse = () => {
      if (cancelled || ctx.state === "closed") return;
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      // Soft edges: a square gate on a sine reads as a click.
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(cfg.gain, now + 0.04);
      gain.gain.setValueAtTime(cfg.gain, now + cfg.on - 0.06);
      gain.gain.linearRampToValueAtTime(0, now + cfg.on);
      for (const freq of [cfg.a, cfg.b].filter(Boolean)) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + cfg.on + 0.02);
      }
      timer = setTimeout(pulse, (cfg.on + cfg.gap) * 1000);
    };
    pulse();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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
