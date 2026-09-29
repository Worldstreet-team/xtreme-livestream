import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; the battle stage's pure
// helpers are exercised from here via a relative import.
import type { BattleSide, BattleView } from "../../../lib/battles";
import { formatPoints, formatPracticeScore } from "../../../lib/battles";
import { resultOf } from "../../../lib/battle-result";
import {
  BAR_H,
  SHARE_MIN,
  STAMP_MS,
  TOAST_MS,
  barShare,
  captionFor,
  clockFor,
  columnBand,
  dimmed,
  onStage,
  outcomeOf,
  portraitBand,
  pushToast,
  resultLine,
  resultUp,
  scoreLine,
  seatsOf,
  shouldAnnounce,
  sidesFor,
  stampShowing,
  toastText,
  vsShowing,
  type GiftToast,
} from "../../../lib/battle-stage";

const T0 = Date.parse("2026-09-29T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function side(name: string, over: Partial<BattleSide> = {}): BattleSide {
  const username = name.toLowerCase();
  return { userId: `u-${username}`, username, displayName: name, avatar: "", streamId: `s-${username}`, usdMinor: 0, top: [], partner: null, streak: 0, ...over };
}

function battle(over: Partial<BattleView> = {}): BattleView {
  return {
    id: "b1",
    status: "live",
    scheduledAt: null,
    startsAt: iso(T0 - 60_000),
    endsAt: iso(T0 + 240_000),
    durationSec: 300,
    multiplierWindowSec: 30,
    multiplier: 2,
    host: side("Ada"),
    challenger: side("Tolu"),
    winnerId: null,
    bonusUsdMinor: 0,
    overtimeUsed: false,
    lateResetUsed: false,
    forfeit: "",
    mode: "1v1",
    endedReason: null,
    lapEndsAt: null,
    ...over,
  };
}

/** Ada won at T0; the lap runs three minutes. */
const won = (over: Partial<BattleView> = {}) =>
  battle({
    status: "ended",
    endsAt: iso(T0),
    lapEndsAt: iso(T0 + 180_000),
    winnerId: "u-ada",
    host: side("Ada", { usdMinor: 12_400 }),
    challenger: side("Tolu", { usdMinor: 9_100 }),
    ...over,
  });

describe("points", () => {
  it("writes whole points to 9,999 and short past it, never money", () => {
    expect(formatPoints(0)).toBe("0");
    expect(formatPoints(940)).toBe("940");
    expect(formatPoints(9_999)).toBe("9,999");
    expect(formatPoints(12_400)).toBe("12.4K");
    expect(formatPoints(10_000)).toBe("10K");
    expect(formatPoints(99_949)).toBe("99.9K");
    expect(formatPoints(99_960)).toBe("100K");
    expect(formatPoints(125_000)).toBe("125K");
    expect(formatPoints(999_600)).toBe("1M");
    expect(formatPoints(1_240_000)).toBe("1.2M");
    expect(formatPoints(12_400_000)).toBe("12M");
    expect(formatPoints(-5)).toBe("0");
    expect(formatPoints(Number.NaN)).toBe("0");
    for (const n of [0, 5, 9_999, 12_345, 123_456, 9_876_543]) expect(formatPoints(n)).not.toContain("$");
  });

  it("keeps practice scores as they were written", () => {
    expect(formatPracticeScore(1_250)).toBe("1,250 pts");
    expect(formatPracticeScore(12_500, true)).toBe("12.5K pts");
    expect(formatPracticeScore(125_000, true)).toBe("125K pts");
  });
});

describe("the bar", () => {
  it("starts level, follows the share from our side, and never squeezes an end off", () => {
    expect(barShare(battle(), "host")).toBe(0.5);
    const b = battle({ host: side("Ada", { usdMinor: 3_000 }), challenger: side("Tolu", { usdMinor: 1_000 }) });
    expect(barShare(b, "host")).toBeCloseTo(0.75);
    expect(barShare(b, "challenger")).toBeCloseTo(0.25);
    const lopsided = battle({ host: side("Ada", { usdMinor: 100_000 }), challenger: side("Tolu", { usdMinor: 1 }) });
    expect(barShare(lopsided, "host")).toBe(1 - SHARE_MIN);
    expect(barShare(lopsided, "challenger")).toBe(SHARE_MIN);
  });

  it("puts the room we're in on the left", () => {
    expect(sidesFor(battle(), "s-tolu")).toEqual({ ours: "challenger", theirs: "host" });
    expect(sidesFor(battle(), "s-ada")).toEqual({ ours: "host", theirs: "challenger" });
    // A stream that isn't in it reads as the host's side.
    expect(sidesFor(battle(), "elsewhere").ours).toBe("host");
  });
});

describe("the clock pill", () => {
  it("counts down, turns ×2 in the closing window and chili in the last ten seconds", () => {
    expect(clockFor(battle(), T0)).toMatchObject({ tone: "calm", text: "4:00" });
    expect(clockFor(battle({ endsAt: iso(T0 + 25_000) }), T0)).toMatchObject({ tone: "double", text: "0:25" });
    expect(clockFor(battle({ endsAt: iso(T0 + 9_200) }), T0)).toMatchObject({ tone: "final", text: "0:10" });
    expect(clockFor(battle({ endsAt: iso(T0 + 4_000), status: "overtime" }), T0)).toMatchObject({ tone: "final", overtime: true });
  });

  it("runs the lap's clock after a win and says Draw after a draw", () => {
    expect(clockFor(won(), T0 + 20_000)).toMatchObject({ tone: "lap", text: "2:40" });
    expect(clockFor(won({ winnerId: null, host: side("Ada", { usdMinor: 5 }), challenger: side("Tolu", { usdMinor: 5 }) }), T0)).toMatchObject({ tone: "draw", text: "Draw" });
  });

  it("says one short line: ×2 first, then which gifts count, then the forfeit", () => {
    const hot = battle({ endsAt: iso(T0 + 20_000), forfeit: "sings" });
    expect(captionFor(hot, T0, "Only Crown counts")).toEqual({ text: "Last 30 seconds: gifts count double", tone: "double" });
    expect(captionFor(battle({ forfeit: "sings" }), T0, "Only Crown counts")?.text).toBe("Only Crown counts");
    expect(captionFor(battle({ forfeit: "sings" }), T0, null)?.text).toBe("Loser sings");
    expect(captionFor(battle(), T0, null)).toBeNull();
    expect(captionFor(won({ forfeit: "sings" }), T0, null)).toBeNull();
  });
});

describe("the result", () => {
  it("stamps WIN and LOSE for a moment, then dims the loser for the lap", () => {
    const b = won();
    expect(outcomeOf(b, "host")).toBe("win");
    expect(outcomeOf(b, "challenger")).toBe("lose");
    expect(stampShowing(b, T0 + 500)).toBe(true);
    expect(dimmed(b, "challenger", T0 + 500)).toBe(false);
    expect(stampShowing(b, T0 + STAMP_MS + 1)).toBe(false);
    expect(dimmed(b, "challenger", T0 + STAMP_MS + 1)).toBe(true);
    expect(dimmed(b, "host", T0 + STAMP_MS + 1)).toBe(false);
    // Someone arriving mid-lap sees the dimming, not a stamp.
    expect(stampShowing(b, T0 + 90_000)).toBe(false);
    expect(dimmed(b, "challenger", T0 + 90_000)).toBe(true);
    // The lap's over: the stage goes back.
    expect(resultUp(b, T0 + 180_001)).toBe(false);
    expect(onStage(b, T0 + 180_001)).toBe(false);
    expect(dimmed(b, "challenger", T0 + 180_001)).toBe(false);
  });

  it("stamps one DRAW, dims nobody, and has no lap", () => {
    const draw = won({ winnerId: null, lapEndsAt: iso(T0 + 8_000), host: side("Ada", { usdMinor: 5 }), challenger: side("Tolu", { usdMinor: 5 }) });
    expect(outcomeOf(draw, "host")).toBe("draw");
    expect(dimmed(draw, "host", T0 + 5_000)).toBe(false);
    expect(dimmed(draw, "challenger", T0 + 5_000)).toBe(false);
    expect(onStage(draw, T0 + 9_000)).toBe(false);
  });

  it("keeps a result from before laps up for the old two minutes", () => {
    const old = won({ lapEndsAt: undefined });
    expect(onStage(old, T0 + 119_000)).toBe(true);
    expect(onStage(old, T0 + 121_000)).toBe(false);
  });

  it("owns the stage while it runs, and not once it's cancelled", () => {
    expect(onStage(battle(), T0)).toBe(true);
    expect(onStage(battle({ status: "cancelled" }), T0)).toBe(false);
    expect(onStage(null, T0)).toBe(false);
  });

  it("shows VS only as the clock starts", () => {
    const fresh = battle({ startsAt: iso(T0 - 400) });
    expect(vsShowing(fresh, T0)).toBe(true);
    expect(vsShowing(fresh, T0 + 2_000)).toBe(false);
    expect(vsShowing(battle(), T0)).toBe(false);
  });
});

describe("the seats", () => {
  it("fills three seats from the side's top backers, empty ones as null", () => {
    const b = (n: number) => ({ userId: `f${n}`, username: `f${n}`, displayName: `Fan ${n}`, avatar: "", usdMinor: 100 * n });
    expect(seatsOf(side("Ada", { top: [b(3), b(2)] })).map((s) => s?.userId ?? null)).toEqual(["f3", "f2", null]);
    expect(seatsOf(side("Ada", { top: undefined }))).toEqual([null, null, null]);
    expect(seatsOf(side("Ada", { top: [b(4), b(3), b(2), b(1)] }))).toHaveLength(3);
  });
});

describe("gift toasts", () => {
  const hit = (key: string, sender = "Tolu", gift = "Rose", s: "host" | "challenger" = "host") => ({ key, side: s, sender, gift, emoji: "🌹" });

  it("counts the same gift from the same sender up instead of stacking", () => {
    let list: GiftToast[] = [];
    for (let i = 0; i < 5; i++) list = pushToast(list, hit(`g${i}`), T0 + i * 500);
    expect(list).toHaveLength(1);
    expect(toastText(list[0]!)).toBe("Tolu sent Rose ×5");
    list = pushToast(list, hit("x", "Kemi"), T0 + 3_000);
    expect(list.map(toastText)).toEqual(["Kemi sent Rose", "Tolu sent Rose ×5"]);
  });

  it("keeps a few a side, and lets old ones go", () => {
    let list: GiftToast[] = [];
    for (let i = 0; i < 5; i++) list = pushToast(list, hit(`g${i}`, `Fan ${i}`), T0 + i);
    list = pushToast(list, hit("c", "Ada fan", "Crown", "challenger"), T0 + 10);
    expect(list.filter((t) => t.side === "host").map((t) => t.sender)).toEqual(["Fan 4", "Fan 3", "Fan 2"]);
    expect(list.filter((t) => t.side === "challenger")).toHaveLength(1);
    expect(pushToast(list, hit("late", "Someone"), T0 + TOAST_MS + 100)).toHaveLength(1);
  });
});

describe("for screen readers", () => {
  it("says the score ours first, and who leads", () => {
    const b = battle({ host: side("Ada", { usdMinor: 12_400 }), challenger: side("Tolu", { usdMinor: 9_100 }) });
    expect(scoreLine(b, "host")).toBe("Ada 12.4K points, Tolu 9,100 points. Ada leads.");
    expect(scoreLine(b, "challenger")).toBe("Tolu 9,100 points, Ada 12.4K points. Ada leads.");
    expect(scoreLine(battle(), "host")).toBe("Ada 0 points, Tolu 0 points. Level.");
  });

  it("says it every ten seconds at most, but at once when the lead changes", () => {
    const prev = { at: T0, lead: "host" as const, line: "a" };
    expect(shouldAnnounce(null, "host", "a", T0)).toBe(true);
    expect(shouldAnnounce(prev, "host", "b", T0 + 4_000)).toBe(false);
    expect(shouldAnnounce(prev, "host", "b", T0 + 10_000)).toBe(true);
    expect(shouldAnnounce(prev, "host", "a", T0 + 60_000)).toBe(false);
    expect(shouldAnnounce(prev, "challenger", "b", T0 + 1_000)).toBe(true);
  });

  it("tells the result card when the other side ended it early", () => {
    expect(resultOf(won({ endedReason: "conceded" })).subline).toBe("The other side ended it early");
    expect(resultOf(won()).subline).toBeNull();
    expect(resultOf(won({ endedReason: "conceded", overtimeUsed: true })).subline).toBe("Won in overtime");
  });

  it("says the result once", () => {
    expect(resultLine(won())).toBe("The battle is over. Ada wins.");
    expect(resultLine(won({ endedReason: "conceded" }))).toBe("The battle is over. Ada wins — the other side ended it early.");
    expect(resultLine(won({ winnerId: null, host: side("Ada", { usdMinor: 1 }), challenger: side("Tolu", { usdMinor: 1 }) }))).toBe("The battle is over. It's a draw.");
  });
});

describe("where the band sits", () => {
  it("is a centred portrait column on a computer: two 9:16 halves side by side under the bar", () => {
    const r = columnBand(940, 529, { top: 12, bottom: 12 });
    expect(r.bandTop).toBe(12 + BAR_H);
    expect(r.bandH).toBe(529 - 12 - BAR_H - 12);
    // Each half is 9:16.
    expect(r.bandW / 2 / r.bandH).toBeCloseTo(9 / 16, 2);
    expect(r.bandLeft).toBe(Math.round((940 - r.bandW) / 2));
  });

  it("never runs wider than the frame", () => {
    const r = columnBand(300, 900);
    expect(r.bandW).toBe(300);
    expect(r.bandLeft).toBe(0);
    expect(r.bandH).toBe(Math.round((300 * 16) / 18));
  });

  it("is full width on an upright phone, each half 9:16 until it would pass 45% of the screen", () => {
    expect(portraitBand(390, 844, 110)).toMatchObject({ bandW: 390, bandH: Math.round(195 * (16 / 9)), bandTop: 110 + BAR_H });
    expect(portraitBand(500, 700, 100).bandH).toBe(Math.round(700 * 0.45));
  });
});
