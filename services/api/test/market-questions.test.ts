import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  formatMarketTime,
  formatMarketUsd,
  marketQuestionClosesAt,
  marketQuestionText,
  marketResultText,
  marketThreshold,
  roundStep,
} from "@xtreme/contracts";

/**
 * Market questions (Phase 4): "SOL above $150.00 at 20:30?" — Yes/No,
 * worded and timed by the API, settled by the game sweep from the close of
 * Coinbase's 1-minute candle containing that minute, never by hand, and
 * always a vote: nothing staked, nothing paid.
 */

const state = vi.hoisted(() => ({ caller: "host", sent: [] as Array<Record<string, unknown>> }));
const HOST = new mongoose.Types.ObjectId();
const VIEWER = new mongoose.Types.ObjectId();
const MOD = new mongoose.Types.ObjectId();
const who = () => (state.caller === "host" ? HOST : state.caller === "viewer" ? VIEWER : MOD);

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  // A game row with the defaults Mongoose would fill in.
  class GameModel extends FakeModel {
    override async create(fields: Record<string, unknown>) {
      return this.insert({ poolPoints: 0, entries: 0, winningOutcome: null, winners: [], settledAt: null, ...fields });
    }
  }
  return {
    Game: new GameModel("Game"),
    GameEntry: new FakeModel("GameEntry", [{ keys: ["gameId", "userId"] }]),
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
    PointsLedger: new FakeModel("PointsLedger"),
    AuditLog: new FakeModel("AuditLog"),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: who(), username: state.caller, createdAt: new Date(0) } }),
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
  sendRoomData: async (_room: string, data: Record<string, unknown>) => {
    state.sent.push(data);
  },
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { setKnownMarkets } = await import("../src/market-list.js");
const { clearOracleCache, priceAt } = await import("../src/market-oracle.js");
const { clearMarketQuestionTries, currentGameForStream, settleGame, settleMarketQuestions } = await import("../src/games.js");

const MIN = 60_000;
const fetchMock = vi.fn();
let app: FastifyInstance;
let streamId = "";

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchMock);
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  fetchMock.mockReset();
  clearOracleCache();
  clearMarketQuestionTries();
  setKnownMarkets(["SOL-USD", "BTC-USD", "ETH-USD"]);
  state.caller = "host";
  state.sent = [];
  db.User!.insert({ _id: HOST, username: "amara", pointsBalance: 0, safety: { mods: [{ userId: MOD, role: "mod" }] } });
  db.User!.insert({ _id: VIEWER, username: "tolu", pointsBalance: 1_000 });
  db.User!.insert({ _id: MOD, username: "kemi", pointsBalance: 1_000 });
  const s = db.Stream!.insert({ streamerId: HOST, isLive: true, livekitRoomName: "room-1", title: "Friday desk" });
  streamId = String(s._id);
});

/** The next whole minute at least `minutes` from now — what the studio's +15 min sends. */
const minutesOut = (minutes: number) => Math.ceil((Date.now() + minutes * MIN) / MIN) * MIN;
const ask = (oracle: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: `/v1/streams/${streamId}/games`, payload: { type: "prediction", oracle, ...extra } });

/** A market question straight into the store, its minute already over. */
function seedQuestion(at: number, over: Record<string, unknown> = {}) {
  return db.Game!.insert({
    streamId: new mongoose.Types.ObjectId(streamId),
    hostId: HOST,
    type: "prediction",
    status: "locked",
    question: "SOL above $150.00 at 20:30?",
    outcomes: [
      { id: "a", label: "Yes", points: 0, entries: 1 },
      { id: "b", label: "No", points: 0, entries: 0 },
    ],
    closesAt: new Date(at - 2 * MIN),
    poolPoints: 0,
    entries: 1,
    winningOutcome: null,
    ticketPoints: 0,
    winnersCount: 1,
    prizePoints: 0,
    correctOutcome: null,
    winners: [],
    voteOnly: true,
    oracle: { symbol: "SOL-USD", above: 150, at: new Date(at), price: null, failed: null },
    settledAt: null,
    ...over,
  });
}

/** Coinbase's candles answer: rows of [time (s), low, high, open, close, volume], newest first. */
const candles = (rows: Array<[number, number]>) =>
  new Response(JSON.stringify(rows.sort((a, b) => b[0] - a[0]).map(([t, close]) => [t / 1000, close - 1, close + 1, close, close, 10])), { status: 200 });

describe("the words and the numbers", () => {
  it("writes the question from the oracle, on the given clock", () => {
    const now = Date.parse("2026-09-27T19:15:27Z");
    expect(marketQuestionText({ symbol: "SOL-USD", above: 150, at: "2026-09-27T19:30:00Z" }, { timeZone: "Africa/Lagos", now })).toBe("SOL above $150.00 at 20:30?");
    // Another day says which.
    expect(marketQuestionText({ symbol: "BTC-USD", above: 84_500, at: "2026-09-28T08:00:00Z" }, { timeZone: "Africa/Lagos", now })).toBe("BTC above $84,500 at 09:00 on Monday?");
    expect(marketResultText({ symbol: "SOL-USD", price: 151.2, at: "2026-09-27T19:30:00Z" }, { timeZone: "Africa/Lagos" })).toBe("SOL was $151.20 at 20:30 · Coinbase");
  });

  it("says prices at the scale they're read at", () => {
    expect(formatMarketUsd(84_500)).toBe("$84,500");
    expect(formatMarketUsd(84_465.79)).toBe("$84,465.79");
    expect(formatMarketUsd(150)).toBe("$150.00");
    expect(formatMarketUsd(0.0967)).toBe("$0.0967");
    expect(formatMarketUsd(0.1)).toBe("$0.10");
    expect(formatMarketUsd(0.00000437)).toBe("$0.00000437");
  });

  it("steps round numbers by the price's second digit", () => {
    expect(roundStep(84_465.79)).toBe(1_000);
    expect(roundStep(2_702.31)).toBe(100);
    expect(roundStep(121.46)).toBe(10);
    expect(roundStep(1.5268)).toBe(0.1);
    expect(roundStep(0.09666)).toBe(0.001);
    expect(roundStep(0.00000437)).toBe(0.0000001);
    // Exactly on a power of ten, whatever log10 makes of it.
    expect(roundStep(1_000)).toBe(100);
    expect(roundStep(100_000)).toBe(10_000);
    expect(roundStep(0)).toBe(1);
  });

  it("starts a question's line at a round number close enough to be a question", () => {
    expect(marketThreshold(2_702.31)).toBe(2_700); // the round number is right there
    expect(marketThreshold(84_465.79)).toBe(84_500); // 84,000 is too far: the next digit down
    expect(marketThreshold(121.46)).toBe(121);
    expect(marketThreshold(0.09666)).toBe(0.097);
    expect(marketThreshold(1.5268)).toBe(1.53);
  });

  it("closes votes a tenth of the wait before the minute: one minute at least, thirty at most", () => {
    const now = Date.parse("2026-09-27T19:15:00Z");
    const lead = (minutes: number) => (now + minutes * MIN - marketQuestionClosesAt(now + minutes * MIN, now)) / MIN;
    expect(lead(5)).toBe(1);
    expect(lead(15)).toBe(2);
    expect(lead(60)).toBe(6);
    expect(lead(24 * 60)).toBe(30);
  });
});

describe("asking a market question", () => {
  it("writes the question, the Yes and No, and the clock itself — and makes it a vote", async () => {
    const at = minutesOut(15);
    const res = await ask({ symbol: "sol-usd", above: 150, at: new Date(at + 27_000).toISOString(), tz: "Africa/Lagos" }, { question: "Rigged?", outcomes: ["Moon", "Dust"], voteOnly: false, durationSec: 60 });
    expect(res.statusCode).toBe(200);
    const game = res.json().data.game;
    expect(game.question).toBe(marketQuestionText({ symbol: "SOL-USD", above: 150, at }, { timeZone: "Africa/Lagos" }));
    expect(game.question).toContain(`at ${formatMarketTime(at, "Africa/Lagos")}`);
    expect(game.outcomes.map((o: { label: string }) => o.label)).toEqual(["Yes", "No"]);
    expect(game.voteOnly).toBe(true);
    // Read to the minute; votes close a tenth of the wait before it.
    expect(game.oracle).toEqual({ symbol: "SOL-USD", above: 150, at: new Date(at).toISOString(), source: "Coinbase", price: null, failed: null });
    expect(Date.parse(game.closesAt)).toBe(at - 2 * MIN);
    expect(state.sent.at(-1)).toMatchObject({ __evt: "game", game: { oracle: { symbol: "SOL-USD" } } });

    const current = await app.inject({ method: "GET", url: `/v1/streams/${streamId}/games/current` });
    expect(current.json().data.game.oracle.symbol).toBe("SOL-USD");
  });

  it("takes a time between five minutes and a day out, and nothing else", async () => {
    const tooSoon = await ask({ symbol: "SOL-USD", above: 150, at: new Date(Date.now() + 4 * MIN).toISOString() });
    expect(tooSoon.statusCode).toBe(400);
    expect(tooSoon.json().code).toBe("BAD_QUESTION_TIME");
    const tooFar = await ask({ symbol: "SOL-USD", above: 150, at: new Date(Date.now() + 25 * 60 * MIN).toISOString() });
    expect(tooFar.json().code).toBe("BAD_QUESTION_TIME");
    expect((await ask({ symbol: "SOL-USD", above: 150, at: new Date(minutesOut(24 * 60 - 2)).toISOString() })).statusCode).toBe(200);
  });

  it("asks only about a dollar market Coinbase trades", async () => {
    const at = new Date(minutesOut(15)).toISOString();
    const unknown = await ask({ symbol: "ZZZ-USD", above: 1, at });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().code).toBe("UNKNOWN_MARKET");
    expect((await ask({ symbol: "ETH-BTC", above: 0.03, at })).json().code).toBe("VALIDATION_ERROR");
    expect((await ask({ symbol: "SOL-USD", above: 0, at })).json().code).toBe("VALIDATION_ERROR");
    // A market question is a prediction.
    expect((await ask({ symbol: "SOL-USD", above: 150, at }, { type: "quiz", correctIndex: 0 })).json().code).toBe("VALIDATION_ERROR");
    expect(db.Game!.rows).toHaveLength(0);
  });

  it("is the host's to ask", async () => {
    state.caller = "viewer";
    const res = await ask({ symbol: "SOL-USD", above: 150, at: new Date(minutesOut(15)).toISOString() });
    expect(res.statusCode).toBe(403);
  });
});

describe("a vote, always", () => {
  it("takes the pick and none of the stake, and pays nothing when it settles", async () => {
    const created = await ask({ symbol: "SOL-USD", above: 150, at: new Date(minutesOut(15)).toISOString() }, { voteOnly: false });
    const gameId = created.json().data.game.id;
    state.caller = "viewer";
    const entered = await app.inject({ method: "POST", url: `/v1/games/${gameId}/enter`, payload: { outcome: "a", stakePoints: 500 } });
    expect(entered.statusCode).toBe(200);
    expect(entered.json().data.game.mine).toEqual({ outcome: "a", stakePoints: 0, wonPoints: 0 });
    expect(entered.json().data.pointsBalance).toBe(1_000);
    expect(db.PointsLedger!.rows).toHaveLength(0);

    // Even a row that somehow lost its flag stays a vote.
    const row = db.Game!.rows.find((g) => String(g._id) === gameId)!;
    row.voteOnly = false;
    state.caller = "mod";
    await app.inject({ method: "POST", url: `/v1/games/${gameId}/enter`, payload: { outcome: "b", stakePoints: 500 } });
    expect(db.PointsLedger!.rows).toHaveLength(0);

    // The minute comes and goes; SOL closes above the line.
    const at = (row.oracle as { at: Date }).at.getTime();
    row.status = "locked";
    fetchMock.mockImplementation(async () => candles([[at - MIN, 151.2], [at, 151.4]]));
    await settleMarketQuestions(at + 2 * MIN);
    expect(row.status).toBe("settled");
    expect(db.PointsLedger!.rows).toHaveLength(0);
    expect(db.User!.rows.map((u) => u.pointsBalance)).toEqual([0, 1_000, 1_000]);
  });
});

describe("nobody settles one by hand", () => {
  it("refuses the host, with a clear code", async () => {
    const at = Date.now() - 5 * MIN;
    const g = seedQuestion(at);
    const res = await app.inject({ method: "POST", url: `/v1/games/${g._id}/settle`, payload: { winningOutcome: "a" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("SETTLES_ITSELF");
    expect(g.status).toBe("locked");
  });

  it("refuses anyone else the engine is ever handed to — a moderator, or no one in particular", async () => {
    const g = seedQuestion(Date.now() - 5 * MIN);
    await expect(settleGame(g as never, "a", MOD)).rejects.toThrow("SETTLES_ITSELF");
    await expect(settleGame(g as never, "b")).rejects.toThrow("SETTLES_ITSELF");
    expect(g.status).toBe("locked");
  });

  it("still lets the host call one off", async () => {
    const g = seedQuestion(Date.now() + 10 * MIN, { status: "open" });
    const res = await app.inject({ method: "POST", url: `/v1/games/${g._id}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(g.status).toBe("cancelled");
  });
});

describe("the sweep settles it from the market", () => {
  const AT = Date.parse("2026-09-27T19:30:00Z");

  it("reads the last trade before the minute — the close of the candle that ends on it: Yes above the line", async () => {
    const g = seedQuestion(AT);
    fetchMock.mockImplementation(async () => candles([[AT - 2 * MIN, 149.1], [AT - MIN, 151.2], [AT, 149.8]]));

    await expect(settleMarketQuestions(AT + 2 * MIN)).resolves.toBe(1);

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/products/SOL-USD/candles?granularity=60");
    expect(url).toContain(`start=${new Date(AT - 11 * MIN).toISOString()}`);
    expect(g.status).toBe("settled");
    expect(g.winningOutcome).toBe("a");
    expect(g.oracle.price).toBe(151.2);
    expect(state.sent.at(-1)).toMatchObject({ __evt: "game", game: { status: "settled", oracle: { price: 151.2 } } });
    expect(db.AuditLog!.rows[0]).toMatchObject({ action: "game.market_settle", meta: { symbol: "SOL-USD", price: 151.2 } });
  });

  it("says No when the price closed on the line or under it", async () => {
    const g = seedQuestion(AT);
    fetchMock.mockImplementation(async () => candles([[AT - MIN, 150], [AT, 152]]));
    await settleMarketQuestions(AT + 2 * MIN);
    expect(g.winningOutcome).toBe("b");
  });

  it("uses the last trade before a minute nobody traded in, once a later minute has one", async () => {
    const g = seedQuestion(AT);
    fetchMock.mockImplementation(async () => candles([[AT - 3 * MIN, 150.4], [AT, 149]]));
    await settleMarketQuestions(AT + 2 * MIN);
    expect(g.oracle.price).toBe(150.4);
    expect(g.winningOutcome).toBe("a");
  });

  it("leaves it until the minute is over and Coinbase has had a moment", async () => {
    const g = seedQuestion(AT);
    await settleMarketQuestions(AT + 20_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(priceAt("SOL-USD", AT, AT - 30_000)).resolves.toBeNull();
    expect(g.status).toBe("locked");
  });

  it("asks again while the candle isn't out, then calls it off with the reason half an hour on", async () => {
    const g = seedQuestion(AT);
    fetchMock.mockImplementation(async () => candles([[AT - 2 * MIN, 149.9]]));

    await settleMarketQuestions(AT + 2 * MIN);
    expect(g.status).toBe("locked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Not every second: every quarter of a minute.
    await settleMarketQuestions(AT + 2 * MIN + 5_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await settleMarketQuestions(AT + 2 * MIN + 16_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A feed that errors is a price not in yet.
    fetchMock.mockImplementation(async () => {
      throw new Error("upstream down");
    });
    await settleMarketQuestions(AT + 10 * MIN);
    expect(g.status).toBe("locked");

    await expect(settleMarketQuestions(AT + 30 * MIN)).resolves.toBe(1);
    expect(g.status).toBe("cancelled");
    expect(g.oracle.failed).toBe("Coinbase never gave SOL's price for that minute");
    expect(state.sent.at(-1)).toMatchObject({ __evt: "game", game: { status: "cancelled", oracle: { failed: expect.any(String) } } });
    expect(db.AuditLog!.rows.at(-1)).toMatchObject({ action: "game.market_called_off" });
    // The room still reads why, for a couple of minutes.
    expect((await currentGameForStream(streamId))?._id).toEqual(g._id);
  });

  it("settles late when the feed comes back inside the half hour", async () => {
    const g = seedQuestion(AT);
    fetchMock.mockImplementation(async () => new Response("{}", { status: 503 }));
    await settleMarketQuestions(AT + 2 * MIN);
    expect(g.status).toBe("locked");
    fetchMock.mockImplementation(async () => candles([[AT - MIN, 148.75], [AT, 150]]));
    await settleMarketQuestions(AT + 12 * MIN);
    expect(g.status).toBe("settled");
    expect(g.oracle.price).toBe(148.75);
    expect(g.winningOutcome).toBe("b");
  });
});
