import crypto from "node:crypto";
import mongoose from "mongoose";
import { chatPayload } from "./chat.js";
import type { FanStatus } from "./fans.js";
import { bumpGoal } from "./goals.js";
import { sendRoomData } from "./livekit.js";
import { Stream, User, type IStream } from "./models.js";
import { fireRules } from "./rules.js";
import { noteTickers } from "./tickers.js";

/**
 * Practice runs (producer mode): a private rehearsal. The creator goes live
 * into a room nobody else can find or join — the routes keep a stream with
 * `practice: true` out of every list, token and announcement — and this
 * plays the audience: a chat line, a gift or a burst of likes into the
 * room every few seconds, so the studio, the show rules, the goal bar, the
 * ticker suggestions and the run of show can be rehearsed against
 * something that moves.
 *
 * Nothing here is real: no chat rows, no GiftTransaction, no wallet, no
 * points, no notifications. The events are shaped exactly as the real
 * routes send them (chat.ts, gifts.ts, the like route), so every screen
 * that listens to the room behaves as it would on the night.
 *
 * In-process only — a map of timers, one per practice stream. A run stops
 * when the stream ends (markStreamEnded), on its own after
 * PRACTICE_MAX_MS, or with the process: a restart simply ends the audience,
 * and the stream reconciles like any other. Everything is best-effort and
 * logged; nothing thrown here reaches whoever started the run.
 */

/** A rehearsal's audience leaves after two hours, whatever the host does. */
export const PRACTICE_MAX_MS = 2 * 60 * 60_000;
/** One event every 4–9 seconds. */
export const PRACTICE_TICK_MIN_MS = 4_000;
export const PRACTICE_TICK_MAX_MS = 9_000;
/** The mix, out of 100: chat lines, gifts, like bursts. */
const MIX = { chat: 65, gift: 25 } as const;

/**
 * The simulated audience. Fictional names only; some carry a fan standing
 * (a level and a watch-time badge) so the chat's fan badges rehearse too.
 */
export const PRACTICE_CAST: ReadonlyArray<{ username: string; fan: FanStatus | null }> = [
  { username: "ada_k", fan: { level: 6, hours: 62, badge: 50 } },
  { username: "tolu", fan: null },
  { username: "suya_sam", fan: { level: 3, hours: 11, badge: 10 } },
  { username: "kemi", fan: { level: 2, hours: 4, badge: 0 } },
  { username: "chioma_e", fan: null },
  { username: "emeka", fan: { level: 4, hours: 23, badge: 10 } },
  { username: "yemi_o", fan: null },
  { username: "ngozi", fan: { level: 5, hours: 51, badge: 50 } },
];

/** What they say: greetings, reactions, questions, cashtags, encouragement. */
export const PRACTICE_LINES: readonly string[] = [
  "gm gm 👋",
  "hello from Lagos!",
  "first time here, what's the vibe?",
  "back again 🙌",
  "evening everyone",
  "greetings from Abuja",
  "lol",
  "🔥🔥",
  "😂😂😂",
  "W",
  "nooo way",
  "this is the content",
  "say it louder",
  "the chart looks spicy today",
  "What's your target for BTC by Friday?",
  "Which exchange do you chart on?",
  "are you buying the dip or waiting?",
  "what timeframe is that chart?",
  "how long have you been trading?",
  "do you use stop losses on every trade?",
  "can you zoom in on that candle?",
  "what's the plan if it breaks support?",
  "$SOL looking strong today",
  "$BTC?",
  "$ETH is quiet, too quiet",
  "$SOL or $ETH this week?",
  "$BTC to 100k when",
  "$DOGE lol",
  "$ADA never sleeps",
  "keep going, this is helping",
  "learning a lot, thank you",
  "best stream on here tbh",
  "you got this 💪",
  "we're here for it",
  "take your time, no rush",
  "sound is perfect today",
  "the new overlay looks clean",
  "can we get the lower third again?",
  "Kolanut Coffee in hand, ready",
  "just got my Ofada Express order, let's go",
];

/**
 * The gifts they send — the lower rungs of the real catalogue (lib/gifts.ts
 * at the repo root: same names, faces and prices), weighted so most are
 * small and a Crown is an event.
 */
export const PRACTICE_GIFTS: ReadonlyArray<{ name: string; emoji: string; usdMinor: number; weight: number }> = [
  { name: "Clap", emoji: "👏", usdMinor: 50, weight: 30 },
  { name: "Heart", emoji: "❤️", usdMinor: 100, weight: 25 },
  { name: "Fire", emoji: "🔥", usdMinor: 200, weight: 18 },
  { name: "Rocket", emoji: "🚀", usdMinor: 500, weight: 12 },
  { name: "Party", emoji: "🎉", usdMinor: 1000, weight: 7 },
  { name: "Diamond", emoji: "💎", usdMinor: 2000, weight: 4 },
  { name: "Trophy", emoji: "🏆", usdMinor: 5000, weight: 3 },
  { name: "Crown", emoji: "👑", usdMinor: 10_000, weight: 1 },
];

type PracticeStream = Pick<IStream, "_id" | "streamerId" | "livekitRoomName">;
type Streamer = Parameters<typeof noteTickers>[1];

interface Run {
  key: string;
  stream: PracticeStream;
  /** The host, with their crew — for the ticker suggestions' console fan-out. Loaded once. */
  streamer: Streamer;
  endsAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const runs = new Map<string, Run>();

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!;
const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

function pickGift() {
  const total = PRACTICE_GIFTS.reduce((sum, g) => sum + g.weight, 0);
  let roll = Math.random() * total;
  for (const gift of PRACTICE_GIFTS) {
    roll -= gift.weight;
    if (roll < 0) return gift;
  }
  return PRACTICE_GIFTS[0]!;
}

/**
 * A cast member's user id: fake, but the same every time for the same
 * name, so the host's timeout and ban buttons have something stable to act
 * on — and a ban rehearsed on "tolu" holds for the rest of the run.
 */
export function practiceUserId(username: string) {
  const hex = crypto.createHash("sha1").update(`practice:${username}`).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

const centsToDecimal = (minor: number) => (minor / 100).toFixed(2);

/** A cast member's line, shaped as chat.ts sends a real one (plus when it was said). */
function chatLine(who: (typeof PRACTICE_CAST)[number], content: string) {
  return {
    ...chatPayload(
      {
        _id: new mongoose.Types.ObjectId(),
        userId: practiceUserId(who.username),
        username: who.username,
        avatar: "",
        isMod: false,
        content,
        type: "text",
        tipAmount: null,
        tipCurrency: null,
        emoji: null,
        platform: "xstream",
      } as never,
      who.fan,
    ),
    createdAt: new Date().toISOString(),
  };
}

/** A cast member's gift, shaped as gifts.ts announces a real tip in the room. */
function giftLine(who: (typeof PRACTICE_CAST)[number], gift: (typeof PRACTICE_GIFTS)[number]) {
  return {
    ...chatPayload(
      {
        _id: new mongoose.Types.ObjectId(),
        userId: practiceUserId(who.username),
        username: who.username,
        avatar: "",
        isMod: false,
        content: `sent a ${gift.name}`,
        type: "tip",
        tipAmount: centsToDecimal(gift.usdMinor),
        tipCurrency: "USD",
        emoji: gift.emoji,
        platform: "xstream",
      } as never,
      who.fan,
    ),
    createdAt: new Date().toISOString(),
  };
}

/** One event into the room: a line, a gift or a burst of likes. */
async function act(run: Run) {
  const { stream, streamer } = run;
  const who = pick(PRACTICE_CAST);
  const roll = Math.random() * 100;

  if (roll < MIX.chat) {
    const content = pick(PRACTICE_LINES);
    await sendRoomData(stream.livekitRoomName, chatLine(who, content));
    // "!discord" rules and "$SOL" suggestions rehearse off the same line.
    void fireRules(stream, { kind: "chat_word", text: content, user: who.username });
    void noteTickers(stream, streamer, content).catch(() => {});
    return;
  }

  if (roll < MIX.chat + MIX.gift) {
    const gift = pickGift();
    await sendRoomData(stream.livekitRoomName, giftLine(who, gift));
    // The show rules and the goal bar move as they would for a paid gift.
    // Not the heat meter or the auto-feature tier: both read the gift
    // ledger, and a rehearsal writes nothing to it.
    void fireRules(stream, { kind: "gift", minor: gift.usdMinor, user: who.username, gift: gift.name });
    await bumpGoal(stream._id, "gifts", gift.usdMinor).catch((err) => console.error("practice goal failed:", err));
    return;
  }

  // A few likes at once, counted on the stream like the like route does —
  // the room hears the count it should show. No count means the stream
  // ended under us: the audience goes home.
  const likes = between(1, 4);
  const updated = await Stream.findOneAndUpdate(
    { _id: stream._id, isLive: true },
    { $inc: { likes } },
    { new: true, select: "likes livekitRoomName" },
  ).lean();
  if (!updated) {
    stopPractice(run.key);
    return;
  }
  await sendRoomData(stream.livekitRoomName, { __evt: "like", likes: updated.likes, username: who.username });
  await bumpGoal(stream._id, "likes", likes).catch((err) => console.error("practice goal failed:", err));
}

function schedule(run: Run) {
  run.timer = setTimeout(() => void tick(run), between(PRACTICE_TICK_MIN_MS, PRACTICE_TICK_MAX_MS));
  run.timer.unref?.();
}

async function tick(run: Run) {
  run.timer = null;
  try {
    await act(run);
  } catch (err) {
    console.error(`practice run ${run.key} event failed:`, err);
  }
  // Stopped while the event was in flight — or replaced by a fresh run.
  if (runs.get(run.key) !== run) return;
  if (Date.now() >= run.endsAt) {
    stopPractice(run.key);
    return;
  }
  schedule(run);
}

/**
 * Start the audience for a practice stream that has just gone live. Called
 * where a real stream would be announced (streams.ts). Starting again for
 * the same stream replaces the run. Never throws.
 */
export function startPractice(stream: PracticeStream) {
  const key = String(stream._id);
  stopPractice(key);
  const run: Run = {
    key,
    stream: { _id: stream._id, streamerId: stream.streamerId, livekitRoomName: stream.livekitRoomName },
    streamer: null,
    endsAt: Date.now() + PRACTICE_MAX_MS,
    timer: null,
  };
  runs.set(key, run);
  // The host and their crew, once: the ticker suggestions go to their
  // consoles too. Without it the suggestions still reach the host's studio.
  void User.findById(stream.streamerId)
    .select("username displayName safety settings")
    .lean()
    .then((streamer) => {
      if (runs.get(key) === run) run.streamer = (streamer as Streamer) ?? null;
    })
    .catch((err) => console.error(`practice run ${key} could not load the host:`, err));
  schedule(run);
}

/** The audience goes home: nothing more is sent. True when there was a run to stop. */
export function stopPractice(streamId: unknown) {
  const key = String(streamId);
  const run = runs.get(key);
  if (!run) return false;
  if (run.timer) clearTimeout(run.timer);
  run.timer = null;
  runs.delete(key);
  return true;
}

/** Is a rehearsal's audience running for this stream? */
export function isPracticing(streamId: unknown) {
  return runs.has(String(streamId));
}

/** For tests: stop every run. */
export function stopAllPractice() {
  for (const key of [...runs.keys()]) stopPractice(key);
}
