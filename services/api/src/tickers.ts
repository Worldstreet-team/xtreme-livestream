import type mongoose from "mongoose";
import { sendRoomDataTo } from "./livekit.js";
import { knownMarkets } from "./market-list.js";
import { consoleIdentities } from "./safety/roles.js";

/**
 * What chat is talking about (Phase 3, market layer): cashtags — "$SOL",
 * "$btc" — counted per stream over the last few minutes, kept to markets
 * we can actually chart, and handed to the host's studio and their
 * producers' consoles as suggestions to confirm. Nothing goes on screen by
 * itself: a creator decides, and chat never puts a ticker up.
 */

type Id = mongoose.Types.ObjectId;

const WINDOW_MS = 5 * 60_000;
const PUSH_EVERY_MS = 10_000;
const TOP = 3;

export interface Trending {
  symbol: string;
  mentions: number;
}

/** "$sol and $BTC?" → ["SOL-USD", "BTC-USD"]. "$100" is money, not a market. */
export function cashtags(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w$])\$([A-Za-z][A-Za-z0-9]{1,9})\b/g)) out.add(`${m[1]!.toUpperCase()}-USD`);
  return [...out].slice(0, 3);
}

const rooms = new Map<string, { mentions: Array<{ symbol: string; at: number }>; pushedAt: number; last: string }>();

function top(mentions: Array<{ symbol: string }>): Trending[] {
  const counts = new Map<string, number>();
  for (const m of mentions) counts.set(m.symbol, (counts.get(m.symbol) ?? 0) + 1);
  return [...counts.entries()]
    .map(([symbol, n]) => ({ symbol, mentions: n }))
    .sort((a, b) => b.mentions - a.mentions || a.symbol.localeCompare(b.symbol))
    .slice(0, TOP);
}

/** The markets chat is talking about on a stream right now, most mentioned first. */
export function trendingOf(streamId: Id | string, now = Date.now()): Trending[] {
  const room = rooms.get(String(streamId));
  if (!room) return [];
  room.mentions = room.mentions.filter((m) => now - m.at < WINDOW_MS);
  return top(room.mentions);
}

/**
 * A chat line: count its cashtags, and when what's on top changes, tell the
 * host's studio and their consoles — no more than every ten seconds.
 */
export async function noteTickers(
  stream: { _id: Id | string; streamerId: Id | string; livekitRoomName: string },
  streamer: Parameters<typeof consoleIdentities>[0] | null,
  text: string,
  now = Date.now(),
) {
  const tags = cashtags(text);
  if (tags.length === 0) return;
  const known = await knownMarkets().catch(() => null);
  const symbols = known ? tags.filter((s) => known.has(s)) : tags;
  if (symbols.length === 0) return;
  const key = String(stream._id);
  const room = rooms.get(key) ?? { mentions: [], pushedAt: 0, last: "" };
  room.mentions = [...room.mentions.filter((m) => now - m.at < WINDOW_MS), ...symbols.map((symbol) => ({ symbol, at: now }))].slice(-500);
  rooms.set(key, room);
  if (rooms.size > 2000) rooms.delete(rooms.keys().next().value!);

  const tickers = top(room.mentions);
  const signature = tickers.map((t) => `${t.symbol}:${t.mentions}`).join(",");
  if (signature === room.last || now - room.pushedAt < PUSH_EVERY_MS) return;
  room.last = signature;
  room.pushedAt = now;
  const to = [String(stream.streamerId), ...(streamer ? consoleIdentities(streamer) : [])];
  void sendRoomDataTo(stream.livekitRoomName, to, { __evt: "tickers", tickers }).catch(() => {});
}

/** For tests: forget every room. */
export function clearTickers() {
  rooms.clear();
}
