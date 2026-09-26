import mongoose from "mongoose";
import {
  inRestrictedSponsorRegion,
  isRestrictedSponsorCategory,
  type CampaignView,
  type SceneLayer,
  type SponsoredQuestView,
  type SponsorRunView,
  type SponsorSource,
  type SponsorView,
} from "@xtreme/contracts";
import { audit } from "./audit.js";
import { ApiError } from "./errors.js";
import { sceneView } from "./featured.js";
import { sendRoomData, setRoomScene } from "./livekit.js";
import {
  Campaign,
  CampaignMember,
  Notification,
  Sponsor,
  SponsorRun,
  Stream,
  Voucher,
  WatchSession,
  type ICampaign,
  type ICampaignMember,
  type ISponsor,
  type ISponsorRun,
  type IStream,
} from "./models.js";
import { minutesWithin } from "./quests.js";
import { createPayout } from "./rewards.js";
import { NEW_ACCOUNT_MS } from "./safety/filter.js";

/**
 * Sponsorships (Phase 2, sponsor slots). Two tracks, one label:
 *
 * - A creator's own deal (`source: "own"`): a sponsor they add themselves.
 *   The money stays between them and the brand; we draw the card.
 * - An Xtream campaign (`source: "campaign"`): the platform's team sets it
 *   up, the brand prepays, creators opt in and are paid from the pool for
 *   each broadcast that keeps the card up for the campaign's minutes.
 *
 * Either way the card says "Paid promotion" on every screen, and what it
 * says is filled in here from our own records whenever the scene is
 * written — a client names the sponsor, never what's drawn for it.
 *
 * On-screen time is kept per broadcast and sponsor (SponsorRun): a span
 * opens when the card goes up and closes when it comes down or the stream
 * ends. Those spans pay creators, and they're what a sponsored quest counts
 * a viewer's minutes against — minutes watched while the card was up.
 */

type SponsorLayer = Extract<SceneLayer, { kind: "sponsor" }>;
type Id = mongoose.Types.ObjectId;
type Interval = [number, number];

/** An open watch session older than this is a forgotten tab (quests.ts uses the same). */
const OPEN_SESSION_CAP_MS = 6 * 3_600_000;

const logoPath = (kind: "sponsors" | "campaigns", id: unknown, logo: string, version: number) =>
  logo && version > 0 ? `/api/${kind}/${String(id)}/logo?v=${version}` : null;

/** A campaign's card is kept from restricted regions unless the team cleared it. */
export function campaignRestricted(c: Pick<ICampaign, "category" | "cleared">) {
  return isRestrictedSponsorCategory(c.category) && !c.cleared;
}

/** How many more streams the pool can pay for. */
export function streamsLeft(c: Pick<ICampaign, "budgetUsdMinor" | "spentUsdMinor" | "payPerStreamUsdMinor">) {
  if (c.payPerStreamUsdMinor <= 0) return 0;
  return Math.max(0, Math.floor((c.budgetUsdMinor - c.spentUsdMinor) / c.payPerStreamUsdMinor));
}

export function sponsorView(s: Pick<ISponsor, "_id" | "name" | "line" | "url" | "code" | "category" | "logo" | "logoVersion">): SponsorView {
  return {
    id: String(s._id),
    name: s.name,
    line: s.line ?? "",
    url: s.url ?? "",
    code: s.code ?? "",
    category: s.category as SponsorView["category"],
    logoUrl: logoPath("sponsors", s._id, s.logo, s.logoVersion ?? 0),
    restricted: isRestrictedSponsorCategory(s.category),
  };
}

export function campaignView(c: ICampaign | (Omit<ICampaign, keyof mongoose.Document> & { _id: unknown }), member?: Pick<ICampaignMember, "leftAt" | "paidStreams" | "earnedUsdMinor"> | null): CampaignView {
  return {
    id: String(c._id),
    name: c.name,
    line: c.line ?? "",
    url: c.url ?? "",
    code: c.code ?? "",
    category: c.category as CampaignView["category"],
    logoUrl: logoPath("campaigns", c._id, c.logo, c.logoVersion ?? 0),
    brief: c.brief ?? "",
    restricted: campaignRestricted(c),
    status: c.status,
    startsAt: c.startsAt ? new Date(c.startsAt).toISOString() : null,
    endsAt: c.endsAt ? new Date(c.endsAt).toISOString() : null,
    streamCategories: c.streamCategories ?? [],
    payPerStreamUsdMinor: c.payPerStreamUsdMinor,
    minMinutes: c.minMinutes,
    minViewers: c.minViewers ?? 0,
    maxStreamsPerCreator: c.maxStreamsPerCreator,
    streamsLeft: streamsLeft(c),
    quest: c.quest ? { minutes: c.quest.minutes, reward: c.quest.reward } : null,
    joined: Boolean(member && !member.leftAt),
    paidStreams: member?.paidStreams ?? 0,
    earnedUsdMinor: member?.earnedUsdMinor ?? 0,
  };
}

/* ------------------------------------------------------------------ */
/* Where the viewer is                                                 */
/* ------------------------------------------------------------------ */

const COUNTRY_HEADERS = ["cf-ipcountry", "x-vercel-ip-country", "cloudfront-viewer-country", "x-country-code"];

/** The viewer's country, as the edge in front of the API reports it — null when nothing does. */
export function viewerCountry(headers: Record<string, string | string[] | undefined>): string | null {
  for (const name of COUNTRY_HEADERS) {
    const raw = headers[name];
    const value = String(Array.isArray(raw) ? raw[0] : (raw ?? "")).trim().toUpperCase();
    // "XX" and "T1" are Cloudflare's unknown and Tor.
    if (/^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  return null;
}

/** Whether restricted sponsors stay off this viewer's screen (the rule is shared with the web). */
export const inRestrictedRegion = inRestrictedSponsorRegion;

/* ------------------------------------------------------------------ */
/* The card on the scene                                               */
/* ------------------------------------------------------------------ */

export function sponsorLayerOf(layers: ReadonlyArray<unknown> | undefined | null): SponsorLayer | null {
  const found = (layers ?? []).find((l) => Boolean(l) && typeof l === "object" && (l as { kind?: unknown }).kind === "sponsor");
  return (found as SponsorLayer | undefined) ?? null;
}

const sameSponsor = (a: Pick<SponsorLayer, "source" | "sponsorId"> | null, b: Pick<SponsorLayer, "source" | "sponsorId"> | null) =>
  Boolean(a && b && a.source === b.source && String(a.sponsorId) === String(b.sponsorId));

/**
 * A campaign this host can run on this broadcast right now: live, inside its
 * dates, open to the stream's category, and joined. Throws what to tell them.
 */
async function usableCampaign(campaignId: string, hostId: Id, stream: Pick<IStream, "category">, now: Date) {
  const c = await Campaign.findById(campaignId).lean();
  if (!c) throw new ApiError(404, "That campaign isn't running any more", "CAMPAIGN_NOT_FOUND");
  if (c.status !== "live" || (c.startsAt && new Date(c.startsAt) > now) || (c.endsAt && new Date(c.endsAt) <= now)) {
    throw new ApiError(409, `${c.name}'s campaign isn't running right now`, "CAMPAIGN_NOT_LIVE");
  }
  if (c.streamCategories.length > 0 && !c.streamCategories.includes(stream.category)) {
    throw new ApiError(409, `${c.name}'s campaign is for ${c.streamCategories.join(", ")} streams`, "CAMPAIGN_WRONG_CATEGORY");
  }
  const member = await CampaignMember.findOne({ campaignId: c._id, userId: hostId, leftAt: null }).select("_id").lean();
  if (!member) throw new ApiError(403, `Join ${c.name}'s campaign first`, "NOT_JOINED");
  return c;
}

/** The card as it's drawn, from our own records. */
export async function resolveSponsorLayer(
  layer: Pick<SponsorLayer, "source" | "sponsorId">,
  hostId: Id,
  stream: Pick<IStream, "category">,
  now = new Date(),
): Promise<SponsorLayer> {
  if (layer.source === "own") {
    const s = await Sponsor.findOne({ _id: layer.sponsorId, ownerId: hostId }).lean();
    if (!s) throw new ApiError(404, "That sponsor isn't in your list any more", "SPONSOR_NOT_FOUND");
    const v = sponsorView(s);
    return { kind: "sponsor", source: "own", sponsorId: v.id, name: v.name, line: v.line, url: v.url, code: v.code, logoUrl: v.logoUrl, restricted: v.restricted };
  }
  const c = await usableCampaign(String(layer.sponsorId), hostId, stream, now);
  const v = campaignView(c);
  return { kind: "sponsor", source: "campaign", sponsorId: v.id, name: v.name, line: v.line, url: v.url, code: v.code, logoUrl: v.logoUrl, restricted: v.restricted };
}

/**
 * The graphics as the API keeps them: a sponsor card filled in from our
 * records. A sponsor that was already up and has since stopped being
 * usable (a paused campaign, a deleted sponsor) quietly comes down rather
 * than blocking the host's other changes; putting up one that isn't usable
 * is refused with the reason.
 */
export async function resolveSceneLayers(layers: SceneLayer[], hostId: Id, stream: Pick<IStream, "category" | "scene">, now = new Date()) {
  const before = sponsorLayerOf(stream.scene?.layers);
  const out: SceneLayer[] = [];
  for (const layer of layers) {
    if (layer.kind !== "sponsor") {
      out.push(layer);
      continue;
    }
    try {
      out.push(await resolveSponsorLayer(layer, hostId, stream, now));
    } catch (error) {
      if (!sameSponsor(before, layer)) throw error;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* On-screen time                                                      */
/* ------------------------------------------------------------------ */

const isDuplicateKey = (error: unknown) => (error as { code?: number }).code === 11000;

async function openRun(stream: Pick<IStream, "_id" | "streamerId">, layer: SponsorLayer, now: Date) {
  try {
    await SponsorRun.updateOne(
      { streamId: stream._id, source: layer.source, sponsorId: layer.sponsorId, openSince: null },
      {
        $set: { openSince: now },
        $setOnInsert: { hostId: stream.streamerId, name: layer.name, status: layer.source === "campaign" ? "counting" : "none" },
      },
      { upsert: true },
    );
  } catch (error) {
    // Already open (the unique index refused a second run): nothing to do.
    if (!isDuplicateKey(error)) throw error;
  }
}

/** Bank the open span, if there is one. Resolves to the run afterwards. */
async function closeRun(streamId: Id, source: SponsorSource, sponsorId: Id | string, now: Date) {
  const run = await SponsorRun.findOne({ streamId, source, sponsorId, openSince: { $ne: null } });
  if (!run?.openSince) return null;
  const from = run.openSince;
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  const closed = await SponsorRun.findOneAndUpdate(
    // Only if nobody closed it first.
    { _id: run._id, openSince: from },
    { $set: { openSince: null }, $inc: { seconds }, $push: { spans: { $each: [{ from, to: now }], $slice: -200 } } },
    { new: true },
  );
  return closed;
}

/**
 * The card changed (or didn't): close the old sponsor's span, open the new
 * one's. A campaign run that has now been up long enough is paid.
 */
export async function trackSponsorExposure(
  stream: Pick<IStream, "_id" | "streamerId">,
  before: SponsorLayer | null,
  after: SponsorLayer | null,
  now = new Date(),
) {
  if (sameSponsor(before, after)) return;
  if (before) {
    const closed = await closeRun(stream._id, before.source, before.sponsorId, now);
    if (closed?.source === "campaign") await settleRun(closed, now).catch((e) => console.error("sponsor settle failed:", e));
  }
  if (after) await openRun(stream, after, now);
}

/** The stream is over: bank every open span and give each campaign run its verdict. */
export async function closeStreamRuns(streamId: Id, at = new Date()) {
  const open = await SponsorRun.find({ streamId, openSince: { $ne: null } }).select("source sponsorId").lean();
  for (const r of open) await closeRun(streamId, r.source, r.sponsorId, at);
  const counting = await SponsorRun.find({ streamId, source: "campaign", status: "counting" });
  for (const r of counting) await settleRun(r, at, true).catch((e) => console.error("sponsor settle failed:", e));
}

async function markUnpaid(run: ISponsorRun, reason: ISponsorRun["unpaidReason"]) {
  return SponsorRun.findOneAndUpdate(
    { _id: run._id, status: { $in: ["counting", "paying"] } },
    { $set: { status: "unpaid", unpaidReason: reason } },
    { new: true },
  );
}

/**
 * Pay a campaign run that has earned it, once. The run is claimed first
 * (counting → paying), then the creator's cap and the campaign's pool are
 * each moved with an atomic, conditional write — so neither can be
 * overdrawn by two streams qualifying at the same moment — and only then
 * is the payout made. `final` is the stream-ended verdict: a run that
 * didn't make it by then never will.
 */
export async function settleRun(run: ISponsorRun, now = new Date(), final = false): Promise<ISponsorRun | null> {
  if (run.source !== "campaign" || run.status !== "counting") return run;
  const campaign = await Campaign.findById(run.sponsorId);
  if (!campaign) return markUnpaid(run, "ended");

  const onScreen = (run.seconds ?? 0) + (run.openSince ? Math.max(0, (now.getTime() - run.openSince.getTime()) / 1000) : 0);
  if (onScreen < campaign.minMinutes * 60) return final ? markUnpaid(run, "short") : run;
  if (campaign.status !== "live") {
    if (!final && campaign.status !== "ended") return run;
    return markUnpaid(run, campaign.endedReason === "budget" ? "budget" : "ended");
  }
  const stream = await Stream.findById(run.streamId).select("peakViewers isLive title").lean();
  if ((stream?.peakViewers ?? 0) < campaign.minViewers) return final || !stream?.isLive ? markUnpaid(run, "viewers") : run;

  const claimed = await SponsorRun.findOneAndUpdate({ _id: run._id, status: "counting" }, { $set: { status: "paying" } }, { new: true });
  if (!claimed) return run;
  const pay = campaign.payPerStreamUsdMinor;

  const member = await CampaignMember.findOneAndUpdate(
    { campaignId: campaign._id, userId: run.hostId, leftAt: null, paidStreams: { $lt: campaign.maxStreamsPerCreator } },
    { $inc: { paidStreams: 1, earnedUsdMinor: pay } },
    { new: true },
  );
  if (!member) {
    const still = await CampaignMember.exists({ campaignId: campaign._id, userId: run.hostId, leftAt: null });
    return markUnpaid(claimed, still ? "cap" : "left");
  }

  const funded = await Campaign.findOneAndUpdate(
    { _id: campaign._id, status: "live", $expr: { $lte: [{ $add: ["$spentUsdMinor", pay] }, "$budgetUsdMinor"] } },
    { $inc: { spentUsdMinor: pay, paidStreams: 1 } },
    { new: true },
  );
  if (!funded) {
    await CampaignMember.updateOne({ _id: member._id }, { $inc: { paidStreams: -1, earnedUsdMinor: -pay } });
    await endIfDry(campaign._id as Id, now);
    return markUnpaid(claimed, "budget");
  }

  const payout = await createPayout(run.hostId, "sponsor", pay, 0, run._id as Id);
  claimed.status = "paid";
  claimed.payUsdMinor = pay;
  claimed.payoutId = payout._id as Id;
  await claimed.save();
  await audit(null, "sponsor.pay", "sponsor_run", run._id as Id, {
    campaignId: String(campaign._id),
    hostId: String(run.hostId),
    usdMinor: pay,
    payoutStatus: payout.status,
  });
  await Notification.create({
    userId: run.hostId,
    type: "sponsor_paid",
    actorId: run.hostId,
    actorName: campaign.name,
    streamId: run.streamId,
    streamTitle: `$${(pay / 100).toFixed(2)} for ${stream?.title ? `“${stream.title}”` : "your stream"}`,
    link: "/sponsorships",
    read: false,
  }).catch(() => {});
  if (streamsLeft(funded) < 1) await endIfDry(funded._id as Id, now);
  return claimed;
}

/** A pool that can't pay for another stream ends the campaign, and its cards come down. */
async function endIfDry(campaignId: Id, now = new Date()) {
  const c = await Campaign.findById(campaignId).select("budgetUsdMinor spentUsdMinor payPerStreamUsdMinor status").lean();
  if (!c || c.status === "ended" || streamsLeft(c) >= 1) return;
  const ended = await Campaign.updateOne({ _id: campaignId, status: { $ne: "ended" } }, { $set: { status: "ended", endedReason: "budget" } });
  if (ended.modifiedCount) {
    await audit(null, "campaign.end", "campaign", campaignId, { reason: "budget" });
    await takeDownSponsor("campaign", campaignId, undefined, now);
  }
}

/* ------------------------------------------------------------------ */
/* Cards already on air                                                */
/* ------------------------------------------------------------------ */

async function broadcastScene(updated: { scene?: IStream["scene"]; livekitRoomName: string } | null) {
  if (!updated) return;
  const scene = sceneView(updated.scene);
  await setRoomScene(updated.livekitRoomName, scene);
  void sendRoomData(updated.livekitRoomName, { __evt: "scene", scene });
}

function showingFilter(source: SponsorSource, sponsorId: Id | string, hostId?: Id) {
  return {
    isLive: true,
    ...(hostId ? { streamerId: hostId } : {}),
    "scene.layers": { $elemMatch: { kind: "sponsor", source, sponsorId: String(sponsorId) } },
  };
}

/**
 * Take a sponsor's card down wherever it's on air (or on one host's stream):
 * a deleted sponsor, a creator leaving a campaign, a campaign paused or ended.
 */
export async function takeDownSponsor(source: SponsorSource, sponsorId: Id | string, hostId?: Id, now = new Date()) {
  const streams = await Stream.find(showingFilter(source, sponsorId, hostId)).select("_id").lean();
  for (const s of streams) {
    const updated = await Stream.findOneAndUpdate(
      { _id: s._id, isLive: true },
      { $pull: { "scene.layers": { kind: "sponsor", source, sponsorId: String(sponsorId) } }, $inc: { "scene.version": 1 } },
      { new: true, select: "scene livekitRoomName" },
    ).lean();
    await broadcastScene(updated);
    const closed = await closeRun(s._id as Id, source, sponsorId, now);
    if (closed?.source === "campaign") await settleRun(closed, now).catch((e) => console.error("sponsor settle failed:", e));
  }
  return streams.length;
}

/** A sponsor or campaign was edited: every card of it on air redraws with the new words. */
export async function refreshSponsorOnAir(source: SponsorSource, sponsorId: Id | string) {
  const streams = await Stream.find(showingFilter(source, sponsorId)).select("_id streamerId category").lean();
  for (const s of streams) {
    let layer: SponsorLayer;
    try {
      layer = await resolveSponsorLayer({ source, sponsorId: String(sponsorId) }, s.streamerId, s);
    } catch {
      await takeDownSponsor(source, sponsorId, s.streamerId);
      continue;
    }
    const updated = await Stream.findOneAndUpdate(
      { _id: s._id, isLive: true },
      { $set: { "scene.layers.$[l]": layer }, $inc: { "scene.version": 1 } },
      {
        new: true,
        select: "scene livekitRoomName",
        arrayFilters: [{ "l.kind": "sponsor", "l.source": source, "l.sponsorId": String(sponsorId) }],
      },
    ).lean();
    await broadcastScene(updated);
  }
}

/* ------------------------------------------------------------------ */
/* Sponsored quests                                                    */
/* ------------------------------------------------------------------ */

/**
 * Minutes a viewer watched while this campaign's card was on screen, inside
 * the campaign's dates: their watch sessions, cut to the card's spans on
 * each broadcast that ran it, overlaps merged.
 */
export async function questMinutes(campaign: Pick<ICampaign, "_id" | "startsAt" | "endsAt" | "createdAt">, userId: Id, now = new Date()) {
  const runs = await SponsorRun.find({ source: "campaign", sponsorId: campaign._id }).select("streamId spans openSince").lean();
  if (runs.length === 0) return 0;
  const shown = new Map<string, Interval[]>();
  for (const r of runs) {
    const spans: Interval[] = (r.spans ?? []).map((s) => [new Date(s.from).getTime(), new Date(s.to).getTime()]);
    if (r.openSince) spans.push([new Date(r.openSince).getTime(), now.getTime()]);
    const key = String(r.streamId);
    shown.set(key, [...(shown.get(key) ?? []), ...spans]);
  }
  const start = new Date(campaign.startsAt ?? campaign.createdAt ?? 0).getTime();
  const end = Math.min(now.getTime(), campaign.endsAt ? new Date(campaign.endsAt).getTime() : now.getTime());
  if (end <= start) return 0;
  const sessions = await WatchSession.find({
    userId,
    streamId: { $in: runs.map((r) => r.streamId) },
    joinedAt: { $lt: new Date(end) },
  })
    .select("streamId joinedAt leftAt")
    .lean();
  const watched: Interval[] = [];
  for (const s of sessions) {
    const a = new Date(s.joinedAt).getTime();
    const b = s.leftAt ? new Date(s.leftAt).getTime() : Math.min(now.getTime(), a + OPEN_SESSION_CAP_MS);
    for (const [x, y] of shown.get(String(s.streamId)) ?? []) {
      const lo = Math.max(a, x);
      const hi = Math.min(b, y);
      if (hi > lo) watched.push([lo, hi]);
    }
  }
  return minutesWithin(watched, start, end);
}

/** One sponsored quest as this viewer sees it. */
export async function sponsoredQuestView(campaign: ICampaign | (Omit<ICampaign, keyof mongoose.Document> & { _id: unknown }), userId: Id | null, now = new Date()): Promise<SponsoredQuestView | null> {
  if (!campaign.quest) return null;
  const [progress, voucher, left] = await Promise.all([
    userId ? questMinutes(campaign as ICampaign, userId, now) : Promise.resolve(0),
    userId ? Voucher.findOne({ campaignId: campaign._id as Id, userId }).select("code claimedAt").lean() : Promise.resolve(null),
    Voucher.exists({ campaignId: campaign._id as Id, claimedAt: null }),
  ]);
  return {
    campaignId: String(campaign._id),
    name: campaign.name,
    line: campaign.line ?? "",
    url: campaign.url ?? "",
    logoUrl: logoPath("campaigns", campaign._id, campaign.logo, campaign.logoVersion ?? 0),
    reward: campaign.quest.reward,
    minutes: campaign.quest.minutes,
    progress: Math.min(progress, campaign.quest.minutes),
    voucher: voucher?.claimedAt ? { code: voucher.code, claimedAt: new Date(voucher.claimedAt).toISOString() } : null,
    vouchersLeft: Boolean(left),
    status: campaign.status,
  };
}

/**
 * Hand a viewer one of the brand's vouchers, once: the quest re-counted on
 * the server, one voucher per person per campaign (a unique index), and a
 * day-old account at least, so fresh accounts can't farm them.
 */
export async function claimVoucher(campaignId: string, user: { _id: Id; createdAt?: Date }, restricted: boolean, now = new Date()) {
  const campaign = await Campaign.findById(campaignId).lean();
  if (!campaign?.quest || campaign.status === "draft") throw new ApiError(404, "That quest isn't running", "QUEST_NOT_FOUND");
  if (restricted && campaignRestricted(campaign)) throw new ApiError(403, "This quest isn't available where you are", "NOT_AVAILABLE_HERE");
  const held = await Voucher.findOne({ campaignId: campaign._id, userId: user._id }).lean();
  if (held) return held;
  if (user.createdAt && now.getTime() - new Date(user.createdAt).getTime() < NEW_ACCOUNT_MS) {
    throw new ApiError(403, "Vouchers open to accounts a day old — come back tomorrow", "ACCOUNT_TOO_NEW");
  }
  const minutes = await questMinutes(campaign as ICampaign, user._id, now);
  if (minutes < campaign.quest.minutes) {
    throw new ApiError(409, `${campaign.quest.minutes - minutes} more minutes to go`, "QUEST_NOT_DONE");
  }
  try {
    const voucher = await Voucher.findOneAndUpdate(
      { campaignId: campaign._id, claimedAt: null },
      { $set: { userId: user._id, claimedAt: now } },
      { new: true, sort: { _id: 1 } },
    ).lean();
    if (!voucher) throw new ApiError(409, "Every voucher has been claimed", "VOUCHERS_GONE");
    await audit(user._id, "voucher.claim", "campaign", campaign._id as Id, { voucherId: String(voucher._id) });
    return voucher;
  } catch (error) {
    // A second tap racing the first: they already hold one.
    if (isDuplicateKey(error)) {
      const again = await Voucher.findOne({ campaignId: campaign._id, userId: user._id }).lean();
      if (again) return again;
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* A creator's sponsorships                                            */
/* ------------------------------------------------------------------ */

/** Campaigns a creator can see — running ones, and any they're in — with their standing in each. */
export async function creatorCampaigns(userId: Id, now = new Date()) {
  const memberships = await CampaignMember.find({ userId }).lean();
  const byCampaign = new Map(memberships.map((m) => [String(m.campaignId), m]));
  const campaigns = await Campaign.find({
    $or: [
      { status: "live", $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      { _id: { $in: memberships.map((m) => m.campaignId) }, status: { $ne: "draft" } },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return campaigns
    .map((c) => campaignView(c, byCampaign.get(String(c._id)) ?? null))
    .sort((a, b) => Number(b.joined) - Number(a.joined));
}

/** A creator's last broadcasts with sponsors on them: on-screen time, and what campaigns paid. */
export async function creatorRuns(userId: Id, limit = 30): Promise<SponsorRunView[]> {
  const runs = await SponsorRun.find({ hostId: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  const streamIds = [...new Set(runs.map((r) => String(r.streamId)))];
  const campaignIds = [...new Set(runs.filter((r) => r.source === "campaign").map((r) => String(r.sponsorId)))];
  const [streams, campaigns] = await Promise.all([
    Stream.find({ _id: { $in: streamIds } }).select("title").lean(),
    Campaign.find({ _id: { $in: campaignIds } }).select("minMinutes").lean(),
  ]);
  const titles = new Map(streams.map((s) => [String(s._id), s.title]));
  const mins = new Map(campaigns.map((c) => [String(c._id), c.minMinutes]));
  const now = Date.now();
  return runs.map((r) => ({
    id: String(r._id),
    source: r.source,
    sponsorId: String(r.sponsorId),
    name: r.name,
    streamId: String(r.streamId),
    streamTitle: titles.get(String(r.streamId)) ?? "",
    seconds: Math.round((r.seconds ?? 0) + (r.openSince ? (now - new Date(r.openSince).getTime()) / 1000 : 0)),
    status: r.status,
    unpaidReason: r.unpaidReason ?? "",
    payUsdMinor: r.payUsdMinor ?? 0,
    minMinutes: r.source === "campaign" ? (mins.get(String(r.sponsorId)) ?? null) : null,
    at: new Date(r.createdAt).toISOString(),
  }));
}

/* ------------------------------------------------------------------ */
/* The sweep                                                           */
/* ------------------------------------------------------------------ */

/**
 * Once a minute: spans left open on broadcasts that have ended close at the
 * end; campaign runs still up are paid the minute they've earned it; and
 * campaigns past their end date end, their cards coming down.
 */
export async function sweepSponsors(now = new Date()) {
  const open = await SponsorRun.find({ openSince: { $ne: null } }).select("streamId").limit(500).lean();
  const streamIds = [...new Set(open.map((r) => String(r.streamId)))];
  if (streamIds.length > 0) {
    const streams = await Stream.find({ _id: { $in: streamIds } }).select("isLive endedAt").lean();
    for (const s of streams) {
      if (!s.isLive) await closeStreamRuns(s._id as Id, s.endedAt ? new Date(s.endedAt) : now);
    }
  }

  const counting = await SponsorRun.find({ status: "counting", openSince: { $ne: null } }).limit(500);
  for (const r of counting) await settleRun(r, now).catch((e) => console.error("sponsor settle failed:", e));

  // Runs whose card came down and whose stream then ended without us
  // hearing (a restart mid-broadcast) get their verdict here.
  const idle = await SponsorRun.find({ status: "counting", openSince: null, updatedAt: { $lt: new Date(now.getTime() - 10 * 60_000) } }).limit(200);
  if (idle.length > 0) {
    const live = new Set(
      (await Stream.find({ _id: { $in: idle.map((r) => r.streamId) }, isLive: true }).select("_id").lean()).map((s) => String(s._id)),
    );
    for (const r of idle) {
      if (!live.has(String(r.streamId))) await settleRun(r, now, true).catch((e) => console.error("sponsor settle failed:", e));
    }
  }

  const overdue = await Campaign.find({ status: { $in: ["live", "paused"] }, endsAt: { $ne: null, $lte: now } }).select("_id").lean();
  for (const c of overdue) {
    const ended = await Campaign.updateOne({ _id: c._id, status: { $ne: "ended" } }, { $set: { status: "ended", endedReason: "date" } });
    if (ended.modifiedCount) {
      await audit(null, "campaign.end", "campaign", c._id as Id, { reason: "date" });
      await takeDownSponsor("campaign", c._id as Id, undefined, now);
    }
  }
}

export function startSponsorSweep() {
  setInterval(() => void sweepSponsors().catch((e) => console.error("sponsor sweep failed:", e)), 60_000);
}
