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
   * Platform admins, by username, comma-separated: they get the report
   * queue (/admin/reports) and its 48-hour clock, and a notification for
   * every report. Unset: nobody is an admin and reports wait in the queue.
   */
  ADMIN_USERNAMES: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  /**
   * How long a stream stays live after its feed drops — an OBS/RTMP encoder,
   * or since 2026-09-25 the host's browser — waiting for it to reconnect
   * before it is ended. Five minutes covers a router reboot or a mobile-data
   * hiccup. (The name predates browser holds; it's kept so deployed env
   * files keep working.)
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
  /**
   * Call receipts (calls.ts): creators making market calls on air, with a
   * public record of how each went. Off until legal review — off, nothing
   * can be called, the record reads as switched off, and the web hides
   * every surface of it (GET /calls/enabled).
   */
  CALL_RECEIPTS: booleanString,
  /**
   * Stream recording (recording.ts): replays go to a Cloudflare R2 bucket,
   * written there by LiveKit egress and played straight from its public
   * URL. Leave any of the R2 values unset to switch recording off — the
   * go-live switch hides and nothing is recorded.
   */
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET_NAME: z.string().default(""),
  /** The bucket's public base URL (a custom domain or r2.dev), no trailing slash needed. */
  R2_PUBLIC_URL: z.string().default(""),
  /**
   * The web app's recording page (app/record/[id]): egress opens
   * `<this>/<streamId>` in a headless browser and records what it draws —
   * the program as viewers see it.
   */
  RECORDING_TEMPLATE_URL: z.string().url().default("https://xtream.worldstreetgold.com/record"),
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
  /** Every R2 value is set: streams can be recorded. */
  recordingEnabled: Boolean(
    parsed.data.R2_ACCOUNT_ID &&
      parsed.data.R2_ACCESS_KEY_ID &&
      parsed.data.R2_SECRET_ACCESS_KEY &&
      parsed.data.R2_BUCKET_NAME &&
      parsed.data.R2_PUBLIC_URL,
  ),
};

export type ApiConfig = typeof config;
