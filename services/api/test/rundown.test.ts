import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { rundownBodySchema } from "@xtreme/contracts";
import { applyCues, TEMPLATES, toBody } from "../../../lib/rundown";

/**
 * Run of show: the rundown's limits, what a segment does to the picture as
 * it starts, and the routes — the rundown is the creator's own, and only
 * the host moves the show on, with its clock kept on the server.
 */

const state = vi.hoisted(() => ({ caller: "" }));
const HOST = new mongoose.Types.ObjectId();
const OTHER = new mongoose.Types.ObjectId();

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return { Rundown: new FakeModel("Rundown", [{ keys: ["ownerId"] }]), Stream: new FakeModel("Stream"), User: new FakeModel("User") };
});
vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ dbUser: { _id: state.caller === "host" ? HOST : OTHER, username: state.caller } }),
  getOptionalAuthUserId: () => null,
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
  sendRoomData: async () => {},
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;

const seg = (id: string, fields: Record<string, unknown> = {}) => ({ id, title: `Segment ${id}`, seconds: 300, script: "", cues: [], ...fields });

describe("the rundown's limits", () => {
  it("takes every template as written", () => {
    for (const t of TEMPLATES) {
      const r = rundownBodySchema.safeParse({ segments: t.segments.map((s, i) => ({ ...s, id: `tmpl${t.id}${i}`.slice(0, 16).padEnd(6, "0") })) });
      expect(r.success, t.name).toBe(true);
    }
  });

  it("refuses repeated ids, too many segments, and scripts over the whole-show limit", () => {
    expect(rundownBodySchema.safeParse({ segments: [seg("aaaaaa"), seg("aaaaaa")] }).success).toBe(false);
    expect(rundownBodySchema.safeParse({ segments: Array.from({ length: 21 }, (_, i) => seg(`seg${String(i).padStart(3, "0")}`)) }).success).toBe(false);
    const long = "x".repeat(3_500);
    expect(rundownBodySchema.safeParse({ segments: [seg("aaaaaa", { script: long }), seg("bbbbbb", { script: long }), seg("cccccc", { script: long })] }).success).toBe(false);
    expect(rundownBodySchema.safeParse({ segments: [seg("aaaaaa", { script: long }), seg("bbbbbb", { script: long })] }).success).toBe(true);
  });

  it("allows one change of each kind per segment", () => {
    const twice = seg("aaaaaa", { cues: [{ do: "banner", text: "Up" }, { do: "hide-banner" }] });
    const mixed = seg("aaaaaa", { cues: [{ do: "banner", text: "Up" }, { do: "clear-card" }, { do: "countdown" }] });
    expect(rundownBodySchema.safeParse({ segments: [twice] }).success).toBe(false);
    expect(rundownBodySchema.safeParse({ segments: [mixed] }).success).toBe(true);
  });

  it("toBody names untitled segments and drops half-written cues before saving", () => {
    const body = toBody([seg("aaaaaa", { title: "  ", cues: [{ do: "banner", text: " " }, { do: "countdown" }] })] as never);
    expect(body[0]).toMatchObject({ title: "Untitled segment", cues: [{ do: "countdown" }] });
    expect(rundownBodySchema.safeParse({ segments: body }).success).toBe(true);
  });
});

describe("a segment's cues", () => {
  const base = { layout: "auto" as const, card: "starting-soon" as const, chart: null, layers: [{ kind: "ticker" as const, text: "Hello" }, { kind: "banner" as const, text: "Old" }] };
  const now = Date.parse("2026-09-26T20:00:00Z");

  it("changes only what the segment names, in order", () => {
    const next = applyCues(
      base,
      { title: "Guest", seconds: 600, cues: [{ do: "clear-card" }, { do: "layout", layout: "split" }, { do: "lower-third", title: "Ada", subtitle: "Guest" }, { do: "hide-banner" }] },
      now,
    );
    expect(next).toEqual({
      layout: "split",
      card: null,
      chart: null,
      layers: [{ kind: "ticker", text: "Hello" }, { kind: "lower-third", title: "Ada", subtitle: "Guest" }],
    });
  });

  it("counts down to the segment's planned end, and brings a chart for Chart + face", () => {
    const next = applyCues(base, { title: "Overnight recap", seconds: 480, cues: [{ do: "layout", layout: "chart-face" }, { do: "countdown" }] }, now);
    expect(next?.chart).toEqual({ symbol: "BTC-USD", interval: "5m" });
    expect(next?.layers.find((l) => l.kind === "countdown")).toEqual({ kind: "countdown", label: "Overnight recap", endsAt: new Date(now + 480_000).toISOString() });
  });

  it("puts a sponsor up from the studio's own list, and skips one that's gone", () => {
    const id = new mongoose.Types.ObjectId().toString();
    const sponsors = [{ source: "own" as const, id, name: "Ofada Express", line: "Rice", url: "", code: "X", logoUrl: null, restricted: false }];
    const up = applyCues(base, { title: "Sponsor read", seconds: 120, cues: [{ do: "sponsor", source: "own", sponsorId: id }] }, now, sponsors);
    expect(up?.layers.find((l) => l.kind === "sponsor")).toMatchObject({ source: "own", sponsorId: id, name: "Ofada Express" });
    const gone = applyCues(base, { title: "Sponsor read", seconds: 120, cues: [{ do: "sponsor", source: "own", sponsorId: id }] }, now, []);
    expect(gone?.layers.some((l) => l.kind === "sponsor")).toBe(false);
  });

  it("leaves the picture alone when a segment has no cues", () => {
    expect(applyCues(base, { title: "Main topic", seconds: 1200, cues: [] }, now)).toBeNull();
  });
});

describe("run of show routes", () => {
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
    db.Rundown!.reset();
    db.Stream!.reset();
    state.caller = "host";
    db.User!.reset();
    db.User!.insert({ _id: HOST, username: "host", displayName: "Host", safety: { mods: [] } });
    streamId = String(db.Stream!.insert({ streamerId: HOST, isLive: true, rundown: null })._id);
  });
  const call = (method: "GET" | "PUT", url: string, payload?: unknown) => app.inject({ method, url: `/v1${url}`, ...(payload ? { payload } : {}) });

  it("saves the rundown as the creator's own, and reads it back", async () => {
    expect((await call("GET", "/users/me/rundown")).json().data.rundown.segments).toEqual([]);
    const put = await call("PUT", "/users/me/rundown", { segments: [seg("aaaaaa", { title: "Open" })] });
    expect(put.statusCode).toBe(200);
    await call("PUT", "/users/me/rundown", { segments: [seg("aaaaaa", { title: "Open" }), seg("bbbbbb", { title: "Q&A" })] });
    expect(db.Rundown!.rows).toHaveLength(1);
    expect((await call("GET", "/users/me/rundown")).json().data.rundown.segments.map((s: { title: string }) => s.title)).toEqual(["Open", "Q&A"]);
  });

  it("keeps the show's clock across segments, and clears it when stopped", async () => {
    const first = (await call("PUT", `/streams/${streamId}/rundown`, { segmentId: "aaaaaa" })).json().data.position;
    expect(first.segmentId).toBe("aaaaaa");
    expect(first.showStartedAt).toBe(first.startedAt);
    await new Promise((r) => setTimeout(r, 5));
    const second = (await call("PUT", `/streams/${streamId}/rundown`, { segmentId: "bbbbbb" })).json().data.position;
    expect(second.showStartedAt).toBe(first.showStartedAt);
    expect(Date.parse(second.startedAt)).toBeGreaterThan(Date.parse(first.startedAt));
    expect((await call("GET", `/streams/${streamId}/rundown`)).json().data.position.segmentId).toBe("bbbbbb");
    const stopped = (await call("PUT", `/streams/${streamId}/rundown`, { segmentId: null })).json().data.position;
    expect(stopped).toEqual({ segmentId: null, startedAt: null, showStartedAt: null });
  });

  it("is the host's alone, and only while live", async () => {
    state.caller = "viewer";
    expect((await call("PUT", `/streams/${streamId}/rundown`, { segmentId: "aaaaaa" })).statusCode).toBe(403);
    expect((await call("GET", `/streams/${streamId}/rundown`)).statusCode).toBe(403);
    state.caller = "host";
    db.Stream!.rows[0]!.isLive = false;
    expect((await call("PUT", `/streams/${streamId}/rundown`, { segmentId: "aaaaaa" })).statusCode).toBe(409);
  });
});
