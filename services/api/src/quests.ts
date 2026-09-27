import mongoose from "mongoose";
import { ChatMessage, Follow, Game, GameEntry, PointsLedger, QuestClaim, Stream, User, WatchSession } from "./models.js";
import { awardPoints } from "./points.js";
import { audit } from "./rewards.js";

/**
 * The rewards engine, v2 (owner, 2026-09-24: "rewrite the rewards engine").
 *
 * Points still come from watching (the drip and the daily streak), drops
 * and games; redemption to the wallet is unchanged (rewards.ts). What this
 * adds is the part people come back for: quests — a few small things to do
 * each day, bigger ones each week, and one-off milestones — plus levels
 * earned from every point you've ever made, and a seven-day streak strip.
 *
 * Progress is never stored. It's counted from what actually happened —
 * watch sessions, chat, follows, game entries, streams — for the quest's
 * period, every time it's read. There's nothing to keep in sync and nothing
 * to hook into other code paths; a claim re-counts on the server before it
 * pays. Quests never reward spending money (no gift quests), so points stay
 * something you earn, never something you buy.
 */

export type QuestCadence = "daily" | "weekly" | "milestone";

export type QuestMetric =
  | "watch_minutes"
  | "rooms_visited"
  | "chat_messages"
  | "games_entered"
  | "games_won"
  | "watch_days"
  | "follows"
  | "live_minutes"
  | "streak_days"
  | "streams_started"
  | "streams_scheduled";

export interface QuestDef {
  id: string;
  cadence: QuestCadence;
  title: string;
  /** One line of microcopy: what to do, said the way a person would. */
  blurb: string;
  metric: QuestMetric;
  target: number;
  points: number;
  /** How the progress reads: "12 / 30 min". */
  unit: string;
  /** A key the web maps to a glyph. */
  icon: "watch" | "rooms" | "chat" | "predict" | "win" | "streak" | "follow" | "live" | "schedule";
  /** A creator's quest — shown to everyone, done by streaming. */
  creator?: boolean;
}

export const QUESTS: QuestDef[] = [
  // Daily — reset at 00:00 UTC.
  { id: "daily-settle-in", cadence: "daily", title: "Settle in", blurb: "Watch 30 minutes of live today — any room, any time.", metric: "watch_minutes", target: 30, points: 60, unit: "min", icon: "watch" },
  { id: "daily-room-hopper", cadence: "daily", title: "Room hopper", blurb: "Drop into three different live rooms.", metric: "rooms_visited", target: 3, points: 40, unit: "rooms", icon: "rooms" },
  { id: "daily-say-it", cadence: "daily", title: "Say it out loud", blurb: "Send five messages in live chat. Hype counts.", metric: "chat_messages", target: 5, points: 30, unit: "messages", icon: "chat" },
  { id: "daily-call-it", cadence: "daily", title: "Call it", blurb: "Enter a prediction, a raffle or a quiz in any stream.", metric: "games_entered", target: 1, points: 40, unit: "entry", icon: "predict" },
  // Weekly — reset Monday 00:00 UTC.
  { id: "weekly-five-hours", cadence: "weekly", title: "Five-hour week", blurb: "Five hours of live across the week, one room or twenty.", metric: "watch_minutes", target: 300, points: 400, unit: "min", icon: "watch" },
  { id: "weekly-regular", cadence: "weekly", title: "Regular", blurb: "Show up on five different days this week.", metric: "watch_days", target: 5, points: 300, unit: "days", icon: "streak" },
  { id: "weekly-find-your-people", cadence: "weekly", title: "Find your people", blurb: "Follow three creators you haven't followed before.", metric: "follows", target: 3, points: 150, unit: "follows", icon: "follow" },
  { id: "weekly-called-it", cadence: "weekly", title: "Called it", blurb: "Win a prediction, a raffle or a quiz.", metric: "games_won", target: 1, points: 200, unit: "win", icon: "win" },
  { id: "weekly-on-air", cadence: "weekly", title: "On air", blurb: "Stream for an hour this week — one long set or a few short ones.", metric: "live_minutes", target: 60, points: 500, unit: "min", icon: "live", creator: true },
  // Milestones — once, ever.
  { id: "milestone-first-follow", cadence: "milestone", title: "First follow", blurb: "Follow your first creator. Their go-lives land in your notifications.", metric: "follows", target: 1, points: 100, unit: "follow", icon: "follow" },
  { id: "milestone-seven-day-flame", cadence: "milestone", title: "Seven-day flame", blurb: "Watch seven days in a row. Miss one and the count starts again.", metric: "streak_days", target: 7, points: 500, unit: "days", icon: "streak" },
  { id: "milestone-first-broadcast", cadence: "milestone", title: "First broadcast", blurb: "Go live for the first time. Every channel starts with one viewer.", metric: "streams_started", target: 1, points: 300, unit: "stream", icon: "live", creator: true },
  { id: "milestone-book-it", cadence: "milestone", title: "Book it", blurb: "Schedule a stream so your followers can set a reminder.", metric: "streams_scheduled", target: 1, points: 150, unit: "booking", icon: "schedule", creator: true },
];

const DAY_MS = 86_400_000;
/** An open watch session older than this is a forgotten tab, not watching. */
const OPEN_SESSION_CAP_MS = 6 * 3_600_000;

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export interface Period {
  key: string;
  start: Date;
  /** When it resets; null for milestones. */
  end: Date | null;
}

function utcMidnight(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** ISO-8601 week number and its year ("2026-W39"). */
export function isoWeekKey(d: Date) {
  const t = utcMidnight(d);
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function periodFor(cadence: QuestCadence, now = new Date()): Period {
  if (cadence === "milestone") return { key: "once", start: new Date(0), end: null };
  const today = utcMidnight(now);
  if (cadence === "daily") {
    return { key: today.toISOString().slice(0, 10), start: today, end: new Date(today.getTime() + DAY_MS) };
  }
  const monday = new Date(today.getTime() - ((today.getUTCDay() || 7) - 1) * DAY_MS);
  return { key: isoWeekKey(now), start: monday, end: new Date(monday.getTime() + 7 * DAY_MS) };
}

/* ------------------------------------------------------------------ */
/* Levels                                                              */
/* ------------------------------------------------------------------ */

/** Level n needs 250·(n−1)·n/2 lifetime points: 0, 250, 750, 1,500, 2,500… */
export const LEVEL_STEP = 250;

export const TIERS = [
  { from: 1, name: "Spark" },
  { from: 5, name: "Ember" },
  { from: 10, name: "Flame" },
  { from: 20, name: "Blaze" },
  { from: 35, name: "Inferno" },
] as const;

export function thresholdFor(level: number) {
  const n = Math.max(0, level - 1);
  return (LEVEL_STEP * n * (n + 1)) / 2;
}

export function levelFor(xp: number) {
  let level = 1;
  while (xp >= thresholdFor(level + 1)) level++;
  const tier = [...TIERS].reverse().find((t) => level >= t.from)!;
  const nextTier = TIERS.find((t) => t.from > level) ?? null;
  return {
    level,
    tier: tier.name,
    nextTier: nextTier ? { name: nextTier.name, level: nextTier.from } : null,
    xp,
    floor: thresholdFor(level),
    next: thresholdFor(level + 1),
  };
}

/* ------------------------------------------------------------------ */
/* Counting                                                            */
/* ------------------------------------------------------------------ */

type Interval = [number, number];

/** Merge overlapping intervals, so two tabs on two rooms aren't double time. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Whole minutes covered by intervals, clipped to [start, end). */
export function minutesWithin(intervals: Interval[], start: number, end: number) {
  let ms = 0;
  for (const [a, b] of mergeIntervals(intervals)) {
    const lo = Math.max(a, start);
    const hi = Math.min(b, end);
    if (hi > lo) ms += hi - lo;
  }
  return Math.floor(ms / 60_000);
}

/** The UTC days intervals touch, as "YYYY-MM-DD", clipped to [start, end). */
export function daysTouched(intervals: Interval[], start: number, end: number) {
  const days = new Set<string>();
  for (const [a, b] of mergeIntervals(intervals)) {
    let t = utcMidnight(new Date(Math.max(a, start))).getTime();
    const hi = Math.min(b, end);
    while (t < hi) {
      days.add(new Date(t).toISOString().slice(0, 10));
      t += DAY_MS;
    }
  }
  return days;
}

type UserId = mongoose.Types.ObjectId;

async function watchIntervals(userId: UserId, start: Date, end: Date): Promise<{ intervals: Interval[]; rooms: Set<string> }> {
  const now = Date.now();
  const sessions = await WatchSession.find({
    userId,
    joinedAt: { $lt: end, $gte: new Date(start.getTime() - OPEN_SESSION_CAP_MS) },
    $or: [{ leftAt: null }, { leftAt: { $gt: start } }],
  })
    .select("streamId joinedAt leftAt")
    .lean();
  const intervals: Interval[] = [];
  const rooms = new Set<string>();
  for (const s of sessions) {
    const a = new Date(s.joinedAt).getTime();
    const b = s.leftAt ? new Date(s.leftAt).getTime() : Math.min(now, a + OPEN_SESSION_CAP_MS);
    intervals.push([a, b]);
    if (b > start.getTime() && a < end.getTime()) rooms.add(String(s.streamId));
  }
  return { intervals, rooms };
}

/**
 * Counts one metric for one user over a period. `memo` shares the expensive
 * reads (watch sessions) between quests that need the same window.
 */
async function count(metric: QuestMetric, userId: UserId, period: Period, memo: Map<string, Promise<unknown>>): Promise<number> {
  const start = period.start;
  const end = period.end ?? new Date(Date.now() + DAY_MS);
  const window = { $gte: start, $lt: end };
  const once = <T,>(key: string, load: () => Promise<T>) => {
    if (!memo.has(key)) memo.set(key, load());
    return memo.get(key) as Promise<T>;
  };

  switch (metric) {
    case "watch_minutes":
    case "rooms_visited":
    case "watch_days": {
      const w = await once(`watch:${period.key}`, () => watchIntervals(userId, start, end));
      if (metric === "rooms_visited") return w.rooms.size;
      if (metric === "watch_days") return daysTouched(w.intervals, start.getTime(), end.getTime()).size;
      return minutesWithin(w.intervals, start.getTime(), end.getTime());
    }
    case "chat_messages":
      return ChatMessage.countDocuments({ userId, type: "text", createdAt: window });
    case "games_entered": {
      // A vote on a market price doesn't count toward points (see isVote in
      // games.ts): nothing rides on where a price lands until the points
      // question is settled — not even a quest's worth.
      const entries = await GameEntry.find({ userId, createdAt: window }).select("gameId").lean();
      if (entries.length === 0) return 0;
      const markets = await Game.countDocuments({ _id: { $in: entries.map((e) => e.gameId) }, oracle: { $type: "object" } });
      return entries.length - markets;
    }
    case "games_won":
      return GameEntry.countDocuments({ userId, wonPoints: { $gt: 0 }, updatedAt: window });
    case "follows":
      return Follow.countDocuments({ followerId: userId, createdAt: window });
    case "live_minutes": {
      const streams = await Stream.find({
        streamerId: userId,
        status: { $in: ["live", "ended"] },
        startedAt: { $lt: end },
        $or: [{ endedAt: null }, { endedAt: { $gt: start } }],
      })
        .select("startedAt endedAt isLive")
        .lean();
      const now = Date.now();
      const intervals: Interval[] = streams.map((s) => [
        new Date(s.startedAt).getTime(),
        s.endedAt ? new Date(s.endedAt).getTime() : s.isLive ? now : new Date(s.startedAt).getTime(),
      ]);
      return minutesWithin(intervals, start.getTime(), end.getTime());
    }
    case "streak_days": {
      const u = await once("user:streak", () => User.findById(userId).select("watchStreakDays lastWatchDay").lean());
      return (u as { watchStreakDays?: number } | null)?.watchStreakDays ?? 0;
    }
    case "streams_started":
      return Stream.countDocuments({ streamerId: userId, status: { $in: ["live", "ended"] } });
    case "streams_scheduled":
      return Stream.countDocuments({ streamerId: userId, scheduledStartAt: { $ne: null } });
  }
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export interface QuestView {
  id: string;
  cadence: QuestCadence;
  title: string;
  blurb: string;
  icon: QuestDef["icon"];
  unit: string;
  target: number;
  /** Capped at the target. */
  progress: number;
  points: number;
  claimed: boolean;
  claimable: boolean;
  /** ISO time the quest resets; null for milestones. */
  resetsAt: string | null;
  creator: boolean;
}

export async function questViews(userId: UserId, now = new Date()): Promise<QuestView[]> {
  const memo = new Map<string, Promise<unknown>>();
  const periods = new Map(QUESTS.map((q) => [q.id, periodFor(q.cadence, now)]));
  const claims = await QuestClaim.find({
    userId,
    $or: QUESTS.map((q) => ({ questId: q.id, periodKey: periods.get(q.id)!.key })),
  })
    .select("questId")
    .lean();
  const claimed = new Set(claims.map((c) => c.questId));
  return Promise.all(
    QUESTS.map(async (q) => {
      const period = periods.get(q.id)!;
      const raw = await count(q.metric, userId, period, memo);
      const progress = Math.min(q.target, raw);
      const isClaimed = claimed.has(q.id);
      return {
        id: q.id,
        cadence: q.cadence,
        title: q.title,
        blurb: q.blurb,
        icon: q.icon,
        unit: q.unit,
        target: q.target,
        progress,
        points: q.points,
        claimed: isClaimed,
        claimable: !isClaimed && progress >= q.target,
        resetsAt: period.end ? period.end.toISOString() : null,
        creator: Boolean(q.creator),
      };
    }),
  );
}

/** Every point ever earned (refunds and adjustments aside) — the XP behind levels. */
export async function lifetimePoints(userId: UserId) {
  const r = await PointsLedger.aggregate<{ _id: null; total: number }>([
    { $match: { userId, delta: { $gt: 0 }, reason: { $nin: ["game_refund", "adjust"] } } },
    { $group: { _id: null, total: { $sum: "$delta" } } },
  ]);
  return r[0]?.total ?? 0;
}

/** The last seven UTC days, oldest first, and whether you watched on each. */
export async function streakWeek(userId: UserId, now = new Date()) {
  const end = new Date(utcMidnight(now).getTime() + DAY_MS);
  const start = new Date(end.getTime() - 7 * DAY_MS);
  const { intervals } = await watchIntervals(userId, start, end);
  const active = daysTouched(intervals, start.getTime(), end.getTime());
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    return { day, active: active.has(day) };
  });
}

/* ------------------------------------------------------------------ */
/* Claiming                                                            */
/* ------------------------------------------------------------------ */

export class QuestError extends Error {
  constructor(
    public code: "UNKNOWN_QUEST" | "NOT_READY" | "ALREADY_CLAIMED",
    message: string,
  ) {
    super(message);
    this.name = "QuestError";
  }
}

/**
 * Pay a finished quest. Progress is re-counted here — the client's view is
 * never trusted — then the claim row is written (its unique index stops a
 * double claim, however many taps land at once), and only then do points
 * move. If the award fails, the claim is removed so it can be retried.
 */
export async function claimQuest(userId: UserId, questId: string, now = new Date()) {
  const quest = QUESTS.find((q) => q.id === questId);
  if (!quest) throw new QuestError("UNKNOWN_QUEST", "That quest doesn't exist");
  const period = periodFor(quest.cadence, now);
  const progress = await count(quest.metric, userId, period, new Map());
  if (progress < quest.target) throw new QuestError("NOT_READY", "Not finished yet");

  let claim;
  try {
    claim = await QuestClaim.create({ userId, questId, periodKey: period.key, points: quest.points });
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new QuestError("ALREADY_CLAIMED", "Already claimed");
    throw error;
  }
  try {
    const balance = await awardPoints(userId, quest.points, "quest", claim._id as mongoose.Types.ObjectId);
    await audit(userId, "quest.claim", "quest", claim._id as mongoose.Types.ObjectId, { questId, periodKey: period.key, points: quest.points });
    return { quest, periodKey: period.key, balance };
  } catch (error) {
    await QuestClaim.deleteOne({ _id: claim._id }).catch(() => {});
    throw error;
  }
}

/** How many quests are finished and waiting — the points chip's dot. */
export async function readyCount(userId: UserId) {
  const views = await questViews(userId);
  return views.filter((v) => v.claimable).length;
}
