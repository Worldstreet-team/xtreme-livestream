import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The clash view's feed: the gifts that counted toward a battle, newest
 * first, only those after `since`, senders by name, and nothing that didn't
 * move the score.
 */

const BATTLE = "9".repeat(24);
const FAN = "c".repeat(24);
const FAN2 = "e".repeat(24);

type Filter = { battleId: string; battleScoreUsdMinor: { $gt: number }; createdAt?: { $gt: Date } };
type Row = { _id: string; senderId: string; giftName: string; emoji: string; battleSide: string | null; battleScoreUsdMinor: number; createdAt: Date };
const state = vi.hoisted(() => ({
  rows: [] as Row[],
  lastFilter: null as Filter | null,
  lastLimit: 0,
}));

vi.mock("../src/livekit.js", () => ({ sendRoomData: async () => {} }));
vi.mock("../src/rewards.js", () => ({ audit: async () => {}, payBattleBonus: async () => {} }));
vi.mock("../src/socials-relay.js", () => ({ relayBattleResult: async () => {} }));
vi.mock("../src/models.js", () => ({
  Battle: {},
  BattleQueue: {},
  Stream: {},
  Notification: {},
  User: {
    find: (q: { _id: { $in: string[] } }) => ({
      select: () => ({
        lean: async () => q._id.$in.map((id) => ({ _id: id, username: `fan-${id.slice(0, 1)}`, displayName: id === FAN ? "Ada" : "" })),
      }),
    }),
  },
  GiftTransaction: {
    find: (filter: Filter) => {
      state.lastFilter = filter;
      let rows = state.rows.filter((r) => r.battleScoreUsdMinor > filter.battleScoreUsdMinor.$gt);
      if (filter.createdAt) rows = rows.filter((r) => r.createdAt > filter.createdAt!.$gt);
      rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const chain = {
        sort: () => chain,
        limit: (n: number) => {
          state.lastLimit = n;
          rows = rows.slice(0, n);
          return chain;
        },
        select: () => chain,
        lean: async () => rows,
      };
      return chain;
    },
  },
}));

const { battleActivity, ACTIVITY_LIMIT } = await import("../src/battles.js");

const at = (secAgo: number) => new Date(Date.now() - secAgo * 1000);

beforeEach(() => {
  state.rows = [
    { _id: "g1", senderId: FAN, giftName: "Rose", emoji: "🌹", battleSide: "host", battleScoreUsdMinor: 100, createdAt: at(30) },
    { _id: "g2", senderId: FAN2, giftName: "Crown", emoji: "👑", battleSide: "challenger", battleScoreUsdMinor: 5000, createdAt: at(10) },
    // Sent to the battle but filtered out of the score: not activity.
    { _id: "g3", senderId: FAN, giftName: "Heart", emoji: "❤️", battleSide: "host", battleScoreUsdMinor: 0, createdAt: at(5) },
  ];
  state.lastFilter = null;
  state.lastLimit = 0;
});

describe("battle activity", () => {
  it("lists the gifts that counted, newest first, with who sent them", async () => {
    const gifts = await battleActivity(BATTLE as never, null);
    expect(gifts.map((g) => g.id)).toEqual(["g2", "g1"]);
    expect(gifts[0]).toMatchObject({ side: "challenger", usdMinor: 5000, giftName: "Crown", emoji: "👑" });
    // A sender with no display name falls back to the username.
    expect(gifts[0]!.sender).toEqual({ userId: FAN2, displayName: "fan-e" });
    expect(gifts[1]!.sender.displayName).toBe("Ada");
    expect(state.lastFilter).toMatchObject({ battleId: BATTLE, battleScoreUsdMinor: { $gt: 0 } });
  });

  it("returns only what's newer than `since`", async () => {
    const gifts = await battleActivity(BATTLE as never, at(20));
    expect(gifts.map((g) => g.id)).toEqual(["g2"]);
  });

  it("caps the page, whatever the caller asks for", async () => {
    await battleActivity(BATTLE as never, null, 500);
    expect(state.lastLimit).toBe(ACTIVITY_LIMIT);
    await battleActivity(BATTLE as never, null, 1);
    expect(state.lastLimit).toBe(1);
  });

  it("is empty when nothing has counted yet", async () => {
    state.rows = [];
    expect(await battleActivity(BATTLE as never, null)).toEqual([]);
  });
});
