import {
  AccessToken,
  IngressClient,
  IngressInput,
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

export const ingressClient = new IngressClient(
  livekitHost,
  config.LIVEKIT_API_KEY,
  config.LIVEKIT_API_SECRET,
);

/**
 * RTMP ingress for external encoders (OBS, Streamlabs, ffmpeg): LiveKit
 * hands back a server URL + stream key the broadcaster pastes into their
 * encoder; the ingress then joins the room as a publishing participant, so
 * viewer counting and the rest of the pipeline see it like any publisher.
 */
export async function createRtmpIngress(
  roomName: string,
  identity: string,
  displayName: string,
) {
  const ingress = await ingressClient.createIngress(IngressInput.RTMP_INPUT, {
    name: `obs-${roomName}`,
    roomName,
    participantIdentity: identity,
    participantName: displayName,
  });
  return {
    ingressId: ingress.ingressId,
    url: ingress.url ?? "",
    streamKey: ingress.streamKey ?? "",
  };
}

/** Best-effort ingress teardown when a stream ends. */
export async function deleteIngress(ingressId: string) {
  try {
    await ingressClient.deleteIngress(ingressId);
  } catch {
    // Already gone, or LiveKit unreachable — either way the stream is over.
  }
}

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

/**
 * Server-side fan-out into a live room's data channel.
 *
 * Chat, tips and likes used to reach other viewers only via the *sender's*
 * client republishing over WebRTC — which silently delivered nothing when
 * the sender held a token without canPublishData (guests, cross-platform
 * viewers whose auth didn't resolve), and delivered nowhere at all for
 * server-initiated events like a wallet-charged gift. The API is the one
 * party that always has publish rights and already knows the room, so it is
 * the fan-out. Best-effort: chat must not fail because a data packet did.
 */
export async function sendRoomData(
  roomName: string,
  payload: Record<string, unknown>,
) {
  try {
    await roomService.sendData(
      roomName,
      new TextEncoder().encode(JSON.stringify(payload)),
      0, // DataPacket_Kind.RELIABLE
    );
  } catch (error) {
    const msg = String((error as Error)?.message ?? error);
    if (!/not.?found|does not exist/i.test(msg)) {
      console.error(`LiveKit sendData ${roomName} failed:`, msg);
    }
  }
}
