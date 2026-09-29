import type mongoose from "mongoose";
import type { FeaturedItem, RequestOrderView } from "@xtreme/contracts";
import { applyBattleGift } from "./battles.js";
import { chatPayload } from "./chat.js";
import { config } from "./config.js";
import { bumpGoal, bumpHeat } from "./goals.js";
import { sendRoomData, sendRoomDataTo } from "./livekit.js";
import {
  ChatMessage,
  GiftTransaction,
  Notification,
  Payout,
  RequestOrder,
  Stream,
  User,
  type IRequestOrder,
  type IStream,
  type IUser,
} from "./models.js";
import { attemptPayout } from "./rewards.js";
import { moderatorIdentities } from "./safety/roles.js";
import { chargeWalletWithSplit, isTreasuryConfigured, refundWalletCharge } from "./wallet.js";
import { pushNotifications } from "./xtream-events.js";

/**
 * Paid requests (Phase 2). The viewer's money goes to the platform's
 * treasury, not the creator, while a request waits — so a skip can always
 * be refunded in full, whatever the creator has done with their balance
 * since (the owner's call: skipped requests are refunded).
 *
 * - done: the creator is paid their share from the treasury (a payout row
 *   first, then the wallet, retried by the payout sweep), and from then on
 *   it's a gift like any other — the chat line, goals, the heat meter, a
 *   battle's score, histories.
 * - skipped, or expired with the stream: the charge is refunded; a refund
 *   the wallet can't take now is retried by the sweep here.
 *
 * Every decision is one conditional write on `status: "pending"`, so a
 * request can't be both done and refunded, or refunded twice.
 */

export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export function requestView(o: IRequestOrder): RequestOrderView {
  return {
    id: String(o._id),
    itemId: o.itemId,
    title: o.title,
    note: o.note,
    priceUsdMinor: o.priceUsdMinor,
    status: o.status,
    refunded: o.refund?.status === "refunded",
    viewer: { userId: String(o.viewerId), username: o.viewerUsername, avatar: o.viewerAvatar },
    createdAt: new Date(o.createdAt).toISOString(),
    decidedAt: o.decidedAt ? new Date(o.decidedAt).toISOString() : null,
  };
}

/** A request on screen while the host does it: what, for whom, and what it paid. */
export function requestFeatured(o: IRequestOrder, now = Date.now()): FeaturedItem {
  return {
    id: String(o._id),
    kind: "request",
    userId: String(o.viewerId),
    username: o.viewerUsername,
    avatar: o.viewerAvatar,
    text: o.title,
    emoji: "🎟️",
    amount: (o.priceUsdMinor / 100).toFixed(2),
    currency: "USD",
    at: new Date(now).toISOString(),
    until: null,
    auto: false,
    ...(o.note ? { note: o.note } : {}),
  };
}

/** The host and their moderators hear about a new request; the viewer about theirs. */
function tellHost(stream: Pick<IStream, "livekitRoomName">, streamer: Parameters<typeof moderatorIdentities>[0], order: IRequestOrder) {
  void sendRoomDataTo(stream.livekitRoomName, moderatorIdentities(streamer), { __evt: "request", order: requestView(order) });
}
function tellViewer(stream: Pick<IStream, "livekitRoomName">, order: IRequestOrder) {
  void sendRoomDataTo(stream.livekitRoomName, [String(order.viewerId)], { __evt: "request_update", order: requestView(order) });
}

/** A viewer asks for something off the menu: the money moves to the treasury and waits. */
export async function orderRequest(params: {
  stream: IStream;
  streamer: IUser;
  viewer: { dbUser: IUser; authUserId: string };
  itemId: string;
  note: string;
  idempotencyKey: string;
}) {
  const { stream, streamer, viewer, itemId, note, idempotencyKey } = params;
  const existing = await RequestOrder.findOne({ idempotencyKey });
  if (existing) return existing;
  if (!isTreasuryConfigured()) {
    throw new RequestError(503, "REQUESTS_UNAVAILABLE", "Requests aren't available right now");
  }
  const item = (streamer.requestsMenu ?? []).find((i) => i.id === itemId);
  if (!item) throw new RequestError(404, "ITEM_NOT_FOUND", "That's not on the menu any more");

  const charged = await chargeWalletWithSplit({
    spenderClerkUserId: viewer.authUserId,
    recipientClerkUserId: config.WALLET_TREASURY_USER_ID,
    amountUsdMinor: item.priceUsdMinor,
    // Held whole in the treasury: nothing is commission until it's done.
    recipientAmountUsdMinor: item.priceUsdMinor,
    description: `Request (${item.title}) for @${streamer.username} — held until done`,
    idempotencyKey: `livestream:request:${idempotencyKey}`,
    metadata: { streamId: String(stream._id), streamerUsername: streamer.username, itemId, kind: "request_hold" },
  });
  if (!charged.ok) {
    if (charged.code === "INSUFFICIENT_BALANCE") {
      throw new RequestError(402, "INSUFFICIENT_BALANCE", "Not enough in your dollar wallet — top up to make this request");
    }
    if (charged.code === "UNREACHABLE" || charged.code === "NOT_CONFIGURED") {
      throw new RequestError(503, "WALLET_UNAVAILABLE", "The wallet service is unavailable");
    }
    throw new RequestError(502, charged.code, charged.message);
  }

  const chargeId = charged.data.charge?.id ?? "";
  try {
    const order = await RequestOrder.create({
      streamId: stream._id,
      streamerId: streamer._id,
      viewerId: viewer.dbUser._id,
      viewerUsername: viewer.dbUser.username,
      viewerAvatar: viewer.dbUser.avatar ?? "",
      itemId: item.id,
      title: item.title,
      note,
      priceUsdMinor: item.priceUsdMinor,
      status: "pending",
      walletChargeId: chargeId,
      idempotencyKey,
    });
    tellHost(stream, streamer, order);
    return order;
  } catch (error) {
    // The money moved but the request didn't land: put it back.
    if (chargeId) {
      await refundWalletCharge({ clerkUserId: viewer.authUserId, chargeId, reason: "request bookkeeping failed" }).catch(() => {});
    }
    throw error;
  }
}

/** Done: the creator's share leaves the treasury, and it counts as a gift from here on. */
export async function completeRequest(orderId: string | mongoose.Types.ObjectId, streamId: mongoose.Types.ObjectId) {
  const order = await RequestOrder.findOneAndUpdate(
    { _id: orderId, streamId, status: "pending" },
    { $set: { status: "done", decidedAt: new Date() } },
    { new: true },
  );
  if (!order) return null;

  const gross = order.priceUsdMinor;
  const commission = Math.floor((gross * config.GIFT_COMMISSION_PERCENT) / 100);
  const net = gross - commission;

  const payout = await Payout.create({ userId: order.streamerId, kind: "request", usdMinor: net, points: 0, refId: order._id, status: "pending" });
  await attemptPayout(payout).catch((e) => console.error("request payout failed:", e));

  const gift = await GiftTransaction.create({
    senderId: order.viewerId,
    streamerId: order.streamerId,
    streamId: order.streamId,
    giftName: `Request: ${order.title}`,
    emoji: "🎟️",
    grossUsdMinor: gross,
    commissionUsdMinor: commission,
    netUsdMinor: net,
    walletChargeId: order.walletChargeId,
    idempotencyKey: `request:${String(order._id)}`,
  });
  await User.updateOne({ _id: order.streamerId }, { $inc: { earningsUsdMinor: net } });

  const stream = await Stream.findById(order.streamId);
  if (stream) {
    const viewer = await User.findById(order.viewerId).select("createdAt").lean();
    await applyBattleGift(stream, gift, { _id: order.viewerId, ...(viewer?.createdAt ? { createdAt: viewer.createdAt } : {}) }).catch(() => {});
    const message = await ChatMessage.create({
      streamId: stream._id,
      userId: order.viewerId,
      username: order.viewerUsername,
      avatar: order.viewerAvatar,
      isMod: false,
      content: `requested ${order.title}${order.note ? `: ${order.note}` : ""}`,
      type: "tip",
      tipAmount: (gross / 100).toFixed(2),
      tipCurrency: "USD",
      emoji: "🎟️",
      platform: "xstream",
    });
    void sendRoomData(stream.livekitRoomName, chatPayload(message));
    await bumpGoal(stream._id, "gifts", gross).catch(() => {});
    await bumpHeat(stream).catch(() => {});
    tellViewer(stream, order);
  }
  return order;
}

/** Give a waiting request's money back: the charge into the treasury is refunded. */
async function refundOrder(order: IRequestOrder) {
  const viewer = await User.findById(order.viewerId).select("authUserId").lean();
  order.refund.attempts += 1;
  if (!viewer?.authUserId || !order.walletChargeId) {
    order.refund.status = "failed";
    order.refund.lastError = "no charge or wallet account to refund";
  } else {
    const result = await refundWalletCharge({ clerkUserId: viewer.authUserId, chargeId: order.walletChargeId, reason: `request ${order.status}` });
    order.refund.status = result.ok ? "refunded" : "failed";
    order.refund.lastError = result.ok ? "" : `${result.code}: ${result.message}`;
  }
  await order.save();
  return order;
}

/** Skipped by the host, or expired with the stream: refunded in full, and the viewer told. */
export async function skipRequest(orderId: string | mongoose.Types.ObjectId, reason: "skipped" | "expired", streamId?: mongoose.Types.ObjectId) {
  const order = await RequestOrder.findOneAndUpdate(
    { _id: orderId, status: "pending", ...(streamId ? { streamId } : {}) },
    { $set: { status: reason, decidedAt: new Date() } },
    { new: true },
  );
  if (!order) return null;
  await refundOrder(order);

  const stream = await Stream.findById(order.streamId).select("livekitRoomName title").lean();
  if (stream) tellViewer(stream as Pick<IStream, "livekitRoomName">, order);
  const streamer = await User.findById(order.streamerId).select("username displayName").lean();
  await Notification.create({
    userId: order.viewerId,
    type: "request_refunded",
    actorId: order.streamerId,
    actorName: streamer?.displayName || streamer?.username || "The host",
    streamId: order.streamId,
    streamTitle: `${order.title} · $${(order.priceUsdMinor / 100).toFixed(2)} ${order.refund.status === "refunded" ? "back in your wallet" : "on its way back"}`,
    link: "/wallet",
    read: false,
  }).then(pushNotifications, () => {});
  return order;
}

/** Everything still waiting on a stream that's over goes back to its viewers. */
export async function expireStreamRequests(streamId: mongoose.Types.ObjectId | string) {
  const waiting = await RequestOrder.find({ streamId, status: "pending" }).select("_id").limit(500).lean();
  for (const o of waiting) await skipRequest(o._id, "expired").catch((e) => console.error("request expiry failed:", e));
  return waiting.length;
}

/**
 * Once a minute: requests whose stream ended while they waited go back to
 * their viewers, and refunds the wallet couldn't take are tried again.
 */
export async function sweepRequests() {
  const streamIds = await RequestOrder.distinct("streamId", { status: "pending" });
  if (streamIds.length > 0) {
    const live = new Set((await Stream.find({ _id: { $in: streamIds }, isLive: true }).select("_id").lean()).map((s) => String(s._id)));
    for (const id of streamIds) if (!live.has(String(id))) await expireStreamRequests(id);
  }
  const unpaid = await RequestOrder.find({ status: { $in: ["skipped", "expired"] }, "refund.status": "failed", "refund.attempts": { $lt: 20 } }).limit(50);
  for (const o of unpaid) await refundOrder(o).catch((e) => console.error("request refund retry failed:", e));
}

export function startRequestSweep() {
  setInterval(() => void sweepRequests().catch((e) => console.error("request sweep failed:", e)), 60_000);
}
