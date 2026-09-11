import mongoose from "mongoose";
import {
  Follow,
  Stream,
  StreamReminder,
  User,
  WatchSession,
} from "./models.js";
import { thumbnailUrlFor } from "./stream-service.js";

/**
 * The rows engine.
 *
 * A page is an ordered list of rows, and each row is owned by exactly one
 * rule — followed-live is a follow-graph lookup, trending is a velocity
 * sort, "because you watch" is a watch-history aggregate, co-viewership is
 * an audience-overlap join. Rows are chosen greedily against the page built
 * so far: a stream shown in one row is withheld from the rows below it, and
 * a row that would repeat the category the previous row was mostly about is
 * pushed down. That is the cheap version of what Netflix describes as
 * stage-wise page construction, and it is what stops the page from being
 * four variations of the viewer's single biggest interest.
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;
const ROW_LIMIT = 12;
const MIN_ROW_ITEMS = 3;
/** Streams above this fraction of the live median are not "small". */
const SMALL_STREAM_QUANTILE = 0.5;
/** Velocity below this is noise, not a trend. */
const TRENDING_FLOOR = 0.15;

const CARD_SELECT = "-thumbnail";
const STREAMER_POPULATE = {
  path: "streamerId",
  select: "username displayName avatar isLive verified",
} as const;

export type RowKind = "streams" | "upcoming" | "channels";

export interface RowStreamer {
  _id: unknown;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  verified?: boolean;
}

export interface RowItem {
  _id: unknown;
  title: string;
  category: string;
  tags: string[];
  thumbnailUrl: string | null;
  previewUrl: string | null;
  isLive: boolean;
  status: string;
  viewers: number;
  peakViewers: number;
  velocity: number;
  startedAt: Date | null;
  endedAt: Date | null;
  scheduledStartAt: Date | null;
  duration: string;
  streamerId: RowStreamer;
  /** Only on upcoming items for a signed-in viewer. */
  reminded?: boolean;
}

export interface HomeRow {
  id: string;
  title: string;
  /** The evidence line under the title — "Because you watch Crypto Markets". */
  reason?: string;
  kind: RowKind;
  /** Impressions from this row are exploration traffic, not ranker output. */
  explore?: boolean;
  items: RowItem[];
}

export interface HomeLead {
  /** Why this item leads — rendered as its label. */
  reason: "followed" | "trending" | "rising" | "popular";
  item: RowItem;
}

export interface HomePage {
  rows: HomeRow[];
  /** Up to three distinct leads, in priority order, for the hero or lead row. */
  leads: HomeLead[];
}

type LeanStream = Record<string, unknown> & {
  _id: unknown;
  streamerId: RowStreamer | unknown;
};

export function toItem(s: LeanStream): RowItem {
  const streamer = (s.streamerId ?? {}) as RowStreamer;
  return {
    _id: s._id,
    title: String(s.title ?? ""),
    category: String(s.category ?? ""),
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    thumbnailUrl: thumbnailUrlFor(
      s as { _id: unknown; thumbnail?: string; thumbnailVersion?: number },
    ),
    previewUrl: typeof s.previewUrl === "string" && s.previewUrl ? s.previewUrl : null,
    isLive: Boolean(s.isLive),
    status: String(s.status ?? (s.isLive ? "live" : "ended")),
    viewers: Number(s.viewers ?? 0),
    peakViewers: Number(s.peakViewers ?? 0),
    velocity: Number(s.velocity ?? 0),
    startedAt: (s.startedAt as Date | null) ?? null,
    endedAt: (s.endedAt as Date | null) ?? null,
    scheduledStartAt: (s.scheduledStartAt as Date | null) ?? null,
    duration: String(s.duration ?? ""),
    streamerId: {
      _id: streamer._id,
      username: streamer.username ?? "",
      displayName: streamer.displayName ?? "",
      avatar: streamer.avatar ?? "",
      isLive: Boolean(streamer.isLive),
      verified: streamer.verified ?? false,
    },
  };
}

async function liveStreams(
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
  limit = ROW_LIMIT,
) {
  const rows = await Stream.find({ isLive: true, ...filter })
    .sort(sort)
    .limit(limit)
    .select(CARD_SELECT)
    .populate(STREAMER_POPULATE)
    .lean();
  return (rows as unknown as LeanStream[]).map(toItem);
}

/* ------------------------------------------------------------------ */
/* Per-viewer signals                                                  */
/* ------------------------------------------------------------------ */

async function followedIds(userId: mongoose.Types.ObjectId) {
  const follows = await Follow.find({ followerId: userId })
    .select("followingId")
    .lean();
  return follows.map((f) => f.followingId);
}

/** Streamers this viewer has watched recently, most-watched first. */
async function watchedStreamers(userId: mongoose.Types.ObjectId, limit = 50) {
  const rows = await WatchSession.aggregate<{ _id: unknown; sessions: number }>([
    {
      $match: {
        userId,
        joinedAt: { $gte: new Date(Date.now() - THIRTY_DAYS_MS) },
      },
    },
    { $group: { _id: "$streamerId", sessions: { $sum: 1 } } },
    { $sort: { sessions: -1 } },
    { $limit: limit },
  ]);
  return rows.map((r) => r._id as mongoose.Types.ObjectId);
}

/** The category this viewer spends the most sessions in, if there is one. */
async function topCategory(userId: mongoose.Types.ObjectId) {
  const rows = await WatchSession.aggregate<{ _id: string; sessions: number }>([
    {
      $match: {
        userId,
        category: { $ne: "" },
        joinedAt: { $gte: new Date(Date.now() - THIRTY_DAYS_MS) },
      },
    },
    { $group: { _id: "$category", sessions: { $sum: 1 } } },
    { $sort: { sessions: -1 } },
    { $limit: 1 },
  ]);
  const top = rows[0];
  return top && top.sessions >= 2 ? top._id : null;
}

/* ------------------------------------------------------------------ */
/* Co-viewership                                                       */
/* ------------------------------------------------------------------ */

/**
 * Streamers watched by the people who watch this one — the retrieval that
 * is size-agnostic by construction. It asks "who else do these particular
 * viewers watch", and the answer is frequently someone small, because it
 * never consults the viewer count at all.
 */
export async function alsoWatchedStreamers(
  streamerId: mongoose.Types.ObjectId,
  limit = 40,
) {
  const since = new Date(Date.now() - THIRTY_DAYS_MS);

  // The audience: recent viewers of this channel. Capped so a very large
  // channel doesn't turn this into a full-collection join.
  const audience = await WatchSession.aggregate<{ _id: unknown }>([
    { $match: { streamerId, joinedAt: { $gte: since } } },
    { $group: { _id: "$userId" } },
    { $limit: 2000 },
  ]);
  if (audience.length === 0) return [] as mongoose.Types.ObjectId[];

  const overlap = await WatchSession.aggregate<{ _id: unknown; viewers: number }>([
    {
      $match: {
        userId: { $in: audience.map((a) => a._id) },
        streamerId: { $ne: streamerId },
        joinedAt: { $gte: since },
      },
    },
    { $group: { _id: "$streamerId", users: { $addToSet: "$userId" } } },
    { $project: { viewers: { $size: "$users" } } },
    { $sort: { viewers: -1 } },
    { $limit: limit },
  ]);
  return overlap.map((o) => o._id as mongoose.Types.ObjectId);
}

/** Live streams from co-viewed channels, kept in overlap order. */
export async function alsoWatchedLive(
  streamerId: mongoose.Types.ObjectId,
  limit = ROW_LIMIT,
) {
  const ids = await alsoWatchedStreamers(streamerId);
  if (ids.length === 0) return [] as RowItem[];
  const order = new Map(ids.map((id, i) => [String(id), i]));
  const items = await liveStreams({ streamerId: { $in: ids } }, { viewers: -1 }, limit * 2);
  return items
    .sort(
      (a, b) =>
        (order.get(String(a.streamerId._id)) ?? 1e9) -
        (order.get(String(b.streamerId._id)) ?? 1e9),
    )
    .slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Exploration                                                         */
/* ------------------------------------------------------------------ */

/**
 * Small, recent streams sampled at random — not ranked. Relative growth is
 * near-unpredictable from popularity (about 0.55 AUC in the literature), so
 * the only way to find the next breakout is to show some candidates the
 * ranker never would. Impressions from this row are tagged so the randomised
 * traffic can be evaluated on its own.
 */
export async function risingSample(limit = 8, exclude: unknown[] = []) {
  const live = await Stream.find({ isLive: true }).select("viewers").lean();
  if (live.length < 4) return [] as RowItem[];

  const sorted = live.map((s) => s.viewers).sort((a, b) => a - b);
  const cutoff = sorted[Math.floor(sorted.length * SMALL_STREAM_QUANTILE)] ?? 0;

  const rows = await Stream.aggregate<{ _id: unknown }>([
    {
      $match: {
        isLive: true,
        viewers: { $lte: Math.max(cutoff, 1) },
        _id: { $nin: exclude.map((id) => new mongoose.Types.ObjectId(String(id))) },
      },
    },
    { $sample: { size: limit } },
    { $project: { _id: 1 } },
  ]);
  if (rows.length === 0) return [] as RowItem[];

  const items = await liveStreams(
    { _id: { $in: rows.map((r) => r._id) } },
    { startedAt: -1 },
    limit,
  );
  // $sample already randomised; preserve that order rather than re-sorting
  // by anything that correlates with size.
  const order = new Map(rows.map((r, i) => [String(r._id), i]));
  return items.sort(
    (a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0),
  );
}

/* ------------------------------------------------------------------ */
/* Upcoming                                                            */
/* ------------------------------------------------------------------ */

async function upcomingStreams(
  filter: Record<string, unknown>,
  limit = ROW_LIMIT,
  userId: mongoose.Types.ObjectId | null = null,
) {
  const now = Date.now();
  const rows = await Stream.find({
    status: "upcoming",
    // Streams whose scheduled time passed an hour ago without going live are
    // stale promises; hide them rather than show a countdown to the past.
    scheduledStartAt: {
      $gte: new Date(now - 60 * 60_000),
      $lte: new Date(now + 7 * 24 * 60 * 60_000),
    },
    ...filter,
  })
    .sort({ scheduledStartAt: 1 })
    .limit(limit)
    .select(CARD_SELECT)
    .populate(STREAMER_POPULATE)
    .lean();
  const items = (rows as unknown as LeanStream[]).map(toItem);

  if (userId && items.length > 0) {
    const reminders = await StreamReminder.find({
      userId,
      streamId: { $in: items.map((i) => i._id as mongoose.Types.ObjectId) },
    })
      .select("streamId")
      .lean();
    const set = new Set(reminders.map((r) => String(r.streamId)));
    for (const item of items) item.reminded = set.has(String(item._id));
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Page assembly                                                       */
/* ------------------------------------------------------------------ */

function dominantCategory(items: RowItem[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [c, k] of counts) if (k > n) [best, n] = [c, k];
  return { category: best, share: items.length ? n / items.length : 0 };
}

export interface Candidate {
  row: Omit<HomeRow, "items">;
  items: RowItem[];
  /** Personal rows are never demoted for repeating a category. */
  personal?: boolean;
  minItems?: number;
}

export function assembleRows(candidates: Candidate[]): HomeRow[] {
  const seen = new Set<string>();
  const out: HomeRow[] = [];
  let previous = { category: "", share: 0 };
  const queue = [...candidates];

  while (queue.length > 0) {
    const c = queue.shift()!;
    const items = c.items.filter((i) => !seen.has(String(i._id)));
    const min = c.minItems ?? MIN_ROW_ITEMS;
    if (items.length < min) continue;

    // A row mostly about what the previous row was mostly about would read
    // as the same row twice. Push it down once and let something else in;
    // if nothing else is left it runs anyway.
    const dom = dominantCategory(items);
    const repeats =
      !c.personal &&
      c.row.kind === "streams" &&
      previous.share >= 0.6 &&
      dom.share >= 0.6 &&
      dom.category === previous.category;
    if (repeats && queue.length > 0 && !("demoted" in c)) {
      queue.push({ ...c, demoted: true } as Candidate);
      continue;
    }

    const trimmed = items.slice(0, ROW_LIMIT);
    trimmed.forEach((i) => seen.add(String(i._id)));
    out.push({ ...c.row, items: trimmed });
    previous = dom;
  }
  return out;
}

export function pickLeads(rows: HomeRow[]): HomeLead[] {
  const leads: HomeLead[] = [];
  const used = new Set<string>();
  const take = (id: string, reason: HomeLead["reason"]) => {
    const row = rows.find((r) => r.id === id);
    const item = row?.items.find((i) => !used.has(String(i._id)));
    if (item) {
      used.add(String(item._id));
      leads.push({ reason, item });
    }
  };
  take("followed-live", "followed");
  take("trending", "trending");
  take("rising", "rising");
  if (leads.length < 3) take("popular", "popular");
  if (leads.length < 3) take("continue", "followed");
  return leads.slice(0, 3);
}

export async function buildHomePage(
  userId: mongoose.Types.ObjectId | null,
): Promise<HomePage> {
  const candidates: Candidate[] = [];

  if (userId) {
    const [followed, watched, category, user] = await Promise.all([
      followedIds(userId),
      watchedStreamers(userId),
      topCategory(userId),
      User.findById(userId).select("onboarding").lean(),
    ]);

    const [followedLive, continueLive, trending, catLive, upcomingFollowed] =
      await Promise.all([
        followed.length
          ? liveStreams({ streamerId: { $in: followed } }, { viewers: -1 })
          : [],
        watched.length
          ? liveStreams({ streamerId: { $in: watched } }, { viewers: -1 })
          : [],
        liveStreams(
          { velocity: { $gte: TRENDING_FLOOR } },
          { velocity: -1, viewers: -1 },
        ),
        category ? liveStreams({ category }, { viewers: -1 }) : [],
        followed.length
          ? upcomingStreams({ streamerId: { $in: followed } }, ROW_LIMIT, userId)
          : [],
      ]);

    // Co-viewership seeds from the channel this viewer watches most; fall
    // back to their top follow so a light watcher still gets the row.
    const seed = watched[0] ?? followed[0] ?? null;
    const also = seed ? await alsoWatchedLive(seed) : [];
    const seedName = seed
      ? (
          await User.findById(seed).select("displayName username").lean()
        )?.displayName
      : null;

    // A brand-new account with picker choices but no history: honour the
    // picks until behaviour takes over.
    const picked =
      !category && user?.onboarding?.categories?.length
        ? await liveStreams(
            { category: { $in: user.onboarding.categories } },
            { viewers: -1 },
          )
        : [];

    candidates.push(
      {
        row: { id: "followed-live", title: "Live from channels you follow", kind: "streams" },
        items: followedLive,
        personal: true,
        minItems: 1,
      },
      {
        row: {
          id: "continue",
          title: "Back on air",
          reason: "Channels you've watched before, live now",
          kind: "streams",
        },
        items: continueLive,
        personal: true,
        minItems: 2,
      },
      {
        row: { id: "trending", title: "Trending now", reason: "Growing fastest in the last ten minutes", kind: "streams" },
        items: trending,
      },
      {
        row: {
          id: "top-category",
          title: category ?? "Picked for you",
          reason: category ? `Because you watch ${category}` : "From the topics you picked",
          kind: "streams",
        },
        items: category ? catLive : picked,
        personal: true,
      },
      {
        row: {
          id: "also-watched",
          title: "Viewers also watch",
          ...(seedName
            ? { reason: `People who watch ${seedName} also watch these` }
            : {}),
          kind: "streams",
        },
        items: also,
        personal: true,
      },
      {
        row: { id: "upcoming-followed", title: "Coming up from your channels", kind: "upcoming" },
        items: upcomingFollowed,
        personal: true,
        minItems: 1,
      },
    );
  } else {
    const trending = await liveStreams(
      { velocity: { $gte: TRENDING_FLOOR } },
      { velocity: -1, viewers: -1 },
    );
    candidates.push({
      row: { id: "trending", title: "Trending now", reason: "Growing fastest in the last ten minutes", kind: "streams" },
      items: trending,
    });
  }

  const alreadyPlaced = candidates.flatMap((c) => c.items.map((i) => i._id));
  const [rising, popular, upcomingSoon] = await Promise.all([
    risingSample(8, alreadyPlaced),
    liveStreams({}, { viewers: -1 }, 20),
    upcomingStreams({}, ROW_LIMIT, userId),
  ]);

  candidates.push(
    {
      row: {
        id: "rising",
        title: "Rising",
        reason: "Small streams worth a look — chosen for you to discover, not by size",
        kind: "streams",
        explore: true,
      },
      items: rising,
      personal: true,
    },
    {
      row: { id: "upcoming", title: "Starting soon", kind: "upcoming" },
      items: upcomingSoon,
      minItems: 1,
    },
    {
      row: { id: "popular", title: "Popular right now", kind: "streams" },
      items: popular,
      personal: true,
      minItems: 1,
    },
  );

  const rows = assembleRows(candidates);
  return { rows, leads: pickLeads(rows) };
}
