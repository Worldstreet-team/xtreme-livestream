import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Battles 2.0: a counting gift in the last seconds resets the clock once,
 * each side shows its top backers, and quick match pairs two waiting hosts
 * straight into a running battle.
 */

const HOST = "a".repeat(24);
const CHAL = "b".repeat(24);
const FAN = "c".repeat(24);
const FAN2 = "e".repeat(24);
const HS = "1".repeat(24);
const CS = "2".repeat(24);
const BATTLE = "9".repeat(24);

const oid = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v, _bsontype: "ObjectId" });

type BattleDoc = Record<string, any>;
const state = vi.hoisted(() => ({
  battle: null as BattleDoc | null,
  created: [] as BattleDoc[],
  queue: [] as Array<{ userId: any; streamId: any; at: Date }>,
  liveStreams: new Set<string>(),
  gifts: [] as Array<{ side: "host" | "challenger"; senderId: string; score: number }>,
  events: [] as unknown[],
}));

function doc(fields: BattleDoc): BattleDoc {
  const d: BattleDoc = { ...fields, save: async () => d };
  return d;
}

vi.mock("../src/livekit.js", () => ({ sendRoomData: async (_room: string, payload: unknown) => void state.events.push(payload) }));
vi.mock("../src/rewards.js", () => ({ audit: async () => {}, payBattleBonus: async () => {} }));
vi.mock("../src/socials-relay.js", () => ({ relayBattleResult: async () => {} }));
vi.mock("../src/models.js", () => ({
  Battle: {
    findOne: async () => state.battle,
    findByIdAndUpdate: async (_id: unknown, update: { $inc: Record<string, number> }) => {
      const b = state.battle!;
      for (const [k, v] of Object.entries(update.$inc)) b[k] = (b[k] ?? 0) + v;
      return b;
    },
    findOneAndUpdate: async (filter: Record<string, any>, update: { $set: Record<string, unknown> }) => {
      const b = state.battle!;
      if (filter.lateResetUsed && b.lateResetUsed === true) return null;
      Object.assign(b, update.$set);
      return b;
    },
    exists: async () => null,
    create: async (fields: BattleDoc) => {
      const d = doc({ _id: oid(BATTLE), durationSec: 300, multiplierWindowSec: 30, multiplier: 2, hostUsdMinor: 0, challengerUsdMinor: 0, commissionUsdMinor: 0, winnerId: null, bonusUsdMinor: 0, overtimeUsed: false, lateResetUsed: false, forfeit: "", endedReason: null, scheduledAt: null, ...fields });
      state.created.push(d);
      return d;
    },
  },
  BattleQueue: {
    findOneAndDelete: async (filter: { userId: { $ne: any } }) => {
      const i = state.queue.findIndex((q) => String(q.userId) !== String(filter.userId.$ne));
      return i >= 0 ? state.queue.splice(i, 1)[0] : null;
    },
    updateOne: async (filter: { userId: any }, update: { $set: { streamId: any; at: Date } }) => {
      state.queue = state.queue.filter((q) => String(q.userId) !== String(filter.userId));
      state.queue.push({ userId: filter.userId, ...update.$set });
      return {};
    },
    deleteOne: async (filter: { userId: any }) => {
      state.queue = state.queue.filter((q) => String(q.userId) !== String(filter.userId));
      return {};
    },
    exists: async () => null,
  },
  Stream: {
    findOne: (filter: { _id: any }) => ({
      select: async () => (state.liveStreams.has(String(filter._id)) ? { _id: filter._id, livekitRoomName: `room-${filter._id}` } : null),
    }),
    find: () => ({ select: () => ({ lean: async () => [{ livekitRoomName: "room-h" }, { livekitRoomName: "room-c" }] }) }),
  },
  User: {
    findById: (id: unknown) => ({ select: () => ({ lean: async () => ({ _id: id, username: `u${String(id).slice(0, 2)}`, displayName: "", avatar: "" }) }) }),
    find: (q: { _id: { $in: unknown[] } }) => ({ select: () => ({ lean: async () => q._id.$in.map((id) => ({ _id: id, username: `fan-${String(id).slice(0, 1)}`, displayName: "", avatar: "" })) }) }),
  },
  GiftTransaction: {
    updateOne: async () => ({}),
    aggregate: async () => {
      const sums = new Map<string, { _id: { side: string; u: string }; usd: number }>();
      for (const g of state.gifts) {
        const key = `${g.side}|${g.senderId}`;
        const row = sums.get(key) ?? { _id: { side: g.side, u: g.senderId }, usd: 0 };
        row.usd += g.score;
        sums.set(key, row);
      }
      return [...sums.values()].sort((a, b) => b.usd - a.usd);
    },
  },
  Notification: { create: async () => ({}) },
}));

const battles = await import("../src/battles.js");

const liveBattle = (secondsLeft: number): BattleDoc =>
  doc({
    _id: oid(BATTLE),
    hostId: oid(HOST),
    challengerId: oid(CHAL),
    hostStreamId: oid(HS),
    challengerStreamId: oid(CS),
    status: "live",
    durationSec: 300,
    multiplierWindowSec: 30,
    multiplier: 2,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + secondsLeft * 1000),
    hostUsdMinor: 0,
    challengerUsdMinor: 0,
    commissionUsdMinor: 0,
    lateResetUsed: false,
    forfeit: "sings a song",
    winnerId: null,
    bonusUsdMinor: 0,
    overtimeUsed: false,
    endedReason: null,
    scheduledAt: null,
  });

const gift = (usd: number) => ({ _id: oid("f".repeat(24)), grossUsdMinor: usd, commissionUsdMinor: Math.floor(usd * 0.2) }) as never;
const fan = { _id: oid(FAN) as never, createdAt: new Date(Date.now() - 30 * 86_400_000) };

beforeEach(() => {
  state.battle = null;
  state.created = [];
  state.queue = [];
  state.liveStreams = new Set([HS, CS]);
  state.gifts = [];
  state.events = [];
});

describe("the late-gift reset", () => {
  it("resets the clock to 15 s when a counting gift lands in the last 10, once", async () => {
    state.battle = liveBattle(5);
    const before = Date.now();
    const after = await battles.applyBattleGift({ _id: oid(HS) } as never, gift(1_000), fan);
    expect(after?.lateResetUsed).toBe(true);
    const left = (after!.endsAt!.getTime() - before) / 1000;
    expect(left).toBeGreaterThan(14);
    expect(left).toBeLessThan(16);

    // A second late gift scores, but the clock has had its reset.
    state.battle!.endsAt = new Date(Date.now() + 4_000);
    const again = await battles.applyBattleGift({ _id: oid(CS) } as never, gift(500), fan);
    expect((again!.endsAt!.getTime() - Date.now()) / 1000).toBeLessThan(5);
  });

  it("leaves the clock alone earlier on, and for gifts that don't count", async () => {
    state.battle = liveBattle(60);
    const early = await battles.applyBattleGift({ _id: oid(HS) } as never, gift(1_000), fan);
    expect(early?.lateResetUsed).toBe(false);

    state.battle = liveBattle(5);
    // The host backing themselves doesn't move the score — or the clock.
    const self = await battles.applyBattleGift({ _id: oid(HS) } as never, gift(1_000), { _id: oid(HOST) as never });
    expect(self?.lateResetUsed).toBe(false);
  });
});

describe("the view", () => {
  it("shows each side's top three backers and the forfeit", async () => {
    state.gifts = [
      { side: "host", senderId: FAN, score: 5_000 },
      { side: "host", senderId: FAN2, score: 1_000 },
      { side: "challenger", senderId: "d".repeat(24), score: 2_000 },
      { side: "host", senderId: "7".repeat(24), score: 300 },
      { side: "host", senderId: "8".repeat(24), score: 200 },
    ];
    const view = await battles.toBattleView(liveBattle(100) as never);
    expect(view.host.top.map((t) => t.usdMinor)).toEqual([5_000, 1_000, 300]);
    expect(view.challenger.top).toHaveLength(1);
    expect(view).toMatchObject({ forfeit: "sings a song", lateResetUsed: false });
  });
});

describe("quick match", () => {
  it("queues the first host, then pairs the next straight into a battle", async () => {
    const first = await battles.quickMatch({ _id: oid(HOST) as never }, { _id: oid(HS) } as never);
    expect(first).toMatchObject({ battle: null, queued: true });
    expect(state.queue).toHaveLength(1);

    const second = await battles.quickMatch({ _id: oid(CHAL) as never }, { _id: oid(CS) } as never);
    expect(second.queued).toBe(false);
    expect(second.battle).toMatchObject({ status: "live" });
    expect(String(second.battle!.hostId)).toBe(HOST);
    expect(String(second.battle!.challengerId)).toBe(CHAL);
    expect(state.queue).toHaveLength(0);
    // Both rooms hear it's on.
    expect(state.events.some((e) => (e as { __evt?: string }).__evt === "battle")).toBe(true);
  });

  it("passes over someone whose stream ended while they waited", async () => {
    state.queue.push({ userId: oid(HOST), streamId: oid(HS), at: new Date() });
    state.liveStreams.delete(HS);
    const result = await battles.quickMatch({ _id: oid(CHAL) as never }, { _id: oid(CS) } as never);
    expect(result).toMatchObject({ battle: null, queued: true });
    expect(state.created).toHaveLength(0);
  });
});
