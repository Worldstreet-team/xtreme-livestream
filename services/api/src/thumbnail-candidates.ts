import { THUMBNAIL_CANDIDATES_MAX } from "@xtreme/contracts";

/**
 * Thumbnail candidates: which grabbed frames stay.
 *
 * The studio grabs a program frame about once a minute while live, scores
 * it on the device (sharpness, exposure, a face) and offers it here. Kept
 * server-side rather than held in the tab until the end: the studio can be
 * reloaded, handed to another device or crash mid-broadcast, and the picks
 * should still be there afterwards. At most three small JPEGs a stream, so
 * the cost is bounded.
 *
 * "Spread in time": two frames closer than the gap are neighbours, and only
 * the better of them stays. The gap grows with the broadcast (a quarter of
 * it so far, never under two minutes), so the three end up across the whole
 * show rather than three good seconds of it.
 */

export interface StoredCandidate {
  id: string;
  image: string;
  score: number;
  at: Date;
}

export const MIN_CANDIDATE_GAP_MS = 2 * 60_000;

/** How far apart two kept frames must be, this far into the broadcast. */
export function candidateGapMs(startedAt: Date | null | undefined, now: Date): number {
  const elapsed = startedAt ? now.getTime() - new Date(startedAt).getTime() : 0;
  return Math.max(MIN_CANDIDATE_GAP_MS, elapsed / 4);
}

/**
 * The list after offering `next`, or null when it doesn't make the cut
 * (the list stays as it was). Sorted by time. Never longer than `max`.
 */
export function offerCandidate(
  list: readonly StoredCandidate[],
  next: StoredCandidate,
  gapMs: number,
  max: number = THUMBNAIL_CANDIDATES_MAX,
): StoredCandidate[] | null {
  const weakestOf = (xs: readonly StoredCandidate[]) => xs.reduce((a, b) => (b.score < a.score ? b : a));
  const byTime = (xs: StoredCandidate[]) => xs.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // A neighbour: compete with the weakest frame it's close to.
  const near = list.filter((c) => Math.abs(new Date(c.at).getTime() - next.at.getTime()) < gapMs);
  if (near.length > 0) {
    const weakest = weakestOf(near);
    if (next.score <= weakest.score) return null;
    return byTime([...list.filter((c) => c !== weakest), next]);
  }

  // A new moment: room for it, or it has to beat the weakest one kept.
  if (list.length < max) return byTime([...list, next]);
  const weakest = weakestOf(list);
  if (next.score <= weakest.score) return null;
  return byTime([...list.filter((c) => c !== weakest), next]);
}
