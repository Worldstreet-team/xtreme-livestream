import { describe, expect, it } from "vitest";
import { readSuggestion, suggestionsReducer, type SuggestionsState } from "../../../lib/market-suggestions";
import {
  inQuestionRange,
  minutesFromNow,
  nextClockTime,
  nudgeThreshold,
  questionMarkets,
  readThreshold,
  searchMarkets,
  thresholdNudge,
} from "../../../lib/market-questions";
import { questionOf } from "../../../lib/games";

/**
 * The market as director and market questions, as the web app reads them:
 * a suggestion off the wire is taken only when it's whole enough to act
 * on; the tray keeps the newest few, once each, never a dismissed one;
 * and the Games panel's market question picks its market, line and time.
 */

const MIN = 60_000;
const NOW = Date.parse("2026-09-27T19:15:27Z");
const wire = (over: Record<string, unknown> = {}) => ({
  id: "s-1",
  kind: "move",
  symbol: "SOL-USD",
  text: "SOL +3.4% in 15 min",
  price: 125.4,
  changePct: 3.4,
  windowMin: 15,
  level: null,
  at: new Date(NOW).toISOString(),
  actions: {
    chart: { symbol: "SOL-USD", interval: "1m" },
    banner: "SOL up 3.4% in the last 15 minutes · Not financial advice",
    question: { symbol: "SOL-USD", above: 130, minutes: 15 },
  },
  ...over,
});

describe("a suggestion off the wire", () => {
  it("reads a whole one as it came", () => {
    expect(readSuggestion(wire())).toEqual(wire());
  });

  it("drops what it can't act on", () => {
    expect(readSuggestion(null)).toBeNull();
    expect(readSuggestion("SOL +3%")).toBeNull();
    expect(readSuggestion(wire({ id: "" }))).toBeNull();
    expect(readSuggestion(wire({ symbol: "solana" }))).toBeNull();
    expect(readSuggestion(wire({ kind: "moon" }))).toBeNull();
    expect(readSuggestion(wire({ price: 0 }))).toBeNull();
    expect(readSuggestion(wire({ at: "yesterday" }))).toBeNull();
    expect(readSuggestion(wire({ text: "" }))).toBeNull();
  });

  it("tidies the actions rather than drop the suggestion", () => {
    const s = readSuggestion(wire({ symbol: "sol-usd", actions: { chart: { symbol: "nope", interval: "3m" }, banner: 42, question: { symbol: "SOL-BTC", above: 1, minutes: 15 } } }));
    expect(s?.symbol).toBe("SOL-USD");
    expect(s?.actions).toEqual({ chart: { symbol: "SOL-USD", interval: "5m" }, banner: "", question: null });
    expect(readSuggestion(wire({ actions: { question: { symbol: "SOL-USD", above: 130, minutes: 9999 } } }))?.actions.question).toEqual({ symbol: "SOL-USD", above: 130, minutes: 15 });
  });
});

describe("the tray's list", () => {
  const empty: SuggestionsState = { items: [], dismissed: [] };
  const at = (min: number) => new Date(NOW + min * MIN).toISOString();
  const s = (id: string, min: number) => readSuggestion(wire({ id, at: at(min) }))!;

  it("keeps the newest few, once each", () => {
    let state = empty;
    for (let i = 0; i < 7; i++) state = suggestionsReducer(state, { type: "add", suggestion: s(`s${i}`, i) });
    state = suggestionsReducer(state, { type: "add", suggestion: s("s6", 6) });
    expect(state.items.map((x) => x.id)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
  });

  it("merges what a reload fetches with what the room already brought", () => {
    let state = suggestionsReducer(empty, { type: "add", suggestion: s("live", 3) });
    state = suggestionsReducer(state, { type: "load", suggestions: [s("old", 1), s("live", 3)] });
    expect(state.items.map((x) => x.id)).toEqual(["live", "old"]);
  });

  it("never brings back one the host dismissed", () => {
    let state = suggestionsReducer(empty, { type: "add", suggestion: s("a", 1) });
    state = suggestionsReducer(state, { type: "dismiss", id: "a" });
    state = suggestionsReducer(state, { type: "add", suggestion: s("a", 1) });
    state = suggestionsReducer(state, { type: "load", suggestions: [s("a", 1)] });
    expect(state.items).toEqual([]);
    expect(state.dismissed).toEqual(["a"]);
  });

  it("lets them go after half an hour", () => {
    const state = suggestionsReducer(suggestionsReducer(empty, { type: "add", suggestion: s("a", 0) }), { type: "add", suggestion: s("b", 20) });
    expect(suggestionsReducer(state, { type: "prune", now: NOW + 31 * MIN }).items.map((x) => x.id)).toEqual(["b"]);
  });
});

describe("the market question, before it's asked", () => {
  it("means the whole minute at least that far out by +15 min", () => {
    expect(new Date(minutesFromNow(15, NOW)).toISOString()).toBe("2026-09-27T19:31:00.000Z");
  });

  it("reads a custom time as the next time it comes round", () => {
    const local = new Date(NOW);
    const later = new Date(NOW + 90 * MIN);
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    expect(nextClockTime(hhmm(later), NOW)).toBe(new Date(later).setSeconds(0, 0));
    // A time already gone today is tomorrow's.
    const earlier = nextClockTime(hhmm(local), NOW)!;
    expect(earlier - NOW).toBeGreaterThan(23 * 60 * MIN);
    expect(nextClockTime("25:00", NOW)).toBeNull();
    expect(nextClockTime("soon", NOW)).toBeNull();
  });

  it("takes five minutes to a day", () => {
    expect(inQuestionRange(NOW + 4 * MIN, NOW)).toBe(false);
    expect(inQuestionRange(NOW + 5 * MIN, NOW)).toBe(true);
    expect(inQuestionRange(NOW + 24 * 60 * MIN, NOW)).toBe(true);
    expect(inQuestionRange(NOW + 24 * 60 * MIN + 1, NOW)).toBe(false);
  });

  it("nudges the line by a tenth of the market's round step", () => {
    expect(thresholdNudge(121.46)).toBe(1);
    expect(thresholdNudge(84_465)).toBe(100);
    expect(thresholdNudge(0.0967)).toBe(0.0001);
    expect(nudgeThreshold(121, 1, 1)).toBe(122);
    expect(nudgeThreshold(0.0967, 0.0001, -1)).toBe(0.0966);
    expect(nudgeThreshold(1, 1, -1)).toBe(1);
  });

  it("offers the strip's, chat's and the chart's dollar markets first, then the majors", () => {
    expect(questionMarkets(["DOGE-USD", "eth-usd", "ETH-BTC", "DOGE-USD"])).toEqual(["DOGE-USD", "ETH-USD", "BTC-USD", "SOL-USD"]);
    expect(questionMarkets([])).toEqual(["BTC-USD", "ETH-USD", "SOL-USD"]);
  });

  it("finds a coin by what's typed", () => {
    const known = ["ADA-USD", "AAVE-USD", "ADX-USD", "SAND-USD", "ANKR-USD", "BTC-USD", "ETH-BTC"];
    expect(searchMarkets(known, "ada")).toEqual(["ADA-USD"]);
    expect(searchMarkets(known, "ad")).toEqual(["ADA-USD", "ADX-USD"]);
    // Those that start with it, then those that only contain it.
    expect(searchMarkets(known, "an")).toEqual(["ANKR-USD", "SAND-USD"]);
    expect(searchMarkets(known, "$btc")).toEqual(["BTC-USD"]);
    expect(searchMarkets(known, "eth")).toEqual([]);
    expect(searchMarkets(known, "  ")).toEqual([]);
  });

  it("reads a typed line as a price", () => {
    expect(readThreshold("$84,500")).toBe(84_500);
    expect(readThreshold("0.097")).toBe(0.097);
    expect(readThreshold("0")).toBeNull();
    expect(readThreshold("lots")).toBeNull();
  });

  it("says a market question in the device's own time, anything else as typed", () => {
    const at = "2026-09-27T19:30:00Z";
    const oracle = { symbol: "SOL-USD", above: 150, at, source: "Coinbase" as const, price: null, failed: null };
    expect(questionOf({ question: "SOL above $150.00 at 20:30?", oracle }, NOW)).toMatch(/^SOL above \$150\.00 at \d\d:\d\d\?$/);
    expect(questionOf({ question: "Do we win this match?", oracle: null })).toBe("Do we win this match?");
  });
});
