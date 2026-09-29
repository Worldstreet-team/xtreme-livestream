import { describe, expect, it } from "vitest";
import { clashStep, feedStillRunning, isBehind, keepAhead, mergeMine, readBattlePacket, type ClashFeedState } from "@/lib/battle-feed";
import { readServerEvent } from "@/lib/room-events";
import type { BattleGift, BattleView } from "@/lib/battles";

/**
 * The web's half of battles pushed over the room (lib/battle-feed.ts,
 * lib/room-events.ts): only server-sent packets count, a counted gift in
 * the `battle` packet is a hit with its art and sender, polls and pushes
 * that cross never step backwards, and the studio's battle panel folds
 * each pushed battle into its list.
 */

const ME = "a".repeat(24);
const THEM = "b".repeat(24);

function view(fields: Partial<BattleView> & { hostUsd?: number; challengerUsd?: number } = {}): BattleView {
  const { hostUsd = 0, challengerUsd = 0, ...rest } = fields;
  const side = (userId: string, usdMinor: number) => ({ userId, username: userId.slice(0, 3), displayName: userId.slice(0, 3), avatar: "", streamId: `s-${userId}`, usdMinor });
  return {
    id: "battle-1",
    status: "live",
    scheduledAt: null,
    startsAt: new Date(0).toISOString(),
    endsAt: new Date(300_000).toISOString(),
    durationSec: 300,
    multiplierWindowSec: 30,
    multiplier: 2,
    host: side(ME, hostUsd),
    challenger: side(THEM, challengerUsd),
    winnerId: null,
    bonusUsdMinor: 0,
    overtimeUsed: false,
    endedReason: null,
    ...rest,
  };
}

function gift(id: string, side: "host" | "challenger", usdMinor: number, at = "2026-09-29T12:00:00.000Z"): BattleGift {
  return { id, side, usdMinor, giftName: "Crown", emoji: "👑", sender: { userId: "fan", displayName: "Ada" }, at };
}

const encode = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
let n = 0;
const key = () => `d${++n}`;

describe("room data trust", () => {
  it("takes a server-sent event (no participant)", () => {
    expect(readServerEvent(encode({ __evt: "battle", battle: view() }))).toMatchObject({ __evt: "battle" });
  });
  it("ignores anything a participant sent, whatever it claims to be", () => {
    expect(readServerEvent(encode({ __evt: "battle", battle: view() }), { identity: "someone" })).toBeNull();
  });
  it("ignores binary packets and JSON without an event", () => {
    expect(readServerEvent(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(readServerEvent(encode({ type: "chat" }))).toBeNull();
    expect(readServerEvent(encode([1, 2]))).toBeNull();
  });
});

describe("the battle packet", () => {
  it("reads the view and the gift riding with it", () => {
    const g = gift("g1", "host", 500);
    const packet = readBattlePacket({ __evt: "battle", battle: view({ hostUsd: 500 }), gift: g });
    expect(packet?.battle.host.usdMinor).toBe(500);
    expect(packet?.gift).toEqual(g);
  });
  it("keeps the view when the gift is malformed, and has no gift when there's none", () => {
    expect(readBattlePacket({ __evt: "battle", battle: view(), gift: { id: "x", side: "middle" } })).toMatchObject({ gift: null });
    expect(readBattlePacket({ __evt: "battle", battle: view() })).toMatchObject({ gift: null });
  });
  it("refuses anything that isn't a battle packet", () => {
    expect(readBattlePacket({ __evt: "game", battle: view() })).toBeNull();
    expect(readBattlePacket({ __evt: "battle", battle: { id: "x" } })).toBeNull();
  });
});

describe("the clash feed's step", () => {
  const start = (): ClashFeedState => ({ prev: view(), seen: new Set() });

  it("makes a pushed gift a hit with its art and sender, and nothing more", () => {
    const { hits, state } = clashStep(start(), view({ challengerUsd: 1_000 }), [gift("g1", "challenger", 1_000)], { key });
    expect(hits).toEqual([{ key: "gg1", side: "challenger", usdMinor: 1_000, gift: { name: "Crown", emoji: "👑", sender: "Ada" } }]);
    expect(state.prev.challenger.usdMinor).toBe(1_000);
  });

  it("turns score the gifts don't explain into one plain hit per side", () => {
    const { hits } = clashStep(start(), view({ hostUsd: 700, challengerUsd: 300 }), [gift("g1", "host", 500)], { key });
    expect(hits.map((h) => [h.side, h.usdMinor, Boolean(h.gift)])).toEqual([
      ["host", 500, true],
      ["host", 200, false],
      ["challenger", 300, false],
    ]);
  });

  it("never shows the same gift twice when a poll brings back what a push already said", () => {
    const first = clashStep(start(), view({ hostUsd: 500 }), [gift("g1", "host", 500)], { key });
    const again = clashStep(first.state, view({ hostUsd: 500 }), [gift("g1", "host", 500)], { key });
    expect(again.hits).toEqual([]);
  });

  it("lists the first look's gifts as history instead of replaying them", () => {
    const { hits, fresh } = clashStep(
      start(),
      view({ hostUsd: 300 }),
      [gift("g2", "host", 200, "2026-09-29T12:00:02.000Z"), gift("g1", "host", 100, "2026-09-29T12:00:01.000Z")],
      { history: true, key },
    );
    expect(fresh.map((g) => g.id)).toEqual(["g1", "g2"]);
    // The score moved since the card was drawn: one plain hit, no replayed gifts.
    expect(hits).toEqual([{ key: expect.any(String), side: "host", usdMinor: 300 }]);
  });

  it("a poll answered before a push landed moves nothing backwards", () => {
    const pushed = clashStep(start(), view({ hostUsd: 900 }), [gift("g1", "host", 900)], { key });
    const stale = clashStep(pushed.state, view({ hostUsd: 400 }), [], { key });
    expect(stale.hits).toEqual([]);
    expect(stale.state.prev.host.usdMinor).toBe(900);
    // …and the next push counts from 900, not 400.
    const next = clashStep(stale.state, view({ hostUsd: 1_000 }), [gift("g3", "host", 100)], { key });
    expect(next.hits.map((h) => h.usdMinor)).toEqual([100]);
  });
});

describe("which view is behind", () => {
  it("an earlier status or a lower score on either side is behind; another battle never is", () => {
    expect(isBehind(view({ status: "ended" }), view({ status: "live" }))).toBe(true);
    expect(isBehind(view({ hostUsd: 5 }), view({ hostUsd: 4 }))).toBe(true);
    expect(isBehind(view({ hostUsd: 5 }), view({ hostUsd: 5, lapEndsAt: "x" }))).toBe(false);
    expect(isBehind(view({ hostUsd: 5 }), view({ id: "battle-2" }))).toBe(false);
    expect(isBehind(null, view())).toBe(false);
  });
  it("a settled battle's feed is done; a booked or invited one isn't", () => {
    expect(feedStillRunning(view({ status: "ended" }))).toBe(false);
    expect(feedStillRunning(view({ status: "invited" }))).toBe(true);
  });
});

describe("the studio battle panel's list", () => {
  it("adds a new invite of mine, first", () => {
    const old = view({ id: "old", status: "scheduled" });
    expect(mergeMine([old], view({ status: "invited" }), ME).map((b) => b.id)).toEqual(["battle-1", "old"]);
  });
  it("replaces a battle in place as it moves on, and drops it when it's over", () => {
    const list = [view({ status: "invited" })];
    const accepted = mergeMine(list, view({ status: "live" }), ME);
    expect(accepted.map((b) => b.status)).toEqual(["live"]);
    expect(mergeMine(accepted, view({ status: "cancelled", endedReason: "declined" }), ME)).toEqual([]);
    expect(mergeMine(accepted, view({ status: "ended" }), ME)).toEqual([]);
  });
  it("ignores someone else's battle and a view behind the one held", () => {
    const list = [view({ hostUsd: 500 })];
    const theirs = { ...view({ id: "x" }), host: { ...view().host, userId: "z".repeat(24) }, challenger: { ...view().challenger, userId: "y".repeat(24) } };
    expect(mergeMine(list, theirs, ME)).toBe(list);
    expect(mergeMine(list, view({ hostUsd: 100 }), ME)).toBe(list);
    expect(mergeMine(list, view(), null)).toBe(list);
  });
  it("a look that crossed pushes keeps what the pushes said", () => {
    const held = [view({ hostUsd: 900 })];
    const fresh = [view({ hostUsd: 400 }), view({ id: "lapsed", status: "invited" }), view({ id: "new", status: "invited" })];
    const out = keepAhead(held, fresh, new Set(["lapsed"]));
    expect(out.map((b) => [b.id, b.host.usdMinor])).toEqual([
      ["battle-1", 900],
      ["new", 0],
    ]);
  });
});
