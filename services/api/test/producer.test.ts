import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Producer mode: a producer runs the show from their own device — scenes,
 * the run of show and the console's hidden room token — where a moderator
 * can't; and a console is crew, never counted or seen as a viewer.
 */

const state = vi.hoisted(() => ({
  caller: "",
  tokens: [] as Array<{ identity: string; options: Record<string, unknown> }>,
  sent: [] as Array<{ to: string[]; data: Record<string, unknown> }>,
}));
const HOST = new mongoose.Types.ObjectId();
const PRODUCER = new mongoose.Types.ObjectId();
const MOD = new mongoose.Types.ObjectId();
const who = () => (state.caller === "host" ? HOST : state.caller === "producer" ? PRODUCER : MOD);

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
    Rundown: new FakeModel("Rundown"),
    Sponsor: new FakeModel("Sponsor"),
    Campaign: new FakeModel("Campaign"),
    CampaignMember: new FakeModel("CampaignMember"),
    AuditLog: new FakeModel("AuditLog"),
  };
});
vi.mock("../src/auth.js", () => ({
  // The whole account when there is one (the host's carries their crew), as the real one does.
  authenticate: async () => {
    const { User } = (await import("../src/models.js")) as unknown as { User: { rows: Array<Record<string, unknown>> } };
    const row = User.rows.find((r) => String(r._id) === String(who()));
    return { dbUser: row ?? { _id: who(), username: state.caller, displayName: state.caller } };
  },
  getOptionalAuthUserId: () => null,
}));
vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [] },
  ingressClient: {},
  webhookReceiver: { receive: async () => ({ event: "ignored" }) },
  createToken: async (_room: string, identity: string, _name: string, options: Record<string, unknown>) => {
    state.tokens.push({ identity, options });
    return "token";
  },
  ensureUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  rotateUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async () => false,
  setParticipantPublishPermission: async () => {},
  setRoomScene: async () => {},
  sendRoomData: async () => {},
  sendRoomDataTo: async (_room: string, to: string[], data: Record<string, unknown>) => {
    state.sent.push({ to, data });
  },
  closeRoom: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { moderatorIdentities } = await import("../src/safety/roles.js");

describe("producer mode", () => {
  let app: FastifyInstance;
  let streamId = "";

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const m of Object.values(db)) m.reset();
    state.tokens = [];
    state.sent = [];
    db.User!.insert({
      _id: HOST,
      username: "amara",
      displayName: "Amara",
      avatar: "",
      brand: { accent: "mint", lowerThird: "pill", font: "wide", logo: "", logoVersion: 0 },
      safety: {
        mods: [
          { userId: PRODUCER, username: "tolu", role: "producer" },
          { userId: MOD, username: "ada", role: "mod" },
        ],
      },
    });
    const s = db.Stream!.insert({
      streamerId: HOST,
      title: "Friday night desk",
      category: "Bitcoin Trading",
      isLive: true,
      livekitRoomName: "room-1",
      startedAt: new Date(),
      guests: [],
      scene: { layout: "auto", card: null, cardNote: "", chart: null, layers: [], gains: {}, spotlight: null, featured: null, version: 1 },
      rundown: null,
    });
    streamId = String(s._id);
  });
  const call = (method: "GET" | "PUT" | "DELETE", url: string, payload?: unknown) => app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });

  it("lets a producer set the scene, and not a moderator", async () => {
    state.caller = "producer";
    const res = await call("PUT", `/streams/${streamId}/scene`, { layout: "solo" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.scene).toMatchObject({ layout: "solo", version: 2 });
    state.caller = "mod";
    expect((await call("PUT", `/streams/${streamId}/scene`, { layout: "grid" })).statusCode).toBe(403);
  });

  it("lets a producer read and run the host's run of show", async () => {
    db.Rundown!.insert({ ownerId: HOST, segments: [{ id: "seg001", title: "Cold open", seconds: 180, script: "", cues: [] }] });
    state.caller = "producer";
    const read = (await call("GET", `/streams/${streamId}/rundown`)).json().data;
    expect(read.segments.map((s: { title: string }) => s.title)).toEqual(["Cold open"]);
    const moved = await call("PUT", `/streams/${streamId}/rundown`, { segmentId: "seg001" });
    expect(moved.json().data.position.segmentId).toBe("seg001");
    state.caller = "mod";
    expect((await call("GET", `/streams/${streamId}/rundown`)).statusCode).toBe(403);
  });

  it("moves the host's studio and every console on together when anyone goes to the next segment", async () => {
    db.Rundown!.insert({ ownerId: HOST, segments: [{ id: "seg001", title: "Cold open", seconds: 180, script: "", cues: [] }] });
    state.caller = "producer";
    await call("PUT", `/streams/${streamId}/rundown`, { segmentId: "seg001" });
    const moved = state.sent.find((x) => x.data.__evt === "rundown");
    expect(moved?.to).toEqual(expect.arrayContaining([String(HOST), `prod-${HOST}`, `prod-${PRODUCER}`]));
    expect(moved?.data.position).toMatchObject({ segmentId: "seg001" });
  });

  it("tells the consoles when the host edits the rundown mid-show", async () => {
    state.caller = "host";
    const res = await call("PUT", "/users/me/rundown", { segments: [{ id: "seg002", title: "Guest", seconds: 600, script: "", cues: [] }] });
    expect(res.statusCode).toBe(200);
    expect(state.sent).toEqual([{ to: [`prod-${HOST}`, `prod-${PRODUCER}`, `prod-${MOD}`], data: { __evt: "rundown_changed" } }]);
  });

  it("lets a producer turn down a line a moderator suggested", async () => {
    const line = new mongoose.Types.ObjectId();
    db.Stream!.rows[0]!.featureQueue = [{ messageId: line, username: "ada", content: "gm", at: new Date(), by: MOD }];
    state.caller = "producer";
    const res = await call("DELETE", `/streams/${streamId}/feature-queue/${line}`);
    expect(res.json()).toMatchObject({ success: true, data: { queue: [] } });
  });

  it("gives a producer's console a hidden, watch-only token under its own identity", async () => {
    db.Sponsor!.insert({ ownerId: HOST, name: "Ofada Express", line: "", url: "", code: "", category: "everyday", logo: "", logoVersion: 0 });
    state.caller = "producer";
    const res = await call("GET", "/users/amara/console");
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ role: "producer", host: { username: "amara", brand: { accent: "mint" } }, stream: { id: streamId, title: "Friday night desk" }, token: "token" });
    expect(data.sponsors.own.map((x: { name: string }) => x.name)).toEqual(["Ofada Express"]);
    expect(state.tokens).toEqual([
      { identity: `prod-${PRODUCER}`, options: { canPublish: false, canSubscribe: true, canPublishData: false, hidden: true } },
    ]);
  });

  it("lets the host use it as a second device, and turns everyone else away", async () => {
    state.caller = "host";
    expect((await call("GET", "/users/amara/console")).json().data.role).toBe("host");
    state.caller = "mod";
    const res = await call("GET", "/users/amara/console");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NOT_PRODUCER");
  });

  it("says when the channel isn't live, without a token — with the run of show to prepare from", async () => {
    db.Stream!.rows[0]!.isLive = false;
    db.Rundown!.insert({ ownerId: HOST, segments: [{ id: "seg001", title: "Cold open", seconds: 180, script: "Hi", cues: [] }] });
    state.caller = "producer";
    const data = (await call("GET", "/users/amara/console")).json().data;
    expect(data).toMatchObject({ role: "producer", stream: null, token: null });
    expect(data.segments.map((s: { title: string }) => s.title)).toEqual(["Cold open"]);
  });

  it("sends held lines and mod events to consoles too", () => {
    const ids = moderatorIdentities({ _id: HOST, safety: { mods: [{ userId: PRODUCER }] } } as never);
    expect(ids).toEqual([String(HOST), `mon-${HOST}`, `prod-${HOST}`, String(PRODUCER), `prod-${PRODUCER}`]);
  });
});
