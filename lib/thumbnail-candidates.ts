import type { ThumbnailCandidate } from "@xtreme/contracts";
import { apiFetch } from "@/lib/api-client";
import { scoreVideoFrame } from "@/lib/thumbnail-score";

/**
 * "Pick a thumbnail", the studio's half and the picker's.
 *
 * While live, each frame the studio grabs for the live thumbnail (about one
 * a minute) is also scored here and offered to the API, which keeps the
 * best three spread across the broadcast (services/api/src/thumbnail-
 * candidates.ts). Kept there rather than in the tab so a reload, a device
 * handover or a crash mid-show loses nothing — and the upload is the frame
 * the live thumbnail already made (640 px, 0.75 JPEG), one at a time.
 */

export type { ThumbnailCandidate };

/** Below this a frame is black or close to it: not worth the upload. */
const MIN_SCORE = 0.05;

/** Score the frame on screen and offer the one already captured from it. Never throws. */
export function offerThumbnailCandidate(streamId: string, image: string, video: HTMLVideoElement, face: boolean | null) {
  const score = scoreVideoFrame(video, face);
  if (score === null || score < MIN_SCORE) return;
  void apiFetch(`/api/streams/${streamId}/thumbnail-candidates`, {
    method: "POST",
    body: JSON.stringify({ image, score }),
  }).catch(() => {
    // A missed frame: there's another in a minute.
  });
}

export interface ThumbnailChoices {
  thumbnailUrl: string | null;
  isLive: boolean;
  startedAt: string | null;
  candidates: ThumbnailCandidate[];
}

export async function loadThumbnailChoices(streamId: string): Promise<ThumbnailChoices> {
  const res = await apiFetch<{ success: boolean; data: ThumbnailChoices }>(`/api/streams/${streamId}/thumbnail-candidates`);
  return res.data;
}

export async function chooseThumbnail(streamId: string, candidateId: string) {
  const res = await apiFetch<{ success: boolean; data: { thumbnailUrl: string | null; candidates: ThumbnailCandidate[] } }>(
    `/api/streams/${streamId}/thumbnail`,
    { method: "PUT", body: JSON.stringify({ candidateId }) },
  );
  return res.data;
}
