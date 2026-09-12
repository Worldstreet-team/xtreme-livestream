import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  searchUsersQuerySchema,
  topStreamersQuerySchema,
  updateProfileBodySchema,
  usernameParamsSchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { ensureUserIngress, rotateUserIngress } from "../livekit.js";
import { Follow, Stream, User, type IUser } from "../models.js";
import { thumbnailUrlFor } from "../stream-service.js";

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
   * ingress at each new room behind the scenes.
   */
  app.get(
    "/users/me/stream-key",
    {
      schema: {
        tags: ["Users"],
        summary: "The caller's persistent RTMP server URL and stream key",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const ingress = await ensureUserIngress(dbUser);
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
      const ingress = await rotateUserIngress(dbUser);
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
