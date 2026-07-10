import {
  AccessToken,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";
import { config } from "./config.js";

const livekitHost = config.LIVEKIT_URL.replace(/^wss:/, "https:").replace(
  /^ws:/,
  "http:",
);

export const roomService = new RoomServiceClient(
  livekitHost,
  config.LIVEKIT_API_KEY,
  config.LIVEKIT_API_SECRET,
);

export const webhookReceiver = new WebhookReceiver(
  config.LIVEKIT_API_KEY,
  config.LIVEKIT_API_SECRET,
);

export async function createToken(
  roomName: string,
  participantIdentity: string,
  participantName: string,
  options: {
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
    roomCreate?: boolean;
  } = {},
) {
  const {
    canPublish = false,
    canSubscribe = true,
    canPublishData = true,
    roomCreate = false,
  } = options;

  const token = new AccessToken(
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
    {
      identity: participantIdentity,
      name: participantName,
      ttl: "6h",
    },
  );

  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate,
    canPublish,
    canSubscribe,
    canPublishData,
  });

  return token.toJwt();
}

export async function isBroadcasterConnected(
  roomName: string,
  broadcasterIdentity: string,
) {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.some(
      (participant) => participant.identity === broadcasterIdentity,
    );
  } catch {
    return false;
  }
}
