import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Live analytics: the curve carries a quiet minute forward, chat and gifts
 * land in their minutes, the recap marks what happened and where people
 * left — and only the host and their producers can read it.
 */

const state = vi.hoisted(() => ({ caller: "host" }));
const HOST = new mongoose.Types.ObjectId();
const PRODUCER = new mongoose.Types.ObjectId();
const MOD = new mongoose.Types.ObjectId();
const who = () => (state.caller === "host" ? HOST : state.caller === "producer" ? PRODUCER : MOD);

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
  };
});
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
const { buildAnalytics, recordViewers } = await import("../src/analytics.js");

const START = Date.parse("2026-09-26T20:00:00Z");
const at = (minute: number, second = 0) => START + minute * 60_000 + second * 1000;
const base = {
  startedAt: START,
  endedAt: at(10),
  live: false,
  viewersByMinute: {},
  peakViewers: 0,
  viewerSeconds: 0,
  chats: [],
  gifts: [],
  moments: [],
  battles: [],
  newAllies: 0,
  uniqueViewers: 0,
  avgWatchMinutes: 0,
  questions: [],
};

describe("building a broadcast's analytics", () => {
  it("holds the count through a quiet minute, and puts chat and gifts in their minutes", () => {
    const a = buildAnalytics({
      ...base,
      viewersByMinute: { "0": 3, "2": 8 },
      chats: [
        { at: at(0, 10), userId: "a" },
        { at: at(2, 5), userId: "b" },
        { at: at(2, 50), userId: "a" },
      ],
      gifts: [{ at: at(1, 30), minor: 500, senderId: "a", sender: "", name: "Rose" }],
    });
    expect(a.minutes.slice(0, 4)).toEqual([
      { viewers: 3, chats: 1, giftsMinor: 0 },
      { viewers: 3, chats: 0, giftsMinor: 500 },
      { viewers: 8, chats: 2, giftsMinor: 0 },
      { viewers: 8, chats: 0, giftsMinor: 0 },
    ]);
    expect(a.minutes).toHaveLength(10);
    expect(a.summary).toMatchObject({ peakViewers: 8, peakMinute: 2, chats: 3, chatters: 2, giftsMinor: 500, gifters: 1, durationMinutes: 10 });
  });

  it("marks big gifts, battles, the peak and the host's moments, in order", () => {
    const a = buildAnalytics({
      ...base,
      viewersByMinute: { "0": 2, "4": 12 },
      gifts: [
        { at: at(3), minor: 5000, senderId: "a", sender: "Ada", name: "Rocket" },
        { at: at(3), minor: 100, senderId: "b", sender: "", name: "Rose" },
      ],
      moments: [{ at: at(1), kind: "segment", label: "Cold open" }],
      battles: [{ at: at(6), result: "won", opponent: "Tolu" }],
    });
    expect(a.moments.map((m) => [m.minute, m.kind, m.label])).toEqual([
      [1, "segment", "Cold open"],
      [3, "gift", "Ada sent a Rocket · $50"],
      [4, "peak", "Peak — 12 watching"],
      [6, "battle", "Won the battle against Tolu"],
    ]);
  });

  it("finds where people left, and what was on", () => {
    const a = buildAnalytics({
      ...base,
      viewersByMinute: { "0": 20, "3": 21, "4": 12, "5": 11, "8": 6 },
      moments: [
        { at: at(0), kind: "segment", label: "Cold open" },
        { at: at(3, 30), kind: "card", label: "Be right back card" },
      ],
    });
    expect(a.dropOffs).toEqual([
      { minute: 4, from: 21, to: 12, during: "Be right back card" },
      { minute: 8, from: 11, to: 6, during: "Be right back card" },
    ]);
  });

  it("averages viewers over the whole broadcast from viewer-seconds when it has them", () => {
    const a = buildAnalytics({ ...base, viewerSeconds: 10 * 60 * 7, viewersByMinute: { "0": 9 } });
    expect(a.summary.avgViewers).toBe(7);
  });
});

describe("recording and reading", () => {
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
    state.caller = "host";
    db.User!.insert({ _id: HOST, username: "amara", safety: { mods: [{ userId: PRODUCER, role: "producer" }, { userId: MOD, role: "mod" }] } });
    const s = db.Stream!.insert({
      streamerId: HOST,
      isLive: false,
      startedAt: new Date(START),
      endedAt: new Date(at(30)),
      peakViewers: 0,
      viewerSeconds: 0,
      viewersByMinute: {},
      moments: [],
    });
    streamId = String(s._id);
  });

  it("keeps the most viewers seen each minute", async () => {
    const started = new Date(START);
    await recordViewers(streamId, started, 4, at(2, 10));
    await recordViewers(streamId, started, 9, at(2, 20));
    await recordViewers(streamId, started, 6, at(2, 40));
    await recordViewers(streamId, started, 5, at(3, 1));
    expect(db.Stream!.rows[0]!.viewersByMinute).toEqual({ "2": 9, "3": 5 });
  });

  it("gives the host and their producers the recap, and no one else", async () => {
    db.Stream!.rows[0]!.viewersByMinute = { "0": 3, "10": 14 };
    db.ChatMessage!.insert({ streamId: db.Stream!.rows[0]!._id, userId: new mongoose.Types.ObjectId(), username: "ada", content: "What's the target for BTC today?", type: "text", status: "visible", createdAt: new Date(at(11)) });
    db.ChatMessage!.insert({ streamId: db.Stream!.rows[0]!._id, userId: new mongoose.Types.ObjectId(), username: "tolu", content: "held line?", type: "text", status: "held", createdAt: new Date(at(12)) });
    const res = await app.inject({ method: "GET", url: `/v1/streams/${streamId}/analytics` });
    expect(res.statusCode).toBe(200);
    const a = res.json().data.analytics;
    expect(a.summary).toMatchObject({ peakViewers: 14, peakMinute: 10, chats: 1, durationMinutes: 30 });
    expect(a.questions).toEqual([{ minute: 11, user: "ada", text: "What's the target for BTC today?" }]);

    state.caller = "producer";
    expect((await app.inject({ method: "GET", url: `/v1/streams/${streamId}/analytics` })).statusCode).toBe(200);
    state.caller = "mod";
    expect((await app.inject({ method: "GET", url: `/v1/streams/${streamId}/analytics` })).statusCode).toBe(403);
  });
});
