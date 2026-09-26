import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { goalBodySchema, HEAT_WINDOW_MS } from "@xtreme/contracts";

/**
 * Goals and the heat meter: the host puts a goal up; gifts, likes and
 * follows move it with atomic writes that also move its `rev`; the write
 * that crosses the target says so once; the meter reads the last minute.
 */

const HOST_ID = "a".repeat(24);
const VIEWER_ID = "b".repeat(24);
const OTHER_ID = "c".repeat(24);
const STREAM_ID = "d".repeat(24);

const id = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });

type Doc = Record<string, unknown> & { _id: ReturnType<typeof id>; goal: Record<string, unknown> | null };

const state = vi.hoisted(() => ({
  caller: "",
  stream: null as unknown as Doc,
  events: [] as Array<Record<string, unknown>>,
  pipelines: [] as Array<{ update: unknown; options: Record<string, unknown> }>,
  gifts: [] as Array<{ grossUsdMinor: number; createdAt: Date }>,
}));

function read(doc: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), doc);
}
function write(doc: Record<string, unknown>, path: string, value: (old: unknown) => unknown) {
  const keys = path.split(".");
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, doc);
  parent[last] = value(parent[last]);
}
// Just enough of Mongo's matching for the filters goals.ts writes.
function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, want]) => {
    if (key === "_id") return String(doc._id) === String(want);
    const have = read(doc, key);
    if (want === null) return have == null;
    if (want && typeof want === "object" && "$exists" in want) return (have !== undefined) === (want as { $exists: boolean }).$exists;
    if (want && typeof want === "object" && "$ne" in want) {
      const ne = String((want as { $ne: unknown }).$ne);
      return Array.isArray(have) ? !have.map(String).includes(ne) : String(have) !== ne;
    }
    return have === want;
  });
}
function apply(doc: Doc, update: unknown) {
  if (Array.isArray(update)) {
    // The one pipeline goals.ts sends: a literal goal, `rev` one past what's stored.
    const merge = (update[0] as { $set: { goal: { $mergeObjects: [{ $literal: Record<string, unknown> }, unknown] } } }).$set.goal.$mergeObjects;
    doc.goal = { ...merge[0].$literal, rev: Number(doc.goal?.rev ?? 0) + 1 };
    return;
  }
  const u = update as Record<string, Record<string, unknown>>;
  for (const [path, by] of Object.entries(u.$inc ?? {})) write(doc, path, (old) => Number(old ?? 0) + Number(by));
  for (const [path, value] of Object.entries(u.$set ?? {})) write(doc, path, () => value);
  for (const [path, value] of Object.entries(u.$push ?? {})) write(doc, path, (old) => [...((old as unknown[]) ?? []), value]);
}

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: { _id: id(state.caller) } }),
  getOptionalAuthUserId: () => "clerk_x",
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
    state.events.push(payload);
  },
  sendRoomDataTo: async () => {},
  closeRoom: async () => {},
}));

vi.mock("../src/models.js", () => ({
  Stream: {
    findById: (lookup: unknown) => ({
      select: async () => (String(lookup) === STREAM_ID ? state.stream : null),
    }),
    findOneAndUpdate: (filter: Record<string, unknown>, update: unknown, options: Record<string, unknown>) => ({
      lean: async () => {
        if (Array.isArray(update)) state.pipelines.push({ update, options });
        const doc = state.stream;
        if (!doc || !matches(doc, filter)) return null;
        apply(doc, update);
        // A copy, as .lean() hands back: later writes don't reach into it.
        return { ...doc, _id: STREAM_ID, goal: doc.goal ? { ...doc.goal, alliedBy: [...((doc.goal.alliedBy as unknown[]) ?? [])] } : null };
      },
    }),
    updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
      Object.assign(state.stream, update.$set);
      return {};
    },
  },
  GiftTransaction: {
    aggregate: async (pipeline: Array<{ $match?: { createdAt: { $gte: Date } } }>) => {
      const since = pipeline[0]!.$match!.createdAt.$gte;
      const sum = state.gifts.filter((g) => g.createdAt >= since).reduce((a, g) => a + g.grossUsdMinor, 0);
      return sum ? [{ _id: null, sum }] : [];
    },
  },
  ChatMessage: {},
  User: {},
  Follow: {},
  StreamBan: {},
  Report: {},
  StreamLike: {},
}));

const goal = (over: Record<string, unknown> = {}) => ({ kind: "gifts", title: "New mic", target: 20_000, milestones: [], ...over });

describe("the goal contract", () => {
  it("takes a target in range for its kind, and milestones in order below it", () => {
    expect(goalBodySchema.safeParse(goal()).success).toBe(true);
    expect(goalBodySchema.safeParse(goal({ target: 50 })).success).toBe(false); // under $1
    expect(goalBodySchema.safeParse(goal({ kind: "allies", target: 4 })).success).toBe(false);
    expect(goalBodySchema.safeParse(goal({ kind: "likes", target: 10 })).success).toBe(true);
    expect(goalBodySchema.safeParse(goal({ milestones: [{ at: 5_000, label: "Shots" }, { at: 12_000, label: "Dance" }] })).success).toBe(true);
    expect(goalBodySchema.safeParse(goal({ milestones: [{ at: 12_000, label: "Dance" }, { at: 5_000, label: "Shots" }] })).success).toBe(false);
    expect(goalBodySchema.safeParse(goal({ milestones: [{ at: 20_000, label: "At the goal" }] })).success).toBe(false);
    const four = [1, 2, 3, 4].map((n) => ({ at: n * 1_000, label: `Stop ${n}` }));
    expect(goalBodySchema.safeParse(goal({ milestones: four })).success).toBe(false);
  });
});

describe("goals", () => {
  let app: FastifyInstance;
  let goals: typeof import("../src/goals.js");

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    goals = await import("../src/goals.js");
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    state.caller = HOST_ID;
    state.stream = { _id: id(STREAM_ID), streamerId: id(HOST_ID), isLive: true, livekitRoomName: "room-1", goal: null };
    state.events.length = 0;
    state.pipelines.length = 0;
    state.gifts = [];
  });

  const put = (body: Record<string, unknown>) => app.inject({ method: "PUT", url: `/v1/streams/${STREAM_ID}/goal`, payload: body });
  const end = () => app.inject({ method: "DELETE", url: `/v1/streams/${STREAM_ID}/goal` });

  it("lets only the host put a goal up, and only while live", async () => {
    state.caller = VIEWER_ID;
    expect((await put(goal())).statusCode).toBe(403);
    state.caller = HOST_ID;
    state.stream.isLive = false;
    expect((await put(goal())).statusCode).toBe(409);
  });

  it("starts a goal at zero, keeps a $ title as words, and tells the room", async () => {
    const response = await put(goal({ title: "$200 for a new mic", milestones: [{ at: 5_000, label: "$50: shots" }] }));

    expect(response.statusCode).toBe(200);
    expect(response.json().data.goal).toMatchObject({ kind: "gifts", title: "$200 for a new mic", target: 20_000, progress: 0, reachedAt: null, endedAt: null, rev: 1 });
    // One pipeline write, its fields literal, which Mongoose 9 needs asking for.
    expect(state.pipelines).toHaveLength(1);
    expect(JSON.stringify(state.pipelines[0]!.update)).toContain("$literal");
    expect(state.pipelines[0]!.options).toMatchObject({ updatePipeline: true });
    expect(state.events.at(-1)).toMatchObject({ __evt: "goal", goal: { title: "$200 for a new mic", progress: 0 } });
    // Who allied never leaves the server.
    expect(state.events.at(-1)!.goal).not.toHaveProperty("alliedBy");
  });

  it("counts gifts in cents toward a gift goal, and ignores other kinds", async () => {
    await put(goal());
    expect(await goals.bumpGoal(STREAM_ID, "likes", 1)).toBeNull();
    const moved = await goals.bumpGoal(STREAM_ID, "gifts", 500);
    expect(moved).toMatchObject({ progress: 500, rev: 2 });
    expect(state.events.at(-1)).toMatchObject({ __evt: "goal", goal: { progress: 500 } });
    expect(state.events.at(-1)).not.toHaveProperty("reached");
  });

  it("says the goal was reached once, from the write that crossed it", async () => {
    await put(goal({ target: 1_000 }));
    await goals.bumpGoal(STREAM_ID, "gifts", 600);
    const crossed = await goals.bumpGoal(STREAM_ID, "gifts", 600);
    expect(crossed).toMatchObject({ progress: 1_200 });
    expect(crossed!.reachedAt).not.toBeNull();
    expect(state.events.at(-1)).toMatchObject({ __evt: "goal", reached: true });

    // Past the line it keeps counting, without announcing it again.
    const after = await goals.bumpGoal(STREAM_ID, "gifts", 100);
    expect(after).toMatchObject({ progress: 1_300, reachedAt: crossed!.reachedAt });
    expect(state.events.at(-1)).not.toHaveProperty("reached");
  });

  it("counts each ally once per goal, however often they toggle", async () => {
    await put(goal({ kind: "allies", target: 5 }));
    const viewer = id(VIEWER_ID) as unknown as import("mongoose").Types.ObjectId;
    const other = id(OTHER_ID) as unknown as import("mongoose").Types.ObjectId;
    expect(await goals.bumpGoal(STREAM_ID, "allies", 1, { userId: viewer })).toMatchObject({ progress: 1 });
    expect(await goals.bumpGoal(STREAM_ID, "allies", 1, { userId: viewer })).toBeNull();
    expect(await goals.bumpGoal(STREAM_ID, "allies", 1, { userId: other })).toMatchObject({ progress: 2 });
  });

  it("stops moving once taken down, and the next goal's rev keeps climbing", async () => {
    await put(goal());
    await goals.bumpGoal(STREAM_ID, "gifts", 500);
    const ended = await end();
    expect(ended.json().data.goal).toMatchObject({ progress: 500, rev: 3 });
    expect(ended.json().data.goal.endedAt).not.toBeNull();
    expect(await goals.bumpGoal(STREAM_ID, "gifts", 500)).toBeNull();
    // Taking down what's already down changes nothing.
    expect((await end()).json().data.goal).toBeNull();

    const next = await put(goal({ title: "Round two" }));
    expect(next.json().data.goal).toMatchObject({ title: "Round two", progress: 0, rev: 4, endedAt: null });
  });
});

describe("the heat meter", () => {
  let goals: typeof import("../src/goals.js");

  beforeAll(async () => {
    goals = await import("../src/goals.js");
  });

  beforeEach(() => {
    state.stream = { _id: id(STREAM_ID), streamerId: id(HOST_ID), isLive: true, livekitRoomName: "room-1", goal: null };
    state.events.length = 0;
    state.gifts = [];
  });

  it("steps at $5, $20, $50, $100 and $250 a minute", () => {
    expect([0, 499, 500, 1_999, 2_000, 5_000, 10_000, 24_999, 25_000, 99_999].map(goals.heatLevel)).toEqual([0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);
  });

  it("reads only the last minute's gifts, and stays cold under $5", async () => {
    const now = Date.now();
    const stream = { _id: STREAM_ID, livekitRoomName: "room-1" } as never;
    state.gifts = [{ grossUsdMinor: 30_000, createdAt: new Date(now - HEAT_WINDOW_MS - 1) }];
    expect(await goals.bumpHeat(stream, now)).toBeNull();
    expect(state.events).toHaveLength(0);

    state.gifts.push({ grossUsdMinor: 2_500, createdAt: new Date(now - 5_000) });
    const heat = await goals.bumpHeat(stream, now);
    expect(heat).toEqual({ level: 2, at: new Date(now).toISOString() });
    expect(state.stream.heat).toMatchObject({ level: 2 });
    expect(state.events.at(-1)).toEqual({ __evt: "heat", heat });
  });
});
