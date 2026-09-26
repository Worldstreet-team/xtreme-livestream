import type mongoose from "mongoose";
import { ChatMessage, GiftTransaction, Stream, User, WatchSession } from "./models.js";

/**
 * Status that isn't pay-only (Phase 2, goals and status). Two readings,
 * both computed on read from what's already recorded — watch sessions,
 * chat and gifts — so there's no counter to drift and no job to decay it:
 *
 * - A stream's top fans: this broadcast's score, where a minute watched is
 *   worth 1, a chat line 3 (the first 60 count) and a dollar gifted 5. A
 *   viewer who stays and talks can top someone who only paid.
 * - A viewer's fan level with a channel, 1–10: the same score over the
 *   last 60 days, each day's share halving every 14 days — so a level is
 *   kept by coming back, not bought once. Watch time all-time earns a
 *   badge at 10, 50 and 100 hours.
 */

export const FAN_SCORE = { perMinute: 1, perChat: 3, chatCap: 60, perDollar: 5 } as const;
export const FAN_WINDOW_DAYS = 60;
export const FAN_HALF_LIFE_DAYS = 14;
export const FAN_MAX_LEVEL = 10;
/** Watch-time badges, in hours with the channel. */
export const WATCH_BADGE_HOURS = [10, 50, 100] as const;

const DAY_MS = 86_400_000;
type Id = mongoose.Types.ObjectId;

/** One stream's score for what someone did in it. */
export function fanScore({ minutes, chats, giftsMinor }: { minutes: number; chats: number; giftsMinor: number }) {
  return Math.round(
    minutes * FAN_SCORE.perMinute + Math.min(chats, FAN_SCORE.chatCap) * FAN_SCORE.perChat + (giftsMinor / 100) * FAN_SCORE.perDollar,
  );
}

/** The level a (decayed) score reaches: level n from 30·n² — 30, 120, 270 … 3,000 for 10. */
export function fanLevel(xp: number) {
  let level = 0;
  while (level < FAN_MAX_LEVEL && xp >= 30 * (level + 1) ** 2) level += 1;
  return level;
}

/** A day's share of the score, halving every two weeks. */
export function decay(ageMs: number) {
  return 0.5 ** (Math.max(0, ageMs) / (FAN_HALF_LIFE_DAYS * DAY_MS));
}

/** The watch-time badge earned so far: 0, or 10 / 50 / 100 (hours). */
export function watchBadge(hours: number) {
  return [...WATCH_BADGE_HOURS].reverse().find((h) => hours >= h) ?? 0;
}

const watchedMs = (now: number) => ({ $subtract: [{ $ifNull: ["$leftAt", new Date(now)] }, "$joinedAt"] });

/**
 * This broadcast's top fans: score, and what made it. The host isn't on
 * their own board.
 */
export async function streamFans(stream: { _id: Id; streamerId: Id }, { limit = 10, now = Date.now() } = {}) {
  const [watch, chats, gifts] = await Promise.all([
    WatchSession.aggregate<{ _id: Id; ms: number }>([
      { $match: { streamId: stream._id } },
      { $group: { _id: "$userId", ms: { $sum: watchedMs(now) } } },
    ]),
    ChatMessage.aggregate<{ _id: Id; n: number }>([
      { $match: { streamId: stream._id, type: "text", status: { $ne: "held" } } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]),
    GiftTransaction.aggregate<{ _id: Id; minor: number }>([
      { $match: { streamId: stream._id } },
      { $group: { _id: "$senderId", minor: { $sum: "$grossUsdMinor" } } },
    ]),
  ]);

  const rows = new Map<string, { minutes: number; chats: number; giftsMinor: number }>();
  const row = (id: Id) => {
    const key = String(id);
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { minutes: 0, chats: 0, giftsMinor: 0 }));
    return r;
  };
  watch.forEach((w) => (row(w._id).minutes = Math.floor(Math.max(0, w.ms) / 60_000)));
  chats.forEach((c) => (row(c._id).chats = c.n));
  gifts.forEach((g) => (row(g._id).giftsMinor = g.minor));
  rows.delete(String(stream.streamerId));

  const ranked = [...rows.entries()]
    .map(([userId, r]) => ({ userId, ...r, score: fanScore(r) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const users = await User.find({ _id: { $in: ranked.map((r) => r.userId) } })
    .select("username displayName avatar")
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return ranked.flatMap((r) => {
    const u = byId.get(r.userId);
    return u ? [{ ...r, username: u.username, displayName: u.displayName || u.username, avatar: u.avatar ?? "" }] : [];
  });
}

type Board = Awaited<ReturnType<typeof streamFans>>;
const BOARD_MS = 15_000;
const boards = new Map<string, { at: number; board: Board }>();
const building = new Map<string, Promise<Board>>();

/**
 * The board as the watch page reads it — every viewer polls it, so it's
 * worked out once per 15 s per stream, and one reading at a time.
 */
export async function cachedStreamFans(stream: { _id: Id; streamerId: Id }, now = Date.now()) {
  const key = String(stream._id);
  const hit = boards.get(key);
  if (hit && now - hit.at < BOARD_MS) return hit.board;
  let pending = building.get(key);
  if (!pending) {
    pending = streamFans(stream, { now })
      .then((board) => {
        boards.set(key, { at: Date.now(), board });
        return board;
      })
      .finally(() => building.delete(key));
    building.set(key, pending);
  }
  return pending;
}

export function clearFanBoards() {
  boards.clear();
  building.clear();
}

export interface FanStatus {
  level: number;
  /** Hours watched with the channel, all time. */
  hours: number;
  /** The watch-time badge earned: 0, 10, 50 or 100. */
  badge: number;
}

// A viewer's level barely moves between two of their chat lines: a few
// minutes' cache keeps chat from re-reading their history each message.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { status: FanStatus; at: number }>();

/** Forget cached levels (tests; or after a change that should show at once). */
export function clearFanCache() {
  cache.clear();
}

/**
 * Where each of these viewers stands with a channel. One read per source
 * for the lot — a page of chat history asks for its authors together.
 */
export async function fanStatuses(channelId: Id, userIds: Id[], now = Date.now()): Promise<Map<string, FanStatus>> {
  const out = new Map<string, FanStatus>();
  const missing: Id[] = [];
  for (const id of userIds) {
    const key = `${String(channelId)}:${String(id)}`;
    if (String(id) === String(channelId)) continue;
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_MS) out.set(String(id), hit.status);
    else if (!missing.some((m) => String(m) === String(id))) missing.push(id);
  }
  if (missing.length === 0) return out;

  const since = new Date(now - FAN_WINDOW_DAYS * DAY_MS);
  const day = (field: string) => ({ $dateTrunc: { date: field, unit: "day" } });
  const recentStreams = await Stream.find({ streamerId: channelId, startedAt: { $gte: since } }).select("_id").lean();

  const [hours, watchDays, chatDays, giftDays] = await Promise.all([
    WatchSession.aggregate<{ _id: Id; ms: number }>([
      { $match: { streamerId: channelId, userId: { $in: missing } } },
      { $group: { _id: "$userId", ms: { $sum: watchedMs(now) } } },
    ]),
    WatchSession.aggregate<{ _id: { u: Id; d: Date }; ms: number }>([
      { $match: { streamerId: channelId, userId: { $in: missing }, joinedAt: { $gte: since } } },
      { $group: { _id: { u: "$userId", d: day("$joinedAt") }, ms: { $sum: watchedMs(now) } } },
    ]),
    recentStreams.length
      ? ChatMessage.aggregate<{ _id: { u: Id; d: Date }; n: number }>([
          {
            $match: {
              streamId: { $in: recentStreams.map((s) => s._id) },
              userId: { $in: missing },
              type: "text",
              createdAt: { $gte: since },
            },
          },
          { $group: { _id: { u: "$userId", d: day("$createdAt") }, n: { $sum: 1 } } },
        ])
      : Promise.resolve([]),
    GiftTransaction.aggregate<{ _id: { u: Id; d: Date }; minor: number }>([
      { $match: { streamerId: channelId, senderId: { $in: missing }, createdAt: { $gte: since } } },
      { $group: { _id: { u: "$senderId", d: day("$createdAt") }, minor: { $sum: "$grossUsdMinor" } } },
    ]),
  ]);

  // Each day scores like a stream would, then fades with its age.
  const days = new Map<string, Map<number, { minutes: number; chats: number; giftsMinor: number }>>();
  const slot = (u: Id, d: Date) => {
    const perUser = days.get(String(u)) ?? new Map();
    days.set(String(u), perUser);
    const t = new Date(d).getTime();
    const s = perUser.get(t) ?? { minutes: 0, chats: 0, giftsMinor: 0 };
    perUser.set(t, s);
    return s;
  };
  watchDays.forEach((w) => (slot(w._id.u, w._id.d).minutes += Math.max(0, w.ms) / 60_000));
  chatDays.forEach((c) => (slot(c._id.u, c._id.d).chats += c.n));
  giftDays.forEach((g) => (slot(g._id.u, g._id.d).giftsMinor += g.minor));
  const hoursBy = new Map(hours.map((h) => [String(h._id), Math.max(0, h.ms) / 3_600_000]));

  for (const id of missing) {
    let xp = 0;
    for (const [t, s] of days.get(String(id)) ?? []) xp += fanScore(s) * decay(now - t);
    const h = Math.floor(hoursBy.get(String(id)) ?? 0);
    const status: FanStatus = { level: fanLevel(xp), hours: h, badge: watchBadge(h) };
    cache.set(`${String(channelId)}:${String(id)}`, { status, at: now });
    out.set(String(id), status);
  }
  return out;
}

/** One viewer's standing, or null for the host (or anyone who isn't a person we know). */
export async function fanStatus(channelId: Id, userId: Id, now = Date.now()) {
  if (!userId || String(userId) === String(channelId)) return null;
  return (await fanStatuses(channelId, [userId], now)).get(String(userId)) ?? null;
}
