import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2v2 battles: each side is its stream and the partner on its stage. The
 * partners are taken off the stages as the clock starts, quick match pairs
 * pairs with pairs, and a winning pair splits the bonus down the middle.
 */

const HOST = "a".repeat(24);
const CHAL = "b".repeat(24);
const HOST_MATE = "c".repeat(24);
const CHAL_MATE = "e".repeat(24);
const HS = "1".repeat(24);
const CS = "2".repeat(24);
const BATTLE = "9".repeat(24);

const oid = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v, _bsontype: "ObjectId" });
type Row = Record<string, any>;

const state = vi.hoisted(() => ({
  stages: new Map<string, Array<{ userId: unknown; status: string }>>(),
  queue: [] as Row[],
  created: [] as Row[],
  earnings: new Map<string, number>(),
  bonusCalls: [] as Array<Array<{ userId: unknown; usdMinor: number }>>,
  notified: [] as string[],
}));

const chain = <T>(value: () => T) => {
  const c: Row = { select: () => c, lean: async () => value() };
  c.then = (resolve: (v: T) => unknown) => Promise.resolve(value()).then(resolve);
  return c;
};

vi.mock("../src/livekit.js", () => ({ sendRoomData: async () => {} }));
vi.mock("../src/socials-relay.js", () => ({ relayBattleResult: async () => {} }));
vi.mock("../src/rewards.js", () => ({
  audit: async () => {},
  payBattleBonus: async (_b: unknown, shares: Array<{ userId: unknown; usdMinor: number }>) => void state.bonusCalls.push(shares),
}));
vi.mock("../src/models.js", () => ({
  // Settling fires show rules: none here.
  ShowRule: { find: () => ({ lean: async () => [] }) },
  Battle: {
    // Streaks going in (creatorStreak): nobody here has won before.
    find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [] }) }) }) }),
    create: async (fields: Row) => {
      const d: Row = {
        _id: oid(BATTLE), durationSec: 300, multiplierWindowSec: 30, multiplier: 2, hostUsdMinor: 0, challengerUsdMinor: 0,
        commissionUsdMinor: 0, winnerId: null, bonusUsdMinor: 0, overtimeUsed: false, lateResetUsed: false, forfeit: "",
        endedReason: null, scheduledAt: null, mode: "1v1", hostPartnerId: null, challengerPartnerId: null, ...fields,
      };
      d.save = async () => d;
      state.created.push(d);
      return d;
    },
    exists: async () => null,
  },
  BattleQueue: {
    findOneAndDelete: async (filter: Row) => {
      const wantPairs = filter.mode === "2v2";
      const i = state.queue.findIndex((q) => String(q.userId) !== String(filter.userId.$ne) && (wantPairs ? q.mode === "2v2" : q.mode !== "2v2"));
      return i >= 0 ? state.queue.splice(i, 1)[0] : null;
    },
    updateOne: async (filter: Row, update: { $set: Row }) => {
      state.queue = state.queue.filter((q) => String(q.userId) !== String(filter.userId));
      state.queue.push({ userId: filter.userId, ...update.$set });
      return {};
    },
    deleteOne: async (filter: Row) => {
      state.queue = state.queue.filter((q) => String(q.userId) !== String(filter.userId));
      return {};
    },
  },
  Stream: {
    findById: (id: unknown) => chain(() => ({ _id: id, guests: state.stages.get(String(id)) ?? [], title: "Friday", livekitRoomName: `room-${String(id)}` })),
    findOne: (filter: Row) => chain(() => ({ _id: filter._id, streamerId: oid(HOST), livekitRoomName: "room" })),
    find: () => chain(() => [{ livekitRoomName: "room-h" }, { livekitRoomName: "room-c" }]),
  },
  User: {
    findById: (id: unknown) => chain(() => ({ _id: id, username: `u${String(id).slice(0, 1)}`, displayName: "", avatar: "" })),
    find: (q: { _id: { $in: unknown[] } }) => chain(() => q._id.$in.map((id) => ({ _id: id, username: `mate-${String(id).slice(0, 1)}`, displayName: "", avatar: "" }))),
    updateOne: async (filter: { _id: unknown }, update: { $inc: { earningsUsdMinor: number } }) => {
      const k = String(filter._id);
      state.earnings.set(k, (state.earnings.get(k) ?? 0) + update.$inc.earningsUsdMinor);
      return {};
    },
  },
  GiftTransaction: { aggregate: async () => [] },
  Notification: { create: async (row: Row) => void state.notified.push(String(row.userId)) },
}));

const battles = await import("../src/battles.js");

beforeEach(() => {
  state.stages = new Map([
    [HS, [{ userId: oid(HOST_MATE), status: "live" }]],
    [CS, [{ userId: oid("f".repeat(24)), status: "requested" }, { userId: oid(CHAL_MATE), status: "live" }]],
  ]);
  state.queue = [];
  state.created = [];
  state.earnings = new Map();
  state.bonusCalls = [];
  state.notified = [];
});

const pair = async () => {
  const b = await (await import("../src/models.js")).Battle.create({
    hostId: oid(HOST), challengerId: oid(CHAL), hostStreamId: oid(HS), challengerStreamId: oid(CS), status: "invited", mode: "2v2",
  });
  return b as never as Parameters<typeof battles.startBattle>[0];
};

describe("the pairs", () => {
  it("takes each side's partner off its stage as the clock starts — live guests only", async () => {
    const b = await battles.startBattle(await pair());
    expect(String(b.hostPartnerId)).toBe(HOST_MATE);
    expect(String(b.challengerPartnerId)).toBe(CHAL_MATE);
    const view = await battles.toBattleView(b);
    expect(view.mode).toBe("2v2");
    expect(view.host.partner).toMatchObject({ userId: HOST_MATE, username: "mate-c" });
    expect(view.challenger.partner).toMatchObject({ userId: CHAL_MATE });
  });

  it("leaves a 1v1's sides without partners, whoever's on stage", async () => {
    const b = await pair();
    (b as Row).mode = "1v1";
    const started = await battles.startBattle(b);
    expect(started.hostPartnerId).toBeNull();
    expect((await battles.toBattleView(started)).host.partner).toBeNull();
  });
});

describe("the bonus", () => {
  const base = { hostId: oid(HOST), hostPartnerId: oid(HOST_MATE), challengerPartnerId: oid(CHAL_MATE) } as never as Row;

  it("goes to the winner alone in a 1v1", () => {
    const shares = battles.bonusShares({ ...base, hostPartnerId: null, challengerPartnerId: null, winnerId: oid(HOST), bonusUsdMinor: 250 } as never);
    expect(shares.map((s) => [String(s.userId), s.usdMinor])).toEqual([[HOST, 250]]);
  });

  it("splits down the middle with the winner's partner — the winner keeps the odd cent", () => {
    const host = battles.bonusShares({ ...base, winnerId: oid(HOST), bonusUsdMinor: 251 } as never);
    expect(host.map((s) => [String(s.userId), s.usdMinor])).toEqual([[HOST, 126], [HOST_MATE, 125]]);
    const chal = battles.bonusShares({ ...base, winnerId: oid(CHAL), bonusUsdMinor: 100 } as never);
    expect(chal.map((s) => [String(s.userId), s.usdMinor])).toEqual([[CHAL, 50], [CHAL_MATE, 50]]);
    expect(battles.bonusShares({ ...base, winnerId: oid(HOST), bonusUsdMinor: 1 } as never)).toHaveLength(1);
    expect(battles.bonusShares({ ...base, winnerId: null, bonusUsdMinor: 100 } as never)).toEqual([]);
  });

  it("books both halves at the clock, pays them out, and tells all four", async () => {
    const b = (await battles.startBattle(await pair())) as never as Row;
    Object.assign(b, { hostUsdMinor: 5000, challengerUsdMinor: 3000, commissionUsdMinor: 1600, endsAt: new Date() });
    await battles.settleBattle(b as never, "clock");
    expect(String(b.winnerId)).toBe(HOST);
    expect(b.bonusUsdMinor).toBe(400);
    expect(state.earnings.get(HOST)).toBe(200);
    expect(state.earnings.get(HOST_MATE)).toBe(200);
    expect(state.bonusCalls[0]!.map((s) => [String(s.userId), s.usdMinor])).toEqual([[HOST, 200], [HOST_MATE, 200]]);
    expect(new Set(state.notified)).toEqual(new Set([HOST, CHAL, HOST_MATE, CHAL_MATE]));
  });
});

describe("quick match", () => {
  const stream = (id: string) => ({ _id: oid(id) }) as never;

  it("pairs pairs with pairs and singles with singles", async () => {
    state.queue.push({ userId: oid(CHAL), streamId: oid(CS), mode: "1v1", at: new Date() });
    // A pair asking finds no pair waiting: it waits, as a pair.
    const first = await battles.quickMatch({ _id: oid(HOST) as never }, stream(HS), "2v2");
    expect(first).toEqual({ battle: null, queued: true });
    expect(state.queue.find((q) => String(q.userId) === HOST)).toMatchObject({ mode: "2v2" });
    expect(state.created).toHaveLength(0);

    // The next pair to ask gets them, straight into a running 2v2.
    const second = await battles.quickMatch({ _id: oid(CHAL) as never }, stream(CS), "2v2");
    expect(second.queued).toBe(false);
    expect(second.battle).toMatchObject({ mode: "2v2", status: "live" });
    expect(String(second.battle!.hostPartnerId)).toBe(HOST_MATE);
    expect(String(second.battle!.challengerPartnerId)).toBe(CHAL_MATE);
  });
});
