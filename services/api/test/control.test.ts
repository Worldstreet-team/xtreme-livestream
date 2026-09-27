import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The control API: a key is shown once and kept as a hash; it drives only
 * its owner's live stream, only as far as its scopes go, and stops working
 * the moment it's removed. "Next" moves the show and applies the segment's
 * cues the way the studio would — sponsor cards excepted, and said so.
 */

const HOST = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    ControlKey: new FakeModel("ControlKey", [{ keys: ["hash"] }]),
    User: new FakeModel("User"),
    Stream: new FakeModel("Stream"),
    Rundown: new FakeModel("Rundown"),
    ShowRule: new FakeModel("ShowRule"),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: HOST, username: "amara" } }),
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

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;

describe("the control API", () => {
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
    db.User!.insert({ _id: HOST, username: "amara", safety: { mods: [] } });
    db.Stream!.insert({
      streamerId: HOST,
      isLive: true,
      title: "Friday night desk",
      livekitRoomName: "room-1",
      startedAt: new Date(),
      rundown: null,
      moments: [],
      scene: { layout: "auto", card: null, cardNote: "", chart: null, layers: [], gains: {}, spotlight: null, featured: null, version: 1 },
    });
    db.Rundown!.insert({
      ownerId: HOST,
      segments: [
        { id: "seg001", title: "Cold open", seconds: 180, script: "", cues: [{ do: "card", card: "starting-soon" }] },
        {
          id: "seg002",
          title: "Guest",
          seconds: 600,
          script: "",
          cues: [
            { do: "layout", layout: "split" },
            { do: "lower-third", title: "Tolu", subtitle: "Guest" },
            { do: "sponsor", source: "own", sponsorId: String(new mongoose.Types.ObjectId()) },
          ],
        },
      ],
    });
  });

  const makeKey = async (scopes = ["scene", "sound", "show", "rules"]) => {
    const res = await app.inject({ method: "POST", url: "/v1/users/me/control-keys", payload: { name: "Stream Deck", scopes } });
    return res.json().data as { key: { id: string; prefix: string }; secret: string };
  };
  const press = (url: string, secret: string | null, payload?: unknown, header: "bearer" | "x" = "bearer") =>
    app.inject({
      method: "POST",
      url: `/v1${url}`,
      headers: secret ? (header === "bearer" ? { authorization: `Bearer ${secret}` } : { "x-xtream-key": secret }) : {},
      ...(payload ? { payload } : {}),
    });
  const scene = () => db.Stream!.rows[0]!.scene;

  it("shows a key once and keeps only its hash", async () => {
    const { key, secret } = await makeKey();
    expect(secret).toMatch(/^xck_[\w-]{32}$/);
    expect(key.prefix).toBe(secret.slice(0, 10));
    const row = db.ControlKey!.rows[0]!;
    expect(JSON.stringify(row)).not.toContain(secret);
    const listed = (await app.inject({ method: "GET", url: "/v1/users/me/control-keys" })).json().data.keys;
    expect(listed).toEqual([expect.objectContaining({ name: "Stream Deck", prefix: key.prefix })]);
    expect(JSON.stringify(listed)).not.toContain(secret);
  });

  it("changes the scene with a key, by either header", async () => {
    const { secret } = await makeKey();
    expect((await press("/control/do", secret, { actions: [{ do: "card", card: "brb" }] })).statusCode).toBe(200);
    expect(scene().card).toBe("brb");
    expect((await press("/control/do", secret, { actions: [{ do: "card", card: null }] }, "x")).statusCode).toBe(200);
    expect(scene().card).toBeNull();
  });

  it("turns away no key, a wrong key, and a key without the scope", async () => {
    expect((await press("/control/do", null, { actions: [{ do: "card", card: "brb" }] })).json().code).toBe("CONTROL_KEY_MISSING");
    expect((await press("/control/do", "xck_not-a-real-key-at-all-000000000000", { actions: [{ do: "card", card: "brb" }] })).json().code).toBe("CONTROL_KEY_INVALID");
    const { secret } = await makeKey(["sound"]);
    const res = await press("/control/do", secret, { actions: [{ do: "layout", layout: "solo" }] });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CONTROL_KEY_SCOPE");
    expect((await press("/control/do", secret, { actions: [{ do: "sound", pad: "airhorn" }] })).statusCode).toBe(200);
    expect(scene().layout).toBe("auto");
  });

  it("goes to the next segment with its cues, and says which it left to the studio", async () => {
    const { secret } = await makeKey();
    const first = (await press("/control/show", secret, { step: "next" })).json().data;
    expect(first).toMatchObject({ onAir: "Cold open", next: "Guest", skipped: [] });
    expect(scene().card).toBe("starting-soon");

    const second = (await press("/control/show", secret, { step: "next" })).json().data;
    expect(second).toMatchObject({ onAir: "Guest", next: null, skipped: ["sponsor"] });
    expect(scene()).toMatchObject({ layout: "split", layers: [{ kind: "lower-third", title: "Tolu", subtitle: "Guest" }] });
    expect(db.Stream!.rows[0]!.rundown.segmentId).toBe("seg002");

    expect((await press("/control/show", secret, { step: "next" })).json().code).toBe("LAST_SEGMENT");
    expect((await press("/control/show", secret, { step: "stop" })).json().data.onAir).toBeNull();
  });

  it("fires a rule by hand, with sample words", async () => {
    const rule = db.ShowRule!.insert({ ownerId: HOST, name: "Big gift", on: true, when: { kind: "gift", minMinor: 2000 }, then: [{ do: "banner", text: "Thanks {user}!", seconds: null }], cooldownSec: 10 });
    const { secret } = await makeKey();
    expect((await press(`/control/rules/${rule._id}/fire`, secret)).statusCode).toBe(200);
    expect(scene().layers).toEqual([{ kind: "banner", text: "Thanks a viewer!" }]);
  });

  it("says what's on, and asks to go live first when it isn't", async () => {
    const { secret } = await makeKey();
    const state = (await app.inject({ method: "GET", url: "/v1/control/state", headers: { authorization: `Bearer ${secret}` } })).json().data;
    expect(state).toMatchObject({ live: true, show: { segments: 2, onAir: null, next: "Cold open" }, scene: { layout: "auto", card: null } });
    db.Stream!.rows[0]!.isLive = false;
    expect((await press("/control/do", secret, { actions: [{ do: "card", card: "brb" }] })).json().code).toBe("NOT_LIVE");
  });

  it("tells a key only what its scopes cover", async () => {
    const { secret } = await makeKey(["sound"]);
    const state = (await app.inject({ method: "GET", url: "/v1/control/state", headers: { authorization: `Bearer ${secret}` } })).json().data;
    expect(state).toMatchObject({ live: true, stream: { title: expect.any(String) } });
    expect(state).not.toHaveProperty("scene");
    expect(state).not.toHaveProperty("show");
    expect(state).not.toHaveProperty("rules");
    const listening = (await makeKey(["events"])).secret;
    const heard = (await app.inject({ method: "GET", url: "/v1/control/state", headers: { authorization: `Bearer ${listening}` } })).json().data;
    expect(heard).toHaveProperty("scene");
    expect(heard).toHaveProperty("show");
    expect(heard).toHaveProperty("rules");
  });

  it("stops working the moment the key is removed", async () => {
    const { key, secret } = await makeKey();
    await app.inject({ method: "DELETE", url: `/v1/users/me/control-keys/${key.id}` });
    expect((await press("/control/do", secret, { actions: [{ do: "card", card: "brb" }] })).json().code).toBe("CONTROL_KEY_INVALID");
  });
});
