import crypto from "node:crypto";
import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Realtime pushes to the WorldSpace gateway (xtream-events.ts): signed like
 * the live relay, batched, retried like it, never in the caller's way — and
 * never carrying a practice run, a practice battle or money.
 */

vi.mock("../src/config.js", () => ({
  config: {
    SOCIALS_GATEWAY_URL: "https://gateway.test",
    SOCIALS_WEBHOOK_SECRET: "test-secret",
  },
}));

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return { User: new FakeModel("User"), Stream: new FakeModel("Stream") };
});

const { config } = await import("../src/config.js");
const db = (await import("../src/models.js")) as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const events = await import("../src/xtream-events.js");
const { relayLiveEvent } = await import("../src/socials-relay.js");
const {
  publishXtreamEvents,
  drainXtreamEvents,
  resetXtreamEvents,
  xtreamStreamStarted,
  xtreamStreamEnded,
  xtreamStreamUpdated,
  xtreamBattle,
  xtreamCameraChanged,
  pushNotifications,
  cleanEventData,
} = events;

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
const ok = () => ({ ok: true, status: 200, json: async () => ({ success: true }) });
const status = (s: number) => ({ ok: false, status: s });

type Sent = { url: string; headers: Record<string, string>; body: string; events: Array<{ to: string; name: string; data?: Record<string, unknown> }> };
function sent(): Sent[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/internal/xtream/events"))
    .map(([url, init]) => ({
      url: String(url),
      headers: (init as { headers: Record<string, string> }).headers,
      body: (init as { body: string }).body,
      events: JSON.parse((init as { body: string }).body).events,
    }));
}
const allEvents = () => sent().flatMap((c) => c.events);

/** Let detached lookups settle, then flush the queue. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  await drainXtreamEvents();
}

const HOST = new mongoose.Types.ObjectId();

beforeEach(() => {
  resetXtreamEvents();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(ok());
  db.User!.reset();
  db.Stream!.reset();
  db.User!.insert({ _id: HOST, username: "zainab", authUserId: "user_zainab" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("signing", () => {
  it("signs exactly like the live relay: HMAC-SHA256 of `${timestamp}.${body}` with the shared secret", async () => {
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "s1" } }]);
    await settle();
    const [call] = sent();
    expect(call!.url).toBe("https://gateway.test/internal/xtream/events");
    const ts = call!.headers["x-ws-timestamp"]!;
    const expected = crypto.createHmac("sha256", "test-secret").update(`${ts}.${call!.body}`).digest("hex");
    expect(call!.headers["x-ws-signature"]).toBe(expected);
    expect(call!.headers["Content-Type"]).toBe("application/json");

    // The relay's own request, verified the same way.
    fetchMock.mockClear();
    await relayLiveEvent("started", { _id: "s1", streamerId: HOST, title: "t", category: "c" } as never);
    const [[, init]] = fetchMock.mock.calls as [[string, { headers: Record<string, string>; body: string }]];
    const relayTs = init.headers["x-ws-timestamp"]!;
    expect(init.headers["x-ws-signature"]).toBe(crypto.createHmac("sha256", "test-secret").update(`${relayTs}.${init.body}`).digest("hex"));
  });
});

describe("batching", () => {
  it("sends one tick's events as one call", async () => {
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }]);
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "b" } }]);
    publishXtreamEvents([{ to: "user_x", name: "notification", data: { kind: "live", id: "n1" } }]);
    expect(fetchMock).not.toHaveBeenCalled(); // queued, not sent inside the caller
    await settle();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.events.map((e) => e.data?.streamId ?? e.data?.id)).toEqual(["a", "b", "n1"]);
  });

  it("collects events inside the ~50 ms window", async () => {
    vi.useFakeTimers();
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }]);
    await vi.advanceTimersByTimeAsync(20);
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "b" } }]);
    await vi.advanceTimersByTimeAsync(60);
    expect(sent()).toHaveLength(1);
    expect(sent()[0]!.events).toHaveLength(2);
  });

  it("never puts more than 50 events in a call", async () => {
    publishXtreamEvents(Array.from({ length: 120 }, (_, i) => ({ to: `user_${i}`, name: "notification", data: { kind: "live", id: String(i) } })));
    await settle();
    expect(sent().map((c) => c.events.length)).toEqual([50, 50, 20]);
    expect(allEvents().map((e) => e.to)).toEqual(Array.from({ length: 120 }, (_, i) => `user_${i}`));
  });

  it("is a no-op without the gateway configured", async () => {
    const url = config.SOCIALS_GATEWAY_URL;
    config.SOCIALS_GATEWAY_URL = "";
    try {
      publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }]);
      xtreamStreamEnded({ _id: "s", streamerId: HOST });
      pushNotifications({ _id: "n", userId: HOST, type: "live" });
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      config.SOCIALS_GATEWAY_URL = url;
    }
  });
});

describe("delivery", () => {
  it("retries a transient failure on the relay's backoff", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(status(503)).mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValue(ok());
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }]);
    await vi.advanceTimersByTimeAsync(60);
    expect(sent()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sent()).toHaveLength(3);
    // A retry is signed afresh, never refused as a replay.
    const [a, , c] = sent();
    expect(c!.body).toBe(a!.body);
  });

  it("gives up after the ladder", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(status(500));
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(4);
  });

  it("never retries a permanent 4xx — the gateway not shipping the route yet is a 404", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(status(404));
    publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent()).toHaveLength(1);
  });

  it("never throws into the caller, whatever breaks", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => publishXtreamEvents([{ to: "all", name: "stream.ended", data: { streamId: "a" } }])).not.toThrow();
    expect(() => publishXtreamEvents(null as never)).not.toThrow();
    expect(() => publishXtreamEvents([null as never, { to: "", name: "x" }])).not.toThrow();
    // A lookup that blows up stays inside the helper.
    const find = db.User!.findById;
    db.User!.findById = (() => {
      throw new Error("db down");
    }) as never;
    try {
      expect(() => xtreamStreamEnded({ _id: "s", streamerId: HOST })).not.toThrow();
      expect(() => xtreamCameraChanged("room", `cam-${HOST}`, "participant_joined")).not.toThrow();
      await vi.advanceTimersByTimeAsync(60_000);
      // Tried, failed, retried, gave up — and nobody above it noticed.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      db.User!.findById = find;
    }
  });
});

describe("what never leaves", () => {
  it("drops every money-looking key and anything nested", () => {
    expect(
      cleanEventData({
        streamId: "s",
        title: "Friday",
        usdMinor: 500,
        hostUsdMinor: 1,
        priceUsdMinor: 2,
        bonusUsdMinor: 3,
        amount: 4,
        balance: 5,
        earningsUsdMinor: 6,
        coins: 7,
        nested: { usd: 1 },
        streamIds: ["a", "b"],
      }),
    ).toEqual({ streamId: "s", title: "Friday", streamIds: ["a", "b"] });
  });

  it("strips money on the wire too", async () => {
    publishXtreamEvents([{ to: "all", name: "battle.ended", data: { battleId: "b", hostUsdMinor: 900 } as never }]);
    await settle();
    expect(allEvents()).toEqual([{ to: "all", name: "battle.ended", data: { battleId: "b" } }]);
    expect(sent()[0]!.body).not.toMatch(/usd|minor/i);
  });

  it("battle events carry ids only, even from a settled battle full of money", async () => {
    xtreamBattle("ended", {
      _id: "b1",
      hostStreamId: "s1",
      challengerStreamId: "s2",
      hostUsdMinor: 5_000,
      challengerUsdMinor: 100,
      bonusUsdMinor: 400,
    } as never);
    await settle();
    expect(allEvents()).toEqual([{ to: "all", name: "battle.ended", data: { battleId: "b1", streamIds: ["s1", "s2"] } }]);
  });

  it("never sends a practice run or a practice battle", async () => {
    const practice = { _id: "p", streamerId: HOST, title: "Rehearsal", category: "IRL", practice: true };
    db.Stream!.insert({ _id: new mongoose.Types.ObjectId(), streamerId: HOST, livekitRoomName: "practice-room", isLive: true, practice: true });
    xtreamStreamStarted(practice, { authUserId: "user_zainab", username: "zainab" });
    xtreamStreamEnded(practice);
    xtreamStreamUpdated(practice);
    xtreamBattle("started", { _id: "b", hostStreamId: "p", challengerStreamId: "x", practice: true });
    xtreamBattle("ended", { _id: "b", hostStreamId: "p", challengerStreamId: "x", practice: true });
    xtreamCameraChanged("practice-room", `cam-${HOST}`, "participant_joined");
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the helpers", () => {
  it("go live: public stream.started and the streamer's own live: started", async () => {
    xtreamStreamStarted({ _id: "s1", streamerId: HOST, title: "Jollof", category: "Cooking" }, { authUserId: "user_zainab", username: "zainab" });
    await settle();
    expect(allEvents()).toEqual([
      { to: "all", name: "stream.started", data: { streamId: "s1", username: "zainab", title: "Jollof", category: "Cooking" } },
      { to: "user_zainab", name: "live", data: { state: "started", streamId: "s1" } },
    ]);
  });

  it("end: public stream.ended and the streamer's live: ended", async () => {
    xtreamStreamEnded({ _id: "s1", streamerId: HOST });
    await settle();
    expect(allEvents()).toEqual([
      { to: "all", name: "stream.ended", data: { streamId: "s1" } },
      { to: "user_zainab", name: "live", data: { state: "ended", streamId: "s1" } },
    ]);
  });

  it("camera: only the host's own phone cam, joining or leaving", async () => {
    const stream = db.Stream!.insert({ streamerId: HOST, livekitRoomName: "room-1", isLive: true });
    xtreamCameraChanged("room-1", `cam-${HOST}`, "participant_joined");
    xtreamCameraChanged("room-1", `cam-${HOST}`, "participant_connection_aborted");
    xtreamCameraChanged("room-1", `cam-${new mongoose.Types.ObjectId()}`, "participant_joined");
    xtreamCameraChanged("room-1", `cam-${HOST}`, "track_published");
    await settle();
    expect(allEvents()).toEqual([
      { to: "user_zainab", name: "live", data: { state: "camera", streamId: String(stream._id), secondCameraConnected: true } },
      { to: "user_zainab", name: "live", data: { state: "camera", streamId: String(stream._id), secondCameraConnected: false } },
    ]);
  });

  it("notifications: one personal event per recipient with a Clerk id, capped", async () => {
    const other = db.User!.insert({ username: "tunde", authUserId: "user_tunde" });
    const noClerk = db.User!.insert({ username: "ghost" });
    pushNotifications([
      { _id: "n1", userId: HOST, type: "battle_result" },
      { _id: "n2", userId: other._id, type: "battle_result" },
      { _id: "n3", userId: noClerk._id, type: "battle_result" },
    ]);
    await settle();
    expect(allEvents()).toEqual([
      { to: "user_zainab", name: "notification", data: { kind: "battle_result", id: "n1" } },
      { to: "user_tunde", name: "notification", data: { kind: "battle_result", id: "n2" } },
    ]);

    fetchMock.mockClear();
    const many = Array.from({ length: events.NOTIFICATION_PUSH_CAP + 10 }, (_, i) => ({ _id: `m${i}`, userId: HOST, type: "live" }));
    pushNotifications(many);
    await settle();
    expect(allEvents()).toHaveLength(events.NOTIFICATION_PUSH_CAP);
    expect(Math.max(...sent().map((c) => c.events.length))).toBe(50);
  });
});
