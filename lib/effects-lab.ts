import type { LookSettings } from "@/lib/looks";

/**
 * The effects test (/labs/effects): the camera through each effect in turn,
 * measured on the phone in hand, before we build more effects on phones
 * that may not carry them. Tecno, Infinix and itel sold about half the
 * phones in Africa last year and nobody publishes web numbers for them, so
 * this is where the numbers come from. Nothing leaves the device but what
 * the tester copies.
 *
 * The pure half lives here (stages, what a run means, the text to share);
 * the page runs them.
 */

export type LabStageId = "camera" | "look" | "blur" | "face" | "smooth" | "all";

export interface LabStage {
  id: LabStageId;
  label: string;
  /** One line on what's on, for the results. */
  what: string;
  /** The look settings the camera wears; null for none at all. */
  look: LookSettings | null;
  /** The face tracker runs too. */
  face: boolean;
}

const PLAIN: LookSettings = { background: "none", look: "natural", smooth: 0 };

export const LAB_STAGES: readonly LabStage[] = [
  { id: "camera", label: "Camera alone", what: "Nothing on the picture: the baseline.", look: null, face: false },
  { id: "look", label: "Colour look", what: "The Warm look.", look: { ...PLAIN, look: "warm" }, face: false },
  { id: "blur", label: "Background blur", what: "Strong blur behind you.", look: { ...PLAIN, background: "blur-strong" }, face: false },
  { id: "face", label: "Face tracking", what: "Finding your face, as gift effects do.", look: null, face: true },
  { id: "smooth", label: "Skin smoothing", what: "Medium smoothing, with face tracking.", look: { ...PLAIN, smooth: 0.6 }, face: true },
  { id: "all", label: "Everything", what: "Blur, Warm and smoothing together.", look: { background: "blur-strong", look: "warm", smooth: 0.6 }, face: true },
];

/** How long each stage runs, and how much of the start is left out while models load and shaders compile. */
export const STAGE_MS = 15_000;
export const WARMUP_MS = 3_000;

export interface StageResult {
  id: LabStageId;
  /** Frames shown a second, once warm. */
  fps: number;
  /** The worst tenth of one-second windows: the judder a viewer notices. */
  lowFps: number;
  /** The effects pass on a frame, ms (0 when nothing ran through it). */
  passMs: number;
  /** One face detection, ms, and how many a second it settled at (0 when off). */
  faceMs: number;
  faceHz: number;
  /** Why the stage didn't run, if it didn't. */
  error?: string;
}

/** Frames per second from frame timestamps (ms), and the tenth-percentile of one-second windows. */
export function frameRates(times: readonly number[]): { fps: number; lowFps: number } {
  if (times.length < 2) return { fps: 0, lowFps: 0 };
  const span = (times[times.length - 1] - times[0]) / 1000;
  const fps = span > 0 ? (times.length - 1) / span : 0;
  const windows: number[] = [];
  let start = times[0];
  let count = 0;
  for (const t of times) {
    while (t - start >= 1000) {
      windows.push(count);
      start += 1000;
      count = 0;
    }
    count++;
  }
  if (!windows.length) return { fps: round1(fps), lowFps: round1(fps) };
  const sorted = [...windows].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)];
  return { fps: round1(fps), lowFps: low };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export type Verdict = "smooth" | "usable" | "slow" | "failed";

/**
 * What a stage's numbers mean for a live. Judged against the camera's own
 * rate too: a dim room can hold the camera itself at 15, and an effect
 * that keeps up with that is doing its job.
 */
export function verdict(result: StageResult, cameraFps: number): Verdict {
  if (result.error || result.fps <= 0) return "failed";
  const smoothBar = Math.min(24, cameraFps * 0.85);
  if (result.fps >= smoothBar && result.lowFps >= smoothBar * 0.75) return "smooth";
  if (result.fps >= 15) return "usable";
  return "slow";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  smooth: "Smooth",
  usable: "Usable",
  slow: "Too slow",
  failed: "Didn't run",
};

export interface DeviceInfo {
  browser: string;
  cores: number | null;
  memoryGb: number | null;
  gpu: string | null;
  screen: string;
}

export interface Battery {
  level: number;
  charging: boolean;
}

/** The results as text anyone can paste into a message: one device, one line a stage. */
export function resultsText(device: DeviceInfo, results: readonly StageResult[], battery: { start: Battery | null; end: Battery | null }, soak?: SoakResult | null): string {
  const camera = results.find((r) => r.id === "camera")?.fps ?? 30;
  const lines = [
    "Xtream effects test",
    `Browser: ${device.browser}`,
    `CPU cores: ${device.cores ?? "?"} · Memory: ${device.memoryGb != null ? `${device.memoryGb} GB` : "?"} · GPU: ${device.gpu ?? "?"}`,
    `Screen: ${device.screen}`,
    "",
  ];
  for (const r of results) {
    const stage = LAB_STAGES.find((s) => s.id === r.id);
    const v = VERDICT_LABEL[verdict(r, camera)];
    if (r.error) {
      lines.push(`${stage?.label ?? r.id}: ${v} (${r.error})`);
      continue;
    }
    const extra = [r.passMs ? `pass ${r.passMs} ms` : null, r.faceMs ? `face ${r.faceMs} ms at ${r.faceHz}/s` : null].filter(Boolean).join(", ");
    lines.push(`${stage?.label ?? r.id}: ${v}, ${r.fps} fps (low ${r.lowFps})${extra ? `, ${extra}` : ""}`);
  }
  if (soak) {
    lines.push("", `Soak, everything on for ${Math.round(soak.minutes)} min: ${soak.firstFps} fps at the start, ${soak.lastFps} at the end, lowest ${soak.minFps}.`);
  }
  const { start, end } = battery;
  if (start && end) {
    const drop = Math.round((start.level - end.level) * 100);
    lines.push(`Battery: ${Math.round(start.level * 100)}% to ${Math.round(end.level * 100)}%${drop > 0 ? ` (−${drop})` : ""}${start.charging || end.charging ? ", charging" : ""}`);
  }
  return lines.join("\n");
}

export interface SoakResult {
  minutes: number;
  /** Frames a second in each 10-second slice. */
  slices: number[];
  firstFps: number;
  lastFps: number;
  minFps: number;
}

/** A soak's slices summed up: where it started, where it ended, how low it went (heat shows as a slide). */
export function soakSummary(slices: readonly number[], minutes: number): SoakResult {
  const clean = slices.filter((s) => Number.isFinite(s));
  const head = clean.slice(0, 3);
  const tail = clean.slice(-3);
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  return {
    minutes,
    slices: [...clean],
    firstFps: avg(head),
    lastFps: avg(tail),
    minFps: clean.length ? round1(Math.min(...clean)) : 0,
  };
}
