import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Stage guests: the API is the only party that may flip a viewer's LiveKit
 * publish permission, and it must only do so after the Stream document
 * records the transition. These tests pin that ordering and the status codes
 * the studio/viewer clients key their UI off.
 */

const HOST_ID = "a".repeat(24);
const VIEWER_ID = "b".repeat(24);
const OTHER_ID = "c".repeat(24);
const STREAM_ID = "d".repeat(24);

const id = (v: unknown) => ({
  toString: () => String(v),
  equals: (o: unknown) => String(o) === String(v),
});

interface GuestRow {
  userId: ReturnType<typeof id>;
  username: string;
  avatar: string;
  status: "requested" | "live";
  requestedAt: Date;
}

/** The single in-memory stream document the mocked model serves. */
let streamDoc: {
  _id: ReturnType<typeof id>;
  streamerId: ReturnType<typeof id>;
  isLive: boolean;
  livekitRoomName: string;
  guests: GuestRow[];
};

/** Who `authenticate` resolves to — switched per test. */
let caller: { _id: ReturnType<typeof id>; username: string; avatar: string };

const permissionCalls: Array<{ identity: string; canPublish: boolean }> = [];
const dataEvents: Array<Record<string, unknown>> = [];
/** When set, the LiveKit permission update throws (participant gone). */
let permissionShouldFail = false;

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
  setParticipantPublishPermission: async (
    _room: string,
    identity: string,
    canPublish: boolean,
  ) => {
    if (permissionShouldFail) throw new Error("participant not found");
    permissionCalls.push({ identity, canPublish });
  },
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
      // guests.ts calls both `findById(id)` and `findById(id).select(...)`.
      return Object.assign(Promise.resolve(doc), { select: async () => doc });
    },
    findOneAndUpdate: async (
      filter: Record<string, unknown>,
      update: Record<string, Record<string, unknown>>,
    ) => {
      if (String(filter._id) !== STREAM_ID) return null;
      const push = update.$push?.guests as GuestRow | undefined;
      if (push) {
        if (!streamDoc.isLive) return null;
        if (streamDoc.guests.some((g) => g.userId.equals(push.userId))) {
          return null;
        }
        if (streamDoc.guests.length >= 25) return null;
        streamDoc.guests.push({ ...push, userId: id(String(push.userId)) });
        return streamDoc;
      }
      if (update.$set?.["guests.$.status"] === "live") {
        const match = (
          filter.guests as { $elemMatch: { userId: string; status: string } }
        ).$elemMatch;
        const guest = streamDoc.guests.find(
          (g) => g.userId.equals(match.userId) && g.status === match.status,
        );
        if (!guest) return null;
        guest.status = "live";
        return streamDoc;
      }
      return null;
    },
    updateOne: async (
      _filter: unknown,
      update: Record<string, Record<string, unknown>>,
    ) => {
      const pull = update.$pull?.guests as
        | { userId: unknown; status?: string }
        | undefined;
      if (pull) {
        streamDoc.guests = streamDoc.guests.filter(
          (g) =>
            !(
              g.userId.equals(pull.userId) &&
              (pull.status === undefined || g.status === pull.status)
            ),
        );
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

describe("stage guest endpoints", () => {
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
    };
    caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "" };
    permissionCalls.length = 0;
    dataEvents.length = 0;
    permissionShouldFail = false;
  });

  const asHost = () => {
    caller = { _id: id(HOST_ID), username: "host", avatar: "" };
  };
  const request = () =>
    app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/request` });
  const approve = (userId = VIEWER_ID) =>
    app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/guests/${userId}/approve`,
    });

  it("records a request and announces it, without touching permissions", async () => {
    const res = await request();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("requested");
    expect(streamDoc.guests).toHaveLength(1);
    expect(permissionCalls).toHaveLength(0);
    expect(dataEvents.some((e) => e.__evt === "guest_request")).toBe(true);
  });

  it("treats a duplicate request as the same request", async () => {
    await request();
    const res = await request();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("requested");
    expect(streamDoc.guests).toHaveLength(1);
  });

  it("refuses the host requesting their own stage", async () => {
    asHost();
    const res = await request();

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("HOST_CANNOT_REQUEST");
  });

  it("approve grants publish only after the document says live", async () => {
    await request();
    asHost();
    const res = await approve();

    expect(res.statusCode).toBe(200);
    expect(streamDoc.guests[0].status).toBe("live");
    expect(permissionCalls).toEqual([
      { identity: VIEWER_ID, canPublish: true },
    ]);
    expect(
      dataEvents.find((e) => e.__evt === "guest_update" && e.action === "approved"),
    ).toBeTruthy();
  });

  it("only the host may approve", async () => {
    await request();
    caller = { _id: id(OTHER_ID), username: "other", avatar: "" };
    const res = await approve();

    expect(res.statusCode).toBe(403);
    expect(permissionCalls).toHaveLength(0);
  });

  it("rolls the request back when the guest is no longer connected", async () => {
    await request();
    asHost();
    permissionShouldFail = true;
    const res = await approve();

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("GUEST_NOT_CONNECTED");
    // The slot must not stay occupied by a ghost.
    expect(streamDoc.guests).toHaveLength(0);
  });

  it("caps the stage at MAX_STAGE_GUESTS live guests", async () => {
    streamDoc.guests = ["1", "2", "3"].map((n) => ({
      userId: id(n.repeat(24)),
      username: `g${n}`,
      avatar: "",
      status: "live" as const,
      requestedAt: new Date(),
    }));
    streamDoc.guests.push({
      userId: id(VIEWER_ID),
      username: "viewer",
      avatar: "",
      status: "requested",
      requestedAt: new Date(),
    });
    asHost();
    const res = await approve();

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STAGE_FULL");
  });

  it("leaving the stage revokes publish and frees the slot", async () => {
    streamDoc.guests = [
      {
        userId: id(VIEWER_ID),
        username: "viewer",
        avatar: "",
        status: "live",
        requestedAt: new Date(),
      },
    ];
    const res = await app.inject({
      method: "POST",
      url: `/api/streams/${STREAM_ID}/guests/leave`,
    });

    expect(res.statusCode).toBe(200);
    expect(streamDoc.guests).toHaveLength(0);
    expect(permissionCalls).toEqual([
      { identity: VIEWER_ID, canPublish: false },
    ]);
  });
});
