import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { candidateGapMs, MIN_CANDIDATE_GAP_MS, offerCandidate, type StoredCandidate } from "../src/thumbnail-candidates.js";
import { frameScore, frameStats, toLuma } from "../../../lib/thumbnail-score.js";

/**
 * "Pick a thumbnail": the studio offers scored live frames, the API keeps
 * the best three spread across the broadcast, and the host alone lists and
 * picks them — a pick is the thumbnail, with a new version.
 */

const state = vi.hoisted(() => ({ caller: "host" as "host" | "stranger" | "nobody" }));
const HOST = new mongoose.Types.ObjectId();
const STRANGER = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return {
    Stream: new FakeModel("Stream"),
    User: new FakeModel("User"),
  };
});
vi.mock("../src/auth.js", async () => {
  const { ApiError } = await import("../src/errors.js");
  return {
    authenticate: async () => {
      if (state.caller === "nobody") throw new ApiError(401, "Sign in", "UNAUTHORIZED");
      const _id = state.caller === "host" ? HOST : STRANGER;
      return { dbUser: { _id, username: state.caller, displayName: state.caller } };
    },
    getOptionalAuthUserId: () => null,
  };
});

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;

const JPEG = (n: number) => `data:image/jpeg;base64,${Buffer.from(`frame-${n}`).toString("base64")}`;
const MIN = 60_000;
const at = (m: number) => new Date(Date.UTC(2026, 8, 27, 20, 0) + m * MIN);
const cand = (id: string, score: number, m: number): StoredCandidate => ({ id, image: JPEG(m), score, at: at(m) });

describe("offerCandidate", () => {
  const GAP = 5 * MIN;

  it("keeps up to three frames, in time order", () => {
    let list: StoredCandidate[] = [];
    for (const [id, m] of [["c", 20], ["a", 0], ["b", 10]] as const) list = offerCandidate(list, cand(id, 0.5, m), GAP)!;
    expect(list.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("lets a neighbour in only by beating the one it's close to", () => {
    const list = [cand("a", 0.6, 0), cand("b", 0.4, 10)];
    expect(offerCandidate(list, cand("x", 0.5, 2), GAP)).toBeNull();
    expect(offerCandidate(list, cand("y", 0.7, 2), GAP)!.map((c) => c.id)).toEqual(["y", "b"]);
    // Close to b, which it beats — a's slot is untouched.
    expect(offerCandidate(list, cand("z", 0.5, 12), GAP)!.map((c) => c.id)).toEqual(["a", "z"]);
  });

  it("never keeps three neighbours, however sharp", () => {
    let list: StoredCandidate[] = [];
    for (let m = 0; m < 4; m++) list = offerCandidate(list, cand(`n${m}`, 0.5 + m / 10, m), GAP) ?? list;
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("n3");
  });

  it("when full, a new moment replaces the weakest only if it's better", () => {
    const list = [cand("a", 0.6, 0), cand("b", 0.3, 10), cand("c", 0.8, 20)];
    expect(offerCandidate(list, cand("d", 0.2, 30), GAP)).toBeNull();
    expect(offerCandidate(list, cand("e", 0.5, 30), GAP)!.map((c) => c.id)).toEqual(["a", "c", "e"]);
  });

  it("widens the gap as the broadcast runs", () => {
    const start = at(0);
    expect(candidateGapMs(start, at(1))).toBe(MIN_CANDIDATE_GAP_MS);
    expect(candidateGapMs(start, at(60))).toBe(15 * MIN);
    expect(candidateGapMs(null, at(60))).toBe(MIN_CANDIDATE_GAP_MS);
  });
});

describe("frame scoring (lib/thumbnail-score.ts)", () => {
  const W = 32;
  const H = 18;
  const frame = (fn: (x: number, y: number) => number) => {
    const out: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push(fn(x, y));
    return out;
  };
  const checker = frame((x, y) => ((x >> 2) + (y >> 2)) % 2 ? 170 : 70);
  const flat = frame(() => 120);

  it("reads a sharp frame as sharper than a flat one", () => {
    expect(frameStats(checker, W, H).sharpness).toBeGreaterThan(1000);
    expect(frameStats(flat, W, H).sharpness).toBe(0);
    expect(frameScore(frameStats(checker, W, H))).toBeGreaterThan(frameScore(frameStats(flat, W, H)));
  });

  it("marks a black or blown frame down", () => {
    expect(frameScore(frameStats(frame(() => 4), W, H))).toBe(0);
    const blown = frameScore(frameStats(frame((x, y) => ((x >> 2) + (y >> 2)) % 2 ? 255 : 245), W, H));
    expect(blown).toBeLessThan(frameScore(frameStats(checker, W, H)));
  });

  it("gives a face in shot the edge", () => {
    const s = frameStats(checker, W, H);
    expect(frameScore(s, true)).toBeCloseTo(frameScore(s) + 0.2, 5);
    expect(frameScore(s, null)).toBe(frameScore(s, false));
  });

  it("turns RGBA into luma", () => {
    expect(Array.from(toLuma([255, 255, 255, 255, 0, 0, 0, 255], 2, 1)).map(Math.round)).toEqual([255, 0]);
  });
});

describe("thumbnail candidate routes", () => {
  let app: FastifyInstance;
  let streamId = "";

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const m of Object.values(db)) m.reset();
    state.caller = "host";
    const s = db.Stream!.insert({
      streamerId: HOST,
      title: "Friday night desk",
      category: "Just Chatting",
      isLive: true,
      livekitRoomName: "room-1",
      startedAt: new Date(Date.now() - 60 * MIN),
      thumbnail: JPEG(-1),
      thumbnailVersion: 5,
      thumbnailCandidates: [],
    });
    streamId = String(s._id);
  });
  const call = (method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
    app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });
  const offer = (n: number, score: number) => call("POST", `/streams/${streamId}/thumbnail-candidates`, { image: JPEG(n), score });

  it("keeps a host's scored frame, and lists it back", async () => {
    const res = await offer(1, 0.7);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ kept: true, count: 1 });

    const list = await call("GET", `/streams/${streamId}/thumbnail-candidates`);
    expect(list.statusCode).toBe(200);
    const data = list.json().data;
    expect(data.thumbnailUrl).toBe(`/api/streams/${streamId}/thumbnail?v=5`);
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0]).toMatchObject({ image: JPEG(1), score: 0.7, current: false });
  });

  it("holds at most three, even when offered many", async () => {
    // One stream, frames seconds apart: neighbours — only the best stays.
    for (let n = 0; n < 5; n++) await offer(n, 0.3 + n / 10);
    const rows = db.Stream!.rows[0]!.thumbnailCandidates as StoredCandidate[];
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows.map((c) => c.image)).toContain(JPEG(4));
  });

  it("refuses anything but a small JPEG/WebP data URI and a sane score", async () => {
    expect((await call("POST", `/streams/${streamId}/thumbnail-candidates`, { image: "https://x.test/a.jpg", score: 0.5 })).statusCode).toBe(400);
    expect((await call("POST", `/streams/${streamId}/thumbnail-candidates`, { image: JPEG(1), score: 9 })).statusCode).toBe(400);
    expect((await call("POST", `/streams/${streamId}/thumbnail-candidates`, { image: `data:image/jpeg;base64,${"A".repeat(170_000)}`, score: 0.5 })).statusCode).toBe(400);
  });

  it("takes frames only while live", async () => {
    db.Stream!.rows[0]!.isLive = false;
    const res = await offer(1, 0.7);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "STREAM_NOT_LIVE" });
  });

  it("sets a picked frame as the thumbnail and bumps its version", async () => {
    await offer(1, 0.7);
    const id = (db.Stream!.rows[0]!.thumbnailCandidates as StoredCandidate[])[0]!.id;
    db.Stream!.rows[0]!.isLive = false;

    const res = await call("PUT", `/streams/${streamId}/thumbnail`, { candidateId: id });
    expect(res.statusCode).toBe(200);
    const row = db.Stream!.rows[0]!;
    expect(row.thumbnail).toBe(JPEG(1));
    expect(row.thumbnailVersion).toBeGreaterThan(5);
    expect(res.json().data.thumbnailUrl).toBe(`/api/streams/${streamId}/thumbnail?v=${row.thumbnailVersion}`);
    expect(res.json().data.candidates[0].current).toBe(true);

    // Picking it again changes nothing, so every cached card stays good.
    const version = row.thumbnailVersion;
    expect((await call("PUT", `/streams/${streamId}/thumbnail`, { candidateId: id })).statusCode).toBe(200);
    expect(row.thumbnailVersion).toBe(version);
  });

  it("404s a frame that isn't this stream's", async () => {
    const res = await call("PUT", `/streams/${streamId}/thumbnail`, { candidateId: "nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "CANDIDATE_NOT_FOUND" });
  });

  it("is the host's alone: a stranger is forbidden, a signed-out caller turned away", async () => {
    await offer(1, 0.7);
    const id = (db.Stream!.rows[0]!.thumbnailCandidates as StoredCandidate[])[0]!.id;

    state.caller = "stranger";
    expect((await offer(2, 0.9)).statusCode).toBe(403);
    expect((await call("GET", `/streams/${streamId}/thumbnail-candidates`)).statusCode).toBe(403);
    expect((await call("PUT", `/streams/${streamId}/thumbnail`, { candidateId: id })).statusCode).toBe(403);

    state.caller = "nobody";
    expect((await offer(2, 0.9)).statusCode).toBe(401);
    expect((await call("GET", `/streams/${streamId}/thumbnail-candidates`)).statusCode).toBe(401);
    expect((await call("PUT", `/streams/${streamId}/thumbnail`, { candidateId: id })).statusCode).toBe(401);

    // Nothing moved.
    expect(db.Stream!.rows[0]!.thumbnail).toBe(JPEG(-1));
    expect(db.Stream!.rows[0]!.thumbnailCandidates).toHaveLength(1);
  });

  it("404s a stream that doesn't exist", async () => {
    const res = await call("GET", `/streams/${new mongoose.Types.ObjectId()}/thumbnail-candidates`);
    expect(res.statusCode).toBe(404);
  });
});

describe("the Stream model", () => {
  it("never loads the candidates unless asked by name", async () => {
    const real = await vi.importActual<typeof import("../src/models.js")>("../src/models.js");
    expect(real.Stream.schema.path("thumbnailCandidates").options.select).toBe(false);
  });
});
