import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MarketQuote } from "@xtreme/contracts";

/**
 * The market as director (Phase 4): the moves a trading host would call
 * out — a quick move past the market's bar, a round number crossed, a new
 * high or low for the stream — found over each market's recent prices,
 * throttled (one per market per stream in ten minutes, one per stream in
 * two), and told only to the host and their consoles of the streams that
 * watch that market.
 */

const state = vi.hoisted(() => ({ caller: "host", sent: [] as Array<{ room: string; to: string[]; data: Record<string, unknown> }> }));
const HOST = new mongoose.Types.ObjectId();
const PRODUCER = new mongoose.Types.ObjectId();
const MOD = new mongoose.Types.ObjectId();
const OTHER_HOST = new mongoose.Types.ObjectId();
const who = () => (state.caller === "host" ? HOST : state.caller === "producer" ? PRODUCER : MOD);

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return { Stream: new FakeModel("Stream"), User: new FakeModel("User") };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: who(), username: state.caller } }),
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
  sendRoomData: async () => {},
  sendRoomDataTo: async (room: string, to: string[], data: Record<string, unknown>) => {
    state.sent.push({ room, to, data });
  },
  closeRoom: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const {
  EXTREME_AFTER_MS,
  SYMBOL_GAP_MS,
  STREAM_GAP_MS,
  buildSuggestion,
  clearMarketAlerts,
  detectCross,
  detectExtreme,
  detectMove,
  interestOf,
  newThrottle,
  noteSuggested,
  rankCandidates,
  suggestionsFor,
  sweepMarketAlerts,
  throttleAllows,
} = await import("../src/market-alerts.js");
const { clearTickers, noteTickers } = await import("../src/tickers.js");
const { consoleIdentities } = await import("../src/safety/roles.js");
const { setKnownMarkets } = await import("../src/market-list.js");
const { clearQuoteCache } = await import("../src/routes/market.js");

const MIN = 60_000;
const NOW = Date.parse("2026-09-27T19:00:00Z");
/** Prices every half minute, ending at `now`. */
const series = (prices: number[], now = NOW) => prices.map((p, i) => ({ t: now - (prices.length - 1 - i) * 30_000, p }));

describe("a quick move", () => {
  it("holds BTC and ETH to half a per cent in five minutes, and other coins to more", () => {
    expect(detectMove(series([84_000, 84_100, 84_520]), "BTC-USD", NOW)).toEqual({ windowMin: 5, changePct: 0.62 });
    expect(detectMove(series([84_000, 84_300]), "BTC-USD", NOW)).toBeNull();
    // 0.9% is noise for SOL.
    expect(detectMove(series([120, 121.08]), "SOL-USD", NOW)).toBeNull();
    expect(detectMove(series([120, 121.5]), "SOL-USD", NOW)).toEqual({ windowMin: 5, changePct: 1.25 });
  });

  it("looks back fifteen minutes when five show nothing, and reads a fall as a fall", () => {
    // 3.4% over 15 minutes, never more than 1.2% in any five.
    const climb = Array.from({ length: 31 }, (_, i) => 121 + (i * 4.114) / 30);
    const move = detectMove(series(climb), "SOL-USD", NOW);
    expect(move?.windowMin).toBe(15);
    expect(move?.changePct).toBeCloseTo(3.4, 1);
    expect(detectMove(series([2_700, 2_690, 2_680]), "ETH-USD", NOW)).toEqual({ windowMin: 5, changePct: -0.74 });
  });

  it("measures from the window's low, not its first price", () => {
    expect(detectMove(series([121, 119.5, 119.2, 121.1]), "SOL-USD", NOW)?.changePct).toBeCloseTo(1.59, 2);
  });

  it("tells a move once: prices up to the last suggestion don't start another", () => {
    const pts = series([120, 120.2, 121.6]);
    expect(detectMove(pts, "SOL-USD", NOW, pts[1]!.t)).toBeNull();
  });

  it("decides nothing on a price the feed hasn't refreshed", () => {
    expect(detectMove(series([84_000, 85_000], NOW - 2 * MIN), "BTC-USD", NOW)).toBeNull();
  });
});

describe("a round number crossed", () => {
  it("sees SOL come through $130, and BTC fall through $85,000", () => {
    expect(detectCross(series([129.2, 129.6, 130.6]), NOW)).toEqual({ level: 130, direction: "up" });
    expect(detectCross(series([85_200, 84_990, 84_920]), NOW)).toEqual({ level: 85_000, direction: "down" });
  });

  it("wants the price clearly on each side of it", () => {
    // $130.30 is inside the margin (a twentieth of a $10 step)…
    expect(detectCross(series([129.2, 130.3]), NOW)).toBeNull();
    // …and a poke $20 over $85,000 and back isn't having been above it.
    expect(detectCross(series([84_900, 85_020, 84_930, 84_880]), NOW)).toBeNull();
  });

  it("leaves a stablecoin on its dollar alone", () => {
    expect(detectCross(series([0.9999, 1.0001, 0.9998, 1.0002]), NOW)).toBeNull();
  });

  it("only counts the last five minutes", () => {
    const pts = [{ t: NOW - 6 * MIN, p: 129 }, ...series([130.7, 130.8])];
    expect(detectCross(pts, NOW)).toBeNull();
  });
});

describe("a new high or low for the stream", () => {
  const range = { hi: 124, lo: 118, open: 120, from: NOW - 40 * MIN };

  it("is the price past the stream's range", () => {
    expect(detectExtreme(range, 124.5, "SOL-USD", NOW)).toBe("high");
    expect(detectExtreme(range, 117.8, "SOL-USD", NOW)).toBe("low");
    expect(detectExtreme(range, 121, "SOL-USD", NOW)).toBeNull();
  });

  it("waits for the stream to have had a range", () => {
    expect(detectExtreme({ ...range, from: NOW - EXTREME_AFTER_MS + 1 }, 125, "SOL-USD", NOW)).toBeNull();
  });

  it("means nothing in a flat market", () => {
    expect(detectExtreme({ hi: 1.0002, lo: 0.9998, open: 1, from: NOW - 60 * MIN }, 1.0003, "USDT-USD", NOW)).toBeNull();
  });
});

describe("the throttle", () => {
  it("allows one per market per stream in ten minutes, and one per stream in two", () => {
    const t = newThrottle();
    expect(throttleAllows(t, "SOL-USD", NOW)).toBe(true);
    noteSuggested(t, "SOL-USD", NOW);
    expect(throttleAllows(t, "BTC-USD", NOW + STREAM_GAP_MS - 1)).toBe(false);
    expect(throttleAllows(t, "BTC-USD", NOW + STREAM_GAP_MS)).toBe(true);
    expect(throttleAllows(t, "SOL-USD", NOW + SYMBOL_GAP_MS - 1)).toBe(false);
    expect(throttleAllows(t, "SOL-USD", NOW + SYMBOL_GAP_MS)).toBe(true);
  });
});

describe("what a show cares about, and what it's told", () => {
  it("is its chart's market, its price strip's, and chat's top three", () => {
    const scene = { chart: { symbol: "SOL-USD" }, layers: [{ kind: "banner", text: "hi" }, { kind: "prices", symbols: ["BTC-USD", "SOL-USD", "nope"] }] };
    const trending = [{ symbol: "DOGE-USD" }, { symbol: "ETH-USD" }, { symbol: "PEPE-USD" }, { symbol: "ADA-USD" }];
    expect(interestOf(scene, trending)).toEqual(["SOL-USD", "BTC-USD", "DOGE-USD", "ETH-USD", "PEPE-USD"]);
    expect(interestOf(null, [])).toEqual([]);
  });

  it("puts a move ahead of a round number, and a round number ahead of a high", () => {
    const base = { symbol: "SOL-USD", price: 130.6, windowMin: 5, cross: null };
    const ranked = rankCandidates([
      { ...base, kind: "high", changePct: 4 },
      { ...base, kind: "round", changePct: 1 },
      { ...base, kind: "move", changePct: 1.3 },
      { ...base, kind: "move", changePct: -2.5 },
    ]);
    expect(ranked.map((c) => `${c.kind}:${c.changePct}`)).toEqual(["move:-2.5", "move:1.3", "round:1", "high:4"]);
  });

  it("words each kind, with a banner line and a question to go with it", () => {
    const move = buildSuggestion({ kind: "move", symbol: "SOL-USD", price: 125.4, changePct: 3.4, windowMin: 15, cross: null }, NOW);
    expect(move).toMatchObject({
      kind: "move",
      text: "SOL +3.4% in 15 min",
      level: null,
      at: new Date(NOW).toISOString(),
      actions: {
        chart: { symbol: "SOL-USD", interval: "1m" },
        banner: "SOL up 3.4% in the last 15 minutes · Not financial advice",
        question: { symbol: "SOL-USD", above: 130, minutes: 15 },
      },
    });
    const fall = buildSuggestion({ kind: "move", symbol: "ETH-USD", price: 2_680, changePct: -0.74, windowMin: 5, cross: null }, NOW);
    expect(fall.text).toBe("ETH −0.7% in 5 min");
    const cross = buildSuggestion({ kind: "round", symbol: "BTC-USD", price: 84_880, changePct: -0.4, windowMin: 5, cross: { level: 85_000, direction: "down" } }, NOW);
    expect(cross).toMatchObject({ text: "BTC fell below $85,000", level: 85_000, actions: { banner: "BTC slips below $85,000 · Not financial advice", question: { above: 85_000 } } });
    const high = buildSuggestion({ kind: "high", symbol: "SOL-USD", price: 124.5, changePct: 3.75, windowMin: 40, cross: null }, NOW);
    expect(high).toMatchObject({ text: "SOL at the stream's high", actions: { chart: { interval: "5m" }, question: { above: 120 } } });
    // No question on a market a question can't settle on.
    expect(buildSuggestion({ kind: "move", symbol: "ETH-BTC", price: 0.032, changePct: 2, windowMin: 5, cross: null }, NOW).actions.question).toBeNull();
    expect(move.id).not.toBe(fall.id);
  });
});

describe("the sweep", () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn();
  let a: Record<string, unknown>;
  let b: Record<string, unknown>;
  const prices: Record<string, number> = {};
  const reads: string[] = [];
  const quote = async (symbol: string): Promise<MarketQuote | null> => {
    reads.push(symbol);
    return prices[symbol] ? { symbol, last: prices[symbol]!, changePct: 0 } : null;
  };
  const noCandles = async () => {
    throw new Error("no candles");
  };
  const suggestionsTo = (room: string) => state.sent.filter((s) => s.room === room && s.data.__evt === "suggestion");

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
    clearMarketAlerts();
    clearTickers();
    clearQuoteCache();
    setKnownMarkets(["SOL-USD", "BTC-USD", "ETH-USD", "DOGE-USD"]);
    state.sent = [];
    state.caller = "host";
    reads.length = 0;
    Object.assign(prices, { "SOL-USD": 120, "BTC-USD": 84_000, "ETH-USD": 2_700, "DOGE-USD": 0.0967 });
    db.User!.insert({ _id: HOST, username: "amara", safety: { mods: [{ userId: PRODUCER, role: "producer" }, { userId: MOD, role: "mod" }] } });
    db.User!.insert({ _id: OTHER_HOST, username: "suya_sam", safety: { mods: [] } });
    // Amara charts SOL; Suya Sam runs a strip of BTC and ETH, and chat's naming $DOGE; a stream that ended watches SOL too.
    a = db.Stream!.insert({
      streamerId: HOST,
      isLive: true,
      livekitRoomName: "room-a",
      startedAt: new Date(NOW - 10 * MIN),
      scene: { layout: "chart-face", chart: { symbol: "SOL-USD", interval: "5m" }, layers: [] },
    });
    b = db.Stream!.insert({
      streamerId: OTHER_HOST,
      isLive: true,
      practice: true,
      livekitRoomName: "room-b",
      startedAt: new Date(NOW - 10 * MIN),
      scene: { layout: "solo", chart: null, layers: [{ kind: "prices", symbols: ["BTC-USD", "ETH-USD"] }] },
    });
    db.Stream!.insert({ streamerId: HOST, isLive: false, livekitRoomName: "room-old", scene: { chart: { symbol: "SOL-USD" }, layers: [] } });
  });

  it("reads each market once, and tells a move only to the stream watching it — host and consoles", async () => {
    await noteTickers({ _id: b._id as mongoose.Types.ObjectId, streamerId: OTHER_HOST, livekitRoomName: "room-b" }, null, "$doge to a dollar", NOW - 60_000);
    await sweepMarketAlerts(NOW - 30_000, { quote, candles: noCandles });
    expect(reads.sort()).toEqual(["BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD"]);

    prices["SOL-USD"] = 121.8; // +1.5% in half a minute
    await expect(sweepMarketAlerts(NOW, { quote, candles: noCandles })).resolves.toBe(1);
    const told = suggestionsTo("room-a");
    expect(told).toHaveLength(1);
    // The host's studio and every console that could be open on the channel — as chat's tickers go.
    expect(told[0]!.to).toEqual([String(HOST), ...consoleIdentities(db.User!.rows[0] as never)]);
    expect(told[0]!.to).toContain(`prod-${PRODUCER}`);
    expect(told[0]!.to).not.toContain(String(MOD));
    expect(told[0]!.data.suggestion).toMatchObject({ kind: "move", symbol: "SOL-USD", text: "SOL +1.5% in 5 min", price: 121.8 });
    expect(suggestionsTo("room-b")).toHaveLength(0);
    expect(suggestionsTo("room-old")).toHaveLength(0);
  });

  it("tells a practice run too, on the real market", async () => {
    await sweepMarketAlerts(NOW - 30_000, { quote, candles: noCandles });
    prices["BTC-USD"] = 84_600;
    await sweepMarketAlerts(NOW, { quote, candles: noCandles });
    expect(suggestionsTo("room-b")[0]!.data.suggestion).toMatchObject({ kind: "move", symbol: "BTC-USD", actions: { question: { above: 85_000 } } });
    expect(suggestionsTo("room-b")[0]!.to).toEqual([String(OTHER_HOST), `prod-${OTHER_HOST}`]);
  });

  it("keeps to one per market per stream in ten minutes, and one per stream in two", async () => {
    // Suya Sam's BTC and ETH both jump; only one goes out, the other waits its turn.
    await sweepMarketAlerts(NOW - 30_000, { quote, candles: noCandles });
    prices["BTC-USD"] = 84_600;
    prices["ETH-USD"] = 2_740;
    await sweepMarketAlerts(NOW, { quote, candles: noCandles });
    expect(suggestionsTo("room-b").map((s) => (s.data.suggestion as { symbol: string }).symbol)).toEqual(["ETH-USD"]);

    prices["ETH-USD"] = 2_790; // still going, but ETH was just told
    await sweepMarketAlerts(NOW + 30_000, { quote, candles: noCandles });
    await sweepMarketAlerts(NOW + STREAM_GAP_MS - 30_000, { quote, candles: noCandles });
    expect(suggestionsTo("room-b")).toHaveLength(1);
    // Two minutes on, BTC's move (still inside its five minutes) has its turn.
    await sweepMarketAlerts(NOW + STREAM_GAP_MS, { quote, candles: noCandles });
    expect(suggestionsTo("room-b").map((s) => (s.data.suggestion as { symbol: string }).symbol)).toEqual(["ETH-USD", "BTC-USD"]);
  });

  it("finds the stream's high from the candles since it started", async () => {
    await db.Stream!.updateOne({ _id: a._id }, { $set: { startedAt: new Date(NOW - 45 * MIN) } });
    const candles = async () => ({
      candles: [
        { t: NOW - 50 * MIN, o: 110, h: 130, l: 109, c: 111 }, // before the stream: not its range
        { t: NOW - 45 * MIN, o: 120, h: 121, l: 119, c: 120.5 },
        { t: NOW - 40 * MIN, o: 120.5, h: 122, l: 118.5, c: 121 },
        { t: NOW - 20 * MIN, o: 121, h: 124, l: 120, c: 123 },
      ],
    });
    prices["SOL-USD"] = 123.5;
    await sweepMarketAlerts(NOW - 30_000, { quote, candles });
    prices["SOL-USD"] = 124.4; // +0.7%: no move, no round number — but past the stream's high
    await sweepMarketAlerts(NOW, { quote, candles });
    expect(suggestionsTo("room-a")[0]!.data.suggestion).toMatchObject({ kind: "high", text: "SOL at the stream's high", windowMin: 45 });
  });

  it("reads through the shared quote cache: one upstream call per market however many streams", async () => {
    await db.Stream!.updateOne({ _id: a._id }, { $set: { scene: { chart: { symbol: "BTC-USD" }, layers: [] } } });
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      new Response(JSON.stringify({ open: "84000", last: url.includes("BTC-USD") ? "84100" : "2700" }), { status: 200 }),
    );
    await sweepMarketAlerts(NOW);
    const calls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(calls.filter((u) => u.includes("/products/BTC-USD/stats"))).toHaveLength(1);
    expect(calls.filter((u) => u.includes("/products/ETH-USD/stats"))).toHaveLength(1);
  });

  it("hands a reloaded studio the last few — the host and producers, not moderators", async () => {
    await sweepMarketAlerts(NOW - 30_000, { quote, candles: noCandles });
    prices["SOL-USD"] = 121.8;
    await sweepMarketAlerts(NOW, { quote, candles: noCandles });
    expect(suggestionsFor(a._id, NOW)).toHaveLength(1);
    expect(suggestionsFor(a._id, NOW + 31 * MIN)).toHaveLength(0);

    // The route reads the clock itself; the suggestion was noticed "at NOW", long past.
    const live = suggestionsFor(a._id, NOW)[0]!;
    live.at = new Date().toISOString();
    state.caller = "producer";
    const res = await app.inject({ method: "GET", url: `/v1/streams/${a._id}/suggestions` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.suggestions).toEqual([expect.objectContaining({ id: live.id, symbol: "SOL-USD" })]);
    state.caller = "mod";
    expect((await app.inject({ method: "GET", url: `/v1/streams/${a._id}/suggestions` })).statusCode).toBe(403);
  });

  it("forgets a stream once it's off air", async () => {
    await sweepMarketAlerts(NOW - 30_000, { quote, candles: noCandles });
    prices["SOL-USD"] = 121.8;
    await sweepMarketAlerts(NOW, { quote, candles: noCandles });
    await db.Stream!.updateOne({ _id: a._id }, { $set: { isLive: false } });
    await sweepMarketAlerts(NOW + 30_000, { quote, candles: noCandles });
    expect(suggestionsFor(a._id, NOW + 30_000)).toEqual([]);
  });

  it("lists the markets a question can be asked about", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/market/known" });
    expect(res.json().data.symbols).toEqual(["BTC-USD", "DOGE-USD", "ETH-USD", "SOL-USD"]);
  });
});
