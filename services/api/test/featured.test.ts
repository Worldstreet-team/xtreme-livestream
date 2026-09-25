import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { featureBodySchema } from "@xtreme/contracts";

/**
 * Comments on screen: the host features a chat line or gift; it's built
 * from the stored row, comes down at `until`, and only ever touches
 * `scene.featured` — with guards checked by the same write that acts on them.
 */

const HOST_ID = "a".repeat(24);
const VIEWER_ID = "b".repeat(24);
const STREAM_ID = "d".repeat(24);
const MSG_ID = "e".repeat(24);
const GIFT_MSG_ID = "f".repeat(24);

const id = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });

type Doc = Record<string, unknown> & { _id: ReturnType<typeof id>; scene: Record<string, unknown> };

const state = vi.hoisted(() => ({
  caller: "",
  stream: null as unknown as Doc,
  messages: [] as Array<Record<string, unknown>>,
  metadata: [] as unknown[],
  events: [] as Array<Record<string, unknown>>,
}));

// Just enough of Mongo's matching for the filters featured.ts writes.
function read(doc: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), doc);
}
function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, want]) => {
    if (key === "$or") return (want as Record<string, unknown>[]).some((f) => matches(doc, f));
    const have = key === "_id" ? String(doc._id) : read(doc, key);
    if (key === "_id") return have === String(want);
    if (want === null) return have == null;
    if (want && typeof want === "object" && "$lt" in want) return have != null && String(have) < String((want as { $lt: unknown }).$lt);
    return have === want;
  });
}

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: { _id: { toString: () => state.caller } } }),
  getOptionalAuthUserId: () => "clerk_x",
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
  setRoomScene: async (_room: string, scene: unknown) => {
    state.metadata.push(scene);
  },
  sendRoomData: async (_room: string, payload: Record<string, unknown>) => {
    state.events.push(payload);
  },
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: async (lookup: unknown) => (String(lookup) === STREAM_ID ? state.stream : null),
    findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => ({
      lean: async () => {
        const doc = state.stream;
        if (!doc || !matches(doc, filter)) return null;
        doc.scene = {
          ...doc.scene,
          featured: update.$set["scene.featured"],
          version: Number(doc.scene.version ?? 0) + Number(update.$inc["scene.version"]),
        };
        return doc;
      },
    }),
    updateOne: async () => ({}),
  },
  ChatMessage: {
    findOne: (q: { _id?: string; userId?: string }) => {
      const found = () =>
        state.messages.find((m) => (q._id ? m._id === String(q._id) : m.userId === String(q.userId))) ?? null;
      const chain = { sort: () => chain, select: () => chain, lean: async () => found() };
      return chain;
    },
    findOneAndDelete: async (q: { _id: string }) => state.messages.find((m) => m._id === String(q._id)) ?? null,
    deleteMany: async () => ({}),
  },
  User: {
    findById: () => ({ select: async () => ({ _id: id(HOST_ID), safety: { mods: [] }, settings: {} }) }),
  },
  Follow: {},
  StreamBan: { findOne: async () => null, findOneAndUpdate: async () => ({ username: "tolu" }) },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

describe("the feature contract", () => {
  it("defaults to 20 seconds and takes only 10, 20, 60 or until taken down", () => {
    expect(featureBodySchema.parse({})).toEqual({ seconds: 20 });
    expect(featureBodySchema.parse({ seconds: null })).toEqual({ seconds: null });
    expect(featureBodySchema.safeParse({ seconds: 15 }).success).toBe(false);
  });
});

describe("comments on screen", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    state.caller = HOST_ID;
    state.stream = {
      _id: id(STREAM_ID),
      streamerId: id(HOST_ID),
      isLive: true,
      livekitRoomName: "room-1",
      scene: { layout: "split", card: null, cardNote: "", layers: [{ kind: "ticker", text: "hi" }], featured: null, version: 4 },
    };
    state.messages = [
      { _id: MSG_ID, userId: VIEWER_ID, username: "tolu", avatar: "a.png", content: "this set is unreal", type: "text", tipAmount: null, tipCurrency: null, emoji: null },
      { _id: GIFT_MSG_ID, userId: VIEWER_ID, username: "tolu", avatar: "a.png", content: "sent a Rose", type: "tip", tipAmount: "5.00", tipCurrency: "USD", emoji: "🌹" },
      { _id: "c".repeat(24), userId: VIEWER_ID, username: "tolu", avatar: "", content: "caught a drop", type: "tip", tipAmount: "50", tipCurrency: "PTS", emoji: null },
    ];
    state.metadata.length = 0;
    state.events.length = 0;
  });

  const feature = (messageId: string, body: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: `/v1/streams/${STREAM_ID}/chat/${messageId}/feature`, payload: body });
  const unfeature = (messageId: string) =>
    app.inject({ method: "DELETE", url: `/v1/streams/${STREAM_ID}/chat/${messageId}/feature` });

  it("puts a chat line on screen for 20 seconds, from the stored row", async () => {
    const before = Date.now();
    const response = await feature(MSG_ID);

    expect(response.statusCode).toBe(200);
    const scene = response.json().data.scene;
    expect(scene.featured).toMatchObject({ id: MSG_ID, kind: "chat", userId: VIEWER_ID, username: "tolu", text: "this set is unreal", auto: false, amount: null });
    const span = Date.parse(scene.featured.until) - Date.parse(scene.featured.at);
    expect(span).toBe(20_000);
    expect(Date.parse(scene.featured.at)).toBeGreaterThanOrEqual(before - 5);
    // Nothing else in the scene moves, and the version goes on.
    expect(scene).toMatchObject({ layout: "split", layers: [{ kind: "ticker", text: "hi" }], version: 5 });
    expect(state.metadata).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ __evt: "scene", scene: { featured: { id: MSG_ID } } });
  });

  it("puts a gift up with its amount, and keeps one up until taken down", async () => {
    const response = await feature(GIFT_MSG_ID, { seconds: null });

    expect(response.json().data.scene.featured).toMatchObject({ kind: "gift", text: "sent a Rose", amount: "5.00", currency: "USD", emoji: "🌹", until: null });
  });

  it("refuses drops, someone else's stream, a stream that's off air and an unknown line", async () => {
    expect((await feature("c".repeat(24))).statusCode).toBe(400);
    expect((await feature("9".repeat(24))).statusCode).toBe(404);
    state.caller = VIEWER_ID;
    expect((await feature(MSG_ID)).statusCode).toBe(403);
    state.caller = HOST_ID;
    state.stream.isLive = false;
    expect((await feature(MSG_ID)).statusCode).toBe(409);
    expect(state.events).toEqual([]);
  });

  it("takes a line down only while it's still the one on screen", async () => {
    await feature(MSG_ID);
    await feature(GIFT_MSG_ID);

    // The chat line was replaced by the gift: taking it down leaves the gift.
    const stale = await unfeature(MSG_ID);
    expect(stale.json().data.scene.featured).toMatchObject({ id: GIFT_MSG_ID });

    const response = await unfeature(GIFT_MSG_ID);
    expect(response.json().data.scene.featured).toBeNull();
  });

  it("takes a featured line down when it's deleted", async () => {
    await feature(MSG_ID);
    await app.inject({ method: "DELETE", url: `/v1/streams/${STREAM_ID}/chat/${MSG_ID}` });
    expect(state.stream.scene.featured).toBeNull();
  });

  it("takes a banned person's featured gift down, and leaves someone else's", async () => {
    await feature(GIFT_MSG_ID);
    await app.inject({ method: "POST", url: `/v1/streams/${STREAM_ID}/ban/${"7".repeat(24)}`, payload: {} });
    expect(state.stream.scene.featured).toMatchObject({ id: GIFT_MSG_ID });

    await app.inject({ method: "POST", url: `/v1/streams/${STREAM_ID}/ban/${VIEWER_ID}`, payload: { minutes: 10 } });
    expect(state.stream.scene.featured).toBeNull();
  });
});

describe("gifts that go on screen by themselves", () => {
  const gift = {
    _id: GIFT_MSG_ID,
    userId: VIEWER_ID,
    username: "tolu",
    avatar: "",
    content: "sent a Crown",
    type: "tip" as const,
    tipAmount: "50.00",
    tipCurrency: "USD",
    emoji: "👑",
  };
  const host = (featureGiftsFromMinor: number, featureSeconds = 20) =>
    ({ settings: { featureGiftsFromMinor, featureSeconds } }) as never;

  beforeEach(() => {
    state.stream = {
      _id: id(STREAM_ID),
      streamerId: id(HOST_ID),
      isLive: true,
      livekitRoomName: "room-1",
      scene: { layout: "auto", card: null, cardNote: "", layers: [], featured: null, version: 1 },
    };
  });

  it("goes up at or above the host's tier, and not below it or with the tier off", async () => {
    const { autoFeatureGift } = await import("../src/featured.js");

    expect(await autoFeatureGift(STREAM_ID, host(0), gift as never, 5000)).toBeNull();
    expect(await autoFeatureGift(STREAM_ID, host(10_000), gift as never, 5000)).toBeNull();
    const scene = await autoFeatureGift(STREAM_ID, host(2000), gift as never, 5000);
    expect(scene?.featured).toMatchObject({ id: GIFT_MSG_ID, kind: "gift", auto: true });
  });

  it("stays 20 seconds when the host keeps comments up until they say", async () => {
    const { autoFeatureGift } = await import("../src/featured.js");
    const scene = await autoFeatureGift(STREAM_ID, host(500, 0), gift as never, 5000);
    expect(Date.parse(scene!.featured!.until!) - Date.parse(scene!.featured!.at)).toBe(20_000);
  });

  it("never covers the host's own pick while it's showing, but replaces an earlier auto gift", async () => {
    const { autoFeatureGift } = await import("../src/featured.js");
    const now = Date.now();
    const pick = { id: MSG_ID, auto: false, until: new Date(now + 10_000).toISOString() };

    state.stream.scene.featured = pick;
    expect(await autoFeatureGift(STREAM_ID, host(500), gift as never, 5000, now)).toBeNull();

    state.stream.scene.featured = { ...pick, until: null };
    expect(await autoFeatureGift(STREAM_ID, host(500), gift as never, 5000, now)).toBeNull();

    state.stream.scene.featured = { ...pick, until: new Date(now - 1000).toISOString() };
    expect(await autoFeatureGift(STREAM_ID, host(500), gift as never, 5000, now)).not.toBeNull();

    state.stream.scene.featured = { ...pick, auto: true, until: new Date(now + 10_000).toISOString() };
    expect((await autoFeatureGift(STREAM_ID, host(500), gift as never, 5000, now))?.featured?.auto).toBe(true);
  });
});
