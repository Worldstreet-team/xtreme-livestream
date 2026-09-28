import type { PromoArtId } from "./promo-art-pieces";
import s from "./promo-art.module.css";

/**
 * How each promo card dresses: in the theme of the app it sells (the owner,
 * 2026-09-28), in the page's light or dark. `scope` sets the app's palette
 * as --pa-* custom properties (./promo-art.module.css, with sources); the
 * rest are the classes that read it, so the card, its words, its art and its
 * button all come from one place.
 *
 * - Go live: ours, Afterglow; its button stays the neutral primary pill.
 * - WorldSpace: the socials' cyan brand button (`bg-brand text-brand-on
 *   hover:bg-brand-active`, pill), Poppins titles.
 * - Wolf of WorldStreet: WorldSpace's theme (it lives on /votes), with the
 *   socials' own promo-card button: an ink pill (`bg-primary text-page`).
 * - Prediction: its accent button (`rounded-md bg-accent text-on-accent
 *   hover:bg-accent-hover`, 0.575rem corners): gold on dark, blue on light.
 *   Its face is Inter; Geist, already loaded here, stands in.
 */
export type PromoTheme = {
  scope: string;
  /** The card's ground and ink. */
  card: string;
  /** Eyebrows, meta, small print. */
  muted: string;
  /** The title's face. */
  titleFont: string;
  /** The call to action's colours and shape (size is the caller's). */
  cta: string;
};

const CARD = "bg-[color:var(--pa-bg)] text-[color:var(--pa-ink)]";
const MUTED = "text-[color:var(--pa-muted)]";

export const PROMO_THEME: Record<PromoArtId, PromoTheme> = {
  golive: {
    scope: s.themeGolive!,
    card: CARD,
    muted: MUTED,
    titleFont: "",
    cta: "rounded-full bg-inverse text-on-inverse hover:bg-inverse/90",
  },
  worldspace: {
    scope: s.themeWorldspace!,
    card: CARD,
    muted: MUTED,
    titleFont: "font-poppins",
    cta: "rounded-full bg-[color:var(--pa-accent)] text-[color:var(--pa-on-accent)] hover:bg-[color:var(--pa-accent-hover)]",
  },
  wolf: {
    scope: s.themeWolf!,
    card: CARD,
    muted: MUTED,
    titleFont: "font-poppins",
    cta: "rounded-full bg-[color:var(--pa-hi)] text-[color:var(--pa-on-hi)] hover:opacity-90",
  },
  prediction: {
    scope: s.themePrediction!,
    card: CARD,
    muted: MUTED,
    titleFont: "font-[family-name:var(--font-geist-sans)]",
    cta: "rounded-[0.575rem] bg-[color:var(--pa-accent)] text-[color:var(--pa-on-accent)] hover:bg-[color:var(--pa-accent-hover)]",
  },
};
