import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { ControlScope } from "@xtreme/contracts";
import { ApiError } from "./errors.js";
import { ControlKey, User, type IControlKey, type IUser } from "./models.js";

/**
 * Control keys (Phase 3, control API): what a Stream Deck, Companion or a
 * script signs in with — sent as `Authorization: Bearer xck_…` or
 * `X-Xtream-Key: xck_…`. A key is shown once when it's made; only its
 * SHA-256 is kept, so a leaked database can't drive anyone's stream.
 */

const PREFIX = "xck_";

export const hashKey = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

/** A new key and what's kept of it. */
export function newControlKey() {
  const key = `${PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
  return { key, hash: hashKey(key), prefix: key.slice(0, PREFIX.length + 6) };
}

function presented(request: FastifyRequest) {
  const header = request.headers["x-xtream-key"];
  if (typeof header === "string" && header.startsWith(PREFIX)) return header.trim();
  const auth = request.headers.authorization;
  if (typeof auth === "string" && auth.startsWith(`Bearer ${PREFIX}`)) return auth.slice("Bearer ".length).trim();
  return null;
}

/** Last used, to the minute: enough for "used 4 min ago" without a write per press. */
const TOUCH_MS = 60_000;

/**
 * The key's owner, if the key is real and may do `scope`. Says what's
 * wrong in words a person setting up a Stream Deck button can act on.
 */
export async function authenticateControl(request: FastifyRequest, scope: ControlScope | null, now = Date.now()): Promise<{ owner: IUser; key: IControlKey }> {
  const key = presented(request);
  if (!key) throw new ApiError(401, "Send your control key as Authorization: Bearer xck_… (make one in Settings → Stream Deck & automation)", "CONTROL_KEY_MISSING");
  const found = await ControlKey.findOne({ hash: hashKey(key) });
  if (!found) throw new ApiError(401, "That control key isn't valid — it may have been removed", "CONTROL_KEY_INVALID");
  if (scope && !found.scopes.includes(scope)) {
    throw new ApiError(403, `This key can't do that — give it "${scope}" in Settings → Stream Deck & automation`, "CONTROL_KEY_SCOPE");
  }
  const owner = await User.findById(found.ownerId);
  if (!owner) throw new ApiError(401, "That control key's channel is gone", "CONTROL_KEY_INVALID");
  if (!found.lastUsedAt || now - new Date(found.lastUsedAt).getTime() > TOUCH_MS) {
    void ControlKey.updateOne({ _id: found._id }, { $set: { lastUsedAt: new Date(now) } }).catch(() => {});
  }
  return { owner, key: found };
}
