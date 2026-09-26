import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The web app has no test runner of its own; the call manager is
// framework-free (its gateway calls and calls channel are injected), so its
// ringing state machine is exercised from here. Media (LiveKit) isn't
// touched by any path below.
import { CALL_END_COPY, callManager, formatCallClock } from "../../lib/call-manager";

type Handler = (name: string, payload: unknown) => void;

const ME = "c".repeat(24);
const CONV = "a".repeat(24);
const OTHER_CONV = "b".repeat(24);
const caller = { id: "d".repeat(24), name: "Ada Okafor", username: "adaplays", avatar: "" };

function wire() {
  let handler: Handler = () => {};
  const backend = {
    token: vi.fn(),
    ring: vi.fn(),
    signal: vi.fn(async () => ({ success: true })),
    log: vi.fn(async () => ({})),
  };
  callManager.setBackend(backend as never);
  callManager.initialize(ME, (h) => {
    handler = h as Handler;
    return () => {};
  });
  const ring = (conversationId = CONV, extra: Record<string, unknown> = {}) =>
    handler("call:incoming", { conversationId, room: `dm-${conversationId}`, caller, isVideo: false, startedAt: 0, kind: "dm", ...extra });
  return { backend, ring, send: (name: string) => handler(name, {}) };
}

describe("calls: ringing in", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    callManager.shutdown();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("rings with the caller's card", () => {
    const { ring } = wire();
    ring();
    const s = callManager.getState();
    expect(s.status).toBe("ringing");
    expect(s.isIncoming).toBe(true);
    expect(s.peer?.name).toBe("Ada Okafor");
    expect(s.conversationId).toBe(CONV);
  });

  it("tells a second caller you're busy instead of dropping them", () => {
    const { ring, backend } = wire();
    ring();
    ring(OTHER_CONV);
    expect(backend.signal).toHaveBeenCalledWith(OTHER_CONV, "call:busy");
    expect(callManager.getState().conversationId).toBe(CONV);
  });

  it("declines: says so to the caller, shows the line, then goes quiet", () => {
    const { ring, backend } = wire();
    ring();
    callManager.declineCall();
    expect(backend.signal).toHaveBeenCalledWith(CONV, "call:decline");
    expect(callManager.getState()).toMatchObject({ status: "ended", endReason: "declined" });
    vi.advanceTimersByTime(1_800);
    expect(callManager.getState().status).toBe("idle");
  });

  it("stops ringing when the caller gives up", () => {
    const { ring, send } = wire();
    ring();
    send("call:cancel");
    expect(callManager.getState()).toMatchObject({ status: "ended", endReason: "cancelled" });
  });

  it("stops ringing on its own after 45 seconds, like a phone", () => {
    const { ring } = wire();
    ring();
    vi.advanceTimersByTime(44_000);
    expect(callManager.getState().status).toBe("ringing");
    vi.advanceTimersByTime(1_000);
    expect(callManager.getState()).toMatchObject({ status: "ended", endReason: "unanswered" });
  });

  it("names a group call by the group, and says who's calling", () => {
    const { ring } = wire();
    ring(CONV, { kind: "group", group: { name: "Night Owls", memberCount: 8 } });
    const s = callManager.getState();
    expect(s.isGroup).toBe(true);
    expect(s.peer?.name).toBe("Night Owls");
    expect(s.groupCaller?.name).toBe("Ada Okafor");
  });

  it("never logs a call it didn't place (only the caller writes the row)", () => {
    const { ring, backend } = wire();
    ring();
    callManager.declineCall();
    vi.advanceTimersByTime(1_800);
    expect(backend.log).not.toHaveBeenCalled();
  });
});

describe("call copy", () => {
  it("formats the clock", () => {
    expect(formatCallClock(7_000)).toBe("0:07");
    expect(formatCallClock(125_000)).toBe("2:05");
    expect(formatCallClock(3_723_000)).toBe("1:02:03");
  });

  it("has a closing line for every way a call ends", () => {
    expect(CALL_END_COPY.busy).toBe("They're on another call");
    expect(CALL_END_COPY.unanswered).toBe("No answer");
  });
});
