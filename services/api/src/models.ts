import mongoose, { type Document, type Model, Schema } from "mongoose";
import {
  DEFAULT_FILTER_LEVELS,
  FILTER_LEVELS,
  MOD_ROLES,
  MODS_CAN_FEATURE,
  STAGE_ACCOUNT_DAYS,
  STAGE_REQUEST_RULES,
  EVASION_TREATMENTS,
  GUEST_STATUSES,
  type Category,
  type FeaturedItem,
  type FilterCategory,
  type FilterLevel,
  type ModRole,
  type ModsCanFeature,
  type StageRequestRule,
  type EvasionTreatment,
  type GuestStatus,
} from "@xtreme/contracts";

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
   * The same, over WHIP (OBS 30+'s WebRTC output: lower delay than RTMP).
   * Minted only when asked for; re-pointed with the RTMP one at go-live, so
   * whichever the encoder uses lands in the room.
   */
  whipIngress?:
    | {
        ingressId: string;
        url: string;
        streamKey: string;
        createdAt: Date;
      }
    | undefined;
  /** The creator's priced requests menu (Phase 2, paid requests). */
  requestsMenu?: Array<{ id: string; title: string; priceUsdMinor: number; prompt: string }>;
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
  /**
   * The brand kit: the accent the stream's graphics wear, the lower third's
   * shape, and a logo for the corner of the picture — stored inline like a
   * thumbnail and served at /users/:id/logo?v=<logoVersion>.
   */
  brand?: {
    accent: string;
    lowerThird: string;
    /** The face the graphics' titles wear (BRAND_FONTS). */
    font: string;
    logo: string;
    logoVersion: number;
    /** Graphics kept for reuse (brandPresetSchema), newest last. */
    presets: Array<Record<string, unknown>>;
    /** The Set the stream wears (the web's lib/sets.ts), or null. */
    set?: string | null;
  };
  /**
   * The channel's safety kit: the chat filter's level per category, the
   * creator's own blocked terms, their moderators, and whether moderators
   * may put chat lines on screen. The filter's on/off switch is
   * `settings.profanityFilter`.
   */
  safety?: {
    filters: Record<FilterCategory, FilterLevel>;
    blockedTerms: string[];
    blockedTermsLevel: "hold" | "block";
    mods: Array<{ userId: mongoose.Types.ObjectId; username: string; role: ModRole; addedAt: Date }>;
    modsCanFeature: ModsCanFeature;
    /** What happens to lines from a likely ban evader (safety/evasion.ts). */
    evasion?: EvasionTreatment;
  };
  settings: {
    /** Appearance, chosen on any device. Unset until someone picks one. */
    theme?: "system" | "light" | "dark";
    /** The studio's second-camera suggestion; unset reads as "on", "off" after "Don't show again". */
    secondCameraTip?: "on" | "off";
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
    /** Gifts at or above this many cents go on screen by themselves; 0 is off. */
    featureGiftsFromMinor: number;
    /** How long a featured comment stays on screen, in seconds; 0 is until taken down. */
    featureSeconds: number;
    /** Who can ask to join the stage (the request line); the crew always can. */
    stageRequests: StageRequestRule;
    /** How old an account must be to ask to join, in days; 0 is any age. */
    stageAccountDays: number;
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
  /**
   * The walkthrough, shared by the web and the app: tour id → when it was
   * finished or skipped (never plays again), and tour id → when "Later"
   * runs out. Unset until the first tour ends.
   */
  tours?: {
    seen?: Map<string, Date>;
    snoozed?: Map<string, Date>;
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
    requestsMenu: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            title: { type: String, required: true, maxlength: 40 },
            priceUsdMinor: { type: Number, required: true, min: 100 },
            prompt: { type: String, default: "", maxlength: 60 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    whipIngress: {
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
    brand: {
      accent: { type: String, enum: ["ember", "chili", "white", "sky", "mint", "lilac"], default: "ember" },
      lowerThird: { type: String, enum: ["bar", "pill"], default: "bar" },
      font: { type: String, enum: ["wide", "clean", "rounded", "mono"], default: "wide" },
      logo: { type: String, default: "" },
      logoVersion: { type: Number, default: 0 },
      presets: { type: [Schema.Types.Mixed], default: [] },
      set: { type: String, default: null },
    },
    safety: {
      filters: {
        profanity: { type: String, enum: FILTER_LEVELS, default: DEFAULT_FILTER_LEVELS.profanity },
        insults: { type: String, enum: FILTER_LEVELS, default: DEFAULT_FILTER_LEVELS.insults },
        slurs: { type: String, enum: FILTER_LEVELS, default: DEFAULT_FILTER_LEVELS.slurs },
        sexual: { type: String, enum: FILTER_LEVELS, default: DEFAULT_FILTER_LEVELS.sexual },
        links: { type: String, enum: FILTER_LEVELS, default: DEFAULT_FILTER_LEVELS.links },
        scams: { type: String, enum: FILTER_LEVELS, default: DEFAULT_FILTER_LEVELS.scams },
      },
      blockedTerms: { type: [String], default: [] },
      blockedTermsLevel: { type: String, enum: ["hold", "block"], default: "block" },
      mods: {
        type: [
          new Schema(
            {
              userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
              username: { type: String, required: true },
              role: { type: String, enum: MOD_ROLES, default: "mod" },
              addedAt: { type: Date, default: Date.now },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      modsCanFeature: { type: String, enum: MODS_CAN_FEATURE, default: "suggest" },
      evasion: { type: String, enum: EVASION_TREATMENTS, default: "flag" },
    },
    settings: {
      // No default: unset means "never chosen", so a browser's own earlier choice can be kept.
      theme: { type: String, enum: ["system", "light", "dark"] },
      // No default either: unset is "on" — the tip is off only once someone said so.
      secondCameraTip: { type: String, enum: ["on", "off"] },
      autoRecord: { type: Boolean, default: false },
      slowMode: { type: Boolean, default: false },
      subscriberOnly: { type: Boolean, default: false },
      profanityFilter: { type: Boolean, default: true },
      discoverableByTag: { type: Boolean, default: true },
      featureGiftsFromMinor: { type: Number, enum: [0, 500, 2000, 10_000], default: 0 },
      featureSeconds: { type: Number, enum: [0, 10, 20, 60], default: 20 },
      stageRequests: { type: String, enum: STAGE_REQUEST_RULES, default: "everyone" },
      stageAccountDays: { type: Number, enum: STAGE_ACCOUNT_DAYS, default: 0 },
    },
    onboarding: {
      completedAt: { type: Date, default: null },
      categories: { type: [String], default: [] },
      language: { type: String, default: "", maxlength: 12 },
    },
    tours: {
      seen: { type: Map, of: Date, default: undefined },
      snoozed: { type: Map, of: Date, default: undefined },
    },
  },
  { timestamps: true },
);

export interface IStreamGuest {
  userId: mongoose.Types.ObjectId;
  username: string;
  avatar: string;
  status: GuestStatus;
  requestedAt: Date;
  /** Where they stood with the channel when they asked (the request line). */
  standing?: { ally: boolean; level: number; hours: number } | null;
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
   * Up to three frames the studio grabbed while live and scored itself
   * (sharpness, exposure, a face), kept spread across the broadcast — the
   * "Pick a thumbnail" choices after it ends. Offered one at a time as they
   * are grabbed (thumbnail-candidates.ts decides what stays), so a studio
   * reload loses nothing. `select: false`: the blobs never ride along with
   * a list, a card or the stream page; only the host's own candidates
   * route asks for them.
   */
  thumbnailCandidates: Array<{ id: string; image: string; score: number; at: Date }>;
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
  /** Cross-post this broadcast to the WorldSpace feed. Off by default. */
  postToWorldSpace?: boolean;
  /**
   * How the program is laid out right now — see `sceneBodySchema` in
   * @xtreme/contracts. The version only goes up, so clients hearing the
   * room metadata and the data event in either order keep the newer one.
   */
  scene?: {
    layout: string;
    card: string | null;
    cardNote: string;
    /** Chart + face's market (`sceneChartSchema`), or null. */
    chart: { symbol: string; interval: string } | null;
    /** Graphics over the program — shapes validated by `sceneLayerSchema`. */
    layers: Array<Record<string, unknown>>;
    /**
     * The comment or gift on screen (`featuredItemSchema`), written only by
     * the feature routes and the gift tier, with atomic updates — so it never
     * races the host's own scene changes.
     */
    featured: FeaturedItem | null;
    /** The audio desk's guest faders, by room identity (0–1). */
    gains?: Record<string, number>;
    /** The guest beside the host in a Split, by room identity (null: stage order). */
    spotlight?: string | null;
    /** A sign-language interpreter on stage, kept on screen in a corner (null: none). */
    interpreter?: string | null;
    /** Which camera the program shows while a phone camera (`cam-<hostId>`) is in: the studio's, the phone, or both. */
    angle?: "main" | "phone" | "both";
    /**
     * Where the phone camera sits in the layout (PHONE_SLOTS): the one word
     * for it since placements; `angle` is kept in step. Absent on streams
     * from before, which read it from their angle.
     */
    phoneSlot?: "off" | "main" | "beside" | "corner";
    version: number;
  };
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
  /**
   * The audience curve (live analytics): the most viewers seen in each
   * minute since `startedAt`, keyed by minute. Minutes with no change carry
   * the last count forward when read (analytics.ts).
   */
  viewersByMinute?: Record<string, number>;
  /** What happened when, for the recap: segments starting, guests joining, cards going up (200 at most). */
  moments?: Array<{ at: Date; kind: string; label: string }>;
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
   * Shield mode, raised by the host or a lead moderator: allies only, slow
   * mode, links and scams blocked, and new accounts held for review.
   */
  shield: { on: boolean; at: Date | null; by: mongoose.Types.ObjectId | null };
  /** Set when a platform admin took the stream down after a report; it's then kept out of listings. */
  takenDownAt: Date | null;
  /** A practice run: private, unlisted, unannounced, with simulated chat and gifts (practice.ts). */
  practice: boolean;
  /**
   * A practice run's watch-only preview link (preview.ts): the SHA-256 of
   * its secret key, never the key itself, and when it was made. Both are
   * kept out of every read unless asked for (+previewKeyHash), and cleared
   * when the run ends or the host stops sharing.
   */
  previewKeyHash?: string | null;
  previewSharedAt?: Date | null;
  /**
   * The goal bar (Phase 2, goals and status) — the host's goal and how far
   * it's got. Written only by goals.ts, each time with one atomic update.
   */
  goal: {
    id: string;
    kind: "gifts" | "likes" | "allies";
    title: string;
    target: number;
    milestones: Array<{ at: number; label: string }>;
    progress: number;
    startedAt: Date;
    reachedAt: Date | null;
    endedAt: Date | null;
    rev: number;
    /** Who has allied during an allies goal — each counts once, however often they toggle. */
    alliedBy?: mongoose.Types.ObjectId[];
  } | null;
  /** The heat meter as of the last gift. */
  heat: { level: number; at: Date } | null;
  /** The host is taking paid requests on this broadcast. */
  requestsOpen: boolean;
  /**
   * Where the run of show is (Phase 3): the segment on air and since when.
   * Host-only — the segment ids point into the creator's private rundown.
   */
  rundown: { segmentId: string | null; startedAt: Date | null; showStartedAt: Date | null } | null;
  /** The studio's 30-second health summaries, for the report afterwards (capped at six hours). */
  health: Array<{
    at: number;
    kbps: number;
    fps: number;
    height: number;
    rttMs: number | null;
    lossPct: number;
    limitation: "none" | "cpu" | "bandwidth" | "other";
    level: "good" | "fair" | "poor";
  }>;
  /** Lines moderators suggested for the screen, waiting on the host. */
  featureQueue: Array<{
    messageId: mongoose.Types.ObjectId;
    username: string;
    text: string;
    kind: "chat" | "gift";
    suggestedBy: string;
    at: Date;
  }>;
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
  /**
   * The broadcast's recording (recording.ts). `requested` is the host's
   * go-live choice; each part is one LiveKit egress — usually one, but a
   * room that closed during a reconnect hold and came back starts another,
   * and the replay plays them in order. `select: false`: storage keys and
   * egress ids never ride along with a read; routes show `replayView`.
   */
  recording?: IStreamRecording;
  duration: string;
  earnings: string;
  createdAt: Date;
  updatedAt: Date;
}

export type RecordingPartStatus = "starting" | "active" | "complete" | "failed";

export interface IStreamRecordingPart {
  /** Ours, so a part can be claimed before LiveKit hands back its egress id. */
  id: string;
  egressId: string;
  /** The object's key in the R2 bucket. */
  key: string;
  status: RecordingPartStatus;
  durationMs: number;
  sizeBytes: number;
  startedAt: Date;
  endedAt: Date | null;
  error: string;
}

export interface IStreamRecording {
  requested: boolean;
  parts: IStreamRecordingPart[];
  /** The host deleted the replay: its files are gone from the bucket. */
  deletedAt: Date | null;
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
    thumbnailCandidates: {
      type: [{ _id: false, id: String, image: String, score: Number, at: Date }],
      default: () => [],
      select: false,
    },
    isLive: { type: Boolean, default: true, index: true },
    livekitRoomName: { type: String, required: true, unique: true },
    source: { type: String, enum: ["camera", "screen", "obs"], default: "camera" },
    ingressId: { type: String },
    feedDroppedAt: { type: Date, default: null },
    notifyFollowers: { type: Boolean, default: true },
    postToWorldSpace: { type: Boolean, default: false },
    scene: {
      _id: false,
      layout: { type: String, enum: ["auto", "solo", "split", "trio", "grid", "screen-face", "chart-face"], default: "auto" },
      card: { type: String, enum: ["starting-soon", "brb", "ending", null], default: null },
      cardNote: { type: String, default: "", maxlength: 80 },
      chart: { type: Schema.Types.Mixed, default: null },
      layers: { type: [Schema.Types.Mixed], default: [] },
      featured: { type: Schema.Types.Mixed, default: null },
      gains: { type: Schema.Types.Mixed, default: () => ({}) },
      spotlight: { type: String, default: null },
      interpreter: { type: String, default: null },
      angle: { type: String, enum: ["main", "phone", "both"], default: "main" },
      // No default: a stream from before placements reads its phone from its angle.
      phoneSlot: { type: String, enum: ["off", "main", "beside", "corner"] },
      version: { type: Number, default: 0, min: 0 },
    },
    viewers: { type: Number, default: 0, min: 0 },
    peakViewers: { type: Number, default: 0, min: 0 },
    viewerSeconds: { type: Number, default: 0, min: 0 },
    viewerSampledAt: { type: Date, default: null },
    viewersByMinute: { type: Schema.Types.Mixed, default: () => ({}), select: false },
    moments: {
      type: [{ _id: false, at: { type: Date, required: true }, kind: { type: String, required: true }, label: { type: String, default: "" } }],
      default: [],
      select: false,
    },
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
            enum: GUEST_STATUSES,
            default: "requested",
          },
          requestedAt: { type: Date, default: Date.now },
          standing: {
            type: { _id: false, ally: Boolean, level: Number, hours: Number },
            default: null,
          },
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
    shield: {
      on: { type: Boolean, default: false },
      at: { type: Date, default: null },
      by: { type: Schema.Types.ObjectId, ref: "User", default: null },
    },
    takenDownAt: { type: Date, default: null },
    practice: { type: Boolean, default: false },
    // The preview link's key, hashed, and when it was made: never in a list or a page.
    previewKeyHash: { type: String, default: null, select: false },
    previewSharedAt: { type: Date, default: null, select: false },
    goal: { type: Schema.Types.Mixed, default: null },
    heat: { type: Schema.Types.Mixed, default: null },
    requestsOpen: { type: Boolean, default: false },
    // The host's own: kept out of every read unless asked for (+rundown).
    rundown: { type: Schema.Types.Mixed, default: null, select: false },
    // Kept out of every read unless asked for (+health): only the report wants it.
    health: { type: Schema.Types.Mixed, default: () => [], select: false },
    featureQueue: {
      type: [
        new Schema(
          {
            messageId: { type: Schema.Types.ObjectId, required: true },
            username: { type: String, default: "" },
            text: { type: String, default: "" },
            kind: { type: String, enum: ["chat", "gift"], default: "chat" },
            suggestedBy: { type: String, default: "" },
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
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
    recording: {
      type: new Schema(
        {
          requested: { type: Boolean, default: false },
          parts: {
            type: [
              new Schema(
                {
                  id: { type: String, required: true },
                  egressId: { type: String, default: "" },
                  key: { type: String, default: "" },
                  status: { type: String, enum: ["starting", "active", "complete", "failed"], default: "starting" },
                  durationMs: { type: Number, default: 0 },
                  sizeBytes: { type: Number, default: 0 },
                  startedAt: { type: Date, default: Date.now },
                  endedAt: { type: Date, default: null },
                  error: { type: String, default: "" },
                },
                { _id: false },
              ),
            ],
            default: [],
          },
          deletedAt: { type: Date, default: null },
        },
        { _id: false },
      ),
      default: null,
      select: false,
    },
    duration: { type: String, default: "0:00" },
    earnings: { type: String, default: "$0" },
  },
  { timestamps: true },
);

streamSchema.index({ isLive: 1, viewers: -1 });
streamSchema.index({ isLive: 1, category: 1 });
streamSchema.index({ isLive: 1, velocity: -1 });
streamSchema.index({ status: 1, scheduledStartAt: 1 });
// The egress webhook finds its stream by egress id. Sparse: most streams have no parts.
streamSchema.index({ "recording.parts.egressId": 1 }, { sparse: true });
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
  /** "held": the filter caught it and it waits for a moderator; nobody else sees it. */
  status: "visible" | "held";
  /** Which filter category held it. */
  heldReason: string;
  /** A Shout: pinned over the chat until then. */
  shoutUntil?: Date | null;
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
    status: { type: String, enum: ["visible", "held"], default: "visible" },
    heldReason: { type: String, default: "" },
    shoutUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

chatMessageSchema.index({ streamId: 1, createdAt: -1 });
// Pinned Shouts, for the first history page; only lines that ever had a pin.
chatMessageSchema.index({ streamId: 1, shoutUntil: 1 }, { partialFilterExpression: { shoutUntil: { $type: "date" } } });
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
// The heat meter reads a stream's last minute of gifts.
giftTransactionSchema.index({ streamId: 1, createdAt: -1 });
giftTransactionSchema.index({ streamerId: 1, createdAt: -1 });
giftTransactionSchema.index({ senderId: 1, createdAt: -1 });

export interface INotification extends Document {
  /** Recipient. */
  userId: mongoose.Types.ObjectId;
  /**
   * live = someone you follow went live; reminder = a stream you asked
   * about started; mod_added = a creator made you a moderator; report = a
   * report reached the review queue (platform admins only); takedown = your
   * stream was taken down after a report; request_refunded = a paid
   * request wasn't done, and the money went back; sponsor_paid = an Xtream
   * campaign paid for a stream that ran its card.
   */
  type: "live" | "reminder" | "battle_invite" | "battle_result" | "mod_added" | "report" | "takedown" | "request_refunded" | "sponsor_paid" | "appeal" | "appeal_reversed" | "appeal_upheld";
  /** Who did the thing (the streamer who went live). */
  actorId: mongoose.Types.ObjectId;
  actorName: string;
  streamId: mongoose.Types.ObjectId | null;
  streamTitle: string;
  /** Where the row opens, when it isn't a stream (a channel, the report queue). */
  link: string;
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
    type: {
      type: String,
      enum: ["live", "reminder", "battle_invite", "battle_result", "mod_added", "report", "takedown", "request_refunded", "sponsor_paid", "appeal", "appeal_reversed", "appeal_upheld"],
      default: "live",
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", default: null },
    streamTitle: { type: String, default: "" },
    link: { type: String, default: "" },
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
  /** "actioned": taken down; "dismissed": reviewed and kept up. "reviewed" is legacy. */
  status: "open" | "reviewed" | "actioned" | "dismissed";
  /** A chat line, when that's what was reported (its words kept, in case it's deleted). */
  messageId: mongoose.Types.ObjectId | null;
  message: { username: string; content: string } | null;
  /** When the platform must have acted by — 48 hours from intake. */
  dueAt: Date;
  resolvedBy: mongoose.Types.ObjectId | null;
  resolvedAt: Date | null;
  note: string;
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
      enum: ["open", "reviewed", "actioned", "dismissed"],
      default: "open",
    },
    messageId: { type: Schema.Types.ObjectId, default: null },
    message: {
      type: new Schema({ username: String, content: String }, { _id: false }),
      default: null,
    },
    dueAt: { type: Date, default: () => new Date(Date.now() + 48 * 60 * 60 * 1000) },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    note: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true },
);

// One report per user per stream, or per chat line — repeat submissions
// update the original. (Replaces the old stream-only unique index, which
// migrateIndexes() drops.)
reportSchema.index({ streamId: 1, reporterId: 1, messageId: 1 }, { unique: true, name: "report_once" });
reportSchema.index({ status: 1, dueAt: 1 });

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
  /** A counting gift in the last seconds reset the clock — once per battle. */
  lateResetUsed: boolean;
  /** What the loser does on the victory lap ("sings a song"); "" for none. */
  forfeit: string;
  /**
   * "2v2": each side is its stream and the partner on its stage — a guest,
   * or a creator brought over by co-live. Gifts still count per stream.
   */
  mode: BattleMode;
  /** Each side's partner in a 2v2: the first guest live on its stage when the clock started. */
  hostPartnerId: mongoose.Types.ObjectId | null;
  challengerPartnerId: mongoose.Types.ObjectId | null;
  /**
   * Which gifts count toward the score (catalog ids, @xtreme/contracts
   * GIFT_KEYS). Empty: every gift counts. Set at invite or booking; every
   * gift still reaches the host as money either way.
   */
  giftFilter: string[];
  endedReason: "clock" | "cancelled" | "disconnect" | "declined" | "expired" | null;
  createdAt: Date;
  updatedAt: Date;
}

export type BattleMode = "1v1" | "2v2";

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
    lateResetUsed: { type: Boolean, default: false },
    forfeit: { type: String, default: "", maxlength: 60 },
    mode: { type: String, enum: ["1v1", "2v2"], default: "1v1" },
    hostPartnerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    challengerPartnerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    giftFilter: { type: [String], default: [] },
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

/**
 * Quick match: a live host waiting for any opponent. One entry per host;
 * the next host to ask is paired with the one waiting longest. Entries
 * lapse after two minutes (and are swept by Mongo's TTL after that).
 */
export interface IBattleQueue extends Document {
  userId: mongoose.Types.ObjectId;
  streamId: mongoose.Types.ObjectId;
  /** Pairs only with someone waiting for the same kind of battle. */
  mode: BattleMode;
  at: Date;
}
const battleQueueSchema = new Schema<IBattleQueue>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    mode: { type: String, enum: ["1v1", "2v2"], default: "1v1" },
    at: { type: Date, default: Date.now, expires: 300 },
  },
  { timestamps: false },
);
export const BattleQueue = mongoose.model<IBattleQueue>("BattleQueue", battleQueueSchema);

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
  | "quest"
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

/**
 * A quest paid out: one row per user, quest and period ("2026-09-24",
 * "2026-W39", or "once" for milestones). The unique index is the guard
 * against paying the same quest twice — the claim writes this row first
 * and only then moves points.
 */
export interface IQuestClaim extends Document {
  userId: mongoose.Types.ObjectId;
  questId: string;
  periodKey: string;
  points: number;
  createdAt: Date;
}

const questClaimSchema = new Schema<IQuestClaim>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    questId: { type: String, required: true, maxlength: 60 },
    periodKey: { type: String, required: true, maxlength: 20 },
    points: { type: Number, required: true, min: 1 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

questClaimSchema.index({ userId: 1, questId: 1, periodKey: 1 }, { unique: true });

export const QuestClaim = mongoose.model<IQuestClaim>("QuestClaim", questClaimSchema);

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
  /**
   * Prediction: a vote, not a bet — picks carry no stake and settling pays
   * nothing. For outcomes the host controls, and where staking isn't wanted.
   */
  voteOnly: boolean;
  /**
   * A market question (Phase 4): "SOL above $150.00 at 20:30?", settled by
   * the game sweep from Coinbase's price at `at` (market-oracle.ts) — never
   * by hand, and always a vote. `price` is what it settled on; `failed`
   * says why it was called off when the feed never answered.
   */
  oracle?: { symbol: string; above: number; at: Date; price: number | null; failed: string | null } | null;
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
    voteOnly: { type: Boolean, default: false },
    oracle: {
      type: new Schema(
        {
          symbol: { type: String, required: true, maxlength: 20 },
          above: { type: Number, required: true },
          at: { type: Date, required: true },
          price: { type: Number, default: null },
          failed: { type: String, default: null, maxlength: 200 },
        },
        { _id: false },
      ),
      default: null,
    },
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
    // 0 for a vote or a quiz answer — nothing staked (a floor of 1 refused every one of those).
    stakePoints: { type: Number, required: true, min: 0 },
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

export type PayoutKind = "points_redemption" | "battle_bonus" | "request" | "sponsor";
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
    kind: { type: String, enum: ["points_redemption", "battle_bonus", "request", "sponsor"], required: true },
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

/**
 * A paid request (Phase 2): the viewer's money sits in the treasury while
 * it's pending; done pays the creator (less commission) and books it as a
 * gift; skipped or expired refunds the viewer in full.
 */
export interface IRequestOrder extends Document {
  streamId: mongoose.Types.ObjectId;
  streamerId: mongoose.Types.ObjectId;
  viewerId: mongoose.Types.ObjectId;
  viewerUsername: string;
  viewerAvatar: string;
  itemId: string;
  title: string;
  note: string;
  priceUsdMinor: number;
  status: "pending" | "done" | "skipped" | "expired";
  /** The charge that moved the money into the treasury. */
  walletChargeId: string;
  idempotencyKey: string;
  refund: { status: "none" | "refunded" | "failed"; attempts: number; lastError: string };
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
const requestOrderSchema = new Schema<IRequestOrder>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    streamerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    viewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    viewerUsername: { type: String, default: "" },
    viewerAvatar: { type: String, default: "" },
    itemId: { type: String, required: true },
    title: { type: String, required: true },
    note: { type: String, default: "" },
    priceUsdMinor: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "done", "skipped", "expired"], default: "pending" },
    walletChargeId: { type: String, default: "" },
    idempotencyKey: { type: String, required: true, unique: true },
    refund: {
      status: { type: String, enum: ["none", "refunded", "failed"], default: "none" },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: "" },
    },
    decidedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
requestOrderSchema.index({ streamId: 1, status: 1, createdAt: 1 });
requestOrderSchema.index({ status: 1, "refund.status": 1 });
export const RequestOrder = mongoose.model<IRequestOrder>("RequestOrder", requestOrderSchema);

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

/**
 * An appeal (Phase 3, deeper moderation): a creator asking the platform to
 * look again at a stream it took down. One per stream; an admin reverses
 * the takedown (the stream's page comes back) or upholds it, with a note.
 */
export interface IAppeal extends Document {
  kind: "takedown";
  streamId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  text: string;
  /** When the stream was taken down — kept here, since a reversal clears it on the stream. */
  takenDownAt: Date;
  status: "open" | "reversed" | "upheld";
  reviewedBy: mongoose.Types.ObjectId | null;
  reviewedAt: Date | null;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}

const appealSchema = new Schema<IAppeal>(
  {
    kind: { type: String, enum: ["takedown"], default: "takedown" },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true, maxlength: 1000 },
    takenDownAt: { type: Date, required: true },
    status: { type: String, enum: ["open", "reversed", "upheld"], default: "open", index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    note: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true },
);
// One appeal per takedown: a stream taken down again later can be appealed again.
appealSchema.index({ kind: 1, streamId: 1, takenDownAt: 1 }, { unique: true });

export const Appeal = mongoose.model<IAppeal>("Appeal", appealSchema);

/* ------------------------------------------------------------------ */
/* Sponsorships                                                        */
/* ------------------------------------------------------------------ */

/**
 * A creator's own sponsor (Phase 2, sponsor slots): a deal they made
 * themselves. The money never passes through us; the card we draw for it
 * always says "Paid promotion". Kept apart from the user document, since a
 * handful of logos would otherwise ride along on every signed-in request.
 */
export interface ISponsor extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  line: string;
  url: string;
  code: string;
  category: string;
  /** Inline image, served at /sponsors/:id/logo?v=<logoVersion>. */
  logo: string;
  logoVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const sponsorSchema = new Schema<ISponsor>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, maxlength: 40 },
    line: { type: String, default: "", maxlength: 80 },
    url: { type: String, default: "", maxlength: 300 },
    code: { type: String, default: "", maxlength: 24 },
    category: { type: String, enum: ["everyday", "finance", "crypto", "betting", "alcohol"], default: "everyday" },
    logo: { type: String, default: "" },
    logoVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);
sponsorSchema.index({ ownerId: 1, createdAt: 1 });

export const Sponsor = mongoose.model<ISponsor>("Sponsor", sponsorSchema);

/**
 * An Xtream campaign: the platform's team sets it up, the brand prepays,
 * creators opt in and are paid from the pool — the prepayment less the
 * platform's margin — for each stream that keeps the card up long enough.
 * `spentUsdMinor` only moves with an atomic check against the pool, so the
 * campaign can never pay out more than the brand put in.
 */
export interface ICampaign extends Document {
  name: string;
  line: string;
  url: string;
  code: string;
  category: string;
  logo: string;
  logoVersion: number;
  brief: string;
  cleared: boolean;
  status: "draft" | "live" | "paused" | "ended";
  /** Why it ended: the team ended it, its end date passed, or its pool ran dry. */
  endedReason: "" | "admin" | "date" | "budget";
  startsAt: Date | null;
  endsAt: Date | null;
  streamCategories: string[];
  payPerStreamUsdMinor: number;
  minMinutes: number;
  minViewers: number;
  maxStreamsPerCreator: number;
  brandPaidUsdMinor: number;
  marginPercent: number;
  /** The creators' pool (campaignBudgetMinor). */
  budgetUsdMinor: number;
  spentUsdMinor: number;
  paidStreams: number;
  quest: { minutes: number; reward: string } | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true, maxlength: 40 },
    line: { type: String, default: "", maxlength: 80 },
    url: { type: String, default: "", maxlength: 300 },
    code: { type: String, default: "", maxlength: 24 },
    category: { type: String, enum: ["everyday", "finance", "crypto", "betting", "alcohol"], default: "everyday" },
    logo: { type: String, default: "" },
    logoVersion: { type: Number, default: 0 },
    brief: { type: String, default: "", maxlength: 500 },
    cleared: { type: Boolean, default: false },
    status: { type: String, enum: ["draft", "live", "paused", "ended"], default: "draft" },
    endedReason: { type: String, enum: ["", "admin", "date", "budget"], default: "" },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    streamCategories: { type: [String], default: [] },
    payPerStreamUsdMinor: { type: Number, required: true, min: 100 },
    minMinutes: { type: Number, default: 10, min: 1 },
    minViewers: { type: Number, default: 0, min: 0 },
    maxStreamsPerCreator: { type: Number, default: 4, min: 1 },
    brandPaidUsdMinor: { type: Number, default: 0, min: 0 },
    marginPercent: { type: Number, default: 25, min: 0, max: 90 },
    budgetUsdMinor: { type: Number, default: 0, min: 0 },
    spentUsdMinor: { type: Number, default: 0, min: 0 },
    paidStreams: { type: Number, default: 0, min: 0 },
    quest: {
      type: new Schema({ minutes: { type: Number, required: true }, reward: { type: String, required: true } }, { _id: false }),
      default: null,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
campaignSchema.index({ status: 1, createdAt: -1 });

export const Campaign = mongoose.model<ICampaign>("Campaign", campaignSchema);

/** A creator who opted in to a campaign; `paidStreams` is checked against the per-creator cap atomically. */
export interface ICampaignMember extends Document {
  campaignId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  joinedAt: Date;
  leftAt: Date | null;
  paidStreams: number;
  earnedUsdMinor: number;
}

const campaignMemberSchema = new Schema<ICampaignMember>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null },
    paidStreams: { type: Number, default: 0, min: 0 },
    earnedUsdMinor: { type: Number, default: 0, min: 0 },
  },
  { timestamps: false },
);
campaignMemberSchema.index({ campaignId: 1, userId: 1 }, { unique: true });
campaignMemberSchema.index({ userId: 1, leftAt: 1 });

export const CampaignMember = mongoose.model<ICampaignMember>("CampaignMember", campaignMemberSchema);

/**
 * One sponsor on one broadcast: when its card was on screen while live
 * (closed spans, plus `openSince` while it's up now), and — for a campaign —
 * whether the stream qualified and was paid. The spans are what a sponsored
 * quest counts a viewer's minutes against.
 */
export interface ISponsorRun extends Document {
  streamId: mongoose.Types.ObjectId;
  hostId: mongoose.Types.ObjectId;
  source: "own" | "campaign";
  sponsorId: mongoose.Types.ObjectId;
  /** The sponsor's name when the run began, for the report. */
  name: string;
  openSince: Date | null;
  seconds: number;
  spans: Array<{ from: Date; to: Date }>;
  status: "none" | "counting" | "paying" | "paid" | "unpaid";
  /**
   * Why a campaign run wasn't paid: its card wasn't up long enough (short),
   * the stream's audience fell short (viewers), the creator had had their
   * paid streams (cap), the pool ran dry (budget), they left the campaign,
   * or it ended first.
   */
  unpaidReason: "" | "short" | "viewers" | "cap" | "budget" | "left" | "ended";
  payUsdMinor: number;
  payoutId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const sponsorRunSchema = new Schema<ISponsorRun>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: ["own", "campaign"], required: true },
    sponsorId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, default: "" },
    openSince: { type: Date, default: null },
    seconds: { type: Number, default: 0, min: 0 },
    spans: {
      type: [new Schema({ from: { type: Date, required: true }, to: { type: Date, required: true } }, { _id: false })],
      default: [],
    },
    status: { type: String, enum: ["none", "counting", "paying", "paid", "unpaid"], default: "none" },
    unpaidReason: { type: String, enum: ["", "short", "viewers", "cap", "budget", "left", "ended"], default: "" },
    payUsdMinor: { type: Number, default: 0 },
    payoutId: { type: Schema.Types.ObjectId, ref: "Payout", default: null },
  },
  { timestamps: true },
);
// One run per sponsor per broadcast: the card coming back reopens it.
sponsorRunSchema.index({ streamId: 1, source: 1, sponsorId: 1 }, { unique: true });
sponsorRunSchema.index({ hostId: 1, createdAt: -1 });
sponsorRunSchema.index({ source: 1, sponsorId: 1 });
sponsorRunSchema.index({ status: 1, updatedAt: 1 });
sponsorRunSchema.index({ openSince: 1 }, { partialFilterExpression: { openSince: { $type: "date" } } });

export const SponsorRun = mongoose.model<ISponsorRun>("SponsorRun", sponsorRunSchema);

/**
 * One of a brand's voucher codes, the prize of a sponsored quest. Claimed
 * atomically; a viewer holds at most one per campaign (the partial unique
 * index), however often they press the button.
 */
export interface IVoucher extends Document {
  campaignId: mongoose.Types.ObjectId;
  code: string;
  userId: mongoose.Types.ObjectId | null;
  claimedAt: Date | null;
}

const voucherSchema = new Schema<IVoucher>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    code: { type: String, required: true, maxlength: 64 },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    claimedAt: { type: Date, default: null },
  },
  { timestamps: false },
);
voucherSchema.index({ campaignId: 1, code: 1 }, { unique: true });
voucherSchema.index({ campaignId: 1, claimedAt: 1 });
voucherSchema.index(
  { campaignId: 1, userId: 1 },
  { unique: true, name: "voucher_once", partialFilterExpression: { userId: { $type: "objectId" } } },
);
voucherSchema.index({ userId: 1, claimedAt: -1 }, { partialFilterExpression: { userId: { $type: "objectId" } } });

export const Voucher = mongoose.model<IVoucher>("Voucher", voucherSchema);

/* ------------------------------------------------------------------ */
/* Run of show                                                         */
/* ------------------------------------------------------------------ */

/**
 * A creator's rundown (Phase 3): segments with planned lengths, the
 * prompter's script and each segment's cues (`rundownBodySchema`). One per
 * creator, kept apart from the user document so scripts don't ride along
 * on every signed-in request.
 */
export interface IRundown extends Document {
  ownerId: mongoose.Types.ObjectId;
  segments: Array<Record<string, unknown>>;
  createdAt: Date;
  updatedAt: Date;
}

const rundownSchema = new Schema<IRundown>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    segments: { type: Schema.Types.Mixed, default: () => [] },
  },
  { timestamps: true },
);

export const Rundown = mongoose.model<IRundown>("Rundown", rundownSchema);

/**
 * A show rule (Phase 3): when something happens on the creator's stream,
 * what the scene does (rules.ts). `when` and `then` are validated on the
 * way in (showRuleBodySchema); `firedAt` is claimed atomically, so a rule
 * rests for its cooldown however many API instances see the event.
 */
export interface IShowRule extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  on: boolean;
  when: Record<string, unknown> & { kind: string };
  then: Array<Record<string, unknown> & { do: string }>;
  cooldownSec: number;
  fires: number;
  firedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const showRuleSchema = new Schema<IShowRule>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, default: "", maxlength: 40 },
    on: { type: Boolean, default: true },
    when: { type: Schema.Types.Mixed, required: true },
    then: { type: Schema.Types.Mixed, default: () => [] },
    cooldownSec: { type: Number, default: 10 },
    fires: { type: Number, default: 0 },
    firedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ShowRule = mongoose.model<IShowRule>("ShowRule", showRuleSchema);

/**
 * A control key (Phase 3, control API): what a Stream Deck or a script
 * signs in with. Only the key's SHA-256 is kept; `prefix` tells keys apart.
 */
export interface IControlKey extends Document {
  ownerId: mongoose.Types.ObjectId;
  name: string;
  hash: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const controlKeySchema = new Schema<IControlKey>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, maxlength: 40 },
    hash: { type: String, required: true, unique: true },
    prefix: { type: String, required: true },
    scopes: { type: [String], default: [] },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ControlKey = mongoose.model<IControlKey>("ControlKey", controlKeySchema);

/* ------------------------------------------------------------------ */
/* Call receipts                                                       */
/* ------------------------------------------------------------------ */

/** A call's checkpoint: that minute's closing price and the move since the call, or unavailable (no price for it). */
export interface ICallOutcome {
  price: number | null;
  at: Date;
  changePct: number | null;
  unavailable: boolean;
}

/**
 * A market call made on air (Phase 4, call receipts; calls.ts). What was
 * called, and the price and time it was called at, are the API's own and
 * can't change once written (`immutable`); the checkpoints are filled in
 * once each by the outcome sweep. There's no edit and no delete — only a
 * platform admin can hide a call, and says why.
 */
export interface ICall extends Document {
  streamId: mongoose.Types.ObjectId;
  streamerId: mongoose.Types.ObjectId;
  /** Who pressed it: the host, or one of their producers. */
  createdBy: mongoose.Types.ObjectId;
  /** The channel's name when the call was made — what its card says. */
  by: string;
  symbol: string;
  direction: "up" | "down";
  note: string;
  entry: { price: number; at: Date };
  outcomes: { h1: ICallOutcome | null; h24: ICallOutcome | null; d7: ICallOutcome | null };
  /** When the sweep next looks at it: the first open checkpoint, once its minute has closed. Null once all three are in. */
  nextCheckAt: Date | null;
  /** The ten-minute slot it was made in: a second call on the market racing this one is refused by the unique index. */
  slot: number;
  hidden: { at: Date; by: mongoose.Types.ObjectId; reason: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

const callOutcomeSchema = new Schema<ICallOutcome>(
  {
    price: { type: Number, default: null },
    at: { type: Date, required: true },
    changePct: { type: Number, default: null },
    unavailable: { type: Boolean, default: false },
  },
  { _id: false },
);

const callSchema = new Schema<ICall>(
  {
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true, immutable: true },
    streamerId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    by: { type: String, default: "", maxlength: 80, immutable: true },
    symbol: { type: String, required: true, immutable: true },
    direction: { type: String, enum: ["up", "down"], required: true, immutable: true },
    note: { type: String, default: "", maxlength: 80, immutable: true },
    entry: {
      price: { type: Number, required: true, min: 0, immutable: true },
      at: { type: Date, required: true, immutable: true },
    },
    outcomes: {
      h1: { type: callOutcomeSchema, default: null },
      h24: { type: callOutcomeSchema, default: null },
      d7: { type: callOutcomeSchema, default: null },
    },
    nextCheckAt: { type: Date, default: null },
    slot: { type: Number, required: true, immutable: true },
    hidden: {
      type: new Schema(
        {
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: "User", required: true },
          reason: { type: String, required: true, maxlength: 200 },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);
// A channel's record, newest first; and its calls counted for the limits.
callSchema.index({ streamerId: 1, createdAt: -1 });
callSchema.index({ streamerId: 1, symbol: 1, slot: 1 }, { unique: true });
callSchema.index({ streamId: 1 });
callSchema.index({ nextCheckAt: 1 }, { partialFilterExpression: { nextCheckAt: { $type: "date" } } });

export const Call = mongoose.model<ICall>("Call", callSchema);

/**
 * The host's answer to "How likely are you to recommend Xtream to a
 * friend?", asked once on the post-live report (0–10, NPS). One row per
 * stream — the unique index holds it; tapping another number changes the
 * answer rather than adding a second. Only the stream's host writes it.
 */
export interface IStreamRating extends Document {
  userId: mongoose.Types.ObjectId;
  streamId: mongoose.Types.ObjectId;
  score: number;
  createdAt: Date;
  updatedAt: Date;
}

const streamRatingSchema = new Schema<IStreamRating>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    streamId: { type: Schema.Types.ObjectId, ref: "Stream", required: true },
    score: { type: Number, required: true, min: 0, max: 10 },
  },
  { timestamps: true },
);
streamRatingSchema.index({ streamId: 1 }, { unique: true });
streamRatingSchema.index({ createdAt: -1 });

export const StreamRating = mongoose.model<IStreamRating>("StreamRating", streamRatingSchema);
