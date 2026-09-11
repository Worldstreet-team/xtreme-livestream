import { describe, expect, it, vi } from "vitest";

/**
 * Page assembly for the rows engine. The rules under test: a stream appears
 * in at most one row, rows below their minimum are dropped, a row that
 * would repeat the previous row's dominant category is pushed down once
 * (unless it's personal), and the leads are distinct items with honest
 * reasons.
 */

vi.mock("../src/models.js", () => ({
  Follow: {},
  Stream: {},
  StreamReminder: {},
  User: {},
  WatchSession: {},
}));
vi.mock("../src/stream-service.js", () => ({
  thumbnailUrlFor: () => null,
}));

import {
  assembleRows,
  pickLeads,
  type Candidate,
  type RowItem,
} from "../src/discovery.js";

let seq = 0;
function item(category: string, viewers = 100): RowItem {
  seq += 1;
  return {
    _id: `s${seq}`,
    title: `Stream ${seq}`,
    category,
    tags: [],
    thumbnailUrl: null,
    isLive: true,
    status: "live",
    viewers,
    peakViewers: viewers,
    velocity: 0,
    startedAt: new Date(),
    scheduledStartAt: null,
    duration: "",
    streamerId: {
      _id: `u${seq}`,
      username: `user${seq}`,
      displayName: `User ${seq}`,
      avatar: "",
      isLive: true,
    },
  };
}
const row = (id: string, items: RowItem[], extra: Partial<Candidate> = {}): Candidate => ({
  row: { id, title: id, kind: "streams" },
  items,
  ...extra,
});

describe("assembleRows", () => {
  it("shows a stream in only the first row that claims it", () => {
    const shared = item("Crypto Markets");
    const rows = assembleRows([
      row("followed-live", [shared, item("Video Games"), item("Music")], { personal: true }),
      row("popular", [shared, item("Football"), item("Art"), item("Cooking")], { personal: true }),
    ]);

    expect(rows.map((r) => r.id)).toEqual(["followed-live", "popular"]);
    expect(rows[1].items.map((i) => i._id)).not.toContain(shared._id);
    expect(rows[1].items).toHaveLength(3);
  });

  it("drops a row that falls below its minimum after dedupe", () => {
    const a = item("A");
    const b = item("B");
    const rows = assembleRows([
      row("first", [a, b, item("C")], { personal: true }),
      // Only one unique item left — not a row.
      row("second", [a, b, item("D")]),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["first"]);
  });

  it("honours a lower minimum for rows that are worth showing with one item", () => {
    const rows = assembleRows([
      row("upcoming", [item("X")], { minItems: 1 }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it("pushes down a row that repeats the previous row's category, once", () => {
    const rows = assembleRows([
      row("trending", [item("Crypto"), item("Crypto"), item("Crypto")]),
      row("crypto-again", [item("Crypto"), item("Crypto"), item("Crypto")]),
      row("games", [item("Games"), item("Games"), item("Games")]),
    ]);
    // Games slots in between the two crypto rows instead of leaving them adjacent.
    expect(rows.map((r) => r.id)).toEqual(["trending", "games", "crypto-again"]);
  });

  it("never demotes a personal row for repeating a category", () => {
    const rows = assembleRows([
      row("trending", [item("Crypto"), item("Crypto"), item("Crypto")]),
      row("because-you-watch", [item("Crypto"), item("Crypto"), item("Crypto")], { personal: true }),
      row("games", [item("Games"), item("Games"), item("Games")]),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["trending", "because-you-watch", "games"]);
  });

  it("still runs a repeating row when nothing else is left", () => {
    const rows = assembleRows([
      row("trending", [item("Crypto"), item("Crypto"), item("Crypto")]),
      row("more-crypto", [item("Crypto"), item("Crypto"), item("Crypto")]),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["trending", "more-crypto"]);
  });
});

describe("pickLeads", () => {
  it("takes one distinct item each from followed, trending and rising", () => {
    const f = item("A");
    const t = item("B");
    const r = item("C");
    const leads = pickLeads([
      { id: "followed-live", title: "", kind: "streams", items: [f] },
      { id: "trending", title: "", kind: "streams", items: [t] },
      { id: "rising", title: "", kind: "streams", items: [r] },
      { id: "popular", title: "", kind: "streams", items: [item("D")] },
    ]);
    expect(leads.map((l) => l.reason)).toEqual(["followed", "trending", "rising"]);
    expect(new Set(leads.map((l) => l.item._id)).size).toBe(3);
  });

  it("falls back to popular for a signed-out page", () => {
    const leads = pickLeads([
      { id: "trending", title: "", kind: "streams", items: [item("A")] },
      { id: "popular", title: "", kind: "streams", items: [item("B"), item("C")] },
    ]);
    expect(leads.map((l) => l.reason)).toEqual(["trending", "popular"]);
  });
});
