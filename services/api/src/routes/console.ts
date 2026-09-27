import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { usernameParamsSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { sceneView } from "../featured.js";
import { createToken } from "../livekit.js";
import type mongoose from "mongoose";
import { Rundown, Sponsor, Stream, User } from "../models.js";
import { goalView, heatView } from "../goals.js";
import { creatorCampaigns, sponsorView } from "../sponsors.js";
import { atLeast, consoleIdentity, roleIn } from "../safety/roles.js";
import { reconcileStream } from "../stream-service.js";

/**
 * Producer mode (Phase 3): the console. The host on a second device, or a
 * producer they've named, joins the room hidden — watching and listening,
 * never publishing — and runs the show through the same routes the studio
 * uses (scenes, run of show, stage, featured lines), which let producers in.
 */
export const consoleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/users/:username/console",
    {
      schema: {
        tags: ["Producer mode"],
        summary: "A producer's way into a channel's live show: its stream, your role, and a hidden room token",
        params: usernameParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const streamer = await User.findOne({ username: request.params.username })
        .select(
          "username displayName avatar safety settings.featureSeconds settings.featureGiftsFromMinor settings.stageRequests settings.stageAccountDays brand.accent brand.lowerThird brand.font brand.logo brand.logoVersion brand.set",
        )
        .lean();
      if (!streamer) throw new ApiError(404, "There's no channel by that name", "USER_NOT_FOUND");
      const role = roleIn(streamer, dbUser._id);
      if (!atLeast(role, "producer")) {
        throw new ApiError(403, `You're not a producer on ${streamer.displayName || streamer.username}'s channel`, "NOT_PRODUCER");
      }
      const host = {
        id: String(streamer._id),
        username: streamer.username,
        displayName: streamer.displayName,
        avatar: streamer.avatar ?? "",
        brand: {
          accent: streamer.brand?.accent ?? "ember",
          lowerThird: streamer.brand?.lowerThird ?? "bar",
          font: streamer.brand?.font ?? "wide",
          logoVersion: streamer.brand?.logo ? (streamer.brand.logoVersion ?? 0) : 0,
          set: streamer.brand?.set ?? null,
        },
        // How long the host has lines stay up, so a producer's go up the same.
        featureSeconds: streamer.settings?.featureSeconds ?? 20,
        featureGiftsFromMinor: streamer.settings?.featureGiftsFromMinor ?? 0,
        // The request line as the host set it — theirs to change.
        stageLine: { who: streamer.settings?.stageRequests ?? "everyone", accountDays: streamer.settings?.stageAccountDays ?? 0 },
      };

      // The host's sponsors, for the graphics and cues a producer puts up,
      // and their run of show — readable before the show, to prepare.
      const [own, campaigns, rundown] = await Promise.all([
        Sponsor.find({ ownerId: streamer._id }).sort({ createdAt: 1 }).lean(),
        creatorCampaigns(streamer._id as mongoose.Types.ObjectId),
        Rundown.findOne({ ownerId: streamer._id }).select("segments").lean(),
      ]);
      // What a producer needs to put a card up — never what the host is paid for it.
      const sponsors = {
        own: own.map(sponsorView),
        campaigns: campaigns
          .filter((c) => c.joined && c.status === "live")
          .map((c) => ({ ...c, payPerStreamUsdMinor: 0, earnedUsdMinor: 0, paidStreams: 0, streamsLeft: 0 })),
      };
      const segments = rundown?.segments ?? [];

      const stream = await Stream.findOne({ streamerId: streamer._id, isLive: true });
      if (!stream || !(await reconcileStream(stream))) {
        return { success: true, data: { role, host, sponsors, segments, stream: null, token: null, url: null } };
      }
      const token = await createToken(stream.livekitRoomName, consoleIdentity(dbUser._id), `${dbUser.displayName} · producer`, {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
        hidden: true,
      });
      return {
        success: true,
        data: {
          role,
          host,
          sponsors,
          segments,
          stream: {
            id: String(stream._id),
            title: stream.title,
            category: stream.category,
            source: stream.source ?? "camera",
            // A rehearsal: the console says so, since nothing here reaches anyone.
            practice: stream.practice === true,
            startedAt: stream.startedAt,
            scene: sceneView(stream.scene),
            guests: (stream.guests ?? []).map((g) => ({
              userId: String(g.userId),
              username: g.username,
              avatar: g.avatar,
              status: g.status,
              standing: g.standing ?? null,
            })),
            goal: goalView(stream.goal),
            heat: heatView(stream.heat),
            pinned: stream.pinnedMessage
              ? { messageId: String(stream.pinnedMessage.messageId), username: stream.pinnedMessage.username, avatar: stream.pinnedMessage.avatar, content: stream.pinnedMessage.content }
              : null,
          },
          token,
          url: config.LIVEKIT_URL,
        },
      };
    },
  );
};
