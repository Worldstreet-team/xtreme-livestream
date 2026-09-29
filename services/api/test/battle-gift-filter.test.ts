/* eslint-disable @typescript-eslint/no-explicit-any -- the fake models' rows are loose, like the other battle tests' */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GIFT_KEYS, catalogGiftId, countsInGiftFilter, giftFilterSchema, normalizeGiftFilter } from "@xtreme/contracts";
import { GIFT_CATALOG } from "../../../lib/gifts";
import { giftFilterLine } from "../../../lib/battles";

/**
 * Battles 2.0's gift filter: a host can say which gifts count toward the
 * score ("only Roses and Crowns"). Every gift still reaches the host as
 * money; only the score skips the rest. No filter, every gift counts, as
 * before. Quick match never carries one.
 */

const HOST = "a".repeat(24);
const CHAL = "b".repeat(24);
const FAN = "c".repeat(24);
const HS = "1".repeat(24);
const CS = "2".repeat(24);
const BATTLE = "9".repeat(24);

const oid = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v, _bsontype: "ObjectId" });
type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  battle: null as Record<string, any> | null,
  created: [] as Array<Record<string, any>>,
  queue: [] as Array<Record<string, any>>,
  stamps: [] as Array<Record<string, any>>,
  events: [] as unknown[],
}));

const chain = <T>(value: () => T) => {
  const c: Row = { select: () => c, lean: async () => value() };
  c.then = (resolve: (v: T) => unknown) => Promise.resolve(value()).then(resolve);
  return c;
};

vi.mock("../src/livekit.js", () => ({ sendRoomData: async (_room: string, payload: unknown) => void state.events.push(payload) }));
vi.mock("../src/rewards.js", () => ({ audit: async () => {}, payBattleBonus: async () => {} }));
vi.mock("../src/socials-relay.js", () => ({ relayBattleResult: async () => {} }));
vi.mock("../src/models.js", () => ({
  Battle: {
    // Streaks going in (creatorStreak): nobody here has won before.
    find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [] }) }) }) }),
    findOne: async () => state.battle,
    findByIdAndUpdate: async (_id: unknown, update: { $inc: Record<string, number> }) => {
      const b = state.battle!;
      for (const [k, v] of Object.entries(update.$inc)) b[k] = (b[k] ?? 0) + v;
      return b;
    },
    findOneAndUpdate: async () => null,
    exists: async () => null,
    create: async (fields: Row) => {
      const d: Row = {
        _id: oid(BATTLE), durationSec: 300, multiplierWindowSec: 30, multiplier: 2, hostUsdMinor: 0, challengerUsdMinor: 0,
        commissionUsdMinor: 0, winnerId: null, bonusUsdMinor: 0, overtimeUsed: false, lateResetUsed: false, forfeit: "",
        endedReason: null, scheduledAt: null, mode: "1v1", hostPartnerId: null, challengerPartnerId: null, giftFilter: [], ...fields,
      };
      d.save = async () => d;
      state.created.push(d);
      return d;
    },
  },
  BattleQueue: {
    findOneAndDelete: async (filter: { userId: { $ne: unknown } }) => {
      const i = state.queue.findIndex((q) => String(q.userId) !== String(filter.userId.$ne));
      return i >= 0 ? state.queue.splice(i, 1)[0] : null;
    },
    updateOne: async (filter: Row, update: { $set: Row }) => {
      state.queue = state.queue.filter((q) => String(q.userId) !== String(filter.userId));
      state.queue.push({ userId: filter.userId, ...update.$set });
      return {};
    },
    deleteOne: async () => ({}),
    exists: async () => null,
  },
  Stream: {
    findById: (id: unknown) => chain(() => ({ _id: id, guests: [], title: "Friday" })),
    findOne: (filter: Row) => chain(() => ({ _id: filter._id, streamerId: oid(HOST), livekitRoomName: "room" })),
    find: () => chain(() => [{ livekitRoomName: "room-h" }, { livekitRoomName: "room-c" }]),
  },
  User: {
    findById: (id: unknown) => chain(() => ({ _id: id, username: `u${String(id).slice(0, 1)}`, displayName: "", avatar: "" })),
    find: () => chain(() => []),
  },
  GiftTransaction: {
    updateOne: async (_filter: unknown, update: { $set: Row }) => {
      state.stamps.push(update.$set);
      return {};
    },
    aggregate: async () => [],
  },
  Notification: { create: async () => ({}) },
}));

const battles = await import("../src/battles.js");

const liveBattle = (giftFilter: string[] = []) => {
  const d: Row = {
    _id: oid(BATTLE), hostId: oid(HOST), challengerId: oid(CHAL), hostStreamId: oid(HS), challengerStreamId: oid(CS),
    status: "live", durationSec: 300, multiplierWindowSec: 30, multiplier: 2,
    startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 120_000),
    hostUsdMinor: 0, challengerUsdMinor: 0, commissionUsdMinor: 0, lateResetUsed: false, forfeit: "",
    winnerId: null, bonusUsdMinor: 0, overtimeUsed: false, endedReason: null, scheduledAt: null, mode: "1v1", giftFilter,
  };
  d.save = async () => d;
  return d;
};

const sent = (emoji: string, usd: number) => ({ _id: oid("f".repeat(24)), emoji, grossUsdMinor: usd, commissionUsdMinor: Math.floor(usd * 0.2) }) as never;
const fan = { _id: oid(FAN) as never, createdAt: new Date(Date.now() - 30 * 86_400_000) };
const host = { _id: oid(HOST) as never, username: "ada", displayName: "Ada" };

beforeEach(() => {
  state.battle = null;
  state.created = [];
  state.queue = [];
  state.stamps = [];
  state.events = [];
});

describe("the catalog both sides agree on", () => {
  it("is the web's gift catalog, id for id, face for face, price for price", () => {
    expect(GIFT_KEYS.map((g) => [g.id, g.emoji, g.usdMinor])).toEqual(GIFT_CATALOG.map((g) => [g.id, g.emoji, g.usdMinor]));
  });

  it("knows a catalog gift by its face and price together", () => {
    expect(catalogGiftId({ emoji: "👑", grossUsdMinor: 10_000 })).toBe("crown");
    // A keyboard that drops the variation selector still sends a Heart.
    expect(catalogGiftId({ emoji: "❤", grossUsdMinor: 100 })).toBe("heart");
    // A custom amount wearing a Crown's face isn't a Crown.
    expect(catalogGiftId({ emoji: "👑", grossUsdMinor: 300 })).toBeNull();
    expect(catalogGiftId({ emoji: "📣", grossUsdMinor: 500 })).toBeNull();
    expect(catalogGiftId({ emoji: "", grossUsdMinor: 100 })).toBeNull();
  });
});

describe("the filter as the API takes it", () => {
  it("defaults to every gift", () => {
    expect(giftFilterSchema.parse(undefined)).toEqual([]);
    expect(giftFilterSchema.parse([])).toEqual([]);
  });

  it("keeps catalog order, drops repeats, and reads every gift as no filter", () => {
    expect(giftFilterSchema.parse(["crown", "heart", "crown"])).toEqual(["heart", "crown"]);
    expect(normalizeGiftFilter(GIFT_KEYS.map((g) => g.id))).toEqual([]);
  });

  it("refuses a gift that isn't in the catalog, and more gifts than there are", () => {
    expect(giftFilterSchema.safeParse(["rose"]).success).toBe(false);
    expect(giftFilterSchema.safeParse([...GIFT_KEYS.map((g) => g.id), "clap"]).success).toBe(false);
  });

  it("counts everything with no filter, and only what it names with one", () => {
    expect(countsInGiftFilter([], { emoji: "🔥", grossUsdMinor: 200 })).toBe(true);
    expect(countsInGiftFilter(undefined, { emoji: "", grossUsdMinor: 777 })).toBe(true);
    expect(countsInGiftFilter(["crown"], { emoji: "👑", grossUsdMinor: 10_000 })).toBe(true);
    expect(countsInGiftFilter(["crown"], { emoji: "🔥", grossUsdMinor: 200 })).toBe(false);
    expect(countsInGiftFilter(["crown"], { emoji: "", grossUsdMinor: 10_000 })).toBe(false);
  });
});

describe("scoring a filtered battle", () => {
  it("scores the gifts it names", async () => {
    state.battle = liveBattle(["heart", "crown"]);
    const after = await battles.applyBattleGift({ _id: oid(HS) } as never, sent("👑", 10_000), fan);
    expect(after?.hostUsdMinor).toBe(10_000);
    expect(state.stamps.at(-1)).toMatchObject({ battleSide: "host", battleScoreUsdMinor: 10_000 });
  });

  it("stamps the rest with no score, and leaves the scoreboard where it was", async () => {
    state.battle = liveBattle(["heart", "crown"]);
    const after = await battles.applyBattleGift({ _id: oid(CS) } as never, sent("🔥", 200), fan);
    expect(after?.challengerUsdMinor).toBe(0);
    expect(state.stamps.at(-1)).toMatchObject({ battleSide: "challenger", battleScoreUsdMinor: 0 });
    // A custom amount doesn't count either, whatever face it wears.
    await battles.applyBattleGift({ _id: oid(CS) } as never, sent("👑", 4_000), fan);
    expect(state.battle.challengerUsdMinor).toBe(0);
  });

  it("scores every gift with no filter, as before", async () => {
    state.battle = liveBattle();
    await battles.applyBattleGift({ _id: oid(HS) } as never, sent("🔥", 200), fan);
    await battles.applyBattleGift({ _id: oid(HS) } as never, sent("", 750), fan);
    expect(state.battle.hostUsdMinor).toBe(950);
  });

  it("puts the filter on the view both rooms get", async () => {
    state.battle = liveBattle(["crown"]);
    await battles.applyBattleGift({ _id: oid(HS) } as never, sent("👑", 10_000), fan);
    const evt = state.events.at(-1) as { __evt: string; battle: { giftFilter: string[] } };
    expect(evt.__evt).toBe("battle");
    expect(evt.battle.giftFilter).toEqual(["crown"]);
  });
});

describe("setting it", () => {
  it("goes with an invite, and the challenger's room sees it before they accept", async () => {
    const b = await battles.inviteToBattle(host, { _id: oid(HS), title: "Friday" } as never, { _id: oid(CS), streamerId: oid(CHAL), livekitRoomName: "room-c" } as never, "", "1v1", ["crown"]);
    expect(b.giftFilter).toEqual(["crown"]);
    const evt = state.events.find((e) => (e as { __evt: string }).__evt === "battle_invite") as { battle: { giftFilter: string[] } };
    expect(evt.battle.giftFilter).toEqual(["crown"]);
  });

  it("goes with a booking", async () => {
    const b = await battles.scheduleBattle(host, { _id: oid(CHAL) as never, username: "tolu" }, new Date(Date.now() + 3_600_000), "", "1v1", ["heart", "crown"]);
    expect(b.giftFilter).toEqual(["heart", "crown"]);
    expect((await battles.toBattleView(b)).giftFilter).toEqual(["heart", "crown"]);
  });

  it("never comes with a quick match: every gift counts in one", async () => {
    await battles.quickMatch({ _id: oid(HOST) as never }, { _id: oid(HS) } as never);
    const { battle } = await battles.quickMatch({ _id: oid(CHAL) as never }, { _id: oid(CS) } as never);
    expect(battle?.giftFilter).toEqual([]);
  });
});

describe("the line people read", () => {
  it("names the gifts that count", () => {
    expect(giftFilterLine([])).toBeNull();
    expect(giftFilterLine(undefined)).toBeNull();
    expect(giftFilterLine(["crown"])).toBe("Only Crown counts");
    expect(giftFilterLine(["heart", "crown"])).toBe("Only Heart, Crown count");
    expect(giftFilterLine(["clap", "heart", "fire", "rocket"])).toBe("Only 4 gifts count");
  });
});
