import {
  AccessToken,
  IngressClient,
  IngressInput,
  RoomServiceClient,
  WebhookReceiver,
} from "livekit-server-sdk";
import { config } from "./config.js";
import type { IUser } from "./models.js";

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
 * RTMP ingress for external encoders (OBS, vMix, Streamlabs, ffmpeg):
 * LiveKit hands back a server URL + stream key the broadcaster pastes into
 * their encoder; the ingress then joins the room as a publishing
 * participant, so viewer counting and the rest of the pipeline see it like
 * any publisher.
 *
 * One ingress per ACCOUNT, not per stream. It is minted the first time the
 * streamer needs it and then re-pointed at each new room with
 * updateIngress, so the key set in OBS once keeps working for every
 * broadcast — and an encoder that drops mid-stream reconnects on the same
 * key into the same room. Between broadcasts it points at a standby room
 * nobody watches, so a stray push goes nowhere.
 */

export interface UserIngress {
  ingressId: string;
  url: string;
  streamKey: string;
  createdAt: Date;
}

const standbyRoom = (userId: string) => `standby-${userId}`;
const encoderIdentity = (userId: string) => `obs-${userId}`;

/** RTMP for any encoder; WHIP for OBS 30+ and others that speak WebRTC out. */
export type IngressProtocol = "rtmp" | "whip";
const ingressField = (protocol: IngressProtocol) => (protocol === "whip" ? "whipIngress" : "obsIngress");

async function mintIngress(
  userId: string,
  displayName: string,
  roomName: string,
  protocol: IngressProtocol = "rtmp",
): Promise<UserIngress> {
  // WHIP goes straight through, untranscoded — LiveKit's default for WHIP,
  // made explicit: it's free, and the qualities viewers get are the ones the
  // encoder sends (OBS 32.1+ sends several; older OBS sends one).
  const ingress = await ingressClient.createIngress(protocol === "whip" ? IngressInput.WHIP_INPUT : IngressInput.RTMP_INPUT, {
    name: encoderIdentity(userId),
    roomName,
    participantIdentity: encoderIdentity(userId),
    participantName: displayName,
    ...(protocol === "whip" ? { enableTranscoding: false } : {}),
  });
  return {
    ingressId: ingress.ingressId,
    url: ingress.url ?? "",
    streamKey: ingress.streamKey ?? "",
    createdAt: new Date(),
  };
}

/**
 * The account's ingress, pointed at `roomName` (or its standby room). Mints
 * one if the account has none yet, or if LiveKit no longer knows the one on
 * record; persists whatever it ends up with on the user.
 */
export async function ensureUserIngress(
  user: IUser,
  roomName?: string,
  protocol: IngressProtocol = "rtmp",
): Promise<UserIngress> {
  const userId = user._id.toString();
  const target = roomName ?? standbyRoom(userId);
  const field = ingressField(protocol);
  const current = user[field];
  if (current?.ingressId) {
    try {
      await ingressClient.updateIngress(current.ingressId, {
        name: encoderIdentity(userId),
        roomName: target,
        participantIdentity: encoderIdentity(userId),
        participantName: user.displayName,
      });
      return current;
    } catch {
      // Gone on LiveKit's side (server reset, manual delete): mint again.
    }
  }
  const fresh = await mintIngress(userId, user.displayName, target, protocol);
  user[field] = fresh;
  await user.save();
  return fresh;
}

/** A new key for the account — the old one stops working immediately. */
export async function rotateUserIngress(user: IUser, protocol: IngressProtocol = "rtmp"): Promise<UserIngress> {
  const field = ingressField(protocol);
  const current = user[field];
  if (current?.ingressId) await deleteIngress(current.ingressId);
  user[field] = undefined;
  return ensureUserIngress(user, undefined, protocol);
}

/** LiveKit's ingress status, in the studio's words (ENDPOINT_COMPLETE reads as not sending). */
const INGRESS_STATUS = ["inactive", "buffering", "publishing", "error", "inactive"] as const;

/**
 * What an encoder is sending right now, as LiveKit's ingress sees it: its
 * status, and the input's bitrate, size and frame rate. Null when LiveKit
 * doesn't know the ingress.
 */
export async function ingressReading(ingressId: string, protocol: IngressProtocol) {
  const [info] = await ingressClient.listIngress({ ingressId });
  if (!info) return null;
  const state = info.state;
  const video = state?.video && state.video.width > 0 ? state.video : null;
  const audio = state?.audio && state.audio.averageBitrate > 0 ? state.audio : null;
  return {
    at: Date.now(),
    protocol,
    status: INGRESS_STATUS[state?.status ?? 0] ?? "inactive",
    error: state?.error ?? "",
    video: video
      ? { codec: video.mimeType, kbps: Math.round(video.averageBitrate / 1000), width: video.width, height: video.height, fps: Math.round(video.framerate) }
      : null,
    audio: audio ? { codec: audio.mimeType, kbps: Math.round(audio.averageBitrate / 1000) } : null,
  };
}

/** Best-effort ingress teardown — only for rotation now; streams never delete theirs. */
export async function deleteIngress(ingressId: string) {
  try {
    await ingressClient.deleteIngress(ingressId);
  } catch {
    // Already gone, or LiveKit unreachable — nothing left to do.
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

/**
 * Flip a connected participant's publish rights at runtime — the mechanism
 * behind stage guests. Viewers join with canPublish: false tokens; when the
 * host approves a join request the API upgrades the *participant* (not the
 * token), and LiveKit pushes the new grant to their client. Revoking works
 * the same way, and LiveKit unpublishes the participant's tracks itself when
 * publish permission is withdrawn.
 *
 * Permissions are applied atomically server-side, so every grant we want the
 * participant to keep must be restated here — sending only { canPublish }
 * would strip canSubscribe and mute their player.
 */
export async function setParticipantPublishPermission(
  roomName: string,
  identity: string,
  canPublish: boolean,
) {
  await roomService.updateParticipant(roomName, identity, {
    permission: {
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    },
  });
}

export async function isBroadcasterConnected(
  roomName: string,
  broadcasterIdentity: string,
) {
  try {
    const participants = await roomService.listParticipants(roomName);
    // A stream is "fed" if either the browser publisher or the RTMP
    // encoder (obs-<id>) is in the room.
    return participants.some(
      (participant) =>
        participant.identity === broadcasterIdentity ||
        participant.identity === `obs-${broadcasterIdentity}`,
    );
  } catch {
    return false;
  }
}

/**
 * Whether this exact identity has a session in the room right now. A host
 * who rejoined — or took the stream over from another device — can be back
 * in before the old session's leave webhook arrives; that leave is not a
 * drop. Errs towards "no", which only means the hold starts a beat early.
 */
export async function isIdentityInRoom(roomName: string, identity: string) {
  try {
    const participants = await roomService.listParticipants(roomName);
    return participants.some((participant) => participant.identity === identity);
  } catch {
    return false;
  }
}

/**
 * The room's metadata carries the live scene, so a viewer joining mid-stream
 * draws the host's layout from their first frame (the data event only
 * reaches whoever is already in). Best-effort, like sendRoomData.
 */
export async function setRoomScene(roomName: string, scene: unknown) {
  try {
    await roomService.updateRoomMetadata(roomName, JSON.stringify({ scene }));
  } catch (error) {
    const msg = String((error as Error)?.message ?? error);
    if (!/not.?found|does not exist/i.test(msg)) {
      console.error(`LiveKit updateRoomMetadata ${roomName} failed:`, msg);
    }
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
/**
 * Fan-out to some of the room only — held chat lines go to the host and
 * moderators, never to the viewers they're held from. Best-effort, like
 * sendRoomData.
 */
export async function sendRoomDataTo(
  roomName: string,
  identities: string[],
  payload: Record<string, unknown>,
) {
  if (!roomName || identities.length === 0) return;
  try {
    await roomService.sendData(
      roomName,
      new TextEncoder().encode(JSON.stringify(payload)),
      0, // DataPacket_Kind.RELIABLE
      { destinationIdentities: identities },
    );
  } catch (error) {
    const msg = String((error as Error)?.message ?? error);
    if (!/not.?found|does not exist/i.test(msg)) {
      console.error(`LiveKit sendData (targeted) ${roomName} failed:`, msg);
    }
  }
}

/** Close a room, disconnecting everyone in it — a takedown. Best-effort. */
export async function closeRoom(roomName: string) {
  if (!roomName) return;
  try {
    await roomService.deleteRoom(roomName);
  } catch (error) {
    const msg = String((error as Error)?.message ?? error);
    if (!/not.?found|does not exist/i.test(msg)) {
      console.error(`LiveKit deleteRoom ${roomName} failed:`, msg);
    }
  }
}

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
