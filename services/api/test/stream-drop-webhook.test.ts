import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * A host's browser dropping out of the room is a pause, not the end (the
 * owner's Phase 1: "stay live through drops"). The LiveKit webhook holds
 * the stream and tells the room; ignores a leave that a rejoin — or a move
 * to another device — has already replaced; ends it only once the grace
 * window has run out; and clears the hold when the host is back.
 */

const HOST_ID = "a".repeat(24);
const STREAM_ID = "d".repeat(24);
const ROOM = "stream-room";

const { ended, state } = vi.hoisted(() => ({
  ended: vi.fn(async () => {}),
  state: {
    /** What the signed webhook "says" — switched per test. */
    event: { event: "ignored" } as Record<string, unknown>,
    /** Identities LiveKit lists in the room right now. */
    inRoom: [] as string[],
    dataEvents: [] as Array<Record<string, unknown>>,
  },
}));

let streamDoc: {
  _id: string;
  streamerId: { toString: () => string };
  source: "camera" | "screen" | "obs";
  isLive: boolean;
  livekitRoomName: string;
  feedDroppedAt: Date | null;
  guests: unknown[];
  viewers: number;
  peakViewers: number;
  viewerSeconds: number;
  startedAt: Date;
  save: () => Promise<void>;
};

vi.mock("../src/auth.js", () => ({
  authenticate: async () => {
    throw new Error("not used");
  },
  getOptionalAuthUserId: () => null,
}));

vi.mock("../src/livekit.js", () => ({
  roomService: {
    listParticipants: async () => state.inRoom.map((identity) => ({ identity })),
  },
  ingressClient: {},
  webhookReceiver: { receive: async () => state.event },
  createToken: async () => "token",
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
  isIdentityInRoom: async (_room: string, identity: string) => state.inRoom.includes(identity),
  sendRoomData: async (_room: string, payload: Record<string, unknown>) => {
    state.dataEvents.push(payload);
  },
  setParticipantPublishPermission: async () => {},
}));

vi.mock("../src/stream-service.js", async () => {
  const actual = await vi.importActual<typeof import("../src/stream-service.js")>(
    "../src/stream-service.js",
  );
  return { ...actual, markStreamEnded: ended };
});

vi.mock("../src/watch-sessions.js", () => ({
  openWatchSession: async () => {},
  closeWatchSession: async () => {},
  closeAllWatchSessions: async () => {},
}));

const pulled = vi.hoisted(() => [] as unknown[]);

vi.mock("../src/models.js", () => ({
  Stream: {
    findOne: async (filter: { livekitRoomName?: string; isLive?: boolean }) =>
      filter.livekitRoomName === ROOM && streamDoc.isLive ? streamDoc : null,
    updateOne: async (_filter: unknown, update: { $pull?: unknown }) => {
      if (update.$pull) pulled.push(update.$pull);
      return {};
    },
  },
  User: {},
  Follow: {},
  ChatMessage: {},
  StreamBan: { findOne: async () => null },
  Report: {},
  StreamLike: {},
  GiftTransaction: {},
}));

describe("LiveKit webhook: the host's feed dropping", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    streamDoc = {
      _id: STREAM_ID,
      streamerId: { toString: () => HOST_ID },
      source: "camera",
      isLive: true,
      livekitRoomName: ROOM,
      feedDroppedAt: null,
      guests: [],
      viewers: 0,
      peakViewers: 0,
      viewerSeconds: 0,
      startedAt: new Date(Date.now() - 60 * 60_000),
      save: vi.fn(async () => {}),
    };
    state.inRoom = [];
    state.dataEvents.length = 0;
    ended.mockClear();
  });

  const deliver = (event: string, identity: string) => {
    state.event = { event, room: { name: ROOM }, participant: { identity } };
    return app.inject({
      method: "POST",
      url: "/v1/webhooks/livekit",
      headers: { "content-type": "application/webhook+json", authorization: "signed" },
      payload: JSON.stringify(state.event),
    });
  };

  it("holds a camera stream when the host's browser leaves, and tells the room", async () => {
    const response = await deliver("participant_left", HOST_ID);

    expect(response.statusCode).toBe(200);
    expect(ended).not.toHaveBeenCalled();
    expect(streamDoc.feedDroppedAt).toBeInstanceOf(Date);
    expect(state.dataEvents).toContainEqual(
      expect.objectContaining({ __evt: "feed", state: "reconnecting" }),
    );
  });

  it("ignores the old session leaving when the host is already back in — a rejoin or another device", async () => {
    state.inRoom = [HOST_ID];

    await deliver("participant_left", HOST_ID);

    expect(ended).not.toHaveBeenCalled();
    expect(streamDoc.feedDroppedAt).toBeNull();
    expect(state.dataEvents).toEqual([]);
  });

  it("ends the stream once the host has been gone longer than the grace window", async () => {
    const { config } = await import("../src/config.js");
    streamDoc.feedDroppedAt = new Date(Date.now() - config.OBS_RECONNECT_GRACE_MS - 1_000);

    await deliver("participant_left", HOST_ID);

    expect(ended).toHaveBeenCalledTimes(1);
  });

  it("clears the hold when the host's browser rejoins", async () => {
    streamDoc.feedDroppedAt = new Date(Date.now() - 30_000);

    await deliver("participant_joined", HOST_ID);

    expect(streamDoc.feedDroppedAt).toBeNull();
    expect(state.dataEvents).toContainEqual({ __evt: "feed", state: "live" });
  });

  it("doesn't treat an OBS host's studio tab leaving as a drop — the encoder is the feed", async () => {
    streamDoc.source = "obs";

    await deliver("participant_left", HOST_ID);

    expect(ended).not.toHaveBeenCalled();
    expect(streamDoc.feedDroppedAt).toBeNull();
  });

  describe("a stage guest dropping out", () => {
    const GUEST = "b".repeat(24);
    const settle = () => new Promise((done) => setTimeout(done, 80));

    beforeEach(async () => {
      const { GUEST_GRACE } = await import("../src/routes/webhooks.js");
      GUEST_GRACE.ms = 30;
      pulled.length = 0;
      streamDoc.guests = [{ userId: { toString: () => GUEST }, username: "tolu", status: "backstage" }];
    });

    it("keeps their place when their reloaded page is already back in", async () => {
      state.inRoom = [GUEST];
      await deliver("participant_left", GUEST);
      await settle();
      expect(pulled).toEqual([]);
      expect(state.dataEvents).not.toContainEqual(expect.objectContaining({ __evt: "guest_update", action: "left" }));
    });

    it("keeps their place when they're back inside the grace", async () => {
      await deliver("participant_left", GUEST);
      state.inRoom = [GUEST];
      await settle();
      expect(pulled).toEqual([]);
    });

    it("frees their place, and tells the room, once they've stayed gone", async () => {
      await deliver("participant_left", GUEST);
      // Not at once: a reload may be a moment away.
      expect(state.dataEvents).not.toContainEqual(expect.objectContaining({ action: "left" }));
      await settle();
      expect(pulled).toHaveLength(1);
      expect(state.dataEvents).toContainEqual({ __evt: "guest_update", action: "left", userId: GUEST, username: "tolu" });
    });
  });
});
