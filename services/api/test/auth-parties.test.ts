import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";

const state: { auth: { userId: string | null; sessionClaims: Record<string, unknown> | null }; parties: string[] } = {
  auth: { userId: null, sessionClaims: null },
  parties: [],
};

vi.mock("@clerk/fastify", () => ({
  clerkClient: {},
  getAuth: () => state.auth,
}));
vi.mock("../src/config.js", () => ({
  config: new Proxy({}, { get: (_t, k) => (k === "clerkAuthorizedParties" ? state.parties : undefined) }),
}));

const { signedInUserId } = await import("../src/auth.js");

const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as unknown as FastifyRequest;

describe("signedInUserId: the authorized-parties rule, applied by us", () => {
  beforeEach(() => {
    state.auth = { userId: "user_ada", sessionClaims: {} };
    state.parties = ["https://xtream.worldstreetgold.com"];
  });

  it("accepts a browser token naming one of our parties", () => {
    state.auth.sessionClaims = { azp: "https://xtream.worldstreetgold.com" };
    expect(signedInUserId(req("Bearer t"))).toBe("user_ada");
  });

  it("refuses a token naming someone else's party", () => {
    state.auth.sessionClaims = { azp: "https://evil.example" };
    expect(signedInUserId(req("Bearer t"))).toBeNull();
  });

  it("accepts a native token (no party) sent as a Bearer header", () => {
    expect(signedInUserId(req("Bearer native-token"))).toBe("user_ada");
  });

  it("refuses a partyless token that didn't come in the Authorization header", () => {
    expect(signedInUserId(req())).toBeNull();
  });

  it("with no list configured, any verified token passes", () => {
    state.parties = [];
    state.auth.sessionClaims = { azp: "https://anything.example" };
    expect(signedInUserId(req())).toBe("user_ada");
  });

  it("no verified user is no user", () => {
    state.auth = { userId: null, sessionClaims: null };
    expect(signedInUserId(req("Bearer t"))).toBeNull();
  });
});
