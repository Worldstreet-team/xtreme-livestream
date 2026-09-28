import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Going live is one tap (owner, 2026-09-28: "let them just click Live"): a
 * title is optional. The API names an untitled stream after its host, a
 * booking keeps the name it was booked under, and renaming a stream on air
 * reaches everyone watching — without the rename (or the studio's thumbnail
 * refresh) resetting anything it didn't send.
 */

const state = vi.hoisted(() => ({
  caller: "" as "" | "host",
  sent: [] as Array<{ room: string; data: Record<string, unknown> }>,
}));
const HOST = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  // The stream routes treat rows as hydrated documents (populate, toJSON).
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
    return { authUserId: "clerk_host", dbUser: User.rows.find((r) => String(r._id) === String(HOST)) };
  },
  getOptionalAuthUserId: () => (state.caller ? "clerk_host" : null),
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
  sendRoomData: async (room: string, data: Record<string, unknown>) => {
    state.sent.push({ room, data });
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
  relayLiveEvent: async () => true,
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { createStreamBodySchema, updateStreamBodySchema } = await import("@xtreme/contracts");
const { defaultStreamTitle } = await import("../src/stream-service.js");

beforeEach(() => {
  for (const m of Object.values(db)) m.reset();
  state.caller = "";
  state.sent = [];
  db.User!.insert({ _id: HOST, username: "amara", displayName: "Amara", avatar: "", isLive: false, followers: 0, settings: {}, safety: { mods: [] } });
});

describe("the stream contracts", () => {
  it("take a stream with no title, a blank one, or a real one", () => {
    expect(createStreamBodySchema.parse({ category: "Just Chatting" }).title).toBe("");
    expect(createStreamBodySchema.parse({ title: "   ", category: "Just Chatting" }).title).toBe("");
    expect(createStreamBodySchema.parse({ title: " Jollof night ", category: "Cooking" }).title).toBe("Jollof night");
    expect(() => createStreamBodySchema.parse({ title: "x".repeat(101), category: "IRL" })).toThrow();
  });

  it("change only what an update sends — no defaults sneak in", () => {
    // Zod 4 fills defaults inside .partial(): a thumbnail refresh used to
    // come out as { thumbnail, tags: [], source: "camera", postToWorldSpace: false, … }.
    expect(updateStreamBodySchema.parse({ thumbnail: "" })).toEqual({ thumbnail: "" });
    expect(updateStreamBodySchema.parse({ title: "" })).toEqual({ title: "" });
    expect(() => updateStreamBodySchema.parse({})).toThrow();
  });
});

describe("the default name", () => {
  it("is 'Live with' the host's display name, then their username, then the app", () => {
    expect(defaultStreamTitle({ displayName: "Amara", username: "amara" })).toBe("Live with Amara");
    expect(defaultStreamTitle({ displayName: "", username: "tolu" })).toBe("Live with tolu");
    expect(defaultStreamTitle({})).toBe("Live on Xtream");
    expect(defaultStreamTitle({ displayName: "A".repeat(120) }).length).toBe(100);
  });
});

describe("going live and renaming, through the routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  const call = (method: "POST" | "PATCH", url: string, payload?: unknown) =>
    app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });

  it("names an untitled stream after its host", async () => {
    state.caller = "host";
    const res = await call("POST", "/streams", { category: "Just Chatting" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stream.title).toBe("Live with Amara");
    expect(db.Stream!.rows[0]).toMatchObject({ title: "Live with Amara", category: "Just Chatting", isLive: true });
  });

  it("treats a blank title as no title, and keeps a real one", async () => {
    state.caller = "host";
    const blank = await call("POST", "/streams", { title: "   ", category: "IRL" });
    expect(blank.json().data.stream.title).toBe("Live with Amara");
    // Over before the next one (the fake can't run the route's own "end the old one").
    db.Stream!.rows[0]!.isLive = false;
    const named = await call("POST", "/streams", { title: "Market day in Balogun", category: "IRL" });
    expect(named.json().data.stream.title).toBe("Market day in Balogun");
  });

  it("starts a booking under the name it was booked with when none is given", async () => {
    state.caller = "host";
    const booked = db.Stream!.insert({
      streamerId: HOST,
      title: "Sunday cook-off",
      category: "Cooking",
      status: "upcoming",
      isLive: false,
      thumbnail: "",
      thumbnailVersion: 0,
    });
    const res = await call("POST", "/streams", { category: "Cooking", scheduledStreamId: String(booked._id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.stream.title).toBe("Sunday cook-off");
  });

  it("renames a live stream, tells the room, and leaves everything else alone", async () => {
    state.caller = "host";
    const live = await call("POST", "/streams", {
      category: "Just Chatting",
      source: "obs",
      postToWorldSpace: true,
      tags: ["amapiano"],
    });
    const id = live.json().data.stream.id as string;
    const room = db.Stream!.rows[0]!.livekitRoomName as string;

    const renamed = await call("PATCH", `/streams/${id}`, { title: "Friday vibes", category: "Music" });
    expect(renamed.statusCode).toBe(200);
    expect(state.sent).toEqual([{ room, data: { __evt: "details", title: "Friday vibes", category: "Music" } }]);
    expect(db.Stream!.rows[0]).toMatchObject({
      title: "Friday vibes",
      category: "Music",
      source: "obs",
      postToWorldSpace: true,
      tags: ["amapiano"],
    });

    // The studio's thumbnail refresh: no event, and nothing reset.
    state.sent = [];
    await call("PATCH", `/streams/${id}`, { thumbnail: "" });
    expect(state.sent).toEqual([]);
    expect(db.Stream!.rows[0]).toMatchObject({ title: "Friday vibes", source: "obs", postToWorldSpace: true, tags: ["amapiano"] });

    // Cleared again: back to the default name, and the room hears that too.
    await call("PATCH", `/streams/${id}`, { title: "" });
    expect(db.Stream!.rows[0]!.title).toBe("Live with Amara");
    expect(state.sent).toEqual([{ room, data: { __evt: "details", title: "Live with Amara", category: "Music" } }]);
  });

  it("says nothing to a room when the stream isn't live", async () => {
    state.caller = "host";
    const ended = db.Stream!.insert({
      streamerId: HOST,
      title: "Last week",
      category: "IRL",
      status: "ended",
      isLive: false,
      livekitRoomName: "stream-old",
      thumbnail: "",
      thumbnailVersion: 0,
    });
    const res = await call("PATCH", `/streams/${String(ended._id)}`, { title: "Last week, renamed" });
    expect(res.statusCode).toBe(200);
    expect(db.Stream!.rows[0]!.title).toBe("Last week, renamed");
    expect(state.sent).toEqual([]);
  });
});
