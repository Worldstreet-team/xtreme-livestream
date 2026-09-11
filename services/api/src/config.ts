import "./env.js";
import { z } from "zod";



const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  TRUST_PROXY: booleanString,
  MONGODB_URI: z.string().min(1),
  MONGODB_DB_NAME: z.string().min(1).default("xtreme-livestream"),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_AUTHORIZED_PARTIES: z.string().default(""),
  CORS_ORIGINS: z.string().default(""),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  // Central wallet service (gifting). Leave unset to disable the gift routes —
  // the rest of the API works without them.
  WALLET_API_URL: z.string().default(""),
  WALLET_SERVICE_TOKEN: z.string().default(""),
  /**
   * Clerk user id of the platform treasury account. Payouts (points
   * redemption, battle bonuses) are wallet charges from this account with a
   * full recipient split — the one primitive the wallet service exposes.
   * Unset: payouts are recorded as pending and retried once it is.
   */
  WALLET_TREASURY_USER_ID: z.string().default(""),
  /**
   * How long an OBS/RTMP stream stays live after its encoder drops, waiting
   * for it to reconnect on the same key, before it is ended. Five minutes
   * covers a router reboot or a mobile-data hiccup.
   */
  OBS_RECONNECT_GRACE_MS: z.coerce.number().int().min(30_000).default(300_000),
  // WorldStreet Social gateway. Leave unset to disable the live-post relay —
  // streams still work, they just don't publish into the socials feed.
  SOCIALS_GATEWAY_URL: z.string().default(""),
  SOCIALS_WEBHOOK_SECRET: z.string().default(""),
  // Platform cut of every gift, in percent (0-100).
  GIFT_COMMISSION_PERCENT: z.coerce.number().min(0).max(100).default(20),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_WINDOW: z.string().default("1 minute"),
  // Local dev only: treat every stream flagged live in the database as live,
  // instead of asking LiveKit whether a broadcaster is actually connected.
  // Seeded streams have no real room, so without this the reconciler ends
  // them on the first list request. Ignored when NODE_ENV=production.
  DEV_ASSUME_STREAMS_LIVE: booleanString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid API environment:\n${missing}`);
}

const splitList = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const config = {
  ...parsed.data,
  clerkAuthorizedParties: splitList(parsed.data.CLERK_AUTHORIZED_PARTIES),
  corsOrigins: splitList(parsed.data.CORS_ORIGINS),
};

export type ApiConfig = typeof config;
