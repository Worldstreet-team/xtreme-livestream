import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The battle pushes through the WorldSpace gateway (xtream-events.ts):
 * `battle { battleId, change }` on each creator's own channel, and each
 * counted gift on the battle's own channel (`to: "battle:<id>"`, flat,
 * points not money). Never for a practice battle.
 */

vi.mock("../src/config.js", () => ({
  config: { SOCIALS_GATEWAY_URL: "https://gateway.test", SOCIALS_WEBHOOK_SECRET: "test-secret" },
}));
vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return { User: new FakeModel("User"), Stream: new FakeModel("Stream") };
});

const db = (await import("../src/models.js")) as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { drainXtreamEvents, resetXtreamEvents, xtreamBattleChange, xtreamBattleGift } = await import("../src/xtream-events.js");

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const ok = () => ({ ok: true, status: 200, json: async () => ({ success: true }) });
const allEvents = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/internal/xtream/events"))
    .flatMap(([, init]) => JSON.parse((init as { body: string }).body).events as Array<{ to: string; name: string; data?: Record<string, unknown> }>);
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await drainXtreamEvents();
}

const HOST = new mongoose.Types.ObjectId();
const CHALLENGER = new mongoose.Types.ObjectId();
const PARTNER = new mongoose.Types.ObjectId();
const NO_CLERK = new mongoose.Types.ObjectId();
const battle = (over: Record<string, unknown> = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  hostId: HOST,
  challengerId: CHALLENGER,
  hostStreamId: new mongoose.Types.ObjectId(),
  challengerStreamId: new mongoose.Types.ObjectId(),
  ...over,
});
const gift = {
  id: "g1",
  side: "host" as const,
  usdMinor: 1000,
  giftName: "Rose",
  emoji: "🌹",
  sender: { userId: "u9", displayName: "Tolu" },
  at: "2026-09-29T12:00:00.000Z",
};

beforeEach(() => {
  resetXtreamEvents();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
  db.User!.reset();
  db.User!.insert({ _id: HOST, authUserId: "user_host" });
  db.User!.insert({ _id: CHALLENGER, authUserId: "user_challenger" });
  db.User!.insert({ _id: PARTNER, authUserId: "user_partner" });
  db.User!.insert({ _id: NO_CLERK });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("a battle changing", () => {
  it("tells both hosts on their own channels, ids only", async () => {
    const b = battle();
    xtreamBattleChange(b, "declined");
    await settle();
    const got = allEvents();
    expect(got).toHaveLength(2);
    expect(got.map((e) => e.to).sort()).toEqual(["user_challenger", "user_host"]);
    for (const e of got) expect(e).toEqual({ to: e.to, name: "battle", data: { battleId: String(b._id), change: "declined" } });
  });

  it("tells a 2v2's partners too, once each, and skips anyone without a Clerk id", async () => {
    xtreamBattleChange(battle({ hostPartnerId: PARTNER, challengerPartnerId: NO_CLERK }), "expired");
    await settle();
    expect(allEvents().map((e) => e.to).sort()).toEqual(["user_challenger", "user_host", "user_partner"]);
  });

  it("never says anything about a practice battle", async () => {
    xtreamBattleChange(battle({ practice: true }), "accepted");
    await settle();
    expect(allEvents()).toEqual([]);
  });
});

describe("a gift counting", () => {
  it("goes on the battle's own channel, flat, with both totals — points, not money", async () => {
    const b = battle();
    xtreamBattleGift(b, gift, { host: 5200, challenger: 3100 });
    await settle();
    const [e] = allEvents();
    expect(e).toEqual({
      to: `battle:${String(b._id)}`,
      name: "gift",
      data: {
        id: "g1",
        side: "host",
        points: 1000,
        giftName: "Rose",
        emoji: "🌹",
        senderId: "u9",
        senderName: "Tolu",
        at: "2026-09-29T12:00:00.000Z",
        hostPoints: 5200,
        challengerPoints: 3100,
      },
    });
    // Nothing money-shaped makes it out.
    expect(Object.keys(e!.data!).some((k) => /usd|minor/i.test(k))).toBe(false);
  });

  it("never for a practice battle, and never for an id the gateway would refuse", async () => {
    xtreamBattleGift(battle({ practice: true }), gift, { host: 1, challenger: 0 });
    xtreamBattleGift(battle({ _id: "bad id with spaces" }), gift, { host: 1, challenger: 0 });
    await settle();
    expect(allEvents()).toEqual([]);
  });
});
