import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "../errors.js";
import { isIdentityInRoom, roomService, sendRoomData, webhookReceiver } from "../livekit.js";
import { Stream, type IStream } from "../models.js";
import {
  accrueViewerSeconds,
  feedIdentity,
  holdForReconnect,
  markFeedBack,
  markStreamEnded,
} from "../stream-service.js";
import { closeWatchSession, openWatchSession } from "../watch-sessions.js";
import { recordViewers } from "../analytics.js";
import { isCameraIdentity, isConsoleIdentity } from "../safety/roles.js";
import { evictStalePreview, isPreviewIdentity } from "../preview.js";
import { forgetSecondCamera } from "./camera.js";

/**
 * How long a stage guest — asking, backstage or on stage — who drops out of
 * the room keeps their place: a reload, or a phone switching networks, is
 * back inside it, and the page puts them back where they were.
 */
export const GUEST_GRACE = { ms: 20_000 };
/** One pending check per room and guest: another leave inside the window doesn't stack a second. */
const guestChecks = new Map<string, ReturnType<typeof setTimeout>>();

/** Free a dropped guest's place once the grace is up — unless they're back by then. A second drop starts the grace again. */
function releaseGuestLater(roomName: string, identity: string) {
  const key = `${roomName}:${identity}`;
  const pending = guestChecks.get(key);
  if (pending) clearTimeout(pending);
  guestChecks.set(
    key,
    setTimeout(() => {
      guestChecks.delete(key);
      void releaseGuestIfGone(roomName, identity).catch((error) => console.error("guest release failed:", error));
    }, GUEST_GRACE.ms),
  );
}

/**
 * A restart forgets the grace timers: once a grace has passed after one,
 * any guest listed on a live stream who isn't in its room is freed, as their
 * timer would have done.
 */
export function startGuestReconcile() {
  setTimeout(() => void reconcileGuests().catch((error) => console.error("guest reconcile failed:", error)), GUEST_GRACE.ms + 5_000);
}

export async function reconcileGuests() {
  const streams = await Stream.find({ isLive: true, "guests.0": { $exists: true } }).select("guests livekitRoomName").lean();
  for (const s of streams) {
    const roster = await roomService.listParticipants(s.livekitRoomName).catch(() => null);
    if (!roster) continue;
    const here = new Set(roster.map((p) => p.identity));
    for (const g of s.guests ?? []) {
      if (!here.has(String(g.userId))) await releaseGuestIfGone(s.livekitRoomName, String(g.userId));
    }
  }
}

async function releaseGuestIfGone(roomName: string, identity: string) {
  if (await isIdentityInRoom(roomName, identity)) return;
  const stream = await Stream.findOne({ livekitRoomName: roomName, isLive: true });
  const guest = stream?.guests?.find((g) => String(g.userId) === identity);
  if (!stream || !guest) return;
  await Stream.updateOne({ _id: stream._id }, { $pull: { guests: { userId: guest.userId } } });
  void sendRoomData(stream.livekitRoomName, {
    __evt: "guest_update",
    action: "left",
    userId: identity,
    username: guest.username,
  });
}

/**
 * Refresh a live stream's current/peak viewer counts and bank the viewer-time
 * accrued at the previous count. Viewer count is the room's participant count
 * minus the broadcaster.
 *
 * The room roster is queried rather than trusting the event's
 * `numParticipants`, which is a snapshot taken at event time, ambiguous for
 * `participant_left` (it may or may not still include the leaver), and blind
 * to who in the room is a feed or crew rather than audience.
 */
async function updateViewerCounts(stream: IStream, roster?: Array<{ identity: string }> | null) {
  let viewers: number | undefined;

  try {
    // A roster the caller already read (a leave checks who's in first) saves asking twice.
    const list = roster ?? (await roomService.listParticipants(stream.livekitRoomName));
    const bid = stream.streamerId.toString();
    // Neither the browser publisher nor the RTMP encoder (obs-<id>) is a
    // viewer — an OBS stream has both in the room at once.
    viewers = list.filter(
      (p) =>
        p.identity !== bid &&
        p.identity !== `obs-${bid}` &&
        p.identity !== `mon-${bid}` &&
        // A producer's console (producer mode) is crew, not audience.
        !isConsoleIdentity(p.identity) &&
        // The host's phone cam (cam-<id>) is a feed, like the encoder.
        !isCameraIdentity(p.identity),
    ).length;
  } catch {
    // No roster: the room's headcount can't tell the audience from the feeds
    // and the crew (the encoder, a monitor, a console, the phone cam), so the
    // count stands until the next roster rather than jump.
    return;
  }

  if (viewers === undefined) return;

  accrueViewerSeconds(stream);

  stream.viewers = viewers;
  if (viewers > stream.peakViewers) stream.peakViewers = viewers;
  await stream.save();
  // The audience curve: the most seen this minute (live analytics).
  if (stream.startedAt) await recordViewers(stream._id, stream.startedAt, viewers).catch(() => {});
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/webhooks/livekit",
    {
      schema: {
        tags: ["Webhooks"],
        summary: "Receive signed LiveKit events",
        hide: true,
      },
      config: {
        rawBody: true,
        rateLimit: false,
      },
    },
    async (request) => {
      const body =
        typeof request.rawBody === "string"
          ? request.rawBody
          : request.rawBody?.toString("utf8");
      const authorization = request.headers.authorization;

      if (!body) {
        throw new ApiError(400, "Webhook body is required", "INVALID_WEBHOOK");
      }

      let event;
      try {
        event = await webhookReceiver.receive(body, authorization);
      } catch {
        throw new ApiError(
          401,
          "Invalid webhook signature",
          "INVALID_WEBHOOK_SIGNATURE",
        );
      }

      const roomName = event.room?.name;
      if (!roomName) return { success: true };

      // The phone cam coming or going changes what /user/me says about it.
      const who = event.participant?.identity;
      if (who && isCameraIdentity(who)) forgetSecondCamera(who);

      if (event.event === "room_finished") {
        const stream = await Stream.findOne({
          livekitRoomName: roomName,
          isLive: true,
        });
        // A room can empty out while its feed is reconnecting (the studio
        // tab closed, viewers gave up); the encoder's push or the host's
        // rejoin recreates it. Inside the grace window that is a pause, not
        // an end.
        if (stream && !(await holdForReconnect(stream))) {
          await markStreamEnded(stream);
        }
      } else if (event.event === "participant_joined") {
        const identity = event.participant?.identity;
        const stream = await Stream.findOne({
          livekitRoomName: roomName,
          isLive: true,
        });
        const bid = stream?.streamerId.toString();
        // The feed is back — the encoder, or the host's browser rejoining:
        // clear the drop and tell the room.
        if (stream && identity === feedIdentity(stream)) {
          await markFeedBack(stream);
        }
        // A practice preview's viewer on a link that's since been stopped
        // or replaced (a kept token): out again at once.
        if (stream && identity && isPreviewIdentity(identity)) {
          void evictStalePreview(stream, identity).catch(() => {});
        }
        if (
          stream &&
          identity &&
          identity !== bid &&
          identity !== `obs-${bid}` &&
          identity !== `mon-${bid}` &&
          !isConsoleIdentity(identity) &&
          // The phone cam arriving is a second feed, not an arrival.
          !isCameraIdentity(identity)
        ) {
          // The identity is the viewer's user id. Recording it is what turns
          // "how many are watching" into "who watches what", which every
          // personalised row depends on. Never let it fail the webhook.
          void openWatchSession(stream, identity).catch((error) =>
            console.error("watch session open failed:", error),
          );
          await updateViewerCounts(stream);
        }
      } else if (
        event.event === "participant_left" ||
        event.event === "participant_connection_aborted"
      ) {
        const identity = event.participant?.identity;
        if (identity) {
          const stream = await Stream.findOne({
            livekitRoomName: roomName,
            isLive: true,
          });
          if (stream) {
            // For an OBS stream the ENCODER is the feed — the dashboard
            // browser coming and going must not end the broadcast. For
            // browser streams it's the opposite.
            if (identity === feedIdentity(stream)) {
              // A new session under the same identity is already in: the
              // host rejoined or moved the stream to another device, and
              // this is the old session leaving. Nothing dropped.
              if (await isIdentityInRoom(roomName, identity)) {
                return { success: true };
              }
              // A dropped feed is a reconnect in progress, not an end: the
              // encoder comes straight back on its persistent key, the
              // studio rejoins on its own. The stream stays live for the
              // grace window and viewers are told what's happening.
              if (!(await holdForReconnect(stream))) {
                await markStreamEnded(stream);
              }
            } else {
              // A reload or a new tab: the same identity is already back in,
              // and this is its old session leaving — not the person. One
              // read of the room answers that and the count below.
              const roster = await roomService.listParticipants(roomName).catch(() => null);
              const back = roster?.some((p) => p.identity === identity) ?? false;
              if (!back) {
                void closeWatchSession(stream, identity).catch((error) =>
                  console.error("watch session close failed:", error),
                );
              }
              // A stage guest who drops (tab closed, network died) can't call
              // the leave endpoint — their place is freed so the stage
              // doesn't fill with ghosts, but only once the grace is up: a
              // reload is back inside it, and the page restores them.
              if (!back && stream.guests?.some((g) => String(g.userId) === identity)) {
                releaseGuestLater(roomName, identity);
              }
              await updateViewerCounts(stream, roster);
            }
          }
        }
      }

      return { success: true };
    },
  );
};
