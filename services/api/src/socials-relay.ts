import type mongoose from "mongoose";
import crypto from "node:crypto";
import { config } from "./config.js";
import { Stream, User, type IStream } from "./models.js";

// Relay stream lifecycle events to the WorldStreet Social gateway so a live
// stream exists as a first-class feed post. Best-effort by design: the stream
// must never fail because the socials side is down. Authenticated with an
// HMAC over `${timestamp}.${body}` using a shared secret — Clerk tokens are
// deliberately not used here (service-minted tokens carry no azp claim and
// @clerk/backend 3.x rejects them when authorizedParties is configured).
//
// "ended" must eventually land or the socials feed shows the stream as live
// forever, so a missed relay converges through two layers: in-process retries
// with backoff here, and a periodic sweep that re-relays "ended" for streams
// still flagged `socialsRelayPending` (the gateway endpoint is idempotent).

export type LiveRelayKind = "started" | "ended" | "battle";

/** Backoff before each retry; length bounds the in-process attempts. */
export const RELAY_RETRY_DELAYS_MS = [1_000, 5_000, 15_000];

export const RELAY_SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Streams flagged pending longer than this are abandoned by the sweep — a
 * backstop so a doc the gateway permanently rejects isn't re-posted forever.
 */
export const RELAY_SWEEP_MAX_AGE_MS = 24 * 60 * 60_000;

const RELAY_SWEEP_BATCH = 20;

export function socialsRelayEnabled() {
  return Boolean(config.SOCIALS_GATEWAY_URL && config.SOCIALS_WEBHOOK_SECRET);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One signed POST. Timestamp and signature are minted per attempt so a
 *  retried request isn't rejected as a replay. Throws on non-2xx. */
/**
 * The gateway said no, and saying it again won't help. The common case is
 * a streamer with no WorldSpace account: plenty of people broadcast here
 * and nowhere else, and their stream must not leave a relay retrying for
 * a day. 408, 429 and every 5xx stay transient — those are worth a retry.
 */
class RelayRejected extends Error {
  constructor(readonly status: number) {
    super(`Socials gateway rejected the relay (${status})`);
    this.name = "RelayRejected";
  }
}

function permanent(status: number) {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function postLiveEvent(kind: LiveRelayKind, body: string) {
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac("sha256", config.SOCIALS_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const res = await fetch(`${config.SOCIALS_GATEWAY_URL}/internal/live/${kind}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ws-timestamp": timestamp,
      "x-ws-signature": signature,
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    if (permanent(res.status)) throw new RelayRejected(res.status);
    throw new Error(`Socials gateway responded ${res.status}`);
  }
}

/**
 * Tell WorldSpace a stream started or ended.
 *
 * Returns whether the relay is *settled* — delivered, or refused in a way
 * that will never succeed (no WorldSpace account, most often). Only a
 * gateway that might still come back returns false, which is what the
 * sweep uses to decide whether carrying on is worth it.
 */
export async function relayLiveEvent(kind: LiveRelayKind, stream: IStream) {
  if (!socialsRelayEnabled()) return false;

  try {
    const streamer = await User.findById(stream.streamerId)
      .select("authUserId username displayName")
      .lean();
    if (!streamer?.authUserId) return false;

    const body = JSON.stringify({
      streamId: String(stream._id),
      authUserId: streamer.authUserId,
      username: streamer.username,
      title: stream.title,
      category: stream.category,
      notifyFollowers: stream.notifyFollowers !== false,
      roomName: stream.livekitRoomName,
      startedAt: stream.startedAt,
      endedAt: stream.endedAt ?? null,
      peakViewers: stream.peakViewers ?? 0,
    });

    for (let attempt = 0; ; attempt++) {
      try {
        await postLiveEvent(kind, body);
        break;
      } catch (error) {
        if (error instanceof RelayRejected) {
          // Nothing on the other side to post to — most often no
          // WorldSpace account. Let go of it rather than retry for a day.
          console.warn(
            `Socials ${kind} relay rejected for ${String(stream._id)} (${error.status}); not retrying.`,
          );
          if (kind === "ended") {
            await Stream.updateOne(
              { _id: stream._id },
              { socialsRelayPending: false },
            );
          }
          return true;
        }
        const delay = RELAY_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) throw error;
        await sleep(delay);
      }
    }

    if (kind === "ended") {
      await Stream.updateOne(
        { _id: stream._id },
        { socialsRelayPending: false },
      );
    }
    return true;
  } catch (error) {
    // Best-effort: a failed "started" is cosmetic and a failed "ended" stays
    // flagged `socialsRelayPending`, so the sweep converges it.
    console.error(`Socials ${kind} relay failed for ${String(stream._id)}:`, error);
    return false;
  }
}

/**
 * A finished battle, for the Wolf of WorldStreet race. The socials side
 * owns the scoring; this only says who fought, who won and by how much.
 * Best-effort, one round of retries, never blocks settlement.
 */
export async function relayBattleResult(battle: {
  _id: unknown;
  hostId: mongoose.Types.ObjectId;
  challengerId: mongoose.Types.ObjectId;
  winnerId: mongoose.Types.ObjectId | null;
  hostUsdMinor: number;
  challengerUsdMinor: number;
  bonusUsdMinor: number;
  endsAt: Date | null;
}) {
  if (!socialsRelayEnabled()) return false;
  try {
    const users = await User.find({ _id: { $in: [battle.hostId, battle.challengerId] } })
      .select("authUserId username")
      .lean();
    const by = new Map(users.map((u) => [String(u._id), u]));
    const host = by.get(String(battle.hostId));
    const challenger = by.get(String(battle.challengerId));
    if (!host?.authUserId || !challenger?.authUserId) return false;
    const winner = battle.winnerId ? by.get(String(battle.winnerId)) : null;
    const body = JSON.stringify({
      battleId: String(battle._id),
      host: { authUserId: host.authUserId, username: host.username, usdMinor: battle.hostUsdMinor },
      challenger: { authUserId: challenger.authUserId, username: challenger.username, usdMinor: battle.challengerUsdMinor },
      winnerAuthUserId: winner?.authUserId ?? null,
      bonusUsdMinor: battle.bonusUsdMinor,
      endedAt: battle.endsAt,
    });
    for (let attempt = 0; ; attempt++) {
      try {
        await postLiveEvent("battle", body);
        return true;
      } catch (error) {
        const delay = RELAY_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) throw error;
        await sleep(delay);
      }
    }
  } catch (error) {
    console.error(`Socials battle relay failed for ${String(battle._id)}:`, error);
    return false;
  }
}

/**
 * Re-relay "ended" for streams whose relay never reached the gateway — the
 * API restarted mid-relay, or the gateway was down past the retry window.
 * Newest first, and bail the first time the gateway looks unreachable: the
 * rest would fail too, and the next sweep picks them all up. A stream the
 * gateway *refuses* is settled, not a failure, so the sweep moves past it.
 */
export async function sweepPendingEndRelays() {
  if (!socialsRelayEnabled()) return 0;

  const pending = await Stream.find({
    isLive: false,
    socialsRelayPending: true,
    endedAt: { $gte: new Date(Date.now() - RELAY_SWEEP_MAX_AGE_MS) },
  })
    .sort({ endedAt: -1 })
    .limit(RELAY_SWEEP_BATCH);

  let relayed = 0;
  for (const stream of pending) {
    if (!(await relayLiveEvent("ended", stream))) break;
    relayed++;
  }
  return relayed;
}

/**
 * Run the sweep now (a restart may have stranded pending relays) and then
 * every RELAY_SWEEP_INTERVAL_MS. Unref'd so it never holds the process open.
 */
export function startSocialsRelaySweep() {
  if (!socialsRelayEnabled()) return null;

  const run = () =>
    void sweepPendingEndRelays().catch((error) => {
      console.error("Socials relay sweep failed:", error);
    });

  run();
  const timer = setInterval(run, RELAY_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}
