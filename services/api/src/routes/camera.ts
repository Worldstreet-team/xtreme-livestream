import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { createToken } from "../livekit.js";
import { Stream, User } from "../models.js";
import { cameraIdentity } from "../safety/roles.js";
import { reconcileStream } from "../stream-service.js";

/**
 * A second phone as a camera (Phase 3, angles): the creator scans a code
 * shown in the studio, and the phone — no app, no sign-in — joins the live
 * room as `cam-<hostId>`, the same account, publishing its camera and
 * nothing else: no mic, and it subscribes to nothing. The host decides what
 * the program shows (`scene.angle`: main, phone or both); viewers can pin
 * an angle for themselves on their own screen.
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

/** Spend the code: the phone that joined on it is the phone cam now. */
export function consumeCameraLink(code: string, now = Date.now()) {
  const link = links.get(code);
  if (link) link.usedAt = now;
}

/** Tests only: start from nothing. */
export function resetCameraLinks() {
  links.clear();
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

      const host = await User.findById(found.link.hostId).select("username displayName").lean();
      if (!host) throw new ApiError(404, "There's no channel behind this code", "USER_NOT_FOUND");
      const hostName = host.displayName || host.username;

      // A practice run counts: it's the crew's own phone, in the crew's own room.
      const stream = await Stream.findOne({ streamerId: host._id, isLive: true });
      if (!stream || !(await reconcileStream(stream))) {
        // Not an error the phone gives up on: it holds the code and asks
        // again in a moment, and the code stays good until it expires.
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
      consumeCameraLink(code);

      return {
        success: true,
        data: { token, livekitUrl: config.LIVEKIT_URL, streamId: String(stream._id), hostName },
      };
    },
  );
};
