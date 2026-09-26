import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ban-evasion flags: names that read the same once look-alike digits and
 * doubled letters are set aside; only young accounts, only against bans
 * the channel made lately, never the banned account itself.
 */

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  return { Stream: new FakeModel("Stream"), StreamBan: new FakeModel("StreamBan") };
});

const models = await import("../src/models.js");
const db = models as unknown as Record<string, import("./fake-mongo.js").FakeModel>;
const { evasionOf, evasionReason, forgetBans, looksLike, nameStem } = await import("../src/safety/evasion.js");

const HOST = new mongoose.Types.ObjectId();
const NOW = Date.parse("2026-09-26T20:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("names that look alike", () => {
  it("reads look-alike digits as letters and doubled letters once", () => {
    expect(nameStem("Sp4mm3r_22")).toBe("spamer");
    expect(nameStem("xXdestroyerXx")).toBe("xdestroyerx");
  });

  it("spots the same name dressed up, and leaves different people alone", () => {
    expect(looksLike("sp4mmer_2", "spammer")).toBe(true);
    expect(looksLike("xXdestroyerXx", "destroyer")).toBe(true);
    expect(looksLike("chiomaa", "chioma")).toBe(true);
    expect(looksLike("tolu", "tolulope")).toBe(false);
    expect(looksLike("chioma", "emeka")).toBe(false);
    expect(looksLike("ada", "ada1")).toBe(false);
    // The same account isn't evading anything.
    expect(looksLike("Spammer", "spammer")).toBe(false);
  });
});

describe("a young account named like a recent ban", () => {
  beforeEach(() => {
    for (const m of Object.values(db)) m.reset();
    forgetBans(HOST);
    const recent = db.Stream!.insert({ streamerId: HOST, startedAt: new Date(NOW - 2 * DAY) });
    db.StreamBan!.insert({ streamId: recent._id, userId: new mongoose.Types.ObjectId(), username: "spammer", createdAt: new Date(NOW - 2 * HOUR) });
    const old = db.Stream!.insert({ streamerId: HOST, startedAt: new Date(NOW - 30 * DAY) });
    db.StreamBan!.insert({ streamId: old._id, userId: new mongoose.Types.ObjectId(), username: "oldtroll", createdAt: new Date(NOW - 30 * DAY) });
  });
  const user = (username: string, ageMs: number) => ({ _id: new mongoose.Types.ObjectId(), username, createdAt: new Date(NOW - ageMs) });

  it("is flagged, with a reason moderators can read", async () => {
    const signal = await evasionOf(HOST, user("sp4mmer_2", 5 * HOUR), NOW);
    expect(signal).toMatchObject({ like: "spammer" });
    expect(evasionReason(signal!, NOW)).toBe("Looks like @spammer (banned 2 h ago) · account under a day old");
  });

  it("isn't flagged once the account has some age, or for a ban long gone", async () => {
    expect(await evasionOf(HOST, user("sp4mmer_2", 10 * DAY), NOW)).toBeNull();
    expect(await evasionOf(HOST, user("0ldtroll", 3 * HOUR), NOW)).toBeNull();
    expect(await evasionOf(HOST, user("amaka", 3 * HOUR), NOW)).toBeNull();
  });
});
