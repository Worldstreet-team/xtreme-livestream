import {
  Users,
  Wallet,
  ChartLineUp,
  CurrencyBtc,
  Sparkle,
  GraduationCap,
  Storefront,
  Target,
  GameController,
  MonitorPlay,
  type Icon,
} from "@/components/icons";
import type { PromoArtId } from "@/components/app/promo-art/promo-art-pieces";

/**
 * The rest of WorldStreet — every sibling product this app points at.
 *
 * One list, two surfaces: the rail's "Products" group and the hero
 * carousel's promo slides. It lives here rather than in either component so
 * the two can never drift into advertising different platforms, which is
 * exactly what happened while the rail owned the only copy. Names mirror
 * the socials app's ratified `src/data/ecosystem.ts`.
 */

export interface EcosystemApp {
  title: string;
  /** One line on what it is — the rail has room for it under the name. */
  description: string;
  /** The launcher tile's label, one short word. */
  short: string;
  href: string;
  icon: Icon;
}

export const ECOSYSTEM: EcosystemApp[] = [
  { title: "WorldSpace", short: "WorldSpace", description: "The social feed", href: "https://social.worldstreetgold.com", icon: Users },
  { title: "Dashboard", short: "Dashboard", description: "Wallet and portfolio", href: "https://dashboard.worldstreetgold.com", icon: Wallet },
  { title: "Forex Markets", short: "Forex", description: "Trade currency pairs", href: "https://dashboard.worldstreetgold.com/trade", icon: ChartLineUp },
  { title: "Cryptocurrencies", short: "Crypto", description: "Buy, sell and hold crypto", href: "https://dashboard.worldstreetgold.com/trade", icon: CurrencyBtc },
  { title: "Vivid AI", short: "Vivid", description: "The assistant across the ecosystem", href: "https://worldstreetgold.com/vivid", icon: Sparkle },
  { title: "Academy", short: "Academy", description: "Courses and market education", href: "https://academy.worldstreetgold.com", icon: GraduationCap },
  { title: "e-Commerce", short: "Shop", description: "The WorldStreet marketplace", href: "https://shop.worldstreetgold.com", icon: Storefront },
  { title: "Prediction", short: "Predict", description: "Markets on what happens next", href: "https://prediction.worldstreetgold.com", icon: Target },
  { title: "Arcade", short: "Arcade", description: "Play and compete", href: "https://arcade.worldstreetgold.com", icon: GameController },
  { title: "Vision", short: "Vision", description: "Watch and discover", href: "https://vision.worldstreetgold.com", icon: MonitorPlay },
];

/**
 * What the hero carousel sells, each with a line worth reading. These ride
 * in the same deck as the live rooms, so a quiet hour still opens on
 * something with a picture and a point rather than an empty stage.
 *
 * Every card is drawn: its picture is our own art (`art`, a piece of
 * components/app/promo-art), set in the card's right half so the copy on
 * the left stays clear. Side seats show the art's first scene, still; when
 * the card takes the centre the art plays its story (Go live: the phone,
 * the heat ring, the room filling) and keeps a gentle life until it
 * leaves. No video: the clips in `public/promo/` are no longer used here.
 *
 * The Wolf is the one painted card, because the wolf itself is the brand:
 * a dark glossy ground, its own gold mark, and a gold button to match. It
 * is the only card that does not wear the W.
 */
export interface HeroPromo {
  id: string;
  eyebrow: string;
  title: string;
  tagline: string;
  cta: string;
  href: string;
  /** Tailwind classes for the call to action. */
  action: string;
  /** The drawn piece in the card's art zone. */
  art: PromoArtId;
  /** A painted ground under the art; the dark ground when absent. */
  ground?: string;
  /** The Wolf wears its own mark; every other card wears the white W. */
  mark?: "wolf";
  /** Sweep a highlight across the card every few seconds. */
  shine?: boolean;
}

const MONO_ACTION = "bg-white text-neutral-950 hover:bg-neutral-100";

export const HERO_PROMOS: HeroPromo[] = [
  {
    id: "golive",
    eyebrow: "Xtream",
    title: "You're one minute from being on air",
    tagline: "Camera, screen or your OBS rig. Your followers hear about it the second you start.",
    cta: "Go live",
    href: "/studio",
    action: MONO_ACTION,
    art: "golive",
  },
  {
    id: "worldspace",
    eyebrow: "WorldSpace",
    title: "The room after the room",
    tagline: "Every stream posts to the feed, so the conversation keeps going long after you go offline.",
    cta: "Open WorldSpace",
    href: "https://social.worldstreetgold.com",
    action: MONO_ACTION,
    art: "worldspace",
  },
  {
    // The painted one. Golds are the wolf's own (`WolfIcon`): #EAB308 for
    // the button, lifting to #F5CE4E on hover, so the call to action is
    // the same metal as the animal above it.
    id: "wolf",
    eyebrow: "Wolf of WorldStreet",
    title: "The most-backed creator wears the pelt",
    tagline: "Gifts, follows and battle wins all count toward the race. It resets every week.",
    cta: "Enter the pack",
    href: "https://social.worldstreetgold.com/votes",
    action: "bg-[#EAB308] text-neutral-950 hover:bg-[#F5CE4E]",
    art: "wolf",
    ground: "bg-[linear-gradient(150deg,#241a07,#161106_55%,#0b0906)]",
    mark: "wolf",
    shine: true,
  },
  {
    id: "prediction",
    eyebrow: "Prediction",
    title: "Call it before it happens",
    tagline: "Markets on the next candle, the next goal, the next headline — open while you watch.",
    cta: "Open Prediction",
    href: "https://prediction.worldstreetgold.com",
    action: MONO_ACTION,
    art: "prediction",
  },
];
