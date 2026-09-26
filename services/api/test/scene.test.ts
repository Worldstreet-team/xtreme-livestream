import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { sceneBodySchema } from "@xtreme/contracts";

/**
 * The scene engine's contract: the host sets the program's layout and card
 * while live; the version only goes up; and the scene reaches the room both
 * as metadata (for whoever joins later) and as a data event (for everyone
 * already in).
 */

const HOST_ID = "a".repeat(24);
const VIEWER_ID = "b".repeat(24);
const STREAM_ID = "d".repeat(24);

const id = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });

const state = vi.hoisted(() => ({
  caller: "" as string,
  metadata: [] as Array<{ room: string; scene: unknown }>,
  events: [] as Array<Record<string, unknown>>,
}));

let streamDoc: {
  _id: ReturnType<typeof id>;
  streamerId: ReturnType<typeof id>;
  isLive: boolean;
  livekitRoomName: string;
  scene?: { layout: string; card: string | null; cardNote: string; featured?: unknown; version: number };
  save: () => Promise<void>;
};

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
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async () => false,
  setParticipantPublishPermission: async () => {},
  setRoomScene: async (room: string, scene: unknown) => {
    state.metadata.push({ room, scene });
  },
  sendRoomData: async (_room: string, payload: Record<string, unknown>) => {
    state.events.push(payload);
  },
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: (lookup: unknown) => {
      const doc = String(lookup) === STREAM_ID ? streamDoc : null;
      return Object.assign(Promise.resolve(doc), { select: async () => doc });
    },
  },
  User: {},
  Follow: {},
  ChatMessage: {},
  StreamBan: { findOne: async () => null },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

describe("the scene contract", () => {
  it("defaults to the automatic layout with no card and no graphics", () => {
    expect(sceneBodySchema.parse({})).toEqual({ layout: "auto", card: null, cardNote: "", chart: null, layers: [], gains: {} });
  });

  it("takes guest faders by room identity, 0 to 1, eight at most", () => {
    expect(sceneBodySchema.safeParse({ gains: { "6ab4845473be0e4889649273": 0.4, "obs-abc": 1 } }).success).toBe(true);
    expect(sceneBodySchema.safeParse({ gains: { guest: 1.4 } }).success).toBe(false);
    expect(sceneBodySchema.safeParse({ gains: { "not ok!": 0.5 } }).success).toBe(false);
    const nine = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`g${i}`, 0.5]));
    expect(sceneBodySchema.safeParse({ gains: nine }).success).toBe(false);
  });

  it("takes each graphic once, with what it needs", () => {
    const layers = [
      { kind: "lower-third", title: "Amara", subtitle: "Ranked to Radiant" },
      { kind: "banner", text: "Giveaway at 100 allies" },
      { kind: "ticker", text: "Next stream Friday 8pm · Follow for the drop" },
      { kind: "countdown", label: "Match starts", endsAt: new Date(Date.now() + 300_000).toISOString() },
      { kind: "logo", corner: "bottom-right" },
    ];
    expect(sceneBodySchema.safeParse({ layers }).success).toBe(true);
  });

  it("takes a call to action with a web address, and nothing else", () => {
    expect(sceneBodySchema.safeParse({ layers: [{ kind: "cta", title: "Scan for merch", url: "https://shop.example.com/merch" }] }).success).toBe(true);
    for (const url of ["javascript:alert(1)", "not a url", "ftp://files.example.com/x", ""]) {
      expect(sceneBodySchema.safeParse({ layers: [{ kind: "cta", title: "Scan", url }] }).success, url).toBe(false);
    }
  });

  it("charts a market in Chart + face, and only a market", () => {
    expect(sceneBodySchema.parse({ layout: "chart-face", chart: { symbol: "eth-usd" } }).chart).toEqual({ symbol: "ETH-USD", interval: "5m" });
    expect(sceneBodySchema.safeParse({ layout: "chart-face", chart: { symbol: "ethereum" } }).success).toBe(false);
    expect(sceneBodySchema.safeParse({ chart: { symbol: "BTC-USD", interval: "2m" } }).success).toBe(false);
  });

  it("refuses two of the same graphic, an empty banner and a countdown with no end", () => {
    expect(sceneBodySchema.safeParse({ layers: [{ kind: "banner", text: "a" }, { kind: "banner", text: "b" }] }).success).toBe(false);
    expect(sceneBodySchema.safeParse({ layers: [{ kind: "banner", text: "" }] }).success).toBe(false);
    expect(sceneBodySchema.safeParse({ layers: [{ kind: "countdown", endsAt: "soon" }] }).success).toBe(false);
  });

  it("refuses a layout it doesn't know and a note past 80 characters", () => {
    expect(sceneBodySchema.safeParse({ layout: "mosaic" }).success).toBe(false);
    expect(sceneBodySchema.safeParse({ card: "brb", cardNote: "x".repeat(81) }).success).toBe(false);
  });
});

describe("PUT /streams/:id/scene", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    streamDoc = {
      _id: id(STREAM_ID),
      streamerId: id(HOST_ID),
      isLive: true,
      livekitRoomName: "room-1",
      scene: { layout: "auto", card: null, cardNote: "", version: 0 },
      save: vi.fn(async () => {}),
    };
    state.caller = HOST_ID;
    state.metadata.length = 0;
    state.events.length = 0;
  });

  const put = (body: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/v1/streams/${STREAM_ID}/scene`, payload: body });

  it("lets the host set the scene, bumps the version and tells the room both ways", async () => {
    const response = await put({ layout: "screen-face" });

    expect(response.statusCode).toBe(200);
    const scene = { layout: "screen-face", card: null, cardNote: "", chart: null, layers: [], gains: {}, featured: null, version: 1 };
    expect(response.json().data.scene).toEqual(scene);
    expect(streamDoc.scene).toEqual(scene);
    expect(streamDoc.save).toHaveBeenCalledTimes(1);
    expect(state.metadata).toEqual([{ room: "room-1", scene }]);
    expect(state.events).toEqual([{ __evt: "scene", scene }]);
  });

  it("carries graphics through to the room", async () => {
    const response = await put({ layers: [{ kind: "ticker", text: "Follow for the drop" }] });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.scene.layers).toEqual([{ kind: "ticker", text: "Follow for the drop" }]);
    expect(state.events[0]).toMatchObject({ __evt: "scene", scene: { layers: [{ kind: "ticker" }] } });
  });

  it("leaves what's featured on screen alone — the feature routes own it", async () => {
    const featured = { id: "e".repeat(24), kind: "chat", text: "hi", until: null };
    streamDoc.scene = { layout: "auto", card: null, cardNote: "", featured, version: 3 };

    const response = await put({ layout: "solo" });

    expect(response.json().data.scene).toMatchObject({ layout: "solo", featured, version: 4 });
  });

  it("only ever moves the version forward", async () => {
    await put({ card: "starting-soon", cardNote: "Kicking off at 8" });
    const response = await put({ card: null });

    expect(response.json().data.scene.version).toBe(2);
    expect(response.json().data.scene.card).toBeNull();
  });

  it("refuses anyone but the host", async () => {
    state.caller = VIEWER_ID;

    const response = await put({ layout: "solo" });

    expect(response.statusCode).toBe(403);
    expect(state.metadata).toEqual([]);
  });

  it("refuses a stream that isn't live", async () => {
    streamDoc.isLive = false;

    const response = await put({ card: "brb" });

    expect(response.statusCode).toBe(409);
  });

  it("refuses a layout it doesn't know", async () => {
    const response = await put({ layout: "mosaic" });

    expect(response.statusCode).toBe(400);
    expect(streamDoc.save).not.toHaveBeenCalled();
  });
});
