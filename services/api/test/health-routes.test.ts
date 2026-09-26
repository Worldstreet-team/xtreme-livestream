import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MAX_HEALTH_WINDOWS } from "@xtreme/contracts";

/**
 * Stream health's routes: the host's studio records half-minutes of its
 * broadcast, capped; only the host reads them back for the report.
 */

const HOST = "a".repeat(24);
const VIEWER = "b".repeat(24);
const STREAM = "d".repeat(24);

const id = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });

const state = vi.hoisted(() => ({
  caller: "",
  live: true,
  updates: [] as Array<{ filter: Record<string, unknown>; update: Record<string, any> }>,
  windows: [] as unknown[],
}));

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: { _id: id(state.caller) } }),
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
  sendRoomData: async () => {},
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    updateOne: async (filter: Record<string, unknown>, update: Record<string, any>) => {
      state.updates.push({ filter, update });
      const mine = String(filter.streamerId) === HOST && filter.isLive === true && state.live;
      if (mine) state.windows.push(...update.$push.health.$each);
      return { matchedCount: mine ? 1 : 0 };
    },
    findById: () => ({
      select: () => ({
        lean: async () => ({ _id: STREAM, streamerId: HOST, startedAt: new Date(0), endedAt: null, health: state.windows }),
      }),
    }),
  },
  User: {},
  ChatMessage: {},
  GiftTransaction: {},
  Follow: {},
  StreamBan: {},
  Report: {},
  StreamLike: {},
}));

const window = { at: 30_000, kbps: 2_400, fps: 30, height: 720, rttMs: 60, lossPct: 0.4, limitation: "none", level: "good" };

describe("stream health routes", () => {
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
    state.live = true;
    state.updates = [];
    state.windows = [];
  });

  const post = (body: unknown) => app.inject({ method: "POST", url: `/v1/streams/${STREAM}/health`, payload: body });

  it("records the host's half-minute on their live stream, capped at six hours", async () => {
    expect((await post({ window })).statusCode).toBe(200);
    expect(state.updates[0]!.update).toEqual({ $push: { health: { $each: [window], $slice: -MAX_HEALTH_WINDOWS } } });
    expect(state.windows).toHaveLength(1);
  });

  it("turns away anyone else's stream, a finished one, and nonsense", async () => {
    state.caller = VIEWER;
    expect((await post({ window })).statusCode).toBe(404);
    state.caller = HOST;
    state.live = false;
    expect((await post({ window })).statusCode).toBe(404);
    state.live = true;
    expect((await post({ window: { ...window, level: "great" } })).statusCode).toBe(400);
    expect((await post({ window: { ...window, lossPct: 140 } })).statusCode).toBe(400);
  });

  it("reads back for the host only", async () => {
    await post({ window });
    const mine = await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/health` });
    expect(mine.json().data.windows).toEqual([window]);
    state.caller = VIEWER;
    expect((await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/health` })).statusCode).toBe(403);
  });
});
