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
let caller: { _id: ReturnType<typeof id>; username: string; avatar: string; createdAt?: Date };

/** The host's request line, their crew, and where the caller stands with them. */
let hostSettings: Record<string, unknown> = {};
let hostMods: Array<{ userId: string; role: string }> = [];
let allied = false;
let fanLevel = 0;

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

vi.mock("../src/fans.js", () => ({
  fanStatus: async () => ({ level: fanLevel, hours: fanLevel * 4, badge: 0 }),
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
  // The channel, for the role check (the host, or a producer, runs the stage) and its request line.
  User: {
    findById: () => ({
      select: () => {
        const host = { _id: HOST_ID, username: "host", displayName: "Host", settings: hostSettings, safety: { mods: hostMods } };
        return Object.assign(Promise.resolve(host), { lean: async () => host });
      },
    }),
  },
  Follow: { exists: async () => (allied ? { _id: "f1" } : null) },
  ChatMessage: {},
  StreamBan: { findOne: async () => null },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

/** A fresh live stream with no one on stage, and a month-old viewer asking. */
function reset() {
  streamDoc = {
    _id: id(STREAM_ID),
    streamerId: id(HOST_ID),
    isLive: true,
    livekitRoomName: "room-1",
    guests: [],
  };
  caller = { _id: id(VIEWER_ID), username: "viewer", avatar: "", createdAt: new Date(Date.now() - 30 * 86_400_000) };
  hostSettings = {};
  hostMods = [];
  allied = false;
  fanLevel = 0;
  permissionCalls.length = 0;
  dataEvents.length = 0;
  permissionShouldFail = false;
}

describe("stage guest endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(reset);

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

describe("the stage request line", () => {
  // Its own app: the request route's rate limit counts per app.
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(reset);
  const request = () => app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/request` });

  const refused = async (code: string) => {
    const res = await request();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe(code);
    expect(streamDoc.guests).toHaveLength(0);
    return res.json().message as string;
  };

  it("stays closed when the host turned requests off", async () => {
    hostSettings = { stageRequests: "off" };
    expect(await refused("STAGE_CLOSED")).toBe("Host isn't taking requests to join right now");
  });

  it("lets only allies ask when the host says so", async () => {
    hostSettings = { stageRequests: "allies" };
    await refused("STAGE_ALLIES_ONLY");
    allied = true;
    expect((await request()).statusCode).toBe(200);
  });

  it("lets only fans at level 3 or more ask when the host says so", async () => {
    hostSettings = { stageRequests: "fans" };
    fanLevel = 2;
    expect(await refused("STAGE_FANS_ONLY")).toContain("you're level 2");
    fanLevel = 3;
    expect((await request()).statusCode).toBe(200);
  });

  it("makes brand-new accounts wait", async () => {
    hostSettings = { stageAccountDays: 1 };
    caller = { ...caller, createdAt: new Date(Date.now() - 2 * 3_600_000) };
    expect(await refused("STAGE_NEW_ACCOUNT")).toContain("a day old");
  });

  it("never holds back the host's crew", async () => {
    hostSettings = { stageRequests: "off", stageAccountDays: 7 };
    hostMods = [{ userId: VIEWER_ID, role: "mod" }];
    caller = { ...caller, createdAt: new Date() };
    expect((await request()).statusCode).toBe(200);
  });

  it("tells the host where someone asking stands, and viewers who can ask", async () => {
    hostSettings = { stageRequests: "allies", stageAccountDays: 1 };
    allied = true;
    fanLevel = 4;
    await request();
    const announced = dataEvents.find((e) => e.__evt === "guest_request");
    expect(announced?.standing).toEqual({ ally: true, level: 4, hours: 16 });
    const state = (await app.inject({ method: "GET", url: `/api/streams/${STREAM_ID}/guests` })).json().data;
    expect(state.requests[0].standing).toEqual({ ally: true, level: 4, hours: 16 });
    expect(state.line).toEqual({ who: "allies", accountDays: 1 });
  });
});
