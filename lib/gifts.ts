/**
 * The gift catalog — one list, shared by the picker, the chat row, the
 * on-video spectacle and the studio's tip alerts, so a gift looks the same
 * everywhere it appears.
 *
 * Amounts are USD cents, charged to the central dollar wallet; the API
 * accepts anything from 50¢ to $1,000 and these are the named steps on the
 * way up. Each gift has an animated face: Google's Noto animated emoji,
 * served as looping WebP, so the picker reads like a sticker keyboard
 * rather than a row of static boxes. The plain emoji is the fallback for
 * chat text and for anywhere the image can't load.
 */

export interface GiftDef {
  id: string;
  name: string;
  emoji: string;
  /** Noto animated emoji codepoint path segment, e.g. "1f525". */
  art: string;
  usdMinor: number;
  /** A word for what sending it means, for the chat row. */
  verb: string;
}

export const GIFT_CATALOG: readonly GiftDef[] = [
  { id: "clap", name: "Clap", emoji: "👏", art: "1f44f", usdMinor: 50, verb: "clapped" },
  { id: "heart", name: "Heart", emoji: "❤️", art: "2764_fe0f", usdMinor: 100, verb: "sent love" },
  { id: "fire", name: "Fire", emoji: "🔥", art: "1f525", usdMinor: 200, verb: "lit it up" },
  { id: "rocket", name: "Rocket", emoji: "🚀", art: "1f680", usdMinor: 500, verb: "sent a rocket" },
  { id: "party", name: "Party", emoji: "🎉", art: "1f389", usdMinor: 1000, verb: "started a party" },
  { id: "diamond", name: "Diamond", emoji: "💎", art: "1f48e", usdMinor: 2000, verb: "dropped a diamond" },
  { id: "trophy", name: "Trophy", emoji: "🏆", art: "1f3c6", usdMinor: 5000, verb: "handed over a trophy" },
  { id: "crown", name: "Crown", emoji: "👑", art: "1f451", usdMinor: 10_000, verb: "crowned the stream" },
  { id: "lion", name: "Lion", emoji: "🦁", art: "1f981", usdMinor: 20_000, verb: "sent a lion" },
  { id: "unicorn", name: "Unicorn", emoji: "🦄", art: "1f984", usdMinor: 25_000, verb: "sent a unicorn" },
  { id: "wolf", name: "Wolf", emoji: "🐺", art: "1f43a", usdMinor: 50_000, verb: "unleashed the wolf" },
  { id: "whale", name: "Whale", emoji: "🐳", art: "1f433", usdMinor: 100_000, verb: "went whale" },
] as const;

/** The API's bounds, in cents. */
export const GIFT_MIN_MINOR = 50;
export const GIFT_MAX_MINOR = 100_000;

/** Looping animated WebP of a gift's face, from Google's Noto set. Only the
 *  512px cut is published, so every size draws from it. */
export function giftArtUrl(art: string) {
  return `https://fonts.gstatic.com/s/e/notoemoji/latest/${art}/512.webp`;
}

/** The catalog entry behind an emoji seen in a chat payload, if any. */
export function giftByEmoji(emoji: string | null | undefined) {
  if (!emoji) return null;
  return GIFT_CATALOG.find((g) => g.emoji === emoji) ?? null;
}

export function centsToDollars(minor: number) {
  const dollars = minor / 100;
  return minor % 100 === 0 ? `$${dollars.toLocaleString()}` : `$${dollars.toFixed(2)}`;
}
