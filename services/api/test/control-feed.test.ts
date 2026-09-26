import http from "node:http";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The control API's event feed: what the API tells the room reaches a key
 * over server-sent events — mirrored before LiveKit, so LiveKit being down
 * changes nothing; the current stream state first, the channel going live
 * or ending while connected, a ping to keep the line open, eight feeds a
 * channel and not nine.
 */

const HOST = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    ControlKey: new FakeModel("ControlKey", [{ keys: ["hash"] }]),
    User: new FakeModel("User"),
    Stream: new FakeModel("Stream"),
    Rundown: new FakeModel("Rundown"),
    ShowRule: new FakeModel("ShowRule"),
  };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: HOST, username: "amara" } }),
  getOptionalAuthUserId: () => null,
}));
// LiveKit is stubbed at the SDK, not the module: the real sendRoomData runs here, with LiveKit down.

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const livekit = await import("../src/livekit.js");
const feed = await import("../src/control-feed.js");

type Frame = { id: number | null; event: string; data: Record<string, unknown> | null; comment: string | null };

/** Reads one SSE message at a time off a fetch body, and fails rather than waits forever. */
function frames(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    async next(withinMs = 3000): Promise<Frame> {
      const deadline = Date.now() + withinMs;
      for (;;) {
        const at = buffered.indexOf("\n\n");
        if (at >= 0) {
          const raw = buffered.slice(0, at);
          buffered = buffered.slice(at + 2);
          const frame: Frame = { id: null, event: "", data: null, comment: null };
          for (const line of raw.split("\n")) {
            if (line.startsWith(":")) frame.comment = line.slice(1).trim();
            else if (line.startsWith("id: ")) frame.id = Number(line.slice(4));
            else if (line.startsWith("event: ")) frame.event = line.slice(7);
            else if (line.startsWith("data: ")) frame.data = JSON.parse(line.slice(6));
            else if (line.startsWith("retry: ")) frame.event = `retry ${line.slice(7)}`;
          }
          return frame;
        }
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no frame within ${withinMs} ms`)), Math.max(1, deadline - Date.now()))),
        ]);
        if (chunk.done) throw new Error("the feed ended");
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

const seedLive = () =>
  db.Stream!.insert({
    streamerId: HOST,
    isLive: true,
    title: "Friday night desk",
    livekitRoomName: "room-1",
    startedAt: new Date(),
    scene: { layout: "auto", card: null, layers: [], version: 1 },
  });

describe("the control feed", () => {
  beforeEach(() => {
    for (const m of Object.values(db)) m.reset();
    db.User!.insert({ _id: HOST, username: "amara", safety: { mods: [] } });
  });

  it("hands a room's events to its listeners, chat lines apart — a gift included", () => {
    const heard: unknown[] = [];
    const stop = feed.subscribeFeed("room-1", (event, data) => heard.push([event, data]));
    feed.publishFeed("room-1", { __evt: "scene", scene: { layout: "split" } });
    feed.publishFeed("room-1", { id: "m1", username: "tolu", content: "hello", type: "text" });
    feed.publishFeed("room-1", { id: "m2", username: "kemi", content: "sent a Rose", type: "tip", tipAmount: "5.00", tipCurrency: "USD" });
    feed.publishFeed("room-2", { __evt: "scene", scene: { layout: "solo" } });
    expect(heard).toEqual([
      ["scene", { scene: { layout: "split" } }],
      ["gift", expect.objectContaining({ username: "kemi", type: "tip", tipAmount: "5.00" })],
    ]);
    stop();
    feed.publishFeed("room-1", { __evt: "scene", scene: { layout: "grid" } });
    expect(heard).toHaveLength(2);
  });

  it("is mirrored by sendRoomData and sendRoomDataTo, LiveKit down or not, and a listener's error stays its own", async () => {
    vi.spyOn(livekit.roomService, "sendData").mockRejectedValue(new Error("LiveKit down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const heard: string[] = [];
    const stopFirst = feed.subscribeFeed("room-1", () => {
      throw new Error("a bad listener");
    });
    const stop = feed.subscribeFeed("room-1", (event) => heard.push(event));
    await livekit.sendRoomData("room-1", { __evt: "rule_fire", sounds: ["airhorn"] });
    await livekit.sendRoomDataTo("room-1", [String(HOST)], { __evt: "rundown", position: { segmentId: "seg001" } });
    await livekit.sendRoomDataTo("room-1", [], { __evt: "rundown", position: { segmentId: "seg002" } });
    expect(heard).toEqual(["rule_fire", "rundown"]);
    stopFirst();
    stop();
    quiet.mockRestore();
  });

  describe("over HTTP", () => {
    let app: FastifyInstance;
    let base: string;
    const aborts: AbortController[] = [];
    const listen = async (secret: string) => {
      const ac = new AbortController();
      aborts.push(ac);
      const res = await fetch(`${base}/v1/control/events`, { headers: { authorization: `Bearer ${secret}` }, signal: ac.signal });
      return { res, read: res.body ? frames(res.body) : null };
    };
    const makeKey = async () => {
      const res = await app.inject({ method: "POST", url: "/v1/users/me/control-keys", payload: { name: "Companion", scopes: ["scene"] } });
      return res.json().data.secret as string;
    };

    beforeAll(async () => {
      const { buildApp } = await import("../src/app.js");
      app = await buildApp();
      base = await app.listen({ port: 0, host: "127.0.0.1" });
    });
    afterEach(async () => {
      for (const ac of aborts.splice(0)) ac.abort();
      await vi.waitFor(() => expect(feed.feedListeners(HOST)).toBe(0));
    });
    afterAll(async () => {
      await app.close();
    });

    it("turns away no key and a wrong key before a byte of the feed", async () => {
      const none = await app.inject({ method: "GET", url: "/v1/control/events" });
      expect(none.statusCode).toBe(401);
      expect(none.json().code).toBe("CONTROL_KEY_MISSING");
      const wrong = await app.inject({ method: "GET", url: "/v1/control/events", headers: { "x-xtream-key": "xck_not-a-real-key-at-all-000000000000" } });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().code).toBe("CONTROL_KEY_INVALID");
    });

    it("says what's on first, then what the API tells the room — without the event's name field", async () => {
      const stream = seedLive();
      const { res, read } = await listen(await makeKey());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("cache-control")).toContain("no-cache");
      expect((await read!.next()).event).toBe("retry 3000");
      expect(await read!.next()).toMatchObject({ id: 1, event: "stream", data: { live: true, streamId: String(stream._id), title: "Friday night desk" } });

      vi.spyOn(livekit.roomService, "sendData").mockRejectedValue(new Error("LiveKit down"));
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      await livekit.sendRoomData("room-1", { __evt: "scene", scene: { layout: "split", card: null, layers: [] } });
      await livekit.sendRoomDataTo("room-1", [String(HOST)], { __evt: "rule_fire", sounds: ["airhorn"] });
      quiet.mockRestore();
      expect(await read!.next()).toEqual({ id: 2, event: "scene", data: { scene: { layout: "split", card: null, layers: [] } }, comment: null });
      expect(await read!.next()).toEqual({ id: 3, event: "rule_fire", data: { sounds: ["airhorn"] }, comment: null });
      expect(feed.feedListeners(HOST)).toBe(1);
    });

    it("holds eight feeds a channel, not nine, and lets go when they hang up", async () => {
      seedLive();
      const secret = await makeKey();
      for (let i = 0; i < feed.MAX_FEED_LISTENERS; i++) {
        const { res, read } = await listen(secret);
        expect(res.status).toBe(200);
        await read!.next();
      }
      expect(feed.feedListeners(HOST)).toBe(feed.MAX_FEED_LISTENERS);
      const ninth = await app.inject({ method: "GET", url: "/v1/control/events", headers: { authorization: `Bearer ${secret}` } });
      expect(ninth.statusCode).toBe(409);
      expect(ninth.json().code).toBe("TOO_MANY_LISTENERS");
    });
  });

  describe("while connected", () => {
    /** The feed on a bare server, with the poll and the ping sped up: what a client sees over a real socket. */
    it("notices the channel going live and ending, rebinds to the new room, and pings", async () => {
      const server = http.createServer((req, res) => {
        void feed.openControlFeed(HOST, { pollMs: 20, pingMs: 60 }).then((f) => f.serve(req, res));
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const port = (server.address() as { port: number }).port;
      const ac = new AbortController();
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ac.signal });
        const read = frames(res.body!);
        expect((await read.next()).event).toBe("retry 3000");
        expect(await read.next()).toMatchObject({ id: 1, event: "stream", data: { live: false, streamId: null, title: null } });

        const stream = seedLive();
        expect(await read.next()).toMatchObject({ event: "stream", data: { live: true, streamId: String(stream._id), title: "Friday night desk" } });
        feed.publishFeed("room-1", { __evt: "goal", goal: { title: "New mic", progress: 40 } });
        expect(await read.next()).toMatchObject({ event: "goal", data: { goal: { title: "New mic", progress: 40 } } });

        // A ping, between events, keeps a proxy from hanging up.
        let ping: Frame | null = null;
        for (let i = 0; i < 4 && !ping; i++) {
          const f = await read.next();
          if (f.comment === "ping") ping = f;
        }
        expect(ping).not.toBeNull();

        stream.isLive = false;
        expect(await read.next()).toMatchObject({ event: "stream", data: { live: false, streamId: null, title: null } });
        // The next broadcast has a new room: the feed follows it.
        const next = db.Stream!.insert({ streamerId: HOST, isLive: true, title: "Saturday", livekitRoomName: "room-2", startedAt: new Date(), scene: {} });
        expect(await read.next()).toMatchObject({ event: "stream", data: { live: true, streamId: String(next._id), title: "Saturday" } });
        feed.publishFeed("room-1", { __evt: "scene", scene: {} });
        feed.publishFeed("room-2", { __evt: "tickers", chips: ["BTC"] });
        expect(await read.next()).toMatchObject({ event: "tickers", data: { chips: ["BTC"] } });
      } finally {
        ac.abort();
        await vi.waitFor(() => expect(feed.feedListeners(HOST)).toBe(0));
        await new Promise<void>((done) => server.close(() => done()));
      }
    });
  });
});
