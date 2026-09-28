import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The post-live report: the tone it takes, the best minute, the weekly
 * streak and the one next step — and the host's recommend-Xtream answer,
 * one per stream, the host's alone.
 */

const state = vi.hoisted(() => ({ caller: "host" }));
const HOST = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const who = () => (state.caller === "host" ? HOST : STRANGER);

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
    ChatMessage: new FakeModel("ChatMessage"),
    GiftTransaction: new FakeModel("GiftTransaction"),
    Battle: new FakeModel("Battle"),
    Follow: new FakeModel("Follow"),
    WatchSession: new FakeModel("WatchSession"),
    PointsLedger: new FakeModel("PointsLedger"),
    QuestClaim: new FakeModel("QuestClaim", [{ keys: ["userId", "questId", "periodKey"] }]),
    Game: new FakeModel("Game"),
    GameEntry: new FakeModel("GameEntry"),
    StreamRating: new FakeModel("StreamRating", [{ keys: ["streamId"] }]),
  };
});
// Lifetime points are an aggregate, which the fake doesn't speak.
vi.mock("../src/quests.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/quests.js")>()),
  lifetimePoints: async () => 800,
}));
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: who(), username: state.caller } }),
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
const { bestMinute, nextStep, reportTone, weeksInARow } = await import("../src/stream-report.js");
type QuestView = import("../src/quests.js").QuestView;

const quest = (over: Partial<QuestView>): QuestView => ({
  id: "weekly-on-air",
  cadence: "weekly",
  title: "On air",
  blurb: "",
  icon: "live",
  unit: "min",
  target: 60,
  progress: 0,
  points: 500,
  claimed: false,
  claimable: false,
  resetsAt: null,
  creator: true,
  ...over,
});

describe("the report's reading of a broadcast", () => {
  it("celebrates any one real sign, stays calm otherwise, and a practice run is its own", () => {
    const quiet = { peakViewers: 2, newAllies: 0, gifters: 0, chats: 3 };
    expect(reportTone(quiet, false)).toBe("quiet");
    expect(reportTone({ ...quiet, newAllies: 1 }, false)).toBe("good");
    expect(reportTone({ ...quiet, gifters: 1 }, false)).toBe("good");
    expect(reportTone({ ...quiet, peakViewers: 5 }, false)).toBe("good");
    expect(reportTone({ ...quiet, chats: 10 }, false)).toBe("good");
    expect(reportTone({ ...quiet, gifters: 4 }, true)).toBe("practice");
  });

  it("finds the best minute — chat and gifts count extra — with what was on then", () => {
    const b = bestMinute({
      minutes: [
        { viewers: 4, chats: 0, giftsMinor: 0 },
        { viewers: 3, chats: 2, giftsMinor: 0 },
        { viewers: 3, chats: 0, giftsMinor: 500 },
      ],
      moments: [
        { minute: 2, kind: "peak", label: "Peak — 4 watching" },
        { minute: 2, kind: "gift", label: "Ada sent a Rocket · $5" },
      ],
    });
    expect(b).toEqual({ minute: 2, viewers: 3, chats: 0, giftsMinor: 500, label: "Ada sent a Rocket · $5" });
    expect(bestMinute({ minutes: [{ viewers: 0, chats: 0, giftsMinor: 0 }], moments: [] })).toBeNull();
  });

  it("counts weeks in a row, and an unfinished week doesn't break the run yet", () => {
    const now = new Date("2026-09-30T12:00:00Z"); // a Wednesday
    const d = (iso: string) => new Date(iso);
    expect(weeksInARow([d("2026-09-29T20:00:00Z"), d("2026-09-22T20:00:00Z"), d("2026-09-14T20:00:00Z")], now)).toBe(3);
    // Nothing yet this week: last week's run still stands.
    expect(weeksInARow([d("2026-09-22T20:00:00Z"), d("2026-09-15T20:00:00Z")], now)).toBe(2);
    // A missed week ends it.
    expect(weeksInARow([d("2026-09-29T20:00:00Z"), d("2026-09-15T20:00:00Z")], now)).toBe(1);
    expect(weeksInARow([], now)).toBe(0);
  });

  it("offers one next step: claim, then On air, then Book it, then the streak", () => {
    const book = quest({ id: "milestone-book-it", cadence: "milestone", title: "Book it", unit: "booking", target: 1, points: 150 });
    expect(nextStep([quest({ progress: 60, claimable: true }), book], 1)).toMatchObject({ kind: "claim", points: 500, href: "/rewards" });
    expect(nextStep([quest({ progress: 42 }), book], 1)).toMatchObject({ kind: "quest", text: "18 more minutes on air this week finishes “On air”.", progress: 42, target: 60 });
    expect(nextStep([quest({ progress: 60, claimed: true }), book], 1)).toMatchObject({ kind: "book", href: "/schedule" });
    expect(nextStep([quest({ progress: 60, claimed: true }), { ...book, progress: 1, claimed: true }], 2)).toMatchObject({
      kind: "streak",
      text: "Go live next week to make it 3 weeks in a row.",
    });
  });
});

describe("GET /streams/:id/report and PUT /streams/:id/rating", () => {
  let app: FastifyInstance;
  let streamId = "";
  const START = Date.now() - 45 * 60_000;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const m of Object.values(db)) m.reset();
    state.caller = "host";
    db.User!.insert({ _id: HOST, username: "amara", watchStreakDays: 0 });
    const s = db.Stream!.insert({
      streamerId: HOST,
      title: "Friday set",
      category: "Music",
      status: "ended",
      practice: false,
      isLive: false,
      startedAt: new Date(START),
      endedAt: new Date(START + 40 * 60_000),
      peakViewers: 0,
      viewerSeconds: 0,
      viewersByMinute: { "0": 2, "12": 9, "20": 6 },
      moments: [],
      thumbnailVersion: 0,
    });
    streamId = String(s._id);
  });

  const report = () => app.inject({ method: "GET", url: `/v1/streams/${streamId}/report` });
  const rate = (score: unknown) => app.inject({ method: "PUT", url: `/v1/streams/${streamId}/rating`, payload: { score } });

  it("gives the host their numbers, earnings, points and progress", async () => {
    const sid = db.Stream!.rows[0]!._id;
    db.GiftTransaction!.insert({ streamId: sid, senderId: STRANGER, grossUsdMinor: 1000, netUsdMinor: 700, giftName: "Rose", createdAt: new Date(START + 12 * 60_000 + 5000) });
    db.Follow!.insert({ followerId: STRANGER, followingId: HOST, createdAt: new Date(START + 6 * 60_000) });
    db.PointsLedger!.insert({ userId: HOST, delta: 300, reason: "quest", createdAt: new Date(START + 10 * 60_000) });
    db.PointsLedger!.insert({ userId: HOST, delta: 50, reason: "game_refund", createdAt: new Date(START + 11 * 60_000) });

    const res = await report();
    expect(res.statusCode).toBe(200);
    const r = res.json().data.report;
    expect(r.tone).toBe("good");
    expect(r.stream).toMatchObject({ title: "Friday set", practice: false, durationSeconds: 2400 });
    expect(r.analytics.summary).toMatchObject({ peakViewers: 9, newAllies: 1, gifters: 1 });
    expect(r.earnings).toEqual({ grossMinor: 1000, netMinor: 700, gifts: 1 });
    expect(r.pointsEarned).toBe(300);
    expect(r.bestMinute).toMatchObject({ minute: 12, viewers: 9, giftsMinor: 1000 });
    expect(r.progress.level).toMatchObject({ level: 3, xp: 800 });
    expect(r.progress.weeksInARow).toBe(1);
    expect(r.progress.quests.every((q: QuestView) => q.creator)).toBe(true);
    expect(r.progress.next.kind).toBeTruthy();
    expect(r.rating).toBeNull();
  });

  it("keeps money out of a practice run's report", async () => {
    db.Stream!.rows[0]!.practice = true;
    const r = (await report()).json().data.report;
    expect(r.tone).toBe("practice");
    expect(r.earnings).toBeNull();
  });

  it("is the host's alone", async () => {
    state.caller = "stranger";
    expect((await report()).statusCode).toBe(403);
    expect((await rate(9)).statusCode).toBe(403);
    expect(db.StreamRating!.rows).toHaveLength(0);
  });

  it("stores one answer per stream, 0–10, and a second tap changes it", async () => {
    expect((await rate(11)).statusCode).toBe(400);
    expect((await rate(4.5)).statusCode).toBe(400);
    expect((await rate(-1)).statusCode).toBe(400);

    const first = await rate(8);
    expect(first.statusCode).toBe(200);
    expect(first.json().data.score).toBe(8);
    expect((await rate(10)).json().data.score).toBe(10);

    expect(db.StreamRating!.rows).toHaveLength(1);
    expect(db.StreamRating!.rows[0]).toMatchObject({ score: 10 });
    expect(String(db.StreamRating!.rows[0]!.userId)).toBe(String(HOST));
    expect(String(db.StreamRating!.rows[0]!.streamId)).toBe(streamId);
    expect(db.StreamRating!.rows[0]!.createdAt).toBeInstanceOf(Date);

    expect((await report()).json().data.report.rating).toBe(10);
  });

  it("won't take an answer for a stream that never went on air", async () => {
    db.Stream!.rows[0]!.startedAt = null;
    expect((await rate(7)).statusCode).toBe(409);
    expect((await report()).statusCode).toBe(409);
  });
});
