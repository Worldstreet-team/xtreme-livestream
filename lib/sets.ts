import type { BrandAccent, BrandFont, LowerThirdStyle, SceneLayout } from "@xtreme/contracts";
import type { PadId } from "@/lib/audio-desk";
import type { Look } from "@/lib/looks";
import type { Brand } from "@/lib/scene";
import { GIFT_CATALOG, giftByEmoji } from "@/lib/gifts";
import { EFFECTS, effectDef, type EffectId } from "@/lib/gift-effects";

/**
 * Sets (Phase 4): a small, versioned pack that gives a stream a
 * personality in one tap — a colour for its graphics and a look for the
 * camera, a layout, a stinger between layouts, a sound on the audio desk
 * for some gifts, and an effect drawn around the host's face for others.
 *
 * The host picks one in the studio; it rides the brand kit (`brand.set`),
 * so viewers learn it the way they learn the brand — with the stream, and
 * live through the room's `__evt: "brand"`. A set only points at things the
 * app already has: the brand kit's accents, the looks, the layouts, the
 * desk's pads and the gifts' own animated art, so a set costs nothing to
 * ship and its art is what chat already loads (≈0.6–1.2 MB a set, cached).
 *
 * These four are ours. Designer sets come later, as the same manifest.
 */

/** The gifts a set can answer, by catalog id (lib/gifts.ts). */
export type GiftId =
  | "clap"
  | "heart"
  | "fire"
  | "rocket"
  | "party"
  | "diamond"
  | "trophy"
  | "crown"
  | "lion"
  | "unicorn"
  | "wolf"
  | "whale"
  | "phoenix"
  | "tsion-car"
  | "jets"
  | "island"
  | "bank";

export type SetId = "owambe" | "trading-desk" | "game-night" | "soft-hours";

/** The transition a set plays over the program when the layout changes (components/app/set-stinger.tsx). */
export type StingerStyle = "sweep" | "tape" | "shutter" | "wash";

export type SetSounds = Partial<Record<GiftId, PadId>>;
export type SetEffects = Partial<Record<GiftId, EffectId>>;

export interface SetManifest {
  id: SetId;
  name: string;
  /** Goes up whenever what the set does changes. */
  version: number;
  blurb: string;
  /** Its own colours: the card, the confetti, the stinger. The first is its colour. */
  palette: readonly [string, string, string];
  /** The brand kit while it's on — the graphics' accent, the lower third, the titles' face. The creator's own come back with No set. */
  accent?: BrandAccent;
  lowerThird?: LowerThirdStyle;
  font?: BrandFont;
  /** The camera's colour grade (lib/looks.ts). */
  look?: Look;
  /** The program's layout when it goes on. Left out, the layout stays as it is. */
  layout?: SceneLayout;
  stinger?: StingerStyle;
  /** A pad on the audio desk when one of these gifts lands. */
  sounds: SetSounds;
  /** An effect on the picture when one of these gifts lands. */
  effects: SetEffects;
}

export const SETS: readonly SetManifest[] = [
  {
    id: "owambe",
    name: "Owambe",
    version: 1,
    blurb: "Party rules: gold on everything, a crown when someone goes big, confetti for the rest.",
    palette: ["#f5c542", "#1fae6a", "#fff3d1"],
    accent: "white",
    lowerThird: "pill",
    font: "wide",
    look: "warm",
    layout: "auto",
    stinger: "sweep",
    sounds: { clap: "applause", party: "airhorn", trophy: "levelup", crown: "drumroll", lion: "airhorn", whale: "airhorn", bank: "kaching" },
    effects: {
      clap: "confetti",
      heart: "hearts",
      party: "confetti",
      trophy: "confetti",
      crown: "crown",
      lion: "crown",
      unicorn: "hearts",
      whale: "crown",
      island: "confetti",
      bank: "crown",
    },
  },
  {
    id: "trading-desk",
    name: "Trading desk",
    version: 1,
    blurb: "Black-and-white picture, the chart beside you — rockets and diamonds when the room's bullish.",
    palette: ["#5fe0a8", "#ff4d5e", "#f2f2f2"],
    accent: "mint",
    lowerThird: "bar",
    font: "mono",
    look: "mono",
    layout: "chart-face",
    stinger: "tape",
    sounds: { rocket: "whoosh", jets: "whoosh", diamond: "kaching", whale: "kaching", bank: "kaching", wolf: "airhorn", trophy: "levelup" },
    effects: {
      fire: "fire",
      rocket: "rocket",
      diamond: "diamonds",
      wolf: "shades",
      whale: "diamonds",
      "tsion-car": "rocket",
      jets: "rocket",
      bank: "diamonds",
    },
  },
  {
    id: "game-night",
    name: "Game night",
    version: 1,
    blurb: "Punchy colour, fire for the clutch plays, shades when you win.",
    palette: ["#6cb8ff", "#ff4fa3", "#b6f35c"],
    accent: "sky",
    lowerThird: "bar",
    font: "wide",
    look: "punch",
    stinger: "shutter",
    sounds: { clap: "badumtss", fire: "airhorn", rocket: "whoosh", trophy: "levelup", wolf: "airhorn", phoenix: "airhorn" },
    effects: {
      clap: "confetti",
      fire: "fire",
      rocket: "rocket",
      party: "confetti",
      trophy: "shades",
      crown: "crown",
      lion: "fire",
      wolf: "shades",
      phoenix: "fire",
      "tsion-car": "rocket",
    },
  },
  {
    id: "soft-hours",
    name: "Soft hours",
    version: 1,
    blurb: "Natural light, rounded type and hearts that float — for talk, study and slow nights.",
    palette: ["#ff9ec4", "#c9b6ff", "#fff1e6"],
    accent: "lilac",
    lowerThird: "pill",
    font: "rounded",
    look: "natural",
    layout: "solo",
    stinger: "wash",
    sounds: { party: "applause", crown: "levelup" },
    effects: {
      clap: "hearts",
      heart: "hearts",
      party: "confetti",
      unicorn: "hearts",
      crown: "crown",
      island: "confetti",
    },
  },
];

/** A set by id, or null for none — and for any id this build doesn't know. */
export function setById(id: unknown): SetManifest | null {
  return typeof id === "string" ? (SETS.find((s) => s.id === id) ?? null) : null;
}

/** `brand.set` off the wire: a set this build knows, or null. */
export function readSetId(raw: unknown): SetId | null {
  return setById(raw)?.id ?? null;
}

/** A gift as a tip line names it — its catalog id, or the emoji the chat row carries. */
export type GiftRef = string | { giftId?: string | null; emoji?: string | null } | null | undefined;

function giftIdOf(ref: GiftRef): GiftId | null {
  if (!ref) return null;
  if (typeof ref === "string") {
    const byId = GIFT_CATALOG.find((g) => g.id === ref);
    return ((byId ?? giftByEmoji(ref))?.id as GiftId | undefined) ?? null;
  }
  if (ref.giftId) return giftIdOf(ref.giftId);
  return giftIdOf(ref.emoji ?? null);
}

/** The effect a set plays for a gift, if it has one. */
export function effectForGift(set: SetManifest | null | undefined, gift: GiftRef): EffectId | null {
  const id = giftIdOf(gift);
  return (set && id && set.effects[id]) || null;
}

/** The pad a set plays for a gift, if it has one. */
export function soundForGift(set: SetManifest | null | undefined, gift: GiftRef): PadId | null {
  const id = giftIdOf(gift);
  return (set && id && set.sounds[id]) || null;
}

/** The effects a set draws, each once, in the library's order. */
export function setEffects(set: SetManifest | null | undefined): EffectId[] {
  if (!set) return [];
  const used = new Set(Object.values(set.effects));
  return EFFECTS.filter((e) => used.has(e.id)).map((e) => e.id);
}

/** Which of a set's gifts play an effect, in the catalog's order (cheapest first). */
export function giftsFor(set: SetManifest | null | undefined, effect: EffectId): GiftId[] {
  if (!set) return [];
  return GIFT_CATALOG.map((g) => g.id as GiftId).filter((id) => set.effects[id] === effect);
}

/** A set with effects that sit on the face — the studio follows the host's face only then. */
export function setUsesFace(set: SetManifest | null | undefined): boolean {
  return setEffects(set).some((e) => effectDef(e).face);
}

/** The gift art a set's effects draw — to load it before the first gift lands. */
export function setArt(set: SetManifest | null | undefined): string[] {
  return setEffects(set)
    .map((e) => effectDef(e).art)
    .filter((a): a is string => Boolean(a));
}

/**
 * The brand as the stream wears it: a set's accent, lower third and face
 * over the creator's own while it's on. Nothing's written over — No set,
 * and their own kit is back as it was.
 */
export function brandWithSet(brand: Brand): Brand {
  const set = setById(brand.set);
  if (!set) return brand;
  return {
    ...brand,
    accent: set.accent ?? brand.accent,
    lowerThird: set.lowerThird ?? brand.lowerThird,
    font: set.font ?? brand.font,
  };
}

/**
 * Gift sounds without a pile-up: a pad plays at most once per `gapMs`, so
 * a burst of claps is a round of applause, not twenty. Returns a check —
 * true means play it now.
 */
export function soundGate(gapMs = 700) {
  const last = new Map<PadId, number>();
  return (pad: PadId, now = Date.now()) => {
    const prev = last.get(pad);
    if (prev !== undefined && now - prev < gapMs) return false;
    last.set(pad, now);
    return true;
  };
}
