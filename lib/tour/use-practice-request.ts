"use client";

import { useEffect, useRef } from "react";
import { PRACTICE_EVENT } from "./state";

/**
 * The studio's side of the tour's "Practice run" button: a way in from
 * anywhere (`/studio?practice=1`, read once when the studio opens) and from
 * the studio itself (the event, because pushing the same URL doesn't remount
 * it). `onRequest` should switch the practice run on — and ignore it while
 * already live.
 */
export function usePracticeRequest(onRequest: () => void) {
  const latest = useRef(onRequest);
  useEffect(() => {
    latest.current = onRequest;
  });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("practice") === "1") latest.current();
    const on = () => latest.current();
    window.addEventListener(PRACTICE_EVENT, on);
    return () => window.removeEventListener(PRACTICE_EVENT, on);
  }, []);
}
