import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The market layer's backend: $cashtags in chat become suggestions only for
 * markets that exist, counted over five minutes and handed to the host's
 * studio and consoles when what's on top changes (no more than every ten
 * seconds); quotes for the price strip are shared, cached, and skip a
 * market that doesn't exist.
 */

const state = vi.hoisted(() => ({ caller: "host", sent: [] as Array<{ to: string[]; data: Record<string, unknown> }> }));
const HOST = new mongoose.Types.ObjectId();
const PRODUCER = new mongoose.Types.ObjectId();
const MOD = new mongoose.Types.ObjectId();
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
  sendRoomDataTo: async (_room: string, to: string[], data: Record<string, unknown>) => {
    state.sent.push({ to, data });
  },
  closeRoom: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { cashtags, clearTickers, noteTickers, trendingOf } = await import("../src/tickers.js");
const { setKnownMarkets } = await import("../src/market-list.js");
const { clearQuoteCache } = await import("../src/routes/market.js");

const NOW = Date.parse("2026-09-26T20:00:00Z");
const streamer = { _id: HOST, safety: { mods: [{ userId: PRODUCER, role: "producer" }] } };
let stream: { _id: mongoose.Types.ObjectId; streamerId: mongoose.Types.ObjectId; livekitRoomName: string };

beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  clearTickers();
  clearQuoteCache();
  setKnownMarkets(["SOL-USD", "BTC-USD", "ETH-USD"]);
  state.sent = [];
  state.caller = "host";
  db.User!.insert({ _id: HOST, username: "amara", safety: { mods: [{ userId: PRODUCER, role: "producer" }, { userId: MOD, role: "mod" }] } });
  const s = db.Stream!.insert({ streamerId: HOST, isLive: true, livekitRoomName: "room-1" });
  stream = { _id: s._id, streamerId: HOST, livekitRoomName: "room-1" };
});

describe("cashtags", () => {
  it("reads $tickers as USD markets, and leaves money and words alone", () => {
    expect(cashtags("$sol and $BTC?")).toEqual(["SOL-USD", "BTC-USD"]);
    expect(cashtags("I made $100 on it")).toEqual([]);
    expect(cashtags("price$sol")).toEqual([]);
    expect(cashtags("$a $b1 $c2 $d3 $e4")).toEqual(["B1-USD", "C2-USD", "D3-USD"]);
  });
});

describe("what chat's talking about", () => {
  it("counts markets that exist, and tells the studio and consoles when the top changes", async () => {
    await noteTickers(stream, streamer as never, "$SOL to the moon", NOW);
    await noteTickers(stream, streamer as never, "$doge?", NOW + 1_000);
    expect(trendingOf(stream._id, NOW + 2_000)).toEqual([{ symbol: "SOL-USD", mentions: 1 }]);
    expect(state.sent).toEqual([
      { to: [String(HOST), `prod-${HOST}`, `prod-${PRODUCER}`], data: { __evt: "tickers", tickers: [{ symbol: "SOL-USD", mentions: 1 }] } },
    ]);

    // A change inside ten seconds waits; the next one after says it all.
    await noteTickers(stream, streamer as never, "$sol $btc", NOW + 5_000);
    expect(state.sent).toHaveLength(1);
    await noteTickers(stream, streamer as never, "$eth", NOW + 12_000);
    expect(state.sent.at(-1)!.data.tickers).toEqual([
      { symbol: "SOL-USD", mentions: 2 },
      { symbol: "BTC-USD", mentions: 1 },
      { symbol: "ETH-USD", mentions: 1 },
    ]);
  });

  it("forgets mentions after five minutes", async () => {
    await noteTickers(stream, streamer as never, "$sol", NOW);
    expect(trendingOf(stream._id, NOW + 6 * 60_000)).toEqual([]);
  });
});

describe("the market routes", () => {
  let app: FastifyInstance;
  const fetchMock = vi.fn();
  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllGlobals();
  });

  it("quotes markets from one shared upstream call, skipping one that doesn't exist", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) =>
      url.includes("/products/BTC-USD/stats")
        ? new Response(JSON.stringify({ open: "100", last: "110" }), { status: 200 })
        : new Response("{}", { status: 404 })
    );
    const first = await app.inject({ method: "GET", url: "/v1/market/quotes?symbols=BTC-USD,NOPE-USD" });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.quotes).toEqual([{ symbol: "BTC-USD", last: 110, changePct: 10 }]);
    await app.inject({ method: "GET", url: "/v1/market/quotes?symbols=btc-usd" });
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("BTC-USD")).length).toBe(1);
  });

  it("says which markets couldn't be read, so the strip can say it's paused", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/products/BTC-USD/stats")) return new Response(JSON.stringify({ open: "100", last: "110" }), { status: 200 });
      throw new Error("upstream down");
    });
    const res = await app.inject({ method: "GET", url: "/v1/market/quotes?symbols=BTC-USD,ETH-USD" });
    expect(res.json().data).toMatchObject({ quotes: [{ symbol: "BTC-USD" }], unavailable: ["ETH-USD"] });
  });

  it("lets the host and producers read what chat's talking about, not moderators", async () => {
    await noteTickers(stream, streamer as never, "$eth", Date.now());
    state.caller = "producer";
    const res = await app.inject({ method: "GET", url: `/v1/streams/${stream._id}/tickers` });
    expect(res.json().data.tickers).toEqual([{ symbol: "ETH-USD", mentions: 1 }]);
    state.caller = "mod";
    expect((await app.inject({ method: "GET", url: `/v1/streams/${stream._id}/tickers` })).statusCode).toBe(403);
  });
});
