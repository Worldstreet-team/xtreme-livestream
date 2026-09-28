import type mongoose from "mongoose";
import type { StreamAnalytics } from "@xtreme/contracts";
import { streamAnalytics } from "./analytics.js";
import { GiftTransaction, PointsLedger, Stream, StreamRating } from "./models.js";
import { isoWeekKey, levelFor, lifetimePoints, questViews, type QuestView } from "./quests.js";
import { thumbnailUrlFor } from "./stream-service.js";

/**
 * The post-live report: what the host sees the moment they press End, and
 * again from Your channel's Recent broadcasts. Everything in it is read
 * from what already happened — the broadcast's analytics (analytics.ts),
 * the gifts it took, the points the host made while on air, the quests
 * and levels (quests.ts, computed on read) and a weekly streak of going
 * live — so there's nothing new to keep in step. A practice run gets the
 * same report without money in it.
 */

type Id = mongoose.Types.ObjectId;

const WEEK_MS = 7 * 86_400_000;
/** How far back a streak is counted. A year of weeks in a row is plenty to say. */
const STREAK_WEEKS = 53;
/** Points that aren't earnings: a refunded stake, an admin's adjustment. */
const NOT_EARNED = ["game_refund", "adjust"];

export type ReportTone = "good" | "quiet" | "practice";

/**
 * Was it a good stream? Generous on purpose: any one sign that people came
 * and cared — a handful watching, a new ally, a gift, a chat that got
 * going — earns the celebration. Otherwise the report is calm and
 * encouraging, never a verdict.
 */
export function reportTone(summary: Pick<StreamAnalytics["summary"], "peakViewers" | "newAllies" | "gifters" | "chats">, practice: boolean): ReportTone {
  if (practice) return "practice";
  const good = summary.peakViewers >= 5 || summary.newAllies >= 1 || summary.gifters >= 1 || summary.chats >= 10;
  return good ? "good" : "quiet";
}

export interface BestMinute {
  minute: number;
  viewers: number;
  chats: number;
  giftsMinor: number;
  /** What was marked that minute (a segment, a guest, a big gift…), if anything. */
  label: string | null;
}

/**
 * The broadcast's best minute: the most people in the room, with chat and
 * gifts counting extra (a line is worth two viewers, a dollar one). The
 * first such minute wins a tie. Null when no minute had anything in it.
 */
export function bestMinute(a: Pick<StreamAnalytics, "minutes" | "moments">): BestMinute | null {
  let best = -1;
  let top = 0;
  a.minutes.forEach((m, i) => {
    const score = m.viewers + m.chats * 2 + m.giftsMinor / 100;
    if (score > top) {
      top = score;
      best = i;
    }
  });
  if (best < 0) return null;
  const m = a.minutes[best]!;
  const moment = a.moments.find((x) => x.minute === best && x.kind !== "peak");
  return { minute: best, viewers: m.viewers, chats: m.chats, giftsMinor: m.giftsMinor, label: moment?.label ?? null };
}

/**
 * Weeks in a row with at least one real broadcast, counting back from this
 * one. A week that hasn't had its broadcast yet doesn't break the run
 * until it's over.
 */
export function weeksInARow(startedAt: Date[], now = new Date()): number {
  const weeks = new Set(startedAt.map((d) => isoWeekKey(d)));
  let count = 0;
  let at = now.getTime();
  if (!weeks.has(isoWeekKey(new Date(at)))) at -= WEEK_MS;
  while (count < STREAK_WEEKS && weeks.has(isoWeekKey(new Date(at)))) {
    count++;
    at -= WEEK_MS;
  }
  return count;
}

export interface NextStep {
  kind: "claim" | "quest" | "book" | "streak";
  /** The line, said the way a person would. */
  text: string;
  /** Where acting on it happens. */
  href: string | null;
  /** A quest's bar, when the step is one. */
  progress?: number;
  target?: number;
  unit?: string;
  points?: number;
}

/**
 * The one next thing worth doing, in order: points waiting to be claimed,
 * then what's left of this week's "On air", then booking the next show,
 * and otherwise keeping the weekly streak going.
 */
export function nextStep(quests: QuestView[], weeks: number): NextStep {
  const creator = quests.filter((q) => q.creator);
  const ready = creator.find((q) => q.claimable);
  if (ready) {
    return { kind: "claim", text: `“${ready.title}” is done — claim ${ready.points} points.`, href: "/rewards", points: ready.points };
  }
  const onAir = creator.find((q) => q.id === "weekly-on-air");
  if (onAir && !onAir.claimed && onAir.progress < onAir.target) {
    const left = onAir.target - onAir.progress;
    return {
      kind: "quest",
      text: `${left} more ${left === 1 ? "minute" : "minutes"} on air this week finishes “${onAir.title}”.`,
      href: "/rewards",
      progress: onAir.progress,
      target: onAir.target,
      unit: onAir.unit,
      points: onAir.points,
    };
  }
  const book = creator.find((q) => q.id === "milestone-book-it");
  if (book && !book.claimed && book.progress < book.target) {
    return { kind: "book", text: `Book your next stream — it finishes “${book.title}”.`, href: "/schedule", points: book.points };
  }
  return {
    kind: "streak",
    text: weeks >= 1 ? `Go live next week to make it ${weeks + 1} weeks in a row.` : "Go live again this week to start a streak.",
    href: "/schedule",
  };
}

export interface StreamReport {
  stream: {
    id: string;
    title: string;
    category: string;
    practice: boolean;
    live: boolean;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number;
    thumbnailUrl: string | null;
  };
  tone: ReportTone;
  /** Null for a stream that never went on air. */
  analytics: StreamAnalytics | null;
  bestMinute: BestMinute | null;
  /** What the gifts came to; null on a practice run, which has no money in it. */
  earnings: { grossMinor: number; netMinor: number; gifts: number } | null;
  /** Points the host made while on air. */
  pointsEarned: number;
  progress: {
    level: ReturnType<typeof levelFor>;
    weeksInARow: number;
    streamsThisWeek: number;
    quests: QuestView[];
    next: NextStep;
  };
  /** The host's 0–10 answer for this stream, if they gave one. */
  rating: number | null;
}

type ReportStream = {
  _id: Id;
  streamerId: Id;
  title?: string;
  category?: string;
  practice?: boolean;
  isLive: boolean;
  startedAt?: Date | null;
  endedAt?: Date | null;
  peakViewers?: number;
  viewerSeconds?: number;
  viewersByMinute?: Record<string, number>;
  moments?: Array<{ at: Date; kind: string; label: string }>;
  thumbnailVersion?: number;
};

/** Everything the report shows, for its host. */
export async function buildStreamReport(stream: ReportStream, hostId: Id, now = new Date()): Promise<StreamReport> {
  const practice = Boolean(stream.practice);
  const start = stream.startedAt ? new Date(stream.startedAt) : null;
  const end = stream.isLive || !stream.endedAt ? now : new Date(stream.endedAt);

  const [analytics, gifts, points, broadcasts, quests, xp, rating] = await Promise.all([
    streamAnalytics(stream, now.getTime()),
    practice ? Promise.resolve([]) : GiftTransaction.find({ streamId: stream._id }).select("grossUsdMinor netUsdMinor").lean(),
    start
      ? PointsLedger.find({ userId: hostId, delta: { $gt: 0 }, reason: { $nin: NOT_EARNED }, createdAt: { $gte: start, $lte: end } })
          .select("delta")
          .lean()
      : Promise.resolve([]),
    Stream.find({ streamerId: hostId, practice: { $ne: true }, startedAt: { $gte: new Date(now.getTime() - STREAK_WEEKS * WEEK_MS) } })
      .select("startedAt")
      .lean(),
    questViews(hostId, now),
    lifetimePoints(hostId),
    StreamRating.findOne({ streamId: stream._id }).select("score").lean(),
  ]);

  const starts = broadcasts.map((b) => b.startedAt).filter((d): d is Date => Boolean(d)).map((d) => new Date(d));
  const thisWeek = isoWeekKey(now);
  const weeks = weeksInARow(starts, now);
  const creatorQuests = quests.filter((q) => q.creator);

  const summary = analytics?.summary ?? { peakViewers: 0, newAllies: 0, gifters: 0, chats: 0 };
  return {
    stream: {
      id: String(stream._id),
      title: stream.title ?? "",
      category: stream.category ?? "",
      practice,
      live: stream.isLive,
      startedAt: start ? start.toISOString() : null,
      endedAt: stream.endedAt ? new Date(stream.endedAt).toISOString() : null,
      durationSeconds: start ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000)) : 0,
      thumbnailUrl: thumbnailUrlFor({ _id: stream._id, thumbnailVersion: stream.thumbnailVersion ?? 0 }),
    },
    tone: reportTone(summary, practice),
    analytics,
    bestMinute: analytics ? bestMinute(analytics) : null,
    earnings: practice
      ? null
      : {
          grossMinor: gifts.reduce((n, g) => n + (g.grossUsdMinor ?? 0), 0),
          netMinor: gifts.reduce((n, g) => n + (g.netUsdMinor ?? 0), 0),
          gifts: gifts.length,
        },
    pointsEarned: points.reduce((n, p) => n + (p.delta ?? 0), 0),
    progress: {
      level: levelFor(xp),
      weeksInARow: weeks,
      streamsThisWeek: starts.filter((d) => isoWeekKey(d) === thisWeek).length,
      quests: creatorQuests,
      next: nextStep(creatorQuests, weeks),
    },
    rating: rating?.score ?? null,
  };
}
