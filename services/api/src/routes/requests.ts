import crypto from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  orderRequestBodySchema,
  requestOrderParamsSchema,
  requestsMenuBodySchema,
  requestsOpenBodySchema,
  streamIdParamsSchema,
  type RequestItem,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { unfeatureMessage, writeFeatured } from "../featured.js";
import { sendRoomData } from "../livekit.js";
import { RequestOrder, Stream, User, type IUser } from "../models.js";
import { completeRequest, orderRequest, RequestError, requestFeatured, requestView, skipRequest } from "../requests.js";
import { checkMessage, NEW_ACCOUNT_MS } from "../safety/filter.js";
import { roleIn } from "../safety/roles.js";
import { reconcileStream } from "../stream-service.js";
import { assertNotBanned } from "./moderation.js";

/**
 * Paid requests (Phase 2): each creator writes and prices their own menu
 * (a song, a chart, a shout-out), opens it while live, and works through a
 * queue in the studio. The money waits in the treasury until the host says
 * done — skipped, or left waiting when the stream ends, it goes back.
 * The escrow itself is requests.ts.
 */

/** A menu item's id: readable, and unique within the menu. */
function itemId(title: string, taken: Set<string>) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "item";
  let id = base;
  while (taken.has(id)) id = `${base}-${crypto.randomBytes(2).toString("hex")}`;
  taken.add(id);
  return id;
}

function menuOf(user: Pick<IUser, "requestsMenu">): RequestItem[] {
  return (user.requestsMenu ?? []).map((i) => ({ id: i.id, title: i.title, priceUsdMinor: i.priceUsdMinor, prompt: i.prompt ?? "" }));
}

export const requestRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** Tell the room what's on the menu and whether it's open — the viewers' Requests tab follows it. */
  function announceMenu(room: string, open: boolean, items: RequestItem[]) {
    void sendRoomData(room, { __evt: "requests_menu", open: open && items.length > 0, items });
  }

  app.get(
    "/users/me/requests-menu",
    {
      schema: {
        tags: ["Requests"],
        summary: "Your requests menu — what viewers can pay you to do",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      return { success: true, data: { items: menuOf(dbUser) } };
    },
  );

  app.put(
    "/users/me/requests-menu",
    {
      schema: {
        tags: ["Requests"],
        summary: "Write your requests menu (up to eight items, $1–$1,000 each)",
        security: [{ bearerAuth: [] }],
        body: requestsMenuBodySchema,
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      // Kept ids stay (a viewer mid-order still finds the item); new ones get one.
      const taken = new Set(request.body.items.flatMap((i) => (i.id ? [i.id] : [])));
      if (taken.size !== request.body.items.filter((i) => i.id).length) {
        throw new ApiError(400, "Two items share an id", "DUPLICATE_ITEM");
      }
      const items = request.body.items.map((i) => ({
        id: i.id ?? itemId(i.title, taken),
        title: i.title,
        priceUsdMinor: i.priceUsdMinor,
        prompt: i.prompt,
      }));
      await User.updateOne({ _id: dbUser._id }, { $set: { requestsMenu: items } });

      // Live with the menu open: the room sees the new menu at once.
      const live = await Stream.findOne({ streamerId: dbUser._id, isLive: true }).select("livekitRoomName requestsOpen").lean();
      if (live) {
        if (items.length === 0 && live.requestsOpen) await Stream.updateOne({ _id: live._id }, { $set: { requestsOpen: false } });
        announceMenu(live.livekitRoomName, Boolean(live.requestsOpen), items);
      }
      return { success: true, data: { items } };
    },
  );

  app.get(
    "/streams/:id/requests-menu",
    {
      schema: {
        tags: ["Requests"],
        summary: "What this stream's host takes requests for, and whether they're taking them now",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id).select("streamerId isLive requestsOpen").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      const streamer = await User.findById(stream.streamerId).select("requestsMenu").lean();
      const items = streamer ? menuOf(streamer) : [];
      return { success: true, data: { open: Boolean(stream.isLive && stream.requestsOpen && items.length > 0), items } };
    },
  );

  app.post(
    "/streams/:id/requests/open",
    {
      schema: {
        tags: ["Requests"],
        summary: "Start or stop taking requests (the host, while live)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: requestsOpenBodySchema,
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("streamerId isLive livekitRoomName");
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      if (!stream.streamerId.equals(dbUser._id)) throw new ApiError(403, "Only the host opens requests", "NOT_HOST");
      if (!stream.isLive) throw new ApiError(409, "Go live first", "NOT_LIVE");
      const items = menuOf(dbUser);
      if (request.body.open && items.length === 0) {
        throw new ApiError(400, "Add something to your menu first", "EMPTY_MENU");
      }
      await Stream.updateOne({ _id: stream._id }, { $set: { requestsOpen: request.body.open } });
      announceMenu(stream.livekitRoomName, request.body.open, items);
      return { success: true, data: { open: request.body.open, items } };
    },
  );

  app.post(
    "/streams/:id/requests",
    {
      schema: {
        tags: ["Requests"],
        summary: "Pay for something on the host's menu — refunded in full if it isn't done",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: orderRequestBodySchema,
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const viewer = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      if (!(await reconcileStream(stream))) throw new ApiError(400, "Stream is not live", "STREAM_OFFLINE");
      if (stream.streamerId.equals(viewer.dbUser._id)) throw new ApiError(400, "That's your own menu", "SELF_REQUEST");
      if (!stream.requestsOpen) throw new ApiError(409, "The host isn't taking requests right now", "REQUESTS_CLOSED");
      await assertNotBanned(stream._id, viewer.dbUser._id);

      const streamer = await User.findById(stream.streamerId);
      if (!streamer) throw new ApiError(404, "Streamer not found", "USER_NOT_FOUND");

      // The note goes on screen if the host puts the request up: it meets
      // the room's chat rules before any money moves.
      const note = request.body.note;
      if (note) {
        const createdAt = (viewer.dbUser as { createdAt?: Date }).createdAt;
        const verdict = checkMessage(note, streamer.settings?.profanityFilter === false ? null : (streamer.safety ?? {}), {
          shield: Boolean(stream.shield?.on),
          newAccount: createdAt ? Date.now() - new Date(createdAt).getTime() < NEW_ACCOUNT_MS : false,
        });
        if (verdict) {
          throw new ApiError(422, "That note goes against this room's chat rules — try different words", "NOTE_BLOCKED");
        }
      }

      const headerKey = request.headers["idempotency-key"];
      const idempotencyKey = (typeof headerKey === "string" && headerKey.trim()) || crypto.randomUUID();
      try {
        const order = await orderRequest({ stream, streamer, viewer, itemId: request.body.itemId, note, idempotencyKey });
        return { success: true, data: { order: requestView(order) } };
      } catch (error) {
        if (error instanceof RequestError) throw new ApiError(error.status, error.message, error.code);
        request.log.error({ err: error }, "request order failed");
        throw new ApiError(500, "Could not place the request — you have not been charged", "REQUEST_FAILED");
      }
    },
  );

  app.get(
    "/streams/:id/requests",
    {
      schema: {
        tags: ["Requests"],
        summary: "The request queue (the host and moderators), or your own requests (a viewer)",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("streamerId").lean();
      if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      const streamer = await User.findById(stream.streamerId).select("safety").lean();
      const role = streamer ? roleIn(streamer, dbUser._id) : null;
      const mine = role ? {} : { viewerId: dbUser._id };
      const [pending, decided] = await Promise.all([
        RequestOrder.find({ streamId: stream._id, status: "pending", ...mine }).sort({ createdAt: 1 }).limit(100),
        RequestOrder.find({ streamId: stream._id, status: { $ne: "pending" }, ...mine }).sort({ decidedAt: -1 }).limit(20),
      ]);
      return {
        success: true,
        data: { role: role ?? "viewer", pending: pending.map(requestView), decided: decided.map(requestView) },
      };
    },
  );

  /** The host's own stream, and the order on it. */
  async function hostOrder(streamId: string, orderId: string, userId: IUser["_id"]) {
    const stream = await Stream.findById(streamId).select("streamerId isLive livekitRoomName");
    if (!stream) throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
    if (!stream.streamerId.equals(userId)) throw new ApiError(403, "Only the host decides requests", "NOT_HOST");
    const order = await RequestOrder.findOne({ _id: orderId, streamId: stream._id });
    if (!order) throw new ApiError(404, "Request not found", "REQUEST_NOT_FOUND");
    return { stream, order };
  }

  app.post(
    "/streams/:id/requests/:orderId/done",
    {
      schema: {
        tags: ["Requests"],
        summary: "Done — the money reaches you, less the usual commission",
        security: [{ bearerAuth: [] }],
        params: requestOrderParamsSchema,
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { stream, order } = await hostOrder(request.params.id, request.params.orderId, dbUser._id);
      if (order.status !== "pending") throw new ApiError(409, "That request has already been decided", "ALREADY_DECIDED");
      const done = await completeRequest(order._id, stream._id);
      if (!done) throw new ApiError(409, "That request has already been decided", "ALREADY_DECIDED");
      await unfeatureMessage(stream._id, String(order._id)).catch(() => {});
      return { success: true, data: { order: requestView(done) } };
    },
  );

  app.post(
    "/streams/:id/requests/:orderId/skip",
    {
      schema: {
        tags: ["Requests"],
        summary: "Skip — the viewer is refunded in full",
        security: [{ bearerAuth: [] }],
        params: requestOrderParamsSchema,
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { stream, order } = await hostOrder(request.params.id, request.params.orderId, dbUser._id);
      if (order.status !== "pending") throw new ApiError(409, "That request has already been decided", "ALREADY_DECIDED");
      const skipped = await skipRequest(order._id, "skipped", stream._id);
      if (!skipped) throw new ApiError(409, "That request has already been decided", "ALREADY_DECIDED");
      await unfeatureMessage(stream._id, String(order._id)).catch(() => {});
      return { success: true, data: { order: requestView(skipped) } };
    },
  );

  app.post(
    "/streams/:id/requests/:orderId/feature",
    {
      schema: {
        tags: ["Requests"],
        summary: "Put a waiting request on screen while you do it",
        security: [{ bearerAuth: [] }],
        params: requestOrderParamsSchema,
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { stream, order } = await hostOrder(request.params.id, request.params.orderId, dbUser._id);
      if (order.status !== "pending") throw new ApiError(409, "That request has already been decided", "ALREADY_DECIDED");
      const scene = await writeFeatured(stream._id, requestFeatured(order));
      if (!scene) throw new ApiError(409, "Go live first", "NOT_LIVE");
      return { success: true, data: { scene } };
    },
  );

  app.delete(
    "/streams/:id/requests/:orderId/feature",
    {
      schema: {
        tags: ["Requests"],
        summary: "Take a request off screen",
        security: [{ bearerAuth: [] }],
        params: requestOrderParamsSchema,
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { stream, order } = await hostOrder(request.params.id, request.params.orderId, dbUser._id);
      const scene = await unfeatureMessage(stream._id, String(order._id));
      return { success: true, data: { scene } };
    },
  );
};
