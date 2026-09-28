"use client";

import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

/**
 * "See what viewers see": the studio opens the host's own watch page in a
 * frame (components/app/viewer-view.tsx) at `/stream/<id>?as=viewer`. The
 * page still joins as the host's monitor (`mon-<id>`, subscribe-only, never
 * counted — so the broadcast isn't kicked off the air), but it draws itself
 * as a viewer gets it: no host controls, sound locked off so the studio's
 * mic doesn't hear itself back, and no app chrome around it.
 */

export const VIEWER_VIEW_QUERY = "as=viewer";

export function viewerViewPath(streamId: string) {
  return `/stream/${streamId}?${VIEWER_VIEW_QUERY}`;
}

/** The watch page, drawn as a viewer's. */
export function useViewerView(): boolean {
  return useSearchParams()?.get("as") === "viewer";
}

function inViewerFrame() {
  try {
    return window.self !== window.top && window.location.pathname.startsWith("/stream/") && new URLSearchParams(window.location.search).get("as") === "viewer";
  } catch {
    return false;
  }
}
const still = () => () => {};

/** The app shell inside that frame: just the page, no bars, rails or tours. */
export function useViewerFrame(): boolean {
  return useSyncExternalStore(still, inViewerFrame, () => false);
}
