import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendRoomData } = vi.hoisted(() => ({
  sendRoomData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/livekit.js", () => ({
  isBroadcasterConnected: vi.fn(),
  sendRoomData,
}));

import { config } from "../src/config.js";
import { feedIdentity, holdForReconnect, markFeedBack } from "../src/stream-service.js";
import type { IStream } from "../src/models.js";

/**
 * A dropped feed must not end the stream on the spot. An OBS/RTMP encoder
 * reconnects into the same room on its persistent key; since 2026-09-25 a
 * host's browser does too, rejoining from the studio. Viewers in a church
 * hall — or on Lagos mobile data — should see "be right back", not "ended".
 */
function fakeStream(over: Partial<IStream>): IStream {
  return {
    source: "obs",
    feedDroppedAt: null,
    livekitRoomName: "stream-room",
    streamerId: { toString: () => "host1" },
    save: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IStream;
}

beforeEach(() => {
  sendRoomData.mockClear();
});

describe("feedIdentity", () => {
  it("is the encoder for an OBS stream", () => {
    expect(feedIdentity(fakeStream({ source: "obs" }))).toBe("obs-host1");
  });

  it("is the host's own browser for a camera or screen stream", () => {
    expect(feedIdentity(fakeStream({ source: "camera" }))).toBe("host1");
    expect(feedIdentity(fakeStream({ source: "screen" }))).toBe("host1");
  });
});

describe("holdForReconnect", () => {
  it("holds a browser-fed stream the same way — the studio rejoins on its own", async () => {
    const stream = fakeStream({ source: "camera" });
    await expect(holdForReconnect(stream)).resolves.toBe(true);
    expect(stream.feedDroppedAt).toBeInstanceOf(Date);
  });

  it("stamps the first sighting of a drop, keeps the stream live and tells the room", async () => {
    const stream = fakeStream({});
    await expect(holdForReconnect(stream)).resolves.toBe(true);
    expect(stream.feedDroppedAt).toBeInstanceOf(Date);
    expect(stream.save).toHaveBeenCalledTimes(1);
    expect(sendRoomData).toHaveBeenCalledWith("stream-room", {
      __evt: "feed",
      state: "reconnecting",
      graceMs: config.OBS_RECONNECT_GRACE_MS,
    });
  });

  it("keeps holding while the drop is younger than the grace window, without re-announcing it", async () => {
    const stream = fakeStream({
      feedDroppedAt: new Date(Date.now() - config.OBS_RECONNECT_GRACE_MS / 2),
    });
    await expect(holdForReconnect(stream)).resolves.toBe(true);
    expect(stream.save).not.toHaveBeenCalled();
    expect(sendRoomData).not.toHaveBeenCalled();
  });

  it("lets go once the feed has been gone longer than the grace window", async () => {
    const stream = fakeStream({
      source: "camera",
      feedDroppedAt: new Date(Date.now() - config.OBS_RECONNECT_GRACE_MS - 1_000),
    });
    await expect(holdForReconnect(stream)).resolves.toBe(false);
  });
});

describe("markFeedBack", () => {
  it("clears the drop and tells the room the picture is back", async () => {
    const stream = fakeStream({ source: "camera", feedDroppedAt: new Date() });
    await markFeedBack(stream);
    expect(stream.feedDroppedAt).toBeNull();
    expect(stream.save).toHaveBeenCalledTimes(1);
    expect(sendRoomData).toHaveBeenCalledWith("stream-room", { __evt: "feed", state: "live" });
  });

  it("does nothing when nothing had dropped", async () => {
    const stream = fakeStream({ source: "camera" });
    await markFeedBack(stream);
    expect(stream.save).not.toHaveBeenCalled();
    expect(sendRoomData).not.toHaveBeenCalled();
  });
});
