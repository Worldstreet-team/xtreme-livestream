import { Stream, User } from "./models.js";
import {
  postSigned,
  RELAY_RETRY_DELAYS_MS,
  RelayRejected,
  socialsRelayEnabled,
} from "./socials-relay.js";

/**
 * Realtime pushes for Xtream clients, instead of polling. The WorldSpace
 * gateway publishes what this sends to Ably: `to: "all"` lands on the
 * public `xtream` channel, a Clerk user id lands on that person's own
 * `user:` channel. Clients keep a slow poll as a backstop and refetch the
 * moment a push says something changed.
 *
 * Signed exactly like the live relay (socials-relay.ts), sent to
 * `POST /internal/xtream/events` as `{ events: [{ to, name, data? }] }`.
 *
 * Fire-and-forget by design. Nothing here throws into, or waits inside, the
 * action that emitted the event: events are queued and sent after a short
 * window (so one tick's worth goes as one call, up to 50 a call), a
 * transient failure is retried on the relay's backoff, a permanent 4xx is
 * dropped (the gateway not shipping the route yet is a 404 — harmless).
 *
 * What goes out is ids and display fields only. Practice runs and practice
 * battles are private and never leave Xtream; money never does either —
 * `data` keys that look like money are stripped before anything is queued.
 */

export const XTREAM_EVENTS_PATH = "/internal/xtream/events";
/** Events per gateway call (the gateway's own limit). */
export const XTREAM_BATCH_MAX = 50;
/** How long the first event of a batch waits for company. */
export const XTREAM_BATCH_WINDOW_MS = 50;
/** Calls in flight at once; the rest wait their turn in the queue. */
const MAX_IN_FLIGHT = 4;
/** Past this the queue drops new events: a slow poll catches up for them. */
export const XTREAM_QUEUE_MAX = 5_000;
/** The gateway refuses `data` over 4KB; keep well under it. */
const DATA_MAX_BYTES = 3_500;
const STRING_MAX = 200;
/**
 * A go-live fan-out tells at most this many followers by push per stream;
 * everyone past it sees the bell on their next backstop poll.
 */
export const NOTIFICATION_PUSH_CAP = 2_000;

type Scalar = string | number | boolean | null;
export type XtreamEventData = Record<string, Scalar | Scalar[]>;
export interface XtreamEvent {
  /** "all" for the public channel, or a Clerk user id (User.authUserId). */
  to: string;
  name: string;
  data?: XtreamEventData;
}

/** Keys that could carry money. Nothing like them ever leaves in `data`. */
const MONEY_KEY = /usd|minor|amount|price|balance|earning|payout|wallet|coins?$|cash|money|fees?$|bonus|commission|cost$|revenue|tips?$|gross|net$/i;

function cleanScalar(v: unknown): Scalar | undefined {
  if (v === null) return null;
  if (typeof v === "string") return v.slice(0, STRING_MAX);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  return undefined;
}

/** A flat, money-free copy of `data`, or undefined when there's nothing left to send. */
export function cleanEventData(data: Record<string, unknown> | undefined): XtreamEventData | undefined {
  if (!data) return undefined;
  const out: XtreamEventData = {};
  for (const [key, raw] of Object.entries(data)) {
    if (MONEY_KEY.test(key) || raw === undefined) continue;
    if (Array.isArray(raw)) {
      const list = raw.map(cleanScalar).filter((x): x is Scalar => x !== undefined).slice(0, 20);
      out[key] = list;
      continue;
    }
    const v = cleanScalar(raw);
    if (v !== undefined) out[key] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function cleanEvent(event: XtreamEvent): XtreamEvent | null {
  if (!event || typeof event.to !== "string" || !event.to || typeof event.name !== "string" || !event.name) return null;
  const data = cleanEventData(event.data);
  if (data && Buffer.byteLength(JSON.stringify(data)) > DATA_MAX_BYTES) return null;
  return data ? { to: event.to, name: event.name, data } : { to: event.to, name: event.name };
}

/** A test's partial mock of socials-relay must not turn into a throw in someone's route. */
function enabled() {
  try {
    return socialsRelayEnabled();
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let queue: XtreamEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
const pending = new Set<Promise<void>>();
/** One warning per failure kind per minute, so a gateway that's down doesn't flood the log. */
const warnedAt = new Map<string, number>();

function warn(key: string, message: string) {
  const now = Date.now();
  if (now - (warnedAt.get(key) ?? 0) < 60_000) return;
  warnedAt.set(key, now);
  console.warn(message);
}

/**
 * Queue events for the gateway. Returns at once, never throws; a no-op
 * without the gateway configured (local dev).
 */
export function publishXtreamEvents(events: XtreamEvent[]) {
  try {
    if (!enabled() || !Array.isArray(events) || events.length === 0) return;
    for (const event of events) {
      const clean = cleanEvent(event);
      if (!clean) continue;
      if (queue.length >= XTREAM_QUEUE_MAX) {
        warn("full", "Xtream events queue full; dropping events until it drains.");
        break;
      }
      queue.push(clean);
    }
    schedule();
  } catch (error) {
    console.error("Xtream events publish failed:", error);
  }
}

function schedule() {
  if (timer || queue.length === 0 || inFlight >= MAX_IN_FLIGHT) return;
  timer = setTimeout(pump, XTREAM_BATCH_WINDOW_MS);
  timer.unref?.();
}

function pump() {
  timer = null;
  while (queue.length > 0 && inFlight < MAX_IN_FLIGHT) {
    const batch = queue.splice(0, XTREAM_BATCH_MAX);
    inFlight++;
    const run = deliver(batch).finally(() => {
      inFlight--;
      pending.delete(run);
      // Whatever queued behind this call goes now — it already waited.
      if (queue.length > 0 && !timer) pump();
    });
    pending.add(run);
  }
}

async function deliver(batch: XtreamEvent[]) {
  const body = JSON.stringify({ events: batch });
  for (let attempt = 0; ; attempt++) {
    try {
      await postSigned(XTREAM_EVENTS_PATH, body);
      return;
    } catch (error) {
      if (error instanceof RelayRejected) {
        // Not deployed yet (404), or a batch the gateway won't take. Saying
        // it again won't help; clients still have their backstop poll.
        warn(`rejected:${error.status}`, `Xtream events refused by the gateway (${error.status}); not retrying.`);
        return;
      }
      const delay = RELAY_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        warn("failed", `Xtream events undelivered after retries: ${String(error)}`);
        return;
      }
      await sleep(delay);
    }
  }
}

/** Tests: wait until everything queued so far has been delivered (or given up on). */
export async function drainXtreamEvents() {
  for (let i = 0; i < 100 && (timer || pending.size > 0 || queue.length > 0); i++) {
    if (timer) {
      clearTimeout(timer);
      pump();
    }
    await Promise.all([...pending]);
  }
}

/** Tests: start from an empty queue. */
export function resetXtreamEvents() {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
  inFlight = 0;
  pending.clear();
  warnedAt.clear();
}

/* ── What happened, in one line at each call site ───────────────────── */

type Id = { toString(): string };
interface StreamLike {
  _id: unknown;
  streamerId: unknown;
  title?: string;
  category?: string;
  practice?: boolean;
}
interface BattleLike {
  _id: unknown;
  hostStreamId: unknown;
  challengerStreamId: unknown;
  practice?: boolean;
}

/** Run an async lookup-and-publish without letting it touch the caller. */
function detached(what: string, work: () => Promise<void>) {
  if (!enabled()) return;
  void (async () => {
    try {
      await work();
    } catch (error) {
      console.error(`Xtream ${what} event failed:`, error);
    }
  })();
}

async function authUserIdOf(userId: unknown) {
  const u = await User.findById(userId).select("authUserId").lean();
  return (u as { authUserId?: string } | null)?.authUserId || null;
}

/**
 * A stream went live: everyone hears it on the public channel, and the
 * streamer's own devices hear `live: started` (the studio on another device
 * stops showing "go live"). Never a practice run.
 */
export function xtreamStreamStarted(stream: StreamLike, streamer: { authUserId?: string; username?: string }) {
  try {
    if (stream.practice) return;
    const streamId = String(stream._id);
    publishXtreamEvents([
      { to: "all", name: "stream.started", data: { streamId, username: streamer.username ?? null, title: stream.title ?? null, category: stream.category ?? null } },
      ...(streamer.authUserId ? [{ to: streamer.authUserId, name: "live", data: { state: "started", streamId } }] : []),
    ]);
  } catch (error) {
    console.error("Xtream stream.started event failed:", error);
  }
}

/** A stream ended, from wherever it ended: the public channel and the streamer's devices. */
export function xtreamStreamEnded(stream: StreamLike) {
  if (stream.practice) return;
  const streamId = String(stream._id);
  publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId } }]);
  detached("live ended", async () => {
    const to = await authUserIdOf(stream.streamerId);
    if (to) publishXtreamEvents([{ to, name: "live", data: { state: "ended", streamId } }]);
  });
}

/** Renamed or recategorised mid-broadcast — the same moment the room hears `details`. */
export function xtreamStreamUpdated(stream: StreamLike) {
  if (stream.practice) return;
  publishXtreamEvents([
    { to: "all", name: "stream.updated", data: { streamId: String(stream._id), title: stream.title ?? null, category: stream.category ?? null } },
  ]);
}

/** A battle's clock started, or the battle is over (settled or cancelled once running). Never a practice battle. */
export function xtreamBattle(kind: "started" | "ended", battle: BattleLike) {
  if (battle.practice) return;
  publishXtreamEvents([
    {
      to: "all",
      name: `battle.${kind}`,
      data: { battleId: String(battle._id), streamIds: [String(battle.hostStreamId), String(battle.challengerStreamId)] },
    },
  ]);
}

/** What happened to a battle, for the people in it (their own channels). */
export type BattleChange = "invited" | "accepted" | "declined" | "withdrawn" | "expired" | "matched" | "cancelled" | "lapsed";

interface BattleParties extends BattleLike {
  hostId: unknown;
  challengerId: unknown;
  hostPartnerId?: unknown;
  challengerPartnerId?: unknown;
}

/**
 * A battle changed for the creators in it — both hosts, and a 2v2's
 * partners: each one's own channel hears `battle { battleId, change }`, and
 * their studio's battle panel reads /battles/mine again. Ids only, never
 * the battle itself, so nothing here can drift from the real view. It
 * reaches them off the room too (a creator not live, a booking), where the
 * room's own packets can't. Never a practice battle.
 */
export function xtreamBattleChange(battle: BattleParties, change: BattleChange) {
  if (battle.practice) return;
  const ids = [...new Set([battle.hostId, battle.challengerId, battle.hostPartnerId, battle.challengerPartnerId].filter(Boolean).map(String))];
  if (ids.length === 0) return;
  detached("battle change", async () => {
    const users = await User.find({ _id: { $in: ids } }).select("authUserId").lean();
    const battleId = String(battle._id);
    publishXtreamEvents(
      (users as Array<{ authUserId?: string }>).flatMap((u) => (u.authUserId ? [{ to: u.authUserId, name: "battle", data: { battleId, change } }] : [])),
    );
  });
}

/** What the gateway takes as a battle's channel name. */
const BATTLE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A gift counted in a battle: the battle's own channel
 * (`xtream:battle:<id>`, message "gift") hears it with both new totals, for
 * anyone watching the battle from outside its rooms (the Home battles row's
 * clash view). Only those who open that view subscribe. Points, never money
 * (the score is gift value in cents, already public on the battle); flat,
 * like every event. Never a practice battle.
 */
export function xtreamBattleGift(
  battle: BattleLike,
  gift: { id: string; side: "host" | "challenger"; usdMinor: number; giftName: string; emoji: string; sender: { userId: string; displayName: string }; at: string },
  totals: { host: number; challenger: number },
) {
  if (battle.practice) return;
  const battleId = String(battle._id);
  if (!BATTLE_ID.test(battleId)) return;
  publishXtreamEvents([
    {
      to: `battle:${battleId}`,
      name: "gift",
      data: {
        id: gift.id,
        side: gift.side,
        points: gift.usdMinor,
        giftName: gift.giftName,
        emoji: gift.emoji,
        senderId: gift.sender.userId,
        senderName: gift.sender.displayName,
        at: gift.at,
        hostPoints: totals.host,
        challengerPoints: totals.challenger,
      },
    },
  ]);
}

/**
 * The phone cam (`cam-<userId>`) joined or left a room: the streamer's own
 * devices hear it, so "Use this phone" and the studio's camera slot follow
 * at once. Not for a practice run.
 */
export function xtreamCameraChanged(roomName: string, identity: string, livekitEvent: string) {
  const connected =
    livekitEvent === "participant_joined"
      ? true
      : livekitEvent === "participant_left" || livekitEvent === "participant_connection_aborted"
        ? false
        : null;
  if (connected === null || !identity.startsWith("cam-")) return;
  detached("camera", async () => {
    const stream = await Stream.findOne({ livekitRoomName: roomName, isLive: true }).select("_id streamerId practice").lean();
    if (!stream || (stream as { practice?: boolean }).practice) return;
    if (String(stream.streamerId) !== identity.slice("cam-".length)) return;
    const to = await authUserIdOf(stream.streamerId);
    if (to) {
      publishXtreamEvents([
        { to, name: "live", data: { state: "camera", streamId: String(stream._id), secondCameraConnected: connected } },
      ]);
    }
  });
}

interface NotificationLike {
  _id: Id;
  userId: Id;
  type: string;
}

/**
 * Notification rows were just written: each recipient's own channel hears
 * `notification { kind, id }` so their bell refetches. Takes whatever
 * `Notification.create` / `insertMany` resolved with. At most
 * NOTIFICATION_PUSH_CAP recipients per call.
 */
export function pushNotifications(created: NotificationLike | NotificationLike[] | null | undefined) {
  if (!created) return;
  const rows = (Array.isArray(created) ? created : [created]).filter((r) => r && r.userId).slice(0, NOTIFICATION_PUSH_CAP);
  if (rows.length === 0) return;
  detached("notification", async () => {
    const ids = [...new Set(rows.map((r) => String(r.userId)))];
    const users = await User.find({ _id: { $in: ids } }).select("authUserId").lean();
    const auth = new Map(
      (users as Array<{ _id: unknown; authUserId?: string }>).map((u) => [String(u._id), u.authUserId || ""]),
    );
    publishXtreamEvents(
      rows.flatMap((r) => {
        const to = auth.get(String(r.userId));
        return to ? [{ to, name: "notification", data: { kind: r.type, id: String(r._id) } }] : [];
      }),
    );
  });
}
