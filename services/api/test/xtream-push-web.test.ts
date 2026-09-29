import { describe, expect, it, vi } from "vitest";
import { createXtreamPushHub, pollPace, readPush, type AblyClientLike } from "@/lib/xtream-push";

/**
 * The web's half of the realtime pushes (lib/xtream-push.ts): public events
 * on `xtream`, personal ones on `user:<profileId>` as `xtream` with the name
 * in `type`; polls keep their pace until pushes arrive, slow to a backstop
 * after, and go back to their pace when the connection drops.
 */

function fakeAbly() {
  const subs = new Map<string, Array<{ name: string | null; fn: (m: unknown) => void }>>();
  let onState: ((c: { current: string }) => void) | null = null;
  const client: AblyClientLike = {
    channels: {
      get: (channel) => ({
        subscribe: (a: unknown, b?: unknown) => {
          const entry = typeof a === "string" ? { name: a, fn: b as (m: unknown) => void } : { name: null, fn: a as (m: unknown) => void };
          subs.set(channel, [...(subs.get(channel) ?? []), entry]);
          return Promise.resolve();
        },
        unsubscribe: (fn?: unknown) => subs.set(channel, (subs.get(channel) ?? []).filter((s) => s.fn !== fn)),
      }),
    },
    connection: { state: "connected", on: (l) => void (onState = l), off: () => void (onState = null) },
  };
  const publish = (channel: string, name: string, data: unknown) =>
    (subs.get(channel) ?? []).filter((s) => s.name === null || s.name === name).forEach((s) => s.fn({ name, data }));
  return { client, publish, state: (current: string) => onState?.({ current }) };
}

describe("reading a push", () => {
  it("takes a public event by its message name", () => {
    expect(readPush({ name: "stream.started", data: { streamId: "s1", username: "chioma" } }, false)).toEqual({
      name: "stream.started",
      data: { streamId: "s1", username: "chioma" },
      personal: false,
    });
  });

  it("takes a personal event from `type` inside the `xtream` message", () => {
    expect(readPush({ name: "xtream", data: { type: "notification", kind: "live", id: "n1" } }, true)).toEqual({
      name: "notification",
      data: { kind: "live", id: "n1" },
      personal: true,
    });
    expect(readPush({ name: "xtream", data: JSON.stringify({ type: "live", state: "ended", streamId: "s" }) }, true)?.name).toBe("live");
  });

  it("ignores messaging's own events and anything malformed", () => {
    expect(readPush({ name: "event", data: { type: "message:new" } }, true)).toBeNull();
    expect(readPush({ name: "xtream", data: {} }, true)).toBeNull();
    expect(readPush({ name: "", data: {} }, false)).toBeNull();
    expect(readPush(null, false)).toBeNull();
  });
});

describe("the hub", () => {
  it("stays at the poll's pace until the first push, then the backstop — and back when the line drops", () => {
    const hub = createXtreamPushHub();
    const ably = fakeAbly();
    const paced = vi.fn();
    hub.onPace(paced);
    hub.attach(ably.client, "p1");
    expect(hub.live()).toBe(false);
    expect(pollPace(30_000, 60_000, hub.live())).toBe(30_000);

    ably.publish("xtream", "stream.started", { streamId: "s1" });
    expect(hub.live()).toBe(true);
    expect(pollPace(30_000, 60_000, hub.live())).toBe(60_000);
    expect(paced).toHaveBeenCalledTimes(1);

    ably.state("disconnected");
    expect(hub.live()).toBe(false);
    ably.state("connected");
    expect(hub.live()).toBe(true);
    expect(paced).toHaveBeenCalledTimes(3);
  });

  it("hands every push to listeners, personal ones from the person's own channel only", () => {
    const hub = createXtreamPushHub();
    const ably = fakeAbly();
    const heard: unknown[] = [];
    hub.listen((s) => heard.push(s));
    hub.attach(ably.client, "p1");
    ably.publish("xtream", "battle.ended", { battleId: "b1", streamIds: ["a", "b"] });
    ably.publish("user:p1", "xtream", { type: "live", state: "camera", streamId: "s1", secondCameraConnected: true });
    ably.publish("user:p1", "event", { type: "message:new" });
    ably.publish("user:someone-else", "xtream", { type: "notification", kind: "live" });
    expect(heard).toEqual([
      { name: "battle.ended", data: { battleId: "b1", streamIds: ["a", "b"] }, personal: false },
      { name: "live", data: { state: "camera", streamId: "s1", secondCameraConnected: true }, personal: true },
    ]);
  });

  it("asks for one refetch after the connection comes back, since pushes were missed", () => {
    const hub = createXtreamPushHub();
    const ably = fakeAbly();
    const heard: unknown[] = [];
    hub.listen((s) => heard.push(s));
    hub.attach(ably.client, "p1");
    ably.state("disconnected");
    ably.state("connected");
    // Nothing had arrived yet, so nothing was relying on pushes.
    expect(heard).toEqual([]);
    ably.publish("xtream", "stream.ended", { streamId: "s1" });
    ably.state("suspended");
    ably.state("connected");
    expect(heard.at(-1)).toBe("resync");
  });

  it("a backstop never speeds a poll up", () => {
    expect(pollPace(120_000, 60_000, true)).toBe(120_000);
  });
});
