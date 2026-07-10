import type { FastifyPluginAsync } from "fastify";
import { ApiError } from "../errors.js";
import { webhookReceiver } from "../livekit.js";
import { Stream } from "../models.js";
import { markStreamEnded } from "../stream-service.js";

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
          if (stream && stream.streamerId.toString() === identity) {
            await markStreamEnded(stream);
          }
        }
      }

      return { success: true };
    },
  );
};
