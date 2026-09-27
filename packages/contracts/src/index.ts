import { z } from "zod";

export const CATEGORIES = [
  "Bitcoin Trading",
  "Altcoins & DeFi",
  "NFTs & Web3",
  "Market Analysis",
  "Crypto Education",
  "General / Just Chatting",
] as const;

/**
 * Category is a free string now: the socials app streams with its curated
 * 100-category taxonomy (labels like "Altcoins & DeFi" or "Football"), and
 * forcing them through a 6-value enum was silently mislabeling streams.
 * CATEGORIES above remains the Xstream web app's own quick-pick list.
 */
export const categorySchema = z.string().trim().min(1).max(48);
export type Category = z.infer<typeof categorySchema>;

/** How the broadcaster feeds the stream: browser camera, browser screen
 *  share, or an external encoder (OBS et al) over RTMP ingress. */
export const STREAM_SOURCES = ["camera", "screen", "obs"] as const;
export const streamSourceSchema = z.enum(STREAM_SOURCES);
export type StreamSource = z.infer<typeof streamSourceSchema>;

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid resource id");

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(/^[a-z0-9_]+$/, "Use letters, numbers, and underscores only");

export const streamIdParamsSchema = z.object({
  id: objectIdSchema,
});

/** Stream id + the target user of a stage-guest action (approve/deny/remove). */
export const guestUserParamsSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
});

/**
 * How many people can be on the stage beside the host. Enforced at approve
 * time on the API; mirrored in the studio UI so the host sees the cap before
 * hitting it.
 */
export const MAX_STAGE_GUESTS = 3;
/**
 * Where someone is with the stage: asking; backstage (producer mode) —
 * in the room with camera and mic on, checking their devices, seen only by
 * the host and their producers until they're put on; or live on stage.
 */
export const GUEST_STATUSES = ["requested", "backstage", "live"] as const;
export type GuestStatus = (typeof GUEST_STATUSES)[number];

/** Stream id + a target user — shared by stage and moderation actions. */
export const streamUserParamsSchema = guestUserParamsSchema;

export const chatMessageParamsSchema = z.object({
  id: objectIdSchema,
  messageId: objectIdSchema,
});

/**
 * Ban body. `minutes` present = timeout that lapses on its own (max one
 * week); absent = banned for the rest of the stream.
 */
export const createBanBodySchema = z.object({
  minutes: z.number().int().min(1).max(10_080).optional(),
});

/**
 * Accepts an http(s) URL or an inline base64 image data URI. Web clients
 * upload thumbnails/avatars as compressed data URIs rather than hosted files.
 *
 * The 200KB ceiling bounds what a single document can carry; client-side
 * compression produces ~40-80KB, so it's still generous.
 *
 * Storing the bytes in Mongo is fine. What wasn't fine was returning them
 * inline from the list endpoint, which Explore re-polls every 15s — the same
 * unchanging blobs, in a response no cache could touch. They're served from
 * GET /streams/:id/thumbnail now: a versioned, immutable URL the browser
 * fetches once. Object storage only becomes worthwhile when the API should
 * be out of the image path entirely, or when transforms (WebP/AVIF, multiple
 * sizes) are wanted — likely alongside recording, which needs blob storage
 * anyway.
 */
export const imageSourceSchema = z
  .string()
  .max(200_000)
  .refine(
    (value) =>
      value === "" ||
      (/^https?:\/\/\S+$/.test(value) && value.length <= 2048) ||
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value),
    "Must be an http(s) URL or a base64 image data URI",
  );

/**
 * Username in a URL, for looking someone up — deliberately *not*
 * `usernameSchema`.
 *
 * That schema's 3-character minimum is a rule about what you may register,
 * and applying it to lookups made any shorter legacy username un-viewable
 * and un-followable: `/user/jo` and `/user/jo/follow` both 400'd before
 * reaching the database, so the follow button on that streamer's stream
 * could never work. Provisioning no longer issues names that short, but
 * accounts created before that fix still exist. Format and length ceiling
 * still apply, so this doesn't widen what can reach a query.
 */
export const usernameParamsSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(30)
    .regex(/^[a-z0-9_]+$/, "Use letters, numbers, and underscores only"),
});

export const STREAM_STATUSES = ["upcoming", "live", "ended"] as const;
export const streamStatusSchema = z.enum(STREAM_STATUSES);
export type StreamStatus = z.infer<typeof streamStatusSchema>;

export const listStreamsQuerySchema = z.object({
  live: z.enum(["true", "false"]).optional(),
  /** Three-valued state; `live=true` remains the fast path for the live grid. */
  status: streamStatusSchema.optional(),
  category: z.union([categorySchema, z.literal("All")]).optional(),
  search: z.string().trim().max(100).optional(),
  /** Username, for a channel page's own live stream and past broadcasts. */
  streamer: usernameParamsSchema.shape.username.optional(),
  /** Exact tag match. Channels that opted out of tag discovery are excluded. */
  tag: z.string().trim().min(1).max(30).optional(),
  /**
   * `viewers_asc` exists on purpose: the ascending sort is the one control
   * that lets a viewer find the small rooms, and Twitch's public browse has
   * never offered it — only its raid tool does.
   */
  sort: z
    .enum(["viewers", "viewers_asc", "recent", "trending"])
    .default("viewers"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

export const topStreamersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const searchUsersQuerySchema = z.object({
  q: z.string().trim().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

/**
 * Scenes (Phase 2, the scene engine): how the program is laid out, as data
 * every screen draws the same way — the watch page, the studio preview and,
 * once recording lands, the egress template.
 *
 * - layout: `auto` splits by who's on (the behaviour before scenes);
 *   `solo` is the host alone; `split`, `trio` and `grid` bring in one,
 *   two or three guests; `screen-face` puts the shared screen up with the
 *   host's camera in the corner.
 * - card: a full-frame card over the program — Starting soon, Be right
 *   back, or Thanks for watching — with an optional line from the host.
 */
export const SCENE_LAYOUTS = ["auto", "solo", "split", "trio", "grid", "screen-face", "chart-face"] as const;

/**
 * Chart + face: a live market chart drawn by every viewer's screen (not
 * video), the host's camera in the corner. Markets are "BASE-QUOTE"
 * pairs ("BTC-USD"); candles come through the API (/market/candles).
 */
export const CHART_INTERVALS = ["1m", "5m", "15m", "1h"] as const;
export const marketSymbolSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,10}-[A-Z]{3,4}$/, "A market looks like BTC-USD");
export const sceneChartSchema = z.object({
  symbol: marketSymbolSchema,
  interval: z.enum(CHART_INTERVALS).default("5m"),
});
export const marketCandlesQuerySchema = sceneChartSchema;
/** Several markets' latest prices, for the price strip: "BTC-USD,ETH-USD". */
export const marketQuotesQuerySchema = z.object({
  symbols: z
    .string()
    .transform((s) => [...new Set(s.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean))])
    .pipe(z.array(z.string().regex(/^[A-Z0-9]{2,10}-[A-Z]{3,4}$/)).min(1).max(5)),
});
export interface MarketQuote {
  symbol: string;
  last: number;
  /** The move over the last 24 hours, in per cent. */
  changePct: number;
}
export const SCENE_CARDS = ["starting-soon", "brb", "ending"] as const;

/**
 * Graphics drawn over the program (Phase 2, graphics and brand kit): one of
 * each at most. They render as DOM on every screen — crisp at any quality
 * layer — in the creator's brand accent.
 */
export const SCENE_LAYER_KINDS = ["lower-third", "banner", "ticker", "countdown", "logo", "cta", "sponsor", "prices"] as const;
/** The most markets a price strip shows at once. */
export const MAX_PRICE_SYMBOLS = 5;
export const LOGO_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
/** Whose sponsor a card is: the creator's own deal, or an Xtream campaign they joined. */
export const SPONSOR_SOURCES = ["own", "campaign"] as const;

export const sceneLayerSchema = z.discriminatedUnion("kind", [
  /**
   * Live prices (Phase 3, market layer): a strip of markets, each viewer's
   * app drawing the numbers from our shared feed (/market/quotes), always
   * with its source and "not financial advice". No buy buttons, no links.
   */
  z.object({
    kind: z.literal("prices"),
    symbols: z
      .array(marketSymbolSchema)
      .min(1)
      .max(MAX_PRICE_SYMBOLS)
      .refine((s) => new Set(s).size === s.length, "Each market once"),
  }),
  z.object({
    kind: z.literal("lower-third"),
    title: z.string().trim().min(1).max(48),
    subtitle: z.string().trim().max(72).default(""),
  }),
  z.object({ kind: z.literal("banner"), text: z.string().trim().min(1).max(100) }),
  z.object({ kind: z.literal("ticker"), text: z.string().trim().min(1).max(240) }),
  z.object({
    kind: z.literal("countdown"),
    label: z.string().trim().max(40).default(""),
    endsAt: z.string().datetime(),
  }),
  z.object({ kind: z.literal("logo"), corner: z.enum(LOGO_CORNERS).default("top-right") }),
  // A call to action with a QR code: "Scan for merch", a link to follow.
  z.object({
    kind: z.literal("cta"),
    title: z.string().trim().min(1).max(40),
    url: z
      .string()
      .trim()
      .max(300)
      .url()
      .refine((u) => /^https?:\/\//i.test(u), "Use a web address (http or https)"),
  }),
  /**
   * A sponsor's card, always drawn with "Paid promotion" on it. The client
   * names the sponsor; the API fills in what's drawn from its own records on
   * every write, so whatever else a client sends here is replaced.
   */
  z.object({
    kind: z.literal("sponsor"),
    source: z.enum(SPONSOR_SOURCES),
    sponsorId: objectIdSchema,
    name: z.string().max(40).default(""),
    line: z.string().max(80).default(""),
    url: z.string().max(300).default(""),
    code: z.string().max(24).default(""),
    logoUrl: z.string().max(300).nullable().default(null),
    /** Kept from viewers in Nigeria: a restricted category nobody has cleared. */
    restricted: z.boolean().default(false),
  }),
]);

/** Guest faders a scene can carry. */
export const MAX_SCENE_GAINS = 8;
/**
 * Which camera the program shows when the host has a second phone in the
 * room as a camera (`cam-<hostId>`): the studio's own (`main`), the phone
 * full-frame (`phone`), or the two side by side (`both`).
 */
export const SCENE_ANGLES = ["main", "phone", "both"] as const;
export const sceneBodySchema = z.object({
  layout: z.enum(SCENE_LAYOUTS).default("auto"),
  card: z.enum(SCENE_CARDS).nullable().default(null),
  cardNote: z.string().trim().max(80).default(""),
  /** The market Chart + face shows (kept when the layout changes, for next time). */
  chart: sceneChartSchema.nullable().default(null),
  layers: z
    .array(sceneLayerSchema)
    .max(SCENE_LAYER_KINDS.length)
    .default([])
    .refine((layers) => new Set(layers.map((l) => l.kind)).size === layers.length, "One of each graphic at most"),
  /**
   * The audio desk's guest faders: how loud each person on stage is, by
   * their room identity, 0–1 (1 when unset) — so every viewer hears the
   * mix the host set.
   */
  gains: z
    .record(z.string().regex(/^[\w.:-]{1,64}$/), z.number().min(0).max(1))
    .default({})
    .refine((g) => Object.keys(g).length <= MAX_SCENE_GAINS, "Eight faders at most"),
  /**
   * Who's beside the host: the room identity of the guest a Split (or the
   * first of a Trio) shows — picked by hand, or by the auto-director when
   * they're the one talking. Null keeps the stage's own order.
   */
  spotlight: z.string().regex(/^[\w.:-]{1,64}$/).nullable().default(null),
  /**
   * A sign-language interpreter on stage (accessibility): their room
   * identity. They stay on screen in a corner whatever the layout, and the
   * layouts and the auto-director leave them out. Null for none.
   */
  interpreter: z.string().regex(/^[\w.:-]{1,64}$/).nullable().default(null),
  /**
   * The angle, when a phone camera is in the room (SCENE_ANGLES). Optional
   * on the wire — a client that sends the whole scene without it keeps
   * working, and the stored angle stands; the API reads it as `main` when
   * nothing has been stored.
   */
  angle: z.enum(SCENE_ANGLES).optional(),
});

/**
 * A creator's brand kit: the accent their graphics wear, the lower third's
 * shape, and a logo for the corner of the picture ("" removes it).
 */
export const BRAND_ACCENTS = ["ember", "chili", "white", "sky", "mint", "lilac"] as const;
export const LOWER_THIRD_STYLES = ["bar", "pill"] as const;
/** The faces a creator's graphics can wear — all ones the app already loads. */
export const BRAND_FONTS = ["wide", "clean", "rounded", "mono"] as const;

/** Graphics a creator reuses, kept with their brand kit. */
export const brandPresetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lower-third"),
    title: z.string().trim().min(1).max(48),
    subtitle: z.string().trim().max(72).default(""),
  }),
  z.object({ kind: z.literal("banner"), text: z.string().trim().min(1).max(100) }),
  z.object({ kind: z.literal("ticker"), text: z.string().trim().min(1).max(240) }),
]);
export const MAX_BRAND_PRESETS = 12;

export const brandBodySchema = z
  .object({
    accent: z.enum(BRAND_ACCENTS).optional(),
    lowerThird: z.enum(LOWER_THIRD_STYLES).optional(),
    font: z.enum(BRAND_FONTS).optional(),
    logo: imageSourceSchema.optional(),
    presets: z.array(brandPresetSchema).max(MAX_BRAND_PRESETS).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change" });

/**
 * A comment or gift the host puts on screen from chat (Phase 2, comments on
 * screen). It's part of the scene but never in the PUT body: the API writes
 * it from the stored chat row — whose words they are is never the client's
 * say — and it comes down by itself at `until` (null: when the host says).
 */
export const FEATURE_SECONDS = [10, 20, 60] as const;
/** Gift tiers that go on screen by themselves, in US cents; 0 is off. */
export const FEATURE_GIFT_TIERS_MINOR = [0, 500, 2000, 10_000] as const;

export const featureBodySchema = z.object({
  seconds: z
    .union([z.literal(10), z.literal(20), z.literal(60)])
    .nullable()
    .default(20),
});

export const featuredItemSchema = z.object({
  /** The chat row's id. */
  id: z.string(),
  /** A request is a paid order off the host's menu, up while they do it. */
  kind: z.enum(["chat", "gift", "request"]),
  userId: z.string(),
  username: z.string(),
  avatar: z.string(),
  /** The message, or a gift's line ("sent a Rose"). */
  text: z.string(),
  emoji: z.string().nullable(),
  /** A gift's amount as its chat row carries it ("5.00"). */
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  at: z.string(),
  until: z.string().nullable(),
  /** Put up by the gift tier rather than by the host's hand. */
  auto: z.boolean(),
  /** A request's note from the viewer ("Last Last, please"). */
  note: z.string().optional(),
});

export type SceneLayout = (typeof SCENE_LAYOUTS)[number];
export type SceneAngle = (typeof SCENE_ANGLES)[number];
export type ChartInterval = (typeof CHART_INTERVALS)[number];
export type SceneChart = z.infer<typeof sceneChartSchema>;
export type SceneCard = (typeof SCENE_CARDS)[number];
export type SceneLayer = z.infer<typeof sceneLayerSchema>;
export type SceneLayerKind = (typeof SCENE_LAYER_KINDS)[number];
export type LogoCorner = (typeof LOGO_CORNERS)[number];
export type BrandAccent = (typeof BRAND_ACCENTS)[number];
export type LowerThirdStyle = (typeof LOWER_THIRD_STYLES)[number];
export type BrandFont = (typeof BRAND_FONTS)[number];
export type BrandPreset = z.infer<typeof brandPresetSchema>;
export type FeaturedItem = z.infer<typeof featuredItemSchema>;
export type FeatureSeconds = (typeof FEATURE_SECONDS)[number];
/** The scene as stored and broadcast: the body, what's featured, and a version that only goes up. */
export type Scene = z.infer<typeof sceneBodySchema> & { version: number; featured?: FeaturedItem | null };

/**
 * Goals (Phase 2, goals and status): one goal bar at a time. Gifts count
 * their dollars (in US cents); likes and allies count one each. Milestones
 * are stops on the way, each with what the host promises there ("Shots at
 * $50"). Progress is the API's — gifts, likes and follows move it — so the
 * body is only what the host decides, and setting a goal starts it at zero.
 */
export const GOAL_KINDS = ["gifts", "likes", "allies"] as const;
export const MAX_GOAL_MILESTONES = 3;
/** Targets per kind: $1–$100,000 of gifts, 10 likes to ten million, 5 allies to a million. */
export const GOAL_TARGET_LIMITS = {
  gifts: { min: 100, max: 10_000_000 },
  likes: { min: 10, max: 10_000_000 },
  allies: { min: 5, max: 1_000_000 },
} as const;

export const goalMilestoneSchema = z.object({
  at: z.number().int().min(1),
  label: z.string().trim().min(1).max(40),
});

export const goalBodySchema = z
  .object({
    kind: z.enum(GOAL_KINDS),
    title: z.string().trim().min(1).max(40),
    target: z.number().int().min(1),
    milestones: z.array(goalMilestoneSchema).max(MAX_GOAL_MILESTONES).default([]),
  })
  .superRefine((goal, ctx) => {
    const { min, max } = GOAL_TARGET_LIMITS[goal.kind];
    if (goal.target < min || goal.target > max) {
      ctx.addIssue({ code: "custom", path: ["target"], message: "That target is out of range for this kind of goal" });
    }
    goal.milestones.forEach((m, i) => {
      if (m.at >= goal.target) {
        ctx.addIssue({ code: "custom", path: ["milestones", i, "at"], message: "A milestone comes before the goal" });
      }
      const before = goal.milestones[i - 1];
      if (before && m.at <= before.at) {
        ctx.addIssue({ code: "custom", path: ["milestones", i, "at"], message: "Milestones go up in order" });
      }
    });
  });

/**
 * The heat meter: the dollars gifted over the last minute, as a level from
 * 1 to 5 — $5, $20, $50, $100, $250. It cools a level every HEAT_COOL_MS
 * after the last gift, on the server's clock, so every screen agrees.
 */
export const HEAT_STEPS_MINOR = [500, 2_000, 5_000, 10_000, 25_000] as const;
export const HEAT_WINDOW_MS = 60_000;
export const HEAT_COOL_MS = 20_000;

export type GoalKind = (typeof GOAL_KINDS)[number];
export type GoalMilestone = z.infer<typeof goalMilestoneSchema>;
export type GoalBody = z.infer<typeof goalBodySchema>;
/** A goal as stored and broadcast: what the host set, how far it's got, when it got there. */
export interface StreamGoal extends GoalBody {
  id: string;
  progress: number;
  startedAt: string;
  reachedAt: string | null;
  /** The host took it down; it stays stored so `rev` keeps climbing into the next goal. */
  endedAt: string | null;
  /** Goes up with every change, so a late event never rolls the bar back. */
  rev: number;
}
/** The meter as of the last gift: its level then, and when that was. */
export interface StreamHeat {
  level: number;
  at: string;
}

/**
 * Paid requests (Phase 2): a menu each creator writes and prices — a song,
 * a chart read, a shout-out. The money waits in the platform's treasury
 * until the creator does it (then it's theirs, less the commission) or
 * skips it (then it goes back to the viewer, in full — the owner's call).
 */
export const MAX_REQUEST_ITEMS = 8;
export const REQUEST_PRICE_MIN_MINOR = 100;
export const REQUEST_PRICE_MAX_MINOR = 100_000;
export const requestItemSchema = z.object({
  /** Kept when editing; a new item gets one from the API. */
  id: z.string().regex(/^[a-z0-9-]{1,32}$/).optional(),
  title: z.string().trim().min(1).max(40),
  priceUsdMinor: z.number().int().min(REQUEST_PRICE_MIN_MINOR).max(REQUEST_PRICE_MAX_MINOR),
  /** What to ask the viewer ("Which song?"); "" asks nothing. */
  prompt: z.string().trim().max(60).default(""),
});
export const requestsMenuBodySchema = z.object({ items: z.array(requestItemSchema).max(MAX_REQUEST_ITEMS) });
export const requestsOpenBodySchema = z.object({ open: z.boolean() });
export const orderRequestBodySchema = z.object({
  itemId: z.string().regex(/^[a-z0-9-]{1,32}$/),
  note: z.string().trim().max(120).default(""),
});
export const requestOrderParamsSchema = z.object({ id: objectIdSchema, orderId: objectIdSchema });
export const REQUEST_STATUSES = ["pending", "done", "skipped", "expired"] as const;
export type RequestItem = Required<z.infer<typeof requestItemSchema>>;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export interface RequestOrderView {
  id: string;
  itemId: string;
  title: string;
  note: string;
  priceUsdMinor: number;
  status: RequestStatus;
  /** Whether the money is back with the viewer (skipped or expired). */
  refunded: boolean;
  viewer: { userId: string; username: string; avatar: string };
  createdAt: string;
  decidedAt: string | null;
}

/**
 * A Shout: a gift with words, pinned over the chat for longer the more it
 * costs — from a minute at $2 to an hour at $100.
 */
export const SHOUT_MIN_MINOR = 200;
export const SHOUT_TIERS = [
  { fromMinor: 200, seconds: 60 },
  { fromMinor: 500, seconds: 120 },
  { fromMinor: 1_000, seconds: 300 },
  { fromMinor: 2_000, seconds: 600 },
  { fromMinor: 5_000, seconds: 1_200 },
  { fromMinor: 10_000, seconds: 3_600 },
] as const;
export function shoutSeconds(amountMinor: number) {
  let seconds = 0;
  for (const tier of SHOUT_TIERS) if (amountMinor >= tier.fromMinor) seconds = tier.seconds;
  return seconds;
}
export const SHOUT_MAX_LENGTH = 120;

/**
 * Sponsorships (Phase 2, sponsor slots) — two tracks, one label:
 *
 * - A creator's own deal: a sponsor they add themselves. The deal and the
 *   money stay between them and the brand; Xtream draws the card, always
 *   with "Paid promotion" on it.
 * - An Xtream campaign: set up by the platform's team, prepaid by the
 *   brand, joined by creators, who are paid from its budget for each stream
 *   that keeps the card up long enough. A campaign can carry a sponsored
 *   quest that pays viewers in the brand's own vouchers — never in points.
 *
 * Crypto-token, betting and alcohol sponsors aren't shown to viewers in
 * Nigeria unless the platform has cleared the campaign (SEC and ARCON rules
 * on promoting them), and a creator's own deal can't be cleared at all.
 */
export const SPONSOR_CATEGORIES = ["everyday", "finance", "crypto", "betting", "alcohol"] as const;
export const RESTRICTED_SPONSOR_CATEGORIES = ["crypto", "betting", "alcohol"] as const;
/** Where restricted sponsors stay off screen unless cleared. */
export const SPONSOR_RESTRICTED_COUNTRIES = ["NG"] as const;
export const MAX_SPONSORS = 8;

export function isRestrictedSponsorCategory(category: string) {
  return (RESTRICTED_SPONSOR_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Whether restricted sponsors stay off a viewer's screen. The country the
 * edge reports decides when there is one; without it, a clock set to Lagos
 * time does — erring toward hiding them, since most of Xtream watches from
 * there.
 */
export function inRestrictedSponsorRegion(country: string | null | undefined, timeZone: string | null | undefined) {
  if (country) return (SPONSOR_RESTRICTED_COUNTRIES as readonly string[]).includes(country.toUpperCase());
  return timeZone === "Africa/Lagos";
}

/** A promo code viewers type at the brand's checkout. */
const promoCodeSchema = z
  .string()
  .trim()
  .max(24)
  .regex(/^[A-Za-z0-9_-]*$/, "Letters, numbers, - and _ only")
  .default("");
function isWebAddress(u: string) {
  if (!/^https?:\/\/\S+\.\S+/i.test(u)) return false;
  try {
    return Boolean(new URL(u).hostname);
  } catch {
    return false;
  }
}
const sponsorUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((u) => u === "" || isWebAddress(u), "Use a web address (http or https)")
  .default("");

/** A creator's own sponsor. `logo` absent keeps the one they have; "" removes it. */
export const sponsorBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  line: z.string().trim().max(80).default(""),
  url: sponsorUrlSchema,
  code: promoCodeSchema,
  category: z.enum(SPONSOR_CATEGORIES).default("everyday"),
  logo: imageSourceSchema.optional(),
});

export const CAMPAIGN_STATUSES = ["draft", "live", "paused", "ended"] as const;
/**
 * An Xtream campaign, as the platform's team writes it. The creators' pool
 * is what the brand prepaid less the platform's margin — the API works it
 * out, so the budget is never typed twice.
 */
export const campaignBodySchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    line: z.string().trim().max(80).default(""),
    url: sponsorUrlSchema,
    code: promoCodeSchema,
    category: z.enum(SPONSOR_CATEGORIES).default("everyday"),
    logo: imageSourceSchema.optional(),
    /** What the brand asks of creators, in a few lines. */
    brief: z.string().trim().max(500).default(""),
    /** A restricted category the team has cleared for viewers in Nigeria. */
    cleared: z.boolean().default(false),
    /** Stream categories that can run it; empty is any. */
    streamCategories: z.array(categorySchema).max(20).default([]),
    /** What a creator is paid for each qualifying stream, US cents. */
    payPerStreamUsdMinor: z.number().int().min(100).max(1_000_000),
    /** Minutes the card must be on screen while live for a stream to qualify. */
    minMinutes: z.number().int().min(1).max(240).default(10),
    /** The stream's peak audience must reach this for it to qualify. */
    minViewers: z.number().int().min(0).max(1_000_000).default(0),
    maxStreamsPerCreator: z.number().int().min(1).max(100).default(4),
    /** What the brand prepaid, US cents. */
    brandPaidUsdMinor: z.number().int().min(0).max(1_000_000_000),
    /** The platform's cut of the prepayment, in percent. */
    marginPercent: z.number().int().min(0).max(90).default(25),
    startsAt: z.string().datetime().nullable().default(null),
    endsAt: z.string().datetime().nullable().default(null),
    /** The sponsored quest: watch this many minutes while the card is up, win one of the brand's vouchers. */
    quest: z
      .object({
        minutes: z.number().int().min(1).max(600),
        reward: z.string().trim().min(1).max(80),
      })
      .nullable()
      .default(null),
  })
  .refine((c) => !c.startsAt || !c.endsAt || Date.parse(c.endsAt) > Date.parse(c.startsAt), {
    message: "The end has to come after the start",
    path: ["endsAt"],
  });
export const campaignStatusBodySchema = z.object({ status: z.enum(["live", "paused", "ended"]) });
export const campaignVouchersBodySchema = z.object({
  codes: z.array(z.string().trim().min(1).max(64)).min(1).max(5_000),
});
/** The viewer's region hint for sponsored quests: their clock's time zone. */
export const sponsorRegionQuerySchema = z.object({ tz: z.string().max(64).optional() });

/** The creators' pool: the brand's prepayment less the platform's margin. */
export function campaignBudgetMinor(brandPaidUsdMinor: number, marginPercent: number) {
  return Math.floor((brandPaidUsdMinor * (100 - marginPercent)) / 100);
}

export type SponsorCategory = (typeof SPONSOR_CATEGORIES)[number];
export type SponsorSource = (typeof SPONSOR_SOURCES)[number];
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export interface SponsorView {
  id: string;
  name: string;
  line: string;
  url: string;
  code: string;
  category: SponsorCategory;
  logoUrl: string | null;
  /** Kept from viewers in Nigeria (a restricted category). */
  restricted: boolean;
}

/** A campaign as a creator sees it. */
export interface CampaignView {
  id: string;
  name: string;
  line: string;
  url: string;
  code: string;
  category: SponsorCategory;
  logoUrl: string | null;
  brief: string;
  restricted: boolean;
  status: CampaignStatus;
  startsAt: string | null;
  endsAt: string | null;
  streamCategories: string[];
  payPerStreamUsdMinor: number;
  minMinutes: number;
  minViewers: number;
  maxStreamsPerCreator: number;
  /** Enough budget left for this many more paid streams. */
  streamsLeft: number;
  quest: { minutes: number; reward: string } | null;
  joined: boolean;
  /** This creator's paid streams and earnings on it. */
  paidStreams: number;
  earnedUsdMinor: number;
}

/** One sponsor on one broadcast: how long its card was up and what it paid. */
export interface SponsorRunView {
  id: string;
  source: SponsorSource;
  sponsorId: string;
  name: string;
  streamId: string;
  streamTitle: string;
  seconds: number;
  /** "none" for a creator's own deal (paid by the brand, not through us). */
  status: "none" | "counting" | "paying" | "paid" | "unpaid";
  unpaidReason: "" | "short" | "viewers" | "cap" | "budget" | "left" | "ended";
  payUsdMinor: number;
  minMinutes: number | null;
  at: string;
}

/** A sponsored quest as a viewer sees it. */
export interface SponsoredQuestView {
  campaignId: string;
  name: string;
  line: string;
  url: string;
  logoUrl: string | null;
  reward: string;
  minutes: number;
  /** Minutes watched while the brand's card was up. */
  progress: number;
  voucher: { code: string; claimedAt: string } | null;
  vouchersLeft: boolean;
  status: CampaignStatus;
}

/**
 * Run of show (Phase 3): a creator's rundown — segments in order, each
 * with a planned length, a script the host-only teleprompter reads, and
 * what it puts on screen when it starts (its cues). The rundown is kept
 * with the channel, so it's ready on whichever device goes live; the live
 * stream only keeps where the show is (which segment, since when). Viewers
 * never see a script — only the scene changes its cues make.
 */
export const MAX_SEGMENTS = 20;
export const MAX_SEGMENT_SCRIPT = 4_000;
/** The prompter's whole script, across every segment. */
export const MAX_RUNDOWN_SCRIPT = 10_000;
export const MAX_SEGMENT_CUES = 6;
export const segmentIdSchema = z.string().regex(/^[a-z0-9]{6,16}$/, "Invalid segment id");

/**
 * One thing a segment does to the picture as it starts. Each is either
 * "put this up" or "take that down"; anything a segment doesn't mention
 * stays as it was.
 */
export const rundownCueSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("layout"), layout: z.enum(SCENE_LAYOUTS) }),
  z.object({ do: z.literal("card"), card: z.enum(SCENE_CARDS) }),
  z.object({ do: z.literal("clear-card") }),
  z.object({ do: z.literal("lower-third"), title: z.string().trim().min(1).max(48), subtitle: z.string().trim().max(72).default("") }),
  z.object({ do: z.literal("hide-lower-third") }),
  z.object({ do: z.literal("banner"), text: z.string().trim().min(1).max(100) }),
  z.object({ do: z.literal("hide-banner") }),
  z.object({ do: z.literal("sponsor"), source: z.enum(SPONSOR_SOURCES), sponsorId: objectIdSchema }),
  z.object({ do: z.literal("hide-sponsor") }),
  /** A countdown to the segment's planned end, labelled with its title. */
  z.object({ do: z.literal("countdown") }),
]);

export const rundownSegmentSchema = z.object({
  id: segmentIdSchema,
  title: z.string().trim().min(1).max(60),
  /** Planned length: ten seconds to four hours. */
  seconds: z.number().int().min(10).max(4 * 3600),
  script: z.string().max(MAX_SEGMENT_SCRIPT).default(""),
  cues: z
    .array(rundownCueSchema)
    .max(MAX_SEGMENT_CUES)
    .default([])
    .refine((cues) => new Set(cues.map((c) => c.do.replace(/^(hide|clear)-/, ""))).size === cues.length, "One change of each kind per segment"),
});

export const rundownBodySchema = z
  .object({ segments: z.array(rundownSegmentSchema).max(MAX_SEGMENTS) })
  .refine((r) => new Set(r.segments.map((s) => s.id)).size === r.segments.length, "Segment ids must be unique")
  .refine((r) => r.segments.reduce((n, s) => n + s.script.length, 0) <= MAX_RUNDOWN_SCRIPT, {
    message: `Scripts add up to ${MAX_RUNDOWN_SCRIPT.toLocaleString("en-US")} characters at most`,
  });

/** Where the show is: a segment on air (null: the rundown isn't running). */
export const rundownPositionBodySchema = z.object({ segmentId: segmentIdSchema.nullable() });

export type RundownCue = z.infer<typeof rundownCueSchema>;
export type RundownSegment = z.infer<typeof rundownSegmentSchema>;
export interface RundownPosition {
  segmentId: string | null;
  /** When this segment went on air (server time, ISO). */
  startedAt: string | null;
  /** When the first segment went on air — the show's own clock. */
  showStartedAt: string | null;
}

/**
 * Show rules (Phase 3): "when X happens, do Y". The creator's rules run on
 * the API as things happen on their stream — a gift, a new ally, a guest,
 * a goal, a battle's result, a chat word — and change the scene the way a
 * hand on the controls would. A sound goes to the host's studio, whose
 * audio desk plays it. Each rule rests for its cooldown after it fires.
 */
export const RULE_TRIGGERS = ["gift", "ally", "guest_join", "goal_reached", "battle_won", "battle_lost", "chat_word"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
/** The audio desk's pads (lib/audio-desk.ts PADS), which a rule can play. */
export const RULE_SOUNDS = ["airhorn", "applause", "drumroll", "kaching", "badumtss", "whoosh", "levelup", "sadtrombone"] as const;
export const MAX_RULES = 20;
export const MAX_RULE_ACTIONS = 4;
export const RULE_COOLDOWNS = [0, 10, 30, 60, 300] as const;
/** A chat word can't fire more often than this — it's anyone's to type. */
export const MIN_CHAT_RULE_COOLDOWN = 30;

export const ruleWhenSchema = z.discriminatedUnion("kind", [
  /** A gift worth at least this much, in USD cents. */
  z.object({ kind: z.literal("gift"), minMinor: z.number().int().min(100).max(1_000_000) }),
  z.object({ kind: z.literal("ally") }),
  z.object({ kind: z.literal("guest_join") }),
  z.object({ kind: z.literal("goal_reached") }),
  z.object({ kind: z.literal("battle_won") }),
  z.object({ kind: z.literal("battle_lost") }),
  /** A chat line that starts with this word ("!discord", "gm"), any case. */
  z.object({
    kind: z.literal("chat_word"),
    word: z
      .string()
      .trim()
      .min(2)
      .max(24)
      .regex(/^!?[\p{L}\p{N}_-]+$/u, "One word — letters and numbers, with a ! in front if you like"),
  }),
]);
export type RuleWhen = z.infer<typeof ruleWhenSchema>;

/** What a rule does. Words can carry {user}, {amount}, {gift}, {goal} and {opponent}, filled in as it fires. */
export const ruleActionSchema = z.discriminatedUnion("do", [
  z.object({ do: z.literal("layout"), layout: z.enum(SCENE_LAYOUTS) }),
  /** A card, or none; up for `seconds` and then taken down, or until someone does. */
  z.object({ do: z.literal("card"), card: z.enum(SCENE_CARDS).nullable(), seconds: z.number().int().min(5).max(600).nullable().default(null) }),
  z.object({
    do: z.literal("lower_third"),
    title: z.string().trim().min(1).max(48),
    subtitle: z.string().trim().max(72).default(""),
    seconds: z.number().int().min(3).max(300).nullable().default(8),
  }),
  z.object({ do: z.literal("banner"), text: z.string().trim().min(1).max(100), seconds: z.number().int().min(3).max(600).nullable().default(15) }),
  z.object({ do: z.literal("hide"), graphic: z.enum(["lower-third", "banner", "countdown"]) }),
  z.object({ do: z.literal("countdown"), minutes: z.number().int().min(1).max(120), label: z.string().trim().max(40).default("") }),
  z.object({ do: z.literal("sound"), pad: z.enum(RULE_SOUNDS) }),
]);
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const showRuleBodySchema = z
  .object({
    name: z.string().trim().max(40).default(""),
    on: z.boolean().default(true),
    when: ruleWhenSchema,
    then: z.array(ruleActionSchema).min(1).max(MAX_RULE_ACTIONS),
    cooldownSec: z.union([z.literal(0), z.literal(10), z.literal(30), z.literal(60), z.literal(300)]).default(10),
  })
  .refine((r) => r.when.kind !== "chat_word" || r.cooldownSec >= MIN_CHAT_RULE_COOLDOWN, {
    message: `A chat word needs a cooldown of ${MIN_CHAT_RULE_COOLDOWN} seconds or more — anyone can type it`,
    path: ["cooldownSec"],
  });
export type ShowRuleBody = z.input<typeof showRuleBodySchema>;
/** A rule with every field filled in — what an editor holds, and a body the API takes as it is. */
export type ShowRuleDraft = z.output<typeof showRuleBodySchema>;
export const ruleIdParamsSchema = z.object({ ruleId: objectIdSchema });

export interface ShowRuleView {
  id: string;
  name: string;
  on: boolean;
  when: RuleWhen;
  then: RuleAction[];
  cooldownSec: number;
  /** How often it has fired, and when it last did. */
  fires: number;
  firedAt: string | null;
}

/**
 * The control API (Phase 3): keys a creator makes for a Stream Deck,
 * Companion or a script, each allowed some of: changing the scene and its
 * graphics, playing sounds, running the show, firing rules. Keys are shown
 * once and kept only as a hash.
 */
export const CONTROL_SCOPES = ["scene", "sound", "show", "rules", "events"] as const;
export type ControlScope = (typeof CONTROL_SCOPES)[number];
export const MAX_CONTROL_KEYS = 10;
export const controlKeyBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
  scopes: z.array(z.enum(CONTROL_SCOPES)).min(1).max(CONTROL_SCOPES.length),
});
export const controlKeyIdParamsSchema = z.object({ keyId: objectIdSchema });
export interface ControlKeyView {
  id: string;
  name: string;
  scopes: ControlScope[];
  /** The start of the key, to tell keys apart — never the key. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}
/** Do these, now, on the live stream — the show rules' actions. */
export const controlDoBodySchema = z.object({ actions: z.array(ruleActionSchema).min(1).max(MAX_RULE_ACTIONS) });
export const controlShowBodySchema = z.object({ step: z.enum(["start", "next", "stop"]) });

/**
 * The transparency report (Phase 3, deeper moderation): a year of trust &
 * safety in numbers — what was reported and how fast it was handled, what
 * the platform took down, what appeals decided, and what creators and
 * their moderators did in their rooms. NITDA's code of practice asks
 * platforms to publish one every year.
 */
/** A creator's appeal against a takedown, in their words. */
export const appealBodySchema = z.object({ text: z.string().trim().min(20, "Say a little more — a sentence or two").max(1000) });
export const appealResolveBodySchema = z.object({ decision: z.enum(["reverse", "uphold"]), note: z.string().trim().max(500).optional() });
export const appealListQuerySchema = z.object({ status: z.enum(["open", "closed"]).default("open") });
export interface AppealView {
  id: string;
  status: "open" | "reversed" | "upheld";
  text: string;
  note: string;
  createdAt: string;
  reviewedAt: string | null;
  stream: { id: string; title: string; takenDownAt: string | null };
  /** For admins: whose it is. */
  creator?: { id: string; username: string; displayName: string };
}
/** A creator's stream the platform took down, and their appeal if they made one. */
export interface TakedownView {
  streamId: string;
  title: string;
  takenDownAt: string;
  appeal: AppealView | null;
}

export const transparencyQuerySchema = z.object({ year: z.coerce.number().int().min(2024).max(2100).optional() });
export interface TransparencyReport {
  year: number;
  from: string;
  to: string;
  /** Context: how much happened on the platform in the period. */
  scale: { streams: number; creators: number; chatLines: number };
  reports: {
    total: number;
    byReason: Record<string, number>;
    actioned: number;
    dismissed: number;
    open: number;
    /** Resolved inside the 48-hour window, of those resolved. */
    onTime: number;
    medianHoursToResolve: number | null;
  };
  platform: { streamTakedowns: number; chatTakedowns: number };
  appeals: { received: number; reversed: number; upheld: number; open: number };
  rooms: { bans: number; timeouts: number; deletions: number; heldLines: number; heldApproved: number; heldDenied: number; shieldRaised: number };
  heldByReason: Record<string, number>;
}

/**
 * Live analytics (Phase 3): a broadcast minute by minute — viewers, chat
 * and gifts — with what happened when, where people left, and what the
 * chat asked. Read live by the studio, and afterwards as the recap.
 */
export const MOMENT_KINDS = ["segment", "guest", "card", "gift", "battle", "goal", "peak"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

export interface StreamAnalytics {
  startedAt: string;
  endedAt: string | null;
  live: boolean;
  /** One per minute on air, from the first. */
  minutes: Array<{ viewers: number; chats: number; giftsMinor: number }>;
  moments: Array<{ minute: number; kind: MomentKind; label: string }>;
  /** The biggest falls in the audience, and what was on when they happened. */
  dropOffs: Array<{ minute: number; from: number; to: number; during: string | null }>;
  summary: {
    durationMinutes: number;
    peakViewers: number;
    peakMinute: number;
    avgViewers: number;
    /** Signed-in viewers; guests watching signed out aren't counted here. */
    uniqueViewers: number;
    chats: number;
    chatters: number;
    giftsMinor: number;
    gifters: number;
    newAllies: number;
    avgWatchMinutes: number;
  };
  /** Lines from chat that asked something — worth an answer next time if not this. */
  questions: Array<{ minute: number; user: string; text: string }>;
}

/** Which of the account's encoder ingresses: RTMP (any encoder) or WHIP (OBS 30+). */
export const INGRESS_PROTOCOLS = ["rtmp", "whip"] as const;
export const streamKeyQuerySchema = z.object({ protocol: z.enum(INGRESS_PROTOCOLS).default("rtmp") });

/**
 * Stream health (Phase 1): the studio sends a 30-second summary of its
 * sender stats — averages and the worst of it — and the API keeps the
 * broadcast's run of them (six hours at most) for the report afterwards.
 */
export const HEALTH_LIMITATIONS = ["none", "cpu", "bandwidth", "other"] as const;
export const HEALTH_LEVELS = ["good", "fair", "poor"] as const;
export const MAX_HEALTH_WINDOWS = 720;
export const healthWindowSchema = z.object({
  at: z.number().int().min(0),
  kbps: z.number().int().min(0).max(1_000_000),
  fps: z.number().int().min(0).max(240),
  height: z.number().int().min(0).max(4_320),
  rttMs: z.number().int().min(0).max(60_000).nullable(),
  lossPct: z.number().min(0).max(100),
  limitation: z.enum(HEALTH_LIMITATIONS),
  level: z.enum(HEALTH_LEVELS),
});
export const healthBodySchema = z.object({ window: healthWindowSchema });
export type HealthWindowBody = z.infer<typeof healthWindowSchema>;

export const createStreamBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  category: categorySchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  thumbnail: imageSourceSchema.default(""),
  source: streamSourceSchema.default("camera"),
  /** Fan out a "went live" notification to followers. */
  notifyFollowers: z.boolean().default(true),
  /**
   * Post this broadcast to the WorldSpace feed. Off unless asked for: the
   * owner wants going live on Xtream to stay on Xtream by default, with
   * the cross-post a deliberate choice per stream.
   */
  postToWorldSpace: z.boolean().default(false),
  /**
   * Start a previously scheduled stream instead of creating a fresh one, so
   * the upcoming card, its reminders and its URL become the live broadcast.
   */
  scheduledStreamId: objectIdSchema.optional(),
  /** Go live with this scene already up — "Starting soon", say — so the
   *  first frame anyone sees is the card, not the camera finding its feet. */
  scene: sceneBodySchema.optional(),
  /**
   * A practice run (producer mode): a private room nobody else can find or
   * join, with simulated chat and gifts, so a creator can rehearse the
   * studio, their rules and their run of show. Nothing is announced, listed,
   * relayed or paid. Decided when the stream is made.
   */
  practice: z.boolean().default(false),
});

export const updateStreamBodySchema = createStreamBodySchema
  .omit({ scheduledStreamId: true, scene: true, practice: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

/** How far ahead a stream can be booked. */
export const SCHEDULE_HORIZON_MS = 365 * 24 * 60 * 60_000;


export const scheduleStreamBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  category: categorySchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  thumbnail: imageSourceSchema.default(""),
  notifyFollowers: z.boolean().default(true),
  postToWorldSpace: z.boolean().default(false),
  /**
   * ISO timestamp, from a few minutes out to a year ahead. It was thirty
   * days; the owner didn't want bookings boxed in by dates we pick
   * (2026-09-24), and a year still stops typos landing in 2062.
   */
  scheduledStartAt: z
    .string()
    .datetime()
    .refine((value) => {
      const t = new Date(value).getTime();
      const now = Date.now();
      return t > now + 2 * 60_000 && t < now + SCHEDULE_HORIZON_MS;
    }, "Pick a time at least a few minutes from now and within the next year"),
});

/** What a viewer was shown. Batched from the client, at most a grid per call. */
export const impressionsBodySchema = z.object({
  viewerKey: z.string().trim().min(8).max(64),
  items: z
    .array(
      z.object({
        streamId: objectIdSchema,
        surface: z.enum([
          "home",
          "explore",
          "browse",
          "channel",
          "watch",
          "following",
          "search",
        ]),
        row: z.string().trim().max(48).optional(),
        slot: z.number().int().min(0).max(500),
        explore: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(60),
});

export const onboardingBodySchema = z.object({
  categories: z.array(categorySchema).max(8),
  /** BCP-47-ish content language preference, e.g. "en", "yo", "pt-BR". */
  language: z.string().trim().min(2).max(12).optional(),
});

export const chatQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: objectIdSchema.optional(),
});

export const createChatMessageBodySchema = z.object({
  content: z.string().trim().min(1).max(500),
  type: z.enum(["text", "tip", "reaction"]).default("text"),
  tipAmount: z.string().trim().max(50).optional(),
  tipCurrency: z.string().trim().max(20).optional(),
  emoji: z.string().trim().max(20).optional(),
  /** Which surface the sender was on. Rendered as a badge cross-platform.
   * "socials" is the legacy value for what is now WorldSpace — old rows and
   * old clients still send it, so it stays accepted forever. */
  platform: z.enum(["xstream", "socials", "worldspace"]).default("xstream"),
});

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "violence",
  "sexual_content",
  "scam_or_fraud",
  "copyright",
  "other",
] as const;

export const reportReasonSchema = z.enum(REPORT_REASONS);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const createReportBodySchema = z.object({
  reason: reportReasonSchema,
  details: z.string().trim().max(500).optional(),
  /** Reporting one chat line rather than the stream. */
  messageId: objectIdSchema.optional(),
});

/* ── Safety kit (Phase 1) ─────────────────────────────────────────────── */

/**
 * What the chat filter watches for, each at its own level: off, hold (a
 * moderator approves it first) or block (it's never sent).
 */
export const FILTER_CATEGORIES = ["profanity", "insults", "slurs", "sexual", "links", "scams"] as const;
export const FILTER_LEVELS = ["off", "hold", "block"] as const;
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];
export type FilterLevel = (typeof FILTER_LEVELS)[number];

export const DEFAULT_FILTER_LEVELS: Record<FilterCategory, FilterLevel> = {
  profanity: "off",
  insults: "off",
  slurs: "block",
  sexual: "hold",
  links: "hold",
  scams: "hold",
};

/**
 * A lead moderator also manages the other moderators and can raise Shield.
 * A producer (Phase 3, producer mode) does all a lead can and runs the show
 * — scenes, graphics, the run of show and the stage — from their own device,
 * without appearing on air. The host can be their own producer on a second
 * device too.
 */
export const MOD_ROLES = ["lead", "mod", "producer"] as const;

/**
 * The request line (producer mode): who can ask to join a channel's stage.
 * The host's crew — moderators and producers — can always ask. "fans" is a
 * fan level of STAGE_FAN_LEVEL or more with the channel (fans.ts).
 */
export const STAGE_REQUEST_RULES = ["everyone", "allies", "fans", "off"] as const;
export type StageRequestRule = (typeof STAGE_REQUEST_RULES)[number];
export const STAGE_FAN_LEVEL = 3;
/** How old an account must be to ask to join, in days; 0 is any age. */
export const STAGE_ACCOUNT_DAYS = [0, 1, 7] as const;
export type StageAccountDays = (typeof STAGE_ACCOUNT_DAYS)[number];
/** Where someone asking to join stands with the channel, as the host sees it beside their name. */
export interface StageStanding {
  ally: boolean;
  level: number;
  /** Hours watched with the channel. */
  hours: number;
}
export type ModRole = (typeof MOD_ROLES)[number];
/** Who someone is in a channel's room. */
export type ChannelRole = "host" | ModRole;

/** Moderators putting chat lines on screen: never, as suggestions the host approves, or directly. */
export const MODS_CAN_FEATURE = ["off", "suggest", "on"] as const;
export type ModsCanFeature = (typeof MODS_CAN_FEATURE)[number];

const blockedTermSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .refine((t) => t.replace(/[*\s]/g, "").length > 0, "A term needs letters, not just wildcards");

const filterLevelSchema = z.enum(FILTER_LEVELS).optional();

/**
 * A young account named like one the channel banned lately (safety/evasion.ts):
 * "flag" marks its lines for moderators; "hold" also holds them for review.
 */
export const EVASION_TREATMENTS = ["flag", "hold"] as const;
export type EvasionTreatment = (typeof EVASION_TREATMENTS)[number];

export const safetySettingsBodySchema = z
  .object({
    filters: z
      .object({
        profanity: filterLevelSchema,
        insults: filterLevelSchema,
        slurs: filterLevelSchema,
        sexual: filterLevelSchema,
        links: filterLevelSchema,
        scams: filterLevelSchema,
      })
      .strict()
      .optional(),
    /** The creator's own terms; `*` stands for the rest of a word. */
    blockedTerms: z.array(blockedTermSchema).max(100).optional(),
    blockedTermsLevel: z.enum(["hold", "block"]).optional(),
    modsCanFeature: z.enum(MODS_CAN_FEATURE).optional(),
    evasion: z.enum(EVASION_TREATMENTS).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to change" });

export const addModBodySchema = z.object({
  username: usernameSchema,
  role: z.enum(MOD_ROLES).default("mod"),
});

export const channelParamsSchema = z.object({ id: objectIdSchema });
export const channelModParamsSchema = z.object({ id: objectIdSchema, userId: objectIdSchema });

export const shieldBodySchema = z.object({ on: z.boolean() });
export const slowModeBodySchema = z.object({ enabled: z.boolean() });

/** How long the platform has to act on a report (NITDA's code of practice). */
export const REPORT_RESPONSE_HOURS = 48;

export const reportResolveBodySchema = z.object({
  /** Take the content down (end the stream, or delete the line), or keep it up. */
  action: z.enum(["takedown", "dismiss"]),
  note: z.string().trim().max(500).optional(),
});

export const reportListQuerySchema = z.object({
  status: z.enum(["open", "closed"]).default("open"),
});

export const updateProfileBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    username: usernameSchema.optional(),
    avatar: imageSourceSchema.optional(),
    bio: z.string().trim().max(200).optional(),
    settings: z
      .object({
        autoRecord: z.boolean().optional(),
        slowMode: z.boolean().optional(),
        subscriberOnly: z.boolean().optional(),
        profanityFilter: z.boolean().optional(),
        /** Gifts at or above this many cents go on screen by themselves; 0 is off. */
        featureGiftsFromMinor: z
          .union([z.literal(0), z.literal(500), z.literal(2000), z.literal(10_000)])
          .optional(),
        /** How long a comment stays on screen; 0 is until the host takes it down. */
        featureSeconds: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(60)]).optional(),
        /** Who can ask to join the stage; the crew always can. */
        stageRequests: z.enum(STAGE_REQUEST_RULES).optional(),
        /** How old an account must be to ask to join, in days. */
        stageAccountDays: z.union([z.literal(0), z.literal(1), z.literal(7)]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
}

export interface ApiFailure {
  success: false;
  message: string;
  code?: string;
  requestId?: string;
  details?: unknown;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

/* ------------------------------------------------------------------ */
/* Market questions and the market as director (Phase 4)               */
/* ------------------------------------------------------------------ */

/**
 * Market questions: a prediction that asks where a price will be — "SOL
 * above $150.00 at 20:30?" — and settles itself from Coinbase's price at
 * that minute; nobody settles one by hand. Its words are written from the
 * oracle, never typed, and it's a vote, always: nothing is staked or paid
 * on a market outcome until the legal footing for points on one is settled.
 *
 * The market as director: the API watches the markets a show cares about —
 * the chart, the price strip, what chat's naming — and tells the host's
 * studio (and their producers' consoles) when one moves: a suggestion with
 * one-tap actions. Nothing goes on screen by itself.
 */

/** How far out a market question can be decided: five minutes to a day. */
export const MARKET_QUESTION_MIN_MS = 5 * 60_000;
export const MARKET_QUESTION_MAX_MS = 24 * 60 * 60_000;

/** The create-game body's `oracle`: which market, above what, and when. */
export const marketOracleBodySchema = z.object({
  symbol: marketSymbolSchema.refine((s) => s.endsWith("-USD"), "A US-dollar market, like SOL-USD"),
  above: z.number().positive().max(1e12),
  /** When it's decided, read to the minute: 5 minutes to 24 hours from now. */
  at: z.string().datetime(),
  /** The host's clock (an IANA zone such as "Africa/Lagos"), for the stored question's "at 20:30". */
  tz: z.string().trim().max(64).optional(),
});
export type MarketOracleBody = z.infer<typeof marketOracleBodySchema>;

/** A market question as a game view carries it. */
export interface MarketOracleView {
  symbol: string;
  above: number;
  /** The minute it's decided (ISO): its price is the close of Coinbase's 1-minute candle that starts here. */
  at: string;
  source: "Coinbase";
  /** The price it settled on, once it has. */
  price: number | null;
  /** Why it was called off, when the feed never gave a price. */
  failed: string | null;
}

/** The order of magnitude of a price (84,466 → 4), exact at the powers of ten whatever log10's rounding. */
function magnitudeOf(price: number) {
  let m = Math.floor(Math.log10(price));
  if (10 ** (m + 1) <= price) m += 1;
  else if (10 ** m > price) m -= 1;
  return m;
}

/** `n` to a multiple of `step`, without float dust (0.1 × 3 is 0.3 here). */
export function roundTo(n: number, step: number, mode: "nearest" | "down" | "up" = "nearest") {
  const k = n / step;
  const i = mode === "down" ? Math.floor(k + 1e-9) : mode === "up" ? Math.ceil(k - 1e-9) : Math.round(k);
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return Number((i * step).toFixed(Math.min(20, decimals)));
}

/**
 * The step a market's round numbers come in, from the size of its price —
 * a unit of its second digit: BTC by $1,000, ETH by $100, SOL by $10, XRP
 * by 10¢, DOGE by a tenth of a cent. What the director calls a round
 * number crossed, and what a suggested question is asked around.
 */
export function roundStep(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 1;
  return roundTo(10 ** (magnitudeOf(price) - 1), 10 ** (magnitudeOf(price) - 1));
}

/**
 * Where a market question's line starts: the price at its nearest round
 * number when that's within half a per cent — a real question over the next
 * quarter of an hour — and otherwise at the next digit down. BTC at 84,466
 * asks about 84,500; ETH at 2,702 about 2,700; SOL at 121.46 about 121.
 */
export function marketThreshold(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const step = roundStep(price);
  const round = roundTo(price, step);
  return Math.abs(round - price) / price <= 0.005 ? round : roundTo(price, step / 10);
}

/**
 * A market price as a question says it: whole dollars in the thousands
 * (cents when there are some), cents above a dollar, and below one enough
 * digits to see it move — "$84,500", "$150.00", "$0.0967", "$0.00000437".
 */
export function formatMarketUsd(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "$—";
  if (n >= 1000) {
    const cents = Number.isInteger(Math.round(n * 100) / 100) ? 0 : 2;
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: cents, maximumFractionDigits: cents })}`;
  }
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return "$0.00";
  const decimals = Math.min(12, Math.max(2, 3 - Math.floor(Math.log10(n))));
  return `$${n.toFixed(decimals).replace(/(\.\d{2}\d*?)0+$/, "$1")}`;
}

/** "20:30" on the given clock — the device's own when none is given (or it isn't a clock we know). */
export function formatMarketTime(at: string | number | Date, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(new Date(at));
  }
}

function dayOf(at: string | number | Date, timeZone?: string) {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, ...(timeZone ? { timeZone } : {}) }).format(new Date(at));
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(new Date(at));
  }
}

/**
 * A market question's words, written from its oracle: "SOL above $150.00
 * at 20:30?" — with the day when it isn't today ("… at 09:00 on Sunday?").
 * The API stores it on the host's clock; screens write it on their own.
 */
export function marketQuestionText(
  o: { symbol: string; above: number; at: string | number | Date },
  opts: { timeZone?: string; now?: number } = {},
): string {
  const base = o.symbol.split("-")[0] ?? o.symbol;
  const now = opts.now ?? Date.now();
  let day = "";
  if (dayOf(o.at, opts.timeZone) !== dayOf(now, opts.timeZone)) {
    try {
      day = ` on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) }).format(new Date(o.at))}`;
    } catch {
      day = ` on ${new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(new Date(o.at))}`;
    }
  }
  return `${base} above ${formatMarketUsd(o.above)} at ${formatMarketTime(o.at, opts.timeZone)}${day}?`;
}

/** What a settled market question says it settled on: "SOL was $151.20 at 20:30 · Coinbase". */
export function marketResultText(o: { symbol: string; at: string | number | Date; price: number }, opts: { timeZone?: string } = {}): string {
  const base = o.symbol.split("-")[0] ?? o.symbol;
  return `${base} was ${formatMarketUsd(o.price)} at ${formatMarketTime(o.at, opts.timeZone)} · Coinbase`;
}

/**
 * When votes on a market question close: with a tenth of the wait still to
 * go — a minute at least, half an hour at most. The nearer the minute, the
 * more the chart gives the answer away (a price's spread narrows with the
 * square root of the time left), so the last vote in still faces about a
 * third of the uncertainty the first one did: a call, not a read of the
 * chart. A day-long question still takes votes for most of the day.
 */
export function marketQuestionClosesAt(atMs: number, nowMs: number): number {
  const leadMin = Math.min(30, Math.max(1, Math.round((atMs - nowMs) / 10 / 60_000)));
  return atMs - leadMin * 60_000;
}

/** What the director noticed: a quick move, a round number crossed, or a new high or low for the stream. */
export const MARKET_SUGGESTION_KINDS = ["move", "round", "high", "low"] as const;
export type MarketSuggestionKind = (typeof MARKET_SUGGESTION_KINDS)[number];
/** The most suggestions GET /streams/:id/suggestions hands back — the newest. */
export const MAX_MARKET_SUGGESTIONS = 5;

/** A market question filled in for the host to open: decided `minutes` from when they do. */
export interface MarketQuestionPreset {
  symbol: string;
  above: number;
  minutes: number;
}

/**
 * A market moment for the host (`__evt: "suggestion"` to the host and their
 * consoles; GET /streams/:id/suggestions): what happened, in a line, and
 * one-tap ways to use it. Nothing here goes on screen until someone taps.
 */
export interface MarketSuggestion {
  id: string;
  kind: MarketSuggestionKind;
  symbol: string;
  /** "SOL +3.4% in 15 min", "BTC crossed $85,000", "ETH at the stream's high". */
  text: string;
  /** The price when it was noticed. */
  price: number;
  /** The move behind it, in per cent, over `windowMin` minutes. */
  changePct: number;
  windowMin: number;
  /** A round number crossed: which. */
  level: number | null;
  /** When it was noticed (ISO). */
  at: string;
  actions: {
    /** Chart + face on the market, at a zoom that shows the move. */
    chart: SceneChart;
    /** A banner line, "Not financial advice" included. */
    banner: string;
    /** A market question around the nearest round number; null for a market no question can settle on. */
    question: MarketQuestionPreset | null;
  };
}
