import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { battleGiftSchema } from "@xtreme/contracts";

/**
 * Battles pushed over the rooms instead of polled (2026-09-29): a gift that
 * counts rides in the server's `battle` packet with the score it moved, so
 * the battle stage and the clash view stop polling the activity feed; an
 * invite nobody answered lapses in both rooms, so the studio's battle
 * panel stops polling /battles/mine.
 */

const state = vi.hoisted(() => ({ sent: [] as Array<{ room: string; data: Record<string, unknown> }> }));

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
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
  class GiftModel extends FakeModel {
    async aggregate() {
      return [];
    }
  }
  return {
    Battle: new BattleModel("Battle"),
    GiftTransaction: new GiftModel("GiftTransaction"),
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
    BattleQueue: new FakeModel("BattleQueue"),
    Notification: new FakeModel("Notification"),
  };
});
vi.mock("../src/livekit.js", () => ({
  sendRoomData: async (room: string, data: Record<string, unknown>) => void state.sent.push({ room, data }),
}));
vi.mock("../src/rewards.js", () => ({ audit: async () => {}, payBattleBonus: async () => {} }));
vi.mock("../src/socials-relay.js", () => ({ relayBattleResult: async () => {} }));
vi.mock("../src/xtream-events.js", () => ({ pushNotifications: () => {}, xtreamBattle: () => {}, xtreamBattleChange: () => {}, xtreamBattleGift: () => {} }));
vi.mock("../src/rules.js", () => ({ fireRules: async () => [] }));

const db = (await import("../src/models.js")) as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const battles = await import("../src/battles.js");

const HOST = new mongoose.Types.ObjectId();
const CHAL = new mongoose.Types.ObjectId();
const FAN = new mongoose.Types.ObjectId();
const HS = new mongoose.Types.ObjectId();
const CS = new mongoose.Types.ObjectId();
const MONTH_AGO = new Date(Date.now() - 30 * 86_400_000);

function liveBattle(fields: Record<string, unknown> = {}) {
  return db.Battle!.insert({
    hostId: HOST,
    challengerId: CHAL,
    hostStreamId: HS,
    challengerStreamId: CS,
    status: "live",
    invitedAt: new Date(Date.now() - 120_000),
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 200_000),
    ...fields,
  });
}

function sentGift(fields: Record<string, unknown> = {}) {
  return db.GiftTransaction!.insert({
    streamId: CS,
    senderId: FAN,
    giftName: "Crown",
    emoji: "👑",
    grossUsdMinor: 10_000,
    commissionUsdMinor: 2_000,
    ...fields,
  }) as never;
}

const battlePackets = () => state.sent.filter((s) => s.data.__evt === "battle");

beforeEach(() => {
  state.sent = [];
  for (const m of Object.values(db)) m.reset();
  db.User!.insert({ _id: HOST, username: "zainab", displayName: "Zainab" });
  db.User!.insert({ _id: CHAL, username: "tobi", displayName: "Tobi" });
  db.User!.insert({ _id: FAN, username: "ada", displayName: "Ada", createdAt: MONTH_AGO });
  db.Stream!.insert({ _id: HS, streamerId: HOST, livekitRoomName: "room-host", isLive: true });
  db.Stream!.insert({ _id: CS, streamerId: CHAL, livekitRoomName: "room-chal", isLive: true });
});

describe("a counted gift rides in the room packet", () => {
  it("names the gift, its side, what it scored and who sent it, with the new totals, in both rooms", async () => {
    liveBattle();
    const gift = sentGift();
    await battles.applyBattleGift({ _id: CS } as never, gift, { _id: FAN, createdAt: MONTH_AGO, displayName: "Ada" });

    const packets = battlePackets();
    expect(packets.map((p) => p.room).sort()).toEqual(["room-chal", "room-host"]);
    for (const { data } of packets) {
      const g = battleGiftSchema.parse(data.gift);
      expect(g).toMatchObject({
        id: String((gift as { _id: unknown })._id),
        side: "challenger",
        usdMinor: 10_000,
        giftName: "Crown",
        emoji: "👑",
        sender: { userId: String(FAN), displayName: "Ada" },
      });
      const view = data.battle as { challenger: { usdMinor: number }; host: { usdMinor: number } };
      expect(view.challenger.usdMinor).toBe(10_000);
      expect(view.host.usdMinor).toBe(0);
    }
  });

  it("carries the doubled score inside the closing window", async () => {
    liveBattle({ endsAt: new Date(Date.now() + 20_000) });
    await battles.applyBattleGift({ _id: HS } as never, sentGift({ streamId: HS, grossUsdMinor: 500 }), { _id: FAN, createdAt: MONTH_AGO, displayName: "Ada" });
    const g = battleGiftSchema.parse(battlePackets()[0]!.data.gift);
    expect(g).toMatchObject({ side: "host", usdMinor: 1_000 });
  });

  it("looks the sender's name up when the caller didn't have it", async () => {
    liveBattle();
    await battles.applyBattleGift({ _id: CS } as never, sentGift(), { _id: FAN, createdAt: MONTH_AGO });
    expect(battleGiftSchema.parse(battlePackets()[0]!.data.gift).sender.displayName).toBe("Ada");
  });

  it("sends the score without a gift when the gift didn't count (the host backing themselves)", async () => {
    liveBattle();
    await battles.applyBattleGift({ _id: CS } as never, sentGift({ senderId: CHAL }), { _id: CHAL, createdAt: MONTH_AGO, displayName: "Tobi" });
    const packets = battlePackets();
    expect(packets).toHaveLength(2);
    for (const { data } of packets) expect(data).not.toHaveProperty("gift");
  });

  it("a practice battle's simulated gift rides too — its own room only, points not money", async () => {
    const b = liveBattle({ practice: true, challengerStreamId: new mongoose.Types.ObjectId(), practiceGifts: [] });
    await battles.recordPracticeGift(b as never, "challenger", { name: "Rose", emoji: "🌹", usdMinor: 100 }, "Sparring fan");
    const packets = battlePackets();
    expect(packets.map((p) => p.room)).toEqual(["room-host"]);
    const g = battleGiftSchema.parse(packets[0]!.data.gift);
    expect(g).toMatchObject({ side: "challenger", usdMinor: 100, giftName: "Rose", emoji: "🌹", sender: { userId: "practice:Sparring fan", displayName: "Sparring fan" } });
  });
});

describe("an unanswered invite lapses in both rooms", () => {
  it("cancels invites past their time and tells both rooms", async () => {
    const stale = liveBattle({ status: "invited", startsAt: null, endsAt: null, invitedAt: new Date(Date.now() - 5 * 60_000) });
    await battles.expireInvites(new Date());
    const row = db.Battle!.rows.find((r) => String(r._id) === String(stale._id))!;
    expect(row).toMatchObject({ status: "cancelled", endedReason: "expired" });
    const packets = battlePackets();
    expect(packets.map((p) => p.room).sort()).toEqual(["room-chal", "room-host"]);
    expect((packets[0]!.data.battle as { status: string }).status).toBe("cancelled");
  });

  it("leaves fresh invites alone and says nothing", async () => {
    liveBattle({ status: "invited", startsAt: null, endsAt: null, invitedAt: new Date(Date.now() - 10_000) });
    await battles.expireInvites(new Date());
    expect(db.Battle!.rows[0]).toMatchObject({ status: "invited" });
    expect(state.sent).toHaveLength(0);
  });
});
