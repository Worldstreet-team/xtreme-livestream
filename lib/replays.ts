"use client";

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/api-client";
import type { ReplayStatus, ReplayView } from "@xtreme/contracts";

/**
 * Replays on the client: whether this server records streams at all, and
 * the words for a replay's state. The recording itself is the API's
 * (services/api recording.ts) — the host only chooses it on go-live.
 */

export type { ReplayStatus, ReplayView };

/* ---- Whether recording is on (GET /recording/enabled) ---- */

let enabled: boolean | null = null;
let asking = false;
const listeners = new Set<() => void>();

function ask() {
  if (enabled !== null || asking) return;
  asking = true;
  apiFetch<{ success: boolean; data?: { enabled?: boolean } }>("/api/recording/enabled")
    .then((r) => {
      enabled = r.data?.enabled === true;
    })
    // Unreadable: it stays off here, and the next screen that needs it asks again.
    .catch(() => {})
    .finally(() => {
      asking = false;
      listeners.forEach((l) => l());
    });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  ask();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether streams can be recorded here — asked once a page load and shared.
 * Off until the answer's in: the go-live switch and the setting hide.
 */
export function useRecordingEnabled(): boolean {
  return useSyncExternalStore(subscribe, () => enabled === true, () => false);
}

/* ---- Words ---- */

/** A replay's state, short — on a card or a pill. */
export const REPLAY_WORDS: Record<ReplayStatus, string> = {
  recording: "Recording",
  processing: "Replay processing",
  ready: "Replay",
  failed: "Replay failed",
};

/** The host deletes a replay — for good. */
export async function deleteReplay(streamId: string) {
  await apiFetch(`/api/streams/${streamId}/replay`, { method: "DELETE" });
}
