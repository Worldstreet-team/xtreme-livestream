import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Practice runs: a private rehearsal. The stream is stored as one, nobody
 * is told, nothing is relayed, the live ring stays off, and it is nowhere
 * to be found — not in the live list, not on a channel, not behind its own
 * id for anyone but the host and their producers. Meanwhile the simulated
 * audience sends lines, gifts and likes into the room shaped as the real
 * routes would, the rules and goal bar move, and it all stops with the
 * stream.
 */

const mocks = vi.hoisted(() => ({
  notifyFollowers: vi.fn(async () => {}),
  notifyReminders: vi.fn(async () => {}),
  relay: vi.fn(async () => true),
  fireRules: vi.fn(async () => [] as string[]),
}));
const state = vi.hoisted(() => ({
  caller: "" as "" | "host" | "producer" | "mod" | "stranger" | "other",
  sent: [] as Array<{ room: string; data: Record<string, unknown>; at: number }>,
  sentTo: [] as Array<{ room: string; to: string[]; data: Record<string, unknown> }>,
  tokens: [] as Array<{ room: string; identity: string; options: Record<string, unknown> }>,
}));
const HOST = new mongoose.Types.ObjectId();
const PRODUCER = new mongoose.Types.ObjectId();
const MOD = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();
const ids = { host: HOST, producer: PRODUCER, mod: MOD, stranger: STRANGER, other: OTHER } as const;

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  // The stream routes treat rows as hydrated documents (populate, toJSON)
  // and page the list with skip(): a little more than the fake gives.
  class StreamModel extends FakeModel {
    insert(fields: Record<string, unknown>) {
      const row = super.insert(fields);
      Object.defineProperty(row, "populate", { value: async () => row, enumerable: false });
      Object.defineProperty(row, "toJSON", { value: () => ({ ...row }), enumerable: false });
      return row;
    }
    find(filter?: Record<string, unknown>) {
      const q = super.find(filter);
      return Object.assign(q, { skip: () => q });
    }
  }
  const others = [
    "User", "Follow", "Notification", "StreamReminder", "ChatMessage", "StreamLike", "Report", "GiftTransaction",
    "WatchSession", "SponsorRun", "ShowRule", "Impression", "ViewerSample", "Battle", "StreamBan", "AuditLog",
    "Sponsor", "Campaign", "CampaignMember", "Rundown",
  ];
  return { Stream: new StreamModel("Stream"), ...Object.fromEntries(others.map((n) => [n, new FakeModel(n)])) };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => {
    const { ApiError } = await import("../src/errors.js");
    if (!state.caller) throw new ApiError(401, "Authentication required", "UNAUTHORIZED");
    const { User } = (await import("../src/models.js")) as unknown as { User: { rows: Array<Record<string, unknown>> } };
    const row = User.rows.find((r) => String(r._id) === String(ids[state.caller as keyof typeof ids]));
    return { authUserId: `clerk_${state.caller}`, dbUser: row };
  },
  getOptionalAuthUserId: () => (state.caller ? `clerk_${state.caller}` : null),
}));
vi.mock("../src/livekit.js", () => ({
  roomService: { listParticipants: async () => [] },
  ingressClient: {},
  webhookReceiver: { receive: async () => ({ event: "ignored" }) },
  createToken: async (room: string, identity: string, _name: string, options: Record<string, unknown>) => {
    state.tokens.push({ room, identity, options });
    return "token";
  },
  ensureUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  rotateUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async () => false,
  setParticipantPublishPermission: async () => {},
  setRoomScene: async () => {},
  sendRoomData: async (room: string, data: Record<string, unknown>) => {
    state.sent.push({ room, data, at: Date.now() });
  },
  sendRoomDataTo: async (room: string, to: string[], data: Record<string, unknown>) => {
    state.sentTo.push({ room, to, data });
  },
  closeRoom: async () => {},
}));
vi.mock("../src/notifications.js", () => ({
  notifyFollowersOfLive: mocks.notifyFollowers,
  notifyRemindersOfLive: mocks.notifyReminders,
}));
vi.mock("../src/socials-relay.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/socials-relay.js")>()),
  socialsRelayEnabled: () => true,
  relayLiveEvent: mocks.relay,
}));
vi.mock("../src/rules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rules.js")>()),
  fireRules: mocks.fireRules,
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const {
  PRACTICE_CAST,
  PRACTICE_GIFTS,
  PRACTICE_LINES,
  PRACTICE_MAX_MS,
  PRACTICE_TICK_MAX_MS,
  PRACTICE_TICK_MIN_MS,
  isPracticing,
  practiceUserId,
  startPractice,
  stopAllPractice,
  stopPractice,
} = await import("../src/practice.js");
const { markStreamEnded } = await import("../src/stream-service.js");
const { setKnownMarkets } = await import("../src/market-list.js");
const { clearTickers } = await import("../src/tickers.js");

const NOW = Date.parse("2026-09-26T20:00:00Z");
const HEX24 = /^[a-f\d]{24}$/;

function seedPeople() {
  db.User!.insert({
    _id: HOST,
    username: "amara",
    displayName: "Amara",
    avatar: "",
    isLive: false,
    followers: 1,
    settings: {},
    safety: {
      mods: [
        { userId: PRODUCER, username: "tolu", role: "producer" },
        { userId: MOD, username: "ada", role: "mod" },
      ],
    },
  });
  db.User!.insert({ _id: PRODUCER, username: "tolu", displayName: "Tolu", avatar: "", isLive: false, settings: {} });
  db.User!.insert({ _id: MOD, username: "ada", displayName: "Ada", avatar: "", isLive: false, settings: {} });
  db.User!.insert({ _id: STRANGER, username: "kemi", displayName: "Kemi", avatar: "", isLive: false, settings: {} });
  db.User!.insert({ _id: OTHER, username: "emeka", displayName: "Emeka", avatar: "", isLive: false, settings: {} });
  // An ally of the host: the person a "went live" bell would reach.
  db.Follow!.insert({ followerId: STRANGER, followingId: HOST });
}

/** A practice stream already live, as the create route would have stored it. */
function seedPractice(fields: Record<string, unknown> = {}) {
  return db.Stream!.insert({
    streamerId: HOST,
    title: "Dress rehearsal",
    category: "Bitcoin Trading",
    isLive: true,
    status: "live",
    practice: true,
    livekitRoomName: `practice-${HOST}`,
    startedAt: new Date(),
    viewers: 0,
    peakViewers: 0,
    viewerSeconds: 0,
    viewerSampledAt: null,
    likes: 0,
    guests: [],
    takenDownAt: null,
    notifyFollowers: true,
    postToWorldSpace: true,
    ...fields,
  });
}

beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  state.caller = "";
  state.sent = [];
  state.sentTo = [];
  state.tokens = [];
  mocks.notifyFollowers.mockClear();
  mocks.notifyReminders.mockClear();
  mocks.relay.mockClear();
  mocks.fireRules.mockClear();
  clearTickers();
  setKnownMarkets(["BTC-USD", "SOL-USD", "ETH-USD", "DOGE-USD", "ADA-USD"]);
  seedPeople();
});
afterEach(() => {
  stopAllPractice();
  vi.useRealTimers();
});

describe("a practice run through the routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });
  const goLive = (body: Record<string, unknown> = {}) =>
    call("POST", "/streams", { title: "Dress rehearsal", category: "Bitcoin Trading", notifyFollowers: true, postToWorldSpace: true, ...body });

  it("is stored as one, and starts its audience — with no bell, no WorldSpace post and no live ring", async () => {
    state.caller = "host";
    const res = await goLive({ practice: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stream).toMatchObject({ practice: true, title: "Dress rehearsal" });
    const id = res.json().data.stream.id as string;

    expect(db.Stream!.rows[0]).toMatchObject({ practice: true, isLive: true, status: "live" });
    expect(isPracticing(id)).toBe(true);
    // Whatever the body asked for: nobody hears, nothing posts, the ring stays off.
    expect(mocks.notifyFollowers).not.toHaveBeenCalled();
    expect(mocks.relay).not.toHaveBeenCalled();
    expect(db.Notification!.rows).toEqual([]);
    expect(db.User!.rows[0]!.isLive).toBe(false);
  });

  it("…where a real broadcast does all three (the checks above are not vacuous)", async () => {
    state.caller = "host";
    const res = await goLive();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stream.practice).toBe(false);
    expect(mocks.notifyFollowers).toHaveBeenCalledTimes(1);
    expect(mocks.relay).toHaveBeenCalledWith("started", expect.objectContaining({ practice: false }));
    expect(db.User!.rows[0]!.isLive).toBe(true);
    expect(isPracticing(res.json().data.stream.id)).toBe(false);
  });

  it("never starts a booking: the scheduled card stays up for the real broadcast", async () => {
    const booking = db.Stream!.insert({
      streamerId: HOST,
      title: "Friday desk",
      category: "Bitcoin Trading",
      isLive: false,
      status: "upcoming",
      scheduledStartAt: new Date(Date.now() + 3_600_000),
      startedAt: new Date(Date.now() + 3_600_000),
      livekitRoomName: `upcoming-${HOST}`,
    });
    state.caller = "host";
    const res = await goLive({ practice: true, scheduledStreamId: String(booking._id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stream.id).not.toBe(String(booking._id));
    expect(booking).toMatchObject({ status: "upcoming", isLive: false });
    expect(booking.practice).toBeUndefined();
    expect(mocks.notifyReminders).not.toHaveBeenCalled();
  });

  it("is in no public list: not the live list, not a channel, not the allies row", async () => {
    seedPractice();
    const open = db.Stream!.insert({
      streamerId: OTHER,
      title: "Open desk",
      category: "Bitcoin Trading",
      isLive: true,
      status: "live",
      livekitRoomName: `stream-${OTHER}`,
      startedAt: new Date(),
      viewers: 4,
      takenDownAt: null,
    });

    const live = await call("GET", "/streams?live=true");
    expect(live.statusCode).toBe(200);
    expect(live.json().data.streams.map((s: { _id: string }) => s._id)).toEqual([String(open._id)]);
    expect(live.json().data.pagination.total).toBe(1);

    // The host's public channel page lists their streams by username.
    const channel = await call("GET", "/streams?streamer=amara");
    expect(channel.json().data.streams).toEqual([]);

    // (Channel search takes the same filter; the fake store can't match its
    // regex, so the allies row stands in for both.)
    state.caller = "stranger";
    const following = await call("GET", "/user/me/following");
    expect(following.json().data.channels[0]).toMatchObject({ username: "amara", isLive: false, stream: null });
  });

  it("is not found behind its id for anyone but the host and their producers", async () => {
    const stream = seedPractice();
    const url = `/streams/${stream._id}`;

    state.caller = "";
    expect((await call("GET", url)).statusCode).toBe(404);
    state.caller = "stranger";
    const asStranger = await call("GET", url);
    expect(asStranger.statusCode).toBe(404);
    expect(asStranger.json().code).toBe("STREAM_NOT_FOUND");
    state.caller = "mod";
    expect((await call("GET", url)).statusCode).toBe(404);

    state.caller = "host";
    const asHost = await call("GET", url);
    expect(asHost.statusCode).toBe(200);
    expect(asHost.json().data.stream).toMatchObject({ practice: true, title: "Dress rehearsal" });
    state.caller = "producer";
    expect((await call("GET", url)).statusCode).toBe(200);
  });

  it("gives room tokens to the host, their monitor and their producers, and turns everyone else away", async () => {
    const stream = seedPractice();
    const url = `/streams/${stream._id}/token`;

    for (const caller of ["", "stranger", "mod"] as const) {
      state.caller = caller;
      const res = await call("GET", url);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: "PRACTICE_PRIVATE" });
    }
    state.caller = "stranger";
    expect((await call("GET", `${url}?preview=true`)).statusCode).toBe(403);
    expect(state.tokens).toEqual([]);

    state.caller = "host";
    expect((await call("GET", url)).statusCode).toBe(200);
    expect((await call("GET", `${url}?monitor=1`)).statusCode).toBe(200);
    state.caller = "producer";
    expect((await call("GET", url)).statusCode).toBe(200);
    expect(state.tokens.map((t) => [t.identity, t.options.canPublish])).toEqual([
      [String(HOST), true],
      [`mon-${HOST}`, false],
      [String(PRODUCER), false],
    ]);
  });

  it("ends like any stream, and its audience with it", async () => {
    state.caller = "host";
    const id = (await goLive({ practice: true })).json().data.stream.id as string;
    expect(isPracticing(id)).toBe(true);

    const res = await call("POST", `/streams/${id}/end`);
    expect(res.statusCode).toBe(200);
    expect(db.Stream!.rows[0]).toMatchObject({ isLive: false, status: "ended" });
    // Never flagged for the relay sweep, even with the relay on and the cross-post asked for.
    expect(db.Stream!.rows[0]!.socialsRelayPending).toBeFalsy();
    expect(isPracticing(id)).toBe(false);
    expect(mocks.relay).not.toHaveBeenCalled();
  });
});

describe("the simulated audience", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW });
  });

  const text = (d: Record<string, unknown>) => d.type === "text";
  const tip = (d: Record<string, unknown>) => d.type === "tip";
  const like = (d: Record<string, unknown>) => d.__evt === "like";

  /**
   * Let the clock run a tick at a time: ten minutes for a fair sample of
   * the mix, then on until every shape has been seen (or long enough that
   * it should have — the odds of a shape not showing in 400 ticks are nil).
   */
  async function runUntilAllShapes() {
    for (let i = 0; i < 400; i++) {
      const seen = state.sent.map((s) => s.data);
      if (i >= 60 && seen.some(text) && seen.some(tip) && seen.some(like) && state.sentTo.some((x) => x.data.__evt === "tickers")) break;
      await vi.advanceTimersByTimeAsync(PRACTICE_TICK_MAX_MS);
    }
  }

  it("sends chat lines, gifts and like bursts into the room, shaped as the real routes send them", async () => {
    const stream = seedPractice({
      goal: { id: "g1", kind: "gifts", title: "A new mic", target: 1_000_000, milestones: [], progress: 0, startedAt: new Date(NOW), reachedAt: null, endedAt: null, rev: 1 },
    });
    startPractice(stream);
    expect(isPracticing(stream._id)).toBe(true);
    await runUntilAllShapes();

    const events = state.sent.filter((s) => s.data.__evt !== "goal");
    expect(events.length).toBeGreaterThanOrEqual(60);
    expect(new Set(state.sent.map((s) => s.room))).toEqual(new Set([`practice-${HOST}`]));
    // One event every 4–9 seconds.
    for (let i = 1; i < events.length; i++) {
      const gap = events[i]!.at - events[i - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(PRACTICE_TICK_MIN_MS);
      expect(gap).toBeLessThanOrEqual(PRACTICE_TICK_MAX_MS);
    }

    // A chat line, as chat.ts fans a real one in.
    const line = events.map((e) => e.data).find(text)!;
    expect(line).toMatchObject({ type: "text", platform: "xstream", isMod: false, avatar: "" });
    expect(String(line.id)).toMatch(HEX24);
    const who = PRACTICE_CAST.find((c) => c.username === line.username)!;
    expect(who).toBeDefined();
    expect(line.userId).toBe(String(practiceUserId(who.username)));
    expect(PRACTICE_LINES).toContain(line.content);
    expect(typeof line.createdAt).toBe("string");
    // Some of the cast carry a fan standing; a line from them wears it.
    const withFan = events.map((e) => e.data).find((d) => text(d) && "fan" in d);
    if (withFan) expect(withFan.fan).toMatchObject({ level: expect.any(Number), badge: expect.any(Number) });
    expect(events.map((e) => e.data).filter(text).every((d) => d.fan === undefined || (d.fan as { level: number }).level >= 2)).toBe(true);

    // A gift, as gifts.ts announces a paid one — from the real catalogue.
    const gift = events.map((e) => e.data).find(tip)!;
    expect(gift).toMatchObject({ type: "tip", tipCurrency: "USD", platform: "xstream", isMod: false });
    expect(String(gift.tipAmount)).toMatch(/^\d+\.\d{2}$/);
    const entry = PRACTICE_GIFTS.find((g) => g.emoji === gift.emoji)!;
    expect(entry).toBeDefined();
    expect(gift.content).toBe(`sent a ${entry.name}`);
    expect(gift.tipAmount).toBe((entry.usdMinor / 100).toFixed(2));
    expect(PRACTICE_GIFTS.map((g) => g.name)).toEqual(["Clap", "Heart", "Fire", "Rocket", "Party", "Diamond", "Trophy", "Crown"]);

    // Likes: the count on the stream, sent as the like route sends it.
    const likes = events.map((e) => e.data).filter(like);
    expect(likes[0]).toMatchObject({ __evt: "like", likes: expect.any(Number), username: expect.any(String) });
    expect(likes[likes.length - 1]!.likes).toBe(stream.likes);
    expect(stream.likes).toBeGreaterThan(0);

    // The show rules hear the gift, the goal bar moves, chat's cashtags reach the host as suggestions.
    const giftRule = mocks.fireRules.mock.calls.find(([, e]) => (e as { kind: string }).kind === "gift")?.[1] as Record<string, unknown>;
    expect(giftRule).toMatchObject({ kind: "gift", minor: expect.any(Number), user: expect.any(String), gift: expect.any(String) });
    expect(PRACTICE_GIFTS.some((g) => g.name === giftRule.gift && g.usdMinor === giftRule.minor)).toBe(true);
    expect(stream.goal.progress).toBeGreaterThan(0);
    expect(state.sent.some((s) => s.data.__evt === "goal")).toBe(true);
    const tickers = state.sentTo.find((x) => x.data.__evt === "tickers")!;
    expect(tickers.to).toEqual(expect.arrayContaining([String(HOST), `prod-${HOST}`, `prod-${PRODUCER}`]));

    // Nothing was written: no chat rows, no ledger, no bell.
    expect(db.ChatMessage!.rows).toEqual([]);
    expect(db.GiftTransaction!.rows).toEqual([]);
    expect(db.Notification!.rows).toEqual([]);
  });

  it("goes quiet when stopped, and when the stream ends", async () => {
    const stream = seedPractice();
    startPractice(stream);
    await vi.advanceTimersByTimeAsync(PRACTICE_TICK_MAX_MS * 3);
    const before = state.sent.length;
    expect(before).toBeGreaterThan(0);

    expect(stopPractice(stream._id)).toBe(true);
    expect(isPracticing(stream._id)).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.sent.length).toBe(before);
    expect(stopPractice(stream._id)).toBe(false);

    // Ending the stream stops it too — and leaves a live ring it never lit alone.
    startPractice(stream);
    db.User!.rows[0]!.isLive = true;
    await markStreamEnded(stream as never);
    expect(stream).toMatchObject({ isLive: false, status: "ended" });
    expect(isPracticing(stream._id)).toBe(false);
    expect(db.User!.rows[0]!.isLive).toBe(true);
    expect(mocks.relay).not.toHaveBeenCalled();
    const after = state.sent.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.sent.length).toBe(after);
  });

  it("sends the audience home by itself after two hours", async () => {
    const stream = seedPractice();
    startPractice(stream);
    await vi.advanceTimersByTimeAsync(PRACTICE_MAX_MS + PRACTICE_TICK_MAX_MS);
    expect(isPracticing(stream._id)).toBe(false);
    const count = state.sent.length;
    expect(count).toBeGreaterThan(PRACTICE_MAX_MS / PRACTICE_TICK_MAX_MS / 2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.sent.length).toBe(count);
  });

  it("stops on its own when the stream is no longer live under it", async () => {
    const stream = seedPractice();
    startPractice(stream);
    stream.isLive = false;
    // Enough ticks for a like burst, which is the one that checks (one in
    // ten; the odds of none in two hundred are nil).
    await vi.advanceTimersByTimeAsync(PRACTICE_TICK_MAX_MS * 200);
    expect(isPracticing(stream._id)).toBe(false);
    expect(stream.likes).toBe(0);
  });
});
