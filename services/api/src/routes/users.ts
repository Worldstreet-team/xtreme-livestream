import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  topStreamersQuerySchema,
  updateProfileBodySchema,
  usernameParamsSchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { ApiError } from "../errors.js";
import { Follow, Stream, User, type IUser } from "../models.js";

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
    createdAt: user.createdAt,
  };
}

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

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
        throw new ApiError(400, "Cannot follow yourself", "SELF_FOLLOW");
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
            "Already following this user",
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
          "Not following this user",
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
};
