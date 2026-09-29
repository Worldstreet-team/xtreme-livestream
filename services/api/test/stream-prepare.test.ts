import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Going live in two steps, and ending without a wait. The studio's 3·2·1
 * prepares the stream (POST /streams with prepare: true) — a room and a
 * token, nothing announced, nothing listed — and the end of the count
 * commits it (POST /streams/:id/go), which answers without waiting on the
 * follower lookup. A count called off throws it away (DELETE
 * /streams/:id/prepare), and so does the sweep when nobody commits. The
 * one-shot start the mobile app uses is unchanged. End answers as soon as
 * the stream is marked ended; the close-out and the room's closing follow.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  caller: "" as "" | "host" | "stranger",
  sentTo: [] as Array<{ room: string; to: string[]; data: Record<string, unknown> }>,
  tokens: [] as Array<{ room: string; identity: string }>,
  closed: [] as string[],
  /** When set, the follower lookup waits on it. */
  followersGate: null as Promise<number | null> | null,
  /** When set, closing a room waits on it. */
  closeGate: null as Promise<void> | null,
}));
const mocks = vi.hoisted(() => ({
  notifyFollowers: vi.fn(async (): Promise<number | null> => (state.followersGate ? state.followersGate : 3)),
  notifyReminders: vi.fn(async () => {}),
  relay: vi.fn(async () => true),
  ingress: vi.fn(async () => ({ ingressId: "IN_amara", url: "rtmp://ingest.test/x", streamKey: "sk_test" })),
}));
const HOST = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const ids = { host: HOST, stranger: STRANGER } as const;

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
    "Sponsor", "Campaign", "CampaignMember", "Rundown", "PreparedStream",
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
  createToken: async (room: string, identity: string) => {
    state.tokens.push({ room, identity });
    return `token-for-${room}`;
  },
  ensureUserIngress: mocks.ingress,
  rotateUserIngress: async () => ({ ingressId: "", url: "", streamKey: "" }),
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async () => false,
  setParticipantPublishPermission: async () => {},
  setRoomScene: async () => {},
  sendRoomData: async () => {},
  sendRoomDataTo: async (room: string, to: string[], data: Record<string, unknown>) => {
    state.sentTo.push({ room, to, data });
  },
  closeRoom: async (room: string) => {
    state.closed.push(room);
    if (state.closeGate) await state.closeGate;
  },
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

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { PREPARED_STREAM_TTL_MS, sweepPreparedStreams } = await import("../src/stream-prepare.js");
const { endTiming } = await import("../src/routes/stream-actions.js");
const { stopAllPractice } = await import("../src/practice.js");

const flush = () => new Promise((r) => setTimeout(r, 10));
/** Each test from its own address: the start routes' rate limit is per caller, and one file makes a lot of starts. */
let ip = 0;

beforeEach(() => {
  ip += 1;
  for (const m of Object.values(db)) m.reset();
  state.caller = "host";
  state.sentTo = [];
  state.tokens = [];
  state.closed = [];
  state.followersGate = null;
  state.closeGate = null;
  mocks.notifyFollowers.mockClear();
  mocks.notifyReminders.mockClear();
  mocks.relay.mockClear();
  mocks.ingress.mockClear();
  db.User!.insert({ _id: HOST, username: "amara", displayName: "Amara", avatar: "", isLive: false, settings: {}, safety: { mods: [] } });
  db.User!.insert({ _id: STRANGER, username: "kemi", displayName: "Kemi", avatar: "", isLive: false, settings: {} });
});
afterEach(() => {
  stopAllPractice();
});

describe("going live in two steps", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    app.inject({ method, url: `/v1${url}`, remoteAddress: `10.0.0.${ip}`, ...(payload ? { payload } : {}) });
  const prepare = (body: Record<string, unknown> = {}) =>
    call("POST", "/streams", { title: "Morning desk", category: "Bitcoin Trading", postToWorldSpace: true, prepare: true, ...body });
  const host = () => db.User!.rows.find((r) => String(r._id) === String(HOST))!;

  it("prepares a room and a token, and nothing else: no stream, no bell, no post, no live ring", async () => {
    const res = await prepare();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.stream).toMatchObject({ title: "Morning desk", practice: false, prepared: true, startedAt: null });
    expect(data.stream.id).toMatch(/^[a-f\d]{24}$/);
    expect(data.livekitToken).toBe(`token-for-${data.stream.livekitRoomName}`);
    expect(data.livekitUrl).toBeTruthy();
    expect(data.followersTold).toBeUndefined();

    expect(db.Stream!.rows).toEqual([]);
    expect(db.PreparedStream!.rows).toHaveLength(1);
    expect(host().isLive).toBe(false);
    expect(mocks.notifyFollowers).not.toHaveBeenCalled();
    expect(mocks.relay).not.toHaveBeenCalled();
    // An encoder isn't re-pointed until the commit.
    expect(mocks.ingress).not.toHaveBeenCalled();
  });

  it("is never listed, found or resumable while it's only prepared", async () => {
    const id = (await prepare()).json().data.stream.id as string;
    state.caller = "stranger";
    for (const url of ["/streams", "/streams?live=true", "/streams?status=live", "/streams?streamer=amara", "/streams?sort=recent"]) {
      const res = await call("GET", url);
      expect(res.statusCode, url).toBe(200);
      expect(res.json().data.streams, url).toEqual([]);
      expect(res.json().data.pagination.total, url).toBe(0);
    }
    expect((await call("GET", `/streams/${id}`)).statusCode).toBe(404);
    state.caller = "host";
    expect((await call("GET", "/streams/active/mine")).json().data.stream).toBeNull();
    expect((await call("POST", `/streams/${id}/resume`)).statusCode).toBe(404);
  });

  it("commits at the end of the count: live under the same id and room, and the answer doesn't wait on the follower lookup", async () => {
    const prepared = (await prepare()).json().data.stream;
    const gate = deferred<number | null>();
    state.followersGate = gate.promise;

    const res = await call("POST", `/streams/${prepared.id}/go`);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.stream).toMatchObject({ id: prepared.id, livekitRoomName: prepared.livekitRoomName, title: "Morning desk", practice: false });
    expect(data.stream.startedAt).toBeTruthy();
    // Still looking: the count isn't in the answer…
    expect(data.followersTold).toBeUndefined();
    expect(mocks.notifyFollowers).toHaveBeenCalledTimes(1);
    expect(state.sentTo).toEqual([]);

    const row = db.Stream!.rows[0]!;
    expect(String(row._id)).toBe(prepared.id);
    expect(row).toMatchObject({ isLive: true, status: "live", livekitRoomName: prepared.livekitRoomName, practice: false });
    expect(db.PreparedStream!.rows).toEqual([]);
    expect(host().isLive).toBe(true);
    expect(mocks.relay).toHaveBeenCalledWith("started", expect.objectContaining({ title: "Morning desk" }));

    // …it follows on the room, to the host alone.
    gate.resolve(7);
    await flush();
    expect(state.sentTo).toEqual([
      { room: prepared.livekitRoomName, to: [String(HOST)], data: { __evt: "followers_told", streamId: prepared.id, followersTold: 7 } },
    ]);

    // Live now: listed like any stream.
    state.caller = "stranger";
    const list = (await call("GET", "/streams?live=true")).json().data.streams;
    expect(list.map((s: { _id: unknown }) => String(s._id))).toEqual([prepared.id]);
  });

  it("answers a second commit with the stream it already started, not a second stream", async () => {
    const id = (await prepare()).json().data.stream.id as string;
    expect((await call("POST", `/streams/${id}/go`)).statusCode).toBe(200);
    const again = await call("POST", `/streams/${id}/go`);
    expect(again.statusCode).toBe(200);
    expect(again.json().data.stream.id).toBe(id);
    expect(db.Stream!.rows).toHaveLength(1);
    expect(mocks.notifyFollowers).toHaveBeenCalledTimes(1);
  });

  it("puts nobody's count in the room for a practice run: it's 0 in the answer, and the ring stays off", async () => {
    const id = (await prepare({ practice: true })).json().data.stream.id as string;
    const res = await call("POST", `/streams/${id}/go`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ followersTold: 0, stream: { practice: true } });
    expect(mocks.notifyFollowers).not.toHaveBeenCalled();
    expect(mocks.relay).not.toHaveBeenCalled();
    expect(host().isLive).toBe(false);
    await flush();
    expect(state.sentTo).toEqual([]);
  });

  it("points the encoder at the room on commit, for an OBS start", async () => {
    const prepared = (await prepare({ source: "obs" })).json().data.stream;
    expect(mocks.ingress).not.toHaveBeenCalled();
    const res = await call("POST", `/streams/${prepared.id}/go`);
    expect(res.json().data.ingress).toEqual({ url: "rtmp://ingest.test/x", streamKey: "sk_test" });
    expect(mocks.ingress).toHaveBeenCalledWith(expect.anything(), prepared.livekitRoomName);
    expect(db.Stream!.rows[0]).toMatchObject({ source: "obs", ingressId: "IN_amara" });
  });

  it("ends a stream still live when the new one commits — not when it's only prepared", async () => {
    const old = db.Stream!.insert({
      streamerId: HOST, title: "Earlier", category: "Bitcoin Trading", isLive: true, status: "live",
      livekitRoomName: "stream-old", startedAt: new Date(Date.now() - 60_000), viewers: 0, viewerSeconds: 0, takenDownAt: null,
    });
    const id = (await prepare()).json().data.stream.id as string;
    expect(old.isLive).toBe(true);
    await call("POST", `/streams/${id}/go`);
    expect(old).toMatchObject({ isLive: false, status: "ended" });
  });

  it("starts a booking under the booking's own id, and leaves it upcoming until the commit", async () => {
    const booking = db.Stream!.insert({
      streamerId: HOST, title: "Friday desk", category: "Bitcoin Trading", isLive: false, status: "upcoming",
      scheduledStartAt: new Date(Date.now() + 60_000), livekitRoomName: `upcoming-${HOST}`, takenDownAt: null,
    });
    const prepared = (await prepare({ title: "", scheduledStreamId: String(booking._id) })).json().data.stream;
    expect(prepared.id).toBe(String(booking._id));
    // Kept its booked title.
    expect(prepared.title).toBe("Friday desk");
    expect(booking).toMatchObject({ status: "upcoming", isLive: false });

    const res = await call("POST", `/streams/${prepared.id}/go`);
    expect(res.statusCode).toBe(200);
    expect(db.Stream!.rows).toHaveLength(1);
    expect(booking).toMatchObject({ status: "live", isLive: true, title: "Friday desk", livekitRoomName: prepared.livekitRoomName });
    expect(mocks.notifyReminders).toHaveBeenCalledTimes(1);
  });

  it("refuses a booking that isn't there at the tap, not at the end of the count", async () => {
    const res = await prepare({ scheduledStreamId: String(new mongoose.Types.ObjectId()) });
    expect(res.statusCode).toBe(404);
    expect(db.PreparedStream!.rows).toEqual([]);
  });

  it("throws a cancelled count away: its room closes, and it can't be committed after", async () => {
    const prepared = (await prepare()).json().data.stream;
    const res = await call("DELETE", `/streams/${prepared.id}/prepare`);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ cancelled: true });
    expect(db.PreparedStream!.rows).toEqual([]);
    expect(state.closed).toEqual([prepared.livekitRoomName]);

    const go = await call("POST", `/streams/${prepared.id}/go`);
    expect(go.statusCode).toBe(404);
    expect(go.json().code ?? go.json().error?.code).toBe("PREPARED_NOT_FOUND");
    expect(db.Stream!.rows).toEqual([]);
    // Harmless to repeat.
    expect((await call("DELETE", `/streams/${prepared.id}/prepare`)).json().data).toEqual({ cancelled: false });
  });

  it("never lets a cancel touch a stream that already went live, or someone else's", async () => {
    const id = (await prepare()).json().data.stream.id as string;
    state.caller = "stranger";
    expect((await call("DELETE", `/streams/${id}/prepare`)).json().data).toEqual({ cancelled: false });
    expect(db.PreparedStream!.rows).toHaveLength(1);
    expect((await call("POST", `/streams/${id}/go`)).statusCode).toBe(404);
    state.caller = "host";
    await call("POST", `/streams/${id}/go`);
    expect((await call("DELETE", `/streams/${id}/prepare`)).json().data).toEqual({ cancelled: false });
    expect(db.Stream!.rows[0]).toMatchObject({ isLive: true });
    expect(state.closed).toEqual([]);
  });

  it("keeps one per host: preparing again replaces the earlier one", async () => {
    const first = (await prepare()).json().data.stream;
    const second = (await prepare()).json().data.stream;
    expect(second.id).not.toBe(first.id);
    expect(db.PreparedStream!.rows.map((r) => String(r._id))).toEqual([second.id]);
    expect(state.closed).toEqual([first.livekitRoomName]);
    expect((await call("POST", `/streams/${first.id}/go`)).statusCode).toBe(404);
  });

  it("won't commit one past its time, even before the sweep gets to it", async () => {
    const id = (await prepare()).json().data.stream.id as string;
    db.PreparedStream!.rows[0]!.expiresAt = new Date(Date.now() - 1);
    expect((await call("POST", `/streams/${id}/go`)).statusCode).toBe(404);
    expect(db.Stream!.rows).toEqual([]);
  });

  it("sweeps one nobody committed after two minutes, closing its room — and leaves a fresh one", async () => {
    const stale = (await prepare()).json().data.stream;
    // Another host's, made just now.
    db.PreparedStream!.insert({
      streamerId: STRANGER, livekitRoomName: "stream-fresh", fields: {}, scheduledStreamId: null,
      expiresAt: new Date(Date.now() + PREPARED_STREAM_TTL_MS),
    });
    expect(await sweepPreparedStreams(Date.now() + 60_000)).toBe(0);
    expect(db.PreparedStream!.rows).toHaveLength(2);

    db.PreparedStream!.rows[1]!.expiresAt = new Date(Date.now() + 10 * PREPARED_STREAM_TTL_MS);
    expect(await sweepPreparedStreams(Date.now() + PREPARED_STREAM_TTL_MS + 1)).toBe(1);
    expect(db.PreparedStream!.rows.map((r) => r.livekitRoomName)).toEqual(["stream-fresh"]);
    expect(state.closed).toEqual([stale.livekitRoomName]);
    expect(db.Stream!.rows).toEqual([]);
  });

  it("leaves the one-shot start exactly as it was: live at once, the count awaited, nothing prepared", async () => {
    const res = await call("POST", "/streams", { title: "Morning desk", category: "Bitcoin Trading" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({ followersTold: 3, stream: { title: "Morning desk", practice: false } });
    expect(data.livekitToken).toBe(`token-for-${data.stream.livekitRoomName}`);
    expect(data.stream.startedAt).toBeTruthy();
    expect(data.stream.prepared).toBeUndefined();
    expect(db.Stream!.rows[0]).toMatchObject({ isLive: true, status: "live" });
    expect(db.PreparedStream!.rows).toEqual([]);
    expect(host().isLive).toBe(true);
    expect(res.json().message).toBe("Stream started");
  });
});

describe("ending without a wait", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
    endTiming.roomCloseDelayMs = 3_000;
  });

  function seedLive() {
    db.User!.rows.find((r) => String(r._id) === String(HOST))!.isLive = true;
    return db.Stream!.insert({
      streamerId: HOST, title: "Morning desk", category: "Bitcoin Trading", isLive: true, status: "live",
      livekitRoomName: "stream-live", startedAt: new Date(Date.now() - 120_000), viewers: 4, peakViewers: 9,
      viewerSeconds: 0, takenDownAt: null, practice: false, postToWorldSpace: false,
    });
  }

  it("answers as soon as the stream is marked ended, before the room is closed or the close-out is done", async () => {
    endTiming.roomCloseDelayMs = 0;
    const stream = seedLive();
    const roomClose = deferred<void>();
    state.closeGate = roomClose.promise;
    // The close-out's first step (the host's live ring) hangs…
    const ringOff = deferred<void>();
    const realUpdateOne = db.User!.updateOne.bind(db.User!);
    const updateOne = vi.spyOn(db.User!, "updateOne").mockImplementation(async (...args: Parameters<typeof realUpdateOne>) => {
      await ringOff.promise;
      return realUpdateOne(...args);
    });

    const res = await app.inject({ method: "POST", url: `/v1/streams/${stream._id}/end` });
    // …and End is answered anyway, with the stream ended.
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stream).toMatchObject({ id: String(stream._id), peakViewers: 9 });
    expect(stream).toMatchObject({ isLive: false, status: "ended" });
    expect(stream.endedAt).toBeInstanceOf(Date);
    // The room's closing started after the answer, and is still going.
    expect(state.closed).toEqual(["stream-live"]);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(host().isLive).toBe(true);

    ringOff.resolve();
    roomClose.resolve();
    await flush();
    expect(host().isLive).toBe(false);
    updateOne.mockRestore();
  });

  it("closes the room a moment after the answer by default, so the host's client leaves first", async () => {
    endTiming.roomCloseDelayMs = 40;
    const stream = seedLive();
    const res = await app.inject({ method: "POST", url: `/v1/streams/${stream._id}/end` });
    expect(res.statusCode).toBe(200);
    expect(state.closed).toEqual([]);
    await new Promise((r) => setTimeout(r, 80));
    expect(state.closed).toEqual(["stream-live"]);
  });

  it("still refuses a stream that isn't live, and someone else's", async () => {
    endTiming.roomCloseDelayMs = 0;
    const stream = seedLive();
    state.caller = "stranger";
    expect((await app.inject({ method: "POST", url: `/v1/streams/${stream._id}/end` })).statusCode).toBe(403);
    state.caller = "host";
    expect((await app.inject({ method: "POST", url: `/v1/streams/${stream._id}/end` })).statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: `/v1/streams/${stream._id}/end` });
    expect(again.statusCode).toBe(400);
    expect(state.closed).toEqual(["stream-live"]);
  });

  function host() {
    return db.User!.rows.find((r) => String(r._id) === String(HOST))!;
  }
});
