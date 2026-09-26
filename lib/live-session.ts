"use client";

import { useSyncExternalStore } from "react";

/**
 * The broadcast this tab is running, for the app outside the studio.
 *
 * The studio stays mounted in the app shell while you're live (see
 * components/app/studio/studio-host.tsx), so browsing never takes you off
 * the air; this is how the rest of the app knows. The studio writes it —
 * the rail's live card and the minimized player read it — and registers
 * the few things they can ask of it. Null when nothing's on air here.
 */
export interface LiveSession {
  /**
   * "live": on air. "reconnecting": LiveKit is healing the connection
   * itself. "rejoining": the connection died and the studio is getting
   * back on while the stream holds (viewers see "Be right back").
   */
  state: "live" | "reconnecting" | "rejoining";
  streamId: string;
  title: string;
  /** When the broadcast started (epoch ms) — the clock counts from it. */
  startedAt: number;
  viewers: number;
  micOn: boolean;
  camOn: boolean;
  source: "camera" | "screen" | "obs";
}

export interface LiveActions {
  toggleMic: () => void;
  toggleCam: () => void;
  /** Try to get back on air now, rather than at the next backoff step. */
  reconnect: () => void;
  end: () => Promise<void>;
}

let session: LiveSession | null = null;
let actions: LiveActions | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The studio's side: what's on air (null when nothing is), and how to act on it. */
export function publishLiveSession(next: LiveSession | null, nextActions: LiveActions | null) {
  actions = nextActions;
  if (next === session) return;
  // Unchanged facts don't wake every reader.
  if (next && session && (Object.keys(next) as (keyof LiveSession)[]).every((k) => next[k] === session![k])) return;
  session = next;
  listeners.forEach((l) => l());
}

/** The broadcast this tab is running, or null. */
export function useLiveSession(): LiveSession | null {
  return useSyncExternalStore(
    subscribe,
    () => session,
    () => null,
  );
}

/** What the rail and the mini player can ask of the studio; null when it isn't live. */
export function liveActions(): LiveActions | null {
  return actions;
}

/** "12:04" or "1:02:09" since the broadcast started. */
export function formatOnAir(startedAt: number, now: number) {
  const diff = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
