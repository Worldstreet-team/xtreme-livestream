import {
  BRAND_ACCENTS,
  LOGO_CORNERS,
  LOWER_THIRD_STYLES,
  SCENE_CARDS,
  SCENE_LAYOUTS,
  type BrandAccent,
  type LogoCorner,
  type LowerThirdStyle,
  type Scene,
  type SceneCard,
  type SceneLayer,
  type SceneLayerKind,
  type SceneLayout,
} from "@xtreme/contracts";
import { apiUrl } from "@/lib/api-client";

/**
 * Scenes on the client: reading them off the wire, and the words for them.
 * The shape itself lives in @xtreme/contracts (sceneBodySchema); the API
 * stores it on the stream and broadcasts it as room metadata and as an
 * `__evt: scene` data event.
 */

export type { BrandAccent, LogoCorner, LowerThirdStyle, Scene, SceneCard, SceneLayer, SceneLayerKind, SceneLayout };

export const DEFAULT_SCENE: Scene = { layout: "auto", card: null, cardNote: "", layers: [], version: 0 };

/** Whatever came off the wire — the API, room metadata, a data event — as a scene, or null. */
export function readScene(raw: unknown): Scene | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    layout: SCENE_LAYOUTS.includes(r.layout as SceneLayout) ? (r.layout as SceneLayout) : "auto",
    card: SCENE_CARDS.includes(r.card as SceneCard) ? (r.card as SceneCard) : null,
    cardNote: typeof r.cardNote === "string" ? r.cardNote.slice(0, 80) : "",
    layers: readLayers(r.layers),
    version: typeof r.version === "number" ? r.version : 0,
  };
}

/**
 * The graphics, one of each kind at most, in the order they came. Anything
 * this build doesn't know — a newer kind, a broken field — is skipped
 * rather than drawn wrong.
 */
export function readLayers(raw: unknown): SceneLayer[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<SceneLayerKind>();
  const layers: SceneLayer[] = [];
  for (const item of raw) {
    const layer = readLayer(item);
    if (layer && !seen.has(layer.kind)) {
      seen.add(layer.kind);
      layers.push(layer);
    }
  }
  return layers;
}

function readLayer(raw: unknown): SceneLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  switch (r.kind) {
    case "lower-third": {
      const title = text(r.title, 48);
      return title ? { kind: "lower-third", title, subtitle: text(r.subtitle, 72) } : null;
    }
    case "banner":
    case "ticker": {
      const body = text(r.text, r.kind === "banner" ? 100 : 240);
      return body ? { kind: r.kind, text: body } : null;
    }
    case "countdown": {
      const endsAt = typeof r.endsAt === "string" && !Number.isNaN(Date.parse(r.endsAt)) ? r.endsAt : null;
      return endsAt ? { kind: "countdown", label: text(r.label, 40), endsAt } : null;
    }
    case "logo":
      return { kind: "logo", corner: LOGO_CORNERS.includes(r.corner as LogoCorner) ? (r.corner as LogoCorner) : "top-right" };
    default:
      return null;
  }
}

/** The scene's graphic of one kind, if it has one. */
export function layerOf<K extends SceneLayerKind>(layers: SceneLayer[], kind: K) {
  return layers.find((l): l is Extract<SceneLayer, { kind: K }> => l.kind === kind);
}

/** The graphics with one kind put up (replacing any before it) or, with null, taken down. */
export function withLayer(layers: SceneLayer[], kind: SceneLayerKind, layer: SceneLayer | null): SceneLayer[] {
  const rest = layers.filter((l) => l.kind !== kind);
  return layer ? [...rest, layer] : rest;
}

/**
 * A creator's brand kit, ready to draw: the accent their graphics wear, the
 * lower third's shape, and their logo's URL (null without one).
 */
export interface Brand {
  accent: BrandAccent;
  lowerThird: LowerThirdStyle;
  logoUrl: string | null;
}

export const DEFAULT_BRAND: Brand = { accent: "ember", lowerThird: "bar", logoUrl: null };

/**
 * The brand as the API sends it: `/users/me/brand` gives the logo's URL; a
 * stream's populated host gives only its version (never the bytes), which
 * with the host's id builds the same URL.
 */
export function readBrand(raw: unknown, userId?: string): Brand {
  if (!raw || typeof raw !== "object") return DEFAULT_BRAND;
  const r = raw as Record<string, unknown>;
  const version = typeof r.logoVersion === "number" ? r.logoVersion : 0;
  const path =
    typeof r.logoUrl === "string" && r.logoUrl
      ? r.logoUrl
      : version > 0 && userId
        ? `/api/users/${userId}/logo?v=${version}`
        : null;
  return {
    accent: BRAND_ACCENTS.includes(r.accent as BrandAccent) ? (r.accent as BrandAccent) : "ember",
    lowerThird: LOWER_THIRD_STYLES.includes(r.lowerThird as LowerThirdStyle) ? (r.lowerThird as LowerThirdStyle) : "bar",
    logoUrl: path ? apiUrl(path) : null,
  };
}

/**
 * The accents a creator can dress their graphics in: a flat fill and the ink
 * that reads on it (every pair clears 4.5:1). Ember is the house colour;
 * the rest are theirs to pick, since these are their graphics, not ours.
 */
export const ACCENTS: Record<BrandAccent, { label: string; fill: string; ink: string }> = {
  ember: { label: "Ember", fill: "#f85810", ink: "#1c0a03" },
  chili: { label: "Chili", fill: "#e3122a", ink: "#ffffff" },
  white: { label: "White", fill: "#ffffff", ink: "#0b0708" },
  sky: { label: "Sky", fill: "#6cb8ff", ink: "#04121f" },
  mint: { label: "Mint", fill: "#5fe0a8", ink: "#03170f" },
  lilac: { label: "Lilac", fill: "#b69cff", ink: "#140a2b" },
};

export const LOWER_THIRDS: { id: LowerThirdStyle; label: string }[] = [
  { id: "bar", label: "Bar" },
  { id: "pill", label: "Pill" },
];

export const LOGO_CORNER_LABELS: Record<LogoCorner, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

/** "4:59", "1:02:03" — what's left on a countdown, never below zero. */
export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
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
