import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type mongoose from "mongoose";
import { z } from "zod";
import {
  campaignBodySchema,
  campaignBudgetMinor,
  campaignStatusBodySchema,
  campaignVouchersBodySchema,
  MAX_SPONSORS,
  objectIdSchema,
  sponsorBodySchema,
  sponsorRegionQuerySchema,
  streamIdParamsSchema,
} from "@xtreme/contracts";
import { audit } from "../audit.js";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { Campaign, CampaignMember, Sponsor, User, Voucher, type ICampaign } from "../models.js";
import {
  campaignRestricted,
  campaignView,
  claimVoucher,
  creatorCampaigns,
  creatorRuns,
  inRestrictedRegion,
  refreshSponsorOnAir,
  sponsoredQuestView,
  sponsorView,
  streamsLeft,
  takeDownSponsor,
  viewerCountry,
} from "../sponsors.js";
import { parseImageDataUri } from "../stream-service.js";
import { isPlatformAdmin } from "./admin.js";

/**
 * Sponsorships (Phase 2): a creator's own sponsors, the Xtream campaigns
 * they can join, the sponsored quests viewers play for vouchers, and the
 * admin side where the platform's team runs campaigns. The rules live in
 * sponsors.ts; these routes check who's asking and shape the answers.
 */

type Id = mongoose.Types.ObjectId;
const sponsorParamsSchema = z.object({ sponsorId: objectIdSchema });

async function requireAdmin(request: FastifyRequest) {
  const { dbUser } = await authenticate(request);
  if (!isPlatformAdmin(dbUser)) throw new ApiError(403, "Admins only", "FORBIDDEN");
  return dbUser;
}

/** Whether restricted sponsors stay off this viewer's screen (see inRestrictedRegion). */
function restrictedFor(request: FastifyRequest, tz?: string) {
  return inRestrictedRegion(viewerCountry(request.headers), tz ?? null);
}

/** A stored inline image, served with a long-lived, versioned cache. */
function sendLogo(reply: FastifyReply, logo: string | undefined, version: number, tag: string) {
  if (!logo) throw new ApiError(404, "No logo", "NO_LOGO");
  if (!logo.startsWith("data:")) return reply.redirect(logo, 302);
  const image = parseImageDataUri(logo);
  if (!image) throw new ApiError(415, "Stored logo is not a readable image", "LOGO_UNREADABLE");
  return reply
    .header("Content-Type", image.contentType)
    .header("ETag", `"${tag}-${version}"`)
    .header("Cache-Control", "public, max-age=31536000, immutable")
    .header("Cross-Origin-Resource-Policy", "cross-origin")
    .send(image.body);
}

/** A new logo is a new version, so every cache lets the old one go; "" removes it. */
function nextLogo(current: { logo: string }, incoming: string | undefined): { logo?: string; logoVersion?: number } {
  if (incoming === undefined || incoming === current.logo) return {};
  return { logo: incoming, logoVersion: incoming ? Date.now() : 0 };
}

/** The campaign as the platform's team sees it: the numbers behind it. */
async function adminCampaignView(c: ICampaign | (Omit<ICampaign, keyof mongoose.Document> & { _id: unknown })) {
  const [members, vouchers, claimed] = await Promise.all([
    CampaignMember.countDocuments({ campaignId: c._id as Id, leftAt: null }),
    Voucher.countDocuments({ campaignId: c._id as Id }),
    Voucher.countDocuments({ campaignId: c._id as Id, claimedAt: { $ne: null } }),
  ]);
  return {
    ...campaignView(c),
    cleared: c.cleared,
    endedReason: c.endedReason ?? "",
    brandPaidUsdMinor: c.brandPaidUsdMinor,
    marginPercent: c.marginPercent,
    budgetUsdMinor: c.budgetUsdMinor,
    spentUsdMinor: c.spentUsdMinor,
    paidStreams: c.paidStreams,
    members,
    vouchers: { total: vouchers, claimed },
    createdAt: new Date(c.createdAt).toISOString(),
  };
}

export const sponsorRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ---------------------------- Creators ---------------------------- */

  app.get(
    "/users/me/sponsors",
    { schema: { tags: ["Sponsorships"], summary: "Your own sponsors", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const sponsors = await Sponsor.find({ ownerId: dbUser._id }).sort({ createdAt: 1 }).lean();
      return { success: true, data: { sponsors: sponsors.map(sponsorView) } };
    },
  );

  app.post(
    "/users/me/sponsors",
    {
      schema: { tags: ["Sponsorships"], summary: "Add a sponsor of your own", body: sponsorBodySchema, security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      if ((await Sponsor.countDocuments({ ownerId: dbUser._id })) >= MAX_SPONSORS) {
        throw new ApiError(409, `Keep up to ${MAX_SPONSORS} sponsors — remove one first`, "TOO_MANY_SPONSORS");
      }
      const { logo, ...fields } = request.body;
      const sponsor = await Sponsor.create({ ownerId: dbUser._id, ...fields, logo: logo ?? "", logoVersion: logo ? Date.now() : 0 });
      return { success: true, data: { sponsor: sponsorView(sponsor) } };
    },
  );

  app.put(
    "/users/me/sponsors/:sponsorId",
    {
      schema: {
        tags: ["Sponsorships"],
        summary: "Change one of your sponsors — a card of it on air redraws",
        params: sponsorParamsSchema,
        body: sponsorBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const sponsor = await Sponsor.findOne({ _id: request.params.sponsorId, ownerId: dbUser._id });
      if (!sponsor) throw new ApiError(404, "That sponsor isn't in your list", "SPONSOR_NOT_FOUND");
      const { logo, ...fields } = request.body;
      Object.assign(sponsor, fields, nextLogo(sponsor, logo));
      await sponsor.save();
      await refreshSponsorOnAir("own", sponsor._id as Id);
      return { success: true, data: { sponsor: sponsorView(sponsor) } };
    },
  );

  app.delete(
    "/users/me/sponsors/:sponsorId",
    {
      schema: { tags: ["Sponsorships"], summary: "Remove a sponsor — its card comes down if it's up", params: sponsorParamsSchema, security: [{ bearerAuth: [] }] },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const sponsor = await Sponsor.findOne({ _id: request.params.sponsorId, ownerId: dbUser._id }).select("_id").lean();
      if (!sponsor) throw new ApiError(404, "That sponsor isn't in your list", "SPONSOR_NOT_FOUND");
      await takeDownSponsor("own", sponsor._id as Id, dbUser._id as Id);
      await Sponsor.deleteOne({ _id: sponsor._id });
      return { success: true, data: { removed: String(sponsor._id) } };
    },
  );

  app.get(
    "/sponsors/:id/logo",
    { schema: { tags: ["Sponsorships"], summary: "A sponsor's logo (versioned, long-lived cache)", params: streamIdParamsSchema }, config: { rateLimit: false } },
    async (request, reply) => {
      const s = await Sponsor.findById(request.params.id).select("logo logoVersion").lean();
      return sendLogo(reply, s?.logo, s?.logoVersion ?? 0, "sponsor");
    },
  );

  app.get(
    "/users/me/sponsorships",
    {
      schema: {
        tags: ["Sponsorships"],
        summary: "Everything sponsored on your channel: your sponsors, the campaigns you can join, and your runs",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const [sponsors, campaigns, runs] = await Promise.all([
        Sponsor.find({ ownerId: dbUser._id }).sort({ createdAt: 1 }).lean(),
        creatorCampaigns(dbUser._id as Id),
        creatorRuns(dbUser._id as Id),
      ]);
      return { success: true, data: { sponsors: sponsors.map(sponsorView), campaigns, runs } };
    },
  );

  app.post(
    "/campaigns/:id/join",
    { schema: { tags: ["Sponsorships"], summary: "Opt in to an Xtream campaign", params: streamIdParamsSchema, security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const campaign = await Campaign.findById(request.params.id).lean();
      if (!campaign || campaign.status === "draft") throw new ApiError(404, "That campaign isn't open", "CAMPAIGN_NOT_FOUND");
      if (campaign.status !== "live") throw new ApiError(409, `${campaign.name}'s campaign isn't taking creators right now`, "CAMPAIGN_NOT_LIVE");
      if (streamsLeft(campaign) < 1) throw new ApiError(409, `${campaign.name}'s campaign is fully booked`, "CAMPAIGN_FULL");
      const member = await CampaignMember.findOneAndUpdate(
        { campaignId: campaign._id, userId: dbUser._id },
        { $set: { leftAt: null }, $setOnInsert: { joinedAt: new Date(), paidStreams: 0, earnedUsdMinor: 0 } },
        { upsert: true, new: true },
      ).lean();
      await audit(dbUser._id as Id, "campaign.join", "campaign", campaign._id as Id);
      return { success: true, data: { campaign: campaignView(campaign, member) } };
    },
  );

  app.post(
    "/campaigns/:id/leave",
    { schema: { tags: ["Sponsorships"], summary: "Leave a campaign — its card comes down if it's up", params: streamIdParamsSchema, security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const member = await CampaignMember.findOneAndUpdate(
        { campaignId: request.params.id, userId: dbUser._id, leftAt: null },
        { $set: { leftAt: new Date() } },
        { new: true },
      ).lean();
      if (!member) throw new ApiError(404, "You're not in that campaign", "NOT_JOINED");
      await takeDownSponsor("campaign", member.campaignId as Id, dbUser._id as Id);
      await audit(dbUser._id as Id, "campaign.leave", "campaign", member.campaignId as Id);
      const campaign = await Campaign.findById(member.campaignId).lean();
      return { success: true, data: { campaign: campaign ? campaignView(campaign, member) : null } };
    },
  );

  app.get(
    "/campaigns/:id/logo",
    { schema: { tags: ["Sponsorships"], summary: "A campaign's logo (versioned, long-lived cache)", params: streamIdParamsSchema }, config: { rateLimit: false } },
    async (request, reply) => {
      const c = await Campaign.findById(request.params.id).select("logo logoVersion").lean();
      return sendLogo(reply, c?.logo, c?.logoVersion ?? 0, "campaign");
    },
  );

  /* ---------------------------- Viewers ----------------------------- */

  app.get(
    "/geo",
    { schema: { tags: ["Sponsorships"], summary: "The viewer's country, as the edge reports it (null when it doesn't)" } },
    async (request) => ({ success: true, data: { country: viewerCountry(request.headers) } }),
  );

  app.get(
    "/campaigns/:id/quest",
    {
      schema: {
        tags: ["Sponsorships"],
        summary: "A sponsored quest: the prize, and — signed in — your minutes toward it",
        params: streamIdParamsSchema,
        querystring: sponsorRegionQuerySchema,
      },
    },
    async (request) => {
      const campaign = await Campaign.findById(request.params.id).lean();
      if (!campaign?.quest || campaign.status === "draft") throw new ApiError(404, "That quest isn't running", "QUEST_NOT_FOUND");
      if (restrictedFor(request, request.query.tz) && campaignRestricted(campaign)) {
        return { success: true, data: { quest: null, available: false } };
      }
      const authUserId = getOptionalAuthUserId(request);
      const caller = authUserId ? await User.findOne({ authUserId }).select("_id").lean() : null;
      const quest = await sponsoredQuestView(campaign, (caller?._id as Id | undefined) ?? null);
      return { success: true, data: { quest, available: true } };
    },
  );

  app.post(
    "/campaigns/:id/quest/claim",
    {
      schema: {
        tags: ["Sponsorships"],
        summary: "Claim the brand's voucher once the quest is done",
        params: streamIdParamsSchema,
        querystring: sponsorRegionQuerySchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const voucher = await claimVoucher(request.params.id, dbUser as { _id: Id; createdAt?: Date }, restrictedFor(request, request.query.tz));
      return {
        success: true,
        data: { voucher: { code: voucher.code, claimedAt: new Date(voucher.claimedAt ?? Date.now()).toISOString() } },
      };
    },
  );

  app.get(
    "/user/me/vouchers",
    {
      schema: {
        tags: ["Sponsorships"],
        summary: "Your sponsored quests and the vouchers you've won",
        querystring: sponsorRegionQuerySchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const restricted = restrictedFor(request, request.query.tz);
      const now = new Date();
      const held = await Voucher.find({ userId: dbUser._id }).select("campaignId").lean();
      const campaigns = await Campaign.find({
        quest: { $ne: null },
        $or: [
          { status: "live", $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
          { _id: { $in: held.map((v) => v.campaignId) } },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(30)
        .lean();
      const heldIds = new Set(held.map((v) => String(v.campaignId)));
      const visible = campaigns.filter((c) => heldIds.has(String(c._id)) || !(restricted && campaignRestricted(c)));
      const quests = (await Promise.all(visible.map((c) => sponsoredQuestView(c, dbUser._id as Id, now)))).filter(Boolean);
      return { success: true, data: { quests } };
    },
  );

  /* ----------------------------- Admins ----------------------------- */

  app.get(
    "/admin/campaigns",
    { schema: { tags: ["Admin"], summary: "Every campaign, newest first, with its numbers", security: [{ bearerAuth: [] }] } },
    async (request) => {
      await requireAdmin(request);
      const campaigns = await Campaign.find({}).sort({ createdAt: -1 }).limit(200).lean();
      return { success: true, data: { campaigns: await Promise.all(campaigns.map(adminCampaignView)) } };
    },
  );

  app.post(
    "/admin/campaigns",
    { schema: { tags: ["Admin"], summary: "Set up a campaign (it starts as a draft)", body: campaignBodySchema, security: [{ bearerAuth: [] }] } },
    async (request) => {
      const admin = await requireAdmin(request);
      const { logo, startsAt, endsAt, ...fields } = request.body;
      const campaign = await Campaign.create({
        ...fields,
        logo: logo ?? "",
        logoVersion: logo ? Date.now() : 0,
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        budgetUsdMinor: campaignBudgetMinor(fields.brandPaidUsdMinor, fields.marginPercent),
        status: "draft",
        createdBy: admin._id,
      });
      await audit(admin._id as Id, "campaign.create", "campaign", campaign._id as Id, {
        brandPaidUsdMinor: campaign.brandPaidUsdMinor,
        budgetUsdMinor: campaign.budgetUsdMinor,
      });
      return { success: true, data: { campaign: await adminCampaignView(campaign) } };
    },
  );

  app.put(
    "/admin/campaigns/:id",
    {
      schema: {
        tags: ["Admin"],
        summary: "Change a campaign — its cards on air redraw",
        params: streamIdParamsSchema,
        body: campaignBodySchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const campaign = await Campaign.findById(request.params.id);
      if (!campaign) throw new ApiError(404, "Campaign not found", "CAMPAIGN_NOT_FOUND");
      const { logo, startsAt, endsAt, ...fields } = request.body;
      const budget = campaignBudgetMinor(fields.brandPaidUsdMinor, fields.marginPercent);
      if (budget < campaign.spentUsdMinor) {
        throw new ApiError(409, "Creators have already been paid more than that pool", "BUDGET_BELOW_SPENT");
      }
      const before = { brandPaidUsdMinor: campaign.brandPaidUsdMinor, budgetUsdMinor: campaign.budgetUsdMinor };
      Object.assign(campaign, fields, nextLogo(campaign, logo), {
        startsAt: startsAt ? new Date(startsAt) : null,
        endsAt: endsAt ? new Date(endsAt) : null,
        budgetUsdMinor: budget,
      });
      await campaign.save();
      await audit(admin._id as Id, "campaign.update", "campaign", campaign._id as Id, { before, budgetUsdMinor: budget });
      if (campaign.status === "live") await refreshSponsorOnAir("campaign", campaign._id as Id);
      return { success: true, data: { campaign: await adminCampaignView(campaign) } };
    },
  );

  app.post(
    "/admin/campaigns/:id/status",
    {
      schema: {
        tags: ["Admin"],
        summary: "Start, pause or end a campaign — pausing or ending takes its cards down",
        params: streamIdParamsSchema,
        body: campaignStatusBodySchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const campaign = await Campaign.findById(request.params.id);
      if (!campaign) throw new ApiError(404, "Campaign not found", "CAMPAIGN_NOT_FOUND");
      const next = request.body.status;
      if (campaign.status === "ended") throw new ApiError(409, "An ended campaign stays ended — set up a new one", "CAMPAIGN_ENDED");
      if (next === "live" && streamsLeft(campaign) < 1) {
        throw new ApiError(409, "The pool can't pay for a single stream yet", "NO_BUDGET");
      }
      if (next === "live" && campaign.endsAt && campaign.endsAt <= new Date()) {
        throw new ApiError(409, "Its end date has passed", "CAMPAIGN_OVER");
      }
      campaign.status = next;
      if (next === "ended") campaign.endedReason = "admin";
      await campaign.save();
      await audit(admin._id as Id, `campaign.${next}`, "campaign", campaign._id as Id);
      if (next !== "live") await takeDownSponsor("campaign", campaign._id as Id);
      return { success: true, data: { campaign: await adminCampaignView(campaign) } };
    },
  );

  app.post(
    "/admin/campaigns/:id/vouchers",
    {
      schema: {
        tags: ["Admin"],
        summary: "Add the brand's voucher codes to a campaign's quest (repeats are skipped)",
        params: streamIdParamsSchema,
        body: campaignVouchersBodySchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const campaign = await Campaign.findById(request.params.id).select("_id").lean();
      if (!campaign) throw new ApiError(404, "Campaign not found", "CAMPAIGN_NOT_FOUND");
      const codes = [...new Set(request.body.codes.map((c) => c.trim()).filter(Boolean))];
      let added = 0;
      try {
        const inserted = await Voucher.insertMany(
          codes.map((code) => ({ campaignId: campaign._id, code })),
          { ordered: false },
        );
        added = inserted.length;
      } catch (error) {
        // Codes it already had are refused by the unique index; the rest went in.
        const e = error as { code?: number; insertedDocs?: unknown[]; result?: { insertedCount?: number } };
        if (e.code !== 11000 && !Array.isArray(e.insertedDocs)) throw error;
        added = e.insertedDocs?.length ?? e.result?.insertedCount ?? 0;
      }
      await audit(admin._id as Id, "campaign.vouchers", "campaign", campaign._id as Id, { offered: codes.length, added });
      return { success: true, data: { added, skipped: codes.length - added } };
    },
  );
};
