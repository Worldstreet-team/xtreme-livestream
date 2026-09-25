import { SCENE_CARDS, SCENE_LAYOUTS, type Scene, type SceneCard, type SceneLayout } from "@xtreme/contracts";

/**
 * Scenes on the client: reading them off the wire, and the words for them.
 * The shape itself lives in @xtreme/contracts (sceneBodySchema); the API
 * stores it on the stream and broadcasts it as room metadata and as an
 * `__evt: scene` data event.
 */

export type { Scene, SceneCard, SceneLayout };

export const DEFAULT_SCENE: Scene = { layout: "auto", card: null, cardNote: "", version: 0 };

/** Whatever came off the wire — the API, room metadata, a data event — as a scene, or null. */
export function readScene(raw: unknown): Scene | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    layout: SCENE_LAYOUTS.includes(r.layout as SceneLayout) ? (r.layout as SceneLayout) : "auto",
    card: SCENE_CARDS.includes(r.card as SceneCard) ? (r.card as SceneCard) : null,
    cardNote: typeof r.cardNote === "string" ? r.cardNote.slice(0, 80) : "",
    version: typeof r.version === "number" ? r.version : 0,
  };
}

/** Room metadata is a JSON string, `{ scene }`. */
export function sceneFromMetadata(metadata: string | null | undefined): Scene | null {
  if (!metadata) return null;
  try {
    return readScene((JSON.parse(metadata) as { scene?: unknown }).scene);
  } catch {
    return null;
  }
}

/** Metadata and the data event can land in either order: the newer version wins. */
export function newerScene(current: Scene | null | undefined, next: Scene | null): Scene | undefined {
  if (!next) return current ?? undefined;
  if (!current || next.version >= current.version) return next;
  return current;
}

/**
 * How many of the other people on stage the layout shows, in order. A
 * battle keeps its split whatever the scene says (`forceAuto`): the other
 * side of a battle is never hidden.
 */
export function guestsShown(layout: SceneLayout, available: number, forceAuto = false) {
  if (forceAuto || layout === "auto") return available;
  if (layout === "solo" || layout === "screen-face") return 0;
  if (layout === "split") return Math.min(1, available);
  if (layout === "trio") return Math.min(2, available);
  return Math.min(3, available);
}

export const LAYOUTS: { id: SceneLayout; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "Splits for whoever's on" },
  { id: "solo", label: "Solo", hint: "Just you" },
  { id: "split", label: "Split", hint: "You and one guest" },
  { id: "trio", label: "Trio", hint: "You and two guests" },
  { id: "grid", label: "Grid", hint: "Up to four of you" },
  { id: "screen-face", label: "Screen + face", hint: "Your screen, your camera in the corner" },
];

export const CARDS: { id: SceneCard; title: string; body: string }[] = [
  { id: "starting-soon", title: "Starting soon", body: "Get comfortable — we're about to go." },
  { id: "brb", title: "Be right back", body: "Stay put — the stream picks up in a moment." },
  { id: "ending", title: "Thanks for watching", body: "That's it for today. See you next time." },
];
