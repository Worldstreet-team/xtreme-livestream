"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalVideoTrack } from "livekit-client";
import { apiFetch } from "@/lib/api-client";
import {
  assess,
  assessEncoder,
  encoderSample,
  summarize,
  toSample,
  type EncoderReading,
  type HealthSample,
  type Limitation,
  type RawSenderStats,
} from "@/lib/stream-health";

const POLL_MS = 2_000;
const WINDOW_MS = 30_000;
/** A minute of samples on hand — the sparkline's width. */
const KEEP = 30;
const LIMITS: Limitation[] = ["cpu", "bandwidth", "other"];

/**
 * The studio's broadcast, read every 2 s from WebRTC's sender stats: the
 * verdict now, the last minute of samples, and every 30 s a summary sent to
 * the API for the report afterwards. `track` hands over whatever is being
 * sent — the shared screen, else the camera — at the moment of reading.
 */
export function useStreamHealth(track: () => LocalVideoTrack | null, { active, streamId }: { active: boolean; streamId: string | null }) {
  const [samples, setSamples] = useState<HealthSample[]>([]);
  const prev = useRef<RawSenderStats | null>(null);
  const pending = useRef<HealthSample[]>([]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;

    const read = async () => {
      const t = track();
      if (!t) return;
      const layers = await t.getSenderStats().catch(() => []);
      if (stopped || layers.length === 0) return;
      // Simulcast sends a layer per quality; the top one is what the best
      // viewers get, and the bytes add up across them all.
      const top = layers.reduce((a, l) => ((l.frameHeight ?? 0) > (a.frameHeight ?? 0) ? l : a));
      const reason = top.qualityLimitationReason as Limitation | undefined;
      const next: RawSenderStats = {
        at: Date.now(),
        bytesSent: layers.reduce((a, l) => a + (l.bytesSent ?? 0), 0),
        fps: top.framesPerSecond ?? 0,
        width: top.frameWidth ?? 0,
        height: top.frameHeight ?? 0,
        roundTripTime: layers.find((l) => l.roundTripTime !== undefined)?.roundTripTime,
        packetsSent: layers.reduce((a, l) => a + (l.packetsSent ?? 0), 0),
        packetsLost: layers.reduce((a, l) => a + (l.packetsLost ?? 0), 0),
        limitation: reason && LIMITS.includes(reason) ? reason : "none",
      };
      const sample = toSample(prev.current, next);
      prev.current = next;
      if (!sample) return;
      pending.current.push(sample);
      setSamples((cur) => [...cur, sample].slice(-KEEP));
    };

    const poll = setInterval(() => void read(), POLL_MS);
    const flush = setInterval(() => {
      const window = summarize(pending.current);
      pending.current = [];
      if (window && streamId) {
        apiFetch(`/api/streams/${streamId}/health`, { method: "POST", body: JSON.stringify({ window }) }).catch(() => {
          // A missed half-minute only thins the report.
        });
      }
    }, WINDOW_MS);

    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(flush);
      prev.current = null;
      pending.current = [];
      setSamples([]);
    };
  }, [active, streamId, track]);

  const verdict = useMemo(() => assess(samples), [samples]);
  return { samples, verdict: active ? verdict : null };
}

const ENCODER_POLL_MS = 5_000;
/** A minute of an encoder's readings, at one every 5 s. */
const ENCODER_KEEP = 12;

/**
 * The same, for a broadcast from an encoder (OBS and the like): there are no
 * sender stats in the browser, so the studio asks the API what LiveKit's
 * ingress is receiving, every 5 s. The half-minute summaries go to the same
 * report.
 */
export function useEncoderHealth({ active, streamId }: { active: boolean; streamId: string | null }) {
  const [readings, setReadings] = useState<EncoderReading[]>([]);
  const pending = useRef<HealthSample[]>([]);

  useEffect(() => {
    if (!active || !streamId) return;
    let stopped = false;

    const read = async () => {
      try {
        const r = await apiFetch<{ data: { reading: EncoderReading | null } }>(`/api/streams/${streamId}/encoder`);
        if (stopped || !r.data.reading) return;
        const reading = { ...r.data.reading, at: Date.now() };
        if (reading.status === "publishing" && reading.video) pending.current.push(encoderSample(reading));
        setReadings((cur) => [...cur, reading].slice(-ENCODER_KEEP));
      } catch {
        // The next poll asks again.
      }
    };

    void read();
    const poll = setInterval(() => void read(), ENCODER_POLL_MS);
    const flush = setInterval(() => {
      const window = summarize(pending.current);
      pending.current = [];
      if (window) {
        apiFetch(`/api/streams/${streamId}/health`, { method: "POST", body: JSON.stringify({ window }) }).catch(() => {
          // A missed half-minute only thins the report.
        });
      }
    }, WINDOW_MS);

    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(flush);
      pending.current = [];
      setReadings([]);
    };
  }, [active, streamId]);

  const verdict = useMemo(() => assessEncoder(readings), [readings]);
  const samples = useMemo(() => readings.filter((r) => r.status === "publishing" && r.video).map(encoderSample), [readings]);
  return { samples, verdict: active ? verdict : null, reading: readings[readings.length - 1] ?? null };
}
