import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";

/**
 * Prediction safeguards (Phase 1): stakes are never stuck — a game nobody
 * settles in a day refunds itself; nobody with points in a game settles it;
 * and a prediction can run as a vote, with no points at stake at all.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  games: [] as Row[],
  entries: [] as Row[],
  awards: [] as Array<{ userId: string; delta: number; reason: string }>,
  audits: [] as unknown[][],
}));

vi.mock("../src/models.js", () => ({
  Game: {
    find: async (q: { closesAt: { $lte: Date } }) =>
      state.games.filter(
        (g) =>
          ["open", "locked"].includes(g.status as string) &&
          (g.closesAt as Date).getTime() <= q.closesAt.$lte.getTime(),
      ),
    findOneAndUpdate: async () => null,
  },
  GameEntry: {
    exists: async (q: { gameId: unknown; userId: unknown }) =>
      state.entries.some((e) => String(e.gameId) === String(q.gameId) && String(e.userId) === String(q.userId))
        ? { _id: "entry" }
        : null,
    find: async (q: { gameId: unknown; outcome?: string }) =>
      state.entries.filter((e) => String(e.gameId) === String(q.gameId) && (q.outcome === undefined || e.outcome === q.outcome)),
    create: async (doc: Row) => {
      state.entries.push(doc);
      return doc;
    },
    updateOne: async () => ({}),
  },
  Stream: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
  User: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
  ChatMessage: {},
  WatchSession: {},
}));

vi.mock("../src/points.js", () => ({
  awardPoints: async (userId: unknown, delta: number, reason: string) => {
    state.awards.push({ userId: String(userId), delta, reason });
  },
}));

vi.mock("../src/rewards.js", () => ({
  audit: async (...args: unknown[]) => {
    state.audits.push(args);
  },
}));

vi.mock("../src/livekit.js", () => ({ sendRoomData: async () => {} }));

import { STALE_REFUND_MS, enterGame, refundStaleGames, settleGame } from "../src/games.js";
import type { IGame } from "../src/models.js";

const oid = () => new mongoose.Types.ObjectId();

function game(over: Row = {}): IGame {
  const g: Row = {
    _id: oid(),
    streamId: oid(),
    hostId: oid(),
    type: "prediction",
    status: "locked",
    question: "Who takes the round?",
    outcomes: [
      { id: "a", label: "Attackers", points: 0, entries: 0 },
      { id: "b", label: "Defenders", points: 0, entries: 0 },
    ],
    closesAt: new Date(),
    poolPoints: 0,
    entries: 0,
    winningOutcome: null,
    ticketPoints: 0,
    winnersCount: 1,
    prizePoints: 0,
    correctOutcome: null,
    winners: [],
    voteOnly: false,
    settledAt: null,
    save: vi.fn(async () => {}),
    ...over,
  };
  state.games.push(g);
  return g as unknown as IGame;
}

beforeEach(() => {
  state.games.length = 0;
  state.entries.length = 0;
  state.awards.length = 0;
  state.audits.length = 0;
});

describe("refundStaleGames", () => {
  it("cancels a game nobody settled for a day and gives every stake back", async () => {
    const g = game({ closesAt: new Date(Date.now() - STALE_REFUND_MS - 60_000), poolPoints: 150, entries: 2 });
    const alice = oid();
    const bola = oid();
    state.entries.push({ gameId: g._id, userId: alice, outcome: "a", stakePoints: 100 });
    state.entries.push({ gameId: g._id, userId: bola, outcome: "b", stakePoints: 50 });

    await expect(refundStaleGames()).resolves.toBe(1);

    expect(g.status).toBe("cancelled");
    expect(state.awards).toEqual([
      { userId: String(alice), delta: 100, reason: "game_refund" },
      { userId: String(bola), delta: 50, reason: "game_refund" },
    ]);
    expect(state.audits[0]?.[1]).toBe("game.auto_refund");
  });

  it("leaves a game whose window closed less than a day ago", async () => {
    const g = game({ closesAt: new Date(Date.now() - 60 * 60_000) });

    await expect(refundStaleGames()).resolves.toBe(0);

    expect(g.status).toBe("locked");
    expect(state.awards).toEqual([]);
  });
});

describe("settleGame", () => {
  it("refuses a settler who has points in the game", async () => {
    const g = game({ poolPoints: 100, entries: 1 });
    const mod = oid();
    state.entries.push({ gameId: g._id, userId: mod, outcome: "a", stakePoints: 100 });

    await expect(settleGame(g, "a", mod)).rejects.toThrow("SETTLER_ENTERED");
    expect(g.status).toBe("locked");
    expect(state.awards).toEqual([]);
  });

  it("pays nothing when the prediction was a vote", async () => {
    const g = game({ voteOnly: true, entries: 2 });
    state.entries.push({ _id: oid(), gameId: g._id, userId: oid(), outcome: "a", stakePoints: 0 });
    state.entries.push({ _id: oid(), gameId: g._id, userId: oid(), outcome: "b", stakePoints: 0 });

    await settleGame(g, "a", g.hostId);

    expect(g.status).toBe("settled");
    expect(g.winningOutcome).toBe("a");
    expect(state.awards).toEqual([]);
  });

  it("refunds nothing it never took when nobody called a vote right", async () => {
    const g = game({ voteOnly: true, entries: 1 });
    state.entries.push({ _id: oid(), gameId: g._id, userId: oid(), outcome: "b", stakePoints: 0 });

    await settleGame(g, "a", g.hostId);

    expect(state.awards).toEqual([]);
  });
});

describe("enterGame", () => {
  it("takes a vote-only pick without touching anyone's points", async () => {
    const g = game({ status: "open", closesAt: new Date(Date.now() + 60_000), voteOnly: true });
    const viewer = oid();

    const entry = await enterGame(g, viewer, "b", 500);

    expect(entry.stakePoints).toBe(0);
    expect(state.awards).toEqual([]);
  });

  it("still takes the stake on an ordinary prediction", async () => {
    const g = game({ status: "open", closesAt: new Date(Date.now() + 60_000) });
    const viewer = oid();

    await enterGame(g, viewer, "a", 100);

    expect(state.awards).toEqual([{ userId: String(viewer), delta: -100, reason: "game_stake" }]);
  });
});
