"use client";

import { useSyncExternalStore } from "react";
import type { PhoneSlot, SceneLayout } from "@xtreme/contracts";
import { guestsShown } from "@/lib/scene";

/**
 * The phone as a camera (Phase 3, angles): a second phone in the room
 * (`cam-<hostId>`, camera-only, the host's own account) is a source the
 * host places in the layout like a guest or their own face cam — where it
 * sits is `scene.phoneSlot` — and each viewer can pin an angle of their own
 * over it: Director follows the host; Main, Phone and Split pin one for
 * this screen alone. Whatever's showing is what gets fetched sharp: the
 * big picture in high quality, a split at medium each, a corner at medium,
 * and a feed that isn't on screen at low or not at all.
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

/* ---- where the phone sits in the program ----------------------------- */

/** The placements, in the host's words (the Scenes panel's Phone row). */
export const PHONE_SLOT_CHOICES: { id: PhoneSlot; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Not in the picture" },
  { id: "main", label: "Main", hint: "The phone takes your picture" },
  { id: "beside", label: "Beside", hint: "A tile of its own, like a guest" },
  { id: "corner", label: "Corner", hint: "Small, in the corner" },
];

/** Where the phone lands in a layout. */
export interface PhonePlace {
  /** It has the host's own tile, over their picture — which stays attached underneath, so a cut back is instant. */
  cell: boolean;
  /** It's a tile of its own, first beside the host, where the layout has room for others. */
  beside: boolean;
  /** It's the small picture in the corner. */
  corner: boolean;
}

/**
 * The one reading of a placement, for every screen that draws the program
 * (SceneRenderer) and every thumb that shows it. Chart + face has a single
 * picture besides the chart — the face in the corner — so the phone taking
 * the host's picture there is the phone in the corner.
 */
export function placePhone(slot: PhoneSlot, layout: SceneLayout): PhonePlace {
  if (layout === "chart-face") return { cell: false, beside: slot === "beside", corner: slot === "main" || slot === "corner" };
  return { cell: slot === "main", beside: slot === "beside", corner: slot === "corner" };
}

/**
 * Does the corner show? Chart + face is the corner. Otherwise only while the
 * host has the frame to themselves, and never in Solo, which is one picture.
 */
export function cornerShows(layout: SceneLayout, othersShown: number) {
  return layout === "chart-face" || (layout !== "solo" && othersShown === 0);
}

/**
 * How many tiles beside the host's the program shows: the others on stage
 * and, placed beside the host, the phone — first, since the host put it
 * there. A battle's sides own the frame, so there the phone stays out.
 */
export function tilesBeside(layout: SceneLayout, others: number, slot: PhoneSlot, forceAuto = false) {
  const phone = !forceAuto && placePhone(slot, layout).beside ? 1 : 0;
  return guestsShown(layout, others + phone, forceAuto);
}

/** Is the phone on screen in this layout, with this many others on stage? */
export function phoneOnScreen(slot: PhoneSlot, layout: SceneLayout, others = 0, forceAuto = false) {
  const effective: SceneLayout = forceAuto ? "auto" : layout;
  const place = placePhone(slot, effective);
  if (place.cell) return true;
  if (place.beside) return !forceAuto && guestsShown(effective, others + 1, forceAuto) > 0;
  if (place.corner) return cornerShows(effective, guestsShown(effective, others, forceAuto));
  return false;
}

/**
 * The phone shots (the Second camera panel): a layout and a placement
 * together, so one tap puts the phone exactly where the thumb shows it.
 * `layout: null` keeps the layout on screen.
 */
export type PhoneShotId = "off" | "phone" | "side" | "corner" | "swap";
export interface PhoneShot {
  id: PhoneShotId;
  layout: SceneLayout | null;
  slot: PhoneSlot;
  /** Only with a camera of the host's own to put in the corner. */
  needsCamera?: boolean;
}
export const PHONE_SHOTS: PhoneShot[] = [
  { id: "off", layout: null, slot: "off" },
  { id: "phone", layout: "solo", slot: "main" },
  { id: "side", layout: "split", slot: "beside" },
  { id: "corner", layout: "screen-face", slot: "corner" },
  { id: "swap", layout: "screen-face", slot: "main", needsCamera: true },
];

/**
 * A shot's name and line, as the host reads them (or, `crew`, a producer):
 * the corner is the face when a screen has the picture.
 */
export function phoneShotWords(id: PhoneShotId, { sharing = false, crew = false }: { sharing?: boolean; crew?: boolean } = {}) {
  const your = crew ? "their" : "your";
  const picture = sharing ? `${your} screen` : `${your} camera`;
  switch (id) {
    case "off":
      return { label: "Not shown", hint: crew ? "Only the host's own picture" : "Only your own picture" };
    case "phone":
      return { label: "Phone only", hint: "The phone, full frame" };
    case "side":
      return { label: "Side by side", hint: `${cap(picture)} and the phone, split` };
    case "corner":
      return sharing
        ? { label: "Screen + phone", hint: `${cap(your)} screen, the phone as ${your} face in the corner` }
        : { label: "Phone in corner", hint: `${cap(picture)} big, the phone small in the corner` };
    case "swap":
      return { label: crew ? "Phone + host" : "Phone + you", hint: `The phone big, ${your} camera in the corner` };
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The shot a scene is on, if it's one of them; null when the host framed it some other way. */
export function phoneShotOf(layout: SceneLayout, slot: PhoneSlot): PhoneShotId | null {
  if (slot === "off") return "off";
  return PHONE_SHOTS.find((s) => s.slot === slot && s.layout === layout)?.id ?? null;
}

/* ---- what each viewer sees of it -------------------------------------- */

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

export interface PhoneView {
  /** Where the phone sits on this screen. */
  slot: PhoneSlot;
  /** This screen's layout: the host's, unless the viewer pinned the split. */
  layout: SceneLayout;
  /** The host's own feed (their identity, or `obs-<id>`). Never off: it's the stream. */
  main: Exclude<TileQuality, "off">;
  /** The phone cam (`cam-<id>`). Off whenever it isn't on screen. */
  phone: TileQuality;
}

/**
 * What this viewer sees, from the host's layout and placement and their own
 * pick — and how sharp each camera should come in. With no phone in the
 * room there is only the main camera, whatever anyone picked. Pinning the
 * phone gives it the host's picture; pinning the split is both side by
 * side, with everyone else on stage too.
 */
export function viewPhone(host: { layout: SceneLayout; phoneSlot: PhoneSlot }, pick: ViewerPick, phoneAvailable = true): PhoneView {
  if (!phoneAvailable) return { slot: "off", layout: host.layout, main: "high", phone: "off" };
  const slot: PhoneSlot = pick === "director" ? host.phoneSlot : pick === "main" ? "off" : pick === "phone" ? "main" : "beside";
  const layout: SceneLayout = pick === "split" ? "auto" : host.layout;
  const place = placePhone(slot, layout);
  if (!phoneOnScreen(slot, layout)) return { slot, layout, main: "high", phone: "off" };
  // The phone has the host's picture: the host's feed stays in at the
  // smallest layer, so a cut back is instant — a size up when it's the face
  // in the corner (Screen + face).
  if (place.cell) return { slot, layout, main: layout === "screen-face" ? "medium" : "low", phone: "high" };
  if (place.beside) return { slot, layout, main: "medium", phone: "medium" };
  // The phone in the corner: over the host's picture — or, in Chart + face, instead of it.
  return { slot, layout, main: layout === "chart-face" ? "low" : "high", phone: "medium" };
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
