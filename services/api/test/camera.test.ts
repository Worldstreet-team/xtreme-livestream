import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { sceneBodySchema } from "@xtreme/contracts";

/**
 * A second phone as a camera (angles): the studio mints a one-time code,
 * the phone trades it — no sign-in — for a camera-only token under
 * `cam-<hostId>`, waits on the same code until the host is live, and is
 * never counted as a viewer. And the scene carries which camera the
 * program shows.
 */

const state = vi.hoisted(() => ({
  signedIn: true,
  tokens: [] as Array<{ room: string; identity: string; name: string; options: Record<string, unknown> }>,
  /** Identities LiveKit lists in the room right now. */
  inRoom: [] as string[],
  /** What the signed webhook "says" — switched per test. */
  event: { event: "ignored" } as Record<string, unknown>,
}));
const HOST = new mongoose.Types.ObjectId();
const VIEWER = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
  };
});
vi.mock("../src/auth.js", async () => {
  const { ApiError } = await import("../src/errors.js");
  return {
    authenticate: async () => {
      if (!state.signedIn) throw new ApiError(401, "Authentication required", "UNAUTHORIZED");
      const { User } = (await import("../src/models.js")) as unknown as { User: { rows: Array<Record<string, unknown>> } };
      return { dbUser: User.rows.find((r) => String(r._id) === String(HOST)) };
    },
    getOptionalAuthUserId: () => (state.signedIn ? "clerk_host" : null),
  };
});
vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => state.inRoom.map((identity) => ({ identity })) },
  ingressClient: {},
  webhookReceiver: { receive: async () => state.event },
  createToken: async (room: string, identity: string, name: string, options: Record<string, unknown>) => {
    state.tokens.push({ room, identity, name, options });
    return "token";
  },
  ensureUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  rotateUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async (_room: string, identity: string) => state.inRoom.includes(identity),
  setParticipantPublishPermission: async () => {},
  setRoomScene: async () => {},
  sendRoomData: async () => {},
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));
vi.mock("../src/watch-sessions.js", () => ({
  openWatchSession: async () => {},
  closeWatchSession: async () => {},
  closeAllWatchSessions: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { resetCameraLinks, CAMERA_LINK_TTL_MS, CAMERA_RETRY_MS } = await import("../src/routes/camera.js");
const { nextPhoneSlot } = await import("../src/scene-put.js");

describe("a second phone as a camera", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const m of Object.values(db)) m.reset();
    resetCameraLinks();
    state.signedIn = true;
    state.tokens = [];
    state.inRoom = [];
    state.event = { event: "ignored" };
    db.User!.insert({ _id: HOST, username: "amara", displayName: "Amara Obi", avatar: "", safety: { mods: [] } });
  });

  /** Amara goes live — a rehearsal when `practice` is set. */
  const goLive = (practice = false) =>
    db.Stream!.insert({
      streamerId: HOST,
      title: "Friday night desk",
      category: "Bitcoin Trading",
      isLive: true,
      practice,
      source: "camera",
      livekitRoomName: "room-1",
      startedAt: new Date(),
      feedDroppedAt: null,
      guests: [],
      viewers: 0,
      peakViewers: 0,
      viewerSeconds: 0,
      viewerSampledAt: null,
      scene: { layout: "auto", card: null, cardNote: "", chart: null, layers: [], gains: {}, spotlight: null, interpreter: null, featured: null, version: 1 },
    });
  const mint = async () => {
    const res = await app.inject({ method: "POST", url: "/api/users/me/camera-link" });
    expect(res.statusCode).toBe(200);
    return res.json().data as { code: string; url: string; expiresAt: string };
  };
  const join = (code: string) => app.inject({ method: "POST", url: `/api/camera/${code}/join` });
  const deliver = (event: string, identity: string) => {
    state.event = { event, room: { name: "room-1" }, participant: { identity } };
    return app.inject({
      method: "POST",
      url: "/api/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "signed" },
      payload: JSON.stringify(state.event),
    });
  };

  it("needs a signed-in creator to mint a code", async () => {
    state.signedIn = false;
    const res = await app.inject({ method: "POST", url: "/api/users/me/camera-link" });
    expect(res.statusCode).toBe(401);
  });

  it("mints a ten-minute code and the phone's address", async () => {
    const before = Date.now();
    const link = await mint();
    expect(link.code).toMatch(/^[a-z0-9]{10}$/);
    expect(link.url).toBe(`/camera/${link.code}`);
    const expiresAt = Date.parse(link.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + CAMERA_LINK_TTL_MS - 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + CAMERA_LINK_TTL_MS);
  });

  it("says whose camera a code is for, and whether they're live, without spending it", async () => {
    const { code, expiresAt } = await mint();
    const peek = () => app.inject({ method: "GET", url: `/api/camera/${code}` });
    expect((await peek()).json().data).toEqual({ hostName: "Amara Obi", live: false, expiresAt });
    goLive();
    expect((await peek()).json().data).toMatchObject({ hostName: "Amara Obi", live: true });
    // Looking is free: the code still joins, once.
    expect((await join(code)).statusCode).toBe(200);
    const spent = await app.inject({ method: "GET", url: `/api/camera/${code}` });
    expect(spent.statusCode).toBe(410);
    expect((await app.inject({ method: "GET", url: "/api/camera/nope123456" })).statusCode).toBe(404);
  });

  it("turns away a code it never made, and one that isn't a code", async () => {
    const res = await join("nope123456");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("CAMERA_LINK_INVALID");
    expect((await join("not%20a%20code!")).statusCode).toBe(400);
    expect(state.tokens).toEqual([]);
  });

  it("treats an expired code as one to scan again", async () => {
    goLive();
    const { code } = await mint();
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + CAMERA_LINK_TTL_MS + 60_000);
    try {
      const res = await join(code);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("CAMERA_LINK_INVALID");
    } finally {
      now.mockRestore();
    }
    expect(state.tokens).toEqual([]);
  });

  it("holds the phone until the host is live — on the same code, with who it's waiting for", async () => {
    const { code } = await mint();
    const waiting = await join(code);
    expect(waiting.statusCode).toBe(409);
    expect(waiting.json()).toMatchObject({ success: false, code: "NOT_LIVE", retryInMs: CAMERA_RETRY_MS, hostName: "Amara Obi" });
    expect(state.tokens).toEqual([]);

    goLive();
    const res = await join(code);
    expect(res.statusCode).toBe(200);
    expect(state.tokens).toHaveLength(1);
  });

  it("gives the phone a camera-only token under the host's account, and nothing to hear", async () => {
    const stream = goLive();
    const { code } = await mint();
    const res = await join(code);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ token: "token", livekitUrl: "wss://example.livekit.cloud", streamId: String(stream._id), hostName: "Amara Obi" });
    expect(state.tokens).toEqual([
      {
        room: "room-1",
        identity: `cam-${HOST}`,
        name: "Amara Obi · phone cam",
        options: { canPublish: true, canSubscribe: false, canPublishData: false, canPublishSources: ["camera"] },
      },
    ]);
  });

  it("is one phone per code: the second use is refused", async () => {
    goLive();
    const { code } = await mint();
    expect((await join(code)).statusCode).toBe(200);
    const again = await join(code.toUpperCase());
    expect(again.statusCode).toBe(410);
    expect(again.json().code).toBe("CAMERA_LINK_USED");
    expect(state.tokens).toHaveLength(1);
  });

  it("counts a practice run as live: it's the crew's own phone", async () => {
    goLive(true);
    const { code } = await mint();
    expect((await join(code)).statusCode).toBe(200);
    expect(state.tokens[0]?.identity).toBe(`cam-${HOST}`);
  });

  it("never counts the phone cam as a viewer", async () => {
    const stream = goLive();
    state.inRoom = [String(HOST), `cam-${HOST}`];
    expect((await deliver("participant_joined", `cam-${HOST}`)).statusCode).toBe(200);
    expect(stream.viewers).toBe(0);
    expect(stream.peakViewers).toBe(0);

    // A real viewer arrives: they're the one, not the phone.
    state.inRoom = [String(HOST), `cam-${HOST}`, String(VIEWER)];
    expect((await deliver("participant_joined", String(VIEWER))).statusCode).toBe(200);
    expect(stream.viewers).toBe(1);
    expect(stream.peakViewers).toBe(1);
  });

  it("carries the angle on the scene: main unless the host cut away, and kept when a client doesn't send one", async () => {
    const stream = goLive();
    const put = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: `/api/streams/${stream._id}/scene`, payload });

    const plain = await put({ layout: "solo" });
    expect(plain.statusCode).toBe(200);
    expect(plain.json().data.scene).toMatchObject({ layout: "solo", angle: "main" });

    const phone = await put({ layout: "solo", angle: "phone" });
    expect(phone.json().data.scene).toMatchObject({ angle: "phone", version: 3 });

    // An older client sends the whole scene without an angle: the phone stays on the program.
    const older = await put({ layout: "split" });
    expect(older.json().data.scene).toMatchObject({ layout: "split", angle: "phone" });

    expect((await put({ angle: "wide" })).statusCode).toBe(400);
  });

  it("takes the angle on the wire as optional, and only the three there are", () => {
    expect(sceneBodySchema.parse({ angle: "both" }).angle).toBe("both");
    expect("angle" in sceneBodySchema.parse({})).toBe(false);
    expect(sceneBodySchema.safeParse({ angle: "wide" }).success).toBe(false);
  });

  it("places the phone in any layout, and keeps the angle in step for clients that only know angles", async () => {
    const stream = goLive();
    const put = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: `/api/streams/${stream._id}/scene`, payload });

    // A stream from before placements reads its phone from its angle.
    const before = await put({ layout: "auto" });
    expect(before.json().data.scene).toMatchObject({ phoneSlot: "off", angle: "main" });

    // Screen + face with the phone as the face: a placement the angle has no word for.
    const face = await put({ layout: "screen-face", phoneSlot: "corner" });
    expect(face.statusCode).toBe(200);
    expect(face.json().data.scene).toMatchObject({ layout: "screen-face", phoneSlot: "corner", angle: "main" });
    expect(stream.scene).toMatchObject({ layout: "screen-face", phoneSlot: "corner", angle: "main" });

    // An older client echoes the whole scene with the angle it read: the phone stays the face.
    const echoed = await put({ layout: "screen-face", angle: "main" });
    expect(echoed.json().data.scene).toMatchObject({ phoneSlot: "corner", angle: "main" });

    // …and one that cuts to the phone moves it.
    const cut = await put({ layout: "screen-face", angle: "phone" });
    expect(cut.json().data.scene).toMatchObject({ phoneSlot: "main", angle: "phone" });

    // Split, the camera and the phone side by side: its angle reads "both".
    const side = await put({ layout: "split", phoneSlot: "beside" });
    expect(side.json().data.scene).toMatchObject({ layout: "split", phoneSlot: "beside", angle: "both" });

    // The placement wins over an angle sent alongside it.
    const both = await put({ layout: "solo", phoneSlot: "main", angle: "main" });
    expect(both.json().data.scene).toMatchObject({ phoneSlot: "main", angle: "phone" });

    // Nothing sent about the phone: it stays where it is.
    const quiet = await put({ layout: "auto" });
    expect(quiet.json().data.scene).toMatchObject({ layout: "auto", phoneSlot: "main", angle: "phone" });

    expect((await put({ phoneSlot: "ceiling" })).statusCode).toBe(400);
  });

  it("reads a stored angle as its placement, for streams from before placements", async () => {
    const stream = goLive();
    (stream.scene as Record<string, unknown>).angle = "both";
    const put = (payload: Record<string, unknown>) => app.inject({ method: "PUT", url: `/api/streams/${stream._id}/scene`, payload });
    const res = await put({ layout: "auto" });
    expect(res.json().data.scene).toMatchObject({ phoneSlot: "beside", angle: "both" });
  });

  it("takes the placement on the wire as optional, and only the four there are", () => {
    expect(sceneBodySchema.parse({ phoneSlot: "corner" }).phoneSlot).toBe("corner");
    expect("phoneSlot" in sceneBodySchema.parse({})).toBe(false);
    expect(sceneBodySchema.safeParse({ phoneSlot: "ceiling" }).success).toBe(false);
  });

  it("decides where the phone goes from what was sent and what's stored", () => {
    expect(nextPhoneSlot({ phoneSlot: "corner" }, { angle: "phone" })).toBe("corner");
    expect(nextPhoneSlot({}, { phoneSlot: "corner", angle: "main" })).toBe("corner");
    expect(nextPhoneSlot({ angle: "main" }, { phoneSlot: "corner", angle: "main" })).toBe("corner");
    expect(nextPhoneSlot({ angle: "both" }, { phoneSlot: "corner", angle: "main" })).toBe("beside");
    expect(nextPhoneSlot({ angle: "main" }, { phoneSlot: "beside", angle: "both" })).toBe("off");
    expect(nextPhoneSlot({}, { angle: "phone" })).toBe("main");
    expect(nextPhoneSlot({}, null)).toBe("off");
  });
});
