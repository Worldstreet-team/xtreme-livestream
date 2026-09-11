import { describe, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { holdForReconnect } from "../src/stream-service.js";
import type { IStream } from "../src/models.js";

/**
 * A dropped OBS/RTMP encoder must not end the stream on the spot: the key
 * is persistent, so the encoder reconnects into the same room, and viewers
 * in a church hall with flaky data should see "reconnecting", not "ended".
 */
function fakeStream(over: Partial<IStream>): IStream {
  return {
    source: "obs",
    feedDroppedAt: null,
    save: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as unknown as IStream;
}

describe("holdForReconnect", () => {
  it("never holds a browser-fed stream — there is no encoder to wait for", async () => {
    const stream = fakeStream({ source: "camera" });
    await expect(holdForReconnect(stream)).resolves.toBe(false);
    expect(stream.save).not.toHaveBeenCalled();
  });

  it("stamps the first sighting of a drop and keeps the stream live", async () => {
    const stream = fakeStream({});
    await expect(holdForReconnect(stream)).resolves.toBe(true);
    expect(stream.feedDroppedAt).toBeInstanceOf(Date);
    expect(stream.save).toHaveBeenCalledTimes(1);
  });

  it("keeps holding while the drop is younger than the grace window", async () => {
    const stream = fakeStream({
      feedDroppedAt: new Date(Date.now() - config.OBS_RECONNECT_GRACE_MS / 2),
    });
    await expect(holdForReconnect(stream)).resolves.toBe(true);
    expect(stream.save).not.toHaveBeenCalled();
  });

  it("lets go once the encoder has been gone longer than the grace window", async () => {
    const stream = fakeStream({
      feedDroppedAt: new Date(Date.now() - config.OBS_RECONNECT_GRACE_MS - 1_000),
    });
    await expect(holdForReconnect(stream)).resolves.toBe(false);
  });
});
