import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Market candles for Chart + face: normalised oldest-first, shared through
 * a 15-second cache (one upstream call however many viewers ask), unknown
 * markets as 404, and a stale chart kept through a brief upstream blip.
 */

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "x", dbUser: { _id: "a".repeat(24) } }),
  getOptionalAuthUserId: () => null,
}));

// Coinbase's shape: newest first, [time, low, high, open, close, volume].
const ROWS = [
  [1_700_000_600, 101, 106, 104, 105, 3],
  [1_700_000_300, 99, 105, 100, 104, 2],
  [1_700_000_000, 95, 101, 100, 100, 1],
];

const fetchMock = vi.fn();

describe("market candles", () => {
  let app: FastifyInstance;
  let market: typeof import("../src/routes/market.js");

  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    market = await import("../src/routes/market.js");
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app.close();
  });

  beforeEach(() => {
    market.clearMarketCache();
    fetchMock.mockReset();
    // A fresh body per call: a Response can only be read once.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(ROWS), { status: 200 }));
  });

  it("turns the feed into oldest-first candles with the last price and the move", async () => {
    const view = await market.getMarket("BTC-USD", "5m");

    expect(view.candles.map((c) => c.t)).toEqual([1_700_000_000_000, 1_700_000_300_000, 1_700_000_600_000]);
    expect(view.candles[2]).toEqual({ t: 1_700_000_600_000, o: 104, h: 106, l: 101, c: 105, v: 3 });
    expect(view.last).toBe(105);
    expect(view.changePct).toBeCloseTo(5);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=300");
  });

  it("asks upstream once however many viewers ask, fresh or at the same moment", async () => {
    await Promise.all([market.getMarket("ETH-USD", "1m"), market.getMarket("ETH-USD", "1m"), market.getMarket("ETH-USD", "1m")]);
    await market.getMarket("ETH-USD", "1m");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different interval is a different chart.
    await market.getMarket("ETH-USD", "1h");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a stale chart through a brief upstream blip", async () => {
    const first = await market.getMarket("SOL-USD", "5m");
    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));

    const later = await market.getMarket("SOL-USD", "5m", Date.now() + 20_000);
    expect(later).toBe(first);
  });

  it("answers 404 for a market that doesn't exist and 400 for one that isn't a market", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: "NotFound" }), { status: 404 }));
    const unknown = await app.inject({ method: "GET", url: "/v1/market/candles?symbol=zzz-usd&interval=5m" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().code).toBe("UNKNOWN_MARKET");

    const bad = await app.inject({ method: "GET", url: "/v1/market/candles?symbol=bitcoin" });
    expect(bad.statusCode).toBe(400);
  });

  it("serves the route with a short public cache", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/market/candles?symbol=btc-usd" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ symbol: "BTC-USD", interval: "5m", source: "Coinbase" });
    expect(response.headers["cache-control"]).toBe("public, max-age=10");
  });
});
