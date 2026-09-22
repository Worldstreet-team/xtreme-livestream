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
});

export const updateStreamBodySchema = createStreamBodySchema
  .omit({ scheduledStreamId: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export const scheduleStreamBodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  category: categorySchema,
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  thumbnail: imageSourceSchema.default(""),
  notifyFollowers: z.boolean().default(true),
  postToWorldSpace: z.boolean().default(false),
  /** ISO timestamp, from a few minutes out to thirty days ahead. */
  scheduledStartAt: z
    .string()
    .datetime()
    .refine((value) => {
      const t = new Date(value).getTime();
      const now = Date.now();
      return t > now + 2 * 60_000 && t < now + 30 * 24 * 60 * 60_000;
    }, "Scheduled time must be between a few minutes and thirty days from now"),
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
