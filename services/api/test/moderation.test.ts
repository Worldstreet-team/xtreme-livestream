import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Moderation v1: the host deletes messages and bans (or times out) users.
 * Pins the contract the chat UI keys off — 403 BANNED on a banned sender,
 * hard-deleted rows, and the fan-out events other clients purge from.
 */

const HOST_ID = "a".repeat(24);
const VIEWER_ID = "b".repeat(24);
const STREAM_ID = "d".repeat(24);
const MSG_ID = "e".repeat(24);

const id = (v: unknown) => ({
  toString: () => String(v),
  equals: (o: unknown) => String(o) === String(v),
});

let streamDoc: {
  _id: ReturnType<typeof id>;
  streamerId: ReturnType<typeof id>;
  isLive: boolean;
  livekitRoomName: string;
  guests: never[];
  pinnedMessage: Record<string, unknown> | null;
};
let caller: {
  _id: ReturnType<typeof id>;
  username: string;
  avatar: string;
};
let chatMessages: Array<{
  _id: string;
  streamId: string;
  userId: string;
  content: string;
}>;
let bans: Array<{
  streamId: string;
  userId: string;
  username: string;
  expiresAt: Date | null;
}>;
const dataEvents: Array<Record<string, unknown>> = [];

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
  sendRoomData: async (_room: string, payload: Record<string, unknown>) => {
    dataEvents.push(payload);
  },
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
    findById: (lookup: unknown) => {
      const doc = String(lookup) === STREAM_ID ? streamDoc : null;
      return Object.assign(Promise.resolve(doc), { select: async () => doc });
    },
    findOneAndUpdate: async () => null,
    updateOne: async (
      _q: unknown,
      update: { $set?: Record<string, unknown> },
    ) => {
      if (update.$set && "pinnedMessage" in update.$set) {
        streamDoc.pinnedMessage = update.$set.pinnedMessage as Record<
          string,
          unknown
        > | null;
      }
      return {};
    },
  },
  User: {
    findById: () => ({
      select: async () => ({
        settings: { slowMode: false, subscriberOnly: false },
      }),
    }),
  },
  Follow: { exists: async () => ({ _id: "x" }) },
  ChatMessage: {
    create: async (doc: Record<string, unknown>) => {
      const row = {
        _id: MSG_ID,
        streamId: String(doc.streamId),
        userId: String(doc.userId),
        content: String(doc.content),
      };
      chatMessages.push(row);
      return { ...row, toJSON: () => row };
    },
    exists: async () => null,
    findOne: (q: { _id?: unknown; streamId: unknown; userId?: unknown }) => ({
      // Pin path: findOne({_id, streamId}).lean()
      lean: async () => {
        const row = chatMessages.find(
          (m) => m._id === String(q._id) && m.streamId === String(q.streamId),
        );
        return row ? { ...row, username: "viewer", avatar: "" } : null;
      },
      // Ban path: findOne({streamId, userId}).sort().select().lean()
      sort: () => ({
        select: () => ({
          lean: async () =>
            chatMessages.find(
              (m) =>
                m.streamId === String(q.streamId) &&
                m.userId === String(q.userId),
            )
              ? { username: "viewer" }
              : null,
        }),
      }),
    }),
    findOneAndDelete: async (q: { _id: unknown; streamId: unknown }) => {
      const i = chatMessages.findIndex(
        (m) => m._id === String(q._id) && m.streamId === String(q.streamId),
      );
      if (i === -1) return null;
      return chatMessages.splice(i, 1)[0];
    },
    deleteMany: async (q: { streamId: unknown; userId: unknown }) => {
      const before = chatMessages.length;
      chatMessages = chatMessages.filter(
        (m) =>
          !(m.streamId === String(q.streamId) && m.userId === String(q.userId)),
      );
      return { deletedCount: before - chatMessages.length };
    },
  },
  StreamBan: {
    findOne: async (q: { streamId: unknown; userId: unknown }) => {
      const now = new Date();
      return (
        bans.find(
          (b) =>
            b.streamId === String(q.streamId) &&
            b.userId === String(q.userId) &&
            (b.expiresAt === null || b.expiresAt > now),
        ) ?? null
      );
    },
    findOneAndUpdate: async (
      q: { streamId: unknown; userId: unknown },
      update: {
        $set: { username: string; expiresAt: Date | null };
      },
    ) => {
      const existing = bans.find(
        (b) =>
          b.streamId === String(q.streamId) && b.userId === String(q.userId),
      );
      if (existing) {
        Object.assign(existing, update.$set);
        return existing;
      }
      const row = {
        streamId: String(q.streamId),
        userId: String(q.userId),
        ...update.$set,
      };
      bans.push(row);
      return row;
    },
    deleteOne: async (q: { streamId: unknown; userId: unknown }) => {
      bans = bans.filter(
        (b) =>
          !(b.streamId === String(q.streamId) && b.userId === String(q.userId)),
      );
      return {};
    },
    find: (q: { streamId: unknown }) => ({
      sort: () => ({
        lean: async () =>
          bans.filter((b) => b.streamId === String(q.streamId)),
      }),
    }),
  },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
  Notification: {},
}));

describe("moderation endpoints", () => {
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
      guests: [],
      pinnedMessage: null,
    };
    caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "" };
    chatMessages = [];
    bans = [];
    dataEvents.length = 0;
  });

  const asHost = () => {
    caller = { _id: id(HOST_ID), username: "host", avatar: "" };
  };
  const postChat = () =>
    app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/chat`,
      payload: { content: "gm" },
    });
  const ban = (minutes?: number) =>
    app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/ban/${VIEWER_ID}`,
      payload: minutes ? { minutes } : {},
    });

  it("host deletes a message; the room is told which one", async () => {
    await postChat();
    expect(chatMessages).toHaveLength(1);

    asHost();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/streams/${STREAM_ID}/chat/${MSG_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(chatMessages).toHaveLength(0);
    expect(
      dataEvents.find(
        (e) => e.__evt === "chat_delete" && e.messageId === MSG_ID,
      ),
    ).toBeTruthy();
  });

  it("only the host deletes messages", async () => {
    await postChat();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/streams/${STREAM_ID}/chat/${MSG_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(chatMessages).toHaveLength(1);
  });

  it("banning wipes the user's messages and blocks further chat", async () => {
    await postChat();
    asHost();
    const res = await ban();
    expect(res.statusCode).toBe(200);
    expect(chatMessages).toHaveLength(0);
    expect(
      dataEvents.find(
        (e) => e.__evt === "chat_ban" && e.userId === VIEWER_ID,
      ),
    ).toBeTruthy();

    caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "" };
    const blocked = await postChat();
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("BANNED");
  });

  it("a timeout expires on its own", async () => {
    asHost();
    await ban(10);
    expect(bans[0].expiresAt).toBeInstanceOf(Date);

    // Simulate the clock passing the expiry.
    bans[0].expiresAt = new Date(Date.now() - 1000);
    caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "" };
    const res = await postChat();
    expect(res.statusCode).toBe(200);
  });

  it("unban restores chat", async () => {
    asHost();
    await ban();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/streams/${STREAM_ID}/ban/${VIEWER_ID}`,
    });
    expect(res.statusCode).toBe(200);

    caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "" };
    expect((await postChat()).statusCode).toBe(200);
  });

  it("a banned user cannot request the stage either", async () => {
    asHost();
    await ban();
    caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "" };
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/guests/request`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("BANNED");
  });

  it("the host cannot ban themselves", async () => {
    asHost();
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/ban/${HOST_ID}`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("lists bans for the host", async () => {
    asHost();
    await ban();
    const res = await app.inject({
      method: "GET",
      url: `/api/streams/${STREAM_ID}/bans`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.bans).toHaveLength(1);
  });

  it("host pins a message; the room gets the content", async () => {
    await postChat();
    asHost();
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/chat/${MSG_ID}/pin`,
    });

    expect(res.statusCode).toBe(200);
    expect(streamDoc.pinnedMessage).toMatchObject({ content: "gm" });
    expect(
      dataEvents.find(
        (e) =>
          e.__evt === "pin" &&
          (e.message as { content?: string })?.content === "gm",
      ),
    ).toBeTruthy();
  });

  it("only the host pins, and pinning nothing 404s", async () => {
    await postChat();
    const forbidden = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/chat/${MSG_ID}/pin`,
    });
    expect(forbidden.statusCode).toBe(403);

    asHost();
    const missing = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/chat/${"f".repeat(24)}/pin`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("unpin clears the banner", async () => {
    await postChat();
    asHost();
    await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/chat/${MSG_ID}/pin`,
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/streams/${STREAM_ID}/pin`,
    });

    expect(res.statusCode).toBe(200);
    expect(streamDoc.pinnedMessage).toBeNull();
    expect(dataEvents.some((e) => e.__evt === "unpin")).toBe(true);
  });
});
