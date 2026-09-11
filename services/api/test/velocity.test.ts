import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Velocity is the growth signal "trending" sorts on. It has to (a) score
 * growth relative to the earlier level, (b) refuse to score streams too
 * young to have an earlier reading, and (c) never crash the sweep on an
 * empty live set.
 */

let liveRows: Array<{ _id: string; viewers: number }>;
let earlierRows: Array<{ _id: string; viewers: number }>;
let inserted: Array<Record<string, unknown>>;
let writes: Array<Record<string, unknown>>;

vi.mock("../src/models.js", () => ({
  Stream: {
    find: () => ({ select: () => ({ lean: async () => liveRows }) }),
    bulkWrite: async (ops: Array<Record<string, unknown>>) => {
      writes.push(...ops);
      return {};
    },
  },
  ViewerSample: {
    insertMany: async (rows: Array<Record<string, unknown>>) => {
      inserted.push(...rows);
      return rows;
    },
    aggregate: async () => earlierRows,
  },
}));

import { sampleAndScoreVelocity, scoreVelocity } from "../src/velocity.js";

beforeEach(() => {
  liveRows = [];
  earlierRows = [];
  inserted = [];
  writes = [];
});

describe("scoreVelocity", () => {
  it("scores growth relative to the earlier level", () => {
    // 20 → 300 is fifteen times bigger than it was.
    expect(scoreVelocity(300, 20)).toBe(14);
  });

  it("uses a floor so tiny baselines don't explode", () => {
    // 1 → 11 is a 10× ratio on paper; against the floor of 10 it's a gain
    // of ten viewers — scored +1.0, not +10.
    expect(scoreVelocity(11, 1)).toBe(1);
    // Above the floor the real baseline is used.
    expect(scoreVelocity(40, 20)).toBe(1);
  });

  it("scores a decline negative and a flat stream zero", () => {
    expect(scoreVelocity(24_000, 30_000)).toBe(-0.2);
    expect(scoreVelocity(500, 500)).toBe(0);
  });
});

describe("sampleAndScoreVelocity", () => {
  it("records a sample for every live stream and scores those with history", async () => {
    liveRows = [
      { _id: "a", viewers: 300 },
      { _id: "b", viewers: 30_000 },
      { _id: "c", viewers: 50 },
    ];
    // "c" is too young to have a reading ten minutes back.
    earlierRows = [
      { _id: "a", viewers: 20 },
      { _id: "b", viewers: 30_000 },
    ];

    const scored = await sampleAndScoreVelocity(new Date("2026-09-06T10:10:00Z"));

    expect(inserted.map((r) => r.streamId)).toEqual(["a", "b", "c"]);
    expect(scored).toBe(2);
    expect(writes).toEqual([
      {
        updateOne: {
          filter: { _id: "a" },
          update: { $set: { velocity: 14 } },
        },
      },
      {
        updateOne: {
          filter: { _id: "b" },
          update: { $set: { velocity: 0 } },
        },
      },
    ]);
  });

  it("does nothing when nobody is live", async () => {
    expect(await sampleAndScoreVelocity()).toBe(0);
    expect(inserted).toEqual([]);
    expect(writes).toEqual([]);
  });
});
