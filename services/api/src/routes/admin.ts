import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  appealListQuerySchema,
  appealResolveBodySchema,
  objectIdSchema,
  reportListQuerySchema,
  reportResolveBodySchema,
  transparencyQuerySchema,
} from "@xtreme/contracts";
import { audit } from "../audit.js";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { unfeatureMessage } from "../featured.js";
import { closeRoom, sendRoomData } from "../livekit.js";
import { Appeal, ChatMessage, Notification, Report, Stream, User } from "../models.js";
import { transparencyReport } from "../transparency.js";
import { appealView } from "./appeals.js";
import { markStreamEnded } from "../stream-service.js";

/**
 * The takedown workflow (safety kit): every report lands in one queue with
 * a 48-hour clock — Nigeria's NITDA code of practice gives platforms 48
 * hours to act on unlawful content — for the platform's admins
 * (ADMIN_USERNAMES) to take the content down or dismiss the report. A
 * takedown ends a live stream and closes its room, or deletes a chat line;
 * every open report on the same thing resolves with it. All audited.
 */

export function isPlatformAdmin(user: { username?: string }) {
  return Boolean(user.username) && config.ADMIN_USERNAMES.includes(user.username!.toLowerCase());
}

async function requireAdmin(request: FastifyRequest) {
  const { dbUser } = await authenticate(request);
  if (!isPlatformAdmin(dbUser)) {
    throw new ApiError(403, "Admins only", "FORBIDDEN");
  }
  return dbUser;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/admin/me",
    { schema: { tags: ["Admin"], summary: "Whether you're a platform admin", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      return { success: true, data: { admin: isPlatformAdmin(dbUser) } };
    },
  );

  app.get(
    "/admin/reports",
    {
      schema: {
        tags: ["Admin"],
        summary: "The report queue: open reports by how soon they're due, or closed ones, newest first",
        security: [{ bearerAuth: [] }],
        querystring: reportListQuerySchema,
      },
    },
    async (request) => {
      await requireAdmin(request);
      const open = request.query.status === "open";
      const reports = await Report.find(open ? { status: "open" } : { status: { $in: ["actioned", "dismissed", "reviewed"] } })
        .sort(open ? { dueAt: 1 } : { resolvedAt: -1, updatedAt: -1 })
        .limit(200)
        .lean();

      const streamIds = [...new Set(reports.map((r) => String(r.streamId)))];
      const userIds = [...new Set(reports.flatMap((r) => [String(r.reporterId), String(r.streamerId)]))];
      const [streams, users] = await Promise.all([
        Stream.find({ _id: { $in: streamIds } }).select("title isLive takenDownAt thumbnailVersion").lean(),
        User.find({ _id: { $in: userIds } }).select("username displayName avatar").lean(),
      ]);
      const streamById = new Map(streams.map((s) => [String(s._id), s]));
      const userById = new Map(users.map((u) => [String(u._id), u]));
      // How many people reported the same thing — the queue's loudest first
      // within the same deadline.
      const sameTarget = new Map<string, number>();
      for (const r of reports) {
        const key = `${r.streamId}:${r.messageId ?? ""}`;
        sameTarget.set(key, (sameTarget.get(key) ?? 0) + 1);
      }

      const now = Date.now();
      return {
        success: true,
        data: {
          reports: reports.map((r) => {
            const stream = streamById.get(String(r.streamId));
            const host = userById.get(String(r.streamerId));
            const reporter = userById.get(String(r.reporterId));
            return {
              id: String(r._id),
              reason: r.reason,
              details: r.details,
              status: r.status,
              createdAt: r.createdAt,
              dueAt: r.dueAt,
              overdue: r.status === "open" && new Date(r.dueAt).getTime() < now,
              resolvedAt: r.resolvedAt,
              note: r.note,
              reports: sameTarget.get(`${r.streamId}:${r.messageId ?? ""}`) ?? 1,
              stream: {
                id: String(r.streamId),
                title: stream?.title ?? "(deleted stream)",
                isLive: Boolean(stream?.isLive),
                takenDown: Boolean(stream?.takenDownAt),
              },
              host: host ? { username: host.username, displayName: host.displayName, avatar: host.avatar } : null,
              reporter: reporter ? { username: reporter.username } : null,
              message: r.messageId ? { id: String(r.messageId), ...(r.message ?? { username: "", content: "" }) } : null,
            };
          }),
        },
      };
    },
  );

  app.post(
    "/admin/reports/:id/resolve",
    {
      schema: {
        tags: ["Admin"],
        summary: "Take reported content down, or dismiss the report — every open report on the same thing resolves with it",
        security: [{ bearerAuth: [] }],
        params: z.object({ id: objectIdSchema }),
        body: reportResolveBodySchema,
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const report = await Report.findById(request.params.id);
      if (!report) throw new ApiError(404, "Report not found", "REPORT_NOT_FOUND");
      const { action, note } = request.body;

      if (action === "takedown") {
        if (report.messageId) {
          // A chat line: gone from history, from every open chat, and from the screen.
          const stream = await Stream.findById(report.streamId).select("livekitRoomName");
          await ChatMessage.deleteOne({ _id: report.messageId });
          if (stream) {
            void sendRoomData(stream.livekitRoomName, { __evt: "chat_delete", messageId: String(report.messageId) });
            await unfeatureMessage(stream._id, String(report.messageId)).catch(() => {});
          }
        } else {
          // The stream: ended now if it's live, its room closed, and kept out of listings.
          const stream = await Stream.findById(report.streamId);
          if (stream) {
            if (stream.isLive) {
              void sendRoomData(stream.livekitRoomName, { __evt: "takedown" });
              await markStreamEnded(stream);
              await closeRoom(stream.livekitRoomName);
            }
            stream.takenDownAt = new Date();
            await stream.save();
            // The creator is told, not left to find a missing stream.
            await Notification.create({
              userId: stream.streamerId,
              type: "takedown",
              actorId: admin._id,
              actorName: "Xtream Trust & Safety",
              streamId: stream._id,
              streamTitle: stream.title,
              // Where they can read what happened and appeal it.
              link: "/dashboard#takedowns",
            }).catch(() => {});
          }
        }
      }

      const resolved = await Report.updateMany(
        { streamId: report.streamId, messageId: report.messageId ?? null, status: "open" },
        {
          $set: {
            status: action === "takedown" ? "actioned" : "dismissed",
            resolvedBy: admin._id,
            resolvedAt: new Date(),
            note: note ?? "",
          },
        },
      );
      await audit(admin._id, action === "takedown" ? "report.takedown" : "report.dismiss", report.messageId ? "chat" : "stream", report.messageId ?? report.streamId, {
        reportId: String(report._id),
        resolved: resolved.modifiedCount,
        overdue: report.dueAt.getTime() < Date.now(),
        ...(note ? { note } : {}),
      });
      return { success: true, data: { resolved: resolved.modifiedCount } };
    },
  );

  /* ── Appeals against takedowns ─────────────────────────────────────── */

  app.get(
    "/admin/appeals",
    {
      schema: { tags: ["Admin"], summary: "Appeals against takedowns: open ones oldest first, or decided ones newest first", security: [{ bearerAuth: [] }], querystring: appealListQuerySchema },
    },
    async (request) => {
      await requireAdmin(request);
      const open = request.query.status === "open";
      const appeals = await Appeal.find(open ? { status: "open" } : { status: { $in: ["reversed", "upheld"] } })
        .sort(open ? { createdAt: 1 } : { reviewedAt: -1 })
        .limit(100)
        .lean();
      const [streams, creators] = await Promise.all([
        Stream.find({ _id: { $in: appeals.map((a) => a.streamId) } }).select("title takenDownAt").lean(),
        User.find({ _id: { $in: appeals.map((a) => a.userId) } }).select("username displayName").lean(),
      ]);
      return {
        success: true,
        data: {
          appeals: appeals.map((a) => {
            const creator = creators.find((u) => String(u._id) === String(a.userId));
            return {
              ...appealView(a, streams.find((s) => String(s._id) === String(a.streamId)) ?? null),
              creator: creator ? { id: String(creator._id), username: creator.username, displayName: creator.displayName } : undefined,
            };
          }),
        },
      };
    },
  );

  app.post(
    "/admin/appeals/:id/resolve",
    {
      schema: {
        tags: ["Admin"],
        summary: "Reverse a takedown (its stream comes back) or uphold it — the creator is told either way",
        security: [{ bearerAuth: [] }],
        params: z.object({ id: objectIdSchema }),
        body: appealResolveBodySchema,
      },
    },
    async (request) => {
      const admin = await requireAdmin(request);
      const { decision, note } = request.body;
      const status = decision === "reverse" ? "reversed" : "upheld";
      // Decided once: a second click, or a second admin, finds it decided.
      const appeal = await Appeal.findOneAndUpdate(
        { _id: request.params.id, status: "open" },
        { $set: { status, reviewedBy: admin._id, reviewedAt: new Date(), note: note ?? "" } },
        { new: true },
      );
      if (!appeal) throw new ApiError(409, "That appeal's already been decided", "APPEAL_DECIDED");
      const stream = await Stream.findById(appeal.streamId).select("title streamerId").lean();
      if (decision === "reverse") await Stream.updateOne({ _id: appeal.streamId }, { $set: { takenDownAt: null } });
      if (stream) {
        const owner = await User.findById(stream.streamerId).select("username").lean();
        await Notification.create({
          userId: appeal.userId,
          type: decision === "reverse" ? "appeal_reversed" : "appeal_upheld",
          actorId: admin._id,
          actorName: "Xtream Trust & Safety",
          streamId: appeal.streamId,
          streamTitle: stream.title,
          link: decision === "reverse" && owner ? `/c/${owner.username}` : "/dashboard#takedowns",
        }).catch(() => {});
      }
      await audit(admin._id, decision === "reverse" ? "appeal.reverse" : "appeal.uphold", "stream", appeal.streamId, {
        appealId: String(appeal._id),
        ...(note ? { note } : {}),
      });
      return { success: true, data: { appeal: appealView(appeal, stream ? { _id: appeal.streamId, title: stream.title, takenDownAt: decision === "reverse" ? null : appeal.takenDownAt } : null) } };
    },
  );

  /* ── The transparency report ───────────────────────────────────────── */

  app.get(
    "/admin/transparency",
    { schema: { tags: ["Admin"], summary: "A calendar year of trust & safety in numbers, to publish", security: [{ bearerAuth: [] }], querystring: transparencyQuerySchema } },
    async (request) => {
      await requireAdmin(request);
      const year = request.query.year ?? new Date().getUTCFullYear();
      return { success: true, data: { report: await transparencyReport(year) } };
    },
  );
};
