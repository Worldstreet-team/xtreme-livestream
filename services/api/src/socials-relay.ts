import crypto from "node:crypto";
import { config } from "./config.js";
import { User, type IStream } from "./models.js";

// Relay stream lifecycle events to the WorldStreet Social gateway so a live
// stream exists as a first-class feed post. Fire-and-forget by design: the
// stream must never fail because the socials side is down. Authenticated with
// an HMAC over `${timestamp}.${body}` using a shared secret — Clerk tokens
// are deliberately not used here (service-minted tokens carry no azp claim
// and @clerk/backend 3.x rejects them when authorizedParties is configured).

export type LiveRelayKind = "started" | "ended";

export async function relayLiveEvent(kind: LiveRelayKind, stream: IStream) {
  if (!config.SOCIALS_GATEWAY_URL || !config.SOCIALS_WEBHOOK_SECRET) return;

  try {
    const streamer = await User.findById(stream.streamerId)
      .select("authUserId username displayName")
      .lean();
    if (!streamer?.authUserId) return;

    const body = JSON.stringify({
      streamId: String(stream._id),
      authUserId: streamer.authUserId,
      username: streamer.username,
      title: stream.title,
      category: stream.category,
      roomName: stream.livekitRoomName,
      startedAt: stream.startedAt,
      endedAt: stream.endedAt ?? null,
      peakViewers: stream.peakViewers ?? 0,
    });

    const timestamp = String(Date.now());
    const signature = crypto
      .createHmac("sha256", config.SOCIALS_WEBHOOK_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    await fetch(`${config.SOCIALS_GATEWAY_URL}/internal/live/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-ws-timestamp": timestamp,
        "x-ws-signature": signature,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Best-effort: a missed relay is recoverable (the reconciler or the next
    // event will converge); a failed stream start is not.
  }
}
