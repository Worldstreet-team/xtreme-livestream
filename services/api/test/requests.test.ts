import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Paid requests: the viewer's money waits in the treasury. Done pays the
 * creator their share and books a gift; skipped or expired refunds the
 * viewer in full; a request is decided once, and a refund the wallet
 * couldn't take is retried by the sweep.
 */

const HOST = "a".repeat(24);
const VIEWER = "b".repeat(24);
const STREAM = "d".repeat(24);
const ENDED = "e".repeat(24);

const oid = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  orders: [] as Row[],
  charges: [] as Row[],
  refunds: [] as Row[],
  refundFails: false,
  chargeFails: "" as string,
  createFails: false,
  payouts: [] as Row[],
  gifts: [] as Row[],
  earnings: 0,
  chat: [] as Row[],
  goal: [] as Array<{ kind: string; amount: number }>,
  notifications: [] as Row[],
  toHost: [] as Array<{ to: string[]; payload: Row }>,
  toRoom: [] as Row[],
  live: new Set<string>(),
  n: 0,
  treasury: true,
}));

function orderDoc(fields: Row): Row {
  const d: Row = {
    refund: { status: "none", attempts: 0, lastError: "" },
    decidedAt: null,
    createdAt: new Date(),
    ...fields,
  };
  d.save = async () => d;
  return d;
}

const matches = (o: Row, filter: Row) =>
  Object.entries(filter).every(([k, v]) => {
    if (k === "_id") return String(o._id) === String(v);
    if (k === "streamId") return String(o.streamId) === String(v);
    if (k === "status" && v && typeof v === "object" && "$in" in v) return (v.$in as string[]).includes(o.status);
    if (k === "refund.status") return o.refund.status === v;
    if (k === "refund.attempts") return o.refund.attempts < v.$lt;
    return o[k] === v;
  });

vi.mock("../src/config.js", () => ({ config: { WALLET_TREASURY_USER_ID: "clerk_treasury", GIFT_COMMISSION_PERCENT: 20 } }));
vi.mock("../src/wallet.js", () => ({
  isTreasuryConfigured: () => state.treasury,
  chargeWalletWithSplit: async (args: Row) => {
    if (state.chargeFails) return { ok: false, code: state.chargeFails, message: "no" };
    state.charges.push(args);
    return { ok: true, data: { charge: { id: `ch_${state.charges.length}` } } };
  },
  refundWalletCharge: async (args: Row) => {
    if (state.refundFails) return { ok: false, code: "UNREACHABLE", message: "down" };
    state.refunds.push(args);
    return { ok: true, data: {} };
  },
}));
vi.mock("../src/rewards.js", () => ({ attemptPayout: async (p: Row) => void (p.status = "paid") }));
vi.mock("../src/battles.js", () => ({ applyBattleGift: async () => null }));
vi.mock("../src/goals.js", () => ({
  bumpGoal: async (_id: unknown, kind: string, amount: number) => void state.goal.push({ kind, amount }),
  bumpHeat: async () => null,
}));
vi.mock("../src/livekit.js", () => ({
  sendRoomData: async (_room: string, payload: Row) => void state.toRoom.push(payload),
  sendRoomDataTo: async (_room: string, to: string[], payload: Row) => void state.toHost.push({ to, payload }),
}));
vi.mock("../src/models.js", () => ({
  RequestOrder: {
    findOne: async (filter: Row) => state.orders.find((o) => matches(o, filter)) ?? null,
    create: async (fields: Row) => {
      if (state.createFails) throw new Error("db down");
      const d = orderDoc({ _id: oid(String(++state.n).padStart(24, "0")), ...fields });
      state.orders.push(d);
      return d;
    },
    findOneAndUpdate: async (filter: Row, update: { $set: Row }) => {
      const o = state.orders.find((x) => matches(x, filter));
      if (!o) return null;
      Object.assign(o, update.$set);
      return o;
    },
    find: (filter: Row) => {
      const rows = state.orders.filter((o) => matches(o, filter));
      const chain = { select: () => chain, limit: () => chain, lean: async () => rows, then: (r: (v: Row[]) => unknown) => r(rows) };
      return chain;
    },
    distinct: async (_field: string, filter: Row) => [...new Set(state.orders.filter((o) => matches(o, filter)).map((o) => String(o.streamId)))],
  },
  Stream: {
    findById: (id: unknown) => {
      const s = { _id: oid(String(id)), livekitRoomName: `room-${String(id)}`, title: "Friday", isLive: state.live.has(String(id)) };
      const chain = { select: () => chain, lean: async () => s, then: (r: (v: Row) => unknown) => r(s) };
      return chain;
    },
    find: (filter: { _id: { $in: string[] } }) => ({
      select: () => ({ lean: async () => filter._id.$in.filter((id) => state.live.has(String(id))).map((id) => ({ _id: id })) }),
    }),
  },
  User: {
    findById: (id: unknown) => {
      const u = { _id: id, authUserId: String(id) === VIEWER ? "clerk_viewer" : "clerk_host", username: "wole", displayName: "Wole", createdAt: new Date(0) };
      const chain = { select: () => chain, lean: async () => u };
      return chain;
    },
    updateOne: async (_f: unknown, update: { $inc: { earningsUsdMinor: number } }) => void (state.earnings += update.$inc.earningsUsdMinor),
  },
  Payout: { create: async (row: Row) => (state.payouts.push(row), row) },
  GiftTransaction: { create: async (row: Row) => (state.gifts.push(row), row) },
  ChatMessage: { create: async (row: Row) => (state.chat.push(row), { _id: "m1", ...row }) },
  Notification: { create: async (row: Row) => (state.notifications.push(row), row) },
}));

const requests = await import("../src/requests.js");

const streamer = {
  _id: oid(HOST),
  username: "wole",
  requestsMenu: [{ id: "song", title: "Song", priceUsdMinor: 500, prompt: "Which song?" }],
  safety: { mods: [{ userId: "f".repeat(24), role: "mod" }] },
};
const stream = { _id: oid(STREAM), livekitRoomName: `room-${STREAM}` };
const viewer = { dbUser: { _id: oid(VIEWER), username: "ada", avatar: "" }, authUserId: "clerk_viewer" };

const order = (key = "k1", itemId = "song", s = stream) =>
  requests.orderRequest({ stream: s as never, streamer: streamer as never, viewer: viewer as never, itemId, note: "Last Last", idempotencyKey: key });

beforeEach(() => {
  Object.assign(state, {
    orders: [], charges: [], refunds: [], refundFails: false, chargeFails: "", createFails: false,
    payouts: [], gifts: [], earnings: 0, chat: [], goal: [], notifications: [], toHost: [], toRoom: [],
    live: new Set([STREAM]), n: 0, treasury: true,
  });
});

describe("ordering", () => {
  it("holds the whole price in the treasury and tells the host and moderators", async () => {
    const o = await order();
    expect(state.charges).toHaveLength(1);
    expect(state.charges[0]).toMatchObject({
      spenderClerkUserId: "clerk_viewer",
      recipientClerkUserId: "clerk_treasury",
      amountUsdMinor: 500,
      recipientAmountUsdMinor: 500,
    });
    expect(o).toMatchObject({ status: "pending", title: "Song", note: "Last Last", priceUsdMinor: 500, walletChargeId: "ch_1" });
    expect(state.toHost[0]!.to).toEqual([HOST, `mon-${HOST}`, "f".repeat(24)]);
    expect(state.toHost[0]!.payload).toMatchObject({ __evt: "request", order: { title: "Song", status: "pending" } });
  });

  it("charges once for a replayed key", async () => {
    const a = await order("same");
    const b = await order("same");
    expect(b).toBe(a);
    expect(state.charges).toHaveLength(1);
  });

  it("turns away an item that isn't on the menu, an empty wallet and a missing treasury", async () => {
    await expect(order("k", "nope")).rejects.toMatchObject({ status: 404, code: "ITEM_NOT_FOUND" });
    state.chargeFails = "INSUFFICIENT_BALANCE";
    await expect(order("k2")).rejects.toMatchObject({ status: 402 });
    state.chargeFails = "";
    state.treasury = false;
    await expect(order("k3")).rejects.toMatchObject({ status: 503, code: "REQUESTS_UNAVAILABLE" });
    expect(state.charges).toHaveLength(0);
  });

  it("puts the money back when the request can't be written", async () => {
    state.createFails = true;
    await expect(order()).rejects.toThrow("db down");
    expect(state.refunds).toEqual([{ clerkUserId: "clerk_viewer", chargeId: "ch_1", reason: "request bookkeeping failed" }]);
  });
});

describe("deciding", () => {
  it("done pays the creator their share and books a gift, once", async () => {
    const o = await order();
    const done = await requests.completeRequest(o._id, stream._id as never);
    expect(done?.status).toBe("done");
    expect(state.payouts).toEqual([expect.objectContaining({ kind: "request", usdMinor: 400, refId: o._id })]);
    expect(state.gifts[0]).toMatchObject({ grossUsdMinor: 500, commissionUsdMinor: 100, netUsdMinor: 400, giftName: "Request: Song", idempotencyKey: `request:${String(o._id)}` });
    expect(state.earnings).toBe(400);
    expect(state.chat[0]).toMatchObject({ content: "requested Song: Last Last", type: "tip", tipAmount: "5.00", emoji: "🎟️" });
    expect(state.goal).toEqual([{ kind: "gifts", amount: 500 }]);

    // Neither a second done nor a skip after it moves any money.
    expect(await requests.completeRequest(o._id, stream._id as never)).toBeNull();
    expect(await requests.skipRequest(o._id, "skipped")).toBeNull();
    expect(state.payouts).toHaveLength(1);
    expect(state.refunds).toHaveLength(0);
  });

  it("skipped refunds the viewer in full and tells them", async () => {
    const o = await order();
    const skipped = await requests.skipRequest(o._id, "skipped", stream._id as never);
    expect(skipped).toMatchObject({ status: "skipped", refund: { status: "refunded", attempts: 1 } });
    expect(state.refunds).toEqual([{ clerkUserId: "clerk_viewer", chargeId: "ch_1", reason: "request skipped" }]);
    expect(state.notifications[0]).toMatchObject({ type: "request_refunded", link: "/wallet", streamTitle: "Song · $5.00 back in your wallet" });
    expect(requests.requestView(skipped as never)).toMatchObject({ status: "skipped", refunded: true });

    // Decided once: no second refund, and no payout after it.
    expect(await requests.skipRequest(o._id, "skipped")).toBeNull();
    expect(await requests.completeRequest(o._id, stream._id as never)).toBeNull();
    expect(state.refunds).toHaveLength(1);
    expect(state.payouts).toHaveLength(0);
  });
});

describe("the sweep", () => {
  it("refunds what was waiting on a stream that ended, and leaves live ones alone", async () => {
    const live = await order("live");
    const gone = await order("gone", "song", { _id: oid(ENDED), livekitRoomName: `room-${ENDED}` });
    await requests.sweepRequests();
    expect(live.status).toBe("pending");
    expect(gone).toMatchObject({ status: "expired", refund: { status: "refunded" } });
    expect(state.refunds).toHaveLength(1);
  });

  it("retries a refund the wallet couldn't take", async () => {
    const o = await order();
    state.refundFails = true;
    await requests.skipRequest(o._id, "skipped");
    expect(o.refund).toMatchObject({ status: "failed", attempts: 1 });
    expect(state.notifications[0]!.streamTitle).toBe("Song · $5.00 on its way back");

    state.refundFails = false;
    await requests.sweepRequests();
    expect(o.refund).toMatchObject({ status: "refunded", attempts: 2, lastError: "" });
    await requests.sweepRequests();
    expect(state.refunds).toHaveLength(1);
  });
});

describe("on screen", () => {
  it("shows what was asked, for whom, and what it paid", async () => {
    const o = await order();
    expect(requests.requestFeatured(o as never, 0)).toMatchObject({
      id: String(o._id),
      kind: "request",
      username: "ada",
      text: "Song",
      note: "Last Last",
      amount: "5.00",
      currency: "USD",
      until: null,
      auto: false,
    });
  });
});
