import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Practice battles: a host in a practice run tries a 90-second round
 * against a stand-in sparring partner, on the real battle machinery. Only
 * a practice run can start one; the host alone sends its test gifts; the
 * sparring partner's simulated gifts swing the lead, double in the closing
 * window and set off the late reset; and settling one pays nothing, tells
 * nobody and writes no money — while no list, rail or quick match ever
 * shows it.
 */

const state = vi.hoisted(() => ({
  caller: "" as "" | "host" | "rival" | "stranger",
  sent: [] as Array<Record<string, unknown>>,
  relayed: 0,
}));
const HOST = new mongoose.Types.ObjectId();
const RIVAL = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const ids = { host: HOST, rival: RIVAL, stranger: STRANGER } as const;

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  class StreamModel extends FakeModel {
    insert(fields: Record<string, unknown>) {
      const row = super.insert(fields);
      Object.defineProperty(row, "populate", { value: async () => row, enumerable: false });
      return row;
    }
    find(filter?: Record<string, unknown>) {
      const q = super.find(filter);
      return Object.assign(q, { skip: () => q });
    }
  }
  // The schema's defaults, which the in-memory stand-in doesn't apply itself.
  class BattleModel extends FakeModel {
    insert(fields: Record<string, unknown>) {
      return super.insert({
        durationSec: 300,
        multiplierWindowSec: 30,
        multiplier: 2,
        scheduledAt: null,
        hostUsdMinor: 0,
        challengerUsdMinor: 0,
        commissionUsdMinor: 0,
        winnerId: null,
        bonusUsdMinor: 0,
        overtimeUsed: false,
        lateResetUsed: false,
        forfeit: "",
        mode: "1v1",
        hostPartnerId: null,
        challengerPartnerId: null,
        giftFilter: [],
        endedReason: null,
        practice: false,
        practiceGifts: [],
        practiceNextAt: null,
        ...fields,
      });
    }
  }
  // A real battle's top backers are an aggregate over its gifts; none here.
  class GiftModel extends FakeModel {
    async aggregate() {
      return [];
    }
  }
  const others = [
    "User", "ChatMessage", "Follow", "StreamLike", "Notification", "StreamBan", "Report", "WatchSession",
    "Impression", "ViewerSample", "StreamReminder", "BattleQueue", "PointsLedger", "QuestClaim", "Game", "GameEntry", "Payout",
    "RequestOrder", "AuditLog", "Appeal", "Sponsor", "Campaign", "CampaignMember", "SponsorRun", "Voucher", "Rundown", "ShowRule",
    "ControlKey", "Call", "StreamRating",
  ];
  return {
    Stream: new StreamModel("Stream"),
    Battle: new BattleModel("Battle"),
    GiftTransaction: new GiftModel("GiftTransaction"),
    ...Object.fromEntries(others.map((n) => [n, new FakeModel(n)])),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => {
    const { ApiError } = await import("../src/errors.js");
    if (!state.caller) throw new ApiError(401, "Authentication required", "UNAUTHORIZED");
    const { User } = (await import("../src/models.js")) as unknown as { User: { rows: Array<Record<string, unknown>> } };
    const row = User.rows.find((r) => String(r._id) === String(ids[state.caller as keyof typeof ids]));
    return { authUserId: `clerk_${state.caller}`, dbUser: row };
  },
  getOptionalAuthUserId: () => (state.caller ? `clerk_${state.caller}` : null),
}));
vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [], removeParticipant: async () => {} },
  ingressClient: {},
  webhookReceiver: { receive: async (body: string) => JSON.parse(body) },
  createToken: async () => "token",
  ensureUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  rotateUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async () => false,
  setParticipantPublishPermission: async () => {},
  setRoomScene: async () => {},
  sendRoomData: async (_room: string, data: Record<string, unknown>) => {
    state.sent.push(data);
  },
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));
vi.mock("../src/notifications.js", () => ({
  notifyFollowersOfLive: async () => {},
  notifyRemindersOfLive: async () => {},
}));
vi.mock("../src/socials-relay.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/socials-relay.js")>()),
  socialsRelayEnabled: () => true,
  relayLiveEvent: async () => true,
  relayBattleResult: async () => {
    state.relayed += 1;
    return true;
  },
}));
vi.mock("../src/rules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rules.js")>()),
  fireRules: async () => [],
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const battles = await import("../src/battles.js");
const { practiceMove, isSurgeDue, PRACTICE_SURGE_MS, SPARRING_NAME } = await import("../src/practice-battle.js");
const { hashPreviewKey } = await import("../src/preview.js");

const PREVIEW_KEY = "k".repeat(32);

function seedPeople() {
  const person = (_id: mongoose.Types.ObjectId, username: string, displayName: string) =>
    db.User!.insert({ _id, username, displayName, avatar: "", isLive: false, followers: 0, following: 0, settings: {}, earningsUsdMinor: 0, safety: { mods: [] } });
  person(HOST, "amara", "Amara");
  person(RIVAL, "chidi", "Chidi");
  person(STRANGER, "kemi", "Kemi");
}

function seedStream(streamerId: mongoose.Types.ObjectId, fields: Record<string, unknown> = {}) {
  return db.Stream!.insert({
    streamerId,
    title: "Tonight",
    category: "Just Chatting",
    isLive: true,
    status: "live",
    practice: false,
    livekitRoomName: `room-${streamerId}`,
    startedAt: new Date(),
    viewers: 0,
    guests: [],
    takenDownAt: null,
    previewKeyHash: null,
    previewSharedAt: null,
    ...fields,
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  for (const m of Object.values(db)) m.reset?.();
  state.caller = "";
  state.sent = [];
  state.relayed = 0;
  seedPeople();
});

// Each call from its own address: the routes' rate limits aren't what's under test here.
let caller = 0;
const address = () => `10.1.${(caller >> 8) & 255}.${caller++ & 255}`;
const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url: `/v1${url}`, remoteAddress: address(), ...(payload ? { payload } : {}) });

/** A practice run for the host, and a practice battle started on it. */
async function startPractice() {
  const stream = seedStream(HOST, { practice: true, livekitRoomName: `practice-${HOST}` });
  state.caller = "host";
  const res = await call("POST", "/battles/practice");
  expect(res.statusCode).toBe(200);
  const view = res.json().data.battle;
  const doc = db.Battle!.rows.find((r) => String(r._id) === view.id)!;
  return { stream, view, doc };
}

/** A seeded pseudo-random stream, so a simulated round plays the same every run. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("starting a practice battle", () => {
  it("is refused outside a practice run: not live, or live for real", async () => {
    state.caller = "host";
    const offline = await call("POST", "/battles/practice");
    expect(offline.statusCode).toBe(409);
    expect(offline.json().code).toBe("NOT_PRACTICE");

    seedStream(HOST);
    const real = await call("POST", "/battles/practice");
    expect(real.statusCode).toBe(409);
    expect(real.json().code).toBe("NOT_PRACTICE");
    expect(db.Battle!.rows).toHaveLength(0);
  });

  it("starts 90 seconds against the sparring partner — nobody real — and only one at a time", async () => {
    const before = Date.now();
    const { view, doc } = await startPractice();
    expect(view.practice).toBe(true);
    expect(view.status).toBe("live");
    expect(view.durationSec).toBe(90);
    expect(view.multiplier).toBe(2);
    expect(view.multiplierWindowSec).toBe(30);
    const left = (Date.parse(view.endsAt) - before) / 1000;
    expect(left).toBeGreaterThan(88);
    expect(left).toBeLessThan(92);
    expect(view.host.displayName).toBe("Amara");
    expect(view.challenger.displayName).toBe(SPARRING_NAME);
    expect(view.challenger.username).toBe("");
    // The stand-in is no user and no stream.
    expect(db.User!.rows.some((u) => String(u._id) === String(doc.challengerId))).toBe(false);
    expect(db.Stream!.rows.some((s) => String(s._id) === String(doc.challengerStreamId))).toBe(false);
    // The practice room hears it the way a real battle's rooms do — and nobody is notified.
    expect(state.sent.some((e) => e.__evt === "battle")).toBe(true);
    expect(db.Notification!.rows).toHaveLength(0);

    const again = await call("POST", "/battles/practice");
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("BATTLE_BUSY");
  });
});

describe("test gifts", () => {
  it("are the host's alone, on practice battles alone", async () => {
    const { view } = await startPractice();

    state.caller = "stranger";
    const stranger = await call("POST", `/battles/${view.id}/practice-gift`, { giftId: "crown" });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.json().code).toBe("NOT_HOST");

    state.caller = "";
    expect((await call("POST", `/battles/${view.id}/practice-gift`, { giftId: "crown" })).statusCode).toBe(401);

    state.caller = "host";
    expect((await call("POST", `/battles/${view.id}/practice-gift`, { giftId: "not-a-gift" })).statusCode).toBe(400);
    const ok = await call("POST", `/battles/${view.id}/practice-gift`, { giftId: "party" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.battle.host.usdMinor).toBe(1_000);
    expect(ok.json().data.battle.challenger.usdMinor).toBe(0);

    // A real battle takes no test gifts, even from its own host.
    const rivalStream = seedStream(RIVAL);
    const hostReal = seedStream(HOST, { livekitRoomName: "room-real" });
    const real = db.Battle!.insert({
      hostId: HOST,
      challengerId: RIVAL,
      hostStreamId: hostReal._id,
      challengerStreamId: rivalStream._id,
      status: "live",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 60_000),
    });
    const refused = await call("POST", `/battles/${real._id}/practice-gift`, { giftId: "crown" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe("NOT_PRACTICE");
    expect(real.hostUsdMinor).toBe(0);
  });

  it("move no money: no gift ledger row, no charge, no earnings", async () => {
    const { view } = await startPractice();
    for (const giftId of ["fire", "party", "crown"]) {
      expect((await call("POST", `/battles/${view.id}/practice-gift`, { giftId })).statusCode).toBe(200);
    }
    expect(db.GiftTransaction!.rows).toHaveLength(0);
    expect(db.PointsLedger!.rows).toHaveLength(0);
    expect(db.User!.rows.find((u) => String(u._id) === String(HOST))!.earningsUsdMinor).toBe(0);
  });

  it("count double in the closing window and reset the clock once, like real gifts", async () => {
    const { doc } = await startPractice();
    doc.endsAt = new Date(Date.now() + 20_000);
    const hot = await battles.recordPracticeGift(doc as never, "host", { name: "Party", emoji: "🎉", usdMinor: 1_000 }, "Amara · test");
    expect(hot!.hostUsdMinor).toBe(2_000);
    expect(hot!.lateResetUsed).toBe(false);

    doc.endsAt = new Date(Date.now() + 5_000);
    const late = await battles.recordPracticeGift(doc as never, "challenger", { name: "Crown", emoji: "👑", usdMinor: 10_000 }, "bayo");
    expect(late!.challengerUsdMinor).toBe(20_000);
    expect(late!.lateResetUsed).toBe(true);
    const left = (late!.endsAt!.getTime() - Date.now()) / 1000;
    expect(left).toBeGreaterThan(14);
    expect(left).toBeLessThan(16);

    // Once a battle: the next late gift scores but the clock stands.
    doc.endsAt = new Date(Date.now() + 4_000);
    const again = await battles.recordPracticeGift(doc as never, "host", { name: "Fire", emoji: "🔥", usdMinor: 200 }, "Amara · test");
    expect((again!.endsAt!.getTime() - Date.now()) / 1000).toBeLessThan(5);
  });
});

describe("the sparring partner", () => {
  it("surges in the last seconds while the late reset is unused, and never skips past it", () => {
    const base = { hostUsdMinor: 5_000, challengerUsdMinor: 1_000, multiplier: 2, multiplierWindowSec: 30 };
    const now = 1_000_000;
    const surge = practiceMove({ ...base, now, endsAt: now + 6_000, lateResetUsed: false }, seeded(1));
    expect(surge.surge).toBe(true);
    expect(surge.side).toBe("challenger");
    // Enough to take the lead once doubled.
    expect(1_000 + surge.gift.usdMinor * 2).toBeGreaterThan(5_000);
    expect(isSurgeDue({ now, endsAt: now + 6_000, lateResetUsed: true })).toBe(false);

    // A move 12 s out would land after the surge point: it's pulled in to meet it.
    const before = practiceMove({ ...base, now, endsAt: now + PRACTICE_SURGE_MS + 1_500, lateResetUsed: false }, () => 0.99);
    expect(before.nextAt).toBe(now + 1_500);
  });

  it("plays a whole round: the lead changes hands, gifts count ×2 late, and the clock gets its +15 s", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      db.Battle!.reset();
      db.Stream!.reset();
      const { doc } = await startPractice();
      const t0 = doc.startsAt.getTime();
      const rand = seeded(seed);
      const leaders: string[] = [];
      let now = t0;
      while (now < doc.endsAt.getTime() && now < t0 + 200_000) {
        now += 1_000;
        await battles.playPracticeBattles(now, rand);
        const lead = doc.hostUsdMinor === doc.challengerUsdMinor ? null : doc.hostUsdMinor > doc.challengerUsdMinor ? "host" : "challenger";
        if (lead && leaders[leaders.length - 1] !== lead) leaders.push(lead);
      }
      expect(leaders.length, `seed ${seed}: the lead changed hands`).toBeGreaterThanOrEqual(2);
      expect(doc.lateResetUsed, `seed ${seed}: the late reset`).toBe(true);
      expect(doc.endsAt.getTime() - t0, `seed ${seed}: +15 s past the 90`).toBeGreaterThan(90_000);
      // A doubled gift: what it scored is twice a catalog price.
      const late = doc.practiceGifts.filter((g: { at: Date }) => doc.endsAt.getTime() - new Date(g.at).getTime() <= 30_000);
      expect(late.length, `seed ${seed}: gifts in the ×2 window`).toBeGreaterThan(0);
      expect(db.GiftTransaction!.rows).toHaveLength(0);
    }
  });
});

describe("settling a practice battle", () => {
  it("names a winner and pays nothing: no bonus, earnings, payout, audit, relay or notification", async () => {
    const { doc, view } = await startPractice();
    state.caller = "host";
    await call("POST", `/battles/${view.id}/practice-gift`, { giftId: "crown" });
    doc.commissionUsdMinor = 50_000; // Even with commission on the books, a practice battle pays nothing.
    doc.endsAt = new Date(Date.now() - 1);

    const settled = await battles.settleBattle(doc as never, "clock");
    expect(settled.status).toBe("ended");
    expect(String(settled.winnerId)).toBe(String(HOST));
    expect(settled.bonusUsdMinor).toBe(0);
    expect(db.User!.rows.every((u) => (u.earningsUsdMinor ?? 0) === 0)).toBe(true);
    expect(db.Payout!.rows).toHaveLength(0);
    expect(db.AuditLog!.rows).toHaveLength(0);
    expect(db.Notification!.rows).toHaveLength(0);
    expect(db.GiftTransaction!.rows).toHaveLength(0);
    expect(state.relayed).toBe(0);

    // The result still reaches the room, marked practice.
    const last = state.sent.filter((e) => e.__evt === "battle").pop() as { battle: { status: string; practice: boolean } };
    expect(last.battle.status).toBe("ended");
    expect(last.battle.practice).toBe(true);
  });

  it("can be ended early by its host", async () => {
    const { view } = await startPractice();
    state.caller = "host";
    const res = await call("POST", `/battles/${view.id}/cancel`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.battle.status).toBe("cancelled");
    expect(db.AuditLog!.rows).toHaveLength(0);
  });
});

describe("keeping it private", () => {
  it("never shows in the live or upcoming lists, while a real battle does", async () => {
    await startPractice();
    const rivalStream = seedStream(RIVAL);
    const strangerStream = seedStream(STRANGER);
    db.Battle!.insert({
      hostId: RIVAL,
      challengerId: STRANGER,
      hostStreamId: rivalStream._id,
      challengerStreamId: strangerStream._id,
      status: "live",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 60_000),
    });
    const live = (await call("GET", "/battles/live")).json().data.battles as Array<{ practice: boolean; host: { username: string } }>;
    expect(live).toHaveLength(1);
    expect(live[0]!.host.username).toBe("chidi");
    expect(live.some((b) => b.practice)).toBe(false);
    expect((await call("GET", "/battles/upcoming")).json().data.battles).toHaveLength(0);
  });

  it("is never reachable by quick match", async () => {
    await startPractice();
    state.caller = "host";
    const res = await call("POST", "/battles/quick", {});
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("NOT_LIVE");
    expect(db.BattleQueue!.rows).toHaveLength(0);
  });

  it("is seen by its host and the preview link, and by nobody else", async () => {
    const { stream, view } = await startPractice();
    stream.previewKeyHash = hashPreviewKey(PREVIEW_KEY);
    stream.previewSharedAt = new Date();

    state.caller = "stranger";
    expect((await call("GET", `/battles/${view.id}`)).statusCode).toBe(404);
    expect((await call("GET", `/battles/${view.id}/activity`)).statusCode).toBe(404);
    expect((await call("GET", `/streams/${stream._id}/battle`)).json().data.battle).toBeNull();

    state.caller = "";
    expect((await call("GET", `/battles/${view.id}?previewKey=${"x".repeat(32)}`)).statusCode).toBe(404);
    expect((await call("GET", `/battles/${view.id}?previewKey=${PREVIEW_KEY}`)).statusCode).toBe(200);
    expect((await call("GET", `/streams/${stream._id}/battle?previewKey=${PREVIEW_KEY}`)).json().data.battle.id).toBe(view.id);

    state.caller = "host";
    await call("POST", `/battles/${view.id}/practice-gift`, { giftId: "rocket" });
    const feed = (await call("GET", `/battles/${view.id}/activity`)).json().data;
    expect(feed.battle.practice).toBe(true);
    expect(feed.gifts).toHaveLength(1);
    expect(feed.gifts[0]).toMatchObject({ side: "host", usdMinor: 500, giftName: "Rocket", sender: { displayName: "Amara · test" } });
  });
});
