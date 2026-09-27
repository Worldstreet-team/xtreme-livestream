import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; the pure half of lib/voice.ts
// (what a setting means for the mic, the room and the desk) is exercised
// from here, the repo's only vitest. The store stays behind window guards.
import {
  DEFAULT_VOICE,
  PRESETS,
  PRESET_CURVES,
  micCaptureOptions,
  micPublishOptions,
  noiseFilterSupported,
  presetLabel,
  readVoice,
  voiceNeedsDesk,
  type VoiceSettings,
} from "../../../lib/voice.ts";

const voice = (patch: Partial<VoiceSettings> = {}): VoiceSettings => ({ ...DEFAULT_VOICE, ...patch });

describe("the defaults", () => {
  it("start with the filter on, music off, a natural voice", () => {
    expect(DEFAULT_VOICE).toEqual({ noiseFilter: true, musicMode: false, preset: "natural" });
  });

  it("read anything odd back to the default, field by field", () => {
    expect(readVoice(null)).toEqual(DEFAULT_VOICE);
    expect(readVoice("warm")).toEqual(DEFAULT_VOICE);
    expect(readVoice({ preset: "warm" })).toEqual({ noiseFilter: true, musicMode: false, preset: "warm" });
    expect(readVoice({ preset: "shouty", noiseFilter: "yes", musicMode: true })).toEqual({ noiseFilter: true, musicMode: true, preset: "natural" });
    expect(readVoice({ noiseFilter: false, musicMode: false, preset: "radio", extra: 1 })).toEqual({ noiseFilter: false, musicMode: false, preset: "radio" });
  });
});

describe("the presets", () => {
  it("each has a label, a one-line hint and a curve", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["natural", "warm", "bright", "radio"]);
    for (const p of PRESETS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.hint.length).toBeGreaterThan(0);
      expect(p.hint.split("\n")).toHaveLength(1);
      expect(PRESET_CURVES[p.id]).toBeDefined();
    }
    expect(presetLabel("bright")).toBe("Bright");
  });

  it("Natural is flat: nothing boosted, nothing cut but rumble", () => {
    const c = PRESET_CURVES.natural;
    expect(c.lowShelf.gain).toBe(0);
    expect(c.peak.gain).toBe(0);
    expect(c.highShelf.gain).toBe(0);
    expect(c.lowpass).toBeNull();
    expect(c.highpass).toBe(80);
    expect(c.compressor).toEqual({ threshold: -24, ratio: 3.5 });
  });

  it("Warm, Bright and Radio are the shapes on the brief", () => {
    expect(PRESET_CURVES.warm.lowShelf).toEqual({ frequency: 180, gain: 2.5 });
    expect(PRESET_CURVES.warm.highShelf).toEqual({ frequency: 7000, gain: -1.5 });
    expect(PRESET_CURVES.bright.peak).toEqual({ frequency: 3000, gain: 3, q: 1 });
    expect(PRESET_CURVES.bright.highShelf).toEqual({ frequency: 8000, gain: 2 });
    expect(PRESET_CURVES.radio.highpass).toBe(120);
    expect(PRESET_CURVES.radio.lowpass).toBe(6500);
    expect(PRESET_CURVES.radio.peak).toEqual({ frequency: 2500, gain: 4, q: 1.2 });
    expect(PRESET_CURVES.radio.compressor).toEqual({ threshold: -22, ratio: 6 });
  });

  it("every preset sets every stage, so a switch only moves parameters", () => {
    for (const c of Object.values(PRESET_CURVES)) {
      expect(c.highpass).toBeGreaterThan(0);
      expect(c.lowShelf.frequency).toBeGreaterThan(0);
      expect(c.peak.frequency).toBeGreaterThan(0);
      expect(c.peak.q).toBeGreaterThan(0);
      expect(c.highShelf.frequency).toBeGreaterThan(0);
      expect(c.compressor.ratio).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("what the mic is asked for", () => {
  it("leaves the browser's voice processing alone by default", () => {
    expect(micCaptureOptions(voice())).toEqual({});
    expect(micCaptureOptions(voice({ preset: "radio", noiseFilter: false }))).toEqual({});
  });

  it("Music mode: no noise, echo or gain processing, both channels", () => {
    expect(micCaptureOptions(voice({ musicMode: true }))).toEqual({
      noiseSuppression: false,
      echoCancellation: false,
      autoGainControl: false,
      voiceIsolation: false,
      channelCount: 2,
    });
  });
});

describe("how the mic goes out", () => {
  it("keeps the app's defaults for a voice", () => {
    expect(micPublishOptions(voice(), false)).toEqual({});
  });

  it("saving data keeps the voice preset", () => {
    expect(micPublishOptions(voice(), true)).toEqual({ audioPreset: { maxBitrate: 24_000 } });
  });

  it("Music mode: high-quality stereo, never cut in the quiet bits, no redundancy", () => {
    expect(micPublishOptions(voice({ musicMode: true }), false)).toEqual({ audioPreset: { maxBitrate: 128_000 }, dtx: false, red: false });
  });

  it("Music mode while saving data keeps the voice bitrate but still never cuts", () => {
    expect(micPublishOptions(voice({ musicMode: true }), true)).toEqual({ audioPreset: { maxBitrate: 24_000 }, dtx: false, red: false });
  });
});

describe("whether the desk is needed at go-live", () => {
  it("is, for the filter or any preset but Natural", () => {
    expect(voiceNeedsDesk(voice())).toBe(true);
    expect(voiceNeedsDesk(voice({ noiseFilter: false }))).toBe(false);
    expect(voiceNeedsDesk(voice({ noiseFilter: false, preset: "warm" }))).toBe(true);
  });

  it("isn't, when the filter can't run here and the voice is natural", () => {
    expect(voiceNeedsDesk(voice(), { noiseFilter: false })).toBe(false);
    expect(voiceNeedsDesk(voice({ preset: "bright" }), { noiseFilter: false })).toBe(true);
  });

  it("isn't, in Music mode — the mic goes out as it is", () => {
    expect(voiceNeedsDesk(voice({ musicMode: true, preset: "radio" }))).toBe(false);
  });
});

describe("where the noise filter can run", () => {
  const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
  const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0";
  const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:129.0) Gecko/20100101 Firefox/129.0";
  const SAFARI_17_4 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
  const SAFARI_17_3 = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Safari/605.1.15";
  const SAFARI_18 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1";
  const WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

  it("Chrome, Edge and Firefox can", () => {
    expect(noiseFilterSupported(CHROME_MAC)).toBe(true);
    expect(noiseFilterSupported(EDGE)).toBe(true);
    expect(noiseFilterSupported(FIREFOX)).toBe(true);
    expect(noiseFilterSupported(CHROME_IOS)).toBe(true);
  });

  it("Safari can from 17.4", () => {
    expect(noiseFilterSupported(SAFARI_17_4)).toBe(true);
    expect(noiseFilterSupported(SAFARI_18)).toBe(true);
    expect(noiseFilterSupported(SAFARI_17_3)).toBe(false);
  });

  it("a WebKit view that won't say its version can't", () => {
    expect(noiseFilterSupported(WEBVIEW)).toBe(false);
  });

  it("with nothing to go on (no navigator), assumes it can", () => {
    expect(noiseFilterSupported("")).toBe(true);
  });
});
