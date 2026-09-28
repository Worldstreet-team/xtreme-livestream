import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { Types } from "mongoose";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { createToken, isIdentityInRoom } from "../livekit.js";
import { Stream, User } from "../models.js";
import { cameraIdentity, isCameraIdentity } from "../safety/roles.js";
import { reconcileStream } from "../stream-service.js";

/**
 * A second phone as a camera (Phase 3, angles): the creator scans a code
 * shown in the studio, and the phone — no app, no sign-in — joins the live
 * room as `cam-<hostId>`, the same account, publishing its camera and
 * nothing else: no mic, and it subscribes to nothing. The host places it in
 * the program like any other source (`scene.phoneSlot`: off, over their
 * picture, beside it, or in the corner — with `scene.angle` kept in step);
 * viewers can pin an angle for themselves on their own screen.
 *
 * The code is the whole handshake. It's one-time (the phone that joined on
 * it consumed it; a second phone needs a fresh one), lives ten minutes,
 * and stays valid while the phone waits for the host to go live — so a
 * phone set up before the show starts sending the moment the show does.
 *
 * In-process only, like practice runs: a bounded map of codes. A restart
 * forgets them, and the studio mints another in a tap.
 */

/** A pairing code lives this long unless a phone uses it first. */
export const CAMERA_LINK_TTL_MS = 10 * 60_000;
/** How long the phone waits before asking again when the host isn't live yet. */
export const CAMERA_RETRY_MS = 5_000;
/** Codes outstanding at once, across every creator: past this the oldest go first. */
const MAX_LINKS = 5_000;
/** Lowercase, no look-alikes (i, l, o, 0, 1): what someone types when the scan won't take. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_LENGTH = 10;

interface CameraLink {
  hostId: string;
  expiresAt: number;
  /** Set once a phone has joined on it: a second phone is refused, not paired. */
  usedAt: number | null;
}

const links = new Map<string, CameraLink>();

function randomCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return code;
}

/** Forget what's expired — and, should a raid mint thousands, the oldest. */
function sweep(now: number) {
  for (const [code, link] of links) if (link.expiresAt <= now) links.delete(code);
  while (links.size > MAX_LINKS) links.delete(links.keys().next().value!);
}

/**
 * A fresh code for this creator. Earlier codes of theirs stay good until
 * they expire: a phone already waiting on one mustn't be thrown off
 * because the studio asked for another.
 */
export function mintCameraLink(hostId: string, now = Date.now()) {
  sweep(now);
  let code = randomCode();
  while (links.has(code)) code = randomCode();
  const link: CameraLink = { hostId, expiresAt: now + CAMERA_LINK_TTL_MS, usedAt: null };
  links.set(code, link);
  return { code, expiresAt: link.expiresAt };
}

/** The link behind a code, or why there isn't one: never seen (or expired), or already spent. */
export function lookupCameraLink(code: string, now = Date.now()): { link: CameraLink } | { error: "invalid" | "used" } {
  sweep(now);
  const link = links.get(code);
  if (!link) return { error: "invalid" };
  if (link.usedAt !== null) return { error: "used" };
  return { link };
}

/**
 * Spend the code: the phone that joined on it is the phone cam now. Taken
 * the moment a join begins, before anything waits, so two phones racing on
 * one code can't both get a token.
 */
export function consumeCameraLink(code: string, now = Date.now()) {
  const link = links.get(code);
  if (link) link.usedAt = now;
}

/** A join that couldn't finish — the host isn't live yet, or the token failed — hands the code back. */
export function releaseCameraLink(code: string) {
  const link = links.get(code);
  if (link) link.usedAt = null;
}

/** Tests only: start from nothing. */
export function resetCameraLinks() {
  links.clear();
}

/**
 * Whether the creator's live stream has a phone camera in it right now —
 * what `GET /user/me` reports as `liveSecondCamera`, so a signed-in phone
 * (the WorldSpace app) can offer "Use this phone" while its owner is live
 * from somewhere else.
 *
 * - `null`: not live, or live from an encoder (the studio places no phone
 *   camera on an OBS stream). A practice run counts: it's their own phone.
 * - `{ streamId, connected }`: live; `connected` is whether `cam-<userId>`
 *   is in the room. To become that camera, mint a code with
 *   `POST /users/me/camera-link` and join on it (`POST /camera/:code/join`).
 *
 * One indexed read of the live stream, then — only while live — one roster
 * read from LiveKit, remembered a few seconds per creator so a polling
 * client costs little. The phone cam's own join or leave (the webhook)
 * forgets the answer at once.
 */
export interface LiveSecondCamera {
  streamId: string;
  connected: boolean;
}

/** How long a roster answer is reused. */
export const SECOND_CAMERA_TTL_MS = 5_000;
const secondCameraSeen = new Map<string, { at: number; value: LiveSecondCamera }>();

export async function liveSecondCamera(userId: Types.ObjectId | string, now = Date.now()): Promise<LiveSecondCamera | null> {
  const id = String(userId);
  const stream = await Stream.findOne({ streamerId: userId, isLive: true }).select("_id source livekitRoomName").lean();
  if (!stream || stream.source === "obs") {
    secondCameraSeen.delete(id);
    return null;
  }
  const streamId = String(stream._id);
  const seen = secondCameraSeen.get(id);
  if (seen && seen.value.streamId === streamId && now - seen.at < SECOND_CAMERA_TTL_MS) return seen.value;
  const connected = await isIdentityInRoom(stream.livekitRoomName, cameraIdentity(id));
  const value = { streamId, connected };
  secondCameraSeen.set(id, { at: now, value });
  // Bounded like the codes: one entry per creator who asked lately.
  if (secondCameraSeen.size > MAX_LINKS) secondCameraSeen.delete(secondCameraSeen.keys().next().value!);
  return value;
}

/** The phone cam came or went (webhooks.ts): the next read asks the room again. */
export function forgetSecondCamera(identity: string) {
  if (isCameraIdentity(identity)) secondCameraSeen.delete(identity.slice("cam-".length));
}

/** Tests only. */
export function resetSecondCameraSeen() {
  secondCameraSeen.clear();
}

/** Why a code won't do, in the phone's words. */
const linkError = (error: "invalid" | "used") =>
  error === "used"
    ? new ApiError(410, "This code has already been used — scan a fresh one in the studio", "CAMERA_LINK_USED")
    : new ApiError(404, "This link has expired — scan a fresh code in the studio", "CAMERA_LINK_INVALID");

const codeParamsSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9]{6,32}$/) });

export const cameraRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * What a scanned code is for, before the phone commits its camera: whose
   * second camera it would be, and whether they're live yet. Reads the code
   * without spending it.
   */
  app.get(
    "/camera/:code",
    {
      schema: {
        tags: ["Phone camera"],
        summary: "Whose camera a scanned code is for, and whether they're live — without spending the code",
        params: codeParamsSchema,
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const found = lookupCameraLink(request.params.code.toLowerCase());
      if ("error" in found) throw linkError(found.error);
      const host = await User.findById(found.link.hostId).select("username displayName").lean();
      if (!host) throw new ApiError(404, "There's no channel behind this code", "USER_NOT_FOUND");
      const stream = await Stream.findOne({ streamerId: host._id, isLive: true });
      const live = Boolean(stream && (await reconcileStream(stream)));
      return {
        success: true,
        data: { hostName: host.displayName || host.username, live, expiresAt: new Date(found.link.expiresAt).toISOString() },
      };
    },
  );

  app.post(
    "/users/me/camera-link",
    {
      schema: {
        tags: ["Phone camera"],
        summary: "A one-time code (ten minutes) for a second phone to join your live room as a camera",
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { code, expiresAt } = mintCameraLink(String(dbUser._id));
      return {
        success: true,
        data: { code, url: `/camera/${code}`, expiresAt: new Date(expiresAt).toISOString() },
      };
    },
  );

  app.post(
    "/camera/:code/join",
    {
      schema: {
        tags: ["Phone camera"],
        summary: "The phone's way in: trade a scanned code for a camera-only room token (no sign-in)",
        params: codeParamsSchema,
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const code = request.params.code.toLowerCase();
      const found = lookupCameraLink(code);
      if ("error" in found) throw linkError(found.error);
      // Spent now, before anything waits: a second phone racing on this code
      // is refused, not paired. A join that can't finish hands it back.
      consumeCameraLink(code);
      try {
        const host = await User.findById(found.link.hostId).select("username displayName").lean();
        if (!host) throw new ApiError(404, "There's no channel behind this code", "USER_NOT_FOUND");
        const hostName = host.displayName || host.username;

        // A practice run counts: it's the crew's own phone, in the crew's own room.
        const stream = await Stream.findOne({ streamerId: host._id, isLive: true });
        if (!stream || !(await reconcileStream(stream))) {
          // Not an error the phone gives up on: it holds the code and asks
          // again in a moment, and the code stays good until it expires.
          releaseCameraLink(code);
          return reply.code(409).send({
            success: false,
            code: "NOT_LIVE",
            message: `${hostName} isn't live yet — hold on`,
            retryInMs: CAMERA_RETRY_MS,
            hostName,
          });
        }

        // The camera and only the camera: the token itself refuses a mic or a
        // screen, and the phone hears nothing from the room.
        const token = await createToken(stream.livekitRoomName, cameraIdentity(host._id), `${hostName} · phone cam`, {
          canPublish: true,
          canSubscribe: false,
          canPublishData: false,
          canPublishSources: ["camera"],
        });

        return {
          success: true,
          data: { token, livekitUrl: config.LIVEKIT_URL, streamId: String(stream._id), hostName },
        };
      } catch (err) {
        releaseCameraLink(code);
        throw err;
      }
    },
  );
};
