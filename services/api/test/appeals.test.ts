import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Appeals and the transparency report: a creator appeals their own
 * takedown once; an admin decides it once, the creator hears, and a
 * reversal brings the stream back; the year's report counts what came
 * down (not the reports), how fast, and what rooms did.
 */

const state = vi.hoisted(() => {
  process.env.ADMIN_USERNAMES = "boss";
  return { caller: "creator" };
});
const CREATOR = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();
const BOSS = new mongoose.Types.ObjectId();
const who = () =>
  state.caller === "boss"
    ? { _id: BOSS, username: "boss", displayName: "Boss" }
    : state.caller === "other"
      ? { _id: OTHER, username: "tolu", displayName: "Tolu" }
      : { _id: CREATOR, username: "amara", displayName: "Amara" };

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
    Appeal: new FakeModel("Appeal", [{ keys: ["kind", "streamId", "takenDownAt"] }]),
    Notification: new FakeModel("Notification"),
    Report: new FakeModel("Report"),
    AuditLog: new FakeModel("AuditLog"),
    ChatMessage: new FakeModel("ChatMessage"),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: who() }),
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

describe("appeals", () => {
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
    state.caller = "creator";
    db.User!.insert({ _id: CREATOR, username: "amara", displayName: "Amara" });
    db.User!.insert({ _id: BOSS, username: "boss", displayName: "Boss" });
    const s = db.Stream!.insert({ streamerId: CREATOR, title: "Friday night desk", isLive: false, takenDownAt: new Date(Date.now() - 3_600_000) });
    streamId = String(s._id);
  });
  const text = "This was a scripted skit — nobody was hurt, and the clip was out of context.";
  const appeal = () => app.inject({ method: "POST", url: `/v1/streams/${streamId}/appeal`, payload: { text } });
  const decide = (id: string, decision: "reverse" | "uphold") =>
    app.inject({ method: "POST", url: `/v1/admin/appeals/${id}/resolve`, payload: { decision, note: "Looked again at the full stream." } });

  it("lets a creator appeal their own takedown once, and tells the admins", async () => {
    const res = await appeal();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.appeal).toMatchObject({ status: "open", stream: { title: "Friday night desk" } });
    expect(db.Notification!.rows).toEqual([expect.objectContaining({ type: "appeal", userId: BOSS })]);
    const again = await appeal();
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("ALREADY_APPEALED");
  });

  it("turns away someone else's stream and one that wasn't taken down", async () => {
    state.caller = "other";
    expect((await appeal()).statusCode).toBe(404);
    state.caller = "creator";
    db.Stream!.rows[0]!.takenDownAt = null;
    expect((await appeal()).json().code).toBe("NOT_TAKEN_DOWN");
  });

  it("reverses a takedown once, brings the stream back and tells the creator", async () => {
    const id = (await appeal()).json().data.appeal.id;
    state.caller = "creator";
    expect((await decide(id, "reverse")).statusCode).toBe(403);
    state.caller = "boss";
    const res = await decide(id, "reverse");
    expect(res.statusCode).toBe(200);
    expect(db.Stream!.rows[0]!.takenDownAt).toBeNull();
    expect(db.Notification!.rows.at(-1)).toMatchObject({ type: "appeal_reversed", userId: CREATOR, link: "/c/amara" });
    expect(db.AuditLog!.rows.at(-1)).toMatchObject({ action: "appeal.reverse" });
    expect((await decide(id, "uphold")).json().code).toBe("APPEAL_DECIDED");

    state.caller = "creator";
    const mine = (await app.inject({ method: "GET", url: "/v1/users/me/takedowns" })).json().data.takedowns;
    expect(mine).toEqual([expect.objectContaining({ title: "Friday night desk", appeal: expect.objectContaining({ status: "reversed" }) })]);
  });

  it("lets a stream taken down again after a reversal be appealed again, once, and lists it once", async () => {
    const first = (await appeal()).json().data.appeal.id;
    state.caller = "boss";
    await decide(first, "reverse");
    // Reported and taken down a second time.
    db.Stream!.rows[0]!.takenDownAt = new Date(Date.now() - 60_000);
    state.caller = "creator";
    expect((await appeal()).statusCode).toBe(200);
    expect((await appeal()).json().code).toBe("ALREADY_APPEALED");
    const mine = (await app.inject({ method: "GET", url: "/v1/users/me/takedowns" })).json().data.takedowns;
    expect(mine).toHaveLength(1);
    expect(mine[0].appeal.status).toBe("open");
  });

  it("upholds a takedown and keeps the stream down", async () => {
    const id = (await appeal()).json().data.appeal.id;
    state.caller = "boss";
    await decide(id, "uphold");
    expect(db.Stream!.rows[0]!.takenDownAt).not.toBeNull();
    expect(db.Notification!.rows.at(-1)).toMatchObject({ type: "appeal_upheld", link: "/dashboard#takedowns" });
  });
});

describe("the transparency report", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("counts a year: reports and how fast, what came down, appeals, and what rooms did", async () => {
    for (const m of Object.values(db)) m.reset();
    const day = (d: number, h = 0) => new Date(Date.UTC(2026, 2, d, h));
    const s1 = new mongoose.Types.ObjectId();
    const line = new mongoose.Types.ObjectId();
    // Two reports on one stream close with one takedown; one on a chat line; one dismissed late; one still open.
    db.Report!.insert({ reason: "violence", status: "actioned", streamId: s1, messageId: null, createdAt: day(1), dueAt: day(3), resolvedAt: day(1, 6) });
    db.Report!.insert({ reason: "violence", status: "actioned", streamId: s1, messageId: null, createdAt: day(1, 2), dueAt: day(3, 2), resolvedAt: day(1, 6) });
    db.Report!.insert({ reason: "harassment", status: "actioned", streamId: s1, messageId: line, createdAt: day(5), dueAt: day(7), resolvedAt: day(5, 2) });
    db.Report!.insert({ reason: "spam", status: "dismissed", streamId: s1, messageId: null, createdAt: day(9), dueAt: day(11), resolvedAt: day(12) });
    db.Report!.insert({ reason: "spam", status: "open", streamId: s1, messageId: null, createdAt: day(20), dueAt: day(22), resolvedAt: null });
    db.Report!.insert({ reason: "spam", status: "open", streamId: s1, messageId: null, createdAt: new Date(Date.UTC(2025, 5, 1)), dueAt: day(1), resolvedAt: null });
    db.Appeal!.insert({ kind: "takedown", streamId: new mongoose.Types.ObjectId(), status: "reversed", createdAt: day(2) });
    db.Appeal!.insert({ kind: "takedown", streamId: new mongoose.Types.ObjectId(), status: "open", createdAt: day(3) });
    for (const action of ["chat.ban", "chat.ban", "chat.timeout", "chat.approve", "chat.shield_on"]) db.AuditLog!.insert({ action, createdAt: day(4) });
    db.ChatMessage!.insert({ heldReason: "slurs", createdAt: day(4) });
    db.ChatMessage!.insert({ heldReason: "links", createdAt: day(4) });
    db.ChatMessage!.insert({ heldReason: "", createdAt: day(4) });
    db.Stream!.insert({ streamerId: CREATOR, startedAt: day(1) });
    db.Stream!.insert({ streamerId: CREATOR, startedAt: day(8) });

    state.caller = "boss";
    const report = (await app.inject({ method: "GET", url: "/v1/admin/transparency?year=2026" })).json().data.report;
    expect(report.reports).toMatchObject({ total: 5, actioned: 3, dismissed: 1, open: 1, onTime: 3, medianHoursToResolve: 5 });
    expect(report.reports.byReason).toMatchObject({ violence: 2, harassment: 1, spam: 2 });
    expect(report.platform).toEqual({ streamTakedowns: 1, chatTakedowns: 1 });
    expect(report.appeals).toEqual({ received: 2, reversed: 1, upheld: 0, open: 1 });
    expect(report.rooms).toMatchObject({ bans: 2, timeouts: 1, heldLines: 2, heldApproved: 1, shieldRaised: 1 });
    expect(report.heldByReason).toEqual({ slurs: 1, links: 1 });
    expect(report.scale).toMatchObject({ streams: 2, creators: 1, chatLines: 3 });

    state.caller = "creator";
    expect((await app.inject({ method: "GET", url: "/v1/admin/transparency" })).statusCode).toBe(403);
  });
});
