import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IStream } from "../src/models.js";

/**
 * Socials relay delivery guarantees. A lost "ended" relay leaves the socials
 * feed showing a stream as live forever (this happened in production), so the
 * relay retries with backoff on failure — including non-2xx responses — and
 * a periodic sweep re-relays anything still flagged `socialsRelayPending`.
 */

const STREAMER_ID = "a".repeat(24);
const STREAM_ID = "d".repeat(24);

let streamerRow: {
  authUserId: string;
  username: string;
  displayName: string;
} | null;
let pendingStreams: IStream[];
let flagClears: Array<{ filter: unknown; update: unknown }>;

vi.mock("../src/config.js", () => ({
  config: {
    SOCIALS_GATEWAY_URL: "https://gateway.test",
    SOCIALS_WEBHOOK_SECRET: "test-secret",
  },
}));

vi.mock("../src/livekit.js", () => ({
  deleteIngress: async () => {},
  isBroadcasterConnected: async () => true,
}));

vi.mock("../src/models.js", () => ({
  User: {
    findById: () => ({
      select: () => ({ lean: async () => streamerRow }),
    }),
    updateOne: async () => ({}),
  },
  Stream: {
    updateOne: async (filter: unknown, update: unknown) => {
      flagClears.push({ filter, update });
      return {};
    },
    find: () => ({
      sort: () => ({ limit: () => pendingStreams }),
    }),
  },
}));

import { config } from "../src/config.js";
import {
  relayLiveEvent,
  sweepPendingEndRelays,
} from "../src/socials-relay.js";
import { markStreamEnded } from "../src/stream-service.js";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const response = (ok: boolean, status = 200) => ({ ok, status });

function streamStub(overrides: Partial<IStream> = {}) {
  return {
    _id: STREAM_ID,
    streamerId: STREAMER_ID,
    title: "Morning market",
    category: "Bitcoin Trading",
    livekitRoomName: "room-1",
    startedAt: new Date("2026-08-29T10:00:00.000Z"),
    endedAt: new Date("2026-08-29T11:00:00.000Z"),
    peakViewers: 12,
    ...overrides,
  } as unknown as IStream;
}

beforeEach(() => {
  streamerRow = {
    authUserId: "clerk_x",
    username: "streamer",
    displayName: "Streamer",
  };
  pendingStreams = [];
  flagClears = [];
  fetchMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Run a relay under fake timers, skipping the whole backoff ladder. */
async function relayWithBackoff(promise: Promise<unknown>) {
  await vi.advanceTimersByTimeAsync(30_000);
  return promise;
}

describe("relayLiveEvent", () => {
  it("retries a non-2xx response and clears the pending flag on success", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(response(false, 502))
      .mockResolvedValueOnce(response(true));

    const ok = await relayWithBackoff(relayLiveEvent("ended", streamStub()));

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://gateway.test/internal/live/ended",
      expect.objectContaining({ method: "POST" }),
    );
    expect(flagClears).toEqual([
      {
        filter: { _id: STREAM_ID },
        update: { socialsRelayPending: false },
      },
    ]);
  });

  it("retries a network error", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(response(true));

    const ok = await relayWithBackoff(relayLiveEvent("ended", streamStub()));

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the retry ladder and leaves the flag pending", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(response(false, 500));

    const ok = await relayWithBackoff(relayLiveEvent("ended", streamStub()));

    expect(ok).toBe(false);
    // Initial attempt plus one per backoff step.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(flagClears).toEqual([]);
  });

  it("does not touch the pending flag for started events", async () => {
    fetchMock.mockResolvedValue(response(true));

    const ok = await relayLiveEvent("started", streamStub());

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://gateway.test/internal/live/started",
      expect.anything(),
    );
    expect(flagClears).toEqual([]);
  });

  it("bails without fetching when the streamer is missing", async () => {
    streamerRow = null;

    expect(await relayLiveEvent("ended", streamStub())).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops when the gateway is unconfigured", async () => {
    const url = config.SOCIALS_GATEWAY_URL;
    config.SOCIALS_GATEWAY_URL = "";
    try {
      expect(await relayLiveEvent("ended", streamStub())).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      config.SOCIALS_GATEWAY_URL = url;
    }
  });
});

describe("sweepPendingEndRelays", () => {
  it("re-relays ended for every pending stream", async () => {
    pendingStreams = [
      streamStub(),
      streamStub({ _id: "e".repeat(24) } as Partial<IStream>),
    ];
    fetchMock.mockResolvedValue(response(true));

    expect(await sweepPendingEndRelays()).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(flagClears.map((c) => c.filter)).toEqual([
      { _id: STREAM_ID },
      { _id: "e".repeat(24) },
    ]);
  });

  it("stops at the first stream that still can't be relayed", async () => {
    vi.useFakeTimers();
    pendingStreams = [
      streamStub(),
      streamStub({ _id: "e".repeat(24) } as Partial<IStream>),
    ];
    fetchMock.mockResolvedValue(response(false, 503));

    const sweep = sweepPendingEndRelays();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await sweep).toBe(0);
    // Only the first stream's retry ladder ran — the gateway is down, so
    // hammering it with the rest of the batch would be pointless.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("markStreamEnded", () => {
  it("persists the pending flag with the end, then relays and clears it", async () => {
    fetchMock.mockResolvedValue(response(true));

    let flaggedAtSave: boolean | undefined;
    const stream = streamStub({
      isLive: true,
      endedAt: null,
      viewers: 3,
      viewerSeconds: 0,
      viewerSampledAt: null,
      save: async function (this: IStream) {
        flaggedAtSave = this.socialsRelayPending;
      },
    } as Partial<IStream>);

    await markStreamEnded(stream);

    expect(stream.isLive).toBe(false);
    expect(flaggedAtSave).toBe(true);

    // The relay is fire-and-forget — give the microtask queue a beat.
    await new Promise((r) => setTimeout(r, 20));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.test/internal/live/ended",
      expect.anything(),
    );
    expect(flagClears).toEqual([
      {
        filter: { _id: STREAM_ID },
        update: { socialsRelayPending: false },
      },
    ]);
  });
});
