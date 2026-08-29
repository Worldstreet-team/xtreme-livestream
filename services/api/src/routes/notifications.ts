import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { objectIdSchema } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { Notification } from "../models.js";

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

      return {
        success: true,
        data: {
          notifications: rows.map((n) => ({
            id: String(n._id),
            type: n.type,
            actorName: n.actorName,
            streamId: String(n.streamId),
            streamTitle: n.streamTitle,
            read: n.read,
            createdAt: n.createdAt,
          })),
          unread,
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
