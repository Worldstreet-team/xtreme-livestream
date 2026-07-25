import mongoose, { type Document, type Model, Schema } from "mongoose";
import { CATEGORIES, type Category } from "@xtreme/contracts";

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

export interface IStream extends Document {
  streamerId: mongoose.Types.ObjectId;
  title: string;
  category: Category;
  tags: string[];
  thumbnail: string;
  isLive: boolean;
  livekitRoomName: string;
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
    category: { type: String, required: true, enum: CATEGORIES },
    tags: [{ type: String, trim: true, maxlength: 30 }],
    thumbnail: { type: String, default: "" },
    isLive: { type: Boolean, default: true, index: true },
    livekitRoomName: { type: String, required: true, unique: true },
    viewers: { type: Number, default: 0, min: 0 },
    peakViewers: { type: Number, default: 0, min: 0 },
    viewerSeconds: { type: Number, default: 0, min: 0 },
    viewerSampledAt: { type: Date, default: null },
    likes: { type: Number, default: 0, min: 0 },
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

export const Report: Model<IReport> =
  mongoose.models.Report ?? mongoose.model<IReport>("Report", reportSchema);

export const GiftTransaction: Model<IGiftTransaction> =
  mongoose.models.GiftTransaction ??
  mongoose.model<IGiftTransaction>("GiftTransaction", giftTransactionSchema);
