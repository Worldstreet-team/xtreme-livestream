/**
 * How good a grabbed frame would look as a thumbnail — scored on the
 * device, from a tiny greyscale copy, so it costs next to nothing next to
 * the minute between grabs.
 *
 *  - sharpness: the variance of the Laplacian (a still, focused frame has
 *    strong edges; motion blur and a hunting autofocus don't)
 *  - exposure: a middling brightness, with few pixels crushed or blown
 *  - a face: a bonus when the face tracker (lib/face-anchors.ts) is already
 *    running and sees one — never a reason to start it
 *
 * Plain functions over numbers (no DOM) apart from `scoreVideoFrame`, so the
 * API's vitest can check them (services/api/test/thumbnail-candidates.test.ts).
 */

/** The width the score is worked out at. */
export const SCORE_WIDTH = 96;

export interface FrameStats {
  /** Variance of the 4-neighbour Laplacian, on 0–255 luma. */
  sharpness: number;
  /** Mean luma, 0–255. */
  mean: number;
  /** The share of pixels crushed (< 16) or blown (> 239), 0–1. */
  clipped: number;
}

/** Rec. 601 luma from RGBA bytes (what `getImageData` gives). */
export function toLuma(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return out;
}

export function frameStats(luma: ArrayLike<number>, w: number, h: number): FrameStats {
  const n = w * h;
  if (n === 0) return { sharpness: 0, mean: 0, clipped: 1 };
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < n; i++) {
    const v = luma[i];
    sum += v;
    if (v < 16 || v > 239) clipped++;
  }

  // Laplacian over the interior; variance by the running sums.
  let count = 0;
  let lsum = 0;
  let lsq = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * luma[i] - luma[i - 1] - luma[i + 1] - luma[i - w] - luma[i + w];
      lsum += l;
      lsq += l * l;
      count++;
    }
  }
  const lmean = count ? lsum / count : 0;
  const sharpness = count ? Math.max(0, lsq / count - lmean * lmean) : 0;
  return { sharpness, mean: sum / n, clipped: clipped / n };
}

/** A frame's score: 0–1 for sharpness and exposure, +0.2 with a face in shot. 0 for a black frame. */
export function frameScore(stats: FrameStats, face: boolean | null = null): number {
  // A camera still starting, a covered lens, a slate gone black: never a pick.
  if (stats.mean < 12) return 0;
  const sharp = stats.sharpness / (stats.sharpness + 120);
  const exposure = Math.max(0, 1 - Math.abs(stats.mean - 118) / 118) * (1 - Math.min(1, stats.clipped * 1.5));
  const score = 0.6 * sharp + 0.4 * exposure + (face ? 0.2 : 0);
  return Math.round(Math.min(2, Math.max(0, score)) * 1000) / 1000;
}

/** Score what a video element is showing now, or null when it has no frame (or the canvas is off limits). */
export function scoreVideoFrame(video: HTMLVideoElement, face: boolean | null = null): number | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const w = SCORE_WIDTH;
  const h = Math.max(1, Math.round((video.videoHeight * w) / video.videoWidth));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    return frameScore(frameStats(toLuma(data, w, h), w, h), face);
  } catch {
    // A tainted canvas (a cross-origin source): no score, no candidate.
    return null;
  }
}
