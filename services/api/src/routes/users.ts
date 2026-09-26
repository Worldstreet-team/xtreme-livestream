import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  brandBodySchema,
  searchUsersQuerySchema,
  streamIdParamsSchema,
  streamKeyQuerySchema,
  topStreamersQuerySchema,
  updateProfileBodySchema,
  usernameParamsSchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { ensureUserIngress, rotateUserIngress, sendRoomData } from "../livekit.js";
import { Follow, Stream, User, type IUser } from "../models.js";
import { bumpGoal } from "../goals.js";
import { parseImageDataUri, thumbnailUrlFor } from "../stream-service.js";

/**
 * The brand kit as clients see it: the logo as a versioned URL (never its
 * bytes), keyed by user id so any username works in it.
 */
function brandView(user: Pick<IUser, "_id" | "brand">) {
  const b = user.brand;
  const logoVersion = b?.logo ? (b.logoVersion ?? 0) : 0;
  return {
    accent: b?.accent ?? "ember",
    lowerThird: b?.lowerThird ?? "bar",
    font: b?.font ?? "wide",
    logoVersion,
    logoUrl: logoVersion > 0 ? `/api/users/${String(user._id)}/logo?v=${logoVersion}` : null,
    presets: b?.presets ?? [],
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function privateUser(user: IUser) {
  return {
    id: user._id,
    authUserId: user.authUserId,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    avatar: user.avatar,
    bio: user.bio,
    followers: user.followers,
    following: user.following,
    totalViews: user.totalViews,
    isLive: user.isLive,
    verified: user.verified,
    streamKey: user.streamKey,
    settings: user.settings,
    onboarding: user.onboarding ?? { completedAt: null, categories: [], language: "" },
    createdAt: user.createdAt,
  };
}

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * The account's encoder credentials — the same server URL and stream key
   * for every broadcast. Set once in OBS or vMix; the studio re-points the
   * ingress at each new room behind the scenes. `protocol=whip` gives the
   * WHIP server and bearer token instead (OBS 30+, lower delay).
   */
  app.get(
    "/users/me/stream-key",
    {
      schema: {
        tags: ["Users"],
        summary: "The caller's persistent encoder server URL and key (RTMP, or WHIP)",
        security: [{ bearerAuth: [] }],
        querystring: streamKeyQuerySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const { protocol } = request.query;
      // Live on an encoder: show what's stored and leave LiveKit alone —
      // re-pointing now would move the feed off the room it's live in.
      const stored = protocol === "whip" ? dbUser.whipIngress : dbUser.obsIngress;
      const liveFromEncoder = await Stream.exists({ streamerId: dbUser._id, isLive: true, source: "obs" });
      const ingress = liveFromEncoder && stored?.ingressId ? stored : await ensureUserIngress(dbUser, undefined, protocol);
      return {
        success: true,
        data: {
          url: ingress.url,
          streamKey: ingress.streamKey,
          createdAt: ingress.createdAt,
        },
      };
    },
  );

  app.post(
    "/users/me/stream-key/rotate",
    {
      schema: {
        tags: ["Users"],
        summary: "Replace the caller's stream key — the old one stops working at once",
        security: [{ bearerAuth: [] }],
        querystring: streamKeyQuerySchema,
      },
      config: {
        rateLimit: { max: 5, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const live = await Stream.exists({ streamerId: dbUser._id, isLive: true, source: "obs" });
      if (live) {
        throw new ApiError(
          409,
          "End your current broadcast before changing the key",
          "STREAM_LIVE",
        );
      }
      const ingress = await rotateUserIngress(dbUser, request.query.protocol);
      return {
        success: true,
        data: {
          url: ingress.url,
          streamKey: ingress.streamKey,
          createdAt: ingress.createdAt,
        },
      };
    },
  );

  app.get(
    "/users/top",
    {
      schema: {
        tags: ["Users"],
        summary: "Leaderboard of top streamers by followers and total views",
        querystring: topStreamersQuerySchema,
      },
    },
    async (request) => {
      const { limit } = request.query;

      // `totalViews` used to be the secondary sort and was surfaced on the
      // landing leaderboard as "Total Views" — but nothing in either backend
      // has ever written to it, so it was always 0 for every real streamer.
      // Peak concurrent viewers, summed across a streamer's streams, is a
      // number we actually record, and matches what the creator dashboard
      // already calls "Peak Viewers".
      const users = await User.find({})
        .sort({ followers: -1, createdAt: 1 })
        .limit(limit)
        .select("username displayName avatar followers isLive verified")
        .lean();

      // One pass over the streamers' streams supplies both the category shown
      // on the leaderboard (from their most recent stream) and their peak.
      const streamStats = users.length
        ? await Stream.aggregate<{
            _id: unknown;
            category: string;
            totalPeakViewers: number;
          }>([
            { $match: { streamerId: { $in: users.map((u) => u._id) } } },
            { $sort: { startedAt: -1 } },
            {
              $group: {
                _id: "$streamerId",
                category: { $first: "$category" },
                totalPeakViewers: {
                  $sum: { $ifNull: ["$peakViewers", "$viewers"] },
                },
              },
            },
          ])
        : [];
      const statsByUser = new Map(
        streamStats.map((row) => [String(row._id), row]),
      );

      return {
        success: true,
        data: {
          streamers: users.map((user, index) => {
            const stats = statsByUser.get(String(user._id));

            return {
              rank: index + 1,
              id: user._id,
              username: user.username,
              displayName: user.displayName,
              avatar: user.avatar,
              followers: user.followers,
              totalPeakViewers: stats?.totalPeakViewers ?? 0,
              isLive: user.isLive,
              verified: user.verified,
              category: stats?.category ?? null,
            };
          }),
        },
      };
    },
  );

  app.get(
    "/users/me/brand",
    {
      schema: {
        tags: ["Users"],
        summary: "Your brand kit: accent, lower-third style and logo",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      return { success: true, data: { brand: brandView(dbUser) } };
    },
  );

  app.patch(
    "/users/me/brand",
    {
      schema: {
        tags: ["Users"],
        summary: "Update your brand kit — a new logo gets a new version",
        security: [{ bearerAuth: [] }],
        body: brandBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const body = request.body;
      const brand = {
        accent: dbUser.brand?.accent ?? "ember",
        lowerThird: dbUser.brand?.lowerThird ?? "bar",
        font: dbUser.brand?.font ?? "wide",
        logo: dbUser.brand?.logo ?? "",
        logoVersion: dbUser.brand?.logoVersion ?? 0,
        presets: dbUser.brand?.presets ?? [],
      };
      if (body.accent) brand.accent = body.accent;
      if (body.lowerThird) brand.lowerThird = body.lowerThird;
      if (body.font) brand.font = body.font;
      if (body.presets) brand.presets = body.presets;
      if (body.logo !== undefined && body.logo !== brand.logo) {
        brand.logo = body.logo;
        // A new logo is a new URL, so every cache lets the old one go.
        brand.logoVersion = body.logo ? Date.now() : 0;
      }
      dbUser.brand = brand;
      await dbUser.save();
      const view = brandView(dbUser);
      // On air, the room redraws in the new colours at once; anyone joining
      // later reads the brand off the stream.
      const live = await Stream.findOne({ streamerId: dbUser._id, isLive: true }).select("livekitRoomName").lean();
      if (live?.livekitRoomName) await sendRoomData(live.livekitRoomName, { __evt: "brand", brand: view });
      return { success: true, data: { brand: view } };
    },
  );

  app.get(
    "/users/:id/logo",
    {
      schema: {
        tags: ["Users"],
        summary: "A creator's logo as an image (long-lived, versioned cache)",
        params: streamIdParamsSchema,
      },
      config: { rateLimit: false },
    },
    async (request, reply) => {
      const user = await User.findById(request.params.id).select("brand.logo brand.logoVersion").lean();
      const logo = user?.brand?.logo;
      if (!logo) throw new ApiError(404, "No logo", "NO_LOGO");
      if (!logo.startsWith("data:")) return reply.redirect(logo, 302);
      const image = parseImageDataUri(logo);
      if (!image) throw new ApiError(415, "Stored logo is not a readable image", "LOGO_UNREADABLE");
      const etag = `"logo-${user?.brand?.logoVersion ?? 0}"`;
      if (request.headers["if-none-match"] === etag) return reply.code(304).send();
      return reply
        .header("Content-Type", image.contentType)
        .header("ETag", etag)
        // The URL carries ?v=<logoVersion>: a new logo is a new URL.
        .header("Cache-Control", "public, max-age=31536000, immutable")
        // Embedded on the web app's origin, like thumbnails.
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .send(image.body);
    },
  );

  app.get(
    "/user/me",
    {
      schema: {
        tags: ["Users"],
        summary: "Get the authenticated user's profile",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      return { success: true, data: { user: privateUser(dbUser) } };
    },
  );

  app.patch(
    "/user/me",
    {
      schema: {
        tags: ["Users"],
        summary: "Update the authenticated user's profile",
        security: [{ bearerAuth: [] }],
        body: updateProfileBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const body = request.body;

      if (body.username && body.username !== dbUser.username) {
        const duplicate = await User.exists({
          username: body.username,
          _id: { $ne: dbUser._id },
        });
        if (duplicate) {
          throw new ApiError(409, "Username already taken", "USERNAME_TAKEN");
        }
        dbUser.username = body.username;
      }

      if (body.displayName !== undefined) {
        dbUser.displayName = body.displayName;
      }
      if (body.avatar !== undefined) dbUser.avatar = body.avatar;
      if (body.bio !== undefined) dbUser.bio = body.bio;
      if (body.settings) {
        Object.assign(dbUser.settings, body.settings);
      }

      try {
        await dbUser.save();
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000
        ) {
          throw new ApiError(409, "Username already taken", "USERNAME_TAKEN");
        }
        throw error;
      }

      // The request line changed mid-stream: the room hears who can ask now.
      if (body.settings && ("stageRequests" in body.settings || "stageAccountDays" in body.settings)) {
        const live = await Stream.findOne({ streamerId: dbUser._id, isLive: true }).select("livekitRoomName").lean();
        if (live) {
          void sendRoomData(live.livekitRoomName, {
            __evt: "stage_line",
            who: dbUser.settings.stageRequests ?? "everyone",
            accountDays: dbUser.settings.stageAccountDays ?? 0,
          }).catch(() => {});
        }
      }

      return {
        success: true,
        message: "Profile updated",
        data: { user: privateUser(dbUser) },
      };
    },
  );

  app.get(
    "/users/search",
    {
      schema: {
        tags: ["Users"],
        summary: "Find channels by username or display name",
        querystring: searchUsersQuerySchema,
      },
    },
    async (request) => {
      const { q, limit } = request.query;
      const pattern = new RegExp(escapeRegex(q), "i");

      const users = await User.find({
        $or: [{ username: pattern }, { displayName: pattern }],
      })
        // Live channels first, then the biggest — someone searching a name
        // wants the broadcast happening right now above an idle namesake.
        .sort({ isLive: -1, followers: -1 })
        .limit(limit)
        .select("username displayName avatar bio followers isLive verified")
        .lean();

      const liveStreams = users.length
        ? await Stream.find({
            streamerId: { $in: users.map((user) => user._id) },
            isLive: true,
          })
            .select("streamerId title category viewers")
            .lean()
        : [];
      const streamByUser = new Map(
        liveStreams.map((stream) => [String(stream.streamerId), stream]),
      );

      return {
        success: true,
        data: {
          channels: users.map((user) => {
            const stream = streamByUser.get(String(user._id));
            return {
              id: user._id,
              username: user.username,
              displayName: user.displayName,
              avatar: user.avatar,
              bio: user.bio,
              followers: user.followers,
              verified: user.verified,
              isLive: Boolean(stream),
              stream: stream
                ? {
                    id: stream._id,
                    title: stream.title,
                    category: stream.category,
                    viewers: stream.viewers,
                  }
                : null,
            };
          }),
        },
      };
    },
  );

  app.get(
    "/user/:username",
    {
      schema: {
        tags: ["Users"],
        summary: "Get a public user profile",
        params: usernameParamsSchema,
      },
    },
    async (request) => {
      const user = await User.findOne({
        username: request.params.username,
      });

      if (!user) throw new ApiError(404, "User not found", "USER_NOT_FOUND");

      let isFollowing = false;
      const authUserId = getOptionalAuthUserId(request);
      if (authUserId) {
        const caller = await User.findOne({ authUserId }).select("_id").lean();
        if (caller) {
          isFollowing = Boolean(
            await Follow.exists({
              followerId: caller._id,
              followingId: user._id,
            }),
          );
        }
      }

      return {
        success: true,
        data: {
          user: {
            id: user._id,
            username: user.username,
            displayName: user.displayName,
            avatar: user.avatar,
            bio: user.bio,
            followers: user.followers,
            following: user.following,
            totalViews: user.totalViews,
            isLive: user.isLive,
            verified: user.verified,
            createdAt: user.createdAt,
            // What WorldSpace messaging resolves a person by: the Message
            // button on a stream or channel needs it. Social publishes the
            // same id on every public profile.
            authUserId: user.authUserId,
          },
          isFollowing,
        },
      };
    },
  );

  app.post(
    "/user/:username/follow",
    {
      schema: {
        tags: ["Users"],
        summary: "Follow a user",
        security: [{ bearerAuth: [] }],
        params: usernameParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const target = await User.findOne({
        username: request.params.username,
      });

      if (!target) throw new ApiError(404, "User not found", "USER_NOT_FOUND");
      if (target._id.equals(dbUser._id)) {
        throw new ApiError(400, "You can't ally with yourself", "SELF_FOLLOW");
      }

      try {
        await Follow.create({
          followerId: dbUser._id,
          followingId: target._id,
        });
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === 11000
        ) {
          throw new ApiError(
            409,
            "Already allied with this user",
            "ALREADY_FOLLOWING",
          );
        }
        throw error;
      }

      await Promise.all([
        User.updateOne({ _id: dbUser._id }, { $inc: { following: 1 } }),
        User.updateOne({ _id: target._id }, { $inc: { followers: 1 } }),
      ]);

      // Allied while they're live: an allies goal counts it, once per person.
      // Nothing here — the lookup included — may fail the follow.
      await (async () => {
        const live = await Stream.findOne({ streamerId: target._id, isLive: true }).select("_id").lean();
        if (live) await bumpGoal(live._id, "allies", 1, { userId: dbUser._id });
      })().catch((err) => request.log.error({ err }, "moving the goal failed"));

      return {
        success: true,
        message: `Now following ${target.displayName}`,
      };
    },
  );

  app.delete(
    "/user/:username/follow",
    {
      schema: {
        tags: ["Users"],
        summary: "Unfollow a user",
        security: [{ bearerAuth: [] }],
        params: usernameParamsSchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const target = await User.findOne({
        username: request.params.username,
      });

      if (!target) throw new ApiError(404, "User not found", "USER_NOT_FOUND");

      const deleted = await Follow.findOneAndDelete({
        followerId: dbUser._id,
        followingId: target._id,
      });

      if (!deleted) {
        throw new ApiError(
          400,
          "Not allied with this user",
          "NOT_FOLLOWING",
        );
      }

      await Promise.all([
        User.updateOne(
          { _id: dbUser._id, following: { $gt: 0 } },
          { $inc: { following: -1 } },
        ),
        User.updateOne(
          { _id: target._id, followers: { $gt: 0 } },
          { $inc: { followers: -1 } },
        ),
      ]);

      return {
        success: true,
        message: `Unfollowed ${target.displayName}`,
      };
    },
  );

  app.get(
    "/user/me/following",
    {
      schema: {
        tags: ["Users"],
        summary: "Channels the caller follows, live ones first",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);

      const follows = await Follow.find({ followerId: dbUser._id })
        .select("followingId")
        .lean();
      if (follows.length === 0) {
        return { success: true, data: { channels: [] } };
      }

      const channelIds = follows.map((follow) => follow.followingId);
      const [channels, liveStreams] = await Promise.all([
        User.find({ _id: { $in: channelIds } })
          .select("username displayName avatar bio followers isLive verified")
          .lean(),
        // The live stream is what makes a followed channel worth surfacing —
        // the row shows what they're streaming, not just that they're on.
        Stream.find({ streamerId: { $in: channelIds }, isLive: true })
          .select("streamerId title category viewers startedAt thumbnailVersion")
          .lean(),
      ]);

      const streamByChannel = new Map(
        liveStreams.map((stream) => [String(stream.streamerId), stream]),
      );

      const rows = channels.map((channel) => {
        const stream = streamByChannel.get(String(channel._id));
        return {
          id: channel._id,
          username: channel.username,
          displayName: channel.displayName,
          avatar: channel.avatar,
          bio: channel.bio,
          followers: channel.followers,
          verified: channel.verified,
          // Trust the stream row over the user flag: `isLive` on the user is
          // a denormalised copy and can lag a stream that just ended.
          isLive: Boolean(stream),
          stream: stream
            ? {
                id: stream._id,
                title: stream.title,
                category: stream.category,
                viewers: stream.viewers,
                startedAt: stream.startedAt,
                thumbnailUrl: thumbnailUrlFor(stream),
              }
            : null,
        };
      });

      rows.sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        if (a.isLive && b.isLive) {
          return (b.stream?.viewers ?? 0) - (a.stream?.viewers ?? 0);
        }
        return b.followers - a.followers;
      });

      return { success: true, data: { channels: rows } };
    },
  );
};
