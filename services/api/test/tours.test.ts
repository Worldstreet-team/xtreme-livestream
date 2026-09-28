import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The walkthrough's record on the account, shared by the web and the app:
 * seen is for good (the first time counts), "Later" snoozes, the profile
 * carries it, and a client can carry over what its device remembered.
 */

const state = vi.hoisted(() => ({ signedIn: true }));
const ME = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return { User: new FakeModel("User"), Stream: new FakeModel("Stream") };
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

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { toursView, MAX_TOURS } = await import("../src/tours.js");

type Tours = { seen: Record<string, string>; snoozed: Record<string, string> };

describe("walkthrough tours on the account", () => {
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
    db.User!.rows.length = 0;
    db.User!.rows.push({ _id: ME, username: "tomi.test", displayName: "Tomi" });
  });

  const put = (id: string, body: unknown) => app.inject({ method: "PUT", url: `/v1/user/me/tours/${id}`, payload: body as object });
  const tours = async () => (await app.inject({ method: "GET", url: "/v1/user/me/tours" })).json().data.tours as Tours;

  it("starts empty", async () => {
    expect(await tours()).toEqual({ seen: {}, snoozed: {} });
  });

  it("marks a tour seen, and the first time is the one that counts", async () => {
    const first = await put("new-look", { state: "seen" });
    expect(first.statusCode).toBe(200);
    const at = (first.json().data.tours as Tours).seen["new-look"];
    expect(at).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    await put("new-look", { state: "seen" });
    expect((await tours()).seen["new-look"]).toBe(at);
  });

  it("snoozes for a day by default, or for the hours asked, and seeing it ends the snooze", async () => {
    const before = Date.now();
    await put("browse", { state: "snoozed" });
    const until = Date.parse((await tours()).snoozed.browse!);
    expect(until - before).toBeGreaterThanOrEqual(24 * 3_600_000 - 1000);
    expect(until - before).toBeLessThanOrEqual(24 * 3_600_000 + 1000);

    await put("wallet", { state: "snoozed", hours: 2 });
    expect(Date.parse((await tours()).snoozed.wallet!) - Date.now()).toBeLessThanOrEqual(2 * 3_600_000);

    await put("browse", { state: "seen" });
    const now = await tours();
    expect(now.seen.browse).toBeTruthy();
    expect(now.snoozed.browse).toBeUndefined();
  });

  it("only shows snoozes still running", () => {
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 60_000);
    const view = toursView({ snoozed: new Map([["a", past], ["b", future]]) });
    expect(Object.keys(view.snoozed)).toEqual(["b"]);
  });

  it("carries over several seen at once", async () => {
    await put("wallet", { state: "seen" });
    const res = await app.inject({ method: "POST", url: "/v1/user/me/tours/seen", payload: { ids: ["studio-setup", "wallet", "studio-setup"] } });
    expect(res.statusCode).toBe(200);
    expect(Object.keys((res.json().data.tours as Tours).seen).sort()).toEqual(["studio-setup", "wallet"]);
  });

  it("forgets everything on reset", async () => {
    await put("new-look", { state: "seen" });
    const res = await app.inject({ method: "DELETE", url: "/v1/user/me/tours" });
    expect(res.statusCode).toBe(200);
    expect(await tours()).toEqual({ seen: {}, snoozed: {} });
  });

  it("rejects ids that aren't tour names and bad snooze lengths", async () => {
    expect((await put("Not_A.Tour", { state: "seen" })).statusCode).toBe(400);
    expect((await put("x".repeat(60), { state: "seen" })).statusCode).toBe(400);
    expect((await put("ok", { state: "snoozed", hours: 0 })).statusCode).toBe(400);
    expect((await put("ok", { state: "snoozed", hours: 24 * 31 })).statusCode).toBe(400);
    expect((await put("ok", { state: "gone" })).statusCode).toBe(400);
  });

  it("caps how many tours an account can hold", async () => {
    const seen: Record<string, Date> = {};
    for (let i = 0; i < MAX_TOURS; i++) seen[`t${i}`] = new Date();
    db.User!.rows[0]!.tours = { seen };
    expect((await put("one-more", { state: "seen" })).statusCode).toBe(409);
    expect((await put("t3", { state: "seen" })).statusCode).toBe(200);
  });

  it("needs a signed-in account", async () => {
    state.signedIn = false;
    expect((await put("new-look", { state: "seen" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/user/me/tours" })).statusCode).toBe(401);
  });
});
