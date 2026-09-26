import type mongoose from "mongoose";
import { Stream, StreamBan } from "../models.js";

/**
 * Ban-evasion flags (Phase 3, deeper moderation): a young account whose
 * name looks like one banned on the channel lately is probably the same
 * person back — "sp4mmer_2" after "spammer" was banned an hour ago. We
 * don't read devices or IP addresses for it; the name, the account's age
 * and the channel's recent bans say enough to tell the moderators, who
 * decide. The host can have such lines held for review instead.
 */

type Id = mongoose.Types.ObjectId;

/** Accounts older than this aren't flagged: evaders make new ones. */
export const EVASION_ACCOUNT_MS = 7 * 86_400_000;
/** Bans this recent on the channel are what a new name is compared with. */
const BAN_LOOKBACK_MS = 14 * 86_400_000;
const CACHE_MS = 60_000;
/** One entry per channel a young account chats in lately — bounded, oldest out first. */
const CACHE_MAX = 500;

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", $: "s" };

/** A name as it reads: look-alike digits as letters, then only the letters. */
export function nameStem(username: string) {
  return username
    .toLowerCase()
    .replace(/[0134578@$]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** Whether two names look like the same person's. */
export function looksLike(a: string, b: string) {
  if (a.toLowerCase() === b.toLowerCase()) return false;
  const x = nameStem(a);
  const y = nameStem(b);
  if (x.length < 4 || y.length < 4) return false;
  if (x === y) return true;
  const short = Math.min(x.length, y.length);
  // One name inside the other only when the shorter is long enough to be
  // more than a common first name ("chioma" is in "chiomaokeke" — and in
  // half of Lagos).
  if (short >= 7 && (x.includes(y) || y.includes(x))) return true;
  return distance(x, y) <= (short >= 8 ? 2 : short >= 5 ? 1 : 0);
}

export interface EvasionSignal {
  /** The banned name it looks like. */
  like: string;
  bannedAt: Date;
  accountAgeMs: number;
}

/** The channel's recent bans, a minute at a time. */
const bansCache = new Map<string, { at: number; bans: Array<{ username: string; userId: string; at: Date }> }>();

async function recentBans(channelId: Id | string, now: number) {
  const key = String(channelId);
  const hit = bansCache.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.bans;
  const since = new Date(now - BAN_LOOKBACK_MS);
  const streams = await Stream.find({ streamerId: channelId, startedAt: { $gte: since } }).select("_id").lean();
  // Bans for the stream's lifetime, not timeouts: a two-minute time-out
  // isn't someone to watch for. And a ban that never got a name (the
  // "user" stand-in) matches nothing.
  const bans = streams.length
    ? await StreamBan.find({ streamId: { $in: streams.map((s) => s._id) }, createdAt: { $gte: since }, expiresAt: null }).select("username userId createdAt").lean()
    : [];
  const list = bans.filter((b) => b.username && b.username !== "user").map((b) => ({ username: b.username, userId: String(b.userId), at: new Date(b.createdAt) }));
  bansCache.delete(key);
  bansCache.set(key, { at: now, bans: list });
  if (bansCache.size > CACHE_MAX) bansCache.delete(bansCache.keys().next().value!);
  return list;
}

/** Forget a channel's cached bans — it just banned someone. */
export function forgetBans(channelId: unknown) {
  bansCache.delete(String(channelId));
}

/**
 * Whether this account looks like someone the channel banned lately: young,
 * not banned itself, and named like a banned account. The most recent
 * match, or null.
 */
export async function evasionOf(
  channelId: Id | string,
  user: { _id: unknown; username: string; createdAt?: Date | string | null },
  now = Date.now(),
): Promise<EvasionSignal | null> {
  if (!user.createdAt) return null;
  const age = now - new Date(user.createdAt).getTime();
  if (age >= EVASION_ACCOUNT_MS) return null;
  const bans = await recentBans(channelId, now);
  const match = bans
    .filter((b) => b.userId !== String(user._id) && looksLike(user.username, b.username))
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return match ? { like: match.username, bannedAt: match.at, accountAgeMs: age } : null;
}

/** "Looks like @spammer (banned 2 h ago) · account 1 day old". */
export function evasionReason(signal: EvasionSignal, now = Date.now()) {
  const ago = (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} days`);
  const days = Math.floor(signal.accountAgeMs / 86_400_000);
  return `Looks like @${signal.like} (banned ${ago(now - signal.bannedAt.getTime())} ago) · account ${days < 1 ? "under a day" : days === 1 ? "1 day" : `${days} days`} old`;
}
