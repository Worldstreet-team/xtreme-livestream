import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Go-live notifications: starting a stream fans a notification row out to
 * every follower (unless the host opted out), and the bell endpoints serve
 * and clear them. Pins the fan-out trigger and the read semantics.
 */

const STREAMER_ID = "a".repeat(24);
const F1 = "1".repeat(24);
const F2 = "2".repeat(24);
const STREAM_ID = "d".repeat(24);

const id = (v: unknown) => ({
  toString: () => String(v),
  equals: (o: unknown) => String(o) === String(v),
});

let caller: {
  _id: ReturnType<typeof id>;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  save: () => Promise<void>;
};
let followers: Array<{ followerId: string }>;
let inserted: Array<Record<string, unknown>>;
let notifications: Array<{
  _id: string;
  userId: string;
  read: boolean;
  actorName: string;
  streamTitle: string;
  createdAt: Date;
}>;
let readMarks: Array<Record<string, unknown>>;

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: caller }),
  getOptionalAuthUserId: () => "clerk_x",
}));

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

vi.mock("../src/stream-service.js", () => ({
  reconcileStream: async (s: { isLive: boolean }) => s.isLive,
  reconcileLeanStreams: async () => new Set(),
  markStreamEnded: async () => {},
  thumbnailUrlFor: () => null,
  accrueViewerSeconds: () => {},
  parseImageDataUri: () => null,
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findOne: async () => null,
    create: async (doc: Record<string, unknown>) => ({
      _id: id(STREAM_ID),
      ...doc,
      toJSON: () => ({ _id: STREAM_ID, ...doc }),
    }),
    findById: async () => null,
  },
  User: {},
  Follow: {
    find: () => ({
      select: () => ({
        lean: async () => followers,
      }),
    }),
  },
  Notification: {
    insertMany: async (rows: Array<Record<string, unknown>>) => {
      inserted.push(...rows);
      return rows;
    },
    find: (q: { userId: unknown }) => ({
      sort: () => ({
        limit: () => ({
          lean: async () =>
            notifications.filter((n) => n.userId === String(q.userId)),
        }),
      }),
    }),
    countDocuments: async (q: { userId: unknown; read?: boolean }) =>
      notifications.filter(
        (n) =>
          n.userId === String(q.userId) &&
          (q.read === undefined || n.read === q.read),
      ).length,
    updateMany: async (
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ) => {
      readMarks.push({ filter, update });
      notifications
        .filter((n) => n.userId === String(filter.userId))
        .forEach((n) => {
          n.read = true;
        });
      return {};
    },
  },
  ChatMessage: {},
  Follow2: {},
  StreamBan: { findOne: async () => null },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

describe("go-live notifications", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    caller = {
      _id: id(STREAMER_ID),
      username: "streamer",
      displayName: "Streamer",
      avatar: "",
      isLive: false,
      save: async () => {},
    };
    followers = [{ followerId: F1 }, { followerId: F2 }];
    inserted = [];
    notifications = [];
    readMarks = [];
  });

  const goLive = (notifyFollowers?: boolean) =>
    app.inject({
      method: "POST",
      url: "/api/streams",
      payload: {
        title: "Morning market",
        category: "Bitcoin Trading",
        ...(notifyFollowers === undefined ? {} : { notifyFollowers }),
      },
    });

  it("fans one notification per follower on go-live", async () => {
    const res = await goLive();
    expect(res.statusCode).toBe(200);

    // Fan-out is fire-and-forget — give the microtask queue a beat.
    await new Promise((r) => setTimeout(r, 20));

    expect(inserted).toHaveLength(2);
    expect(inserted.map((n) => String(n.userId)).sort()).toEqual([F1, F2]);
    expect(inserted[0]).toMatchObject({
      type: "live",
      actorName: "Streamer",
      streamTitle: "Morning market",
      read: false,
    });
  });

  it("respects notifyFollowers: false", async () => {
    const res = await goLive(false);
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(inserted).toHaveLength(0);
  });

  it("serves the bell: list plus unread count", async () => {
    notifications = [
      {
        _id: "n1",
        userId: STREAMER_ID,
        read: false,
        actorName: "Other",
        streamTitle: "Live now",
        createdAt: new Date(),
      },
      {
        _id: "n2",
        userId: STREAMER_ID,
        read: true,
        actorName: "Other",
        streamTitle: "Earlier",
        createdAt: new Date(),
      },
    ];
    const res = await app.inject({
      method: "GET",
      url: "/api/user/me/notifications",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.notifications).toHaveLength(2);
    expect(body.unread).toBe(1);
  });

  it("mark-read clears the unread count", async () => {
    notifications = [
      {
        _id: "n1",
        userId: STREAMER_ID,
        read: false,
        actorName: "Other",
        streamTitle: "Live now",
        createdAt: new Date(),
      },
    ];
    const res = await app.inject({
      method: "POST",
      url: "/api/user/me/notifications/read",
    });

    expect(res.statusCode).toBe(200);
    expect(readMarks).toHaveLength(1);
    expect(notifications[0].read).toBe(true);
  });
});
