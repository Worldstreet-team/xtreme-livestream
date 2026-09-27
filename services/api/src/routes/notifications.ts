import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { objectIdSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { Notification, User } from "../models.js";

/** The bell: a follower's feed of go-live pings. */
export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/user/me/notifications",
    {
      schema: {
        tags: ["Notifications"],
        summary: "The signed-in user's notifications, newest first",
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);

      const [rows, unread] = await Promise.all([
        Notification.find({ userId: dbUser._id })
          .sort({ createdAt: -1 })
          .limit(request.query.limit)
          .lean(),
        Notification.countDocuments({ userId: dbUser._id, read: false }),
      ]);

      // The bell draws each row with its person's face. One lookup for the
      // page; a row whose actor has gone keeps its name and draws initials.
      const actorIds = [...new Set(rows.map((n) => String(n.actorId)).filter((v) => v && v !== "undefined"))];
      const actors =
        actorIds.length > 0
          ? await User.find({ _id: { $in: actorIds } })
              .select("username avatar")
              .lean()
              .catch(() => [])
          : [];
      const actorById = new Map(actors.map((u) => [String(u._id), u]));

      return {
        success: true,
        data: {
          notifications: rows.map((n) => ({
            id: String(n._id),
            type: n.type,
            actorName: n.actorName,
            actorUsername: actorById.get(String(n.actorId))?.username ?? "",
            streamId: n.streamId ? String(n.streamId) : null,
            streamTitle: n.streamTitle,
            link: n.link ?? "",
            read: n.read,
            createdAt: n.createdAt,
          })),
          unread,
          // Each face once, by username: avatars can be whole images, and
          // one person's rows would otherwise carry theirs over and over on
          // every 30-second poll.
          avatars: Object.fromEntries(actors.filter((u) => u.username && u.avatar).map((u) => [u.username, u.avatar])),
        },
      };
    },
  );

  app.post(
    "/user/me/notifications/read",
    {
      schema: {
        tags: ["Notifications"],
        summary: "Mark notifications read (all of them, or just the ids given)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      // Body is optional — apiFetch sends bare POSTs with no body at all,
      // which a schema-typed body would reject before the handler ran. Parse
      // what arrived (if anything) instead.
      const parsed = z
        .object({ ids: z.array(objectIdSchema).max(100).optional() })
        .safeParse(request.body ?? {});
      const ids = parsed.success ? parsed.data.ids : undefined;

      await Notification.updateMany(
        {
          userId: dbUser._id,
          read: false,
          ...(ids && ids.length > 0 ? { _id: { $in: ids } } : {}),
        },
        { $set: { read: true } },
      );

      return { success: true, data: { read: true } };
    },
  );
};
