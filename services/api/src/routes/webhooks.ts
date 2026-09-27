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

/**
 * Refresh a live stream's current/peak viewer counts and bank the viewer-time
 * accrued at the previous count. Viewer count is the room's participant count
 * minus the broadcaster.
 *
 * The room roster is queried rather than trusting the event's
 * `numParticipants`, which is a snapshot taken at event time and is ambiguous
 * for `participant_left` (it may or may not still include the leaver).
 * `numParticipants` is the fallback when the roster lookup fails.
 */
async function updateViewerCounts(
  stream: IStream,
  numParticipants: number | undefined,
) {
  let viewers: number | undefined;

  try {
    const list = await roomService.listParticipants(stream.livekitRoomName);
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
    viewers =
      numParticipants === undefined
        ? undefined
        : Math.max(0, numParticipants - 1);
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
          await updateViewerCounts(
            stream,
            event.room?.numParticipants,
          );
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
              void closeWatchSession(stream, identity).catch((error) =>
                console.error("watch session close failed:", error),
              );
              // A stage guest who disconnects (tab closed, network died)
              // can't call the leave endpoint — free their slot here so the
              // stage doesn't fill with ghosts, and tell the room.
              const guest = stream.guests?.find(
                (g) => String(g.userId) === identity,
              );
              if (guest) {
                await Stream.updateOne(
                  { _id: stream._id },
                  { $pull: { guests: { userId: guest.userId } } },
                );
                void sendRoomData(stream.livekitRoomName, {
                  __evt: "guest_update",
                  action: "left",
                  userId: identity,
                  username: guest.username,
                });
              }
              await updateViewerCounts(
                stream,
                event.room?.numParticipants,
              );
            }
          }
        }
      }

      return { success: true };
    },
  );
};
