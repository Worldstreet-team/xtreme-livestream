import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import mongoose from "mongoose";

/**
 * The safety kit end to end, on an in-memory model: held lines reach only
 * the host and moderators; blocked lines are never saved; moderators are
 * exempt, act only on viewers, and put lines on screen as the host allows;
 * Shield; managing moderators; reports with a 48-hour clock and admin
 * takedowns.
 */

const oid = (hex: string) => new mongoose.Types.ObjectId(hex);
const HOST = "a".repeat(24);
const LEAD = "1".repeat(24);
const MOD = "2".repeat(24);
const VIEWER = "b".repeat(24);
const NEWBIE = "3".repeat(24);
const BOSS = "4".repeat(24);
const STREAM = "d".repeat(24);

type Doc = Record<string, unknown> & { _id: mongoose.Types.ObjectId };

const S = vi.hoisted(() => {
  process.env.ADMIN_USERNAMES = "boss";
  return {
    caller: "" as string,
    users: new Map<string, Record<string, unknown>>(),
    streams: new Map<string, Record<string, unknown>>(),
    messages: [] as Array<Record<string, unknown>>,
    reports: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
    audits: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    targeted: [] as Array<{ to: string[]; payload: Record<string, unknown> }>,
    closed: [] as string[],
    follows: new Set<string>(),
  };
});

/** A Mongoose-ish query: chainable, awaitable, .lean()-able. */
function query<T>(get: () => T) {
  const chain: Record<string, unknown> = {};
  for (const k of ["sort", "select", "limit", "skip", "populate"]) chain[k] = () => chain;
  chain.lean = async () => get();
  chain.then = (res: (v: T) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(get).then(res, rej);
  return chain;
}

function read(doc: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), doc);
}
function write(doc: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let o = doc as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = (o[k] ??= {}) as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}
function same(a: unknown, b: unknown) {
  return a == null ? b == null : String(a) === String(b);
}
function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, want]) => {
    if (key === "$or") return (want as Record<string, unknown>[]).some((f) => matches(doc, f));
    const have = read(doc, key);
    if (want && typeof want === "object" && !(want instanceof mongoose.Types.ObjectId)) {
      const w = want as Record<string, unknown>;
      if ("$in" in w) return (w.$in as unknown[]).some((v) => same(have, v));
      if ("$ne" in w) {
        if (key.endsWith(".messageId")) {
          const list = read(doc, key.split(".")[0]) as Array<Record<string, unknown>>;
          return !list.some((q) => same(q.messageId, w.$ne));
        }
        return !same(have, w.$ne);
      }
      if ("$lt" in w) return have != null && String(have) < String(w.$lt);
    }
    if (want === null) return have == null;
    return same(have, want);
  });
}
function userDoc(id: string, username: string, extra: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: oid(id),
    username,
    displayName: username[0].toUpperCase() + username.slice(1),
    avatar: "",
    createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    settings: { slowMode: false, subscriberOnly: false, profanityFilter: true },
    ...extra,
  };
  doc.set = (path: string, value: unknown) => write(doc, path, value);
  doc.save = async () => doc;
  return doc;
}

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: `clerk_${S.caller}`, dbUser: S.users.get(S.caller) }),
  getOptionalAuthUserId: () => (S.caller ? `clerk_${S.caller}` : null),
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
    S.events.push(payload);
  },
  sendRoomDataTo: async (_room: string, to: string[], payload: Record<string, unknown>) => {
    S.targeted.push({ to, payload });
  },
  closeRoom: async (room: string) => {
    S.closed.push(room);
  },
}));

vi.mock("../src/stream-service.js", () => ({
  reconcileStream: async (s: { isLive: boolean }) => s.isLive,
  reconcileLeanStreams: async () => new Set(),
  markStreamEnded: async (s: Record<string, unknown>) => {
    s.isLive = false;
    s.status = "ended";
  },
  thumbnailUrlFor: () => null,
  accrueViewerSeconds: () => {},
  parseImageDataUri: () => null,
}));

vi.mock("../src/models.js", () => {
  const byId = (map: Map<string, Record<string, unknown>>) => (id: unknown) => query(() => map.get(String(id)) ?? null);
  return {
    User: {
      findById: byId(S.users),
      findOne: (q: Record<string, unknown>) => query(() => [...S.users.values()].find((u) => matches(u, q)) ?? null),
      find: (q: Record<string, unknown>) => query(() => [...S.users.values()].filter((u) => matches(u, q))),
      findByIdAndUpdate: async (id: unknown, update: { $set: Record<string, unknown> }) => {
        const u = S.users.get(String(id))!;
        for (const [k, v] of Object.entries(update.$set)) write(u, k, v);
        return u;
      },
      updateOne: async (q: { _id: unknown }, update: { $set: Record<string, unknown> }) => {
        const u = S.users.get(String(q._id));
        if (u) for (const [k, v] of Object.entries(update.$set)) write(u, k, v);
        return {};
      },
    },
    Stream: {
      findById: byId(S.streams),
      find: (q: Record<string, unknown>) => query(() => [...S.streams.values()].filter((d) => matches(d, q))),
      findOne: (q: Record<string, unknown>) => query(() => [...S.streams.values()].find((s) => matches(s, q)) ?? null),
      findByIdAndUpdate: (id: unknown, update: Record<string, Record<string, unknown>>) =>
        query(() => {
          const s = S.streams.get(String(id))!;
          const pull = update.$pull?.featureQueue as { messageId: unknown } | undefined;
          if (pull) s.featureQueue = (s.featureQueue as Doc[]).filter((q) => !same(q.messageId, pull.messageId));
          return s;
        }),
      updateOne: async (q: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
        const s = [...S.streams.values()].find((d) => matches(d, q));
        if (!s) return {};
        if (update.$push?.featureQueue) {
          const each = (update.$push.featureQueue as { $each: unknown[] }).$each;
          s.featureQueue = [...(s.featureQueue as unknown[]), ...each].slice(-20);
        }
        const pull = update.$pull?.featureQueue as { messageId: unknown } | undefined;
        if (pull) s.featureQueue = (s.featureQueue as Doc[]).filter((d) => !same(d.messageId, pull.messageId));
        for (const [k, v] of Object.entries(update.$set ?? {})) write(s, k, v);
        return {};
      },
      findOneAndUpdate: (q: Record<string, unknown>, update: Record<string, Record<string, unknown>>) =>
        query(() => {
          const s = [...S.streams.values()].find((d) => matches(d, q));
          if (!s) return null;
          for (const [k, v] of Object.entries(update.$set ?? {})) write(s, k, v);
          for (const [k, v] of Object.entries(update.$inc ?? {})) write(s, k, Number(read(s, k) ?? 0) + Number(v));
          return s;
        }),
    },
    ChatMessage: {
      create: async (doc: Record<string, unknown>) => {
        const row = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...doc };
        S.messages.push(row);
        return row;
      },
      findOne: (q: Record<string, unknown>) => query(() => S.messages.find((m) => matches(m, q)) ?? null),
      find: (q: Record<string, unknown>) => query(() => S.messages.filter((m) => matches(m, q))),
      findOneAndUpdate: (q: Record<string, unknown>, update: { $set: Record<string, unknown> }) =>
        query(() => {
          const m = S.messages.find((d) => matches(d, q));
          if (m) Object.assign(m, update.$set);
          return m ?? null;
        }),
      findOneAndDelete: async (q: Record<string, unknown>) => {
        const i = S.messages.findIndex((m) => matches(m, q));
        return i >= 0 ? S.messages.splice(i, 1)[0] : null;
      },
      deleteOne: async (q: Record<string, unknown>) => {
        const i = S.messages.findIndex((m) => matches(m, q));
        if (i >= 0) S.messages.splice(i, 1);
        return {};
      },
      deleteMany: async (q: Record<string, unknown>) => {
        S.messages = S.messages.filter((m) => !matches(m, q));
        return {};
      },
      exists: async () => null,
    },
    Follow: {
      exists: async (q: { followerId: unknown; followingId: unknown }) =>
        S.follows.has(`${q.followerId}:${q.followingId}`) ? { _id: "f" } : null,
    },
    StreamBan: { findOne: async () => null, findOneAndUpdate: async () => ({ username: "viewer" }) },
    Notification: {
      create: async (doc: Record<string, unknown>) => S.notifications.push(doc),
      insertMany: async (docs: Record<string, unknown>[]) => S.notifications.push(...docs),
    },
    Report: {
      updateOne: async (q: Record<string, unknown>, update: Record<string, Record<string, unknown>>) => {
        const existing = S.reports.find((r) => matches(r, q));
        if (existing) {
          Object.assign(existing, update.$set);
          return { upsertedCount: 0 };
        }
        S.reports.push({ _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...update.$setOnInsert, ...update.$set });
        return { upsertedCount: 1 };
      },
      find: (q: Record<string, unknown>) =>
        query(() => S.reports.filter((r) => matches(r, q)).sort((a, b) => (a.dueAt as Date).getTime() - (b.dueAt as Date).getTime())),
      findById: async (id: unknown) => S.reports.find((r) => same(r._id, id)) ?? null,
      updateMany: async (q: Record<string, unknown>, update: { $set: Record<string, unknown> }) => {
        const hit = S.reports.filter((r) => matches(r, q));
        hit.forEach((r) => Object.assign(r, update.$set));
        return { modifiedCount: hit.length };
      },
    },
    AuditLog: { create: async (doc: Record<string, unknown>) => S.audits.push(doc) },
    StreamLike: {},
    GiftTransaction: {},
  };
});

describe("the safety kit", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    S.users.clear();
    S.users.set(
      HOST,
      userDoc(HOST, "host", {
        safety: {
          filters: { profanity: "off", insults: "off", slurs: "block", sexual: "hold", links: "hold", scams: "block" },
          blockedTerms: [],
          blockedTermsLevel: "block",
          mods: [
            { userId: oid(LEAD), username: "lead", role: "lead", addedAt: new Date() },
            { userId: oid(MOD), username: "mod", role: "mod", addedAt: new Date() },
          ],
          modsCanFeature: "suggest",
        },
      }),
    );
    S.users.set(LEAD, userDoc(LEAD, "lead"));
    S.users.set(MOD, userDoc(MOD, "mod"));
    S.users.set(VIEWER, userDoc(VIEWER, "viewer"));
    S.users.set(NEWBIE, userDoc(NEWBIE, "newbie", { createdAt: new Date() }));
    S.users.set(BOSS, userDoc(BOSS, "boss"));
    S.streams.clear();
    const stream: Record<string, unknown> = {
      _id: oid(STREAM),
      streamerId: oid(HOST),
      isLive: true,
      title: "Friday set",
      livekitRoomName: "room-1",
      shield: { on: false, at: null, by: null },
      featureQueue: [],
      takenDownAt: null,
      scene: { layout: "auto", card: null, cardNote: "", layers: [], featured: null, version: 1 },
    };
    stream.save = async () => stream;
    S.streams.set(STREAM, stream);
    S.messages = [];
    S.reports.length = 0;
    S.notifications.length = 0;
    S.audits.length = 0;
    S.events.length = 0;
    S.targeted.length = 0;
    S.closed.length = 0;
    S.follows.clear();
  });

  const as = (who: string) => {
    S.caller = who;
  };
  const chat = (content: string) => app.inject({ method: "POST", url: `/v1/streams/${STREAM}/chat`, payload: { content, type: "text" } });
  const post = (url: string, payload: Record<string, unknown> = {}) => app.inject({ method: "POST", url: `/v1${url}`, payload });
  const del = (url: string) => app.inject({ method: "DELETE", url: `/v1${url}` });
  // Each also as a producer-mode console (prod-<id>).
  const moderators = [HOST, `mon-${HOST}`, `prod-${HOST}`, LEAD, MOD, `prod-${LEAD}`, `prod-${MOD}`];

  describe("held and blocked lines", () => {
    it("holds a filtered line for the host and moderators only, and tells its writer", async () => {
      as(VIEWER);
      const response = await chat("check www.freestuff.xyz");

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ held: true, reason: "Link" });
      expect(S.messages[0]).toMatchObject({ status: "held", heldReason: "links" });
      expect(S.events).toEqual([]);
      expect(S.targeted[0]).toMatchObject({ to: moderators, payload: { __evt: "held", message: { heldLabel: "Link" } } });
    });

    it("never saves a blocked line", async () => {
      as(VIEWER);
      const response = await chat("send it to 0x52908400098527886E0F7030069857D2E4169EE7");

      expect(response.statusCode).toBe(422);
      expect(S.messages).toEqual([]);
    });

    it("lets moderators through, wearing their badge", async () => {
      as(MOD);
      const response = await chat("rules are at www.example.xyz");

      expect(response.json().data.held).toBeUndefined();
      expect(S.events[0]).toMatchObject({ content: "rules are at www.example.xyz", isMod: true });
    });

    it("keeps held lines out of history until a moderator lets one in", async () => {
      as(VIEWER);
      await chat("check www.freestuff.xyz");
      const held = String(S.messages[0]._id);

      as(VIEWER);
      const before = await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/chat` });
      expect(before.statusCode).toBe(200);

      as(MOD);
      expect((await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/chat/held` })).json().data.held).toHaveLength(1);
      const approved = await post(`/streams/${STREAM}/chat/${held}/approve`);

      expect(approved.statusCode).toBe(200);
      expect(S.messages[0].status).toBe("visible");
      expect(S.events.at(-1)).toMatchObject({ id: held, content: "check www.freestuff.xyz" });
      expect(S.targeted.at(-1)).toMatchObject({ to: [...moderators, VIEWER], payload: { __evt: "held_resolved", outcome: "approved" } });
      expect(S.audits.at(-1)).toMatchObject({ action: "chat.approve" });
    });

    it("turns a held line down, telling the moderators and its writer", async () => {
      as(VIEWER);
      await chat("check www.freestuff.xyz");
      const held = String(S.messages[0]._id);

      as(LEAD);
      const denied = await del(`/streams/${STREAM}/chat/${held}`);

      expect(denied.statusCode).toBe(200);
      expect(S.messages).toEqual([]);
      expect(S.targeted.at(-1)).toMatchObject({ payload: { __evt: "held_resolved", messageId: held, outcome: "denied" } });
      expect(S.audits.at(-1)).toMatchObject({ action: "chat.deny" });
    });

    it("refuses the held queue to viewers", async () => {
      as(VIEWER);
      expect((await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/chat/held` })).statusCode).toBe(403);
    });
  });

  describe("Shield", () => {
    it("is raised by the host or a lead, not a moderator", async () => {
      as(MOD);
      expect((await post(`/streams/${STREAM}/shield`, { on: true })).statusCode).toBe(403);
      as(LEAD);
      expect((await post(`/streams/${STREAM}/shield`, { on: true })).statusCode).toBe(200);
      expect(S.events.at(-1)).toMatchObject({ __evt: "shield", on: true });
    });

    it("keeps chat to allies and holds brand-new accounts", async () => {
      as(HOST);
      await post(`/streams/${STREAM}/shield`, { on: true });

      as(VIEWER);
      expect((await chat("hi")).json().code).toBe("FOLLOWERS_ONLY");

      S.follows.add(`${VIEWER}:${HOST}`);
      S.follows.add(`${NEWBIE}:${HOST}`);
      expect((await chat("hi")).json().data.held).toBeUndefined();
      as(NEWBIE);
      expect((await chat("hi")).json().data).toMatchObject({ held: true, reason: "New account (Shield)" });
    });
  });

  describe("roles and moderators", () => {
    it("tells each person their role in the room", async () => {
      as(MOD);
      const role = await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/role` });
      expect(role.json().data).toMatchObject({ role: "mod", modsCanFeature: "suggest", shield: false });
      as(VIEWER);
      expect((await app.inject({ method: "GET", url: `/v1/streams/${STREAM}/role` })).json().data.role).toBeNull();
    });

    it("lets the host add moderators by username, and tells them", async () => {
      as(HOST);
      const response = await post(`/channels/${HOST}/mods`, { username: "viewer", role: "mod" });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.mods.map((m: { username: string }) => m.username)).toEqual(["lead", "mod", "viewer"]);
      expect(S.notifications[0]).toMatchObject({ type: "mod_added", streamId: null });
      expect(S.audits.at(-1)).toMatchObject({ action: "mods.add" });
    });

    it("lets a lead add moderators but not leads, nor remove a lead", async () => {
      as(LEAD);
      expect((await post(`/channels/${HOST}/mods`, { username: "viewer", role: "lead" })).statusCode).toBe(403);
      expect((await post(`/channels/${HOST}/mods`, { username: "viewer", role: "mod" })).statusCode).toBe(200);
      as(MOD);
      expect((await post(`/channels/${HOST}/mods`, { username: "newbie" })).statusCode).toBe(403);
      expect((await del(`/channels/${HOST}/mods/${LEAD}`)).statusCode).toBe(403);
    });

    it("lets a moderator step down", async () => {
      as(MOD);
      const response = await del(`/channels/${HOST}/mods/${MOD}`);
      expect(response.json().data.mods.map((m: { username: string }) => m.username)).toEqual(["lead"]);
      expect(S.audits.at(-1)).toMatchObject({ action: "mods.step_down" });
    });
  });

  describe("what moderators can do", () => {
    it("act on viewers, never on the host or another moderator", async () => {
      as(HOST);
      await chat("host here");
      as(VIEWER);
      await chat("hello");
      const [hostLine, viewerLine] = S.messages.map((m) => String(m._id));

      as(MOD);
      expect((await del(`/streams/${STREAM}/chat/${hostLine}`)).statusCode).toBe(403);
      expect((await del(`/streams/${STREAM}/chat/${viewerLine}`)).statusCode).toBe(200);
      expect((await post(`/streams/${STREAM}/ban/${LEAD}`, { minutes: 10 })).json().code).toBe("TARGET_IS_MOD");
      expect((await post(`/streams/${STREAM}/ban/${VIEWER}`, { minutes: 10 })).statusCode).toBe(200);
      expect(S.audits.map((a) => a.action)).toEqual(["chat.delete", "chat.timeout"]);
    });

    it("suggest lines for the screen, which the host puts up or turns down", async () => {
      as(VIEWER);
      await chat("GG");
      const line = String(S.messages[0]._id);

      as(MOD);
      const suggested = await post(`/streams/${STREAM}/chat/${line}/feature`, { seconds: 20 });
      expect(suggested.json().data).toMatchObject({ suggested: true, queue: [{ messageId: line, suggestedBy: "mod" }] });
      expect((S.streams.get(STREAM)!.scene as Record<string, unknown>).featured).toBeNull();
      expect(S.targeted.at(-1)).toMatchObject({ to: moderators, payload: { __evt: "feature_queue" } });

      as(HOST);
      const up = await post(`/streams/${STREAM}/chat/${line}/feature`, { seconds: 20 });
      expect(up.json().data.scene.featured).toMatchObject({ id: line });
      expect(S.streams.get(STREAM)!.featureQueue).toEqual([]);
    });

    it("put lines up directly when the host allows it, and not at all when they don't", async () => {
      as(VIEWER);
      await chat("GG");
      const line = String(S.messages[0]._id);
      const host = S.users.get(HOST)! as { safety: { modsCanFeature: string } };

      host.safety.modsCanFeature = "on";
      as(MOD);
      expect((await post(`/streams/${STREAM}/chat/${line}/feature`, { seconds: 10 })).json().data.scene.featured).toMatchObject({ id: line });

      host.safety.modsCanFeature = "off";
      expect((await post(`/streams/${STREAM}/chat/${line}/feature`, { seconds: 10 })).statusCode).toBe(403);
    });
  });

  describe("reports and takedowns", () => {
    it("takes a chat line report with its words and a 48-hour clock, and tells the admins", async () => {
      as(VIEWER);
      await chat("GG");
      const line = String(S.messages[0]._id);
      as(MOD);
      const before = Date.now();
      const response = await post(`/streams/${STREAM}/report`, { reason: "harassment", messageId: line });

      expect(response.statusCode).toBe(200);
      expect(S.reports[0]).toMatchObject({ message: { username: "viewer", content: "GG" }, status: "open" });
      const due = (S.reports[0].dueAt as Date).getTime() - before;
      expect(due).toBeGreaterThan(47.9 * 3600 * 1000);
      expect(due).toBeLessThanOrEqual(48 * 3600 * 1000 + 1000);
      expect(S.notifications).toEqual([expect.objectContaining({ type: "report", userId: oid(BOSS) })]);
    });

    it("refuses reporting your own line", async () => {
      as(VIEWER);
      await chat("GG");
      const response = await post(`/streams/${STREAM}/report`, { reason: "spam", messageId: String(S.messages[0]._id) });
      expect(response.json().code).toBe("SELF_REPORT");
    });

    it("keeps the queue to admins", async () => {
      as(VIEWER);
      expect((await app.inject({ method: "GET", url: "/v1/admin/reports" })).statusCode).toBe(403);
      as(BOSS);
      expect((await app.inject({ method: "GET", url: "/v1/admin/me" })).json().data.admin).toBe(true);
    });

    it("takes a live stream down: ended, room closed, kept out of listings, every report on it resolved", async () => {
      as(VIEWER);
      await post(`/streams/${STREAM}/report`, { reason: "violence" });
      as(MOD);
      await post(`/streams/${STREAM}/report`, { reason: "violence" });

      as(BOSS);
      const queue = await app.inject({ method: "GET", url: "/v1/admin/reports" });
      expect(queue.json().data.reports).toHaveLength(2);
      expect(queue.json().data.reports[0]).toMatchObject({ reports: 2, overdue: false, stream: { title: "Friday set", isLive: true } });

      const id = queue.json().data.reports[0].id;
      const response = await post(`/admin/reports/${id}/resolve`, { action: "takedown", note: "violent threats" });

      expect(response.json().data.resolved).toBe(2);
      const stream = S.streams.get(STREAM)!;
      expect(stream.isLive).toBe(false);
      expect(stream.takenDownAt).toBeInstanceOf(Date);
      expect(S.closed).toEqual(["room-1"]);
      expect(S.events.at(-1)).toEqual({ __evt: "takedown" });
      expect(S.reports.every((r) => r.status === "actioned")).toBe(true);
      expect(S.audits.at(-1)).toMatchObject({ action: "report.takedown" });
    });
  });
});
