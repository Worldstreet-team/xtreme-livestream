"use client";

import { useSyncExternalStore } from "react";

/**
 * Data saver (Phase 1): 36% of Nigerian lines are 2G and a gigabyte costs
 * about ₦475, while an hour of 720p is ~0.8 GB. So a viewer can cap the
 * picture at 360p — Data saver — and live previews on the feed turn back
 * into still pictures. The choice is theirs and stays with this browser;
 * a phone that says it's saving data (Save-Data) starts there.
 *
 * Radio — the sound without the picture — is a choice for one stream at a
 * time, so it lives with the watch page rather than here.
 */

export type DataMode = "auto" | "saver";
export type PictureMode = DataMode | "radio";

const KEY = "xtream:data-mode";
const EVENT = "xtream:data-mode";

/** Roughly what an hour costs: data in GB at each setting, at ₦475 a GB. */
export const NAIRA_PER_GB = 475;
export const PICTURE_MODES: { id: PictureMode; label: string; hint: string; gbPerHour: number }[] = [
  { id: "auto", label: "Auto", hint: "HD when your connection allows", gbPerHour: 0.8 },
  { id: "saver", label: "Data saver", hint: "Up to 360p", gbPerHour: 0.25 },
  { id: "radio", label: "Radio", hint: "Just the sound", gbPerHour: 0.02 },
];

/** About what an hour costs, rounded to ₦5: "₦380". */
export function nairaAmount(mode: PictureMode) {
  const gb = PICTURE_MODES.find((m) => m.id === mode)?.gbPerHour ?? 0.8;
  return `₦${Math.max(5, Math.round((gb * NAIRA_PER_GB) / 5) * 5).toLocaleString("en-NG")}`;
}

/** "≈ ₦380 an hour". */
export function nairaPerHour(mode: PictureMode) {
  return `≈ ${nairaAmount(mode)} an hour`;
}

function saysSaveData() {
  const c = typeof navigator !== "undefined" ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined;
  return Boolean(c?.saveData);
}

function read(): DataMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "auto" || v === "saver") return v;
  } catch {
    // Storage blocked: fall through to what the phone says.
  }
  return saysSaveData() ? "saver" : "auto";
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setDataMode(mode: DataMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Kept for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The viewer's data setting, the same in every component and tab. */
export function useDataMode(): DataMode {
  return useSyncExternalStore(subscribe, read, () => "auto");
}
