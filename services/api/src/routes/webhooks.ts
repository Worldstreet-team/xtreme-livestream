import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "../errors.js";
import { roomService, sendRoomData, webhookReceiver } from "../livekit.js";
import { Stream, type IStream } from "../models.js";
import { accrueViewerSeconds, markStreamEnded } from "../stream-service.js";

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
        p.identity !== `mon-${bid}`,
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
        if (stream) await markStreamEnded(stream);
      } else if (event.event === "participant_joined") {
        const identity = event.participant?.identity;
        const stream = await Stream.findOne({
          livekitRoomName: roomName,
          isLive: true,
        });
        const bid = stream?.streamerId.toString();
        if (
          stream &&
          identity &&
          identity !== bid &&
          identity !== `obs-${bid}` &&
          identity !== `mon-${bid}`
        ) {
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
            const bid = stream.streamerId.toString();
            // For an OBS stream the ENCODER is the feed — the dashboard
            // browser coming and going must not end the broadcast. For
            // browser streams it's the opposite.
            const feedLeft =
              stream.source === "obs"
                ? identity === `obs-${bid}`
                : identity === bid;
            if (feedLeft) {
              await markStreamEnded(stream);
            } else {
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
