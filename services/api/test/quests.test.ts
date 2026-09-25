import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The quest engine: periods, levels and interval maths are pure; claiming
 * is tested against in-memory fakes so the guards — progress re-counted on
 * the server, one claim per period, points only after the claim row — are
 * pinned without a database.
 */

let follows = 0;
let claims: Array<{ _id: string; userId: string; questId: string; periodKey: string; points: number }> = [];
let balance = 0;
let awardFails = false;
const ledger: Array<{ delta: number; reason: string }> = [];

vi.mock("../src/models.js", () => ({
  Follow: { countDocuments: async () => follows },
  ChatMessage: { countDocuments: async () => 0 },
  GameEntry: { countDocuments: async () => 0 },
  Stream: { countDocuments: async () => 0, find: () => ({ select: () => ({ lean: async () => [] }) }) },
  WatchSession: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
  User: {
    findById: () => ({ select: () => ({ lean: async () => ({ watchStreakDays: 0 }) }) }),
    findOneAndUpdate: (_f: unknown, update: { $inc: { pointsBalance: number } }) => ({
      select: () => ({
        lean: async () => {
          if (awardFails) throw new Error("db down");
          balance += update.$inc.pointsBalance;
          return { pointsBalance: balance };
        },
      }),
    }),
  },
  PointsLedger: {
    create: async (row: { delta: number; reason: string }) => {
      ledger.push(row);
      return row;
    },
    aggregate: async () => [],
  },
  QuestClaim: {
    create: async (doc: { userId: unknown; questId: string; periodKey: string; points: number }) => {
      const dup = claims.some((c) => c.userId === String(doc.userId) && c.questId === doc.questId && c.periodKey === doc.periodKey);
      if (dup) throw Object.assign(new Error("dup"), { code: 11000 });
      const row = { _id: `claim${claims.length}`, userId: String(doc.userId), questId: doc.questId, periodKey: doc.periodKey, points: doc.points };
      claims.push(row);
      return row;
    },
    deleteOne: async (q: { _id: string }) => {
      claims = claims.filter((c) => c._id !== q._id);
    },
    find: () => ({ select: () => ({ lean: async () => [] }) }),
  },
  AuditLog: { create: async () => ({}) },
  Payout: {},
}));

vi.mock("../src/wallet.js", () => ({ creditWallet: async () => ({ ok: false, code: "NOT_CONFIGURED", message: "" }), isTreasuryConfigured: () => false }));

const q = await import("../src/quests.js");

const USER = "u".repeat(24) as unknown as Parameters<typeof q.claimQuest>[0];

describe("periods", () => {
  it("keys a day by its UTC date and resets at the next midnight", () => {
    const p = q.periodFor("daily", new Date("2026-09-24T15:30:00Z"));
    expect(p.key).toBe("2026-09-24");
    expect(p.start.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(p.end?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("keys a week by its ISO week, Monday to Monday", () => {
    const p = q.periodFor("weekly", new Date("2026-09-24T15:30:00Z"));
    expect(p.key).toBe("2026-W39");
    expect(p.start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(p.end?.toISOString()).toBe("2026-09-28T00:00:00.000Z");
  });

  it("puts New Year's Day 2027 in week 53 of 2026, like ISO does", () => {
    expect(q.isoWeekKey(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");
    expect(q.isoWeekKey(new Date("2027-01-04T12:00:00Z"))).toBe("2027-W01");
  });

  it("gives milestones one period, forever", () => {
    const p = q.periodFor("milestone");
    expect(p.key).toBe("once");
    expect(p.end).toBeNull();
  });
});

describe("levels", () => {
  it("steps at 0, 250, 750, 1,500, 2,500…", () => {
    expect(q.thresholdFor(1)).toBe(0);
    expect(q.thresholdFor(2)).toBe(250);
    expect(q.thresholdFor(3)).toBe(750);
    expect(q.thresholdFor(5)).toBe(2500);
  });

  it("names the tier and the next one", () => {
    expect(q.levelFor(0)).toMatchObject({ level: 1, tier: "Spark", floor: 0, next: 250, nextTier: { name: "Ember", level: 5 } });
    expect(q.levelFor(749).level).toBe(2);
    expect(q.levelFor(2500)).toMatchObject({ level: 5, tier: "Ember" });
  });
});

describe("watch time", () => {
  const h = 3_600_000;
  it("doesn't count two tabs twice", () => {
    expect(q.minutesWithin([[0, h], [30 * 60_000, h + 30 * 60_000]], 0, 10 * h)).toBe(90);
  });

  it("clips to the period", () => {
    expect(q.minutesWithin([[0, 2 * h]], h, 10 * h)).toBe(60);
  });

  it("counts every UTC day a session touches", () => {
    const start = Date.parse("2026-09-21T00:00:00Z");
    const late = Date.parse("2026-09-21T23:30:00Z");
    const days = q.daysTouched([[late, late + h]], start, start + 7 * 24 * h);
    expect([...days]).toEqual(["2026-09-21", "2026-09-22"]);
  });
});

describe("the catalogue", () => {
  it("has unique ids, real targets and real rewards", () => {
    const ids = q.QUESTS.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of q.QUESTS) {
      expect(x.target).toBeGreaterThan(0);
      expect(x.points).toBeGreaterThan(0);
    }
  });

  it("never pays points for spending money", () => {
    expect(q.QUESTS.some((x) => /gift|spend|purchase|tip/i.test(x.metric))).toBe(false);
  });
});

describe("claiming", () => {
  beforeEach(() => {
    follows = 0;
    claims = [];
    balance = 1000;
    awardFails = false;
    ledger.length = 0;
  });

  it("refuses a quest that isn't finished, counted on the server", async () => {
    follows = 0;
    await expect(q.claimQuest(USER, "milestone-first-follow")).rejects.toMatchObject({ code: "NOT_READY" });
    expect(claims).toHaveLength(0);
  });

  it("pays a finished quest once, and only once", async () => {
    follows = 1;
    const r = await q.claimQuest(USER, "milestone-first-follow");
    expect(r.balance).toBe(1100);
    expect(ledger).toEqual([expect.objectContaining({ delta: 100, reason: "quest" })]);
    await expect(q.claimQuest(USER, "milestone-first-follow")).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
    expect(balance).toBe(1100);
  });

  it("lets a weekly quest pay again next week, not later this week", async () => {
    follows = 3;
    await q.claimQuest(USER, "weekly-find-your-people", new Date("2026-09-24T10:00:00Z"));
    await expect(q.claimQuest(USER, "weekly-find-your-people", new Date("2026-09-27T10:00:00Z"))).rejects.toMatchObject({ code: "ALREADY_CLAIMED" });
    await q.claimQuest(USER, "weekly-find-your-people", new Date("2026-09-29T10:00:00Z"));
    expect(claims.map((c) => c.periodKey)).toEqual(["2026-W39", "2026-W40"]);
  });

  it("takes the claim back if the points can't be paid, so it can be retried", async () => {
    follows = 1;
    awardFails = true;
    await expect(q.claimQuest(USER, "milestone-first-follow")).rejects.toThrow("db down");
    expect(claims).toHaveLength(0);
  });

  it("knows nothing of made-up quests", async () => {
    await expect(q.claimQuest(USER, "free-points")).rejects.toMatchObject({ code: "UNKNOWN_QUEST" });
  });
});
