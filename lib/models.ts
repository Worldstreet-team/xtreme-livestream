import mongoose, { Schema, Document, Model } from "mongoose";

// ──────────────────────────────────────
// Categories (matches frontend)
// ──────────────────────────────────────
export const CATEGORIES = [
  "Bitcoin Trading",
  "Altcoins & DeFi",
  "NFTs & Web3",
  "Market Analysis",
  "Crypto Education",
  "General / Just Chatting",
] as const;

export type CategoryType = (typeof CATEGORIES)[number];

// ──────────────────────────────────────
// User
// ──────────────────────────────────────
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
  streamKey: string;
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
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "", maxlength: 200 },
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    isLive: { type: Boolean, default: false },
    streamKey: { type: String, required: true },
    settings: {
      autoRecord: { type: Boolean, default: false },
      slowMode: { type: Boolean, default: false },
      subscriberOnly: { type: Boolean, default: false },
      profanityFilter: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// ──────────────────────────────────────
// Stream
// ──────────────────────────────────────
export interface IStream extends Document {
  streamerId: mongoose.Types.ObjectId;
  title: string;
  category: CategoryType;
  tags: string[];
  thumbnail: string;
  isLive: boolean;
  livekitRoomName: string;
  viewers: number;
  peakViewers: number;
  startedAt: Date;
  endedAt: Date | null;
  duration: string;
  earnings: string;
  createdAt: Date;
}

const streamSchema = new Schema<IStream>(
  {
    streamerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, required: true, enum: CATEGORIES },
    tags: [{ type: String, trim: true }],
    thumbnail: { type: String, default: "" },
    isLive: { type: Boolean, default: true, index: true },
    livekitRoomName: { type: String, required: true },
    viewers: { type: Number, default: 0 },
    peakViewers: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    duration: { type: String, default: "0:00" },
    earnings: { type: String, default: "$0" },
  },
  { timestamps: true }
);

// Compound index for browsing live streams
streamSchema.index({ isLive: 1, viewers: -1 });
streamSchema.index({ isLive: 1, category: 1 });

// ──────────────────────────────────────
// ChatMessage
// ──────────────────────────────────────
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
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true },
    avatar: { type: String, default: "" },
    isMod: { type: Boolean, default: false },
    content: { type: String, required: true, maxlength: 500 },
    type: { type: String, required: true, enum: ["text", "tip", "reaction"] },
    tipAmount: { type: String, default: null },
    tipCurrency: { type: String, default: null },
    emoji: { type: String, default: null },
  },
  { timestamps: true }
);

// For fetching chat history chronologically
chatMessageSchema.index({ streamId: 1, createdAt: 1 });

// ──────────────────────────────────────
// Follow
// ──────────────────────────────────────
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
  { timestamps: true }
);

// Prevent duplicate follows & speed up lookups
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
followSchema.index({ followingId: 1 }); // "who follows me" queries

// ──────────────────────────────────────
// Model exports (safe for hot-reload)
// ──────────────────────────────────────
export const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", userSchema);

export const Stream: Model<IStream> =
  mongoose.models.Stream || mongoose.model<IStream>("Stream", streamSchema);

export const ChatMessage: Model<IChatMessage> =
  mongoose.models.ChatMessage || mongoose.model<IChatMessage>("ChatMessage", chatMessageSchema);

export const Follow: Model<IFollow> =
  mongoose.models.Follow || mongoose.model<IFollow>("Follow", followSchema);
