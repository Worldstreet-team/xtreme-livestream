import { describe, expect, it } from "vitest";
import { readLayers } from "../../../lib/scene";
import { checkpointState, formatIn, formatMove, moveSince, wentTheCalledWay } from "../../../lib/market-calls";
import { movePct, wentTheCalledWay as apiCalledWay } from "../src/calls.js";

/**
 * Call receipts as the web app reads them: a call card off the wire is
 * drawn only when its record is whole; a checkpoint reads as done (and
 * which way it went against the call), checking, pending "in 3 h" or
 * unavailable; and the web's rule for "the called way" is the API's.
 */

const CALL_ID = "a".repeat(24);
const card = { kind: "call", callId: CALL_ID, symbol: "SOL-USD", direction: "up", entryPrice: 142.1, entryAt: "2026-09-26T20:14:00.000Z", by: "Ada K" };

describe("a call card off the wire", () => {
  it("keeps a whole one as it came", () => {
    expect(readLayers([card])).toEqual([card]);
  });

  it("tidies the market and trims the name", () => {
    expect(readLayers([{ ...card, symbol: "sol-usd", by: `  ${"Ada K".padEnd(90, "!")}  ` }])).toEqual([{ ...card, by: "Ada K".padEnd(80, "!") }]);
  });

  it("drops one that's missing what it's about, rather than drawing it wrong", () => {
    for (const broken of [
      { ...card, callId: "nope" },
      { ...card, symbol: "bitcoin" },
      { ...card, direction: "sideways" },
      { ...card, entryPrice: 0 },
      { ...card, entryPrice: "142.10" },
      { ...card, entryAt: "yesterday" },
    ]) {
      expect(readLayers([broken, { kind: "banner", text: "SOL talk" }])).toEqual([{ kind: "banner", text: "SOL talk" }]);
    }
  });
});

describe("a call's checkpoints, for the reader", () => {
  const at = Date.parse("2026-09-26T20:14:00.000Z");
  const call = {
    direction: "down" as const,
    entry: { price: 100, at: new Date(at).toISOString() },
    outcomes: {
      h1: { at: new Date(at + 3_600_000).toISOString(), price: 97, changePct: -3, unavailable: false as const },
      h24: null,
      d7: { at: new Date(at + 7 * 86_400_000).toISOString(), price: null, changePct: null, unavailable: true as const },
    },
  };

  it("reads a filled one, and whether it went the called way", () => {
    expect(checkpointState(call, "h1", at + 2 * 3_600_000)).toEqual({ state: "done", price: 97, changePct: -3, calledWay: true });
    expect(checkpointState({ ...call, direction: "up" }, "h1", at + 2 * 3_600_000)).toMatchObject({ calledWay: false });
    expect(checkpointState(call, "d7", at + 8 * 86_400_000)).toEqual({ state: "unavailable" });
  });

  it("says how long until an open one, and that it's being checked once its time has come", () => {
    expect(checkpointState(call, "h24", at + 21 * 3_600_000)).toEqual({ state: "pending", inMs: 3 * 3_600_000 });
    expect(formatIn(3 * 3_600_000)).toBe("in 3 h");
    expect(checkpointState(call, "h24", at + 24 * 3_600_000 + 1)).toEqual({ state: "checking" });
  });

  it("puts waits and moves into words", () => {
    expect(formatIn(40 * 60_000)).toBe("in 40 min");
    expect(formatIn(10_000)).toBe("in 1 min");
    expect(formatIn(5 * 86_400_000 + 3 * 3_600_000)).toBe("in 5 d");
    expect(formatMove(1.2345)).toBe("1.23%");
    expect(formatMove(-12.345)).toBe("12.3%");
    expect(moveSince(142.1, 145)).toBeCloseTo(2.0408, 3);
  });

  it("holds 'the called way' to the API's rule: flat isn't right", () => {
    for (const [direction, pct] of [["up", 1], ["up", -1], ["up", 0], ["down", -1], ["down", 1], ["down", 0]] as const) {
      expect(wentTheCalledWay(direction, pct)).toBe(apiCalledWay(direction, pct));
    }
    expect(movePct(100, 104)).toBe(4);
  });
});
