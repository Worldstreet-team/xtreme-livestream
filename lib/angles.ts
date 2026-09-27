"use client";

import { useSyncExternalStore } from "react";
import type { SceneAngle } from "@xtreme/contracts";

/**
 * Viewer-chosen angles (Phase 3): a second phone in the room as a camera
 * (`cam-<hostId>`, camera-only, the host's own account), the host's pick
 * of what the program shows (`scene.angle`), and each viewer's own pick
 * over it — Director follows the host; Main, Phone and Split pin one for
 * this screen alone. Whatever's showing is what gets fetched sharp: the
 * pinned tile in high quality, a split at medium each, and a tile that
 * isn't on screen at low or not at all.
 *
 * Pure apart from the store, and free of livekit-client on purpose: the
 * studio loads LiveKit lazily, and the qualities here are words the watch
 * page maps to VideoQuality itself.
 */

export const CAMERA_PREFIX = "cam-";
/** Is this room identity the host's phone cam? */
export const isCameraIdentity = (identity: string) => identity.startsWith(CAMERA_PREFIX);
/** The phone cam's identity for a host: one per account, so a second phone takes over from the first. */
export const cameraIdentityOf = (hostId: string) => `${CAMERA_PREFIX}${hostId}`;

/** What the host has the program show: their camera, the phone full-frame, or both side by side. */
export type Angle = SceneAngle;
export const ANGLES: { id: Angle; label: string; hint: string }[] = [
  { id: "main", label: "Main", hint: "Your camera, as before" },
  { id: "phone", label: "Phone", hint: "The phone, full frame" },
  { id: "both", label: "Both", hint: "The two side by side" },
];

/** A viewer's own pick: follow the host, or pin one. */
export type ViewerPick = "director" | "main" | "phone" | "split";
export const PICKS: { id: ViewerPick; label: string; hint: string }[] = [
  { id: "director", label: "Director", hint: "Follow the host's cuts" },
  { id: "main", label: "Main", hint: "Stay on the main camera" },
  { id: "phone", label: "Phone", hint: "Stay on the phone" },
  { id: "split", label: "Split", hint: "Both, side by side" },
];
const PICK_IDS: ViewerPick[] = PICKS.map((p) => p.id);

/** How a tile is fetched: the quality LiveKit is asked for, or off — unsubscribed, nothing arrives. */
export type TileQuality = "high" | "medium" | "low" | "off";

export interface ResolvedAngle {
  /** What to draw. */
  show: Angle;
  /** The host's own camera (their identity, or `obs-<id>`). Never off: it's the stream. */
  main: Exclude<TileQuality, "off">;
  /** The phone cam (`cam-<id>`). Off whenever it isn't on screen. */
  phone: TileQuality;
}

/**
 * What this viewer sees, from the host's angle and their own pick — and
 * how sharp each camera should come in. With no phone in the room there
 * is only the main camera, whatever anyone picked.
 */
export function resolveAngle(hostAngle: Angle, pick: ViewerPick, phoneAvailable = true): ResolvedAngle {
  if (!phoneAvailable) return { show: "main", main: "high", phone: "off" };
  const show: Angle = pick === "director" ? hostAngle : pick === "split" ? "both" : pick;
  if (show === "both") return { show, main: "medium", phone: "medium" };
  // Pinned to the phone: the host's camera stays in at the smallest layer,
  // so a cut back is instant rather than a black tile.
  if (show === "phone") return { show, main: "low", phone: "high" };
  return { show: "main", main: "high", phone: "off" };
}

/* ---- the viewer's pick, per stream, kept in this browser ------------- */

const KEY = (streamId: string) => `xtream:angle:${streamId}`;
const EVENT = "xtream:angle";

/** A viewer's pick for a stream — Director unless they pinned one. */
export function readAnglePick(streamId: string): ViewerPick {
  try {
    const v = localStorage.getItem(KEY(streamId));
    if (PICK_IDS.includes(v as ViewerPick)) return v as ViewerPick;
  } catch {
    // Storage blocked: follow the host.
  }
  return "director";
}

export function setAnglePick(streamId: string, pick: ViewerPick) {
  try {
    // Only a pin is worth keeping; Director is the default, so it leaves no key behind.
    if (pick === "director") localStorage.removeItem(KEY(streamId));
    else localStorage.setItem(KEY(streamId), pick);
  } catch {
    // Kept for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === null || e.key.startsWith("xtream:angle:")) && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The viewer's pick for this stream, the same in every component and tab. */
export function useAnglePick(streamId: string): ViewerPick {
  return useSyncExternalStore(subscribe, () => readAnglePick(streamId), () => "director");
}
