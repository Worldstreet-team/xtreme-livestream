"use client";

import { useSyncExternalStore } from "react";
import { ApiError, apiFetch } from "@/lib/api-client";

/**
 * Ending a stream without a wait (owner, 2026-09-29: "Starting the live
 * takes time, even the ending"). The studio leaves the room and opens the
 * post-live report at once; telling the server happens here, behind it.
 *
 * The request is sent with `keepalive`, so closing the tab right after End
 * doesn't lose it, and a network failure is tried again quietly — three
 * tries in all, backing off. A stream that's already over (400) or gone
 * (404) counts as ended. If it still fails, the report says so plainly with
 * one tap to try again; either way the server's reconcile ends a stream
 * whose feed has left.
 */

/** Waits before the second and third tries. */
export const END_RETRY_DELAYS_MS = [600, 1800];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Worth another try: the network, the server's own trouble, or a rate limit — not a refusal. */
function transient(err: unknown) {
  if (!(err instanceof ApiError)) return true;
  return err.status === 0 || err.status === 429 || err.status >= 500;
}

/** POST /streams/:id/end, surviving a closing tab and a flaky network. Resolves once the server has it ended. */
export async function endStreamOnServer(streamId: string, delays = END_RETRY_DELAYS_MS): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await apiFetch(`/api/streams/${streamId}/end`, { method: "POST", keepalive: true });
      return;
    } catch (err) {
      // Already over, or never there: nothing left to end.
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) return;
      const wait = delays[attempt];
      if (wait === undefined || !transient(err)) throw err;
      await sleep(wait);
    }
  }
}

/* ---- what the report shows while it's on its way ------------------------ */

export type EndState = "ending" | "ended" | "failed";
export interface StreamEnd {
  state: EndState;
  /** Try telling the server again (after "failed"). */
  retry: () => void;
}

const ends = new Map<string, StreamEnd>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Start ending a stream on the server, and keep its state for the report. */
export function trackStreamEnd(streamId: string, run: () => Promise<void> = () => endStreamOnServer(streamId)) {
  const go = () => {
    ends.set(streamId, { state: "ending", retry: go });
    emit();
    run().then(
      () => ends.set(streamId, { state: "ended", retry: go }),
      () => ends.set(streamId, { state: "failed", retry: go }),
    ).finally(emit);
  };
  go();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** The End that's on its way for this stream, if this tab sent one. */
export function useStreamEnd(streamId: string | null): StreamEnd | null {
  return useSyncExternalStore(
    subscribe,
    () => (streamId ? (ends.get(streamId) ?? null) : null),
    () => null,
  );
}
