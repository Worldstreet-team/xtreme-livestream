import mongoose, { type Document, type Model, Schema } from "mongoose";
import { type Category } from "@xtreme/contracts";

export interface IUser extends Document {
  authUserId: string;
  email: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followers: number;
  following: number;
  totalViews: number;
  isLive: boolean;
  /** Platform-granted trust badge; set by admins/ops, not user-editable. */
  verified: boolean;
  streamKey: string;
  /**
   * The account's one RTMP ingress (OBS, vMix, any encoder). Minted the
   * first time it is needed and kept for life: the server URL and stream key
   * are set in the encoder once and work for every broadcast, because each
   * go-live re-points this same ingress at the new room instead of minting
   * a fresh one. Rotated only on request (a leaked key).
   */
  obsIngress?:
    | {
        ingressId: string;
        url: string;
        streamKey: string;
        createdAt: Date;
      }
    | undefined;
  /**
   * Lifetime gift earnings (net of commission), USD cents. Display/stats only —
   * the money itself is credited straight to the streamer's central wallet by
   * the charge split, so there is nothing to withdraw here.
   */
  earningsUsdMinor: number;
  /** Reward points: earned by watching and playing, spent on stakes. Never purchasable. */
  pointsBalance: number;
  /** YYYY-MM-DD of the last day a watch bonus was paid — drives the daily streak. */
  lastWatchDay: string;
  watchStreakDays: number;
  settings: {
    autoRecord: boolean;
    slowMode: boolean;
    subscriberOnly: boolean;
    profanityFilter: boolean;
    /**
     * Whether this channel appears when viewers browse by tag. Tags are a
     * discovery axis and therefore a targeting axis — hate raids on Twitch
     * keyed on self-applied identity tags, not on the streamer's appearance.
     * A streamer must be able to keep a tag on their stream for their own
     * community without it also being a lookup key for strangers.
     */
    discoverableByTag: boolean;
  };
  /**
   * The two-screen cold-start picker. Categories chosen seed the first
   * sessions; behaviour supersedes them as soon as there is any. Optional —
   * skipping lands on a popularity default and records nothing here.
   */
  onboarding: {
    completedAt: Date | null;
    categories: string[];
    /** Content language the viewer asked for; "" when never set. */
    language: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    authUserId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: { type: String, required: true, trim: true },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 200 },
    followers: { type: Number, default: 0, min: 0 },
    following: { type: Number, default: 0, min: 0 },
    totalViews: { type: Number, default: 0, min: 0 },
    isLive: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
    streamKey: { type: String, required: true },
    obsIngress: {
      type: new Schema(
        {
          ingressId: { type: String, required: true },
          url: { type: String, required: true },
          streamKey: { type: String, required: true },
          createdAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: undefined,
    },
    earningsUsdMinor: { type: Number, default: 0, min: 0 },
    pointsBalance: { type: Number, default: 0, min: 0 },
    lastWatchDay: { type: String, default: "" },
    watchStreakDays: { type: Number, default: 0 },
    settings: {
      autoRecord: { type: Boolean, default: false },
      slowMode: { type: Boolean, default: false },
      subscriberOnly: { type: Boolean, default: false },
      profanityFilter: { type: Boolean, default: true },
      discoverableByTag: { type: Boolean, default: true },
    },
    onboarding: {
      completedAt: { type: Date, default: null },
      categories: { type: [String], default: [] },
      language: { type: String, default: "", maxlength: 12 },
    },
  },
  { timestamps: true },
);

export interface IStreamGuest {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatar: string;
  status: "requested" | "live";
  requestedAt: Date;
}

export interface IStream extends Document {
  streamerId: mongoose.Types.ObjectId;
  title: string;
  category: Category;
  tags: string[];
  thumbnail: string;
  /**
   * Bumped (to epoch ms) whenever `thumbnail` changes; 0 for streams that
   * predate this field.
   *
   * Exists so list endpoints can build a cache-busting thumbnail URL without
   * reading the blob itself — the whole point of moving thumbnails out of the
   * list payload. Deliberately not derived from `updatedAt`: the LiveKit
   * webhook saves this document on every viewer join and leave, so
   * `updatedAt` would invalidate the cache constantly while the image is
   * unchanged.
   */
  thumbnailVersion: number;
  /**
   * Optional looping clip the web app can play as a muted preview when the
   * room has no video to give — seeded streams in development, or a
   * broadcaster between encoder reconnects. Never a substitute for the
   * live track, which always takes over when it arrives.
   */
  previewUrl?: string;
  isLive: boolean;
  livekitRoomName: string;
  /** camera | screen | obs — how this stream is fed. */
  source?: string;
  /** LiveKit ingress id when source === "obs" — the account's persistent one. */
  ingressId?: string;
  /**
   * When the encoder last disconnected while this stream was live, or null
   * while it is feeding. A dropped encoder gets a grace window to reconnect
   * (OBS_RECONNECT_GRACE_MS) before the stream is ended — a network blip in
   * a church hall must not end the service for everyone watching.
   */
  feedDroppedAt?: Date | null;
  notifyFollowers?: boolean;
  viewers: number;
  peakViewers: number;
  /**
   * Accumulated viewer-seconds. `viewers` is the *current* concurrent count and
   * decays to 0 as an audience leaves, so it can't be used to describe a
   * finished stream. Integrating it over time can: average viewers is
   * `viewerSeconds / streamDurationSeconds`.
   */
  viewerSeconds: number;
  /** Start of the current accrual window — when `viewers` was last sampled. */
  viewerSampledAt: Date | null;
  likes: number;
  /**
   * Viewers on the stage (or asking to be). Guests publish into the same
   * LiveKit room as the broadcaster once approved; the array is the source
   * of truth the API checks before granting or revoking publish rights.
   * Ephemeral to the live session — never read again after the stream ends.
   */
  guests: IStreamGuest[];
  /** Host-pinned chat message rendered as a banner above chat; null = none. */
  pinnedMessage: {
    messageId: mongoose.Types.ObjectId;
    username: string;
    avatar: string;
    content: string;
  } | null;
  /**
   * Three-valued, matching every major platform's live taxonomy. `isLive`
   * stays as the hot-path boolean the list queries index on; `status` adds
   * the state `isLive` can't express — a broadcast that is scheduled but
   * hasn't started, which needs to be discoverable before it airs.
   */
  status: "upcoming" | "live" | "ended";
  /** When an upcoming stream is due to start; null once live or for ad-hoc streams. */
  scheduledStartAt: Date | null;
  /**
   * Viewer growth over the trailing window, normalised by the earlier count —
   * roughly "how many times bigger than ten minutes ago". Written by the
   * velocity sweep; 0 for streams too young to measure. This is what
   * "trending" sorts on, so a channel going 20→300 can outrank one flat at
   * 30,000 — which a plain viewer sort can never do.
   */
  velocity: number;
  startedAt: Date;
  endedAt: Date | null;
  /**
   * The "ended" event hasn't been acknowledged by the socials gateway yet.
   * Set when the stream ends, cleared on a successful relay; the periodic
   * sweep re-relays anything still flagged, so a restart or gateway outage
   * can't leave the socials feed showing the stream as live forever.
   */
  socialsRelayPending?: boolean;
  duration: string;
  earnings: string;
  createdAt: Date;
  updatedAt: Date;
}

const streamSchema = new Schema<IStream>(
  {
    streamerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, required: true, trim: true, maxlength: 48 },
    tags: [{ type: String, trim: true, maxlength: 30 }],
    thumbnail: { type: String, default: "" },
    previewUrl: { type: String },
    thumbnailVersion: { type: Number, default: 0 },
    isLive: { type: Boolean, default: true, index: true },
    livekitRoomName: { type: String, required: true, unique: true },
    source: { type: String, enum: ["camera", "screen", "obs"], default: "camera" },
    ingressId: { type: String },
    feedDroppedAt: { type: Date, default: null },
    notifyFollowers: { type: Boolean, default: true },
    viewers: { type: Number, default: 0, min: 0 },
    peakViewers: { type: Number, default: 0, min: 0 },
    viewerSeconds: { type: Number, default: 0, min: 0 },
    viewerSampledAt: { type: Date, default: null },
    likes: { type: Number, default: 0, min: 0 },
    guests: {
      type: [
        {
          _id: false,
          userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
          username: { type: String, required: true },
          avatar: { type: String, default: "" },
          status: {
            type: String,
            enum: ["requested", "live"],
            default: "requested",
          },
          requestedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    pinnedMessage: {
      type: new Schema(
        {
          messageId: { type: Schema.Types.ObjectId },
          username: { type: String, default: "" },
          avatar: { type: String, default: "" },
          content: { type: String, default: "" },
        },
        { _id: false },
      ),
      default: null,
    },
    status: {
      type: String,
      enum: ["upcoming", "live", "ended"],
      default: "live",
      index: true,
    },
    scheduledStartAt: { type: Date, default: null },
    velocity: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    socialsRelayPending: { type: Boolean, default: false },
    duration: { type: String, default: "0:00" },
    earnings: { type: String, default: "$0" },
  },
  { timestamps: true },
);

streamSchema.index({ isLive: 1, viewers: -1 });
streamSchema.index({ isLive: 1, category: 1 });
streamSchema.index({ isLive: 1, velocity: -1 });
streamSchema.index({ status: 1, scheduledStartAt: 1 });
streamSchema.index({ streamerId: 1, status: 1, scheduledStartAt: 1 });
// Partial: nearly every stream has the flag cleared, so a full index on a
// boolean would be dead weight — only the sweep's tiny pending set is indexed.
streamSchema.index(
  { endedAt: -1 },
  { partialFilterExpression: { socialsRelayPending: true } },
);

export interface IChatMessage extends Document {
  platform?: string;
  streamId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  username: string;
  avatar: string;
  isMod: boolean;
  content: string;
  type: "text" | "tip" | "reaction";
  tipAmount: string | null;
  tipCurrency: string | null;
  emoji: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    streamId: {
      type: Schema.Types.ObjectId,
      ref: "Stream",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true },
    avatar: { type: String, default: "" },
    isMod: { type: Boolean, default: false },
    platform: {
      type: String,
      // "socials" is the legacy WorldSpace value; kept so old rows stay valid.
      enum: ["xstream", "socials", "worldspace"],
      default: "xstream",
    },
    content: { type: String, required: true, maxlength: 500 },
    type: {
      type: String,
      required: true,
      enum: ["text", "tip", "reaction"],
    },
    tipAmount: { type: String, default: null },
    tipCurrency: { type: String, default: null },
    emoji: { type: String, default: null },
  },
  { timestamps: true },
);

chatMessageSchema.index({ streamId: 1, createdAt: -1 });
// "What has this person chatted in" — an engagement signal for the rows
// engine that was a collection scan before this index existed.
chatMessageSchema.index({ userId: 1, createdAt: -1 });

export interface IGiftTransaction extends Document {
  senderId: mongoose.Types.ObjectId;
  streamerId: mongoose.Types.ObjectId;
  streamId: mongoose.Types.ObjectId | null;
  giftName: string;
  emoji: string;
  /** All amounts in USD cents. gross = commission + net. */
  grossUsdMinor: number;
  commissionUsdMinor: number;
  netUsdMinor: number;
  /** Charge id returned by the central wallet service. */
  walletChargeId: string;
  /** Client idempotency key — replays return the original transaction. */
  idempotencyKey: string;
  /** Set when the gift landed during a live battle: which battle, which side it backed. */
  battleId: mongoose.Types.ObjectId | null;
  battleSide: "host" | "challenger" | null;
  /** Gross value as counted toward the battle score (×2 inside the multiplier window). */
  battleScoreUsdMinor: number;
  createdAt: Date;
  updatedAt: Date;
}

const giftTransactionSchema = new Schema<IGiftTransaction>(
  {
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    streamerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", default: null },
    giftName: { type: String, default: "", maxlength: 50 },
    emoji: { type: String, default: "", maxlength: 20 },
    grossUsdMinor: { type: Number, required: true, min: 1 },
    commissionUsdMinor: { type: Number, required: true, min: 0 },
    netUsdMinor: { type: Number, required: true, min: 0 },
    walletChargeId: { type: String, default: "" },
    idempotencyKey: { type: String, required: true, unique: true },
    battleId: { type: Schema.Types.ObjectId, ref: "Battle", default: null },
    battleSide: { type: String, enum: ["host", "challenger", null], default: null },
    battleScoreUsdMinor: { type: Number, default: 0 },
  },
  { timestamps: true },
);

giftTransactionSchema.index({ battleId: 1, createdAt: -1 });
giftTransactionSchema.index({ streamerId: 1, createdAt: -1 });
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });

export interface INotification extends Document {
  /** Recipient. */
  userId: mongoose.Types.ObjectId;
  /** live = someone you follow went live; reminder = a stream you asked about started. */
  type: "live" | "reminder" | "battle_invite" | "battle_result";
  /** Who did the thing (the streamer who went live). */
  actorId: mongoose.Types.ObjectId;
  actorName: string;
  streamId: mongoose.Types.ObjectId;
  streamTitle: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, enum: ["live", "reminder", "battle_invite", "battle_result"], default: "live" },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    streamTitle: { type: String, default: "" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, createdAt: -1 });
// A go-live ping is stale news within a day; a month is generous. TTL keeps
// the collection from growing with every stream a popular account starts.
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

export interface IStreamBan extends Document {
  streamId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  username: string;
  bannedBy: mongoose.Types.ObjectId;
  /** null = banned for the stream's lifetime; a date = timeout that lapses. */
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const streamBanSchema = new Schema<IStreamBan>(
  {
    streamId: {
      type: Schema.Types.ObjectId,
      ref: "Stream",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true },
    bannedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One ban row per user per stream — re-banning updates it (timeout upgraded
// to permanent, etc.) instead of stacking rows.
streamBanSchema.index({ streamId: 1, userId: 1 }, { unique: true });

export interface IStreamLike extends Document {
  streamId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const streamLikeSchema = new Schema<IStreamLike>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

streamLikeSchema.index({ streamId: 1, userId: 1 }, { unique: true });
// The unique index is streamId-first, so per-user lookups couldn't use it.
streamLikeSchema.index({ userId: 1, createdAt: -1 });

export interface IReport extends Document {
  streamId: mongoose.Types.ObjectId;
  streamerId: mongoose.Types.ObjectId;
  reporterId: mongoose.Types.ObjectId;
  reason: string;
  details: string;
  status: "open" | "reviewed" | "dismissed";
  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    streamId: {
      type: Schema.Types.ObjectId,
      ref: "Stream",
      required: true,
    },
    streamerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reporterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reason: { type: String, required: true, maxlength: 50 },
    details: { type: String, default: "", maxlength: 500 },
    status: {
      type: String,
      enum: ["open", "reviewed", "dismissed"],
      default: "open",
    },
  },
  { timestamps: true },
);

// One report per user per stream — repeat submissions update the original.
reportSchema.index({ streamId: 1, reporterId: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });

export interface IFollow extends Document {
  followerId: mongoose.Types.ObjectId;
  followingId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const followSchema = new Schema<IFollow>(
  {
    followerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    followingId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
followSchema.index({ followingId: 1 });

/**
 * One viewer's presence in one broadcast. The LiveKit webhook already tells
 * us who joined and left every room — for signed-in viewers the participant
 * identity is their user id — and until now that was used only to bump a
 * counter. This is the substrate every personalised row is built on:
 * continue watching, "because you watch", and co-viewership all read it.
 */
export interface IWatchSession extends Document {
  userId: mongoose.Types.ObjectId;
  streamId: mongoose.Types.ObjectId;
  streamerId: mongoose.Types.ObjectId;
  category: string;
  joinedAt: Date;
  /** null while the viewer is still in the room. */
  leftAt: Date | null;
}

const watchSessionSchema = new Schema<IWatchSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    streamerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, default: "" },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
  },
  { timestamps: false },
);

// "What has this person watched" is the dominant query, newest first.
watchSessionSchema.index({ userId: 1, joinedAt: -1 });
// Closing a session on leave, and "who watched this stream" for co-viewing.
watchSessionSchema.index({ streamId: 1, userId: 1, leftAt: 1 });
// "Who watches this channel" — the co-viewership seed set.
watchSessionSchema.index({ streamerId: 1, userId: 1 });

/**
 * What we showed, where, and in which slot. Without this, every click we
 * read back is confounded by where we placed the thing — position one on a
 * page earns several times the clicks of position five regardless of what's
 * in it. Logged from the client in batches; `explore` marks impressions
 * that came from the exploration budget rather than the ranker, so the
 * randomised traffic can be evaluated on its own.
 */
export interface IImpression extends Document {
  /** Signed-in viewer, or null for an anonymous visitor. */
  userId: mongoose.Types.ObjectId | null;
  /** Stable per-browser key so anonymous sessions can still be grouped. */
  viewerKey: string;
  streamId: mongoose.Types.ObjectId;
  /** explore | home | browse | channel | watch | following | search */
  surface: string;
  /** Row id within the surface (e.g. "followed-live"); "" for flat grids. */
  row: string;
  /** Zero-based slot within the row or grid. */
  slot: number;
  explore: boolean;
  createdAt: Date;
}

const impressionSchema = new Schema<IImpression>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    viewerKey: { type: String, required: true, maxlength: 64 },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    surface: { type: String, required: true, maxlength: 32 },
    row: { type: String, default: "", maxlength: 48 },
    slot: { type: Number, required: true, min: 0 },
    explore: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

impressionSchema.index({ streamId: 1, createdAt: -1 });
impressionSchema.index({ userId: 1, createdAt: -1 });
// Ninety days is enough to fit a position-bias model; beyond that the rows
// are dead weight.
impressionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

/**
 * A viewer-count reading for a live stream, taken once a minute by the
 * velocity sweep. `Stream.viewers` is only the current level; growth needs
 * the level it was at ten minutes ago, and this is where that lives.
 */
export interface IViewerSample extends Document {
  streamId: mongoose.Types.ObjectId;
  viewers: number;
  at: Date;
}

const viewerSampleSchema = new Schema<IViewerSample>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    viewers: { type: Number, required: true, min: 0 },
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

viewerSampleSchema.index({ streamId: 1, at: -1 });
// A day of history is more than velocity needs; the analytics that might want
// more should aggregate into their own store.
viewerSampleSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

/**
 * "Tell me when this goes live." The upcoming state is only worth having if
 * a viewer can act on it, and this is the action.
 */
export interface IStreamReminder extends Document {
  userId: mongoose.Types.ObjectId;
  streamId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const streamReminderSchema = new Schema<IStreamReminder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
  },
  { timestamps: true },
);

streamReminderSchema.index({ userId: 1, streamId: 1 }, { unique: true });
streamReminderSchema.index({ streamId: 1 });

export const User: Model<IUser> =
  mongoose.models.User ?? mongoose.model<IUser>("User", userSchema);

export const Stream: Model<IStream> =
  mongoose.models.Stream ?? mongoose.model<IStream>("Stream", streamSchema);

export const ChatMessage: Model<IChatMessage> =
  mongoose.models.ChatMessage ??
  mongoose.model<IChatMessage>("ChatMessage", chatMessageSchema);

export const Follow: Model<IFollow> =
  mongoose.models.Follow ?? mongoose.model<IFollow>("Follow", followSchema);

export const StreamLike: Model<IStreamLike> =
  mongoose.models.StreamLike ??
  mongoose.model<IStreamLike>("StreamLike", streamLikeSchema);

export const Notification: Model<INotification> =
  mongoose.models.Notification ??
  mongoose.model<INotification>("Notification", notificationSchema);

export const StreamBan: Model<IStreamBan> =
  mongoose.models.StreamBan ??
  mongoose.model<IStreamBan>("StreamBan", streamBanSchema);

export const Report: Model<IReport> =
  mongoose.models.Report ?? mongoose.model<IReport>("Report", reportSchema);

export const GiftTransaction: Model<IGiftTransaction> =
  mongoose.models.GiftTransaction ??
  mongoose.model<IGiftTransaction>("GiftTransaction", giftTransactionSchema);

export const WatchSession: Model<IWatchSession> =
  mongoose.models.WatchSession ??
  mongoose.model<IWatchSession>("WatchSession", watchSessionSchema);

export const Impression: Model<IImpression> =
  mongoose.models.Impression ??
  mongoose.model<IImpression>("Impression", impressionSchema);

export const ViewerSample: Model<IViewerSample> =
  mongoose.models.ViewerSample ??
  mongoose.model<IViewerSample>("ViewerSample", viewerSampleSchema);

export const StreamReminder: Model<IStreamReminder> =
  mongoose.models.StreamReminder ??
  mongoose.model<IStreamReminder>("StreamReminder", streamReminderSchema);

/* ------------------------------------------------------------------ */
/* Battles                                                             */
/* ------------------------------------------------------------------ */

export type BattleStatus = "scheduled" | "invited" | "live" | "overtime" | "ended" | "cancelled";

/**
 * Two live creators, one clock. Scores are gross gift value per side; the
 * server owns the clock, the multiplier window and the settlement — the
 * client only ever renders what it is told.
 */
export interface IBattle extends Document {
  hostId: mongoose.Types.ObjectId;
  challengerId: mongoose.Types.ObjectId;
  hostStreamId: mongoose.Types.ObjectId;
  challengerStreamId: mongoose.Types.ObjectId;
  status: BattleStatus;
  durationSec: number;
  /** Seconds before the end during which gifts count double. */
  multiplierWindowSec: number;
  multiplier: number;
  invitedAt: Date;
  /** Booked ahead: starts by itself once both are live at or after this. */
  scheduledAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  hostUsdMinor: number;
  challengerUsdMinor: number;
  /** Commission collected on battle gifts — the bonus is carved from this. */
  commissionUsdMinor: number;
  winnerId: mongoose.Types.ObjectId | null;
  bonusUsdMinor: number;
  overtimeUsed: boolean;
  endedReason: "clock" | "cancelled" | "disconnect" | "declined" | "expired" | null;
  createdAt: Date;
  updatedAt: Date;
}

const battleSchema = new Schema<IBattle>(
  {
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    challengerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hostStreamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    challengerStreamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    status: {
      type: String,
      enum: ["scheduled", "invited", "live", "overtime", "ended", "cancelled"],
      default: "invited",
    },
    durationSec: { type: Number, default: 300 },
    multiplierWindowSec: { type: Number, default: 30 },
    multiplier: { type: Number, default: 2 },
    invitedAt: { type: Date, default: Date.now },
    scheduledAt: { type: Date, default: null },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    hostUsdMinor: { type: Number, default: 0 },
    challengerUsdMinor: { type: Number, default: 0 },
    commissionUsdMinor: { type: Number, default: 0 },
    winnerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    bonusUsdMinor: { type: Number, default: 0 },
    overtimeUsed: { type: Boolean, default: false },
    endedReason: { type: String, default: null },
  },
  { timestamps: true },
);

// The live lookups: "is this stream in a battle right now" from either side,
// and the sweep's "which battles have run past their clock".
battleSchema.index({ hostStreamId: 1, status: 1 });
battleSchema.index({ challengerStreamId: 1, status: 1 });
battleSchema.index({ status: 1, endsAt: 1 });
battleSchema.index({ status: 1, scheduledAt: 1 });
battleSchema.index({ challengerId: 1, status: 1, invitedAt: -1 });

export const Battle = mongoose.model<IBattle>("Battle", battleSchema);

/* ------------------------------------------------------------------ */
/* Points and games                                                    */
/* ------------------------------------------------------------------ */

export type PointsReason =
  | "welcome"
  | "watch"
  | "streak"
  | "drop"
  | "game_stake"
  | "game_win"
  | "game_refund"
  | "raffle_ticket"
  | "raffle_win"
  | "quiz_win"
  | "redeem"
  | "adjust";

/** Every change to a points balance, with the balance it left behind. */
export interface IPointsLedger extends Document {
  userId: mongoose.Types.ObjectId;
  delta: number;
  balanceAfter: number;
  reason: PointsReason;
  refId: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const pointsLedgerSchema = new Schema<IPointsLedger>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    delta: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, required: true },
    refId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
pointsLedgerSchema.index({ userId: 1, createdAt: -1 });
pointsLedgerSchema.index({ reason: 1, createdAt: -1 });

export const PointsLedger = mongoose.model<IPointsLedger>("PointsLedger", pointsLedgerSchema);

export type GameStatus = "open" | "locked" | "settled" | "cancelled";

/**
 * A game run inside a stream. Phase 2 ships predictions; the shape leaves
 * room for raffles and quizzes without a second model.
 */
export type GameType = "prediction" | "raffle" | "quiz";

export interface IGame extends Document {
  streamId: mongoose.Types.ObjectId;
  hostId: mongoose.Types.ObjectId;
  type: GameType;
  status: GameStatus;
  question: string;
  outcomes: { id: string; label: string; points: number; entries: number }[];
  /** Entries close here; settlement is the host's call after that (quizzes settle themselves). */
  closesAt: Date;
  poolPoints: number;
  entries: number;
  winningOutcome: string | null;
  /** Raffle: cost of a ticket in points (0 = free). */
  ticketPoints: number;
  /** Raffle: how many tickets are drawn. Quiz: points per correct answer. */
  winnersCount: number;
  prizePoints: number;
  /** Quiz: the right answer, set at creation, never sent to viewers before settlement. */
  correctOutcome: string | null;
  /** Raffle: who was drawn. */
  winners: mongoose.Types.ObjectId[];
  settledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const gameSchema = new Schema<IGame>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["prediction", "raffle", "quiz"], default: "prediction" },
    ticketPoints: { type: Number, default: 0 },
    winnersCount: { type: Number, default: 1 },
    prizePoints: { type: Number, default: 0 },
    correctOutcome: { type: String, default: null },
    winners: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ["open", "locked", "settled", "cancelled"], default: "open" },
    question: { type: String, required: true, maxlength: 140 },
    outcomes: [
      {
        _id: false,
        id: { type: String, required: true },
        label: { type: String, required: true, maxlength: 40 },
        points: { type: Number, default: 0 },
        entries: { type: Number, default: 0 },
      },
    ],
    closesAt: { type: Date, required: true },
    poolPoints: { type: Number, default: 0 },
    entries: { type: Number, default: 0 },
    winningOutcome: { type: String, default: null },
    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);
gameSchema.index({ streamId: 1, status: 1, createdAt: -1 });
gameSchema.index({ status: 1, closesAt: 1 });

export const Game = mongoose.model<IGame>("Game", gameSchema);

export interface IGameEntry extends Document {
  gameId: mongoose.Types.ObjectId;
  streamId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  outcome: string;
  stakePoints: number;
  /** Set at settlement: what came back (stake included), 0 for a loss. */
  wonPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

const gameEntrySchema = new Schema<IGameEntry>(
  {
    gameId: { type: Schema.Types.ObjectId, ref: "Game", required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    outcome: { type: String, required: true },
    stakePoints: { type: Number, required: true, min: 1 },
    wonPoints: { type: Number, default: 0 },
  },
  { timestamps: true },
);
// One entry per person per game — the second attempt is rejected, not merged.
gameEntrySchema.index({ gameId: 1, userId: 1 }, { unique: true });
gameEntrySchema.index({ userId: 1, createdAt: -1 });

export const GameEntry = mongoose.model<IGameEntry>("GameEntry", gameEntrySchema);

/* ------------------------------------------------------------------ */
/* Payouts and audit                                                   */
/* ------------------------------------------------------------------ */

export type PayoutKind = "points_redemption" | "battle_bonus";
export type PayoutStatus = "pending" | "paid" | "failed";

/**
 * Money leaving the platform toward a user's wallet. Created before the
 * wallet call and updated after it, so a crash between the two leaves a
 * pending row the sweep can finish — never a silent double payment.
 */
export interface IPayout extends Document {
  userId: mongoose.Types.ObjectId;
  kind: PayoutKind;
  points: number;
  usdMinor: number;
  status: PayoutStatus;
  walletChargeId: string;
  refId: mongoose.Types.ObjectId | null;
  attempts: number;
  lastError: string;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const payoutSchema = new Schema<IPayout>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["points_redemption", "battle_bonus"], required: true },
    points: { type: Number, default: 0 },
    usdMinor: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    walletChargeId: { type: String, default: "" },
    refId: { type: Schema.Types.ObjectId, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);
payoutSchema.index({ userId: 1, createdAt: -1 });
payoutSchema.index({ status: 1, createdAt: 1 });

export const Payout = mongoose.model<IPayout>("Payout", payoutSchema);

/** Who did what to which thing — every settlement, payout and cancellation. */
export interface IAuditLog extends Document {
  actorId: mongoose.Types.ObjectId | null;
  action: string;
  targetType: string;
  targetId: mongoose.Types.ObjectId | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: Schema.Types.ObjectId, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
