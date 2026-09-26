/**
 * Stream health (Phase 1): what the studio's sender stats say about a
 * broadcast, in words a creator can act on. Pure and framework-free on
 * purpose — the studio feeds it raw WebRTC numbers every 2 s, the API keeps
 * a 30-second summary for the report afterwards, and it's exercised by
 * services/api/test/stream-health.test.ts (the repo's only test runner).
 */

/** What the browser is holding the picture back for (WebRTC's own words). */
export type Limitation = "none" | "cpu" | "bandwidth" | "other";
export type HealthLevel = "good" | "fair" | "poor";

/** One reading of the sender, cumulative as WebRTC counts it. */
export interface RawSenderStats {
  at: number;
  /** Bytes sent so far, summed across simulcast layers. */
  bytesSent: number;
  /** The top layer's frames per second, width and height. */
  fps: number;
  width: number;
  height: number;
  /** Seconds, as the remote reports it; undefined before the first report. */
  roundTripTime?: number;
  packetsSent: number;
  packetsLost: number;
  limitation: Limitation;
}

/** A reading turned into rates. */
export interface HealthSample {
  at: number;
  kbps: number;
  fps: number;
  height: number;
  rttMs: number | null;
  /** Share of packets lost since the previous reading, 0–100. */
  lossPct: number;
  limitation: Limitation;
}

/** What to say about it. */
export interface HealthVerdict {
  level: HealthLevel;
  /** A few words for the chip ("Good", "Upload limited"). */
  label: string;
  /** One line: what's happening. */
  headline: string;
  /** One line: what to do, or null when there's nothing to do. */
  fix: string | null;
}

/** Rates between two readings; null when there's nothing to compare yet. */
export function toSample(prev: RawSenderStats | null, next: RawSenderStats): HealthSample | null {
  if (!prev) return null;
  const seconds = (next.at - prev.at) / 1000;
  if (seconds <= 0) return null;
  const sent = Math.max(0, next.packetsSent - prev.packetsSent);
  const lost = Math.max(0, next.packetsLost - prev.packetsLost);
  return {
    at: next.at,
    kbps: Math.round((Math.max(0, next.bytesSent - prev.bytesSent) * 8) / 1000 / seconds),
    fps: Math.round(next.fps),
    height: next.height,
    rttMs: next.roundTripTime === undefined ? null : Math.round(next.roundTripTime * 1000),
    lossPct: sent + lost > 0 ? Math.round((lost / (sent + lost)) * 1000) / 10 : 0,
    limitation: next.limitation,
  };
}

const RANK: Record<HealthLevel, number> = { good: 0, fair: 1, poor: 2 };
const worst = (a: HealthLevel, b: HealthLevel) => (RANK[a] >= RANK[b] ? a : b);

/** How one sample reads on its own. */
export function levelOf(s: HealthSample): HealthLevel {
  if (s.kbps < 150 || s.lossPct > 8 || (s.rttMs ?? 0) > 600 || s.fps < 10) return "poor";
  if (s.kbps < 500 || s.lossPct > 3 || (s.rttMs ?? 0) > 300 || s.fps < 20 || s.limitation !== "none") return "fair";
  return "good";
}

const mbps = (kbps: number) => (kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`);

/**
 * The last few seconds, said plainly. It judges the recent samples (the
 * last three, ~6 s) so one hiccup doesn't raise an alarm, and names the
 * one thing most worth doing.
 */
export function assess(samples: HealthSample[]): HealthVerdict {
  const recent = samples.slice(-3);
  if (recent.length === 0) return { level: "good", label: "Checking", headline: "Measuring your connection…", fix: null };
  const last = recent[recent.length - 1]!;
  // The steadier reading: a level has to hold for two of the three.
  const levels = recent.map(levelOf);
  const counts = { good: 0, fair: 0, poor: 0 };
  levels.forEach((l) => (counts[l] += 1));
  const level: HealthLevel = counts.poor >= 2 ? "poor" : counts.poor + counts.fair >= 2 ? "fair" : "good";

  if (recent.every((s) => s.kbps < 20)) {
    return { level: "poor", label: "Not sending", headline: "Nothing's reaching us from your camera.", fix: "Check your connection — or turn your camera back on." };
  }
  const limited = recent.filter((s) => s.limitation !== "none").map((s) => s.limitation);
  const why = limited.length >= 2 ? limited[limited.length - 1]! : "none";
  const lossy = recent.filter((s) => s.lossPct > 3).length >= 2;
  const slow = recent.filter((s) => (s.rttMs ?? 0) > 300).length >= 2;

  if (level === "good") {
    return { level, label: "Good", headline: `Looking good — ${last.height}p at ${last.fps} fps, ${mbps(last.kbps)}.`, fix: null };
  }
  if (why === "bandwidth" || lossy) {
    return {
      level,
      label: "Upload limited",
      headline: lossy ? `Your upload is dropping packets (${last.lossPct}%) — viewers see a lower quality.` : "Your upload is the limit — viewers see a lower quality.",
      fix: "Switch to 540p, move closer to your router, or pause other uploads.",
    };
  }
  if (why === "cpu") {
    return { level, label: "Device busy", headline: "Your device is working hard, so the picture drops frames.", fix: "Close other apps and tabs, or switch to 540p." };
  }
  if (slow) {
    return { level, label: "Slow link", headline: `Your connection is slow to answer (${last.rttMs} ms) — chat and picture may lag.`, fix: "Use Wi-Fi if you can, or move closer to your router." };
  }
  if (last.fps < 20) {
    return { level, label: "Low frame rate", headline: `The picture is running at ${last.fps} fps.`, fix: "Close other apps, and give your camera more light." };
  }
  return { level, label: "Unsteady", headline: `Sending ${mbps(last.kbps)} at ${last.height}p — it's been up and down.`, fix: "If it keeps up, switch to 540p." };
}

/** Thirty seconds of samples as one line for the report: the average, and the worst it got. */
export interface HealthWindow {
  at: number;
  kbps: number;
  fps: number;
  height: number;
  rttMs: number | null;
  lossPct: number;
  limitation: Limitation;
  level: HealthLevel;
}

export function summarize(samples: HealthSample[]): HealthWindow | null {
  if (samples.length === 0) return null;
  const avg = (f: (s: HealthSample) => number) => Math.round(samples.reduce((a, s) => a + f(s), 0) / samples.length);
  const rtts = samples.map((s) => s.rttMs).filter((v): v is number => v !== null);
  const limits = samples.map((s) => s.limitation).filter((l) => l !== "none");
  return {
    at: samples[samples.length - 1]!.at,
    kbps: avg((s) => s.kbps),
    fps: avg((s) => s.fps),
    height: Math.min(...samples.map((s) => s.height)),
    rttMs: rtts.length ? Math.round(rtts.reduce((a, v) => a + v, 0) / rtts.length) : null,
    lossPct: Math.max(...samples.map((s) => s.lossPct)),
    limitation: limits.length > samples.length / 2 ? limits[limits.length - 1]! : "none",
    level: samples.map(levelOf).reduce(worst, "good" as HealthLevel),
  };
}

/** After the broadcast: how it went, and the one change worth making next time. */
export interface HealthReport {
  minutes: number;
  avgKbps: number;
  /** Stretches of 30 s that were poor. */
  roughPatches: number;
  /** The worst 30 s, and how far into the stream it came. */
  worst: { at: number; minuteIn: number; kbps: number; lossPct: number } | null;
  advice: string;
}

export function report(windows: HealthWindow[], startedAt: number): HealthReport | null {
  if (windows.length === 0) return null;
  const poor = windows.filter((w) => w.level === "poor");
  const score = (w: HealthWindow) => w.kbps - w.lossPct * 100;
  const worstWindow = windows.reduce((a, w) => (score(w) < score(a) ? w : a));
  const bandwidth = windows.filter((w) => w.limitation === "bandwidth" || w.lossPct > 3).length;
  const cpu = windows.filter((w) => w.limitation === "cpu").length;
  const share = (n: number) => n / windows.length;
  const advice =
    poor.length === 0 && share(bandwidth) < 0.1 && share(cpu) < 0.1
      ? "A clean broadcast — nothing to change."
      : share(bandwidth) >= share(cpu)
        ? "Your upload was the limit most often. Try 540p next time, or go live from a stronger connection."
        : "Your device was the limit most often. Close other apps before you go live, or try 540p.";
  return {
    minutes: Math.round((windows.length * 30) / 60),
    avgKbps: Math.round(windows.reduce((a, w) => a + w.kbps, 0) / windows.length),
    roughPatches: poor.length,
    worst:
      worstWindow.level === "good"
        ? null
        : { at: worstWindow.at, minuteIn: Math.max(0, Math.round((worstWindow.at - startedAt) / 60_000)), kbps: worstWindow.kbps, lossPct: worstWindow.lossPct },
    advice,
  };
}

/**
 * An encoder's feed (OBS and the like), as LiveKit's ingress reports it and
 * the API relays it (GET /streams/:id/encoder). There are no sender stats
 * to read from the browser, so this is what the studio has to go on.
 */
export type EncoderStatus = "publishing" | "buffering" | "inactive" | "error";
export interface EncoderReading {
  at: number;
  protocol: "rtmp" | "whip";
  status: EncoderStatus;
  error: string;
  video: { codec: string; kbps: number; width: number; height: number; fps: number } | null;
  audio: { codec: string; kbps: number } | null;
}

/** An encoder reading as a health sample: the same chart and the same report. */
export function encoderSample(r: EncoderReading): HealthSample {
  return {
    at: r.at,
    kbps: (r.video?.kbps ?? 0) + (r.audio?.kbps ?? 0),
    fps: Math.round(r.video?.fps ?? 0),
    height: r.video?.height ?? 0,
    rttMs: null,
    lossPct: 0,
    limitation: "none",
  };
}

/**
 * What an encoder's feed says, in words a creator can act on in OBS. The
 * picture rules judge the last three readings, so one soft reading doesn't
 * raise an alarm.
 */
export function assessEncoder(readings: EncoderReading[]): HealthVerdict {
  const last = readings[readings.length - 1];
  if (!last) return { level: "good", label: "Checking", headline: "Asking your encoder how it's doing…", fix: null };
  if (last.status === "error") {
    return {
      level: "poor",
      label: "Encoder error",
      headline: last.error ? `Your encoder's feed failed: ${last.error}` : "Your encoder's feed failed.",
      fix: "Stop and start streaming in OBS — and check the server and key match this page.",
    };
  }
  if (last.status === "inactive") {
    return { level: "poor", label: "Not sending", headline: "Nothing's reaching us from your encoder.", fix: "Press Start Streaming in OBS, and check the server and key." };
  }
  if (last.status === "buffering") return { level: "fair", label: "Connecting", headline: "Your encoder is connecting…", fix: null };
  if (!last.video) {
    return { level: "fair", label: "No picture", headline: "Sound is arriving, but no picture.", fix: "Add a video source to your OBS scene." };
  }

  const recent = readings.slice(-3).filter((r) => r.status === "publishing" && r.video);
  const avg = (f: (v: NonNullable<EncoderReading["video"]>) => number) =>
    Math.round(recent.reduce((a, r) => a + f(r.video!), 0) / Math.max(1, recent.length));
  const kbps = avg((v) => v.kbps);
  const fps = avg((v) => v.fps);
  const height = last.video.height;

  if (kbps < 300) {
    return {
      level: "poor",
      label: "Very low bitrate",
      headline: `Your encoder is sending ${mbps(kbps)} — the picture will look blocky.`,
      fix: "Set the video bitrate to 2,500–3,500 kbps in OBS (Settings → Output), or check your upload.",
    };
  }
  if (height >= 720 && kbps < 1200) {
    return {
      level: "fair",
      label: "Low bitrate",
      headline: `${mbps(kbps)} is thin for ${height}p — viewers see a soft picture.`,
      fix: "Raise the video bitrate to 2,500–3,500 kbps in OBS (Settings → Output), or send 720p.",
    };
  }
  if (fps < 24) {
    return { level: "fair", label: "Low frame rate", headline: `Your encoder is sending ${fps} fps.`, fix: "Set 30 fps in OBS (Settings → Video → Common FPS Values)." };
  }
  if (height > 1080) {
    return { level: "fair", label: "Very large", headline: `${height}p is more than most phones can take.`, fix: "Output 1920×1080 or 1280×720 in OBS (Settings → Video)." };
  }
  // WHIP isn't transcoded: viewers get what the encoder sends.
  if (last.protocol === "whip" && kbps > 6000) {
    return {
      level: "fair",
      label: "Heavy for phones",
      headline: `${mbps(kbps)} goes to viewers as it is — phones on mobile data will struggle.`,
      fix: "Keep it under 4,000 kbps, or turn on simulcast in OBS (Settings → Output → Stream → Simulcast).",
    };
  }
  return { level: "good", label: "Good", headline: `Encoder looking good — ${height}p at ${last.video.fps} fps, ${mbps(last.video.kbps)}.`, fix: null };
}
