import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The stream page's follow button relies on these exact status codes to
 * recover from a stale local state — ALREADY_FOLLOWING means "you already
 * are", not "that failed". Pin the contract so it can't drift.
 */

const CALLER_ID = "c".repeat(24);
const TARGET_ID = "t".repeat(24);

/** Follow rows the fake collection currently holds. */
let follows: Array<{ followerId: string; followingId: string }> = [];
/** Set null to make the target username resolve to nothing. */
let target: Record<string, unknown> | null = null;

const id = (v: unknown) => ({
  toString: () => String(v),
  equals: (o: unknown) => String(o) === String(v),
});

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({
    authUserId: "clerk_caller",
    dbUser: { _id: id(CALLER_ID), username: "caller", displayName: "Caller" },
  }),
  getOptionalAuthUserId: () => "clerk_caller",
}));

vi.mock("../src/models.js", () => ({
  User: {
    findOne: (q: Record<string, string>) => {
      const doc = q.authUserId
        ? { _id: id(CALLER_ID) }
        : target;
      return { select: () => ({ lean: async () => doc }), then: undefined, ...promiseLike(doc) };
    },
    updateOne: async () => ({}),
    find: () => ({ sort: () => ({ limit: () => ({ select: () => ({ lean: async () => [] }) }) }) }),
    exists: async () => null,
  },
  Follow: {
    exists: async (q: { followerId: unknown; followingId: unknown }) =>
      follows.some(
        (f) =>
          f.followerId === String(q.followerId) &&
          f.followingId === String(q.followingId),
      )
        ? { _id: "x" }
        : null,
    create: async (doc: { followerId: unknown; followingId: unknown }) => {
      const row = {
        followerId: String(doc.followerId),
        followingId: String(doc.followingId),
      };
      if (follows.some((f) => f.followerId === row.followerId && f.followingId === row.followingId)) {
        throw Object.assign(new Error("dup"), { code: 11000 });
      }
      follows.push(row);
      return row;
    },
    findOneAndDelete: async (q: { followerId: unknown; followingId: unknown }) => {
      const i = follows.findIndex(
        (f) =>
          f.followerId === String(q.followerId) &&
          f.followingId === String(q.followingId),
      );
      if (i === -1) return null;
      return follows.splice(i, 1)[0];
    },
    countDocuments: async () => 0,
  },
  Stream: { aggregate: async () => [], find: () => ({ select: () => ({ sort: () => ({ lean: async () => [] }) }) }) },
  ChatMessage: {},
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

/** `User.findOne(...)` is awaited directly in some paths and chained in others. */
function promiseLike(value: unknown) {
  return {
    then: (res: (v: unknown) => unknown) => Promise.resolve(value).then(res),
    catch: () => Promise.resolve(value),
  };
}

describe("follow endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    follows = [];
    target = {
      _id: id(TARGET_ID),
      username: "streamer",
      displayName: "Streamer",
      avatar: "",
      bio: "",
      followers: 3,
      following: 0,
      totalViews: 0,
      isLive: true,
      verified: false,
      createdAt: new Date("2026-01-01"),
    };
  });

  const follow = (method: "POST" | "DELETE") =>
    app.inject({ method, url: "/api/user/streamer/follow" });

  it("follows, then reports the follow on the profile", async () => {
    expect((await follow("POST")).statusCode).toBe(200);

    const profile = await app.inject({ method: "GET", url: "/api/user/streamer" });
    expect(profile.json().data.isFollowing).toBe(true);
  });

  it("rejects a duplicate follow as ALREADY_FOLLOWING, not a generic failure", async () => {
    await follow("POST");
    const response = await follow("POST");

    // The client keys off this code to correct its own stale state.
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("ALREADY_FOLLOWING");
  });

  it("rejects unfollowing someone you don't follow as NOT_FOLLOWING", async () => {
    const response = await follow("DELETE");

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NOT_FOLLOWING");
  });

  it("round-trips follow then unfollow", async () => {
    expect((await follow("POST")).statusCode).toBe(200);
    expect((await follow("DELETE")).statusCode).toBe(200);
    expect(follows).toHaveLength(0);

    const profile = await app.inject({ method: "GET", url: "/api/user/streamer" });
    expect(profile.json().data.isFollowing).toBe(false);
  });

  it("refuses to let a user follow themselves", async () => {
    target = { ...target!, _id: id(CALLER_ID) };
    const response = await follow("POST");

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("SELF_FOLLOW");
  });

  it("404s for an unknown username", async () => {
    target = null;
    const response = await follow("POST");

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe("USER_NOT_FOUND");
  });

  it("can follow a legacy account whose username is under 3 characters", async () => {
    // The 3-char minimum governs registration, not lookup. While it applied
    // to the URL param too, `/user/jo/follow` 400'd before any lookup and the
    // follow button on that streamer's page could never work.
    target = { ...target!, username: "jo" };
    const response = await app.inject({
      method: "POST",
      url: "/api/user/jo/follow",
    });

    expect(response.statusCode).toBe(200);
  });

  it("still rejects a username with illegal characters", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/user/not-a-valid-name!/follow",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("VALIDATION_ERROR");
  });
});
