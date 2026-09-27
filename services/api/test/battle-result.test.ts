import { describe, expect, it } from "vitest";
// The web app has no test runner of its own; the battle result card's pure
// helpers are exercised from here (the repo's only vitest) via a relative
// import. No API code involved — it's the arithmetic the card and its PNG
// are drawn from.
import type { BattleSide, BattleView } from "../../../lib/battles";
import {
  PAIR_LEAD,
  PAIR_PARTNER,
  backersOf,
  discColors,
  clipName,
  ellipsize,
  fitLines,
  fitLinesKeepingEnd,
  fitText,
  formatResultDate,
  formatScore,
  formatScorePair,
  initialsOf,
  nameLines,
  resultFileName,
  resultOf,
  shortTeamName,
  sideFaces,
  winnerSide,
  wrapLines,
} from "../../../lib/battle-result";

/** A monospace stand-in for a real face: every letter is 0.6em wide. */
const measure = (text: string, size: number) => Array.from(text).length * size * 0.6;
/** The same at a fixed 10px a letter, for wrapping. */
const tenPx = (text: string) => Array.from(text).length * 10;

function side(name: string, over: Partial<BattleSide> = {}): BattleSide {
  const username = name.toLowerCase().replace(/\s+/g, "_");
  return { userId: `u-${username}`, username, displayName: name, avatar: "", streamId: `s-${username}`, usdMinor: 0, top: [], partner: null, ...over };
}

function battle(over: Partial<BattleView> = {}): BattleView {
  return {
    id: "b1",
    status: "ended",
    scheduledAt: null,
    startsAt: "2026-09-27T11:55:00.000Z",
    endsAt: "2026-09-27T12:00:00.000Z",
    durationSec: 300,
    multiplierWindowSec: 30,
    multiplier: 2,
    host: side("Ada K", { usdMinor: 123_400 }),
    challenger: side("Tolu", { usdMinor: 98_700 }),
    winnerId: "u-ada_k",
    bonusUsdMinor: 1_500,
    overtimeUsed: false,
    lateResetUsed: false,
    forfeit: "",
    mode: "1v1",
    endedReason: "clock",
    ...over,
  };
}

describe("scores", () => {
  it("keeps cents only while they matter", () => {
    expect(formatScore(30)).toBe("$0.30");
    expect(formatScore(1_250)).toBe("$12.50");
    expect(formatScore(1_500)).toBe("$15");
    expect(formatScore(0)).toBe("$0");
  });

  it("writes whole, grouped dollars from $100, and short from a million", () => {
    expect(formatScore(45_400)).toBe("$454");
    expect(formatScore(123_456)).toBe("$1,235");
    expect(formatScore(12_345_600)).toBe("$123,456");
    expect(formatScore(125_000_000)).toBe("$1.25M");
    expect(formatScore(1_230_000_000)).toBe("$12.3M");
    expect(formatScore(45_600_000_000)).toBe("$456M");
  });

  it("never writes a nonsense score", () => {
    expect(formatScore(-500)).toBe("$0");
    expect(formatScore(Number.NaN)).toBe("$0");
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe("$0");
  });

  it("writes a pair finer when rounding would make a win look like a tie", () => {
    expect(formatScorePair(45_400, 30_800)).toEqual({ host: "$454", challenger: "$308" });
    // $1,234,500 and $1,230,000 are both "$1.23M" — so neither is written short.
    expect(formatScorePair(123_450_000, 123_000_000)).toEqual({ host: "$1,234,500", challenger: "$1,230,000" });
    // $1,234.40 and $1,234.10 are both "$1,234" — so both keep their cents.
    expect(formatScorePair(123_440, 123_410)).toEqual({ host: "$1,234.40", challenger: "$1,234.10" });
    // A real tie stays as short as it can.
    expect(formatScorePair(250_000_000, 250_000_000)).toEqual({ host: "$2.5M", challenger: "$2.5M" });
  });

  it("never shows two different scores as the same, and never flips who's ahead", () => {
    const value = (s: string) => {
      const n = Number(s.replace(/[$,M]/g, ""));
      return s.endsWith("M") ? n * 1_000_000 : n;
    };
    let seed = 7;
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 2_000; i++) {
      const a = Math.floor(next() * 10 ** (2 + Math.floor(next() * 8)));
      const b = next() < 0.3 ? a + Math.floor(next() * 3) : Math.floor(next() * 10 ** (2 + Math.floor(next() * 8)));
      const pair = formatScorePair(a, b);
      if (a !== b) expect(pair.host).not.toBe(pair.challenger);
      if (a > b) expect(value(pair.host)).toBeGreaterThan(value(pair.challenger));
    }
  });
});

describe("faces", () => {
  it("picks two initials the way the app's avatars do", () => {
    expect(initialsOf("Ada K")).toBe("AK");
    expect(initialsOf("amara obi")).toBe("AO");
    expect(initialsOf("suya_sam")).toBe("SS");
    expect(initialsOf("Kemi")).toBe("KE");
  });

  it("never makes half an initial out of an emoji or a symbol", () => {
    expect(initialsOf("Lanre 😂")).toBe("LA");
    expect(initialsOf("@tolu")).toBe("TO");
    expect(initialsOf("😂🔥")).toBe("?");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("Émeka Ọba")).toBe("ÉỌ");
  });

  it("gives a face with no photo the fill UserAvatar would", () => {
    // UserAvatar's own pick (components/ui/user-avatar.tsx), copied: the same hash, five fills.
    const avatarIndex = (name: string) => {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      return Math.abs(hash) % 5;
    };
    const fills = ["#261e1f", "#30272a", "#3a2c2d", "rgba(227, 18, 42, 0.25)", "rgba(248, 88, 16, 0.2)"];
    for (const name of ["Ada K", "Tolu", "Kemi", "Amara Obi", "Suya Sam", "a very long display name indeed"]) {
      expect(discColors(name).fill).toBe(fills[avatarIndex(name)]);
      expect(discColors(name)).toEqual(discColors(name));
    }
  });

  it("puts a 1v1 side's face where it's asked", () => {
    expect(sideFaces(side("Ada K"), "left", 300, 500, 100)).toEqual([{ role: "lead", name: "Ada K", avatar: "", cx: 300, cy: 500, r: 100 }]);
  });

  it("draws a pair with the streamer outside and the partner tucked in lower, overlapping", () => {
    const pair = side("Ada K", { partner: { userId: "u-kemi", username: "kemi", displayName: "Kemi", avatar: "k.jpg" } });
    const [partner, lead] = sideFaces(pair, "left", 300, 500, 100);
    expect(lead).toMatchObject({ role: "lead", name: "Ada K", r: Math.round(100 * PAIR_LEAD) });
    expect(partner).toMatchObject({ role: "partner", name: "Kemi", avatar: "k.jpg", r: Math.round(100 * PAIR_PARTNER) });
    // The host's pair: streamer on the left (the outside), partner toward the middle.
    expect(lead.cx).toBeLessThan(partner.cx);
    // Lower, and overlapping.
    expect(partner.cy).toBeGreaterThan(lead.cy);
    expect(partner.cx - lead.cx).toBeLessThan(lead.r + partner.r);
    // Both sit on a lone face's bottom edge, and the pair is centred where a lone face would be.
    expect(lead.cy + lead.r).toBe(600);
    expect(partner.cy + partner.r).toBe(600);
    expect((lead.cx - lead.r + partner.cx + partner.r) / 2).toBeCloseTo(300, 5);
  });

  it("mirrors the challenger's pair, so the pairs face each other", () => {
    const withPartner = (name: string, partner: string) =>
      side(name, { partner: { userId: `u-${partner}`, username: partner, displayName: partner, avatar: "" } });
    const left = sideFaces(withPartner("Ada K", "Kemi"), "left", 306, 520, 110);
    const right = sideFaces(withPartner("Tolu", "Amara Obi"), "right", 1080 - 306, 520, 110);
    left.forEach((face, i) => {
      expect(right[i].role).toBe(face.role);
      expect(right[i].cx).toBeCloseTo(1080 - face.cx, 5);
      expect(right[i].cy).toBe(face.cy);
      expect(right[i].r).toBe(face.r);
    });
  });

  it("gives a pair a second line for the partner", () => {
    expect(nameLines(side("Ada K"))).toEqual(["Ada K"]);
    expect(nameLines(side("Ada K", { partner: { userId: "u", username: "kemi", displayName: "Kemi", avatar: "" } }))).toEqual(["Ada K", "& Kemi"]);
  });

  it("lists three backers at most, and none when there were none", () => {
    const b = (n: number) => ({ userId: `u${n}`, username: `b${n}`, displayName: `Backer ${n}`, avatar: "", usdMinor: 100 * n });
    expect(backersOf(side("Ada K", { top: [b(4), b(3), b(2), b(1)] }))).toHaveLength(3);
    expect(backersOf(side("Ada K", { top: undefined }))).toEqual([]);
  });
});

describe("fitting long names", () => {
  it("keeps a short name at full size", () => {
    expect(fitText("Tolu", 400, measure, { max: 44, min: 28 })).toEqual({ text: "Tolu", size: 44, cut: false });
  });

  it("shrinks a longer name until it fits", () => {
    const fit = fitText("Amara Obi Nwachukwu", 400, measure, { max: 44, min: 28 });
    expect(fit.cut).toBe(false);
    expect(fit.text).toBe("Amara Obi Nwachukwu");
    expect(fit.size).toBeLessThan(44);
    expect(fit.size).toBeGreaterThanOrEqual(28);
    expect(measure(fit.text, fit.size)).toBeLessThanOrEqual(400);
    // The biggest that fits: one size up would not.
    expect(measure(fit.text, fit.size + 1)).toBeGreaterThan(400);
  });

  it("cuts a very long name at the smallest size, with an ellipsis, on a word", () => {
    const long = "Suya Sam & The Midnight Grill Collective of Lagos Island";
    const fit = fitText(long, 400, measure, { max: 44, min: 28 });
    expect(fit.cut).toBe(true);
    expect(fit.size).toBe(28);
    expect(fit.text.endsWith("…")).toBe(true);
    expect(measure(fit.text, 28)).toBeLessThanOrEqual(400);
    expect(fit.text).not.toMatch(/[\s&]…$/);
  });

  it("never splits an emoji or an accented letter with the ellipsis", () => {
    const cut = ellipsize("Lanre 😂😂😂😂😂😂", 80, tenPx);
    expect(tenPx(cut)).toBeLessThanOrEqual(80);
    expect(cut).not.toMatch(/[\uD800-\uDBFF]…$/);
    expect(ellipsize("Tolu", 80, tenPx)).toBe("Tolu");
    expect(ellipsize("Kemi", 5, tenPx)).toBe("…");
  });

  it("wraps two lines balanced, not with a word left dangling", () => {
    const { lines, cut } = wrapLines("Ada Kowalczyk & Tolu win", 170, tenPx, 2);
    expect(cut).toBe(false);
    // Greedy would give "Ada Kowalczyk & Tolu" / "win".
    expect(lines).toEqual(["Ada Kowalczyk", "& Tolu win"]);
  });

  it("breaks a word too long for any line, and ends what won't fit with an ellipsis", () => {
    const { lines, cut } = wrapLines("Supercalifragilistic sings the loser's song on the victory lap", 100, tenPx, 2);
    expect(cut).toBe(true);
    expect(lines).toHaveLength(2);
    lines.forEach((l) => expect(tenPx(l)).toBeLessThanOrEqual(100));
    expect(lines[0]).toBe("Supercalif");
    expect(lines[1].endsWith("…")).toBe(true);
  });

  it("keeps the verb when a winner's name has to be cut", () => {
    const fit = { max: 110, min: 60, maxLines: 2, oneLineMin: 80, wrapMax: 80 };
    const cut = fitLinesKeepingEnd("Oluwaseun Adebayo-Williams the Third of Lekki Phase One", " wins", 500, measure, fit);
    expect(cut.cut).toBe(true);
    expect(cut.size).toBe(60);
    expect(cut.lines.at(-1)?.endsWith("… wins")).toBe(true);
    cut.lines.forEach((l) => expect(measure(l, 60)).toBeLessThanOrEqual(500));
    // A name that fits is left alone, and wraps no bigger than wrapMax.
    const whole = fitLinesKeepingEnd("Ada Kowalczyk & Tolu", " win", 900, measure, fit);
    expect(whole.cut).toBe(false);
    expect(whole.lines.join(" ")).toBe("Ada Kowalczyk & Tolu win");
    expect(whole.size).toBeLessThanOrEqual(80);
  });

  it("clips a long name at a word, never on a 'the'", () => {
    expect(clipName("Tolu", 36)).toBe("Tolu");
    expect(clipName("Oluwaseun Adebayo-Williams the Third of Lekki Phase One", 36)).toBe("Oluwaseun Adebayo-Williams…");
    expect(clipName("Chiamaka the Unstoppable", 18)).toBe("Chiamaka…");
    expect(clipName("Kemi Adeyemi of the Lagos Crew", 22)).toBe("Kemi Adeyemi…");
    // One long word is cut inside it.
    expect(clipName("Supercalifragilisticexpialidocious", 12)).toBe("Supercalifr…");
    expect(Array.from(clipName("😂".repeat(40), 10))).toHaveLength(10);
    expect(shortTeamName(side("Ada K", { partner: { userId: "p", username: "c", displayName: "Chiamaka the Unstoppable", avatar: "" } }))).toBe("Ada K & Chiamaka…");
  });

  it("sets a headline on one line while it can, then on two at the biggest size that fits", () => {
    expect(fitLines("Ada K wins", 900, measure, { max: 110, min: 60, maxLines: 2, oneLineMin: 80 })).toEqual({ lines: ["Ada K wins"], size: 110, cut: false });
    const two = fitLines("Ada Kowalczyk & Tolu Babatunde win", 900, measure, { max: 110, min: 60, maxLines: 2, oneLineMin: 80 });
    expect(two.cut).toBe(false);
    expect(two.lines).toHaveLength(2);
    two.lines.forEach((l) => expect(measure(l, two.size)).toBeLessThanOrEqual(900));
    const cramped = fitLines("x".repeat(400), 900, measure, { max: 110, min: 60, maxLines: 2 });
    expect(cramped.size).toBe(60);
    expect(cramped.cut).toBe(true);
  });
});

describe("the result", () => {
  it("names the winner, the scores and the victory lap", () => {
    const r = resultOf(battle({ forfeit: "sings the loser's song", challenger: side("Tolu", { usdMinor: 98_700 }) }), { locale: "en-GB", timeZone: "UTC" });
    expect(r.winner).toBe("host");
    expect(r.headline).toBe("Ada K wins");
    expect(r.subline).toBeNull();
    expect(r.victoryLap).toBe("Victory lap · Tolu sings the loser's song");
    expect(r.scores).toEqual({ host: "$1,234", challenger: "$987" });
    expect(r.hostShare).toBeCloseTo(123_400 / (123_400 + 98_700), 6);
    // en-GB writes September "Sep" or "Sept", depending on the ICU data.
    expect(r.date).toMatch(/^27 Sept? 2026$/);
    expect(r.shareText).toBe("Ada K beat Tolu $1,234 to $987 in a battle on Xtream");
    expect(r.fileName).toBe("xtream-battle-ada-k-vs-tolu-2026-09-27.png");
    expect(r.pair).toBe(false);
  });

  it("calls a draw a draw — no winner, no victory lap, and says it went to overtime", () => {
    const r = resultOf(
      battle({ winnerId: null, overtimeUsed: true, forfeit: "sings", host: side("Ada K", { usdMinor: 50_000 }), challenger: side("Tolu", { usdMinor: 50_000 }) }),
      { locale: "en-GB", timeZone: "UTC" },
    );
    expect(r.winner).toBeNull();
    expect(r.headline).toBe("It's a draw");
    expect(r.subline).toBe("Still level after overtime");
    expect(r.victoryLap).toBeNull();
    expect(r.hostShare).toBe(0.5);
    expect(r.shareText).toBe("Ada K vs Tolu: a draw at $500 each, on Xtream");
  });

  it("gives a 2v2's win to the pair, and the victory lap to the pair that lost", () => {
    const partner = (name: string) => ({ userId: `u-${name}`, username: name.toLowerCase(), displayName: name, avatar: "" });
    const r = resultOf(
      battle({
        mode: "2v2",
        winnerId: "u-tolu",
        overtimeUsed: true,
        forfeit: "dance to the winners' song",
        host: side("Ada K", { usdMinor: 40_000, partner: partner("Kemi") }),
        challenger: side("Tolu", { usdMinor: 41_000, partner: partner("Amara Obi") }),
      }),
    );
    expect(r.winner).toBe("challenger");
    expect(r.headline).toBe("Tolu & Amara Obi win");
    expect(r.subline).toBe("Won in overtime");
    expect(r.victoryLap).toBe("Victory lap · Ada K & Kemi dance to the winners' song");
    expect(r.pair).toBe(true);
    expect(r.shareText).toBe("Tolu & Amara Obi beat Ada K & Kemi $410 to $400 in a battle on Xtream");
  });

  it("falls back to the scores for a winner the view can't place", () => {
    expect(winnerSide(battle({ winnerId: "someone-else", host: side("Ada K", { usdMinor: 10 }), challenger: side("Tolu", { usdMinor: 20 }) }))).toBe("challenger");
    expect(winnerSide(battle({ winnerId: null }))).toBeNull();
  });

  it("dates the card by when the battle ended", () => {
    expect(formatResultDate("2026-09-27T23:30:00.000Z", { locale: "en-US", timeZone: "UTC" })).toBe("Sep 27, 2026");
    // Late on the 27th in UTC is already the 28th in Lagos.
    expect(formatResultDate("2026-09-27T23:30:00.000Z", { locale: "en-US", timeZone: "Africa/Lagos" })).toBe("Sep 28, 2026");
    expect(formatResultDate("2026-09-27T12:00:00.000Z", { locale: "en-GB", timeZone: "UTC" })).toMatch(/^27 Sept? 2026$/);
  });

  it("names the file from the handles, safely", () => {
    const b = battle({ host: side("Ada K", { username: "Émeka.Ọba" }), challenger: side("Suya 😂", { username: "" }), endsAt: null });
    expect(resultFileName(b)).toBe("xtream-battle-emeka-oba-vs-suya.png");
    expect(resultFileName(battle({ host: side("😂", { username: "" }) }))).toBe("xtream-battle-host-vs-tolu-2026-09-27.png");
  });
});
