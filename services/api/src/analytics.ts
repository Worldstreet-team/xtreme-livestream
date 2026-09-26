import type mongoose from "mongoose";
import type { MomentKind, StreamAnalytics } from "@xtreme/contracts";
import { Battle, ChatMessage, Follow, GiftTransaction, Stream, User, WatchSession } from "./models.js";

/**
 * Live analytics (Phase 3): a broadcast minute by minute. The audience
 * curve is written as counts change (the most seen each minute); chat,
 * gifts, allies and battles are read from where they already live; and a
 * short log of moments — segments starting, guests joining, cards going
 * up, goals reached — says what was on when people came and went.
 */

type Id = mongoose.Types.ObjectId;

const MINUTE = 60_000;
/** Twelve hours of minutes: the longest a curve runs. */
const MAX_MINUTES = 720;
/** A gift worth marking on the curve. */
const BIG_GIFT_MINOR = 2000;
const CARD_NAMES: Record<string, string> = { "starting-soon": "Starting soon", brb: "Be right back", ending: "Thanks for watching" };

/** The most viewers seen this minute. */
export async function recordViewers(streamId: Id | string, startedAt: Date, viewers: number, now = Date.now()) {
  const minute = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / MINUTE));
  if (minute >= MAX_MINUTES) return;
  await Stream.updateOne({ _id: streamId }, { $max: { [`viewersByMinute.${minute}`]: viewers } });
}

/** Something worth a marker on the curve. Never fails what it records. */
export function recordMoment(streamId: Id | string, kind: MomentKind, label: string, at = new Date()) {
  return Stream.updateOne(
    { _id: streamId, isLive: true },
    { $push: { moments: { $each: [{ at, kind, label: label.slice(0, 80) }], $slice: -200 } } },
  ).catch((err) => console.error("recording a moment failed:", err));
}

/** A card went up: its moment, by name. */
export const cardMoment = (card: string) => `${CARD_NAMES[card] ?? card} card`;

export interface AnalyticsInput {
  startedAt: number;
  /** When it ended, or now while it's live. */
  endedAt: number;
  live: boolean;
  viewersByMinute: Record<string, number>;
  peakViewers: number;
  viewerSeconds: number;
  chats: Array<{ at: number; userId: string }>;
  gifts: Array<{ at: number; minor: number; senderId: string; sender: string; name: string }>;
  moments: Array<{ at: number; kind: MomentKind; label: string }>;
  battles: Array<{ at: number; result: "won" | "lost" | "tie"; opponent: string }>;
  newAllies: number;
  uniqueViewers: number;
  avgWatchMinutes: number;
  questions: Array<{ at: number; user: string; text: string }>;
}

const money = (minor: number) => `$${(minor / 100).toFixed(minor % 100 ? 2 : 0)}`;

/** A broadcast's minutes, moments, falls and totals, from what was recorded. Pure. */
export function buildAnalytics(input: AnalyticsInput): StreamAnalytics {
  const count = Math.min(MAX_MINUTES, Math.max(1, Math.ceil((input.endedAt - input.startedAt) / MINUTE)));
  const minuteOf = (at: number) => Math.min(count - 1, Math.max(0, Math.floor((at - input.startedAt) / MINUTE)));

  // Viewers: a minute nobody came or went holds the count before it.
  const minutes = Array.from({ length: count }, () => ({ viewers: 0, chats: 0, giftsMinor: 0 }));
  let last = 0;
  for (let m = 0; m < count; m++) {
    const seen = input.viewersByMinute[String(m)];
    if (typeof seen === "number" && Number.isFinite(seen)) last = Math.max(0, seen);
    minutes[m]!.viewers = last;
  }
  for (const c of input.chats) minutes[minuteOf(c.at)]!.chats += 1;
  for (const g of input.gifts) minutes[minuteOf(g.at)]!.giftsMinor += g.minor;

  // The peak, where it was.
  let peakMinute = 0;
  minutes.forEach((m, i) => {
    if (m.viewers > minutes[peakMinute]!.viewers) peakMinute = i;
  });
  const peakViewers = Math.max(input.peakViewers, minutes[peakMinute]!.viewers);

  const moments: StreamAnalytics["moments"] = [
    ...input.moments.map((m) => ({ minute: minuteOf(m.at), kind: m.kind, label: m.label })),
    ...input.gifts.filter((g) => g.minor >= BIG_GIFT_MINOR).map((g) => ({ minute: minuteOf(g.at), kind: "gift" as const, label: `${g.sender} sent ${g.name ? `a ${g.name}` : "a gift"} · ${money(g.minor)}` })),
    ...input.battles.map((b) => ({
      minute: minuteOf(b.at),
      kind: "battle" as const,
      label: b.result === "won" ? `Won the battle against ${b.opponent}` : b.result === "lost" ? `Lost the battle to ${b.opponent}` : `Drew the battle with ${b.opponent}`,
    })),
    ...(peakViewers > 0 ? [{ minute: peakMinute, kind: "peak" as const, label: `Peak — ${peakViewers} watching` }] : []),
  ].sort((a, b) => a.minute - b.minute);

  // What was on at a minute: the last segment, guest or card before it.
  const during = (minute: number) => {
    const before = moments.filter((m) => m.minute <= minute && (m.kind === "segment" || m.kind === "card" || m.kind === "guest"));
    return before.length ? before[before.length - 1]!.label : null;
  };

  // Falls: a minute that lost a fifth of the room (and at least three people),
  // biggest first, no two within three minutes of each other.
  const falls: StreamAnalytics["dropOffs"] = [];
  for (let m = 1; m < count; m++) {
    const from = minutes[m - 1]!.viewers;
    const to = minutes[m]!.viewers;
    if (from >= 5 && from - to >= Math.max(3, from * 0.2)) falls.push({ minute: m, from, to, during: during(m) });
  }
  const dropOffs: StreamAnalytics["dropOffs"] = [];
  for (const f of falls.sort((a, b) => b.from - b.to - (a.from - a.to))) {
    if (dropOffs.length >= 3) break;
    if (dropOffs.every((d) => Math.abs(d.minute - f.minute) >= 3)) dropOffs.push(f);
  }
  dropOffs.sort((a, b) => a.minute - b.minute);

  const durationSec = Math.max(1, (input.endedAt - input.startedAt) / 1000);
  const curveAvg = minutes.reduce((n, m) => n + m.viewers, 0) / count;
  return {
    startedAt: new Date(input.startedAt).toISOString(),
    endedAt: input.live ? null : new Date(input.endedAt).toISOString(),
    live: input.live,
    minutes,
    moments,
    dropOffs,
    summary: {
      durationMinutes: Math.round(durationSec / 60),
      peakViewers,
      peakMinute,
      avgViewers: Math.round(input.viewerSeconds > 0 ? input.viewerSeconds / durationSec : curveAvg),
      uniqueViewers: input.uniqueViewers,
      chats: input.chats.length,
      chatters: new Set(input.chats.map((c) => c.userId)).size,
      giftsMinor: input.gifts.reduce((n, g) => n + g.minor, 0),
      gifters: new Set(input.gifts.map((g) => g.senderId)).size,
      newAllies: input.newAllies,
      avgWatchMinutes: Math.round(input.avgWatchMinutes),
    },
    questions: input.questions.slice(0, 20).map((q) => ({ minute: minuteOf(q.at), user: q.user, text: q.text })),
  };
}

/** A question from chat: a real sentence that ends in "?". */
const isQuestion = (text: string) => text.trim().length >= 8 && /\?\s*$/.test(text.trim());

/** Read everything a broadcast's analytics are built from. */
export async function streamAnalytics(
  stream: {
    _id: Id;
    streamerId: Id;
    startedAt?: Date | null;
    endedAt?: Date | null;
    isLive: boolean;
    peakViewers?: number;
    viewerSeconds?: number;
    viewersByMinute?: Record<string, number>;
    moments?: Array<{ at: Date; kind: string; label: string }>;
  },
  now = Date.now(),
): Promise<StreamAnalytics | null> {
  if (!stream.startedAt) return null;
  const start = new Date(stream.startedAt).getTime();
  const end = stream.isLive || !stream.endedAt ? now : new Date(stream.endedAt).getTime();

  const [chats, gifts, battles, newAllies, sessions] = await Promise.all([
    ChatMessage.find({ streamId: stream._id, type: "text", status: { $ne: "held" } })
      .select("createdAt userId username content")
      .sort({ createdAt: 1 })
      .limit(50_000)
      .lean(),
    GiftTransaction.find({ streamId: stream._id }).select("createdAt grossUsdMinor senderId giftName").lean(),
    Battle.find({ $or: [{ hostStreamId: stream._id }, { challengerStreamId: stream._id }], status: "ended" })
      .select("hostStreamId hostId challengerId winnerId endsAt")
      .lean(),
    Follow.countDocuments({ followingId: stream.streamerId, createdAt: { $gte: new Date(start), $lte: new Date(end) } }),
    WatchSession.find({ streamId: stream._id }).select("userId joinedAt leftAt").limit(20_000).lean(),
  ]);

  // Names for the gifts worth marking, and for battle opponents.
  const nameIds = [
    ...new Set([
      ...gifts.filter((g) => g.grossUsdMinor >= BIG_GIFT_MINOR).map((g) => String(g.senderId)),
      ...battles.map((b) => String(String(b.hostStreamId) === String(stream._id) ? b.challengerId : b.hostId)),
    ]),
  ];
  const people = nameIds.length ? await User.find({ _id: { $in: nameIds } }).select("username displayName").lean() : [];
  const nameOf = (id: unknown) => {
    const u = people.find((p) => String(p._id) === String(id));
    return u ? u.displayName || u.username : "someone";
  };

  const watched = sessions.map((s) => Math.max(0, (s.leftAt ? new Date(s.leftAt).getTime() : end) - new Date(s.joinedAt).getTime()));
  const viewersSeen = new Set(sessions.map((s) => String(s.userId)));

  return buildAnalytics({
    startedAt: start,
    endedAt: end,
    live: stream.isLive,
    viewersByMinute: stream.viewersByMinute ?? {},
    peakViewers: stream.peakViewers ?? 0,
    viewerSeconds: stream.viewerSeconds ?? 0,
    chats: chats.map((c) => ({ at: new Date(c.createdAt).getTime(), userId: String(c.userId) })),
    gifts: gifts.map((g) => ({
      at: new Date(g.createdAt).getTime(),
      minor: g.grossUsdMinor,
      senderId: String(g.senderId),
      sender: g.grossUsdMinor >= BIG_GIFT_MINOR ? nameOf(g.senderId) : "",
      name: g.giftName ?? "",
    })),
    moments: (stream.moments ?? []).map((m) => ({ at: new Date(m.at).getTime(), kind: m.kind as MomentKind, label: m.label })),
    battles: battles.map((b) => {
      const mine = String(b.hostStreamId) === String(stream._id) ? b.hostId : b.challengerId;
      const theirs = String(b.hostStreamId) === String(stream._id) ? b.challengerId : b.hostId;
      return {
        at: b.endsAt ? new Date(b.endsAt).getTime() : end,
        result: !b.winnerId ? "tie" : String(b.winnerId) === String(mine) ? "won" : "lost",
        opponent: nameOf(theirs),
      };
    }),
    newAllies,
    uniqueViewers: viewersSeen.size,
    avgWatchMinutes: watched.length ? watched.reduce((n, ms) => n + ms, 0) / watched.length / MINUTE : 0,
    questions: chats
      .filter((c) => isQuestion(c.content))
      .map((c) => ({ at: new Date(c.createdAt).getTime(), user: c.username, text: c.content.trim().slice(0, 200) })),
  });
}
