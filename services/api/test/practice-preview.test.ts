import crypto from "node:crypto";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Practice previews: the host of a practice run makes a secret link, and
 * anyone holding it can watch — only watch. The key is stored hashed and
 * never listed; a right key gets a hidden, subscribe-only token; a wrong,
 * missing, stopped, replaced or ended one gets nothing; and every way of
 * joining in (chat, likes, gifts, games, requests, the stage) is refused
 * on a practice stream for anyone but the host and their producers.
 */

const state = vi.hoisted(() => ({
  caller: "" as "" | "host" | "producer" | "stranger",
  tokens: [] as Array<{ room: string; identity: string; name: string; options: Record<string, unknown> }>,
  participants: [] as Array<{ identity: string }>,
  removed: [] as Array<{ room: string; identity: string }>,
  sent: [] as Array<Record<string, unknown>>,
}));
const HOST = new mongoose.Types.ObjectId();
const PRODUCER = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();
const ids = { host: HOST, producer: PRODUCER, stranger: STRANGER } as const;

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  class StreamModel extends FakeModel {
    insert(fields: Record<string, unknown>) {
      const row = super.insert(fields);
      Object.defineProperty(row, "populate", { value: async () => row, enumerable: false });
      // What Mongoose does for a `select: false` path on an ordinary read:
      // it isn't loaded, so it isn't in the page. (The schema itself is
      // checked against the real model below.)
      Object.defineProperty(row, "toJSON", {
        value: () => {
          const rest: Record<string, unknown> = { ...row };
          delete rest.previewKeyHash;
          delete rest.previewSharedAt;
          return rest;
        },
        enumerable: false,
      });
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
    "Sponsor", "Campaign", "CampaignMember", "Rundown", "Game", "GameEntry", "PointsLedger", "Payout", "RequestOrder",
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
  roomService: {
    listParticipants: async () => state.participants,
    removeParticipant: async (room: string, identity: string) => {
      state.removed.push({ room, identity });
      state.participants = state.participants.filter((p) => p.identity !== identity);
    },
  },
  ingressClient: {},
  webhookReceiver: { receive: async (body: string) => JSON.parse(body) },
  createToken: async (room: string, identity: string, name: string, options: Record<string, unknown>) => {
    state.tokens.push({ room, identity, name, options });
    return "token";
  },
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
vi.mock("../src/notifications.js", () => ({
  notifyFollowersOfLive: async () => {},
  notifyRemindersOfLive: async () => {},
}));
vi.mock("../src/socials-relay.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/socials-relay.js")>()),
  socialsRelayEnabled: () => false,
  relayLiveEvent: async () => true,
}));
vi.mock("../src/rules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/rules.js")>()),
  fireRules: async () => [],
}));
// Gifting is switched on, so the refusal is the practice run's, not the wallet's.
vi.mock("../src/wallet.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/wallet.js")>()),
  isWalletConfigured: () => true,
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { stopAllPractice } = await import("../src/practice.js");
const { markStreamEnded } = await import("../src/stream-service.js");
const { hashPreviewKey, redactPreviewKey } = await import("../src/preview.js");

function seedPeople() {
  db.User!.insert({
    _id: HOST,
    username: "amara",
    displayName: "Amara",
    avatar: "",
    isLive: false,
    followers: 0,
    following: 0,
    settings: {},
    safety: { mods: [{ userId: PRODUCER, username: "tolu", role: "producer" }] },
  });
  db.User!.insert({ _id: PRODUCER, username: "tolu", displayName: "Tolu", avatar: "", isLive: false, followers: 0, following: 0, settings: {} });
  db.User!.insert({ _id: STRANGER, username: "kemi", displayName: "Kemi", avatar: "", isLive: false, followers: 0, following: 0, settings: {} });
}

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
    requestsOpen: true,
    shield: { on: false },
    goal: null,
    previewKeyHash: null,
    previewSharedAt: null,
    ...fields,
  });
}

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => {
  stopAllPractice();
  await app.close();
});
beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  state.caller = "";
  state.tokens = [];
  state.participants = [];
  state.removed = [];
  state.sent = [];
  seedPeople();
});

// Each call from its own address: the routes' rate limits aren't what's under test here.
let caller = 0;
const address = () => `10.0.${(caller >> 8) & 255}.${caller++ & 255}`;
const call = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url: `/v1${url}`, remoteAddress: address(), ...(payload ? { payload } : {}) });

/** The host makes a link; the plaintext key comes back this once. */
async function share(streamId: unknown) {
  const was = state.caller;
  state.caller = "host";
  const res = await call("POST", `/streams/${streamId}/preview`);
  state.caller = was;
  expect(res.statusCode).toBe(200);
  return res.json().data as { key: string; path: string; sharedAt: string };
}

describe("making the link", () => {
  it("is the host's, for a live practice run only — and stores a hash, never the key", async () => {
    const stream = seedPractice();
    for (const caller of ["", "stranger", "producer"] as const) {
      state.caller = caller;
      const res = await call("POST", `/streams/${stream._id}/preview`);
      expect(res.statusCode).toBe(caller ? 403 : 401);
    }

    const { key, path, sharedAt } = await share(stream._id);
    // 24 random bytes, base64url: 192 bits.
    expect(key).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(path).toBe(`/stream/${stream._id}?preview=${key}`);
    expect(Date.parse(sharedAt)).not.toBeNaN();
    expect(stream.previewKeyHash).toBe(crypto.createHash("sha256").update(key).digest("hex"));
    expect(stream.previewKeyHash).toBe(hashPreviewKey(key));
    expect(JSON.stringify(stream)).not.toContain(key);

    // A new link is a new key.
    const again = await share(stream._id);
    expect(again.key).not.toBe(key);
    expect(stream.previewKeyHash).toBe(hashPreviewKey(again.key));
  });

  it("is refused for a real stream and for a run that isn't on", async () => {
    const real = seedPractice({ practice: false, livekitRoomName: "stream-real" });
    const over = seedPractice({ isLive: false, status: "ended", livekitRoomName: "practice-over" });
    state.caller = "host";
    const a = await call("POST", `/streams/${real._id}/preview`);
    expect(a.statusCode).toBe(409);
    expect(a.json().code).toBe("NOT_PRACTICE");
    const b = await call("POST", `/streams/${over._id}/preview`);
    expect(b.statusCode).toBe(409);
    expect(b.json().code).toBe("NOT_LIVE");
    expect(real.previewKeyHash ?? null).toBeNull();
    expect(over.previewKeyHash).toBeNull();
  });

  it("tells the host whether it's out and how many are watching — a count, never who", async () => {
    const stream = seedPractice();
    state.caller = "host";
    expect((await call("GET", `/streams/${stream._id}/preview`)).json().data).toEqual({ shared: false, sharedAt: null, watching: 0 });
    await share(stream._id);
    state.participants = [{ identity: String(HOST) }, { identity: "pv-abc-1" }, { identity: `prod-${PRODUCER}` }];
    const status = (await call("GET", `/streams/${stream._id}/preview`)).json().data;
    expect(status).toMatchObject({ shared: true, watching: 1 });
    expect(JSON.stringify(status)).not.toContain("pv-abc-1");
    state.caller = "stranger";
    expect((await call("GET", `/streams/${stream._id}/preview`)).statusCode).toBe(403);
  });
});

describe("watching on the link", () => {
  it("a right key gets a hidden, subscribe-only token — signed out or in, and no join line", async () => {
    const stream = seedPractice();
    const { key } = await share(stream._id);

    for (const caller of ["", "stranger"] as const) {
      state.caller = caller;
      const res = await call("GET", `/streams/${stream._id}/token?previewKey=${key}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({ token: "token", roomName: stream.livekitRoomName, preview: true });
    }
    expect(state.tokens).toHaveLength(2);
    for (const t of state.tokens) {
      expect(t.identity).toMatch(/^pv-[a-z0-9]+-[0-9a-f-]{36}$/);
      // Never the viewer's own id, even signed in: nothing accrues to it.
      expect(t.identity).not.toContain(String(STRANGER));
      expect(t.options).toMatchObject({ canPublish: false, canSubscribe: true, canPublishData: false, hidden: true, ttl: "15m" });
    }
    expect(state.sent.filter((d) => d.__evt === "join")).toEqual([]);

    // …and the page's details, which are otherwise a 404.
    const page = await call("GET", `/streams/${stream._id}?previewKey=${key}`);
    expect(page.statusCode).toBe(200);
    expect(page.json().data.stream).toMatchObject({ title: "Dress rehearsal", practice: true });
    expect(page.body).not.toContain("previewKeyHash");
    expect(page.body).not.toContain(key);
  });

  it("a wrong or missing key gets 403 on the token and 404 on the page", async () => {
    const stream = seedPractice();
    const { key } = await share(stream._id);
    const wrong = crypto.randomBytes(24).toString("base64url");
    const tampered = `${key.slice(0, -1)}${key.endsWith("A") ? "B" : "A"}`;
    for (const caller of ["", "stranger"] as const) {
      state.caller = caller;
      for (const q of ["", `?previewKey=${wrong}`, `?previewKey=${tampered}`, "?previewKey=", `?previewKey=${hashPreviewKey(key)}`]) {
        const res = await call("GET", `/streams/${stream._id}/token${q}`);
        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe("PRACTICE_PRIVATE");
        expect((await call("GET", `/streams/${stream._id}${q}`)).statusCode).toBe(404);
      }
    }
    expect(state.tokens).toEqual([]);
  });

  it("a key for one practice run opens no other", async () => {
    const mine = seedPractice();
    const other = seedPractice({ livekitRoomName: "practice-other" });
    const { key } = await share(mine._id);
    await share(other._id);
    expect((await call("GET", `/streams/${other._id}/token?previewKey=${key}`)).statusCode).toBe(403);
  });

  it("stopped sharing: the link is dead and whoever watched is taken out", async () => {
    const stream = seedPractice();
    const { key } = await share(stream._id);
    await call("GET", `/streams/${stream._id}/token?previewKey=${key}`);
    state.participants = [{ identity: String(HOST) }, { identity: state.tokens[0]!.identity }];

    state.caller = "stranger";
    expect((await call("DELETE", `/streams/${stream._id}/preview`)).statusCode).toBe(403);
    state.caller = "host";
    const res = await call("DELETE", `/streams/${stream._id}/preview`);
    expect(res.statusCode).toBe(200);
    expect(stream.previewKeyHash).toBeNull();
    expect(state.removed.map((r) => r.identity)).toEqual([state.tokens[0]!.identity]);

    state.caller = "";
    expect((await call("GET", `/streams/${stream._id}/token?previewKey=${key}`)).statusCode).toBe(403);
    expect((await call("GET", `/streams/${stream._id}?previewKey=${key}`)).statusCode).toBe(404);
  });

  it("a new link retires the old one and its viewers", async () => {
    const stream = seedPractice();
    const first = await share(stream._id);
    await call("GET", `/streams/${stream._id}/token?previewKey=${first.key}`);
    const oldViewer = state.tokens[0]!.identity;
    state.participants = [{ identity: oldViewer }];
    // Two links made in the same millisecond would share a generation.
    await new Promise((r) => setTimeout(r, 2));
    const second = await share(stream._id);
    await new Promise((r) => setTimeout(r, 0));
    expect(state.removed.map((r) => r.identity)).toEqual([oldViewer]);
    expect((await call("GET", `/streams/${stream._id}/token?previewKey=${first.key}`)).statusCode).toBe(403);
    expect((await call("GET", `/streams/${stream._id}/token?previewKey=${second.key}`)).statusCode).toBe(200);
  });

  it("the run ended: the key is cleared, the link is dead, the viewers are out", async () => {
    const stream = seedPractice();
    const { key } = await share(stream._id);
    await call("GET", `/streams/${stream._id}/token?previewKey=${key}`);
    state.participants = [{ identity: state.tokens[0]!.identity }];

    state.caller = "host";
    expect((await call("POST", `/streams/${stream._id}/end`)).statusCode).toBe(200);
    expect(stream).toMatchObject({ isLive: false, previewKeyHash: null, previewSharedAt: null });
    expect(state.removed).toHaveLength(1);

    state.caller = "";
    expect((await call("GET", `/streams/${stream._id}/token?previewKey=${key}`)).statusCode).toBe(403);
    expect((await call("GET", `/streams/${stream._id}?previewKey=${key}`)).statusCode).toBe(404);
  });

  it("ending by any path clears it (markStreamEnded)", async () => {
    const stream = seedPractice();
    await share(stream._id);
    await markStreamEnded(stream as never);
    expect(stream.previewKeyHash).toBeNull();
  });

  it("the webhook turns away a preview identity from a stopped or replaced link", async () => {
    const stream = seedPractice();
    const { key } = await share(stream._id);
    await call("GET", `/streams/${stream._id}/token?previewKey=${key}`);
    const current = state.tokens[0]!.identity;
    const joined = (identity: string) =>
      app.inject({
        method: "POST",
        url: "/v1/webhooks/livekit",
        headers: { "content-type": "application/webhook+json", authorization: "signed" },
        payload: JSON.stringify({ event: "participant_joined", room: { name: stream.livekitRoomName }, participant: { identity } }),
      });

    await joined(current);
    await new Promise((r) => setTimeout(r, 5));
    expect(state.removed).toEqual([]);

    await joined("pv-oldgen-00000000-0000-0000-0000-000000000000");
    await new Promise((r) => setTimeout(r, 5));
    expect(state.removed.map((r) => r.identity)).toEqual(["pv-oldgen-00000000-0000-0000-0000-000000000000"]);
  });

  it("the key is never in a list: practice runs aren't listed, and the page leaves it out", async () => {
    const stream = seedPractice();
    const { key } = await share(stream._id);
    for (const url of ["/streams?live=true", "/streams?streamer=amara", "/streams"]) {
      const res = await call("GET", url);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain(key);
      expect(res.body).not.toContain(String(stream.previewKeyHash));
      expect(res.json().data.streams).toEqual([]);
    }
    state.caller = "host";
    const own = await call("GET", `/streams/${stream._id}`);
    expect(own.statusCode).toBe(200);
    expect(own.body).not.toContain("previewKeyHash");
    const mine = await call("GET", "/streams/active/mine");
    expect(mine.body).not.toContain("previewKeyHash");
    expect(mine.body).not.toContain(key);
  });
});

describe("the key is never written down", () => {
  it("is taken out of the request line the API logs", () => {
    const key = "abcDEF123_-abcDEF123_-abcDEF123_";
    expect(redactPreviewKey(`/v1/streams/x/token?previewKey=${key}`)).toBe("/v1/streams/x/token?previewKey=[REDACTED]");
    expect(redactPreviewKey(`/v1/streams/x?platform=xstream&previewKey=${key}&monitor=1`)).toBe(
      "/v1/streams/x?platform=xstream&previewKey=[REDACTED]&monitor=1",
    );
    expect(redactPreviewKey("/v1/streams/x/token?preview=true")).toBe("/v1/streams/x/token?preview=true");
  });
});

describe("a practice run is watch-only for everyone but its crew", () => {
  it("refuses chat, likes, gifts, requests and the stage", async () => {
    const stream = seedPractice();
    state.caller = "stranger";
    const tries: Array<[("POST" | "DELETE"), string, unknown?]> = [
      ["POST", `/streams/${stream._id}/chat`, { content: "hello" }],
      ["POST", `/streams/${stream._id}/chat`, { content: "🔥", type: "reaction" }],
      ["POST", `/streams/${stream._id}/like`],
      ["DELETE", `/streams/${stream._id}/like`],
      ["POST", `/streams/${stream._id}/gifts`, { amountUsdMinor: 100 }],
      ["POST", `/streams/${stream._id}/requests`, { itemId: "song" }],
      ["POST", `/streams/${stream._id}/guests/request`],
    ];
    for (const [method, url, body] of tries) {
      const res = await call(method, url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code, `${method} ${url}`).toBe("PRACTICE_WATCH_ONLY");
    }
    expect(db.ChatMessage!.rows).toEqual([]);
    expect(db.StreamLike!.rows).toEqual([]);
    expect(db.GiftTransaction!.rows).toEqual([]);
    expect(db.RequestOrder!.rows).toEqual([]);
    expect(stream.likes).toBe(0);
    expect(stream.guests).toEqual([]);
    expect(state.sent).toEqual([]);
  });

  it("refuses a game entry (predictions, raffles, quizzes)", async () => {
    const stream = seedPractice();
    const game = db.Game!.insert({
      streamId: stream._id,
      hostId: HOST,
      type: "raffle",
      status: "open",
      question: "Who wins the mic?",
      outcomes: [{ id: "ticket", label: "Ticket", points: 0, entries: 0 }],
      closesAt: new Date(Date.now() + 60_000),
      poolPoints: 0,
      entries: 0,
      ticketPoints: 0,
    });
    state.caller = "stranger";
    const res = await call("POST", `/games/${game._id}/enter`, { outcome: "ticket" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("PRACTICE_WATCH_ONLY");
    expect(db.GameEntry!.rows).toEqual([]);
  });

  it("an ally made during a rehearsal is an ally — but the rehearsal's goal doesn't hear of it", async () => {
    const stream = seedPractice({
      goal: { id: "g1", kind: "allies", title: "10 allies", target: 10, milestones: [], progress: 0, startedAt: new Date(), reachedAt: null, endedAt: null, rev: 1 },
    });
    state.caller = "stranger";
    const res = await call("POST", "/user/amara/follow");
    expect(res.statusCode).toBe(200);
    expect(db.Follow!.rows).toHaveLength(1);
    expect((stream.goal as { progress: number }).progress).toBe(0);
    expect(state.sent.filter((d) => d.__evt === "goal")).toEqual([]);
  });

  it("the host and their producers still rehearse: chat goes through", async () => {
    const stream = seedPractice();
    for (const caller of ["host", "producer"] as const) {
      state.caller = caller;
      const res = await call("POST", `/streams/${stream._id}/chat`, { content: `from the ${caller}` });
      expect(res.statusCode, caller).toBe(200);
    }
    expect(db.ChatMessage!.rows).toHaveLength(2);
  });

  it("a real stream is untouched: a stranger's chat and like land", async () => {
    const stream = seedPractice({ practice: false, livekitRoomName: "stream-real" });
    state.caller = "stranger";
    expect((await call("POST", `/streams/${stream._id}/chat`, { content: "hello" })).statusCode).toBe(200);
    expect((await call("POST", `/streams/${stream._id}/like`)).statusCode).toBe(200);
    expect(stream.likes).toBe(1);
  });
});
