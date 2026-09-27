"use client";

import type { AudioProcessorOptions, Room, Track, TrackProcessor } from "livekit-client";
import type { KrispNoiseFilterProcessor } from "@livekit/krisp-noise-filter";
import { DEFAULT_VOICE, PRESET_CURVES, type VoiceSettings } from "@/lib/voice";

/**
 * The audio desk (Phase 2): the studio's mic goes through a small mixing
 * desk on its way out, built from the browser's Web Audio and handed to
 * LiveKit as the mic track's processor — so viewers hear the mix, and
 * nothing extra is installed.
 *
 *   mic → noise filter (Krisp, when it can run) → noise gate
 *       → voice polish (80 Hz cut, the preset's shape, gentle compressor) → mic fader ─┐
 *   pads (eight sounds made right here — nothing to license) → pads fader ─────────────┤→ limiter → out
 *   music bed (a file of the host's own) → music fader → ducker ───────────────────────┘
 *
 * The ducker dips the music whenever the host talks. Pads and music also
 * play to the host's own speakers or headphones (the monitor) — never the mic.
 *
 * Your voice (Phase 1) rides on top: the noise filter is LiveKit's Krisp
 * processor chained at the head of the graph; the presets are parameters
 * of the polish stage; Music mode routes the mic straight past the gate,
 * polish, filter and ducker, leaving the limiter as a safety; and Compare
 * (`setBypass`) does the same while the host holds it.
 */

export type PadId = "airhorn" | "applause" | "drumroll" | "kaching" | "badumtss" | "whoosh" | "levelup" | "sadtrombone";

export const PADS: { id: PadId; label: string; emoji: string }[] = [
  { id: "airhorn", label: "Airhorn", emoji: "📯" },
  { id: "applause", label: "Applause", emoji: "👏" },
  { id: "drumroll", label: "Drumroll", emoji: "🥁" },
  { id: "kaching", label: "Ka-ching", emoji: "💰" },
  { id: "badumtss", label: "Ba-dum-tss", emoji: "🤣" },
  { id: "whoosh", label: "Whoosh", emoji: "💨" },
  { id: "levelup", label: "Level up", emoji: "⭐" },
  { id: "sadtrombone", label: "Sad trombone", emoji: "🎺" },
];

export interface DeskLevels {
  mic: number;
  pads: number;
  music: number;
  /** What the host hears of pads and music. */
  monitor: number;
}
export interface DeskSettings {
  gate: boolean;
  polish: boolean;
  duck: boolean;
  levels: DeskLevels;
}
export const DEFAULT_DESK: DeskSettings = { gate: true, polish: true, duck: true, levels: { mic: 1, pads: 0.8, music: 0.35, monitor: 0.6 } };

/**
 * The noise gate, on the audio thread: it opens the moment the voice is
 * over the threshold (5 ms), holds 150 ms, and closes gently (120 ms) to a
 * floor of −20 dB rather than dead silence, which sounds more natural.
 */
const GATE_WORKLET = `
class XtreamGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "threshold", defaultValue: 0.012 }, { name: "enabled", defaultValue: 1 }];
  }
  constructor() { super(); this.gain = 1; this.hold = 0; }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || input.length === 0) return true;
    const n = input[0].length;
    if (params.enabled[0] < 0.5) {
      for (let c = 0; c < output.length; c++) output[c].set(input[c] || input[0]);
      this.gain = 1;
      return true;
    }
    let sum = 0;
    for (const ch of input) for (let i = 0; i < n; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / (n * input.length));
    this.hold = rms > params.threshold[0] ? sampleRate * 0.15 : Math.max(0, this.hold - n);
    const target = this.hold > 0 ? 1 : 0.1;
    const attack = 1 - Math.exp(-1 / (sampleRate * 0.005));
    const release = 1 - Math.exp(-1 / (sampleRate * 0.12));
    for (let i = 0; i < n; i++) {
      this.gain += (target - this.gain) * (target > this.gain ? attack : release);
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain;
    }
    return true;
  }
}
registerProcessor("xtream-gate", XtreamGate);
`;

const workletReady = new WeakMap<BaseAudioContext, Promise<void>>();
function loadGate(ctx: BaseAudioContext) {
  let ready = workletReady.get(ctx);
  if (!ready) {
    const url = URL.createObjectURL(new Blob([GATE_WORKLET], { type: "application/javascript" }));
    ready = ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    workletReady.set(ctx, ready);
  }
  return ready;
}

/* ---------------- The pads: synthesized, so there's nothing to license ---------------- */

const PAD_SECONDS: Record<PadId, number> = {
  airhorn: 1.6,
  applause: 3,
  drumroll: 3.4,
  kaching: 1.4,
  badumtss: 1.5,
  whoosh: 1.2,
  levelup: 1,
  sadtrombone: 2.9,
};

/** Render one pad to a buffer, once, at the desk's sample rate. */
export async function renderPad(id: PadId, rate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, Math.ceil(PAD_SECONDS[id] * rate), rate);
  const out = ctx.createGain();
  out.gain.value = 0.85;
  out.connect(ctx.destination);
  const noise = (seconds: number) => {
    const b = ctx.createBuffer(1, Math.max(1, Math.ceil(seconds * rate)), rate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  };
  /** A burst of filtered noise: a clap, a snare, a cymbal. */
  const hit = (t: number, amp: number, decay: number, filter: BiquadFilterType, freq: number, q = 0.8) => {
    const s = ctx.createBufferSource();
    s.buffer = noise(decay + 0.05);
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    s.connect(f).connect(g).connect(out);
    s.start(t);
  };
  /** A pitched note with an envelope: waveform, start, length, pitch (optionally sliding), level. */
  const note = (type: OscillatorType, t: number, len: number, from: number, to: number, amp: number, lowpass = 6000) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + len);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.012);
    g.gain.setValueAtTime(amp, t + Math.max(0.02, len - 0.06));
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.02);
    return o;
  };
  /** A struck tone that rings out: a tom, a bell. */
  const strike = (t: number, from: number, to: number, amp: number, decay: number, type: OscillatorType = "sine") => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + decay + 0.02);
  };

  switch (id) {
    case "airhorn":
      // Two short blasts and a long one, of a slightly flat chord that snaps into tune.
      for (const [t, len] of [
        [0, 0.2],
        [0.28, 0.2],
        [0.56, 0.95],
      ] as const) {
        for (const f of [415.3, 523.25, 622.25]) note("sawtooth", t, len, f * 0.97, f, 0.11, 3400);
      }
      break;
    case "applause": {
      // A crowd: hundreds of claps, swelling and fading.
      for (let i = 0; i < 320; i++) {
        const t = Math.random() * 2.7;
        const swell = Math.sin(Math.PI * Math.min(1, t / 2.7));
        hit(t, 0.05 + 0.2 * swell * Math.random(), 0.04 + Math.random() * 0.03, "bandpass", 900 + Math.random() * 1900, 1.1);
      }
      break;
    }
    case "drumroll":
      // A snare roll that builds, then the crash.
      for (let t = 0, i = 0; t < 2.2; t += 0.042, i++) hit(t, 0.05 + (t / 2.2) * 0.3 * (i % 2 ? 0.8 : 1), 0.07, "highpass", 1400);
      hit(2.25, 0.5, 0.18, "lowpass", 180, 0.7);
      hit(2.25, 0.34, 1.1, "highpass", 5200);
      break;
    case "kaching":
      // The drawer's click, the bell, and a scatter of coins.
      hit(0, 0.35, 0.03, "highpass", 3200);
      strike(0.05, 1568, 1560, 0.22, 0.9);
      strike(0.05, 1568 * 2.76, 1568 * 2.74, 0.07, 0.5);
      strike(0.14, 2093, 2090, 0.2, 1.1);
      strike(0.14, 2093 * 2.76, 2093 * 2.74, 0.06, 0.6);
      for (let i = 0; i < 6; i++) strike(0.3 + i * 0.07 + Math.random() * 0.03, 3200 + Math.random() * 1800, 3000, 0.05, 0.12);
      break;
    case "badumtss":
      // Ba (high tom), dum (low tom), tss (the cymbal).
      strike(0, 190, 110, 0.55, 0.28);
      strike(0.2, 135, 72, 0.6, 0.34);
      hit(0.44, 0.3, 0.95, "highpass", 6200);
      break;
    case "whoosh": {
      // Air past the mic: noise through a filter that sweeps up and back.
      const s = ctx.createBufferSource();
      s.buffer = noise(1.2);
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.6;
      f.frequency.setValueAtTime(260, 0);
      f.frequency.exponentialRampToValueAtTime(3000, 0.55);
      f.frequency.exponentialRampToValueAtTime(700, 1.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0008, 0);
      g.gain.exponentialRampToValueAtTime(0.6, 0.5);
      g.gain.exponentialRampToValueAtTime(0.0008, 1.15);
      s.connect(f).connect(g).connect(out);
      s.start(0);
      break;
    }
    case "levelup":
      // A bright arpeggio up the C chord, the top note held.
      [523.25, 659.25, 783.99].forEach((f, i) => note("square", i * 0.08, 0.1, f, f, 0.08, 4200));
      note("square", 0.24, 0.5, 1046.5, 1046.5, 0.08, 4200);
      note("sine", 0.24, 0.6, 2093, 2093, 0.05);
      break;
    case "sadtrombone": {
      // Wah, wah, wah, waaah — the last one wobbling.
      [311.13, 293.66, 277.18].forEach((f, i) => note("sawtooth", i * 0.5, 0.42, f, f * 0.985, 0.13, 1300));
      const last = note("sawtooth", 1.5, 1.3, 261.63, 250, 0.13, 1300);
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.value = 7;
      lfo.connect(depth).connect(last.frequency);
      lfo.start(1.8);
      lfo.stop(2.85);
      break;
    }
  }
  // Every pad to the same peak, so none is lost under a voice and none jumps out.
  const buffer = await ctx.startRendering();
  const data = buffer.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]!));
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < data.length; i++) data[i]! *= k;
  }
  return buffer;
}

/* ---------------- The desk ---------------- */

interface Graph {
  /** The mic as captured; the noise filter's clean track takes its place when chained. */
  source: MediaStreamAudioSourceNode;
  gate: AudioWorkletNode;
  /** The polish stage, in order: rumble out, the preset's shape, the level steadied. */
  highpass: BiquadFilterNode;
  lowShelf: BiquadFilterNode;
  peak: BiquadFilterNode;
  highShelf: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  polishWet: GainNode;
  polishDry: GainNode;
  micGain: GainNode;
  micMeter: AnalyserNode;
  pads: GainNode;
  music: GainNode;
  duck: GainNode;
  monitor: GainNode;
  bus: GainNode;
  limiter: DynamicsCompressorNode;
  outMeter: AnalyserNode;
  dest: MediaStreamAudioDestinationNode;
  all: AudioNode[];
}

/** Where the noise filter is: off by choice, waiting on the room, shaping the voice, or not possible here. */
export type NoiseFilterState = "off" | "starting" | "on" | "unavailable";

export interface DeskState {
  noiseFilter: NoiseFilterState;
  /** Why it's unavailable, when it is — for a log line, not a host. */
  noiseFilterError: string | null;
}

/**
 * Move a parameter without a click: a short glide, then land exactly (a
 * glide alone only ever gets most of the way). Immediate at build time.
 */
function glide(param: AudioParam, value: number, t: number, immediate: boolean) {
  param.cancelScheduledValues(t);
  if (immediate) {
    param.setValueAtTime(value, t);
    return;
  }
  param.setTargetAtTime(value, t, 0.03);
  param.setValueAtTime(value, t + 0.25);
}

/** Loudness of what an analyser hears, 0–1, on a scale that reads like a meter (−60 dB to 0). */
function meterLevel(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>) {
  analyser.getFloatTimeDomainData(scratch);
  let sum = 0;
  for (let i = 0; i < scratch.length; i++) sum += scratch[i]! * scratch[i]!;
  const rms = Math.sqrt(sum / scratch.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export class AudioDesk implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
  readonly name = "xtream-audio-desk";
  processedTrack?: MediaStreamTrack;
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private settings: DeskSettings;
  private buffers = new Map<PadId, Promise<AudioBuffer>>();
  private musicEl: HTMLAudioElement | null = null;
  private musicNode: MediaElementAudioSourceNode | null = null;
  private musicUrl: string | null = null;
  private duckTimer: ReturnType<typeof setInterval> | null = null;
  private scratch = new Float32Array(1024);
  private voiceSettings: VoiceSettings;
  /** Compare held: the mic passes as it is. */
  private bypass = false;
  /** What LiveKit handed `init`, kept so the noise filter can be chained later. */
  private initOpts: AudioProcessorOptions | null = null;
  /** The room, once the track is published — Krisp can only switch on with it. */
  private room: Room | null = null;
  private krisp: { filter: KrispNoiseFilterProcessor; source: MediaStreamAudioSourceNode; published: boolean } | null = null;
  private krispAttaching: Promise<void> | null = null;
  /** Krisp calls in flight (switching it on asks LiveKit Cloud first). */
  private krispBusy = 0;
  private noise: NoiseFilterState = "off";
  private noiseError: string | null = null;

  constructor(settings: DeskSettings = DEFAULT_DESK, voice: VoiceSettings = DEFAULT_VOICE) {
    this.settings = { ...settings, levels: { ...settings.levels } };
    this.voiceSettings = { ...voice };
  }

  get current(): DeskSettings {
    return { ...this.settings, levels: { ...this.settings.levels } };
  }

  get voice(): VoiceSettings {
    return { ...this.voiceSettings };
  }

  /** What's shaping the voice right now, for the panel. */
  get state(): DeskState {
    return { noiseFilter: this.noise, noiseFilterError: this.noise === "unavailable" ? this.noiseError : null };
  }

  async init(opts: AudioProcessorOptions) {
    const { track, audioContext: ctx } = opts;
    this.ctx = ctx;
    this.initOpts = opts;
    await loadGate(ctx);
    const s = this.settings;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const gate = new AudioWorkletNode(ctx, "xtream-gate", { parameterData: { enabled: s.gate ? 1 : 0 } });
    // Voice polish: rumble out, the preset's shape, the level steadied, a
    // little made up. Every stage is always in the chain — a preset only
    // moves their parameters (`applyPreset`), so nothing is rebuilt live.
    const biquad = (type: BiquadFilterType, frequency: number) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      return f;
    };
    const highpass = biquad("highpass", 80);
    const lowShelf = biquad("lowshelf", 180);
    const peak = biquad("peaking", 3000);
    const highShelf = biquad("highshelf", 7000);
    // A low-pass at the very top of the band is a straight wire.
    const lowpass = biquad("lowpass", ctx.sampleRate / 2);
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 12;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;
    // Chrome's compressor makes up the level it takes away, so the wet path needs no boost.
    const polishWet = ctx.createGain();
    const polishDry = ctx.createGain();
    polishWet.gain.value = s.polish ? 1 : 0;
    polishDry.gain.value = s.polish ? 0 : 1;
    const micGain = ctx.createGain();
    micGain.gain.value = s.levels.mic;
    const micMeter = ctx.createAnalyser();
    micMeter.fftSize = 1024;
    const pads = ctx.createGain();
    pads.gain.value = s.levels.pads;
    const music = ctx.createGain();
    music.gain.value = s.levels.music;
    const duck = ctx.createGain();
    const monitor = ctx.createGain();
    monitor.gain.value = s.levels.monitor;
    const bus = ctx.createGain();
    // The limiter keeps the whole mix under 0 dB: an airhorn can't clip it.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    const outMeter = ctx.createAnalyser();
    outMeter.fftSize = 1024;
    const dest = ctx.createMediaStreamDestination();

    source.connect(gate);
    gate.connect(highpass).connect(lowShelf).connect(peak).connect(highShelf).connect(lowpass).connect(compressor).connect(polishWet).connect(micGain);
    gate.connect(polishDry).connect(micGain);
    micGain.connect(micMeter);
    micGain.connect(bus);
    pads.connect(bus);
    pads.connect(monitor);
    music.connect(duck);
    duck.connect(bus);
    duck.connect(monitor);
    monitor.connect(ctx.destination);
    bus.connect(limiter).connect(dest);
    limiter.connect(outMeter);

    this.graph = {
      source, gate, highpass, lowShelf, peak, highShelf, lowpass, compressor, polishWet, polishDry, micGain, micMeter, pads, music, duck, monitor, bus, limiter, outMeter, dest,
      all: [source, gate, highpass, lowShelf, peak, highShelf, lowpass, compressor, polishWet, polishDry, micGain, micMeter, pads, music, duck, monitor, bus, limiter, outMeter, dest],
    };
    this.route(true);
    this.applyPreset(true);
    if (this.musicNode) this.musicNode.connect(music);
    this.processedTrack = dest.stream.getAudioTracks()[0];

    // The ducker: while the host talks, the music steps back. (Not in
    // Music mode — the mix is the show.) The same tick keeps the noise
    // filter's state honest, since Krisp can switch itself off.
    this.duckTimer = setInterval(() => {
      const g = this.graph;
      if (!g || !this.ctx) return;
      const talking = meterLevel(g.micMeter, this.scratch) > 0.55;
      const target = this.settings.duck && !this.voiceSettings.musicMode && talking ? 0.3 : 1;
      g.duck.gain.setTargetAtTime(target, this.ctx.currentTime, target < 1 ? 0.06 : 0.4);
      this.refreshNoise();
    }, 50);

    // The noise filter, if wanted: it takes a moment (its model loads), so
    // the mic goes out through the rest of the desk meanwhile.
    if (this.wantsFilter()) void this.attachKrisp();
    else this.refreshNoise();
  }

  async restart(opts: AudioProcessorOptions) {
    await this.teardown();
    await this.init(opts);
  }

  async destroy() {
    await this.teardown();
    this.unloadMusic();
    this.initOpts = null;
  }

  /** LiveKit tells the processor its room once the track is published; Krisp needs it to switch on. */
  async onPublish(room: Room) {
    this.room = room;
    await this.syncKrisp();
  }

  private async teardown() {
    if (this.duckTimer) clearInterval(this.duckTimer);
    this.duckTimer = null;
    this.musicNode?.disconnect();
    for (const node of this.graph?.all ?? []) node.disconnect();
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.graph = null;
    const k = this.krisp;
    this.krisp = null;
    // Krisp puts the mic's own constraints back as it goes.
    if (k) await k.filter.destroy().catch(() => {});
  }

  /* ---- The noise filter ---- */

  /** The filter is wanted: on, and not in Music mode. (Compare only pauses it.) */
  private wantsFilter() {
    return this.voiceSettings.noiseFilter && !this.voiceSettings.musicMode;
  }

  private attachKrisp() {
    // Queued behind any chain still in flight: a restart mid-load must not
    // inherit the old graph's attempt and end up with no filter at all.
    const run: Promise<void> = (this.krispAttaching ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.chainKrisp())
      .finally(() => {
        if (this.krispAttaching === run) this.krispAttaching = null;
        this.refreshNoise();
      });
    this.krispAttaching = run;
    return run;
  }

  /**
   * Krisp back out of the chain: the raw mic feeds the gate again, and
   * Krisp's own destroy puts the browser's constraints back — its init took
   * the browser's noise suppression off the mic, and a mic with neither is
   * the one thing worse than a mic with the browser's.
   */
  private async unchainKrisp() {
    const k = this.krisp;
    if (!k) return;
    this.krisp = null;
    const g = this.graph;
    if (g) {
      k.source.disconnect();
      g.source.connect(g.gate);
      g.all = g.all.filter((n) => n !== k.source);
    }
    await k.filter.destroy().catch(() => {});
    this.refreshNoise();
  }

  /**
   * Chain Krisp at the head of the graph: its clean track takes the raw
   * one's place feeding the gate. Loaded only now (its bundle is big), and
   * any failure — not supported here, the model didn't load, torn down
   * meanwhile — leaves the desk running without it.
   */
  private async chainKrisp() {
    const g = this.graph;
    const ctx = this.ctx;
    const opts = this.initOpts;
    if (!g || !ctx || !opts || this.krisp) return;
    this.noise = "starting";
    this.noiseError = null;
    let filter: KrispNoiseFilterProcessor | null = null;
    try {
      const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import("@livekit/krisp-noise-filter");
      if (!isKrispNoiseFilterSupported()) throw new Error("This browser can't run it");
      filter = KrispNoiseFilter();
      await filter.init(opts);
      const clean = filter.processedTrack;
      if (!clean) throw new Error("It gave no track");
      if (this.graph !== g) throw new Error("The desk was torn down while it loaded");
      const source = ctx.createMediaStreamSource(new MediaStream([clean]));
      source.connect(g.gate);
      g.source.disconnect();
      g.all.push(source);
      this.krisp = { filter, source, published: false };
    } catch (err) {
      this.noiseError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await filter?.destroy().catch(() => {});
      return;
    }
    await this.syncKrisp();
  }

  /**
   * Bring Krisp in line with the settings: on only once the room is known
   * and the host wants it; paused while Compare is held; out of the chain
   * altogether when it's off, in Music mode, or refused.
   */
  private async syncKrisp() {
    const k = this.krisp;
    if (!k) return;
    if (!this.wantsFilter()) {
      await this.unchainKrisp();
      return;
    }
    this.krispBusy += 1;
    try {
      if (this.bypass) {
        // Compare: paused, not gone.
        await k.filter.setEnabled(false);
        return;
      }
      if (!this.room) return;
      if (!k.published) {
        k.published = true;
        // Krisp checks with LiveKit Cloud that the filter is on for this project.
        await k.filter.onPublish(this.room);
      }
      await k.filter.setEnabled(true);
      if (!k.filter.isEnabled()) {
        // Asked, and refused (no entitlement here): the raw mic, with the
        // browser's own suppression, is the better mic.
        this.noiseError ??= "LiveKit Cloud didn't allow it";
        await this.unchainKrisp();
      }
    } catch (err) {
      // Krisp said no; the state below says so.
      this.noiseError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      await this.unchainKrisp();
    } finally {
      this.krispBusy -= 1;
      this.refreshNoise();
    }
  }

  private refreshNoise() {
    if (!this.wantsFilter()) {
      this.noise = "off";
      return;
    }
    // Compare held: the filter is paused, not gone — the state stands.
    if (this.bypass) return;
    if (this.krispAttaching || this.krispBusy > 0) {
      this.noise = "starting";
      return;
    }
    const k = this.krisp;
    if (!k) {
      this.noise = "unavailable";
      return;
    }
    if (!this.room) {
      this.noise = "starting";
      return;
    }
    if (k.filter.isEnabled()) {
      this.noise = "on";
      this.noiseError = null;
    } else {
      this.noise = "unavailable";
      // Enabled once, then off by itself: Krisp gives up after its reports to
      // LiveKit Cloud keep failing. Out it comes, so the browser's own
      // suppression is back on the mic.
      this.noiseError ??= "LiveKit Cloud didn't allow it, or stopped hearing from it";
      void this.unchainKrisp();
    }
  }

  /* ---- The routing ---- */

  /**
   * Which stages the mic passes through. Music mode and Compare route it
   * straight: no gate, no polish, no ducking (the filter is paused by
   * `syncKrisp`); the limiter stays, up at −1 dB in Music mode as a safety.
   */
  private route(immediate = false) {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const t = ctx.currentTime;
    const straight = this.voiceSettings.musicMode || this.bypass;
    const gate = this.settings.gate && !straight;
    const polish = this.settings.polish && !straight;
    g.gate.parameters.get("enabled")?.setValueAtTime(gate ? 1 : 0, t);
    glide(g.polishWet.gain, polish ? 1 : 0, t, immediate);
    glide(g.polishDry.gain, polish ? 0 : 1, t, immediate);
    glide(g.limiter.threshold, this.voiceSettings.musicMode ? -1 : -2, t, immediate);
  }

  /** The preset's shape onto the polish stage — parameters only, never a rebuild. */
  private applyPreset(immediate = false) {
    const g = this.graph;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const t = ctx.currentTime;
    const c = PRESET_CURVES[this.voiceSettings.preset];
    glide(g.highpass.frequency, c.highpass, t, immediate);
    glide(g.lowShelf.frequency, c.lowShelf.frequency, t, immediate);
    glide(g.lowShelf.gain, c.lowShelf.gain, t, immediate);
    glide(g.peak.frequency, c.peak.frequency, t, immediate);
    glide(g.peak.gain, c.peak.gain, t, immediate);
    glide(g.peak.Q, c.peak.q, t, immediate);
    glide(g.highShelf.frequency, c.highShelf.frequency, t, immediate);
    glide(g.highShelf.gain, c.highShelf.gain, t, immediate);
    glide(g.lowpass.frequency, c.lowpass ?? ctx.sampleRate / 2, t, immediate);
    glide(g.compressor.threshold, c.compressor.threshold, t, immediate);
    glide(g.compressor.ratio, c.compressor.ratio, t, immediate);
  }

  /* ---- The controls ---- */

  /** Your voice settings, changed live: routing and the preset move at once; the filter follows. */
  setVoice(next: VoiceSettings) {
    this.voiceSettings = { ...next };
    this.route();
    this.applyPreset();
    if (this.wantsFilter() && !this.krisp && this.graph) void this.attachKrisp();
    else void this.syncKrisp();
    this.refreshNoise();
  }

  /** Compare: while on, the mic goes out as it is — no gate, polish or filter. */
  setBypass(on: boolean) {
    if (this.bypass === on) return;
    this.bypass = on;
    this.route();
    void this.syncKrisp();
  }

  setLevel(which: keyof DeskLevels, value: number) {
    this.settings.levels[which] = value;
    const g = this.graph;
    if (!g || !this.ctx) return;
    const node = { mic: g.micGain, pads: g.pads, music: g.music, monitor: g.monitor }[which];
    node.gain.setTargetAtTime(value, this.ctx.currentTime, 0.03);
  }

  setGate(on: boolean) {
    this.settings.gate = on;
    this.route();
  }

  setPolish(on: boolean) {
    this.settings.polish = on;
    this.route();
  }

  setDuck(on: boolean) {
    this.settings.duck = on;
  }

  /** Levels for the meters: the mic after its fader, and what's going out. */
  meters() {
    const g = this.graph;
    if (!g) return { mic: 0, out: 0 };
    return { mic: meterLevel(g.micMeter, this.scratch), out: meterLevel(g.outMeter, this.scratch) };
  }

  /** Fire a pad. The first press of each renders it (a few milliseconds). */
  async playPad(id: PadId) {
    const ctx = this.ctx;
    const g = this.graph;
    if (!ctx || !g) return;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = renderPad(id, ctx.sampleRate);
      this.buffers.set(id, buffer);
    }
    const src = ctx.createBufferSource();
    src.buffer = await buffer;
    src.connect(g.pads);
    src.start();
  }

  /** Load a music file from this computer — it's played from here, never uploaded. */
  loadMusic(file: File) {
    this.unloadMusic();
    const ctx = this.ctx;
    if (!ctx) return;
    this.musicUrl = URL.createObjectURL(file);
    const el = new Audio(this.musicUrl);
    el.loop = true;
    this.musicEl = el;
    this.musicNode = ctx.createMediaElementSource(el);
    if (this.graph) this.musicNode.connect(this.graph.music);
  }

  async playMusic() {
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => {});
    await this.musicEl?.play();
  }

  pauseMusic() {
    this.musicEl?.pause();
  }

  get musicPlaying() {
    return Boolean(this.musicEl && !this.musicEl.paused);
  }

  unloadMusic() {
    this.musicEl?.pause();
    this.musicNode?.disconnect();
    if (this.musicUrl) URL.revokeObjectURL(this.musicUrl);
    this.musicEl = null;
    this.musicNode = null;
    this.musicUrl = null;
  }
}

/* ---------------- This device's desk ---------------- */

const DESK_KEY = "xtream:audio-desk";

/** The desk's switches and levels as this device last left them. */
export function readDeskSettings(): DeskSettings {
  if (typeof window === "undefined") return DEFAULT_DESK;
  try {
    const raw = JSON.parse(localStorage.getItem(DESK_KEY) ?? "null") as Partial<DeskSettings> | null;
    if (!raw) return DEFAULT_DESK;
    const level = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : d);
    return {
      gate: raw.gate ?? DEFAULT_DESK.gate,
      polish: raw.polish ?? DEFAULT_DESK.polish,
      duck: raw.duck ?? DEFAULT_DESK.duck,
      levels: {
        mic: level(raw.levels?.mic, DEFAULT_DESK.levels.mic),
        pads: level(raw.levels?.pads, DEFAULT_DESK.levels.pads),
        music: level(raw.levels?.music, DEFAULT_DESK.levels.music),
        monitor: level(raw.levels?.monitor, DEFAULT_DESK.levels.monitor),
      },
    };
  } catch {
    return DEFAULT_DESK;
  }
}

export function saveDeskSettings(s: DeskSettings) {
  try {
    localStorage.setItem(DESK_KEY, JSON.stringify(s));
  } catch {
    // A private window: the levels last the session.
  }
}
