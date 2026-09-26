import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignBudgetMinor, sceneBodySchema } from "@xtreme/contracts";

/**
 * Sponsorships: the card is drawn from our records, never the client's;
 * its on-screen time is banked per broadcast; a campaign pays a stream once,
 * within the creator's cap and the pool the brand prepaid; and a sponsored
 * quest counts only minutes watched while the brand's card was up, paying
 * one voucher per person.
 */

const room = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>>, payouts: [] as Array<Record<string, unknown>> }));

vi.mock("../src/models.js", async () => {
  const { FakeModel } = await import("./fake-mongo.js");
  const m = (name: string, unique: ConstructorParameters<typeof FakeModel>[1] = []) => new FakeModel(name, unique);
  return {
    Campaign: m("Campaign"),
    CampaignMember: m("CampaignMember", [{ keys: ["campaignId", "userId"] }]),
    Notification: m("Notification"),
    Sponsor: m("Sponsor"),
    SponsorRun: m("SponsorRun", [{ keys: ["streamId", "source", "sponsorId"] }]),
    Stream: m("Stream"),
    Voucher: m("Voucher", [{ keys: ["campaignId", "code"] }, { keys: ["campaignId", "userId"], when: (r) => r.userId != null }]),
    WatchSession: m("WatchSession"),
    User: m("User"),
    Payout: m("Payout"),
    AuditLog: m("AuditLog"),
  };
});

vi.mock("../src/livekit.js", () => ({
  setRoomScene: async () => {},
  sendRoomData: async (_room: string, payload: Record<string, unknown>) => void room.events.push(payload),
}));

vi.mock("../src/audit.js", () => ({ audit: async () => {} }));

vi.mock("../src/rewards.js", () => ({
  audit: async () => {},
  createPayout: async (userId: unknown, kind: string, usdMinor: number, _points: number, refId: unknown) => {
    const payout = { _id: new mongoose.Types.ObjectId(), userId, kind, usdMinor, refId, status: "pending" };
    room.payouts.push(payout);
    return payout;
  },
}));

const models = await import("../src/models.js");
const sponsors = await import("../src/sponsors.js");
type Fake = import("./fake-mongo.js").FakeModel;
const db = models as unknown as Record<string, Fake>;

const oid = () => new mongoose.Types.ObjectId();
const HOST = oid();
const VIEWER = oid();
const MIN = 60_000;
const T0 = new Date("2026-09-26T10:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

function seedCampaign(fields: Record<string, unknown> = {}) {
  return db.Campaign!.insert({
    name: "Ofada Express",
    line: "Food in 30 minutes",
    url: "https://ofadaexpress.example",
    code: "XTREAM",
    category: "everyday",
    logo: "",
    logoVersion: 0,
    brief: "",
    cleared: false,
    status: "live",
    endedReason: "",
    startsAt: null,
    endsAt: null,
    streamCategories: [],
    payPerStreamUsdMinor: 2_000,
    minMinutes: 10,
    minViewers: 0,
    maxStreamsPerCreator: 4,
    brandPaidUsdMinor: 100_000,
    marginPercent: 25,
    budgetUsdMinor: 75_000,
    spentUsdMinor: 0,
    paidStreams: 0,
    quest: null,
    createdAt: at(-60 * 24),
    ...fields,
  });
}

function seedStream(fields: Record<string, unknown> = {}) {
  return db.Stream!.insert({ streamerId: HOST, title: "Market open", category: "Bitcoin Trading", isLive: true, peakViewers: 50, livekitRoomName: "room-1", scene: { layers: [], version: 1 }, ...fields });
}

const join = (campaign: { _id: unknown }, fields: Record<string, unknown> = {}) =>
  db.CampaignMember!.insert({ campaignId: campaign._id, userId: HOST, joinedAt: at(-60), leftAt: null, paidStreams: 0, earnedUsdMinor: 0, ...fields });

const card = (source: "own" | "campaign", sponsorId: unknown) =>
  ({ kind: "sponsor", source, sponsorId: String(sponsorId), name: "", line: "", url: "", code: "", logoUrl: null, restricted: false }) as const;

beforeEach(() => {
  for (const model of Object.values(db)) model.reset();
  room.events = [];
  room.payouts = [];
});

describe("where the viewer is", () => {
  it("reads the edge's country, skipping unknown and Tor", () => {
    expect(sponsors.viewerCountry({ "cf-ipcountry": "ng" })).toBe("NG");
    expect(sponsors.viewerCountry({ "cf-ipcountry": "XX", "x-vercel-ip-country": "GH" })).toBe("GH");
    expect(sponsors.viewerCountry({ "cf-ipcountry": "T1" })).toBeNull();
    expect(sponsors.viewerCountry({})).toBeNull();
  });

  it("keeps restricted sponsors from Nigeria, falling back to a Lagos clock", () => {
    expect(sponsors.inRestrictedRegion("NG", "Europe/London")).toBe(true);
    expect(sponsors.inRestrictedRegion("GH", "Africa/Lagos")).toBe(false);
    expect(sponsors.inRestrictedRegion(null, "Africa/Lagos")).toBe(true);
    expect(sponsors.inRestrictedRegion(null, "Europe/London")).toBe(false);
  });

  it("works out the creators' pool from the prepayment and the margin", () => {
    expect(campaignBudgetMinor(100_000, 25)).toBe(75_000);
    expect(campaignBudgetMinor(99_999, 30)).toBe(69_999);
  });
});

describe("the card on the scene", () => {
  it("is drawn from the creator's own record, whatever the client sent", async () => {
    const s = db.Sponsor!.insert({ ownerId: HOST, name: "Harmattan Exchange", line: "Trade anything", url: "https://harmattan.example", code: "", category: "crypto", logo: "", logoVersion: 0 });
    const stream = seedStream();
    const forged = { ...card("own", s._id), name: "Free money", url: "https://scam.example" };
    const [layer] = await sponsors.resolveSceneLayers([forged], HOST, stream as never, T0);
    expect(layer).toMatchObject({ kind: "sponsor", source: "own", name: "Harmattan Exchange", url: "https://harmattan.example", restricted: true });
  });

  it("refuses someone else's sponsor, and a campaign the host hasn't joined", async () => {
    const theirs = db.Sponsor!.insert({ ownerId: oid(), name: "Theirs", line: "", url: "", code: "", category: "everyday", logo: "", logoVersion: 0 });
    const campaign = seedCampaign();
    const stream = seedStream();
    await expect(sponsors.resolveSceneLayers([card("own", theirs._id)], HOST, stream as never, T0)).rejects.toMatchObject({ code: "SPONSOR_NOT_FOUND" });
    await expect(sponsors.resolveSceneLayers([card("campaign", campaign._id)], HOST, stream as never, T0)).rejects.toMatchObject({ code: "NOT_JOINED" });
    join(campaign);
    const [layer] = await sponsors.resolveSceneLayers([card("campaign", campaign._id)], HOST, stream as never, T0);
    expect(layer).toMatchObject({ source: "campaign", name: "Ofada Express", code: "XTREAM", restricted: false });
  });

  it("keeps a campaign to its categories and its dates", async () => {
    const campaign = seedCampaign({ streamCategories: ["Football"] });
    join(campaign);
    const stream = seedStream();
    await expect(sponsors.resolveSceneLayers([card("campaign", campaign._id)], HOST, stream as never, T0)).rejects.toMatchObject({ code: "CAMPAIGN_WRONG_CATEGORY" });
    const later = seedCampaign({ startsAt: at(60) });
    join(later);
    await expect(sponsors.resolveSceneLayers([card("campaign", later._id)], HOST, stream as never, T0)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_LIVE" });
  });

  it("drops a card that was up and has stopped being usable, instead of blocking the host", async () => {
    const campaign = seedCampaign({ status: "paused" });
    join(campaign);
    const stream = seedStream({ scene: { layers: [card("campaign", campaign._id)], version: 3 } });
    const layers = await sponsors.resolveSceneLayers([{ kind: "banner", text: "Giveaway" }, card("campaign", campaign._id)], HOST, stream as never, T0);
    expect(layers).toEqual([{ kind: "banner", text: "Giveaway" }]);
  });

  it("is one graphic like the rest: one sponsor at a time", () => {
    const one = sceneBodySchema.safeParse({ layers: [card("own", oid())] });
    const two = sceneBodySchema.safeParse({ layers: [card("own", oid()), card("campaign", oid())] });
    expect(one.success).toBe(true);
    expect(two.success).toBe(false);
  });
});

describe("on-screen time", () => {
  it("opens when the card goes up, banks the span when it comes down, and reopens the same run", async () => {
    const s = db.Sponsor!.insert({ ownerId: HOST, name: "Harmattan Exchange", category: "everyday" });
    const stream = seedStream();
    const layer = { ...card("own", s._id), name: "Harmattan Exchange" };
    await sponsors.trackSponsorExposure(stream as never, null, layer, at(0));
    await sponsors.trackSponsorExposure(stream as never, layer, layer, at(3)); // unchanged: nothing
    await sponsors.trackSponsorExposure(stream as never, layer, null, at(5));
    await sponsors.trackSponsorExposure(stream as never, null, layer, at(20));
    await sponsors.trackSponsorExposure(stream as never, layer, null, at(22));
    expect(db.SponsorRun!.rows).toHaveLength(1);
    const run = db.SponsorRun!.rows[0]!;
    expect(run).toMatchObject({ status: "none", seconds: 7 * 60, openSince: null, name: "Harmattan Exchange" });
    expect(run.spans).toEqual([
      { from: at(0), to: at(5) },
      { from: at(20), to: at(22) },
    ]);
  });

  it("closes every span when the stream ends", async () => {
    const s = db.Sponsor!.insert({ ownerId: HOST, name: "Harmattan Exchange", category: "everyday" });
    const stream = seedStream();
    await sponsors.trackSponsorExposure(stream as never, null, card("own", s._id), at(0));
    await sponsors.closeStreamRuns(stream._id, at(12));
    expect(db.SponsorRun!.rows[0]).toMatchObject({ openSince: null, seconds: 12 * 60 });
  });
});

describe("paying for a campaign stream", () => {
  async function runFor(campaign: { _id: unknown }, stream: { _id: unknown }, from: number, to?: number) {
    await sponsors.trackSponsorExposure(stream as never, null, card("campaign", campaign._id), at(from));
    if (to !== undefined) await sponsors.trackSponsorExposure(stream as never, card("campaign", campaign._id), null, at(to));
    return db.SponsorRun!.rows.find((r) => String(r.streamId) === String(stream._id))!;
  }

  it("pays once the card has been up for the campaign's minutes, and only once", async () => {
    const campaign = seedCampaign();
    join(campaign);
    const stream = seedStream();
    const run = await runFor(campaign, stream, 0);
    await sponsors.settleRun(run as never, at(6));
    expect(run.status).toBe("counting");
    await sponsors.settleRun(run as never, at(10));
    await sponsors.settleRun(run as never, at(11));
    await sponsors.sweepSponsors(at(12));
    expect(room.payouts).toHaveLength(1);
    expect(room.payouts[0]).toMatchObject({ kind: "sponsor", usdMinor: 2_000 });
    expect(run).toMatchObject({ status: "paid", payUsdMinor: 2_000 });
    expect(campaign).toMatchObject({ spentUsdMinor: 2_000, paidStreams: 1 });
    expect(db.CampaignMember!.rows[0]).toMatchObject({ paidStreams: 1, earnedUsdMinor: 2_000 });
    expect(db.Notification!.rows[0]).toMatchObject({ type: "sponsor_paid", actorName: "Ofada Express", link: "/sponsorships" });
  });

  it("gives a short run its verdict when the stream ends", async () => {
    const campaign = seedCampaign();
    join(campaign);
    const stream = seedStream();
    const run = await runFor(campaign, stream, 0, 4);
    expect(run.status).toBe("counting");
    await sponsors.closeStreamRuns(stream._id as never, at(30));
    expect(run).toMatchObject({ status: "unpaid", unpaidReason: "short" });
    expect(room.payouts).toHaveLength(0);
  });

  it("waits on a small audience while live, and says so once it's over", async () => {
    const campaign = seedCampaign({ minViewers: 100 });
    join(campaign);
    const stream = seedStream({ peakViewers: 40 });
    const run = await runFor(campaign, stream, 0);
    await sponsors.settleRun(run as never, at(15));
    expect(run.status).toBe("counting");
    stream.isLive = false;
    await sponsors.closeStreamRuns(stream._id as never, at(20));
    expect(run).toMatchObject({ status: "unpaid", unpaidReason: "viewers" });
  });

  it("stops at the creator's cap", async () => {
    const campaign = seedCampaign({ maxStreamsPerCreator: 1 });
    join(campaign, { paidStreams: 1, earnedUsdMinor: 2_000 });
    const stream = seedStream();
    const run = await runFor(campaign, stream, 0, 12);
    expect(run).toMatchObject({ status: "unpaid", unpaidReason: "cap" });
    expect(campaign.spentUsdMinor).toBe(0);
  });

  it("never pays past the pool: the last stream it can afford ends the campaign", async () => {
    const campaign = seedCampaign({ budgetUsdMinor: 3_000 });
    join(campaign);
    const other = oid();
    db.CampaignMember!.insert({ campaignId: campaign._id, userId: other, leftAt: null, paidStreams: 0, earnedUsdMinor: 0 });
    const mine = seedStream();
    const theirs = seedStream({ streamerId: other, livekitRoomName: "room-2", scene: { layers: [card("campaign", campaign._id)], version: 2 } });
    const first = await runFor(campaign, mine, 0);
    await sponsors.trackSponsorExposure(theirs as never, null, card("campaign", campaign._id), at(0));
    await sponsors.settleRun(first as never, at(10));
    expect(first.status).toBe("paid");
    // $30 pool, $20 a stream: nothing left for a second one, so it ended and its cards came down.
    expect(campaign).toMatchObject({ status: "ended", endedReason: "budget", spentUsdMinor: 2_000 });
    // Their card came down with it, and the ten minutes it had been up are banked but can't be paid.
    const second = db.SponsorRun!.rows.find((r) => String(r.streamId) === String(theirs._id))!;
    expect(theirs.scene.layers).toEqual([]);
    expect(room.events.some((e) => e.__evt === "scene")).toBe(true);
    expect(second).toMatchObject({ openSince: null, seconds: 10 * 60, status: "unpaid", unpaidReason: "budget" });
    await sponsors.closeStreamRuns(theirs._id as never, at(30));
    expect(room.payouts).toHaveLength(1);
  });
});

describe("sponsored quests", () => {
  function questCampaign(fields: Record<string, unknown> = {}) {
    return seedCampaign({ quest: { minutes: 10, reward: "₦2,000 off" }, ...fields });
  }
  const watch = (streamId: unknown, from: number, to: number | null, userId = VIEWER) =>
    db.WatchSession!.insert({ userId, streamId, streamerId: HOST, joinedAt: at(from), leftAt: to === null ? null : at(to) });

  it("counts only minutes watched while the brand's card was up", async () => {
    const campaign = questCampaign();
    const stream = seedStream();
    const elsewhere = seedStream({ livekitRoomName: "room-9" });
    db.SponsorRun!.insert({ streamId: stream._id, hostId: HOST, source: "campaign", sponsorId: campaign._id, spans: [{ from: at(0), to: at(20) }], openSince: at(40), seconds: 1200 });
    watch(stream._id, 5, 30); // 15 min under the first span
    watch(stream._id, 10, 15); // a second tab, same minutes
    watch(stream._id, 35, 45); // 5 min under the open span
    watch(elsewhere._id, 0, 60); // no card there
    expect(await sponsors.questMinutes(campaign as never, VIEWER, at(45))).toBe(20);
  });

  it("clips to the campaign's dates", async () => {
    const campaign = questCampaign({ startsAt: at(10) });
    const stream = seedStream();
    db.SponsorRun!.insert({ streamId: stream._id, hostId: HOST, source: "campaign", sponsorId: campaign._id, spans: [{ from: at(0), to: at(20) }], openSince: null, seconds: 1200 });
    watch(stream._id, 0, 20);
    expect(await sponsors.questMinutes(campaign as never, VIEWER, at(30))).toBe(10);
  });

  it("hands out one voucher per person, once the minutes are in", async () => {
    const campaign = questCampaign();
    const stream = seedStream();
    db.SponsorRun!.insert({ streamId: stream._id, hostId: HOST, source: "campaign", sponsorId: campaign._id, spans: [{ from: at(0), to: at(30) }], openSince: null, seconds: 1800 });
    db.Voucher!.insert({ campaignId: campaign._id, code: "OFADA-1", userId: null, claimedAt: null });
    db.Voucher!.insert({ campaignId: campaign._id, code: "OFADA-2", userId: null, claimedAt: null });
    const viewer = { _id: VIEWER, createdAt: at(-60 * 24 * 30) };

    watch(stream._id, 0, 6);
    await expect(sponsors.claimVoucher(String(campaign._id), viewer, false, at(40))).rejects.toMatchObject({ code: "QUEST_NOT_DONE", message: "4 more minutes to go" });

    watch(stream._id, 6, 12);
    const first = await sponsors.claimVoucher(String(campaign._id), viewer, false, at(40));
    const again = await sponsors.claimVoucher(String(campaign._id), viewer, false, at(41));
    expect(first.code).toBe("OFADA-1");
    expect(again.code).toBe("OFADA-1");
    expect(db.Voucher!.rows.filter((v) => v.userId)).toHaveLength(1);
  });

  it("turns away brand-new accounts, empty pools and restricted regions", async () => {
    const campaign = questCampaign();
    const stream = seedStream();
    db.SponsorRun!.insert({ streamId: stream._id, hostId: HOST, source: "campaign", sponsorId: campaign._id, spans: [{ from: at(0), to: at(30) }], openSince: null, seconds: 1800 });
    watch(stream._id, 0, 30);
    await expect(sponsors.claimVoucher(String(campaign._id), { _id: VIEWER, createdAt: at(-60) }, false, at(40))).rejects.toMatchObject({ code: "ACCOUNT_TOO_NEW" });
    await expect(sponsors.claimVoucher(String(campaign._id), { _id: VIEWER, createdAt: at(-60 * 48) }, false, at(40))).rejects.toMatchObject({ code: "VOUCHERS_GONE" });

    const betting = questCampaign({ category: "betting" });
    await expect(sponsors.claimVoucher(String(betting._id), { _id: VIEWER, createdAt: at(-60 * 48) }, true, at(40))).rejects.toMatchObject({ code: "NOT_AVAILABLE_HERE" });
  });
});

describe("the sweep", () => {
  it("closes cards left open on ended streams, and ends campaigns past their date", async () => {
    const campaign = seedCampaign({ endsAt: at(30) });
    join(campaign);
    const live = seedStream({ scene: { layers: [card("campaign", campaign._id)], version: 4 } });
    const ended = seedStream({ isLive: false, endedAt: at(8), livekitRoomName: "room-2" });
    db.SponsorRun!.insert({ streamId: ended._id, hostId: HOST, source: "campaign", sponsorId: campaign._id, spans: [], openSince: at(0), seconds: 0, status: "counting", unpaidReason: "" });
    db.SponsorRun!.insert({ streamId: live._id, hostId: HOST, source: "campaign", sponsorId: campaign._id, spans: [], openSince: at(25), seconds: 0, status: "counting", unpaidReason: "" });

    await sponsors.sweepSponsors(at(31));
    const [endedRun, liveRun] = db.SponsorRun!.rows;
    expect(endedRun).toMatchObject({ openSince: null, seconds: 8 * 60, status: "unpaid", unpaidReason: "short" });
    expect(campaign).toMatchObject({ status: "ended", endedReason: "date" });
    expect(live.scene.layers).toEqual([]);
    expect(live.scene.version).toBe(5);
    expect(liveRun).toMatchObject({ openSince: null, seconds: 6 * 60 });
  });
});
