import mongoose from "mongoose";
import {
  CALL_CHECKPOINT_MS,
  CALL_CHECKPOINTS,
  CALL_MARKET_COOLDOWN_MS,
  FILTER_CATEGORIES,
  MAX_CALLS_PER_DAY,
  type CallCheckpoint,
  type CallDirection,
  type CallLayer,
  type CallOutcomeView,
  type CallSummary,
  type CallView,
  type FilterCategory,
  type FilterLevel,
  type SceneLayer,
} from "@xtreme/contracts";
import { audit } from "./audit.js";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
import { sceneView } from "./featured.js";
import { sendRoomData, setRoomScene } from "./livekit.js";
import { knownMarkets } from "./market-list.js";
import { Call, Stream, type ICall, type ICallOutcome, type IStream, type IUser } from "./models.js";
import { closeOfMinute } from "./market-oracle.js";
import { freshQuote } from "./routes/market.js";
import { checkMessage } from "./safety/filter.js";

/**
 * Call receipts (Phase 4). A creator on air taps Make a call — "SOL, up" —
 * and the API writes down the market, the direction, the price and the
 * time itself: the price is Coinbase's, fetched at that moment, never a
 * number a client sent. A card goes on the stream (the `call` scene layer,
 * drawn from this record on every write), and the outcome sweep fills in
 * how it went at 1 hour, 24 hours and 7 days from the close of Coinbase's
 * one-minute candle at each. The record is the channel's for good: no edit,
 * no delete — only a platform admin can hide a call, and says why.
 *
 * Behind the CALL_RECEIPTS switch, off until legal review. Off, nothing
 * can be called or put on screen and the record reads as switched off;
 * calls made while it was on still get their checkpoints filled.
 */

type Id = mongoose.Types.ObjectId | string;
type CallRecord = Pick<ICall, "streamId" | "streamerId" | "by" | "symbol" | "direction" | "note" | "entry" | "outcomes"> & {
  _id: unknown;
  createdAt?: Date;
};

const MINUTE = 60_000;
const DAY = 24 * 3_600_000;
/** A checkpoint is looked at once its minute has closed and Coinbase has had half a minute to publish the candle. */
const SETTLE_MS = 90_000;
/** No candle yet: look again in two minutes. */
const RETRY_MS = 2 * MINUTE;
/** Six hours past due and still no price: that checkpoint is marked unavailable. */
export const GIVE_UP_MS = 6 * 3_600_000;
/** Calls the sweep takes on in a pass. */
const SWEEP_BATCH = 50;

/** Whether calls are switched on — read each time, so tests can flip it. */
export const callsEnabled = () => config.CALL_RECEIPTS === true;

export function assertCallsOn() {
  if (!callsEnabled()) throw new ApiError(403, "Calls aren't open on Xtream yet", "CALLS_OFF");
}

/** "SOL-USD" → "SOL": the coin, as people say it. */
const coin = (symbol: string) => symbol.split("-")[0] ?? symbol;
const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;
/** The move from one price to another, in per cent. */
export const movePct = (from: number, to: number) => round(((to - from) / from) * 100);

/* ------------------------------------------------------------------ */
/* Prices                                                              */
/* ------------------------------------------------------------------ */

/**
 * A market's price at a moment: the close of Coinbase's one-minute candle
 * for that minute — the last trade in it, or the last before it when nobody
 * traded in it (so a quiet coin's check isn't left waiting on a candle that
 * will never come). Null while that minute hasn't closed or the feed hasn't
 * answered. Shared with market questions (market-oracle.ts).
 */
export function priceAt(symbol: string, at: Date, now = Date.now()): Promise<number | null> {
  return closeOfMinute(symbol, at.getTime(), now);
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/** When a checkpoint falls: the call's time plus an hour, a day or a week. */
export function checkpointTime(entryAt: Date | string, k: CallCheckpoint) {
  return new Date(new Date(entryAt).getTime() + CALL_CHECKPOINT_MS[k]);
}

/** When the sweep should next look at a call: its first open checkpoint, once that minute's candle is out. Null when all three are in. */
export function nextCheckFor(entryAt: Date | string, outcomes: Partial<Record<CallCheckpoint, unknown>> | null | undefined) {
  const open = CALL_CHECKPOINTS.find((k) => !outcomes?.[k]);
  return open ? new Date(checkpointTime(entryAt, open).getTime() + SETTLE_MS) : null;
}

function outcomeView(o: ICallOutcome | null | undefined): CallOutcomeView | null {
  if (!o) return null;
  const at = new Date(o.at).toISOString();
  return o.unavailable || typeof o.price !== "number" || typeof o.changePct !== "number"
    ? { at, price: null, changePct: null, unavailable: true }
    : { at, price: o.price, changePct: o.changePct, unavailable: false };
}

export function callView(c: CallRecord): CallView {
  return {
    id: String(c._id),
    streamId: String(c.streamId),
    by: c.by,
    symbol: c.symbol,
    direction: c.direction,
    note: c.note ?? "",
    entry: { price: c.entry.price, at: new Date(c.entry.at).toISOString() },
    outcomes: {
      h1: outcomeView(c.outcomes?.h1),
      h24: outcomeView(c.outcomes?.h24),
      d7: outcomeView(c.outcomes?.d7),
    },
  };
}

/** The card on stream, drawn from the record alone. */
export function callLayerOf(c: Pick<CallRecord, "_id" | "symbol" | "direction" | "entry" | "by">): CallLayer {
  return {
    kind: "call",
    callId: String(c._id),
    symbol: c.symbol,
    direction: c.direction,
    entryPrice: c.entry.price,
    entryAt: new Date(c.entry.at).toISOString(),
    by: c.by,
  };
}

/** Did the price move the way it was called? Flat isn't. */
export const wentTheCalledWay = (direction: CallDirection, changePct: number) => (direction === "up" ? changePct > 0 : changePct < 0);

/**
 * A note never carries a way off the platform or a pitch: the chat
 * filter's link and scam checks, at block. The rest of a note is the
 * creator's own words, on their own channel.
 */
const NOTE_RULES = {
  filters: Object.fromEntries(FILTER_CATEGORIES.map((c) => [c, c === "links" || c === "scams" ? "block" : "off"])) as Record<FilterCategory, FilterLevel>,
};
export const noteAllowed = (note: string) => !note || checkMessage(note, NOTE_RULES) === null;

/* ------------------------------------------------------------------ */
/* Making a call                                                       */
/* ------------------------------------------------------------------ */

export interface MakeCall {
  stream: Pick<IStream, "_id" | "streamerId" | "isLive" | "practice">;
  /** The channel: its name goes on the card. */
  streamer: Pick<IUser, "username" | "displayName">;
  /** Who pressed it — the host, or a producer of theirs. */
  by: Id;
  symbol: string;
  direction: CallDirection;
  note?: string;
}

/**
 * Write a call down. Refused with the switch off, off air, on a practice
 * run, for a market Coinbase doesn't trade in dollars, for a note with a
 * link or a pitch in it, past twenty calls in a day and within ten minutes
 * of the channel's last call on the same market. The price is fetched here,
 * now; the time is now.
 */
export async function makeCall(input: MakeCall, now = new Date()) {
  assertCallsOn();
  const { stream, streamer } = input;
  if (!stream.isLive) throw new ApiError(409, "Go live first", "NOT_LIVE");
  // A rehearsal's calls would land on the channel's public record.
  if (stream.practice) throw new ApiError(409, "Practice runs can't make calls — every call goes on your channel's record", "PRACTICE_RUN");

  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol.endsWith("-USD") || !(await knownMarkets()).has(symbol)) {
    throw new ApiError(404, `Coinbase doesn't trade ${coin(symbol)} in dollars — pick another market`, "UNKNOWN_MARKET");
  }
  const note = (input.note ?? "").trim();
  if (!noteAllowed(note)) {
    throw new ApiError(422, "A call's note can't carry links, wallet addresses or money-making pitches", "NOTE_BLOCKED");
  }

  const made = await Call.countDocuments({ streamerId: stream.streamerId, createdAt: { $gte: new Date(now.getTime() - DAY) } });
  if (made >= MAX_CALLS_PER_DAY) {
    throw new ApiError(429, `That's ${MAX_CALLS_PER_DAY} calls in a day — the most a channel can make`, "CALL_LIMIT");
  }
  const last = await Call.findOne({ streamerId: stream.streamerId, symbol, createdAt: { $gt: new Date(now.getTime() - CALL_MARKET_COOLDOWN_MS) } })
    .sort({ createdAt: -1 })
    .select("createdAt")
    .lean();
  const tooSoon = (since: number) =>
    new ApiError(
      429,
      `You called ${coin(symbol)} just now — you can call it again in ${Math.max(1, Math.ceil((since + CALL_MARKET_COOLDOWN_MS - now.getTime()) / MINUTE))} min`,
      "CALL_TOO_SOON",
    );
  if (last) throw tooSoon(new Date(last.createdAt).getTime());

  // The price is ours, taken now — never one a client sent.
  const quote = await freshQuote(symbol);
  if (!quote) throw new ApiError(404, `Coinbase doesn't trade ${coin(symbol)} in dollars — pick another market`, "UNKNOWN_MARKET");

  try {
    const call = await Call.create({
      streamId: stream._id,
      streamerId: stream.streamerId,
      createdBy: input.by,
      by: (streamer.displayName || streamer.username || "").slice(0, 80),
      symbol,
      direction: input.direction,
      note,
      entry: { price: quote.last, at: now },
      outcomes: { h1: null, h24: null, d7: null },
      nextCheckAt: nextCheckFor(now, null),
      slot: Math.floor(now.getTime() / CALL_MARKET_COOLDOWN_MS),
      hidden: null,
    });
    forgetSummary(stream.streamerId);
    return call;
  } catch (error) {
    // A second press racing this one, on the same market in the same ten minutes.
    if ((error as { code?: number }).code === 11000) throw tooSoon(now.getTime());
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* The card on the scene                                               */
/* ------------------------------------------------------------------ */

export function callLayerIn(layers: ReadonlyArray<unknown> | undefined | null): CallLayer | null {
  const found = (layers ?? []).find((l) => Boolean(l) && typeof l === "object" && (l as { kind?: unknown }).kind === "call");
  return (found as CallLayer | undefined) ?? null;
}

/**
 * The call card as the API keeps it: drawn from the record of a call made
 * on this stream, whatever the client sent. Putting up a call that isn't
 * this stream's — or a hidden one, or any with the switch off — is refused;
 * one that was already up and has stopped being showable comes down
 * quietly instead of blocking the host's other changes (as a sponsor does).
 */
export async function resolveCallLayers(layers: SceneLayer[], stream: Pick<IStream, "_id" | "scene">): Promise<SceneLayer[]> {
  const sent = layers.find((l): l is CallLayer => l.kind === "call");
  if (!sent) return layers;
  const before = callLayerIn(stream.scene?.layers);
  try {
    assertCallsOn();
    const call = mongoose.isValidObjectId(sent.callId)
      ? await Call.findOne({ _id: sent.callId, streamId: stream._id }).select("symbol direction entry by hidden").lean()
      : null;
    if (!call) throw new ApiError(404, "That call wasn't made on this stream", "CALL_NOT_FOUND");
    if (call.hidden) throw new ApiError(410, "Xtream's moderators hid that call, so it can't go on screen", "CALL_HIDDEN");
    const drawn = callLayerOf(call);
    return layers.map((l) => (l.kind === "call" ? drawn : l));
  } catch (error) {
    if (!before || String(before.callId) !== String(sent.callId)) throw error;
    return layers.filter((l) => l.kind !== "call");
  }
}

/** Take a call's card off its stream, if it's up there (an admin hid the call). */
export async function takeDownCall(call: Pick<ICall, "streamId"> & { _id: unknown }) {
  const updated = await Stream.findOneAndUpdate(
    { _id: call.streamId, isLive: true, "scene.layers": { $elemMatch: { kind: "call", callId: String(call._id) } } },
    { $pull: { "scene.layers": { kind: "call", callId: String(call._id) } }, $inc: { "scene.version": 1 } },
    { new: true, select: "scene livekitRoomName" },
  ).lean();
  if (!updated) return false;
  const scene = sceneView(updated.scene);
  await setRoomScene(updated.livekitRoomName, scene);
  void sendRoomData(updated.livekitRoomName, { __evt: "scene", scene });
  return true;
}

/* ------------------------------------------------------------------ */
/* Hiding (platform admins)                                            */
/* ------------------------------------------------------------------ */

/**
 * An admin hides a call — off the channel's record and off the screen —
 * or puts it back; either way with the reason, in the audit log. The
 * channel's record says how many of its calls are hidden.
 */
export async function setCallHidden(callId: string, adminId: mongoose.Types.ObjectId, hidden: boolean, reason: string, now = new Date()) {
  const call = mongoose.isValidObjectId(callId)
    ? await Call.findOneAndUpdate({ _id: callId }, { $set: { hidden: hidden ? { at: now, by: adminId, reason } : null } }, { new: true }).lean()
    : null;
  if (!call) throw new ApiError(404, "There's no such call", "CALL_NOT_FOUND");
  if (hidden) await takeDownCall(call);
  forgetSummary(call.streamerId);
  await audit(adminId, hidden ? "call.hide" : "call.unhide", "call", call._id as mongoose.Types.ObjectId, {
    reason,
    streamerId: String(call.streamerId),
    symbol: call.symbol,
    direction: call.direction,
  });
  return call;
}

/* ------------------------------------------------------------------ */
/* Reading the record                                                  */
/* ------------------------------------------------------------------ */

/** A channel's calls, newest first. `next` is the cursor for the page after, or null at the end. */
export async function listCalls(streamerId: Id, { cursor, limit }: { cursor?: string | undefined; limit: number }) {
  const rows = await Call.find({ streamerId, hidden: null, ...(cursor ? { createdAt: { $lt: new Date(cursor) } } : {}) })
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const calls = rows.slice(0, limit);
  const next = rows.length > limit && calls.length ? new Date(calls[calls.length - 1]!.createdAt).toISOString() : null;
  return { calls, next };
}

/** A channel's record, from its calls' directions and 24-hour checks. */
export function summarize(rows: Array<Pick<ICall, "direction" | "outcomes" | "hidden">>): CallSummary {
  let total = 0;
  let hidden = 0;
  let checked = 0;
  let right = 0;
  let moveSum = 0;
  for (const r of rows) {
    if (r.hidden) {
      hidden += 1;
      continue;
    }
    total += 1;
    const o = r.outcomes?.h24;
    if (!o || o.unavailable || typeof o.changePct !== "number") continue;
    checked += 1;
    if (wentTheCalledWay(r.direction, o.changePct)) right += 1;
    moveSum += r.direction === "up" ? o.changePct : -o.changePct;
  }
  return {
    total,
    checked24h: checked,
    right24h: right,
    rightShare24h: checked ? round(right / checked) : null,
    avgMove24hPct: checked ? round(moveSum / checked, 2) : null,
    hidden,
  };
}

/**
 * The summary rides on every visit to a channel with calls, so it's kept a
 * minute per channel on this instance (and dropped when a call is made,
 * checked or hidden here).
 */
const SUMMARY_MS = 60_000;
const SUMMARY_MAX = 500;
const summaries = new Map<string, { at: number; summary: CallSummary }>();

function forgetSummary(streamerId: unknown) {
  summaries.delete(String(streamerId));
}

/** For tests: forget every kept summary. */
export function clearCallSummaries() {
  summaries.clear();
}

export async function channelSummary(streamerId: Id, now = Date.now()): Promise<CallSummary> {
  const key = String(streamerId);
  const hit = summaries.get(key);
  if (hit && now - hit.at < SUMMARY_MS) return hit.summary;
  const rows = await Call.find({ streamerId }).select("direction outcomes.h24 hidden").lean();
  const summary = summarize(rows);
  summaries.set(key, { at: now, summary });
  if (summaries.size > SUMMARY_MAX) summaries.delete(summaries.keys().next().value!);
  return summary;
}

/* ------------------------------------------------------------------ */
/* The outcome sweep                                                   */
/* ------------------------------------------------------------------ */

/**
 * Fill in the checkpoints that are due: each call's first open one, from
 * the close of that minute's candle. No candle yet, it's asked for again
 * in two minutes; six hours past due with still no price, the checkpoint
 * is marked unavailable and the next one waits its turn. Each is written
 * once, only while it's still open — two instances sweeping the same call
 * can't write it twice. Resolves to how many it filled or closed.
 */
export async function sweepCalls(now = Date.now()) {
  const due = await Call.find({ nextCheckAt: { $lte: new Date(now) } })
    .sort({ nextCheckAt: 1 })
    .limit(SWEEP_BATCH)
    .lean();
  // One candle per market and minute a pass, however many calls share it.
  const candles = new Map<string, Promise<number | null>>();
  let settled = 0;
  for (const call of due) {
    const k = CALL_CHECKPOINTS.find((c) => !call.outcomes?.[c]);
    if (!k) {
      await Call.updateOne({ _id: call._id }, { $set: { nextCheckAt: null } });
      continue;
    }
    const at = checkpointTime(call.entry.at, k);
    const key = `${call.symbol}@${Math.floor(at.getTime() / MINUTE)}`;
    if (!candles.has(key)) candles.set(key, priceAt(call.symbol, at, now).catch(() => null));
    const price = await candles.get(key)!;

    let outcome: ICallOutcome | null = null;
    if (price !== null) outcome = { price, at, changePct: movePct(call.entry.price, price), unavailable: false };
    else if (now - at.getTime() >= GIVE_UP_MS) outcome = { price: null, at, changePct: null, unavailable: true };

    const open = { _id: call._id, [`outcomes.${k}`]: null };
    if (!outcome) {
      await Call.updateOne(open, { $set: { nextCheckAt: new Date(now + RETRY_MS) } });
      continue;
    }
    const nextCheckAt = nextCheckFor(call.entry.at, { ...call.outcomes, [k]: outcome });
    const res = await Call.updateOne(open, { $set: { [`outcomes.${k}`]: outcome, nextCheckAt } });
    if (res.modifiedCount) {
      settled += 1;
      forgetSummary(call.streamerId);
    }
  }
  return settled;
}

/** Once a minute — never two at once, however slow the feed. It runs with the switch off too: calls made while it was on still get their checks. */
export function startCallSweep() {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    void sweepCalls()
      .catch((e) => console.error("call sweep failed:", e))
      .finally(() => {
        running = false;
      });
  }, 60_000);
}
