import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Discovery routes for a signed-out visitor: impressions are accepted
 * without auth (anonymous browsing is most browsing), the actions that
 * change a person's state are not, and bad input is rejected before it
 * reaches the database.
 */

const STREAM_ID = "d".repeat(24);

let inserted: Array<Record<string, unknown>>;

vi.mock("../src/auth.js", async () => {
  const { ApiError } = await import("../src/errors.js");
  return {
    authenticate: async () => {
      throw new ApiError(401, "Authentication required", "UNAUTHORIZED");
    },
    getOptionalAuthUserId: () => null,
  };
});

vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [] },
  ingressClient: {},
  webhookReceiver: { receive: async () => ({ event: "ignored" }) },
  createToken: async () => "token",
  createRtmpIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  sendRoomData: async () => {},
  setParticipantPublishPermission: async () => {},
}));

vi.mock("../src/discovery.js", () => ({
  buildHomePage: async () => ({ rows: [], leads: [] }),
  alsoWatchedLive: async () => [],
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: () => ({ select: () => ({ lean: async () => null }) }),
    findOne: async () => null,
    find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ populate: () => ({ lean: async () => [] }) }) }) }) }),
    countDocuments: async () => 0,
    aggregate: async () => [],
  },
  User: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
  Impression: {
    insertMany: async (rows: Array<Record<string, unknown>>) => {
      inserted.push(...rows);
      return rows;
    },
  },
  StreamReminder: {},
  Follow: {},
  Notification: {},
  ChatMessage: {},
  StreamBan: { findOne: async () => null },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
  WatchSession: {},
  ViewerSample: {},
}));

describe("discovery routes, signed out", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    inserted = [];
  });

  it("serves the home page to anyone", async () => {
    const res = await app.inject({ method: "GET", url: "/api/home" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ rows: [], leads: [] });
  });

  it("records anonymous impressions with their slot and exploration flag", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/impressions",
      payload: {
        viewerKey: "anon-0123456789",
        items: [
          { streamId: STREAM_ID, surface: "home", row: "trending", slot: 0 },
          { streamId: STREAM_ID, surface: "home", row: "rising", slot: 3, explore: true },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.recorded).toBe(2);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ userId: null, row: "trending", slot: 0, explore: false });
    expect(inserted[1]).toMatchObject({ row: "rising", slot: 3, explore: true });
  });

  it("rejects an impression batch with an unknown surface", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/impressions",
      payload: {
        viewerKey: "anon-0123456789",
        items: [{ streamId: STREAM_ID, surface: "sidebar", slot: 0 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(inserted).toEqual([]);
  });

  it("requires sign-in to set a reminder or schedule a stream", async () => {
    const remind = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/remind`,
    });
    expect(remind.statusCode).toBe(401);

    const schedule = await app.inject({
      method: "POST",
      url: "/api/streams/schedule",
      payload: {
        title: "Fed decision",
        category: "Crypto Markets",
        scheduledStartAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(schedule.statusCode).toBe(401);
  });

  it("rejects a schedule in the past before it reaches auth or the database", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/streams/schedule",
      payload: {
        title: "Fed decision",
        category: "Crypto Markets",
        scheduledStartAt: "2020-01-01T00:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s also-watched for an unknown stream", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/streams/${STREAM_ID}/also-watched`,
    });
    expect(res.statusCode).toBe(404);
  });
});
