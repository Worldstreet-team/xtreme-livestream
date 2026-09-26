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
export const SCENE_CARDS = ["starting-soon", "brb", "ending"] as const;

/**
 * Graphics drawn over the program (Phase 2, graphics and brand kit): one of
 * each at most. They render as DOM on every screen — crisp at any quality
 * layer — in the creator's brand accent.
 */
export const SCENE_LAYER_KINDS = ["lower-third", "banner", "ticker", "countdown", "logo", "cta"] as const;
export const LOGO_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

export const sceneLayerSchema = z.discriminatedUnion("kind", [
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
]);

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
  kind: z.enum(["chat", "gift"]),
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
});

export type SceneLayout = (typeof SCENE_LAYOUTS)[number];
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
});

export const updateStreamBodySchema = createStreamBodySchema
  .omit({ scheduledStreamId: true, scene: true })
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

/** A lead moderator also manages the other moderators and can raise Shield. */
export const MOD_ROLES = ["lead", "mod"] as const;
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
