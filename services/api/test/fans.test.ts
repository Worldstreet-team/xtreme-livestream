import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Status that isn't pay-only: a stream's top fans score watch time and chat
 * as well as gifts, and a viewer's level with a channel fades unless they
 * keep coming back. Both are read from what's recorded — nothing to drift.
 */

const HOST = "a".repeat(24);
const STREAM = "d".repeat(24);
const LOYAL = "b".repeat(24);
const PAYER = "c".repeat(24);
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-26T12:00:00Z");

const oid = (v: string) => ({ toString: () => v, equals: (o: unknown) => String(o) === v });

const state = vi.hoisted(() => ({
  watch: [] as Array<{ userId: string; streamId: string; streamerId: string; joinedAt: number; leftAt: number | null }>,
  chat: [] as Array<{ userId: string; streamId: string; type: string; createdAt: number }>,
  gifts: [] as Array<{ senderId: string; streamId: string; streamerId: string; grossUsdMinor: number; createdAt: number }>,
  reads: 0,
}));

const DAY_MS = 86_400_000;
const dayOf = (t: number) => Math.floor(t / DAY_MS) * DAY_MS;
const inIds = (want: { $in: unknown[] } | undefined, v: string) => !want || want.$in.map(String).includes(v);

vi.mock("../src/models.js", () => ({
  WatchSession: {
    aggregate: async (pipeline: Array<Record<string, any>>) => {
      state.reads += 1;
      const m = pipeline[0]!.$match;
      const byDay = Boolean(pipeline[1]!.$group._id.d);
      const rows = state.watch.filter(
        (w) =>
          (!m.streamId || w.streamId === String(m.streamId)) &&
          (!m.streamerId || w.streamerId === String(m.streamerId)) &&
          inIds(m.userId, w.userId) &&
          (!m.joinedAt || w.joinedAt >= m.joinedAt.$gte.getTime()),
      );
      const out = new Map<string, any>();
      for (const w of rows) {
        const key = byDay ? `${w.userId}|${dayOf(w.joinedAt)}` : w.userId;
        const r = out.get(key) ?? (byDay ? { _id: { u: w.userId, d: new Date(dayOf(w.joinedAt)) }, ms: 0 } : { _id: w.userId, ms: 0 });
        r.ms += (w.leftAt ?? NOW) - w.joinedAt;
        out.set(key, r);
      }
      return [...out.values()];
    },
  },
  ChatMessage: {
    aggregate: async (pipeline: Array<Record<string, any>>) => {
      const m = pipeline[0]!.$match;
      const byDay = Boolean(pipeline[1]!.$group._id.d);
      const streams = m.streamId?.$in ? m.streamId.$in.map(String) : [String(m.streamId)];
      const rows = state.chat.filter((c) => streams.includes(c.streamId) && c.type === "text" && inIds(m.userId, c.userId));
      const out = new Map<string, any>();
      for (const c of rows) {
        const key = byDay ? `${c.userId}|${dayOf(c.createdAt)}` : c.userId;
        const r = out.get(key) ?? (byDay ? { _id: { u: c.userId, d: new Date(dayOf(c.createdAt)) }, n: 0 } : { _id: c.userId, n: 0 });
        r.n += 1;
        out.set(key, r);
      }
      return [...out.values()];
    },
  },
  GiftTransaction: {
    aggregate: async (pipeline: Array<Record<string, any>>) => {
      const m = pipeline[0]!.$match;
      const byDay = Boolean(pipeline[1]!.$group._id.d);
      const rows = state.gifts.filter(
        (g) =>
          (!m.streamId || g.streamId === String(m.streamId)) &&
          (!m.streamerId || g.streamerId === String(m.streamerId)) &&
          inIds(m.senderId, g.senderId) &&
          (!m.createdAt || g.createdAt >= m.createdAt.$gte.getTime()),
      );
      const out = new Map<string, any>();
      for (const g of rows) {
        const key = byDay ? `${g.senderId}|${dayOf(g.createdAt)}` : g.senderId;
        const r = out.get(key) ?? (byDay ? { _id: { u: g.senderId, d: new Date(dayOf(g.createdAt)) }, minor: 0 } : { _id: g.senderId, minor: 0 });
        r.minor += g.grossUsdMinor;
        out.set(key, r);
      }
      return [...out.values()];
    },
  },
  Stream: {
    find: () => ({ select: () => ({ lean: async () => [{ _id: STREAM }] }) }),
  },
  User: {
    find: (q: { _id: { $in: string[] } }) => ({
      select: () => ({
        lean: async () =>
          q._id.$in.map((id) => ({ _id: id, username: id === LOYAL ? "tolu.watch" : "big.spender", displayName: "", avatar: "" })),
      }),
    }),
  },
}));

const fans = await import("../src/fans.js");
const { chatPayload } = await import("../src/chat.js");

beforeEach(() => {
  state.watch = [];
  state.chat = [];
  state.gifts = [];
  state.reads = 0;
  fans.clearFanCache();
  fans.clearFanBoards();
});

describe("scoring", () => {
  it("counts a minute 1, a chat line 3 (the first 60), a dollar 5", () => {
    expect(fans.fanScore({ minutes: 90, chats: 10, giftsMinor: 0 })).toBe(120);
    expect(fans.fanScore({ minutes: 0, chats: 500, giftsMinor: 0 })).toBe(180);
    expect(fans.fanScore({ minutes: 0, chats: 0, giftsMinor: 2_000 })).toBe(100);
  });

  it("levels at 30·n², ten at most, and halves a day's share every two weeks", () => {
    expect([0, 29, 30, 119, 120, 270, 2_999, 3_000, 1e9].map(fans.fanLevel)).toEqual([0, 0, 1, 1, 2, 3, 9, 10, 10]);
    expect(fans.decay(0)).toBe(1);
    expect(fans.decay(14 * DAY)).toBeCloseTo(0.5);
    expect(fans.decay(28 * DAY)).toBeCloseTo(0.25);
  });

  it("gives watch-time badges at 10, 50 and 100 hours", () => {
    expect([0, 9, 10, 49, 50, 99, 100, 400].map(fans.watchBadge)).toEqual([0, 0, 10, 10, 50, 50, 100, 100]);
  });
});

describe("a stream's top fans", () => {
  it("lets a viewer who stays and talks outrank one who only paid, and leaves the host off", async () => {
    // Two hours watched and 40 lines: 120 + 120 = 240.
    state.watch.push({ userId: LOYAL, streamId: STREAM, streamerId: HOST, joinedAt: NOW - 2 * 3_600_000, leftAt: null });
    for (let i = 0; i < 40; i++) state.chat.push({ userId: LOYAL, streamId: STREAM, type: "text", createdAt: NOW - i * 1000 });
    // A $20 gift and five minutes: 100 + 5 = 105.
    state.gifts.push({ senderId: PAYER, streamId: STREAM, streamerId: HOST, grossUsdMinor: 2_000, createdAt: NOW - 60_000 });
    state.watch.push({ userId: PAYER, streamId: STREAM, streamerId: HOST, joinedAt: NOW - 5 * 60_000, leftAt: null });
    // The host's own lines don't put them on their board.
    state.chat.push({ userId: HOST, streamId: STREAM, type: "text", createdAt: NOW });

    const board = await fans.streamFans({ _id: oid(STREAM), streamerId: oid(HOST) } as never, { now: NOW });
    expect(board.map((f) => [f.username, f.score])).toEqual([
      ["tolu.watch", 240],
      ["big.spender", 105],
    ]);
    expect(board[0]).toMatchObject({ minutes: 120, chats: 40, giftsMinor: 0 });
  });

  it("works the board out once per 15 s, however many ask", async () => {
    state.watch.push({ userId: LOYAL, streamId: STREAM, streamerId: HOST, joinedAt: NOW - 3_600_000, leftAt: null });
    const stream = { _id: oid(STREAM), streamerId: oid(HOST) } as never;
    await Promise.all([fans.cachedStreamFans(stream, NOW), fans.cachedStreamFans(stream, NOW), fans.cachedStreamFans(stream, NOW)]);
    expect(state.reads).toBe(1);
  });
});

describe("fan levels", () => {
  it("fades unless they come back: the same week, two months apart", async () => {
    const week = (start: number, userId: string) => {
      for (let d = 0; d < 7; d++) {
        state.watch.push({ userId, streamId: STREAM, streamerId: HOST, joinedAt: start + d * DAY, leftAt: start + d * DAY + 60 * 60_000 });
      }
    };
    week(NOW - 7 * DAY, LOYAL); // This week: 7 × 60 minutes.
    week(NOW - 56 * DAY, PAYER); // The same hours, eight weeks ago.

    const standing = await fans.fanStatuses(oid(HOST) as never, [oid(LOYAL), oid(PAYER)] as never, NOW);
    const recent = standing.get(LOYAL)!;
    const faded = standing.get(PAYER)!;
    expect(recent.level).toBeGreaterThan(faded.level);
    // All-time hours don't fade: both have seven.
    expect(recent.hours).toBe(7);
    expect(faded.hours).toBe(7);
    expect(recent.badge).toBe(0);
  });

  it("gives the host no level on their own channel, and remembers the rest for a few minutes", async () => {
    state.watch.push({ userId: LOYAL, streamId: STREAM, streamerId: HOST, joinedAt: NOW - 11 * 3_600_000, leftAt: NOW });
    expect(await fans.fanStatus(oid(HOST) as never, HOST as never, NOW)).toBeNull();

    const first = await fans.fanStatus(oid(HOST) as never, oid(LOYAL) as never, NOW);
    expect(first).toMatchObject({ hours: 11, badge: 10 });
    const reads = state.reads;
    await fans.fanStatus(oid(HOST) as never, oid(LOYAL) as never, NOW + 60_000);
    expect(state.reads).toBe(reads);
  });
});

describe("chat carries the standing", () => {
  const line = { _id: "m1", userId: LOYAL, username: "tolu.watch", avatar: "", isMod: false, content: "hi", type: "text", tipAmount: null, tipCurrency: null, emoji: null, platform: "xstream" } as never;

  it("only when there's something to show", () => {
    expect(chatPayload(line, { level: 0, hours: 2, badge: 0 })).not.toHaveProperty("fan");
    expect(chatPayload(line, null)).not.toHaveProperty("fan");
    expect(chatPayload(line, { level: 4, hours: 12, badge: 10 })).toMatchObject({ fan: { level: 4, hours: 12, badge: 10 } });
  });
});
