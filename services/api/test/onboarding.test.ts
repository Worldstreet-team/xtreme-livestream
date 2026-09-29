import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The first-run flow (v2): each step saves without finishing so it can
 * resume, Skip records itself, finishing lands the welcome points once, the
 * @username check answers as you type, and the creators to follow lead
 * with who's live in your picks.
 */

const state = vi.hoisted(() => ({ signedIn: true, granted: true }));
const ME = new mongoose.Types.ObjectId();
const LIVE_HOST = new mongoose.Types.ObjectId();
const QUIET = new mongoose.Types.ObjectId();
const FOLLOWED = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  const Stream = new FakeModel("Stream") as unknown as Record<string, unknown>;
  Stream.aggregate = async () => [];
  return {
    Stream,
    User: new FakeModel("User"),
    Follow: new FakeModel("Follow"),
    GiftTransaction: new FakeModel("GiftTransaction"),
    Impression: new FakeModel("Impression"),
    StreamReminder: new FakeModel("StreamReminder"),
    WatchSession: new FakeModel("WatchSession"),
  };
});
vi.mock("../src/auth.js", async () => {
  const { ApiError } = await import("../src/errors.js");
  return {
    authenticate: async () => {
      if (!state.signedIn) throw new ApiError(401, "Authentication required", "UNAUTHORIZED");
      const { User } = (await import("../src/models.js")) as unknown as { User: { rows: Array<Record<string, unknown>> } };
      return { dbUser: User.rows.find((r) => String(r._id) === String(ME)) };
    },
    getOptionalAuthUserId: () => (state.signedIn ? "clerk_me" : null),
  };
});
vi.mock("../src/points.js", () => ({
  WELCOME_POINTS: 200,
  ensureWelcomeGrant: async () => (state.granted ? 200 : null),
}));
vi.mock("../src/discovery.js", () => ({
  buildHomePage: async () => ({ rows: [], leads: [] }),
  alsoWatchedLive: async () => [],
  toItem: (s: unknown) => s,
}));

const db = (await import("../src/models.js")) as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
type Onboarding = Record<string, unknown>;
const me = () => db.User!.rows.find((r) => String(r._id) === String(ME))!.onboarding as Onboarding;

describe("the first-run flow", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    state.signedIn = true;
    state.granted = true;
    for (const m of Object.values(db)) m.reset?.();
    db.User!.rows.push(
      { _id: ME, authUserId: "clerk_me", username: "tomi_new", displayName: "Tomi", followers: 0, onboarding: { completedAt: null, categories: [], language: "" } },
      { _id: LIVE_HOST, username: "kemi.kicks", displayName: "Kemi Kicks", followers: 900, avatar: "", isLive: true },
      { _id: QUIET, username: "ife.cooks", displayName: "Ife Cooks", followers: 5000, avatar: "" },
      { _id: FOLLOWED, username: "already_mine", displayName: "Already", followers: 8000, avatar: "" },
    );
    db.Stream!.rows.push({ _id: new mongoose.Types.ObjectId(), streamerId: LIVE_HOST, isLive: true, category: "Football (Soccer)", viewers: 320 });
    db.Follow!.rows.push({ _id: new mongoose.Types.ObjectId(), followerId: ME, followingId: FOLLOWED });
  });

  const save = (body: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/user/me/onboarding", payload: body });

  it("saves a step without finishing, so it can resume after it", async () => {
    const res = await save({ categories: ["Football (Soccer)", "Crypto Markets"], step: "likes" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.welcomePoints).toBeNull();
    expect(me().step).toBe("likes");
    expect(me().completedAt).toBeNull();
    expect(me().categories).toEqual(["Football (Soccer)", "Crypto Markets"]);
    expect(me().startedAt).toBeInstanceOf(Date);
    expect(me().version).toBe(2);
  });

  it("keeps the picks when a later step sends none", async () => {
    await save({ categories: ["Crypto Markets"], step: "likes" });
    await save({ categories: [], step: "creators" });
    expect(me().categories).toEqual(["Crypto Markets"]);
    expect(me().step).toBe("creators");
  });

  it("keeps the first startedAt", async () => {
    await save({ categories: [], step: "name" });
    const first = me().startedAt as Date;
    await new Promise((r) => setTimeout(r, 5));
    await save({ categories: [], step: "likes" });
    expect((me().startedAt as Date).getTime()).toBe(first.getTime());
  });

  it("finishes with intent, languages and alerts, and lands the welcome points", async () => {
    const res = await save({ categories: ["Football (Soccer)"], languages: ["en", "yo"], intent: "both", alerts: true });
    expect(res.json().data.welcomePoints).toBe(200);
    expect(me().completedAt).toBeInstanceOf(Date);
    expect(me().step).toBeNull();
    expect(me().intent).toBe("both");
    expect(me().languages).toEqual(["en", "yo"]);
    expect(me().alertsAt).toBeInstanceOf(Date);
  });

  it("gives no points when the account already had them", async () => {
    state.granted = false;
    const res = await save({ categories: ["Football (Soccer)"] });
    expect(res.json().data.welcomePoints).toBeNull();
  });

  it("records Skip without finishing", async () => {
    await save({ categories: [], skipped: true });
    expect(me().skippedAt).toBeInstanceOf(Date);
    expect(me().completedAt).toBeNull();
  });

  it("still finishes a v1 body", async () => {
    await save({ categories: ["Crypto Markets"], language: "en" });
    expect(me().completedAt).toBeInstanceOf(Date);
    expect(me().language).toBe("en");
  });

  it("rejects an unknown intent or step", async () => {
    expect((await save({ categories: [], intent: "lurk" })).statusCode).toBe(400);
    expect((await save({ categories: [], step: "done" })).statusCode).toBe(400);
  });

  it("needs a signed-in account", async () => {
    state.signedIn = false;
    expect((await save({ categories: [] })).statusCode).toBe(401);
  });

  describe("@username check", () => {
    const check = async (u: string) => (await app.inject({ method: "GET", url: `/v1/users/username-available?username=${encodeURIComponent(u)}` })).json().data;

    it("says free, taken, yours or invalid", async () => {
      expect(await check("brand_new_name")).toMatchObject({ available: true, reason: null });
      expect(await check("kemi.kicks")).toMatchObject({ available: false, reason: "invalid" });
      expect(await check("ife_cooks")).toMatchObject({ available: true });
      expect(await check("Tomi_New")).toMatchObject({ available: true, reason: "yours", username: "tomi_new" });
      expect(await check("ab")).toMatchObject({ available: false, reason: "invalid" });
    });

    it("says taken for someone else's", async () => {
      db.User!.rows.push({ _id: new mongoose.Types.ObjectId(), username: "ada_o", displayName: "Ada" });
      expect(await check("ada_o")).toMatchObject({ available: false, reason: "taken" });
    });
  });

  describe("creators to follow", () => {
    const creators = async (q: string) => (await app.inject({ method: "GET", url: `/v1/onboarding/creators?${q}` })).json().data.creators as Array<Record<string, unknown>>;

    it("leads with who's live in the picks, never you or anyone you follow", async () => {
      const list = await creators("categories=Football%20(Soccer)&limit=5");
      expect(list[0]).toMatchObject({ username: "kemi.kicks", isLive: true, viewers: 320, category: "Football (Soccer)" });
      const names = list.map((c) => c.username);
      expect(names).not.toContain("tomi_new");
      expect(names).not.toContain("already_mine");
      expect(names).toContain("ife.cooks");
    });

    it("falls back to popular creators with no picks", async () => {
      const list = await creators("");
      expect(list.length).toBeGreaterThan(0);
    });
  });
});
