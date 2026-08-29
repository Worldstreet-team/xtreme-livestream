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
   * Lifetime gift earnings (net of commission), USD cents. Display/stats only —
   * the money itself is credited straight to the streamer's central wallet by
   * the charge split, so there is nothing to withdraw here.
   */
  earningsUsdMinor: number;
  settings: {
    autoRecord: boolean;
    slowMode: boolean;
    subscriberOnly: boolean;
    profanityFilter: boolean;
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
    earningsUsdMinor: { type: Number, default: 0, min: 0 },
    settings: {
      autoRecord: { type: Boolean, default: false },
      slowMode: { type: Boolean, default: false },
      subscriberOnly: { type: Boolean, default: false },
      profanityFilter: { type: Boolean, default: true },
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
  isLive: boolean;
  livekitRoomName: string;
  /** camera | screen | obs — how this stream is fed. */
  source?: string;
  /** LiveKit ingress id when source === "obs"; deleted at stream end. */
  ingressId?: string;
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
  startedAt: Date;
  endedAt: Date | null;
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
    thumbnailVersion: { type: Number, default: 0 },
    isLive: { type: Boolean, default: true, index: true },
    livekitRoomName: { type: String, required: true, unique: true },
    source: { type: String, enum: ["camera", "screen", "obs"], default: "camera" },
    ingressId: { type: String },
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
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    duration: { type: String, default: "0:00" },
    earnings: { type: String, default: "$0" },
  },
  { timestamps: true },
);

streamSchema.index({ isLive: 1, viewers: -1 });
streamSchema.index({ isLive: 1, category: 1 });

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
  },
  { timestamps: true },
);

giftTransactionSchema.index({ streamerId: 1, createdAt: -1 });
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });

export interface INotification extends Document {
  /** Recipient. */
  userId: mongoose.Types.ObjectId;
  type: "live";
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
    type: { type: String, enum: ["live"], default: "live" },
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
