import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

const LIVEKIT_URL = process.env.LIVEKIT_URL!;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY!;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET!;

// Convert wss:// to https:// for the REST API
const livekitHost = LIVEKIT_URL.replace("wss://", "https://");

export const roomService = new RoomServiceClient(
  livekitHost,
  LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET
);

/**
 * Generate a LiveKit access token for a participant.
 */
export async function createToken(
  roomName: string,
  participantIdentity: string,
  participantName: string,
  options: {
    canPublish?: boolean;
    canSubscribe?: boolean;
    canPublishData?: boolean;
    roomCreate?: boolean;
  } = {}
): Promise<string> {
  const {
    canPublish = false,
    canSubscribe = true,
    canPublishData = true,
    roomCreate = false,
  } = options;

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: participantIdentity,
    name: participantName,
    ttl: "6h",
  });

  at.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate,
    canPublish,
    canSubscribe,
    canPublishData,
  });

  return await at.toJwt();
}

/**
 * Create a LiveKit room.
 */
export async function createRoom(roomName: string) {
  return await roomService.createRoom({
    name: roomName,
    emptyTimeout: 5 * 60, // 5 mins after everyone leaves
    maxParticipants: 10000,
  });
}

/**
 * Delete a LiveKit room.
 */
export async function deleteRoom(roomName: string) {
  try {
    await roomService.deleteRoom(roomName);
  } catch {
    // Room may already be gone — that's fine
  }
}

/**
 * Get participant count for a room.
 */
export async function getParticipantCount(roomName: string): Promise<number> {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.length;
  } catch {
    return 0;
  }
}
