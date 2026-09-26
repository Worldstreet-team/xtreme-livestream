import {
  BRAND_ACCENTS,
  BRAND_FONTS,
  CHART_INTERVALS,
  LOGO_CORNERS,
  LOWER_THIRD_STYLES,
  SCENE_CARDS,
  SCENE_LAYOUTS,
  MAX_PRICE_SYMBOLS,
  MAX_SCENE_GAINS,
  type BrandAccent,
  type BrandFont,
  type BrandPreset,
  type ChartInterval,
  type FeaturedItem,
  type LogoCorner,
  type LowerThirdStyle,
  type Scene,
  type SceneCard,
  type SceneChart,
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

export type { BrandAccent, BrandFont, BrandPreset, ChartInterval, FeaturedItem, LogoCorner, SceneChart, LowerThirdStyle, Scene, SceneCard, SceneLayer, SceneLayerKind, SceneLayout };

export const DEFAULT_SCENE: Scene = {
  layout: "auto",
  card: null,
  cardNote: "",
  chart: null,
  layers: [],
  gains: {},
  spotlight: null,
  interpreter: null,
  featured: null,
  version: 0,
};

/** What Chart + face shows until the host picks a market. */
export const DEFAULT_CHART: SceneChart = { symbol: "BTC-USD", interval: "5m" };

/** The markets a host reaches for first; any "BASE-QUOTE" pair works. */
export const CHART_MARKETS = ["BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD", "USDT-USD"] as const;

export const CHART_INTERVAL_LABELS: Record<ChartInterval, string> = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h" };

/** What a market looks like once uppercased: "BTC-USD", "ADA-USDT". */
export const MARKET_SYMBOL = /^[A-Z0-9]{2,10}-[A-Z]{3,4}$/;

/** A market off the wire, if it's one we can chart. */
export function readChart(raw: unknown): SceneChart | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = typeof r.symbol === "string" ? r.symbol.trim().toUpperCase() : "";
  if (!MARKET_SYMBOL.test(symbol)) return null;
  const interval = CHART_INTERVALS.includes(r.interval as ChartInterval) ? (r.interval as ChartInterval) : "5m";
  return { symbol, interval };
}

/** Whatever came off the wire — the API, room metadata, a data event — as a scene, or null. */
export function readScene(raw: unknown): Scene | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    layout: SCENE_LAYOUTS.includes(r.layout as SceneLayout) ? (r.layout as SceneLayout) : "auto",
    card: SCENE_CARDS.includes(r.card as SceneCard) ? (r.card as SceneCard) : null,
    cardNote: typeof r.cardNote === "string" ? r.cardNote.slice(0, 80) : "",
    chart: readChart(r.chart),
    layers: readLayers(r.layers),
    gains: readGains(r.gains),
    spotlight: typeof r.spotlight === "string" && /^[\w.:-]{1,64}$/.test(r.spotlight) ? r.spotlight : null,
    interpreter: typeof r.interpreter === "string" && /^[\w.:-]{1,64}$/.test(r.interpreter) ? r.interpreter : null,
    featured: readFeatured(r.featured),
    version: typeof r.version === "number" ? r.version : 0,
  };
}

/** The guest faders, as far as they make sense: identities to a level 0–1, eight at most. */
export function readGains(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [identity, level] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_SCENE_GAINS)) {
    if (typeof level === "number" && Number.isFinite(level) && /^[\w.:-]{1,64}$/.test(identity)) out[identity] = Math.min(1, Math.max(0, level));
  }
  return out;
}

/** How loud one person on stage plays, by the host's fader (1 when there isn't one). */
export function gainFor(gains: Record<string, number> | undefined, identity: string | undefined) {
  return identity && gains && typeof gains[identity] === "number" ? gains[identity] : 1;
}

/** The comment or gift on screen, if what came is one we can draw. */
export function readFeatured(raw: unknown): FeaturedItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const orNull = (v: unknown) => (typeof v === "string" ? v : null);
  if (!str(r.id) || !str(r.username) || Number.isNaN(Date.parse(str(r.at)))) return null;
  return {
    id: str(r.id),
    kind: r.kind === "gift" || r.kind === "request" ? r.kind : "chat",
    userId: str(r.userId),
    username: str(r.username),
    avatar: str(r.avatar),
    text: str(r.text).slice(0, 500),
    emoji: orNull(r.emoji),
    amount: orNull(r.amount),
    currency: orNull(r.currency),
    at: str(r.at),
    until: orNull(r.until),
    auto: r.auto === true,
    ...(typeof r.note === "string" && r.note ? { note: r.note.slice(0, 120) } : {}),
  };
}

/**
 * When a featured item comes down, on this device's clock. Its span
 * (until − at) caps the wait, so a device whose clock runs behind the
 * server's doesn't keep it up longer than the host asked. Null: until the
 * host takes it down.
 */
export function featuredDeadline(item: Pick<FeaturedItem, "at" | "until">, now: number) {
  if (!item.until) return null;
  const until = Date.parse(item.until);
  const span = until - Date.parse(item.at);
  return Math.min(until, now + span);
}

/** A line a moderator suggested for the screen, waiting on the host. */
export interface SuggestedLine {
  messageId: string;
  username: string;
  text: string;
  kind: "chat" | "gift";
  suggestedBy: string;
}

export function readFeatureQueue(raw: unknown): SuggestedLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
    .map((q) => ({
      messageId: String(q.messageId ?? ""),
      username: String(q.username ?? ""),
      text: String(q.text ?? ""),
      kind: q.kind === "gift" ? ("gift" as const) : ("chat" as const),
      suggestedBy: String(q.suggestedBy ?? ""),
    }))
    .filter((q) => q.messageId);
}

/** The lengths a host can put a comment up for; 0 is until they take it down. */
export const FEATURE_LENGTHS: { seconds: 0 | 10 | 20 | 60; label: string }[] = [
  { seconds: 10, label: "10s" },
  { seconds: 20, label: "20s" },
  { seconds: 60, label: "1 min" },
  { seconds: 0, label: "Until I hide it" },
];

/** The gift tiers that go on screen by themselves; 0 is off. */
export const FEATURE_GIFT_TIERS: { minor: 0 | 500 | 2000 | 10_000; label: string }[] = [
  { minor: 0, label: "Off" },
  { minor: 500, label: "$5+" },
  { minor: 2000, label: "$20+" },
  { minor: 10_000, label: "$100+" },
];

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

/**
 * Markets as typed or sent — "btc-usd", twice, a "$100" — as the price
 * strip shows them: uppercase, only real-looking pairs, each once, five at
 * most. What's left is the strip; nothing left, no strip.
 */
export function readSymbols(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const symbol = item.trim().toUpperCase();
    if (MARKET_SYMBOL.test(symbol) && !out.includes(symbol)) out.push(symbol);
    if (out.length === MAX_PRICE_SYMBOLS) break;
  }
  return out;
}

function readLayer(raw: unknown): SceneLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  switch (r.kind) {
    case "prices": {
      const symbols = readSymbols(r.symbols);
      return symbols.length > 0 ? { kind: "prices", symbols } : null;
    }
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
    case "cta": {
      const title = text(r.title, 40);
      const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url.trim()) ? r.url.trim().slice(0, 300) : "";
      return title && url ? { kind: "cta", title, url } : null;
    }
    case "sponsor": {
      const source = r.source === "own" || r.source === "campaign" ? r.source : null;
      const sponsorId = typeof r.sponsorId === "string" && /^[a-f\d]{24}$/i.test(r.sponsorId) ? r.sponsorId : "";
      const name = text(r.name, 40);
      if (!source || !sponsorId || !name) return null;
      const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url.trim()) ? r.url.trim().slice(0, 300) : "";
      // Only our own logo route: the card never loads an image from elsewhere.
      const logoUrl = typeof r.logoUrl === "string" && r.logoUrl.startsWith("/api/") ? r.logoUrl.slice(0, 300) : null;
      return { kind: "sponsor", source, sponsorId, name, line: text(r.line, 80), url, code: text(r.code, 24), logoUrl, restricted: r.restricted === true };
    }
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
  /** The face titles wear. */
  font: BrandFont;
  logoUrl: string | null;
  /** Graphics kept for reuse (only the creator's own brand carries them). */
  presets: BrandPreset[];
}

export const DEFAULT_BRAND: Brand = { accent: "ember", lowerThird: "bar", font: "wide", logoUrl: null, presets: [] };

/** Each brand font as the class that sets it — faces the app already loads. */
export const BRAND_FONT_CLASS: Record<BrandFont, string> = {
  wide: "font-wide",
  clean: "font-sans",
  rounded: "font-poppins",
  mono: "font-mono",
};

export const BRAND_FONT_LABELS: Record<BrandFont, string> = {
  wide: "Wide",
  clean: "Clean",
  rounded: "Rounded",
  mono: "Mono",
};

/** Presets off the wire: the ones this build can use, in order. */
export function readPresets(raw: unknown): BrandPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: BrandPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    if (r.kind === "lower-third" && str(r.title, 48)) out.push({ kind: "lower-third", title: str(r.title, 48), subtitle: str(r.subtitle, 72) });
    else if (r.kind === "banner" && str(r.text, 100)) out.push({ kind: "banner", text: str(r.text, 100) });
    else if (r.kind === "ticker" && str(r.text, 240)) out.push({ kind: "ticker", text: str(r.text, 240) });
  }
  return out;
}

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
    font: BRAND_FONTS.includes(r.font as BrandFont) ? (r.font as BrandFont) : "wide",
    logoUrl: path ? apiUrl(path) : null,
    presets: readPresets(r.presets),
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

/** "shop.example.com/merch" — a link as people read it, not as it's typed. */
export function shortUrl(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

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
  if (layout === "solo" || layout === "screen-face" || layout === "chart-face") return 0;
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
  { id: "chart-face", label: "Chart + face", hint: "A live market chart, your camera in the corner" },
];

export const CARDS: { id: SceneCard; title: string; body: string }[] = [
  { id: "starting-soon", title: "Starting soon", body: "Get comfortable — we're about to go." },
  { id: "brb", title: "Be right back", body: "Stay put — the stream picks up in a moment." },
  { id: "ending", title: "Thanks for watching", body: "That's it for today. See you next time." },
];
