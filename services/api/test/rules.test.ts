import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Show rules: the right rule fires for the right thing, once per cooldown
 * across however many events arrive; the scene changes the way a tap would
 * (and only if nobody changed it in between), words are filled in, what it
 * puts up for a while comes down after, and a sound goes to the host's
 * studio alone.
 */

const state = vi.hoisted(() => ({
  sent: [] as Array<{ to: string[] | "room"; data: Record<string, unknown> }>,
  metadata: [] as unknown[],
}));
const HOST = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    ShowRule: new FakeModel("ShowRule"),
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: HOST, username: "amara", displayName: "Amara" } }),
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
  setRoomScene: async (_room: string, scene: unknown) => {
    state.metadata.push(scene);
  },
  sendRoomData: async (_room: string, data: Record<string, unknown>) => {
    state.sent.push({ to: "room", data });
  },
  sendRoomDataTo: async (_room: string, to: string[], data: Record<string, unknown>) => {
    state.sent.push({ to, data });
  },
  closeRoom: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { fill, fireRules, forgetRules, matchesRule, planActions } = await import("../src/rules.js");
const { sceneView } = await import("../src/featured.js");

const NOW = Date.parse("2026-09-26T20:00:00Z");
let streamId = "";
const stream = () => db.Stream!.rows[0]!;
const rule = (fields: Record<string, unknown>) =>
  db.ShowRule!.insert({ ownerId: HOST, name: "", on: true, cooldownSec: 10, fires: 0, firedAt: null, ...fields });

beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  state.sent = [];
  state.metadata = [];
  forgetRules(HOST);
  const s = db.Stream!.insert({
    streamerId: HOST,
    isLive: true,
    livekitRoomName: "room-1",
    scene: { layout: "auto", card: null, cardNote: "", chart: null, layers: [], gains: {}, spotlight: null, featured: null, version: 4 },
  });
  streamId = String(s._id);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("matching and words", () => {
  it("fires a gift rule for gifts at or over its amount only", () => {
    const when = { kind: "gift" as const, minMinor: 5000 };
    expect(matchesRule(when, { kind: "gift", minor: 4999, user: "ada", gift: "Rose" })).toBe(false);
    expect(matchesRule(when, { kind: "gift", minor: 5000, user: "ada", gift: "Rose" })).toBe(true);
    expect(matchesRule(when, { kind: "ally", user: "ada" })).toBe(false);
  });

  it("matches a chat word as the line's first word, in any case", () => {
    const when = { kind: "chat_word" as const, word: "!discord" };
    expect(matchesRule(when, { kind: "chat_word", text: "!Discord please", user: "ada" })).toBe(true);
    expect(matchesRule(when, { kind: "chat_word", text: "what's the !discord", user: "ada" })).toBe(false);
    expect(matchesRule(when, { kind: "chat_word", text: "discord", user: "ada" })).toBe(false);
  });

  it("fills in the words an event brings, and leaves the rest as written", () => {
    expect(fill("Thanks {user} for the {gift} ({amount})!", { user: "ada", gift: "Rose", amount: "$50" })).toBe("Thanks ada for the Rose ($50)!");
    expect(fill("Beat {opponent}", {})).toBe("Beat {opponent}");
  });

  it("plans one change for the lot, and what comes down when", () => {
    const scene = sceneView({ layout: "auto", layers: [{ kind: "banner", text: "old" }], version: 1 } as never);
    const plan = planActions(
      scene,
      [
        { do: "lower_third", title: "{user} is here", subtitle: "", seconds: 8 },
        { do: "layout", layout: "chart-face" },
        { do: "hide", graphic: "banner" },
        { do: "sound", pad: "airhorn" },
      ],
      { user: "ada" },
      NOW,
    );
    expect(plan.set).toMatchObject({
      "scene.layout": "chart-face",
      "scene.chart": { symbol: "BTC-USD", interval: "5m" },
      "scene.layers": [{ kind: "lower-third", title: "ada is here", subtitle: "" }],
    });
    expect(plan.sounds).toEqual(["airhorn"]);
    expect(plan.takeDowns).toEqual([{ kind: "layer", layer: { kind: "lower-third", title: "ada is here", subtitle: "" }, after: 8000 }]);
    // A sound alone changes nothing on screen.
    expect(planActions(scene, [{ do: "sound", pad: "kaching" }], {}, NOW).set).toBeNull();
  });
});

describe("firing", () => {
  it("changes the scene as a tap would, tells the room, and rests for its cooldown", async () => {
    rule({ when: { kind: "gift", minMinor: 2000 }, then: [{ do: "banner", text: "{user} sent {amount}!", seconds: null }], cooldownSec: 30 });
    const gift = { kind: "gift" as const, minor: 5000, user: "ada", gift: "Rose" };

    expect(await fireRules(stream(), gift, NOW)).toHaveLength(1);
    expect(stream().scene).toMatchObject({ version: 5, layers: [{ kind: "banner", text: "ada sent $50!" }] });
    expect(state.sent.find((x) => x.data.__evt === "scene")?.to).toBe("room");
    expect(state.metadata).toHaveLength(1);

    // Inside the cooldown: nothing, however many arrive.
    expect(await fireRules(stream(), gift, NOW + 10_000)).toEqual([]);
    expect(stream().scene.version).toBe(5);
    // After it: again.
    expect(await fireRules(stream(), { ...gift, user: "tolu" }, NOW + 31_000)).toHaveLength(1);
    expect(stream().scene.layers).toEqual([{ kind: "banner", text: "tolu sent $50!" }]);
    expect(db.ShowRule!.rows[0]).toMatchObject({ fires: 2 });
  });

  it("leaves rules that are off, or for something else, alone", async () => {
    rule({ on: false, when: { kind: "ally" }, then: [{ do: "card", card: "brb", seconds: null }] });
    rule({ when: { kind: "guest_join" }, then: [{ do: "card", card: "brb", seconds: null }] });
    expect(await fireRules(stream(), { kind: "ally", user: "ada" }, NOW)).toEqual([]);
    expect(stream().scene.card).toBeNull();
  });

  it("sends a sound to the host's studio alone", async () => {
    rule({ when: { kind: "ally" }, then: [{ do: "sound", pad: "applause" }] });
    await fireRules(stream(), { kind: "ally", user: "ada" }, NOW);
    expect(state.sent).toEqual([{ to: [String(HOST)], data: { __evt: "rule_fire", sounds: ["applause"] } }]);
    expect(stream().scene.version).toBe(4);
  });

  it("takes down what it put up for a while — unless it's been replaced", async () => {
    vi.useFakeTimers({ now: NOW });
    rule({ when: { kind: "ally" }, then: [{ do: "lower_third", title: "Welcome {user}", subtitle: "", seconds: 5 }], cooldownSec: 0 });
    await fireRules(stream(), { kind: "ally", user: "ada" }, NOW);
    expect(stream().scene.layers).toEqual([{ kind: "lower-third", title: "Welcome ada", subtitle: "" }]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stream().scene.layers).toEqual([]);

    await fireRules(stream(), { kind: "ally", user: "tolu" }, NOW + 6_000);
    // The host puts their own lower third up in between: theirs stays.
    stream().scene.layers = [{ kind: "lower-third", title: "Amara", subtitle: "Host" }];
    await vi.advanceTimersByTimeAsync(5_000);
    expect(stream().scene.layers).toEqual([{ kind: "lower-third", title: "Amara", subtitle: "Host" }]);
  });

  it("does nothing on a stream that isn't live", async () => {
    stream().isLive = false;
    rule({ when: { kind: "ally" }, then: [{ do: "card", card: "brb", seconds: null }] });
    await fireRules(stream(), { kind: "ally", user: "ada" }, NOW);
    expect(stream().scene.card).toBeNull();
  });
});

describe("the rules routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });

  it("adds, changes and removes a rule", async () => {
    const created = await call("POST", "/users/me/rules", { when: { kind: "ally" }, then: [{ do: "banner", text: "Welcome {user}" }] });
    expect(created.statusCode).toBe(200);
    const id = created.json().data.rule.id;
    expect(created.json().data.rule).toMatchObject({ on: true, cooldownSec: 10, then: [{ do: "banner", text: "Welcome {user}", seconds: 15 }] });

    const changed = await call("PUT", `/users/me/rules/${id}`, { on: false, when: { kind: "ally" }, then: [{ do: "sound", pad: "levelup" }] });
    expect(changed.json().data.rule).toMatchObject({ on: false, then: [{ do: "sound", pad: "levelup" }] });

    expect((await call("GET", "/users/me/rules")).json().data.rules).toHaveLength(1);
    await call("DELETE", `/users/me/rules/${id}`);
    expect((await call("GET", "/users/me/rules")).json().data.rules).toHaveLength(0);
  });

  it("won't let a chat word fire more often than every 30 seconds", async () => {
    const res = await call("POST", "/users/me/rules", { when: { kind: "chat_word", word: "!discord" }, then: [{ do: "banner", text: "discord.gg/x" }], cooldownSec: 10 });
    expect(res.statusCode).toBe(400);
  });

  it("stops at twenty rules", async () => {
    for (let i = 0; i < 20; i++) rule({ when: { kind: "ally" }, then: [{ do: "sound", pad: "airhorn" }] });
    const res = await call("POST", "/users/me/rules", { when: { kind: "ally" }, then: [{ do: "sound", pad: "airhorn" }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("TOO_MANY_RULES");
  });

  it("tries a rule on the live stream with sample words, and asks to go live first otherwise", async () => {
    const r = rule({ when: { kind: "gift", minMinor: 100 }, then: [{ do: "lower_third", title: "{user} sent a {gift}", subtitle: "", seconds: null }] });
    expect((await call("POST", `/users/me/rules/${r._id}/try`)).statusCode).toBe(200);
    expect(stream().scene.layers).toEqual([{ kind: "lower-third", title: "a viewer sent a Rose", subtitle: "" }]);
    stream().isLive = false;
    const res = await call("POST", `/users/me/rules/${r._id}/try`);
    expect(res.statusCode).toBe(409);
    expect(streamId).toBeTruthy();
  });
});
