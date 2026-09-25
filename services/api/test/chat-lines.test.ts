import { describe, expect, it } from "vitest";
import { foldLines, type ChatMsg } from "../../../components/app/chat/lines";

/**
 * Chat's folding: a run of the same gift is one line (×N) that remembers
 * every gift in it — the big-gift tier puts the newest one on screen, and
 * the host's chat has to mark the line it came from.
 */

const gift = (id: string, username = "tolu"): ChatMsg => ({
  id,
  username,
  avatar: "",
  content: "sent a Diamond",
  type: "tip",
  tipAmount: "20.00",
  tipCurrency: "USD",
  emoji: "💎",
  at: 0,
});

describe("gift combos", () => {
  it("fold into one line that knows every gift in the run", () => {
    const lines = foldLines([gift("g1"), gift("g2"), gift("g3"), gift("g4", "ada")]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "gift", id: "g1", count: 3, total: 6000, ids: ["g1", "g2", "g3"] });
    expect(lines[1]).toMatchObject({ kind: "gift", id: "g4", count: 1, ids: ["g4"] });
  });
});
