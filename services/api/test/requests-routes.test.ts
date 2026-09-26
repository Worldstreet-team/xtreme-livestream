import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The request and Shout routes: only the host writes the menu, opens it and
 * decides; a viewer's note and a Shout's words meet the chat rules before
 * any money moves; a Shout is pinned for as long as its amount buys.
 */

const HOST = "a".repeat(24);
const VIEWER = "b".repeat(24);
const STREAM = "d".repeat(24);

const oid = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });
type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  caller: "",
  stream: {} as Row,
  menu: [] as Row[],
  orders: [] as Row[],
  charges: [] as Row[],
  refunds: [] as Row[],
  chat: [] as Row[],
  room: [] as Row[],
  userUpdates: [] as Row[],
  streamUpdates: [] as Row[],
}));

const chain = <T>(value: () => T) => {
  const c: Row = { select: () => c, lean: async () => value(), sort: () => c, limit: () => c };
  c.then = (resolve: (v: T) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(value()).then(resolve, reject);
  return c;
};

const user = (id: string) => ({
  _id: oid(id),
  username: id === HOST ? "wole" : "ada",
  avatar: "",
  authUserId: id === HOST ? "clerk_host" : "clerk_viewer",
  createdAt: new Date(0),
  requestsMenu: id === HOST ? state.menu : [],
  settings: {},
  safety: { mods: [] },
});

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: user(state.caller).authUserId, dbUser: user(state.caller) }),
  getOptionalAuthUserId: () => null,
}));

vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [] },
  ingressClient: {},
  webhookReceiver: { receive: async () => ({ event: "ignored" }) },
  createToken: async () => "token",
  ensureUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  rotateUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async () => false,
  setParticipantPublishPermission: async () => {},
  setRoomScene: async () => {},
  sendRoomData: async (_room: string, payload: Row) => void state.room.push(payload),
  sendRoomDataTo: async (_room: string, _to: string[], payload: Row) => void state.room.push(payload),
  closeRoom: async () => {},
}));

vi.mock("../src/wallet.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/wallet.js")>()),
  isWalletConfigured: () => true,
  isTreasuryConfigured: () => true,
  chargeWalletWithSplit: async (args: Row) => {
    state.charges.push(args);
    return { ok: true, data: { charge: { id: `ch_${state.charges.length}` } } };
  },
  refundWalletCharge: async (args: Row) => {
    state.refunds.push(args);
    return { ok: true, data: {} };
  },
}));

vi.mock("../src/fans.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/fans.js")>()),
  fanStatus: async () => null,
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: () => chain(() => state.stream),
    findOne: () => chain(() => (state.stream.isLive ? state.stream : null)),
    findOneAndUpdate: () => chain(() => null),
    updateOne: async (_f: unknown, update: Row) => {
      state.streamUpdates.push(update);
      Object.assign(state.stream, update.$set ?? {});
      return {};
    },
  },
  User: {
    findById: (id: unknown) => chain(() => user(String(id))),
    updateOne: async (_f: unknown, update: Row) => {
      state.userUpdates.push(update);
      if (update.$set?.requestsMenu) state.menu = update.$set.requestsMenu;
      return {};
    },
  },
  StreamBan: { findOne: async () => null },
  RequestOrder: {
    findOne: async (filter: Row) =>
      state.orders.find((o) => (!filter._id || String(o._id) === String(filter._id)) && (!filter.idempotencyKey || o.idempotencyKey === filter.idempotencyKey)) ?? null,
    create: async (fields: Row) => {
      const o: Row = { _id: oid(String(state.orders.length + 1).padStart(24, "0")), refund: { status: "none", attempts: 0, lastError: "" }, decidedAt: null, createdAt: new Date(), ...fields };
      o.save = async () => o;
      state.orders.push(o);
      return o;
    },
    findOneAndUpdate: async (filter: Row, update: Row) => {
      const o = state.orders.find((x) => String(x._id) === String(filter._id) && x.status === filter.status);
      if (!o) return null;
      Object.assign(o, update.$set);
      return o;
    },
    find: () => chain(() => []),
  },
  GiftTransaction: {
    findOne: async () => null,
    create: async (row: Row) => ({ _id: "g1", ...row }),
  },
  ChatMessage: {
    create: async (row: Row) => {
      const m = { _id: `m${state.chat.length + 1}`, ...row };
      state.chat.push(m);
      return m;
    },
  },
  Notification: { create: async () => ({}) },
  Payout: { create: async (row: Row) => row },
  Follow: {},
  StreamLike: {},
  Report: {},
}));

vi.mock("../src/rewards.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rewards.js")>()),
  attemptPayout: async () => {},
}));
vi.mock("../src/battles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/battles.js")>()),
  applyBattleGift: async () => null,
}));
vi.mock("../src/goals.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/goals.js")>()),
  bumpGoal: async () => null,
  bumpHeat: async () => null,
}));
vi.mock("../src/featured.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/featured.js")>()),
  autoFeatureGift: async () => null,
  unfeatureMessage: async () => null,
}));

const SONG = { id: "song", title: "Song", priceUsdMinor: 500, prompt: "Which song?" };

describe("request routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    state.caller = HOST;
    state.stream = {
      _id: oid(STREAM),
      streamerId: oid(HOST),
      isLive: true,
      requestsOpen: true,
      startedAt: new Date(),
      livekitRoomName: `room-${STREAM}`,
      shield: { on: false },
    };
    state.menu = [SONG];
    state.orders = [];
    state.charges = [];
    state.refunds = [];
    state.chat = [];
    state.room = [];
    state.userUpdates = [];
    state.streamUpdates = [];
  });

  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) => app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });

  it("gives new menu items readable ids and keeps the ones it has", async () => {
    const res = await call("PUT", "/users/me/requests-menu", {
      items: [SONG, { title: "Shout-out!", priceUsdMinor: 200 }, { title: "Shout out", priceUsdMinor: 300 }],
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().data.items as Array<{ id: string }>;
    expect(items[0]!.id).toBe("song");
    expect(items[1]!.id).toBe("shout-out");
    expect(items[2]!.id).toMatch(/^shout-out-[0-9a-f]{4}$/);
    expect(state.room.at(-1)).toMatchObject({ __evt: "requests_menu", open: true });
  });

  it("lets only the host open requests, and never with an empty menu", async () => {
    state.caller = VIEWER;
    expect((await call("POST", `/streams/${STREAM}/requests/open`, { open: true })).statusCode).toBe(403);
    state.caller = HOST;
    state.menu = [];
    expect((await call("POST", `/streams/${STREAM}/requests/open`, { open: true })).json().code).toBe("EMPTY_MENU");
    state.menu = [SONG];
    const res = await call("POST", `/streams/${STREAM}/requests/open`, { open: false });
    expect(res.statusCode).toBe(200);
    expect(state.stream.requestsOpen).toBe(false);
  });

  it("takes an order only while open, never from the host, and filters the note before charging", async () => {
    expect((await call("POST", `/streams/${STREAM}/requests`, { itemId: "song" })).json().code).toBe("SELF_REQUEST");

    state.caller = VIEWER;
    state.stream.requestsOpen = false;
    expect((await call("POST", `/streams/${STREAM}/requests`, { itemId: "song" })).json().code).toBe("REQUESTS_CLOSED");

    state.stream.requestsOpen = true;
    const blocked = await call("POST", `/streams/${STREAM}/requests`, { itemId: "song", note: "I can double your btc in 24h" });
    expect(blocked.statusCode).toBe(422);
    expect(state.charges).toHaveLength(0);

    const ok = await call("POST", `/streams/${STREAM}/requests`, { itemId: "song", note: "Last Last" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.order).toMatchObject({ title: "Song", note: "Last Last", status: "pending", refunded: false });
    expect(state.charges).toHaveLength(1);
  });

  it("lets only the host decide, and a skip refunds", async () => {
    state.caller = VIEWER;
    const placed = (await call("POST", `/streams/${STREAM}/requests`, { itemId: "song" })).json().data.order;
    expect((await call("POST", `/streams/${STREAM}/requests/${placed.id}/skip`)).statusCode).toBe(403);

    state.caller = HOST;
    const skipped = await call("POST", `/streams/${STREAM}/requests/${placed.id}/skip`);
    expect(skipped.statusCode).toBe(200);
    expect(skipped.json().data.order).toMatchObject({ status: "skipped", refunded: true });
    expect(state.refunds).toHaveLength(1);
    expect((await call("POST", `/streams/${STREAM}/requests/${placed.id}/done`)).json().code).toBe("ALREADY_DECIDED");
  });
});

describe("Shouts", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    state.caller = VIEWER;
    state.stream = { _id: oid(STREAM), streamerId: oid(HOST), isLive: true, startedAt: new Date(), livekitRoomName: `room-${STREAM}`, shield: { on: false } };
    state.charges = [];
    state.chat = [];
    state.room = [];
  });

  const shout = (amountUsdMinor: number, message: string) =>
    app.inject({ method: "POST", url: `/v1/streams/${STREAM}/gifts`, payload: { amountUsdMinor, message } });

  it("starts at $2 and meets the chat rules before charging", async () => {
    expect((await shout(100, "hello")).json().code).toBe("SHOUT_TOO_SMALL");
    expect((await shout(500, "I can double your btc in 24h")).json().code).toBe("SHOUT_BLOCKED");
    expect(state.charges).toHaveLength(0);
  });

  it("pins the words for as long as the amount buys", async () => {
    const before = Date.now();
    const res = await shout(500, "Lagos is in the building");
    expect(res.statusCode).toBe(200);
    const line = state.chat[0]!;
    expect(line).toMatchObject({ content: "Lagos is in the building", emoji: "📣", tipAmount: "5.00" });
    const pinned = (line.shoutUntil as Date).getTime() - before;
    expect(pinned).toBeGreaterThanOrEqual(120_000);
    expect(pinned).toBeLessThan(125_000);
    expect(state.room.at(-1)).toMatchObject({ content: "Lagos is in the building", shoutUntil: (line.shoutUntil as Date).toISOString() });
    expect(state.charges[0]).toMatchObject({ amountUsdMinor: 500, description: "Gift (Shout) to @wole" });
  });
});
