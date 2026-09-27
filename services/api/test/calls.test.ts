import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { MAX_CALLS_PER_DAY, sceneBodySchema } from "@xtreme/contracts";

/**
 * Call receipts: a call's price and time are the API's own, from a fresh
 * Coinbase quote — never the client's; a channel makes twenty a day and
 * each market once every ten minutes, never on a practice run; nobody can
 * edit or delete one; a call card on the scene is drawn from the record of
 * a call made on that stream, so a forged one goes nowhere; the sweep fills
 * 1 h, 24 h and 7 d from the close of that minute's candle, and gives up on
 * one six hours past due; and a channel's record lists newest first with
 * its summary. Behind a switch that's off unless turned on — as here.
 */

const state = vi.hoisted(() => ({
  caller: "host",
  events: [] as Array<Record<string, unknown>>,
  audits: [] as Array<{ action: string; meta: Record<string, unknown> }>,
  quotes: {} as Record<string, number>,
  /** Candle closes by market, then by the minute's start (ms). */
  candles: {} as Record<string, Record<number, number>>,
  fetches: [] as string[],
  feedDown: false,
  /** Closes the next candle reads see instead, one per read — what a second instance reading a moment later might get. */
  closeQueue: [] as number[],
}));

const oid = () => new mongoose.Types.ObjectId();
const HOST = oid();
const PRODUCER = oid();
const MOD = oid();
const ADMIN = oid();
const OTHER_HOST = oid();
const USERS: Record<string, { _id: mongoose.Types.ObjectId; username: string }> = {
  host: { _id: HOST, username: "adak" },
  producer: { _id: PRODUCER, username: "tolu" },
  mod: { _id: MOD, username: "kemi" },
  admin: { _id: ADMIN, username: "amaraobi" },
  other: { _id: OTHER_HOST, username: "suyasam" },
};

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
    Call: new FakeModel("Call", [{ keys: ["streamerId", "symbol", "slot"] }]),
    SponsorRun: new FakeModel("SponsorRun"),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: `clerk_${state.caller}`, dbUser: USERS[state.caller] }),
  getOptionalAuthUserId: () => null,
}));
vi.mock("../src/audit.js", () => ({
  audit: async (_actor: unknown, action: string, _type: string, _id: unknown, meta: Record<string, unknown>) => {
    state.audits.push({ action, meta });
  },
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
  sendRoomData: async (_room: string, payload: Record<string, unknown>) => {
    state.events.push(payload);
  },
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Coinbase, as far as calls need it: stats for the quote, one-minute candles for the checks. */
const coinbase = vi.fn(async (input: string | URL) => {
  const url = new URL(String(input));
  state.fetches.push(url.pathname + url.search);
  if (state.feedDown) throw new Error("upstream down");
  const [, , symbol, what] = url.pathname.split("/");
  if (what === "stats") {
    const last = state.quotes[symbol!];
    return last ? new Response(JSON.stringify({ open: String(last), last: String(last) }), { status: 200 }) : new Response("{}", { status: 404 });
  }
  if (what === "candles") {
    const start = Date.parse(url.searchParams.get("start")!);
    const end = Date.parse(url.searchParams.get("end")!);
    const override = state.closeQueue.shift();
    // Like Coinbase, the window's end is inclusive: the next minute's candle can come too.
    const rows = Object.entries(state.candles[symbol!] ?? {})
      .map(([t, close]) => [Number(t) / 1000, close - 1, close + 1, close, override ?? close, 10])
      .filter(([t]) => t! * 1000 >= start && t! * 1000 <= end)
      .sort((a, b) => b[0]! - a[0]!);
    return new Response(JSON.stringify(rows), { status: 200 });
  }
  return new Response("{}", { status: 404 });
});
vi.stubGlobal("fetch", coinbase);

const models = await import("../src/models.js");
type Fake = import("./fake-mongo.js").FakeModel;
const db = models as unknown as Record<string, Fake>;
const { config } = await import("../src/config.js");
const { setKnownMarkets } = await import("../src/market-list.js");
const { clearQuoteCache, clearMarketCache } = await import("../src/routes/market.js");
const calls = await import("../src/calls.js");

const minuteOf = (t: number) => Math.floor(t / MINUTE) * MINUTE;
let streamId: mongoose.Types.ObjectId;

function seedCall(fields: Record<string, unknown> = {}) {
  const at = (fields.at as Date | undefined) ?? new Date(Date.now() - 2 * HOUR);
  delete fields.at;
  return db.Call!.insert({
    streamId,
    streamerId: HOST,
    createdBy: HOST,
    by: "Ada K",
    symbol: "SOL-USD",
    direction: "up",
    note: "",
    entry: { price: 100, at },
    outcomes: { h1: null, h24: null, d7: null },
    nextCheckAt: calls.nextCheckFor(at, null),
    slot: Math.floor(at.getTime() / (10 * MINUTE)),
    hidden: null,
    createdAt: at,
    ...fields,
  });
}

beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  state.caller = "host";
  state.events = [];
  state.audits = [];
  state.fetches = [];
  state.feedDown = false;
  state.closeQueue = [];
  state.quotes = { "SOL-USD": 142.1, "BTC-USD": 67201.5 };
  state.candles = {};
  clearQuoteCache();
  clearMarketCache();
  calls.clearCallSummaries();
  setKnownMarkets(["SOL-USD", "BTC-USD", "ETH-USD", "DOGE-EUR"]);
  const mutable = config as { CALL_RECEIPTS: boolean; ADMIN_USERNAMES: string[] };
  mutable.CALL_RECEIPTS = true;
  mutable.ADMIN_USERNAMES = ["amaraobi"];
  db.User!.insert({ _id: HOST, username: "adak", displayName: "Ada K", safety: { mods: [{ userId: PRODUCER, role: "producer" }, { userId: MOD, role: "mod" }] } });
  db.User!.insert({ _id: OTHER_HOST, username: "suyasam", displayName: "Suya Sam", safety: { mods: [] } });
  db.User!.insert({ _id: ADMIN, username: "amaraobi", displayName: "Amara Obi", safety: { mods: [] } });
  streamId = db.Stream!.insert({ streamerId: HOST, isLive: true, practice: false, livekitRoomName: "room-ada", scene: { layers: [], version: 1 } })._id;
});

describe("making a call", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  // Each from its own address, so the route's rate limit doesn't count the whole file as one person.
  let presses = 0;
  const post = (body: Record<string, unknown>, id: unknown = streamId) =>
    app.inject({ method: "POST", url: `/v1/streams/${id}/calls`, payload: body, remoteAddress: `10.0.0.${++presses % 250}` });

  it("takes the price from Coinbase, fetched fresh — never the client's, nor a strip's cached one", async () => {
    // A strip asked a moment ago, at an older price.
    state.quotes["SOL-USD"] = 139.5;
    await app.inject({ method: "GET", url: "/v1/market/quotes?symbols=SOL-USD" });
    state.quotes["SOL-USD"] = 142.1;

    const before = Date.now();
    const res = await post({ symbol: "sol-usd", direction: "up", note: "Breaking out of the range", price: 1, entry: { price: 1, at: "2020-01-01T00:00:00Z" } });
    expect(res.statusCode).toBe(201);
    const { call, layer } = res.json().data;
    expect(call).toMatchObject({ symbol: "SOL-USD", direction: "up", note: "Breaking out of the range", by: "Ada K", entry: { price: 142.1 } });
    expect(call.outcomes).toEqual({ h1: null, h24: null, d7: null });
    expect(Date.parse(call.entry.at)).toBeGreaterThanOrEqual(before);
    expect(layer).toEqual({ kind: "call", callId: call.id, symbol: "SOL-USD", direction: "up", entryPrice: 142.1, entryAt: call.entry.at, by: "Ada K" });

    const stored = db.Call!.rows[0]!;
    expect(String(stored.createdBy)).toBe(String(HOST));
    expect(stored.nextCheckAt.getTime()).toBe(Date.parse(call.entry.at) + HOUR + 90_000);
    // The strip gets the fresh price too.
    const strip = await app.inject({ method: "GET", url: "/v1/market/quotes?symbols=SOL-USD" });
    expect(strip.json().data.quotes[0].last).toBe(142.1);
  });

  it("is the host's or a producer's to make, not a moderator's", async () => {
    state.caller = "producer";
    const made = await post({ symbol: "BTC-USD", direction: "down" });
    expect(made.statusCode).toBe(201);
    expect(String(db.Call!.rows[0]!.createdBy)).toBe(String(PRODUCER));
    expect(made.json().data.call.by).toBe("Ada K");
    state.caller = "mod";
    expect((await post({ symbol: "SOL-USD", direction: "up" })).json().code).toBe("FORBIDDEN");
  });

  it("refuses off air, on a practice run, and for a market Coinbase doesn't trade in dollars", async () => {
    const ended = db.Stream!.insert({ streamerId: HOST, isLive: false, practice: false, livekitRoomName: "room-old" });
    expect((await post({ symbol: "SOL-USD", direction: "up" }, ended._id)).json().code).toBe("NOT_LIVE");
    const rehearsal = db.Stream!.insert({ streamerId: HOST, isLive: true, practice: true, livekitRoomName: "room-practice" });
    const practice = await post({ symbol: "SOL-USD", direction: "up" }, rehearsal._id);
    expect(practice.statusCode).toBe(409);
    expect(practice.json().code).toBe("PRACTICE_RUN");
    expect((await post({ symbol: "DOGE-EUR", direction: "up" })).json().code).toBe("UNKNOWN_MARKET");
    expect((await post({ symbol: "NOPE-USD", direction: "up" })).json().code).toBe("UNKNOWN_MARKET");
    expect((await post({ symbol: "bitcoin", direction: "up" })).statusCode).toBe(400);
    expect(db.Call!.rows).toHaveLength(0);
  });

  it("keeps links, wallet addresses and pitches out of the note", async () => {
    for (const note of ["join t.me/solpumps", "send to 0x52908400098527886E0F7030069857D2E4169EE7", "guaranteed profits daily"]) {
      const res = await post({ symbol: "SOL-USD", direction: "up", note });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("NOTE_BLOCKED");
    }
    expect((await post({ symbol: "SOL-USD", direction: "up", note: "Holding the $140 floor" })).statusCode).toBe(201);
  });

  it("holds a channel to one call a market every ten minutes, and twenty a day", async () => {
    expect((await post({ symbol: "SOL-USD", direction: "up" })).statusCode).toBe(201);
    const again = await post({ symbol: "SOL-USD", direction: "down" });
    expect(again.statusCode).toBe(429);
    expect(again.json()).toMatchObject({ code: "CALL_TOO_SOON", message: expect.stringContaining("in 10 min") });
    expect((await post({ symbol: "BTC-USD", direction: "up" })).statusCode).toBe(201);

    // Eleven minutes on, the market's open again.
    db.Call!.rows[0]!.createdAt = new Date(Date.now() - 11 * MINUTE);
    db.Call!.rows[0]!.slot -= 2;
    expect((await post({ symbol: "SOL-USD", direction: "down" })).statusCode).toBe(201);

    // A day's worth, across markets and streams: the next is refused.
    db.Call!.reset();
    for (let i = 0; i < MAX_CALLS_PER_DAY; i++) seedCall({ symbol: "ETH-USD", at: new Date(Date.now() - (i + 11) * 20 * MINUTE), slot: i });
    const full = await post({ symbol: "SOL-USD", direction: "up" });
    expect(full.statusCode).toBe(429);
    expect(full.json().code).toBe("CALL_LIMIT");
    // One of them a day old: room for one more.
    db.Call!.rows[0]!.createdAt = new Date(Date.now() - 25 * HOUR);
    expect((await post({ symbol: "SOL-USD", direction: "up" })).statusCode).toBe(201);
  });

  it("refuses the second of two presses racing on the same market", async () => {
    const stream = db.Stream!.rows[0]!;
    const streamer = { username: "adak", displayName: "Ada K" };
    const results = await Promise.allSettled([
      calls.makeCall({ stream: stream as never, streamer, by: HOST, symbol: "SOL-USD", direction: "up" }),
      calls.makeCall({ stream: stream as never, streamer, by: HOST, symbol: "SOL-USD", direction: "down" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CALL_TOO_SOON" });
    expect(db.Call!.rows).toHaveLength(1);
  });

  it("waits for a real price when Coinbase can't be read — the strip's stale one won't do", async () => {
    await app.inject({ method: "GET", url: "/v1/market/quotes?symbols=SOL-USD" });
    state.feedDown = true;
    const res = await post({ symbol: "SOL-USD", direction: "up" });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe("MARKET_UNAVAILABLE");
    expect(db.Call!.rows).toHaveLength(0);
  });

  it("can't be edited or deleted — there's no route for either", async () => {
    const id = (await post({ symbol: "SOL-USD", direction: "up" })).json().data.call.id;
    for (const method of ["PATCH", "PUT", "DELETE"] as const) {
      const res = await app.inject({ method, url: `/v1/calls/${id}`, payload: { direction: "down", entry: { price: 1 } } });
      expect(res.statusCode).toBe(404);
    }
    const stored = db.Call!.rows[0]!;
    expect(stored).toMatchObject({ direction: "up", entry: { price: 142.1 } });
    expect((await app.inject({ method: "DELETE", url: `/v1/streams/${streamId}/calls/${id}` })).statusCode).toBe(404);
  });

  it("is switched off unless turned on: nothing is called, and the record says it's off", async () => {
    const existing = seedCall();
    (config as { CALL_RECEIPTS: boolean }).CALL_RECEIPTS = false;
    const res = await post({ symbol: "SOL-USD", direction: "up" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("CALLS_OFF");
    expect((await app.inject({ method: "GET", url: "/v1/calls/enabled" })).json().data).toEqual({ enabled: false });
    expect((await app.inject({ method: "GET", url: "/v1/users/adak/calls" })).json().data).toEqual({ enabled: false });
    expect((await app.inject({ method: "GET", url: `/v1/calls/${existing._id}` })).json().data).toEqual({ enabled: false });
    expect((await app.inject({ method: "GET", url: "/v1/calls/markets" })).json().data).toEqual({ enabled: false, markets: [] });
    expect(db.Call!.rows).toHaveLength(1);

    (config as { CALL_RECEIPTS: boolean }).CALL_RECEIPTS = true;
    expect((await app.inject({ method: "GET", url: "/v1/calls/enabled" })).json().data).toEqual({ enabled: true });
    expect((await app.inject({ method: "GET", url: "/v1/calls/markets" })).json().data.markets).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
  });
});

describe("the call card on the scene", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const card = (callId: unknown, fields: Record<string, unknown> = {}) => ({ kind: "call", callId: String(callId), ...fields });
  const put = (layers: unknown[]) => app.inject({ method: "PUT", url: `/v1/streams/${streamId}/scene`, payload: { layers } });
  const stored = () => (db.Stream!.rows.find((s) => String(s._id) === String(streamId))!.scene.layers as Array<Record<string, unknown>>);

  it("takes a call layer like any graphic, once", () => {
    const id = oid().toHexString();
    expect(sceneBodySchema.safeParse({ layers: [card(id)] }).success).toBe(true);
    expect(sceneBodySchema.safeParse({ layers: [card(id), card(oid().toHexString())] }).success).toBe(false);
    expect(sceneBodySchema.safeParse({ layers: [card("not-an-id")] }).success).toBe(false);
  });

  it("is drawn from the record, whatever the client sent", async () => {
    const call = seedCall({ by: "Ada K", direction: "up", entry: { price: 142.1, at: new Date("2026-09-26T20:14:00Z") } });
    const res = await put([card(call._id, { symbol: "BTC-USD", direction: "down", entryPrice: 1, by: "Someone else" }), { kind: "banner", text: "SOL talk" }]);
    expect(res.statusCode).toBe(200);
    expect(stored()).toEqual([
      { kind: "call", callId: String(call._id), symbol: "SOL-USD", direction: "up", entryPrice: 142.1, entryAt: "2026-09-26T20:14:00.000Z", by: "Ada K" },
      { kind: "banner", text: "SOL talk" },
    ]);
  });

  it("refuses a forged card: a call that doesn't exist, another stream's, or a hidden one", async () => {
    const otherStream = db.Stream!.insert({ streamerId: OTHER_HOST, isLive: true, livekitRoomName: "room-sam", scene: { layers: [], version: 1 } });
    const theirs = seedCall({ streamId: otherStream._id, streamerId: OTHER_HOST, by: "Suya Sam" });
    const hidden = seedCall({ symbol: "BTC-USD", hidden: { at: new Date(), by: ADMIN, reason: "Pump language" } });
    for (const forged of [card(oid()), card(theirs._id)]) {
      const res = await put([forged]);
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("CALL_NOT_FOUND");
    }
    const refused = await put([card(hidden._id)]);
    expect(refused.statusCode).toBe(410);
    expect(refused.json().code).toBe("CALL_HIDDEN");
    expect(stored()).toEqual([]);
  });

  it("with the switch off, won't go up — and one already up comes down quietly on the next change", async () => {
    const call = seedCall();
    await put([card(call._id)]);
    expect(stored()).toHaveLength(1);
    (config as { CALL_RECEIPTS: boolean }).CALL_RECEIPTS = false;
    const res = await put([card(call._id), { kind: "banner", text: "Back in five" }]);
    expect(res.statusCode).toBe(200);
    expect(stored()).toEqual([{ kind: "banner", text: "Back in five" }]);
    const again = await put([card(call._id)]);
    expect(again.json().code).toBe("CALLS_OFF");
  });

  it("comes off the screen when an admin hides the call, with the reason audited", async () => {
    const call = seedCall();
    await put([card(call._id), { kind: "banner", text: "SOL talk" }]);
    state.caller = "host";
    expect((await app.inject({ method: "POST", url: `/v1/admin/calls/${call._id}/hide`, payload: { reason: "Pump language" } })).statusCode).toBe(403);
    state.caller = "admin";
    const res = await app.inject({ method: "POST", url: `/v1/admin/calls/${call._id}/hide`, payload: { reason: "Pump language" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.hidden.reason).toBe("Pump language");
    expect(stored()).toEqual([{ kind: "banner", text: "SOL talk" }]);
    expect(state.events.at(-1)).toMatchObject({ __evt: "scene" });
    expect(state.audits).toEqual([{ action: "call.hide", meta: expect.objectContaining({ reason: "Pump language", symbol: "SOL-USD" }) }]);
    expect((await app.inject({ method: "POST", url: `/v1/admin/calls/${call._id}/hide`, payload: { reason: "" } })).statusCode).toBe(400);
  });
});

describe("the outcome sweep", () => {
  const T0 = Date.parse("2026-09-20T20:14:25Z");

  it("fills 1 h, 24 h and 7 d from the close of that minute's candle, in turn", async () => {
    const call = seedCall({ at: new Date(T0), entry: { price: 100, at: new Date(T0) } });
    state.candles["SOL-USD"] = {
      [minuteOf(T0 + HOUR)]: 104,
      [minuteOf(T0 + HOUR) + MINUTE]: 90, // the next minute comes back too: not this one
      [minuteOf(T0 + 24 * HOUR)]: 97,
      [minuteOf(T0 + 7 * 24 * HOUR)]: 150,
    };

    // Not due yet: the hour's minute hasn't closed.
    expect(await calls.sweepCalls(T0 + HOUR + 30_000)).toBe(0);
    expect(state.fetches).toHaveLength(0);

    expect(await calls.sweepCalls(T0 + HOUR + 2 * MINUTE)).toBe(1);
    expect(call.outcomes.h1).toEqual({ price: 104, at: new Date(T0 + HOUR), changePct: 4, unavailable: false });
    expect(call.outcomes.h24).toBeNull();
    expect(call.nextCheckAt).toEqual(new Date(T0 + 24 * HOUR + 90_000));
    expect(state.fetches[0]).toContain("/products/SOL-USD/candles?granularity=60&start=2026-09-20T21:14:00.000Z");

    expect(await calls.sweepCalls(T0 + 24 * HOUR + 2 * MINUTE)).toBe(1);
    expect(call.outcomes.h24).toMatchObject({ price: 97, changePct: -3, unavailable: false });
    expect(await calls.sweepCalls(T0 + 7 * 24 * HOUR + 2 * MINUTE)).toBe(1);
    expect(call.outcomes.d7).toMatchObject({ price: 150, changePct: 50 });
    expect(call.nextCheckAt).toBeNull();
    // Done: nothing more to look at.
    expect(await calls.sweepCalls(T0 + 30 * 24 * HOUR)).toBe(0);
  });

  it("tries again while the candle isn't out, and six hours past due marks it unavailable", async () => {
    const call = seedCall({ at: new Date(T0), entry: { price: 100, at: new Date(T0) } });
    const due = T0 + HOUR;
    expect(await calls.sweepCalls(due + 2 * MINUTE)).toBe(0);
    expect(call.outcomes.h1).toBeNull();
    expect(call.nextCheckAt).toEqual(new Date(due + 4 * MINUTE));

    // The feed falls over for a while: still just waiting.
    state.feedDown = true;
    expect(await calls.sweepCalls(due + 3 * HOUR)).toBe(0);
    expect(call.outcomes.h1).toBeNull();

    state.feedDown = false;
    expect(await calls.sweepCalls(due + 6 * HOUR + MINUTE)).toBe(1);
    expect(call.outcomes.h1).toEqual({ price: null, at: new Date(due), changePct: null, unavailable: true });
    expect(call.nextCheckAt).toEqual(new Date(T0 + 24 * HOUR + 90_000));
  });

  it("asks once for a minute two calls share", async () => {
    const a = seedCall({ at: new Date(T0), entry: { price: 100, at: new Date(T0) } });
    // Another channel calling the same market the same minute, the other way.
    const b = seedCall({ at: new Date(T0 + 5_000), streamerId: OTHER_HOST, direction: "down", entry: { price: 100, at: new Date(T0 + 5_000) } });
    state.candles["SOL-USD"] = { [minuteOf(T0 + HOUR)]: 110 };
    expect(await calls.sweepCalls(T0 + HOUR + 2 * MINUTE)).toBe(2);
    expect(state.fetches).toHaveLength(1);
    // The market's move, whichever way it was called.
    expect([a.outcomes.h1.changePct, b.outcomes.h1.changePct]).toEqual([10, 10]);
  });

  it("never writes a checkpoint twice, even when two sweeps read the call at once", async () => {
    const call = seedCall({ at: new Date(T0), entry: { price: 100, at: new Date(T0) } });
    state.candles["SOL-USD"] = { [minuteOf(T0 + HOUR)]: 0 };
    state.closeQueue = [110, 1];
    const [one, two] = await Promise.all([calls.sweepCalls(T0 + HOUR + 2 * MINUTE), calls.sweepCalls(T0 + HOUR + 2 * MINUTE)]);
    expect(state.fetches).toHaveLength(2);
    expect(one + two).toBe(1);
    expect(call.outcomes.h1).toMatchObject({ price: 110, changePct: 10 });
  });

  it("reads a price only from a minute that has closed", async () => {
    state.candles["SOL-USD"] = { [minuteOf(T0)]: 123 };
    expect(await calls.priceAt("SOL-USD", new Date(T0), T0 + 10_000)).toBeNull();
    expect(state.fetches).toHaveLength(0);
    expect(await calls.priceAt("SOL-USD", new Date(T0), T0 + 2 * MINUTE)).toBe(123);
    state.feedDown = true;
    await expect(calls.priceAt("SOL-USD", new Date(T0), T0 + 2 * MINUTE)).rejects.toMatchObject({ code: "MARKET_UNAVAILABLE" });
  });
});

describe("a channel's record", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const done = (changePct: number) => ({ price: 100 + changePct, at: new Date(), changePct, unavailable: false });
  const gone = { price: null, at: new Date(), changePct: null, unavailable: true };

  function seedRecord() {
    const now = Date.now();
    const ago = (h: number) => new Date(now - h * HOUR);
    // Right at 24 h: up +4, down −2. Wrong: up −1. Unavailable, pending, hidden, someone else's.
    const rows = [
      seedCall({ at: ago(200), direction: "up", outcomes: { h1: done(1), h24: done(4), d7: done(9) } }),
      seedCall({ at: ago(100), direction: "down", symbol: "BTC-USD", outcomes: { h1: done(-1), h24: done(-2), d7: null } }),
      seedCall({ at: ago(50), direction: "up", outcomes: { h1: done(2), h24: done(-1), d7: null } }),
      seedCall({ at: ago(30), direction: "up", symbol: "ETH-USD", outcomes: { h1: done(0), h24: gone, d7: null } }),
      seedCall({ at: ago(2), direction: "down", note: "Top's in", outcomes: { h1: done(-0.5), h24: null, d7: null } }),
    ];
    seedCall({ at: ago(60), direction: "up", symbol: "BTC-USD", outcomes: { h1: done(-9), h24: done(-20), d7: null }, hidden: { at: ago(59), by: ADMIN, reason: "Pump language" } });
    seedCall({ at: ago(5), streamerId: OTHER_HOST, by: "Suya Sam" });
    return rows;
  }

  it("lists newest first, a page at a time, with the summary on the first", async () => {
    const rows = seedRecord();
    const first = await app.inject({ method: "GET", url: "/v1/users/adak/calls?limit=2" });
    expect(first.statusCode).toBe(200);
    const page = first.json().data;
    expect(page.enabled).toBe(true);
    expect(page.calls.map((c: { id: string }) => c.id)).toEqual([String(rows[4]!._id), String(rows[3]!._id)]);
    expect(page.calls[0]).toMatchObject({ note: "Top's in", direction: "down", outcomes: { h1: { changePct: -0.5, unavailable: false }, h24: null, d7: null } });
    expect(page.calls[1].outcomes.h24).toMatchObject({ price: null, changePct: null, unavailable: true });
    expect(page.summary).toEqual({ total: 5, checked24h: 3, right24h: 2, rightShare24h: 0.6667, avgMove24hPct: 1.67, hidden: 1 });

    const rest = (await app.inject({ method: "GET", url: `/v1/users/adak/calls?limit=2&cursor=${encodeURIComponent(page.next)}` })).json().data;
    expect(rest.calls.map((c: { id: string }) => c.id)).toEqual([String(rows[2]!._id), String(rows[1]!._id)]);
    expect(rest.summary).toBeNull();
    const last = (await app.inject({ method: "GET", url: `/v1/users/adak/calls?limit=2&cursor=${encodeURIComponent(rest.next)}` })).json().data;
    expect(last.calls.map((c: { id: string }) => c.id)).toEqual([String(rows[0]!._id)]);
    expect(last.next).toBeNull();
  });

  it("says so when a channel has no calls, or there's no such channel", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/users/suyasam/calls" })).json().data).toEqual({
      enabled: true,
      calls: [],
      next: null,
      summary: { total: 0, checked24h: 0, right24h: 0, rightShare24h: null, avgMove24hPct: null, hidden: 0 },
    });
    expect((await app.inject({ method: "GET", url: "/v1/users/nobody_here/calls" })).statusCode).toBe(404);
  });

  it("shows one call on its own, and says when one was hidden", async () => {
    const call = seedCall({ note: "Holding the floor" });
    const one = await app.inject({ method: "GET", url: `/v1/calls/${call._id}` });
    expect(one.json().data.call).toMatchObject({ id: String(call._id), symbol: "SOL-USD", note: "Holding the floor", entry: { price: 100 } });
    state.caller = "admin";
    await app.inject({ method: "POST", url: `/v1/admin/calls/${call._id}/hide`, payload: { reason: "Pump language" } });
    const hidden = await app.inject({ method: "GET", url: `/v1/calls/${call._id}` });
    expect(hidden.statusCode).toBe(410);
    expect(hidden.json().code).toBe("CALL_HIDDEN");
    expect((await app.inject({ method: "GET", url: "/v1/users/adak/calls" })).json().data).toMatchObject({ calls: [], summary: { total: 0, hidden: 1 } });

    await app.inject({ method: "POST", url: `/v1/admin/calls/${call._id}/unhide`, payload: { reason: "Reviewed: fine" } });
    expect((await app.inject({ method: "GET", url: `/v1/calls/${call._id}` })).statusCode).toBe(200);
    expect(state.audits.map((a) => a.action)).toEqual(["call.hide", "call.unhide"]);
    expect((await app.inject({ method: "GET", url: `/v1/calls/${oid()}` })).statusCode).toBe(404);
  });
});

describe("the record's shape", () => {
  it("can't be rewritten: what was called, the price and the time are immutable", async () => {
    const actual = await vi.importActual<typeof import("../src/models.js")>("../src/models.js");
    const schema = actual.Call.schema;
    for (const path of ["streamId", "streamerId", "createdBy", "by", "symbol", "direction", "note", "entry.price", "entry.at", "slot"]) {
      expect(schema.path(path)?.options.immutable, path).toBe(true);
    }
    // The checkpoints and the moderators' flag are the only things written later.
    for (const path of ["nextCheckAt", "hidden"]) expect(schema.path(path)?.options.immutable, path).toBeFalsy();
  });

  it("summarises only what was checked at 24 hours", () => {
    const at = new Date();
    expect(
      calls.summarize([
        { direction: "down", outcomes: { h1: null, h24: { price: 90, at, changePct: -10, unavailable: false }, d7: null }, hidden: null },
        { direction: "up", outcomes: { h1: null, h24: { price: 100, at, changePct: 0, unavailable: false }, d7: null }, hidden: null },
        { direction: "up", outcomes: { h1: null, h24: null, d7: null }, hidden: null },
      ]),
    ).toEqual({ total: 3, checked24h: 2, right24h: 1, rightShare24h: 0.5, avgMove24hPct: 5, hidden: 0 });
  });
});
