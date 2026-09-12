import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Co-live merge: two creators, each live, combine into one stream. The
 * inviter's stream becomes the primary; the accepter joins its stage and
 * their own stream ends, with their room told where everyone went.
 * Consent is the invite — accepting without one is refused.
 */

const HOST_A = "a".repeat(24); // inviter
const HOST_B = "b".repeat(24); // accepter
const STREAM_A = "d".repeat(24);
const STREAM_B = "e".repeat(24);

const id = (v: unknown) => ({
  toString: () => String(v),
  equals: (o: unknown) => String(o) === String(v),
});

interface Doc {
  _id: ReturnType<typeof id>;
  streamerId: ReturnType<typeof id>;
  isLive: boolean;
  livekitRoomName: string;
  guests: Array<{
    userId: ReturnType<typeof id>;
    username: string;
    status: string;
  }>;
}

let streams: Record<string, Doc>;
let caller: { _id: ReturnType<typeof id>; username: string; avatar: string };
const dataEvents: Array<{ room: string; payload: Record<string, unknown> }> =
  [];
const endedStreams: string[] = [];
const permissionCalls: Array<{ identity: string; canPublish: boolean }> = [];

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: caller }),
  getOptionalAuthUserId: () => "clerk_x",
}));

vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [] },
  ingressClient: {},
  webhookReceiver: { receive: async () => ({ event: "ignored" }) },
  createToken: async (room: string, identity: string) =>
    `token:${room}:${identity}`,
  createRtmpIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  sendRoomData: async (room: string, payload: Record<string, unknown>) => {
    dataEvents.push({ room, payload });
  },
  setParticipantPublishPermission: async (
    _room: string,
    identity: string,
    canPublish: boolean,
  ) => {
    permissionCalls.push({ identity, canPublish });
  },
}));

vi.mock("../src/stream-service.js", () => ({
  reconcileStream: async (s: { isLive: boolean }) => s.isLive,
  reconcileLeanStreams: async () => new Set(),
  markStreamEnded: async (s: Doc) => {
    s.isLive = false;
    endedStreams.push(String(s._id));
  },
  thumbnailUrlFor: () => null,
  accrueViewerSeconds: () => {},
  parseImageDataUri: () => null,
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: (lookup: unknown) => {
      const doc = streams[String(lookup)] ?? null;
      return Object.assign(Promise.resolve(doc), { select: async () => doc });
    },
    findOne: async (q: { streamerId: unknown; isLive: boolean }) =>
      Object.values(streams).find(
        (s) => s.streamerId.equals(q.streamerId) && s.isLive === q.isLive,
      ) ?? null,
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) => {
      const doc = streams[String(filter._id)];
      if (!doc) return null;
      const push = update.$push?.guests as Doc["guests"][number] | undefined;
      if (push) {
        if (doc.guests.some((g) => g.userId.equals(push.userId))) return null;
        doc.guests.push({ ...push, userId: id(String(push.userId)) });
        return doc;
      }
      return null;
    },
    updateOne: async (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) => {
      const doc = streams[String(filter._id)];
      const pull = update.$pull?.guests as { userId: unknown } | undefined;
      if (doc && pull) {
        doc.guests = doc.guests.filter((g) => !g.userId.equals(pull.userId));
      }
      return {};
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

describe("co-live merge", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const { clearCoLiveInvites } = await import("../src/routes/colive.js");
    clearCoLiveInvites();
    streams = {
      [STREAM_A]: {
        _id: id(STREAM_A),
        streamerId: id(HOST_A),
        isLive: true,
        livekitRoomName: "room-a",
        guests: [],
      },
      [STREAM_B]: {
        _id: id(STREAM_B),
        streamerId: id(HOST_B),
        isLive: true,
        livekitRoomName: "room-b",
        guests: [],
      },
    };
    caller = { _id: id(HOST_A), username: "hosta", avatar: "" };
    dataEvents.length = 0;
    endedStreams.length = 0;
    permissionCalls.length = 0;
  });

  const invite = () =>
    app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_B}/colive/invite`,
    });
  const accept = (from = STREAM_A) => {
    caller = { _id: id(HOST_B), username: "hostb", avatar: "" };
    return app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_B}/colive/accept`,
      payload: { fromStreamId: from },
    });
  };

  it("a live host invites another live host; the target room hears it", async () => {
    const res = await invite();
    expect(res.statusCode).toBe(200);
    const evt = dataEvents.find(
      (e) => e.room === "room-b" && e.payload.__evt === "colive_invite",
    );
    expect(evt).toBeTruthy();
    expect(evt!.payload.fromStreamId).toBe(STREAM_A);
  });

  it("only a live host may invite", async () => {
    streams[STREAM_A].isLive = false;
    const res = await invite();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("NOT_LIVE");
  });

  it("accept without an invite is refused", async () => {
    const res = await accept();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NO_INVITE");
  });

  it("accept merges: guest on primary, own stream ends, viewers redirected", async () => {
    await invite();
    const res = await accept();

    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    // The accepter gets a publisher token for the PRIMARY room…
    expect(body.primaryStreamId).toBe(STREAM_A);
    expect(body.token).toBe(`token:room-a:${HOST_B}`);
    // …is recorded as a live stage guest there…
    expect(
      streams[STREAM_A].guests.some(
        (g) => g.userId.equals(HOST_B) && g.status === "live",
      ),
    ).toBe(true);
    // …their own stream is over…
    expect(endedStreams).toContain(STREAM_B);
    // …their viewers are told where the party moved…
    const merged = dataEvents.find(
      (e) => e.room === "room-b" && e.payload.__evt === "colive_merged",
    );
    expect(merged?.payload.into).toBe(STREAM_A);
    // …and the primary room sees them arrive on stage.
    expect(
      dataEvents.some(
        (e) =>
          e.room === "room-a" &&
          e.payload.__evt === "guest_update" &&
          e.payload.action === "approved",
      ),
    ).toBe(true);
  });

  it("an invite can't be replayed after accept", async () => {
    await invite();
    await accept();
    // Restore B to live to isolate the replay check.
    streams[STREAM_B].isLive = true;
    const res = await accept();
    expect(res.statusCode).toBe(403);
  });

  it("decline clears the invite and tells the inviter", async () => {
    await invite();
    caller = { _id: id(HOST_B), username: "hostb", avatar: "" };
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_B}/colive/decline`,
      payload: { fromStreamId: STREAM_A },
    });
    expect(res.statusCode).toBe(200);
    expect(
      dataEvents.some(
        (e) =>
          e.room === "room-a" && e.payload.__evt === "colive_decline",
      ),
    ).toBe(true);

    const retry = await accept();
    expect(retry.statusCode).toBe(403);
  });

  it("claim grants publish to a recorded live guest who reconnected", async () => {
    streams[STREAM_A].guests = [
      { userId: id(HOST_B), username: "hostb", status: "live" },
    ];
    caller = { _id: id(HOST_B), username: "hostb", avatar: "" };
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_A}/guests/claim`,
    });
    expect(res.statusCode).toBe(200);
    expect(permissionCalls).toEqual([
      { identity: HOST_B, canPublish: true },
    ]);
  });

  it("claim refuses someone not on the stage", async () => {
    caller = { _id: id(HOST_B), username: "hostb", avatar: "" };
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_A}/guests/claim`,
    });
    expect(res.statusCode).toBe(403);
    expect(permissionCalls).toHaveLength(0);
  });
});
