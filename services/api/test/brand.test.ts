import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The brand kit (Phase 2, graphics): a creator's accent, lower-third shape
 * and logo. A new logo gets a new version — and so a new URL, which is what
 * lets the logo route cache forever.
 */

const USER_ID = "c".repeat(24);
const PNG = "data:image/png;base64,iVBORw0KGgo=";

const state = vi.hoisted(() => ({
  live: null as null | { livekitRoomName: string },
  events: [] as Array<{ room: string; payload: Record<string, unknown> }>,
  user: null as null | {
    _id: { toString: () => string };
    brand?: { accent: string; lowerThird: string; logo: string; logoVersion: number; set?: string | null };
    save: () => Promise<void>;
  },
}));

vi.mock("../src/auth.js", () => ({
  authenticate: async () => ({ authUserId: "clerk_x", dbUser: state.user }),
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
  sendRoomData: async (room: string, payload: Record<string, unknown>) => {
    state.events.push({ room, payload });
  },
}));

vi.mock("../src/models.js", () => ({
  User: {
    findById: (lookup: unknown) => ({
      select: () => ({
        lean: async () => (String(lookup) === USER_ID ? state.user : null),
      }),
    }),
  },
  Stream: {
    findOne: () => ({ select: () => ({ lean: async () => state.live }) }),
  },
  Follow: {},
  ChatMessage: {},
  StreamBan: { findOne: async () => null },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

describe("brand kit", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    state.user = {
      _id: { toString: () => USER_ID },
      brand: { accent: "ember", lowerThird: "bar", logo: "", logoVersion: 0 },
      save: vi.fn(async () => {}),
    };
    state.live = null;
    state.events.length = 0;
  });

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: "PATCH", url: "/v1/users/me/brand", payload });

  it("changes the accent and the lower third's shape", async () => {
    const response = await patch({ accent: "sky", lowerThird: "pill" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.brand).toEqual({ accent: "sky", lowerThird: "pill", font: "wide", logoVersion: 0, logoUrl: null, presets: [], set: null });
    expect(state.user?.save).toHaveBeenCalledTimes(1);
  });

  it("gives a new logo a new version, and so a new URL", async () => {
    const response = await patch({ logo: PNG });

    const brand = response.json().data.brand;
    expect(brand.logoVersion).toBeGreaterThan(0);
    expect(brand.logoUrl).toBe(`/api/users/${USER_ID}/logo?v=${brand.logoVersion}`);
  });

  it("takes the logo away when asked", async () => {
    state.user!.brand = { accent: "ember", lowerThird: "bar", logo: PNG, logoVersion: 5 };

    const response = await patch({ logo: "" });

    expect(response.json().data.brand.logoUrl).toBeNull();
  });

  it("redraws a live room in the new colours at once", async () => {
    state.live = { livekitRoomName: "room-7" };

    await patch({ accent: "mint" });

    expect(state.events).toEqual([
      { room: "room-7", payload: { __evt: "brand", brand: { accent: "mint", lowerThird: "bar", font: "wide", logoVersion: 0, logoUrl: null, presets: [], set: null } } },
    ]);
  });

  it("wears a Set and takes it off again, leaving the rest of the kit alone", async () => {
    const on = await patch({ set: "owambe" });

    expect(on.statusCode).toBe(200);
    expect(on.json().data.brand).toMatchObject({ accent: "ember", lowerThird: "bar", set: "owambe" });

    const off = await patch({ set: null });

    expect(off.statusCode).toBe(200);
    expect(off.json().data.brand.set).toBeNull();
    expect(state.user?.save).toHaveBeenCalledTimes(2);
  });

  it("keeps the Set when something else in the kit changes", async () => {
    await patch({ set: "trading-desk" });
    const response = await patch({ accent: "sky" });

    expect(response.json().data.brand).toMatchObject({ accent: "sky", set: "trading-desk" });
  });

  it("tells a live room about a new Set at once", async () => {
    state.live = { livekitRoomName: "room-9" };

    await patch({ set: "game-night" });

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ room: "room-9", payload: { __evt: "brand", brand: { set: "game-night" } } });
  });

  it("refuses a Set id that isn't one", async () => {
    expect((await patch({ set: "Owambe!" })).statusCode).toBe(400);
    expect((await patch({ set: "x".repeat(33) })).statusCode).toBe(400);
    expect((await patch({ set: 7 })).statusCode).toBe(400);
  });

  it("stays quiet off air", async () => {
    await patch({ accent: "mint" });

    expect(state.events).toEqual([]);
  });

  it("keeps a title face and graphics saved for reuse", async () => {
    const presets = [
      { kind: "lower-third", title: "Tolu", subtitle: "@tolu_plays" },
      { kind: "banner", text: "Giveaway at 100 allies" },
    ];
    const response = await patch({ font: "rounded", presets });

    expect(response.json().data.brand).toMatchObject({ font: "rounded", presets });
  });

  it("refuses a face it doesn't know and more than twelve saved graphics", async () => {
    expect((await patch({ font: "comic" })).statusCode).toBe(400);
    const many = Array.from({ length: 13 }, (_, i) => ({ kind: "banner", text: `Banner ${i}` }));
    expect((await patch({ presets: many })).statusCode).toBe(400);
  });

  it("refuses an empty change and an accent it doesn't know", async () => {
    expect((await patch({})).statusCode).toBe(400);
    expect((await patch({ accent: "gold" })).statusCode).toBe(400);
  });

  it("serves the logo as a cacheable, embeddable image", async () => {
    state.user!.brand = { accent: "ember", lowerThird: "bar", logo: PNG, logoVersion: 5 };

    const response = await app.inject({ method: "GET", url: `/v1/users/${USER_ID}/logo?v=5` });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(response.headers.etag).toBe('"logo-5"');
  });

  it("answers 404 when there's no logo", async () => {
    const response = await app.inject({ method: "GET", url: `/v1/users/${USER_ID}/logo` });

    expect(response.statusCode).toBe(404);
  });
});
