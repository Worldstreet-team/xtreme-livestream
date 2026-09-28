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
let followersFail = false;
let inserted: Array<Record<string, unknown>>;
let notifications: Array<{
  _id: string;
  userId: string;
  actorId?: string;
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

// The rehearsal's simulated audience is practice.test.ts's business.
vi.mock("../src/practice.js", () => ({ startPractice: () => {} }));

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
  User: {
    find: (q: { _id: { $in: string[] } }) => ({
      select: () => ({
        lean: async () =>
          q._id.$in.includes(F1)
            ? [{ _id: F1, username: "other", avatar: "https://cdn.test/other.jpg" }]
            : [],
      }),
    }),
  },
  Follow: {
    find: () => ({
      select: () => ({
        lean: async () => {
          if (followersFail) throw new Error("mongo down");
          return followers;
        },
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
    followersFail = false;
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
    // The studio's coach says how many were told — the real fan-out size.
    expect(res.json().data.followersTold).toBe(2);
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
    expect(res.json().data.followersTold).toBe(0);
  });

  it("tells nobody on a practice run, and says so", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/streams",
      payload: { title: "Rehearsal", category: "Bitcoin Trading", practice: true },
    });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(inserted).toHaveLength(0);
    expect(res.json().data.followersTold).toBe(0);
  });

  it("reports no number when the follower lookup fails, and still goes live", async () => {
    followersFail = true;
    const res = await goLive();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.followersTold).toBeNull();
  });

  it("serves the bell: list plus unread count", async () => {
    notifications = [
      {
        _id: "n1",
        userId: STREAMER_ID,
        actorId: F1,
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
    // Each row names its person for the bell, and their face comes once in
    // `avatars`; a row without a known actor keeps its name and no picture.
    expect(body.notifications[0]).toMatchObject({ actorName: "Other", actorUsername: "other" });
    expect(body.notifications[1]).toMatchObject({ actorUsername: "" });
    expect(body.avatars).toEqual({ other: "https://cdn.test/other.jpg" });
    expect(body.notifications[0]).not.toHaveProperty("actorAvatar");
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
