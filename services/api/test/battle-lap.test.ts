import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The battle stage's server side: each creator's win streak going in (and
 * the winner's +1 once it's settled), the three-minute victory lap after a
 * win (a draw's few seconds), ending the lap early, conceding — ending a
 * battle now, as a loss — and a rematch asked for during the lap.
 */

const state = vi.hoisted(() => ({
  caller: "" as "" | "host" | "rival" | "stranger" | "crew",
  sent: [] as Array<{ room: string; data: Record<string, unknown> }>,
  bonuses: [] as Array<Array<{ userId: unknown; usdMinor: number }>>,
}));
const HOST = new mongoose.Types.ObjectId();
const RIVAL = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const CREW = new mongoose.Types.ObjectId();
const ids = { host: HOST, rival: RIVAL, stranger: STRANGER, crew: CREW } as const;

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  class StreamModel extends FakeModel {
    insert(fields: Record<string, unknown>) {
      const row = super.insert(fields);
      Object.defineProperty(row, "populate", { value: async () => row, enumerable: false });
      return row;
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
        hostStreak: 0,
        challengerStreak: 0,
        lapEndsAt: null,
        practice: false,
        practiceGifts: [],
        practiceNextAt: null,
        ...fields,
      });
    }
  }
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
  sendRoomData: async (room: string, data: Record<string, unknown>) => {
    state.sent.push({ room, data });
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
  relayBattleResult: async () => true,
}));
vi.mock("../src/rewards.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rewards.js")>()),
  payBattleBonus: async (_b: unknown, shares: Array<{ userId: unknown; usdMinor: number }>) => {
    state.bonuses.push(shares);
    return [];
  },
}));
vi.mock("../src/rules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rules.js")>()),
  fireRules: async () => [],
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const battles = await import("../src/battles.js");

function seedPeople() {
  const person = (_id: mongoose.Types.ObjectId, username: string, displayName: string, mods: unknown[] = []) =>
    db.User!.insert({ _id, username, displayName, avatar: "", isLive: false, followers: 0, following: 0, settings: {}, earningsUsdMinor: 0, safety: { mods } });
  person(HOST, "amara", "Amara");
  // The rival's producer: CREW.
  person(RIVAL, "chidi", "Chidi", [{ userId: CREW, role: "producer" }]);
  person(STRANGER, "kemi", "Kemi");
  person(CREW, "bayo", "Bayo");
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
  state.bonuses = [];
  seedPeople();
});

let caller = 0;
const address = () => `10.2.${(caller >> 8) & 255}.${caller++ & 255}`;
const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
  app.inject({ method, url: `/v1${url}`, remoteAddress: address(), ...(payload ? { payload } : {}) });

const MIN = 60_000;

/** A settled real battle in the past, for a streak to count. */
function pastBattle(host: mongoose.Types.ObjectId, challenger: mongoose.Types.ObjectId, winner: mongoose.Types.ObjectId | null, minutesAgo: number, fields: Record<string, unknown> = {}) {
  return db.Battle!.insert({
    hostId: host,
    challengerId: challenger,
    hostStreamId: new mongoose.Types.ObjectId(),
    challengerStreamId: new mongoose.Types.ObjectId(),
    status: "ended",
    startsAt: new Date(Date.now() - (minutesAgo + 5) * MIN),
    endsAt: new Date(Date.now() - minutesAgo * MIN),
    winnerId: winner,
    ...fields,
  });
}

/** Both live, an invite from the host, accepted by the rival: a running battle. */
async function runningBattle(fields: Record<string, unknown> = {}) {
  const hs = seedStream(HOST);
  const cs = seedStream(RIVAL);
  const doc = db.Battle!.insert({
    hostId: HOST,
    challengerId: RIVAL,
    hostStreamId: hs._id,
    challengerStreamId: cs._id,
    status: "invited",
    invitedAt: new Date(),
    ...fields,
  });
  state.caller = "rival";
  const res = await call("POST", `/battles/${doc._id}/accept`);
  expect(res.statusCode).toBe(200);
  return { doc, hs, cs, view: res.json().data.battle };
}

describe("streaks", () => {
  it("counts each creator's straight wins going in — cancelled and practice battles don't break or add to a run", async () => {
    // The host, newest first: win, (cancelled), win, (practice loss), win, loss, win.
    pastBattle(HOST, STRANGER, HOST, 10);
    pastBattle(HOST, STRANGER, null, 20, { status: "cancelled", endedReason: "cancelled" });
    pastBattle(STRANGER, HOST, HOST, 30);
    pastBattle(HOST, new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), 40, { practice: true });
    pastBattle(HOST, STRANGER, HOST, 50);
    pastBattle(STRANGER, HOST, STRANGER, 60);
    pastBattle(HOST, STRANGER, HOST, 70);
    // The rival drew last time: a draw ends a run.
    pastBattle(RIVAL, STRANGER, null, 15);
    pastBattle(RIVAL, STRANGER, RIVAL, 25);

    expect(await battles.creatorStreak(HOST)).toBe(3);
    expect(await battles.creatorStreak(RIVAL)).toBe(0);
    expect(await battles.creatorStreak(STRANGER)).toBe(0);

    const { view, doc } = await runningBattle();
    expect(doc.hostStreak).toBe(3);
    expect(doc.challengerStreak).toBe(0);
    expect(view.host.streak).toBe(3);
    expect(view.challenger.streak).toBe(0);
  });

  it("adds the win to the winner once it's settled, and the loser's run is over", async () => {
    pastBattle(HOST, STRANGER, HOST, 10);
    pastBattle(RIVAL, STRANGER, RIVAL, 10);
    pastBattle(RIVAL, STRANGER, RIVAL, 20);
    const { doc } = await runningBattle();
    expect([doc.hostStreak, doc.challengerStreak]).toEqual([1, 2]);
    doc.hostUsdMinor = 5_000;
    doc.challengerUsdMinor = 3_000;
    doc.endsAt = new Date(Date.now() - 1);
    await battles.settleBattle(doc as never, "clock");
    const view = await battles.toBattleView(doc as never);
    expect(view.host.streak).toBe(2);
    expect(view.challenger.streak).toBe(0);
    // And the next battle starts from there.
    expect(await battles.creatorStreak(HOST)).toBe(2);
    expect(await battles.creatorStreak(RIVAL)).toBe(0);
  });

  it("shows nobody a streak after a draw, and never one in a practice battle", () => {
    const b = { status: "ended", winnerId: null, hostId: HOST, challengerId: RIVAL, hostStreak: 4, challengerStreak: 2, practice: false } as const;
    expect(battles.streakShown(b as never, "host")).toBe(0);
    expect(battles.streakShown(b as never, "challenger")).toBe(0);
    expect(battles.streakShown({ ...b, status: "live" } as never, "host")).toBe(4);
    expect(battles.streakShown({ ...b, status: "ended", winnerId: HOST, practice: true } as never, "host")).toBe(0);
  });
});

describe("the victory lap", () => {
  it("runs three minutes after a win, and the stream's battle is the result until then", async () => {
    const { doc, hs } = await runningBattle();
    doc.hostUsdMinor = 1_000;
    const end = Date.now() - 1_000;
    doc.endsAt = new Date(end);
    await battles.settleBattle(doc as never, "clock");
    expect(doc.status).toBe("ended");
    expect(doc.lapEndsAt.getTime()).toBe(end + battles.VICTORY_LAP_SEC * 1000);
    expect(battles.VICTORY_LAP_SEC).toBe(180);

    const got = (await call("GET", `/streams/${hs._id}/battle`)).json().data.battle;
    expect(got.id).toBe(String(doc._id));
    expect(got.lapEndsAt).toBe(new Date(end + 180_000).toISOString());
    // Past the lap — even inside the old two minutes — it's gone.
    expect(await battles.recentResultForStream(hs._id, end + 179_000)).not.toBeNull();
    expect(await battles.recentResultForStream(hs._id, end + 181_000)).toBeNull();
  });

  it("gives a draw a few seconds of result and no lap", async () => {
    const { doc, hs } = await runningBattle({ overtimeUsed: true });
    doc.hostUsdMinor = 2_000;
    doc.challengerUsdMinor = 2_000;
    const end = Date.now() - 500;
    doc.endsAt = new Date(end);
    await battles.settleBattle(doc as never, "clock");
    expect(doc.winnerId).toBeNull();
    expect(doc.lapEndsAt.getTime()).toBe(end + battles.DRAW_RESULT_SEC * 1000);
    expect(battles.DRAW_RESULT_SEC).toBeLessThanOrEqual(10);
    expect(await battles.recentResultForStream(hs._id, end + 20_000)).toBeNull();
  });

  it("keeps showing a result settled before laps existed for the old two minutes", async () => {
    const hs = seedStream(HOST);
    const end = Date.now() - 30_000;
    const old = pastBattle(HOST, RIVAL, HOST, 0, { hostStreamId: hs._id, endsAt: new Date(end) });
    delete old.lapEndsAt;
    expect(String((await battles.recentResultForStream(hs._id))!._id)).toBe(String(old._id));
    expect(await battles.recentResultForStream(hs._id, end + 121_000)).toBeNull();
  });

  it("has no lap after a cancelled battle", async () => {
    const { doc } = await runningBattle();
    state.caller = "host";
    const res = await call("POST", `/battles/${doc._id}/cancel`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.battle.status).toBe("cancelled");
    expect(res.json().data.battle.lapEndsAt).toBeNull();
  });
});

describe("ending the lap early", () => {
  async function wonBattle() {
    const r = await runningBattle();
    r.doc.hostUsdMinor = 1_000;
    r.doc.endsAt = new Date(Date.now() - 1);
    await battles.settleBattle(r.doc as never, "clock");
    return r;
  }

  it("is for either side's host and their producers, and brings the result down in both rooms", async () => {
    const { doc, hs } = await wonBattle();
    state.caller = "stranger";
    const refused = await call("POST", `/battles/${doc._id}/end-lap`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("NOT_IN_BATTLE");
    state.caller = "";
    expect((await call("POST", `/battles/${doc._id}/end-lap`)).statusCode).toBe(401);

    // The rival's producer may.
    state.caller = "crew";
    state.sent = [];
    const before = Date.now();
    const ok = await call("POST", `/battles/${doc._id}/end-lap`);
    expect(ok.statusCode).toBe(200);
    expect(Date.parse(ok.json().data.battle.lapEndsAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(ok.json().data.battle.lapEndsAt)).toBeLessThanOrEqual(Date.now());
    const rooms = state.sent.filter((e) => e.data.__evt === "battle").map((e) => e.room);
    expect(rooms.sort()).toEqual([`room-${HOST}`, `room-${RIVAL}`].sort());
    expect((await call("GET", `/streams/${hs._id}/battle`)).json().data.battle).toBeNull();

    // Once down, it stays down.
    state.caller = "host";
    const again = await call("POST", `/battles/${doc._id}/end-lap`);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("LAP_OVER");
  });

  it("works for the host of a running battle's lap only after the result — and for a practice battle", async () => {
    const { doc } = await runningBattle();
    state.caller = "host";
    expect((await call("POST", `/battles/${doc._id}/end-lap`)).json().code).toBe("LAP_OVER");

    db.Battle!.reset();
    db.Stream!.reset();
    seedStream(HOST, { practice: true, livekitRoomName: "practice-room" });
    const started = await call("POST", "/battles/practice");
    const practice = db.Battle!.rows.find((r) => String(r._id) === started.json().data.battle.id)!;
    practice.hostUsdMinor = 500;
    practice.endsAt = new Date(Date.now() - 1);
    await battles.settleBattle(practice as never, "clock");
    expect(practice.lapEndsAt.getTime()).toBeGreaterThan(Date.now() + 170_000);
    const ok = await call("POST", `/battles/${practice._id}/end-lap`);
    expect(ok.statusCode).toBe(200);
    expect(Date.parse(ok.json().data.battle.lapEndsAt)).toBeLessThanOrEqual(Date.now());
  });
});

describe("conceding", () => {
  it("ends a running battle as a loss: the other side wins, with the bonus a full battle earns", async () => {
    pastBattle(RIVAL, STRANGER, RIVAL, 10);
    const { doc } = await runningBattle();
    // The host is ahead, and concedes anyway.
    doc.hostUsdMinor = 9_000;
    doc.challengerUsdMinor = 1_000;
    doc.commissionUsdMinor = 2_000;

    state.caller = "stranger";
    expect((await call("POST", `/battles/${doc._id}/concede`)).statusCode).toBe(403);

    state.caller = "host";
    const res = await call("POST", `/battles/${doc._id}/concede`);
    expect(res.statusCode).toBe(200);
    const view = res.json().data.battle;
    expect(view.status).toBe("ended");
    expect(view.endedReason).toBe("conceded");
    expect(view.winnerId).toBe(String(RIVAL));
    expect(view.bonusUsdMinor).toBe(500);
    expect(view.challenger.streak).toBe(2);
    expect(view.host.streak).toBe(0);
    // A win, so the lap runs.
    expect(Date.parse(view.lapEndsAt)).toBeGreaterThan(Date.now() + 170_000);
    expect(db.User!.rows.find((u) => String(u._id) === String(RIVAL))!.earningsUsdMinor).toBe(500);
    expect(state.bonuses).toHaveLength(1);
    expect(String(state.bonuses[0]![0]!.userId)).toBe(String(RIVAL));

    const again = await call("POST", `/battles/${doc._id}/concede`);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("BATTLE_OVER");
  });

  it("works from the challenger's side too, and in a practice battle hands it to the sparring partner", async () => {
    const { doc } = await runningBattle();
    state.caller = "rival";
    const res = await call("POST", `/battles/${doc._id}/concede`);
    expect(res.json().data.battle.winnerId).toBe(String(HOST));

    db.Battle!.reset();
    db.Stream!.reset();
    seedStream(HOST, { practice: true, livekitRoomName: "practice-room" });
    state.caller = "host";
    const started = (await call("POST", "/battles/practice")).json().data.battle;
    await call("POST", `/battles/${started.id}/practice-gift`, { giftId: "crown" });
    const conceded = (await call("POST", `/battles/${started.id}/concede`)).json().data.battle;
    expect(conceded.status).toBe("ended");
    expect(conceded.winnerId).not.toBe(String(HOST));
    expect(conceded.bonusUsdMinor).toBe(0);
    expect(state.bonuses).toHaveLength(1);
  });
});

describe("a rematch", () => {
  async function lap() {
    const r = await runningBattle({ forfeit: "sings", giftFilter: ["crown"], durationSec: 180 });
    r.doc.challengerUsdMinor = 1_000;
    r.doc.endsAt = new Date(Date.now() - 1);
    await battles.settleBattle(r.doc as never, "clock");
    return r;
  }

  it("invites the same opponent on the same terms, from whoever asked — and they still have to accept", async () => {
    const { doc, hs, cs } = await lap();
    state.caller = "stranger";
    expect((await call("POST", `/battles/${doc._id}/rematch`)).statusCode).toBe(403);

    state.caller = "host";
    state.sent = [];
    const res = await call("POST", `/battles/${doc._id}/rematch`);
    expect(res.statusCode).toBe(200);
    const next = res.json().data.battle;
    expect(next.id).not.toBe(String(doc._id));
    expect(next.status).toBe("invited");
    expect(next).toMatchObject({ forfeit: "sings", giftFilter: ["crown"], durationSec: 180, mode: "1v1" });
    expect(next.host.streamId).toBe(String(hs._id));
    expect(next.challenger.streamId).toBe(String(cs._id));
    expect(state.sent.some((e) => e.room === `room-${RIVAL}` && e.data.__evt === "battle_invite")).toBe(true);

    // One open invite at a time.
    state.caller = "rival";
    const busy = await call("POST", `/battles/${doc._id}/rematch`);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().code).toBe("BATTLE_BUSY");
  });

  it("the loser can ask too, and hosts it", async () => {
    const { doc } = await lap();
    state.caller = "host";
    const next = (await call("POST", `/battles/${doc._id}/rematch`)).json().data.battle;
    expect(next.host.userId).toBe(String(HOST));
    db.Battle!.rows.find((r) => r.status === "invited")!.status = "cancelled";
    state.caller = "rival";
    const theirs = (await call("POST", `/battles/${doc._id}/rematch`)).json().data.battle;
    expect(theirs.host.userId).toBe(String(RIVAL));
    expect(theirs.challenger.userId).toBe(String(HOST));
  });

  it("is refused once the lap is over, or when either side has gone offline", async () => {
    const { doc, cs, hs } = await lap();
    state.caller = "host";
    cs.isLive = false;
    const offline = await call("POST", `/battles/${doc._id}/rematch`);
    expect(offline.statusCode).toBe(409);
    expect(offline.json().code).toBe("CHALLENGER_OFFLINE");
    cs.isLive = true;
    hs.isLive = false;
    expect((await call("POST", `/battles/${doc._id}/rematch`)).json().code).toBe("NOT_LIVE");
    hs.isLive = true;

    doc.lapEndsAt = new Date(Date.now() - 1);
    const over = await call("POST", `/battles/${doc._id}/rematch`);
    expect(over.statusCode).toBe(409);
    expect(over.json().code).toBe("LAP_OVER");
    expect(db.Battle!.rows.filter((r) => r.status === "invited")).toHaveLength(0);
  });

  it("in a practice run is another round against the sparring partner", async () => {
    seedStream(HOST, { practice: true, livekitRoomName: "practice-room" });
    state.caller = "host";
    const first = (await call("POST", "/battles/practice")).json().data.battle;
    const doc = db.Battle!.rows.find((r) => String(r._id) === first.id)!;
    doc.hostUsdMinor = 100;
    doc.endsAt = new Date(Date.now() - 1);
    await battles.settleBattle(doc as never, "clock");
    const again = await call("POST", `/battles/${first.id}/rematch`);
    expect(again.statusCode).toBe(200);
    expect(again.json().data.battle).toMatchObject({ practice: true, status: "live" });
    expect(again.json().data.battle.id).not.toBe(first.id);
  });
});
