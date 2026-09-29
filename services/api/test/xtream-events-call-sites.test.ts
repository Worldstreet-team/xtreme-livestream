import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The realtime pushes fire where things happen: going live, ending,
 * renaming on air, a battle starting and ending, a notification row being
 * written, the phone cam joining — through the real routes and modules,
 * with only the database, LiveKit and the gateway's fetch faked.
 */

const state = vi.hoisted(() => ({
  event: { event: "ignored" } as Record<string, unknown>,
}));
const HOST = new mongoose.Types.ObjectId();
const FAN = new mongoose.Types.ObjectId();
const RIVAL = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  class StreamModel extends FakeModel {
    insert(fields: Record<string, unknown>) {
      const row = super.insert(fields);
      Object.defineProperty(row, "populate", { value: async () => row, enumerable: false });
      Object.defineProperty(row, "toJSON", { value: () => ({ ...row }), enumerable: false });
      return row;
    }
    find(filter?: Record<string, unknown>) {
      const q = super.find(filter);
      return Object.assign(q, { skip: () => q });
    }
  }
  // Mongoose reads `{ isLive: false }` as a $set; the fake needs it spelled out.
  class Users extends FakeModel {
    async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, opts?: Record<string, unknown>) {
      const ops = Object.keys(update).every((k) => k.startsWith("$")) ? update : { $set: update };
      return super.updateOne(filter, ops, opts);
    }
  }
  class Aggregating extends FakeModel {
    async aggregate() {
      return [];
    }
  }
  const names = [
    "Follow", "Notification", "StreamReminder", "ChatMessage", "StreamLike", "Report", "WatchSession",
    "Impression", "ViewerSample", "BattleQueue", "PointsLedger", "QuestClaim", "Game", "GameEntry", "Payout",
    "RequestOrder", "AuditLog", "Appeal", "Sponsor", "Campaign", "CampaignMember", "SponsorRun", "Voucher", "Rundown",
    "ShowRule", "ControlKey", "Call", "StreamRating", "StreamBan", "Battle",
  ];
  return {
    Stream: new StreamModel("Stream"),
    User: new Users("User"),
    GiftTransaction: new Aggregating("GiftTransaction"),
    ...Object.fromEntries(names.map((n) => [n, new FakeModel(n)])),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => {
    const { User } = (await import("../src/models.js")) as unknown as { User: { rows: Array<Record<string, unknown>> } };
    return { authUserId: "user_host", dbUser: User.rows.find((r) => String(r._id) === String(HOST)) };
  },
  getOptionalAuthUserId: () => "user_host",
}));
vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [] },
  ingressClient: {},
  webhookReceiver: { receive: async () => state.event },
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
vi.mock("../src/rewards.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rewards.js")>()),
  audit: async () => {},
  payBattleBonus: async () => {},
}));
vi.mock("../src/rules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rules.js")>()),
  fireRules: async () => {},
}));

const db = (await import("../src/models.js")) as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { config } = await import("../src/config.js");
const { drainXtreamEvents, resetXtreamEvents } = await import("../src/xtream-events.js");
const { startBattle, settleBattle } = await import("../src/battles.js");

const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
vi.stubGlobal("fetch", fetchMock);

type Pushed = { to: string; name: string; data?: Record<string, unknown> };
function pushed(): Pushed[] {
  return (fetchMock.mock.calls as unknown as Array<[string, { body: string }]>)
    .filter(([url]) => url.endsWith("/internal/xtream/events"))
    .flatMap(([, init]) => JSON.parse(init.body).events as Pushed[]);
}
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  await drainXtreamEvents();
}

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  config.SOCIALS_GATEWAY_URL = "https://gateway.test";
  config.SOCIALS_WEBHOOK_SECRET = "test-secret";
});
afterAll(async () => {
  config.SOCIALS_GATEWAY_URL = "";
  config.SOCIALS_WEBHOOK_SECRET = "";
  await app.close();
});

beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  resetXtreamEvents();
  fetchMock.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  db.User!.insert({ _id: HOST, username: "adaeze", displayName: "Adaeze", authUserId: "user_host", isLive: false, followers: 1, settings: {}, safety: { mods: [] } });
  db.User!.insert({ _id: FAN, username: "kelechi", displayName: "Kelechi", authUserId: "user_fan", settings: {} });
  db.User!.insert({ _id: RIVAL, username: "obinna", displayName: "Obinna", authUserId: "user_rival", settings: {} });
  db.Follow!.insert({ followerId: FAN, followingId: HOST });
});

const call = (method: "POST" | "PATCH", url: string, payload?: unknown) =>
  app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });

describe("stream call sites", () => {
  it("go live: the public stream.started, the host's live: started, and each follower's bell", async () => {
    const res = await call("POST", "/streams", { title: "Suya run", category: "IRL" });
    expect(res.statusCode).toBe(200);
    const id = String(res.json().data.stream.id);
    await settle();
    const notif = db.Notification!.rows.find((r) => String(r.userId) === String(FAN))!;
    expect(pushed()).toEqual(
      expect.arrayContaining([
        { to: "all", name: "stream.started", data: { streamId: id, username: "adaeze", title: "Suya run", category: "IRL" } },
        { to: "user_host", name: "live", data: { state: "started", streamId: id } },
        { to: "user_fan", name: "notification", data: { kind: "live", id: String(notif._id) } },
      ]),
    );
  });

  it("a practice run says nothing at all", async () => {
    const res = await call("POST", "/streams", { title: "Rehearsal", category: "IRL", practice: true });
    expect(res.statusCode).toBe(200);
    const id = String(res.json().data.stream.id);
    await call("PATCH", `/streams/${id}`, { title: "Still rehearsing" });
    await call("POST", `/streams/${id}/end`);
    await settle();
    expect(pushed()).toEqual([]);
  });

  it("renamed on air: stream.updated, alongside the room's details event", async () => {
    const res = await call("POST", "/streams", { title: "Suya run", category: "IRL" });
    const id = String(res.json().data.stream.id);
    await settle();
    fetchMock.mockClear();
    await call("PATCH", `/streams/${id}`, { title: "Suya run, part two", category: "Cooking" });
    await settle();
    expect(pushed()).toEqual([{ to: "all", name: "stream.updated", data: { streamId: id, title: "Suya run, part two", category: "Cooking" } }]);
    // A thumbnail refresh changes neither: nothing sent.
    fetchMock.mockClear();
    await call("PATCH", `/streams/${id}`, { thumbnail: "" });
    await settle();
    expect(pushed()).toEqual([]);
  });

  it("end: the public stream.ended and the host's live: ended", async () => {
    const res = await call("POST", "/streams", { title: "Suya run", category: "IRL" });
    const id = String(res.json().data.stream.id);
    await settle();
    fetchMock.mockClear();
    const end = await call("POST", `/streams/${id}/end`);
    expect(end.statusCode).toBe(200);
    await settle();
    expect(pushed()).toEqual([
      { to: "all", name: "stream.ended", data: { streamId: id } },
      { to: "user_host", name: "live", data: { state: "ended", streamId: id } },
    ]);
  });

  it("the phone cam joining and leaving reaches the host's own devices", async () => {
    const res = await call("POST", "/streams", { title: "Suya run", category: "IRL" });
    const id = String(res.json().data.stream.id);
    const room = db.Stream!.rows.find((r) => String(r._id) === id)!.livekitRoomName as string;
    await settle();
    fetchMock.mockClear();
    const deliver = (event: string) => {
      state.event = { event, room: { name: room }, participant: { identity: `cam-${HOST}` } };
      return app.inject({
        method: "POST",
        url: "/v1/webhooks/livekit",
        headers: { "content-type": "application/webhook+json", authorization: "signed" },
        payload: JSON.stringify(state.event),
      });
    };
    expect((await deliver("participant_joined")).statusCode).toBe(200);
    await settle();
    expect((await deliver("participant_left")).statusCode).toBe(200);
    await settle();
    expect(pushed()).toEqual([
      { to: "user_host", name: "live", data: { state: "camera", streamId: id, secondCameraConnected: true } },
      { to: "user_host", name: "live", data: { state: "camera", streamId: id, secondCameraConnected: false } },
    ]);
  });
});

describe("battle call sites", () => {
  function liveBattle(practice = false) {
    const hs = db.Stream!.insert({ streamerId: HOST, title: "Host", livekitRoomName: "r-h", isLive: true });
    const cs = db.Stream!.insert({ streamerId: RIVAL, title: "Rival", livekitRoomName: "r-c", isLive: true });
    return db.Battle!.insert({
      hostId: HOST,
      challengerId: RIVAL,
      hostStreamId: hs._id,
      challengerStreamId: cs._id,
      status: "invited",
      mode: "1v1",
      durationSec: 300,
      multiplierWindowSec: 30,
      multiplier: 2,
      hostUsdMinor: 0,
      challengerUsdMinor: 0,
      commissionUsdMinor: 0,
      bonusUsdMinor: 0,
      overtimeUsed: false,
      startsAt: null,
      endsAt: null,
      winnerId: null,
      giftFilter: [],
      practice,
    }) as never as import("../src/models.js").IBattle;
  }

  it("start and end go out on the public channel, and the result bells go to both sides — no money in any of it", async () => {
    const battle = liveBattle();
    await startBattle(battle);
    await settle();
    const streamIds = [String(battle.hostStreamId), String(battle.challengerStreamId)];
    // Public: the battle started. Personal: each host's panel hears it was accepted (ids only).
    expect(pushed()).toEqual([
      { to: "all", name: "battle.started", data: { battleId: String(battle._id), streamIds } },
      { to: "user_host", name: "battle", data: { battleId: String(battle._id), change: "accepted" } },
      { to: "user_rival", name: "battle", data: { battleId: String(battle._id), change: "accepted" } },
    ]);

    fetchMock.mockClear();
    battle.hostUsdMinor = 5_000;
    battle.challengerUsdMinor = 1_200;
    battle.commissionUsdMinor = 1_000;
    await settleBattle(battle, "clock");
    await settle();
    const bells = db.Notification!.rows.filter((r) => r.type === "battle_result");
    expect(bells).toHaveLength(2);
    expect(pushed()).toEqual([
      { to: "all", name: "battle.ended", data: { battleId: String(battle._id), streamIds } },
      ...bells.map((b) => ({
        to: String(b.userId) === String(HOST) ? "user_host" : "user_rival",
        name: "notification",
        data: { kind: "battle_result", id: String(b._id) },
      })),
    ]);
    const bodies = (fetchMock.mock.calls as unknown as Array<[string, { body: string }]>)
      .filter(([url]) => url.endsWith("/internal/xtream/events"))
      .map(([, init]) => init.body)
      .join("");
    expect(bodies).not.toMatch(/usd|minor|bonus/i);
  });

  it("a withdrawn invite never started, so it never 'ends'", async () => {
    const battle = liveBattle();
    await settleBattle(battle, "cancelled");
    await settle();
    expect(pushed()).toEqual([]);
  });

  it("a practice battle says nothing", async () => {
    const battle = liveBattle(true);
    await startBattle(battle);
    await settleBattle(battle, "clock");
    await settle();
    expect(pushed()).toEqual([]);
  });
});
