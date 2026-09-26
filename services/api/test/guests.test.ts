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

type GuestStatus = "requested" | "backstage" | "live";

interface GuestRow {
  userId: ReturnType<typeof id>;
  username: string;
  avatar: string;
  status: GuestStatus;
  requestedAt: Date;
  standing?: { ally: boolean; level: number; hours: number };
}

/** A guest row as the seeded document holds it. */
const row = (userId: string, username: string, status: GuestStatus): GuestRow => ({
  userId: id(userId),
  username,
  avatar: "",
  status,
  requestedAt: new Date(),
});

/**
 * The status flip both routes write: `{ guests: { $elemMatch: { userId,
 * status } } }` with `$set: { "guests.$.status": next }`, where the matched
 * status is one value or a `$in` list. Returns the row it changed, if any.
 */
function flipStatus(
  filter: Record<string, unknown>,
  update: Record<string, Record<string, unknown>>,
): GuestRow | null {
  const next = update.$set?.["guests.$.status"] as GuestStatus | undefined;
  if (!next) return null;
  const match = (
    filter.guests as {
      $elemMatch: { userId: unknown; status: GuestStatus | { $in: GuestStatus[] } };
    }
  ).$elemMatch;
  const from = typeof match.status === "string" ? [match.status] : match.status.$in;
  const guest = streamDoc.guests.find(
    (g) => g.userId.equals(match.userId) && from.includes(g.status),
  );
  if (!guest) return null;
  guest.status = next;
  return guest;
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
/** What the whole room was sent. */
const dataEvents: Array<Record<string, unknown>> = [];
/** What only some identities were sent (the crew's copies). */
const targetedEvents: Array<{ to: string[]; payload: Record<string, unknown> }> = [];
/** When set, the LiveKit permission update throws (participant gone). */
let permissionShouldFail = false;
/** Whether the caller carries a session at all — off for the public GET. */
let signedIn = true;

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: caller }),
  getOptionalAuthUserId: () => (signedIn ? "clerk_x" : null),
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
  sendRoomDataTo: async (_room: string, to: string[], payload: Record<string, unknown>) => {
    targetedEvents.push({ to, payload });
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
      // approve / backstage: requested (or backstage) → the next status.
      return flipStatus(filter, update) ? streamDoc : null;
    },
    updateOne: async (
      filter: Record<string, unknown>,
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
      // The backstage rollback: backstage → requested when the grant failed.
      flipStatus(filter, update);
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
  targetedEvents.length = 0;
  permissionShouldFail = false;
  signedIn = true;
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
    streamDoc.guests = ["1", "2", "3"].map((n) => row(n.repeat(24), `g${n}`, "live"));
    streamDoc.guests.push(row(VIEWER_ID, "viewer", "requested"));
    asHost();
    const res = await approve();

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("STAGE_FULL");
  });

  it("leaving the stage revokes publish and frees the slot", async () => {
    streamDoc.guests = [row(VIEWER_ID, "viewer", "live")];
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

describe("backstage", () => {
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

  const asHost = () => {
    caller = { _id: id(HOST_ID), username: "host", avatar: "" };
  };
  const request = () => app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/request` });
  const backstage = (userId = VIEWER_ID) =>
    app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/${userId}/backstage` });
  const approve = (userId = VIEWER_ID) =>
    app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/${userId}/approve` });
  const state = async () => (await app.inject({ method: "GET", url: `/api/streams/${STREAM_ID}/guests` })).json().data;
  const updates = () => dataEvents.filter((e) => e.__evt === "guest_update").map((e) => e.action);

  it("moves a requester backstage, grants publish, and tells the room — then approve brings them on", async () => {
    await request();
    asHost();

    const res = await backstage();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("backstage");
    expect(streamDoc.guests[0].status).toBe("backstage");
    // The grant follows the write, like approve's.
    expect(permissionCalls).toEqual([{ identity: VIEWER_ID, canPublish: true }]);
    const announced = dataEvents.find((e) => e.__evt === "guest_update" && e.action === "backstage");
    expect(announced).toEqual({
      __evt: "guest_update",
      action: "backstage",
      userId: VIEWER_ID,
      username: "viewer",
      avatar: "",
    });

    const on = await approve();
    expect(on.statusCode).toBe(200);
    expect(on.json().data.status).toBe("live");
    expect(streamDoc.guests[0].status).toBe("live");
    // Granted again on approve — harmless, and covers a lost grant.
    expect(permissionCalls).toEqual([
      { identity: VIEWER_ID, canPublish: true },
      { identity: VIEWER_ID, canPublish: true },
    ]);
    expect(updates()).toEqual(["backstage", "approved"]);
  });

  it("is a no-op the second time, and refuses someone already on stage", async () => {
    streamDoc.guests = [row(VIEWER_ID, "viewer", "backstage"), row(OTHER_ID, "other", "live")];
    asHost();

    expect((await backstage()).statusCode).toBe(200);
    expect(permissionCalls).toHaveLength(0);
    expect(dataEvents).toHaveLength(0);

    const res = await backstage(OTHER_ID);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("GUEST_ALREADY_LIVE");
  });

  it("needs a pending request to work from", async () => {
    asHost();
    const res = await backstage();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("GUEST_REQUEST_NOT_FOUND");
  });

  it("doesn't count toward the stage cap, and a full stage doesn't close backstage", async () => {
    // Three on stage, one waiting backstage, one asking.
    streamDoc.guests = ["1", "2", "3"].map((n) => row(n.repeat(24), `g${n}`, "live"));
    streamDoc.guests.push(row(OTHER_ID, "other", "backstage"), row(VIEWER_ID, "viewer", "requested"));
    asHost();

    // The stage is full: nobody comes on, from backstage or from a request…
    expect((await approve(OTHER_ID)).json().code).toBe("STAGE_FULL");
    expect((await approve()).json().code).toBe("STAGE_FULL");
    // …but the wings are open.
    expect((await backstage()).statusCode).toBe(200);
    expect(streamDoc.guests.filter((g) => g.status === "backstage")).toHaveLength(2);

    // Two on stage and two backstage: the request cap counts the stage only.
    streamDoc.guests = ["1", "2"].map((n) => row(n.repeat(24), `g${n}`, "live"));
    streamDoc.guests.push(row(OTHER_ID, "other", "backstage"), row("e".repeat(24), "kemi", "backstage"), row(VIEWER_ID, "viewer", "requested"));
    expect((await approve()).statusCode).toBe(200);
    expect(streamDoc.guests.find((g) => g.userId.equals(VIEWER_ID))?.status).toBe("live");
  });

  it("holds at most MAX_BACKSTAGE people", async () => {
    streamDoc.guests = ["1", "2", "3", "4"].map((n) => row(n.repeat(24), `g${n}`, "backstage"));
    streamDoc.guests.push(row(VIEWER_ID, "viewer", "requested"));
    asHost();

    const res = await backstage();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BACKSTAGE_FULL");
    expect(streamDoc.guests.find((g) => g.userId.equals(VIEWER_ID))?.status).toBe("requested");
    expect(permissionCalls).toHaveLength(0);
  });

  it("puts the request back when the viewer is no longer connected", async () => {
    await request();
    asHost();
    permissionShouldFail = true;

    const res = await backstage();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("GUEST_NOT_CONNECTED");
    // Not dropped — the room webhook clears a real leaver; a blink can be retried.
    expect(streamDoc.guests).toHaveLength(1);
    expect(streamDoc.guests[0].status).toBe("requested");
    expect(dataEvents.some((e) => e.__evt === "guest_update")).toBe(false);
  });

  it("lets someone leave backstage themselves, revoking publish", async () => {
    streamDoc.guests = [row(VIEWER_ID, "viewer", "backstage")];
    const res = await app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/leave` });

    expect(res.statusCode).toBe(200);
    expect(streamDoc.guests).toHaveLength(0);
    expect(permissionCalls).toEqual([{ identity: VIEWER_ID, canPublish: false }]);
    expect(updates()).toEqual(["left"]);
  });

  it("lets the host remove someone from backstage", async () => {
    streamDoc.guests = [row(VIEWER_ID, "viewer", "backstage")];
    asHost();
    const res = await app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/${VIEWER_ID}/remove` });

    expect(res.statusCode).toBe(200);
    expect(streamDoc.guests).toHaveLength(0);
    expect(permissionCalls).toEqual([{ identity: VIEWER_ID, canPublish: false }]);
    expect(updates()).toEqual(["removed"]);
  });

  it("re-arms a backstage slot on claim (a reload), and says which it was", async () => {
    streamDoc.guests = [row(VIEWER_ID, "viewer", "backstage")];
    const res = await app.inject({ method: "POST", url: `/api/streams/${STREAM_ID}/guests/claim` });

    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe("backstage");
    expect(permissionCalls).toEqual([{ identity: VIEWER_ID, canPublish: true }]);
  });

  it("lists who's backstage beside the stage and the requests", async () => {
    streamDoc.guests = [row(OTHER_ID, "tolu", "live"), row(VIEWER_ID, "ada_k", "backstage"), row("e".repeat(24), "kemi", "requested")];
    const data = await state();

    expect(data.live.map((g: { username: string }) => g.username)).toEqual(["tolu"]);
    expect(data.backstage).toEqual([{ userId: VIEWER_ID, username: "ada_k", avatar: "", status: "backstage", standing: null }]);
    expect(data.requests.map((g: { username: string }) => g.username)).toEqual(["kemi"]);
    expect(data.maxBackstage).toBe(4);
  });

  it("a producer can send someone backstage; a moderator can't", async () => {
    await request();

    hostMods = [{ userId: OTHER_ID, role: "mod" }];
    caller = { _id: id(OTHER_ID), username: "other", avatar: "" };
    const asMod = await backstage();
    expect(asMod.statusCode).toBe(403);
    expect(streamDoc.guests[0].status).toBe("requested");
    expect(permissionCalls).toHaveLength(0);

    hostMods = [{ userId: OTHER_ID, role: "producer" }];
    const asProducer = await backstage();
    expect(asProducer.statusCode).toBe(200);
    expect(streamDoc.guests[0].status).toBe("backstage");
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

  const standing = { ally: true, level: 4, hours: 16 };
  const state = async () => (await app.inject({ method: "GET", url: `/api/streams/${STREAM_ID}/guests` })).json().data;

  it("tells the crew where someone asking stands — the room only that they asked", async () => {
    hostSettings = { stageRequests: "allies", stageAccountDays: 1 };
    hostMods = [{ userId: OTHER_ID, role: "mod" }];
    allied = true;
    fanLevel = 4;
    await request();

    // The room's copy: who asked, nothing about them.
    const announced = dataEvents.find((e) => e.__evt === "guest_request");
    expect(announced).toEqual({ __evt: "guest_request", userId: VIEWER_ID, username: "viewer", avatar: "" });
    expect(announced).not.toHaveProperty("standing");
    // The crew's copy — the host (and their consoles) and every moderator — carries it.
    const crew = targetedEvents.find((t) => t.payload.__evt === "guest_request");
    expect(crew?.payload).toEqual({ __evt: "guest_request", userId: VIEWER_ID, username: "viewer", avatar: "", standing });
    expect(crew?.to).toEqual(expect.arrayContaining([HOST_ID, `mon-${HOST_ID}`, `prod-${HOST_ID}`, OTHER_ID, `prod-${OTHER_ID}`]));
    expect(crew?.to).not.toContain(VIEWER_ID);
    // Who can ask is public.
    expect((await state()).line).toEqual({ who: "allies", accountDays: 1 });
  });

  it("shows standing on the list to the crew only", async () => {
    hostMods = [{ userId: OTHER_ID, role: "mod" }];
    allied = true;
    fanLevel = 4;
    await request();
    streamDoc.guests.push({ ...row("e".repeat(24), "kemi", "backstage"), standing } as GuestRow);

    // No session at all: the public list, without it.
    signedIn = false;
    let data = await state();
    expect(data.requests[0].standing).toBeNull();
    expect(data.backstage[0].standing).toBeNull();

    // Signed in, but just another viewer: still without it.
    signedIn = true;
    caller = { _id: id("f".repeat(24)), username: "tolu", avatar: "" };
    data = await state();
    expect(data.requests[0].standing).toBeNull();

    // The host sees it, and so does a moderator.
    caller = { _id: id(HOST_ID), username: "host", avatar: "" };
    data = await state();
    expect(data.requests[0].standing).toEqual(standing);
    expect(data.backstage[0].standing).toEqual(standing);
    caller = { _id: id(OTHER_ID), username: "other", avatar: "" };
    expect((await state()).requests[0].standing).toEqual(standing);
  });
});
