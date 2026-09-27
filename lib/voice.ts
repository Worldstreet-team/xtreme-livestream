"use client";

import { useSyncExternalStore } from "react";
import { AudioPresets, type AudioCaptureOptions, type TrackPublishOptions } from "livekit-client";

/**
 * Your voice (Phase 1): what the mic is asked for, what the desk does to
 * it, and how it goes out. Three choices, kept on this device:
 *
 *   - Noise filter — LiveKit's Krisp filter, chained inside the desk. On
 *     by default where the browser can run it (Chrome and the other
 *     Chromiums, Firefox, Safari 17.4 and up).
 *   - Music mode — for DJs and instruments: nothing the browser does for a
 *     voice (no noise, echo or gain processing), stereo, a higher bitrate,
 *     and the desk steps aside (only its limiter stays, as a safety).
 *   - A preset — Natural, Warm, Bright or Radio: a few filters in the
 *     desk's polish stage, so a switch is a parameter change, never a
 *     rebuild mid-broadcast.
 *
 * The pure parts (what a setting means for the mic, the room and the desk)
 * are tested from the API's vitest; the store is behind window guards.
 */

export type VoicePreset = "natural" | "warm" | "bright" | "radio";

export interface VoiceSettings {
  noiseFilter: boolean;
  musicMode: boolean;
  preset: VoicePreset;
}

export const DEFAULT_VOICE: VoiceSettings = { noiseFilter: true, musicMode: false, preset: "natural" };

export const PRESETS: { id: VoicePreset; label: string; hint: string }[] = [
  { id: "natural", label: "Natural", hint: "Your voice as the mic hears it." },
  { id: "warm", label: "Warm", hint: "More body, a softer top — late-night radio." },
  { id: "bright", label: "Bright", hint: "Clearer consonants; carries on a phone speaker." },
  { id: "radio", label: "Radio", hint: "Tight and punchy, like a call-in show." },
];

export function presetLabel(id: VoicePreset) {
  return PRESETS.find((p) => p.id === id)?.label ?? "Natural";
}

/**
 * The shape behind each preset: biquads in the desk's polish stage, in
 * order, and how hard its compressor works. Gains in dB, frequencies in
 * Hz. A shelf or peak at 0 dB is a straight wire, so Natural is flat, and
 * every preset sets every stage — switching only moves parameters.
 */
export interface PresetCurve {
  /** Rumble out. */
  highpass: number;
  lowShelf: { frequency: number; gain: number };
  peak: { frequency: number; gain: number; q: number };
  highShelf: { frequency: number; gain: number };
  /** Air out; null leaves the top open. */
  lowpass: number | null;
  compressor: { threshold: number; ratio: number };
}

const FLAT = { lowShelf: { frequency: 180, gain: 0 }, peak: { frequency: 3000, gain: 0, q: 1 }, highShelf: { frequency: 7000, gain: 0 } };
const STEADY = { threshold: -24, ratio: 3.5 };

export const PRESET_CURVES: Record<VoicePreset, PresetCurve> = {
  natural: { highpass: 80, ...FLAT, lowpass: null, compressor: STEADY },
  warm: {
    highpass: 80,
    lowShelf: { frequency: 180, gain: 2.5 },
    peak: FLAT.peak,
    highShelf: { frequency: 7000, gain: -1.5 },
    lowpass: null,
    compressor: STEADY,
  },
  bright: {
    highpass: 80,
    lowShelf: FLAT.lowShelf,
    peak: { frequency: 3000, gain: 3, q: 1 },
    highShelf: { frequency: 8000, gain: 2 },
    lowpass: null,
    compressor: STEADY,
  },
  radio: {
    highpass: 120,
    lowShelf: FLAT.lowShelf,
    peak: { frequency: 2500, gain: 4, q: 1.2 },
    highShelf: FLAT.highShelf,
    lowpass: 6500,
    compressor: { threshold: -22, ratio: 6 },
  },
};

/* ---------------- What the settings mean ---------------- */

/** What to ask the browser for when the mic is turned on. */
export function micCaptureOptions(s: VoiceSettings): AudioCaptureOptions {
  if (!s.musicMode) return {};
  // A DJ's mix: nothing the browser does for a voice, and both channels.
  return { noiseSuppression: false, echoCancellation: false, autoGainControl: false, voiceIsolation: false, channelCount: 2 };
}

export type MicPublishOptions = Pick<TrackPublishOptions, "audioPreset" | "dtx" | "red">;

/** How the mic goes out to the room. Saving data keeps the voice bitrate either way. */
export function micPublishOptions(s: VoiceSettings, saveData: boolean): MicPublishOptions {
  if (s.musicMode) {
    // Stereo at 128 kbps, and never cut in the quiet bits (DTX) or doubled
    // up for a voice (RED) — the mix is the point.
    return { audioPreset: saveData ? AudioPresets.speech : AudioPresets.musicHighQualityStereo, dtx: false, red: false };
  }
  return saveData ? { audioPreset: AudioPresets.speech } : {};
}

/**
 * Whether these settings need the desk in the mic's path at go-live: the
 * filter and the presets live there. Music mode wants the mic as it is.
 */
export function voiceNeedsDesk(s: VoiceSettings, supported: { noiseFilter: boolean } = { noiseFilter: true }) {
  if (s.musicMode) return false;
  return (s.noiseFilter && supported.noiseFilter) || s.preset !== "natural";
}

/**
 * Whether the noise filter can run here — the same rule Krisp's own check
 * applies, without loading its bundle to ask: Safari from 17.4, and every
 * other browser. (The desk still asks Krisp itself before chaining it.)
 */
export function noiseFilterSupported(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  if (/firefox|fxios/i.test(ua)) return true;
  if (/chrom|crios|crmo/i.test(ua)) return true;
  if (/safari|applewebkit/i.test(ua)) {
    const m = /version\/(\d+)\.(\d+)/i.exec(ua);
    if (!m) return false;
    const major = Number(m[1]);
    const minor = Number(m[2]);
    return major > 17 || (major === 17 && minor >= 4);
  }
  return true;
}

/* ---------------- This device's choices ---------------- */

const KEY = "xtream:voice";
const EVENT = "xtream:voice";

const PRESET_IDS = new Set<string>(PRESETS.map((p) => p.id));

/** Settings as stored, or from the wire, made safe: anything odd falls back to the default. */
export function readVoice(raw: unknown): VoiceSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_VOICE;
  const r = raw as Partial<Record<keyof VoiceSettings, unknown>>;
  return {
    noiseFilter: typeof r.noiseFilter === "boolean" ? r.noiseFilter : DEFAULT_VOICE.noiseFilter,
    musicMode: typeof r.musicMode === "boolean" ? r.musicMode : DEFAULT_VOICE.musicMode,
    preset: typeof r.preset === "string" && PRESET_IDS.has(r.preset) ? (r.preset as VoicePreset) : DEFAULT_VOICE.preset,
  };
}

// useSyncExternalStore wants the same object back while nothing changed,
// so the parsed settings are kept against the string they came from.
let snapshot: { raw: string | null; value: VoiceSettings } = { raw: null, value: DEFAULT_VOICE };

function read(): VoiceSettings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage blocked: what this page last chose, or the default.
    return snapshot.value;
  }
  if (raw === snapshot.raw) return snapshot.value;
  let value = DEFAULT_VOICE;
  try {
    value = readVoice(JSON.parse(raw ?? "null"));
  } catch {
    // Not ours to parse.
  }
  snapshot = { raw, value };
  return value;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The voice settings as this device last left them. */
export function readVoiceSettings(): VoiceSettings {
  return typeof window === "undefined" ? DEFAULT_VOICE : read();
}

export function saveVoiceSettings(next: VoiceSettings) {
  const value = readVoice(next);
  const json = JSON.stringify(value);
  let raw: string | null = json;
  try {
    localStorage.setItem(KEY, json);
  } catch {
    // A private window: the choice lasts the page.
    try {
      raw = localStorage.getItem(KEY);
    } catch {
      raw = null;
    }
  }
  snapshot = { raw, value };
  window.dispatchEvent(new Event(EVENT));
}

/** Your voice settings, the same in every component and tab. */
export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_VOICE);
}
