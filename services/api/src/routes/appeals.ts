import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { appealBodySchema, streamIdParamsSchema, type AppealView, type TakedownView } from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { Appeal, Notification, Stream, User, type IAppeal, type IStream } from "../models.js";
import { pushNotifications } from "../xtream-events.js";

/**
 * Appeals (Phase 3, deeper moderation): a creator whose stream the platform
 * took down can ask for another look, once, in their own words. The
 * platform's admins decide in the report queue (admin.ts).
 */

/** How long after a takedown an appeal can still be made. */
const APPEAL_WINDOW_MS = 90 * 86_400_000;

export function appealView(a: Pick<IAppeal, "_id" | "status" | "text" | "note" | "createdAt" | "reviewedAt">, stream: Pick<IStream, "_id" | "title" | "takenDownAt"> | null): AppealView {
  return {
    id: String(a._id),
    status: a.status,
    text: a.text,
    note: a.note ?? "",
    createdAt: new Date(a.createdAt).toISOString(),
    reviewedAt: a.reviewedAt ? new Date(a.reviewedAt).toISOString() : null,
    stream: {
      id: stream ? String(stream._id) : "",
      title: stream?.title ?? "A removed stream",
      takenDownAt: stream?.takenDownAt ? new Date(stream.takenDownAt).toISOString() : null,
    },
  };
}

export const appealRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/users/me/takedowns",
    { schema: { tags: ["Appeals"], summary: "Your streams the platform took down, and your appeals", security: [{ bearerAuth: [] }] } },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const since = new Date(Date.now() - APPEAL_WINDOW_MS * 2);
      const streams = await Stream.find({ streamerId: dbUser._id, takenDownAt: { $gte: since } }).select("title takenDownAt").sort({ takenDownAt: -1 }).lean();
      const appeals = streams.length ? await Appeal.find({ streamId: { $in: streams.map((s) => s._id) } }).lean() : [];
      // An appeal that reversed a takedown keeps its stream here, so the outcome can be read.
      const reversed = await Appeal.find({ userId: dbUser._id, status: "reversed", reviewedAt: { $gte: since } }).lean();
      const back = reversed.length ? await Stream.find({ _id: { $in: reversed.map((a) => a.streamId) } }).select("title takenDownAt").lean() : [];
      const sameTakedown = (a: { takenDownAt?: Date | null }, at: Date) => !a.takenDownAt || new Date(a.takenDownAt).getTime() === new Date(at).getTime();
      // One row per stream: a takedown in force first, with the appeal made
      // against it (not one against an earlier takedown since reversed).
      const rows = new Map<string, TakedownView>();
      for (const s of streams) {
        const a = appeals.find((x) => String(x.streamId) === String(s._id) && sameTakedown(x, s.takenDownAt!));
        rows.set(String(s._id), { streamId: String(s._id), title: s.title, takenDownAt: new Date(s.takenDownAt!).toISOString(), appeal: a ? appealView(a, s) : null });
      }
      for (const s of back) {
        if (rows.has(String(s._id))) continue;
        const a = reversed.find((x) => String(x.streamId) === String(s._id))!;
        rows.set(String(s._id), { streamId: String(s._id), title: s.title, takenDownAt: new Date(a.takenDownAt ?? a.createdAt).toISOString(), appeal: appealView(a, s) });
      }
      return { success: true, data: { takedowns: [...rows.values()] } };
    },
  );

  app.post(
    "/streams/:id/appeal",
    {
      schema: { tags: ["Appeals"], summary: "Ask the platform to look again at a takedown — once per stream", params: streamIdParamsSchema, body: appealBodySchema, security: [{ bearerAuth: [] }] },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id).select("streamerId title takenDownAt").lean();
      if (!stream || !stream.streamerId.equals(dbUser._id)) throw new ApiError(404, "That isn't one of your streams", "STREAM_NOT_FOUND");
      if (!stream.takenDownAt) throw new ApiError(409, "This stream wasn't taken down", "NOT_TAKEN_DOWN");
      if (Date.now() - new Date(stream.takenDownAt).getTime() > APPEAL_WINDOW_MS) {
        throw new ApiError(409, "Appeals close 90 days after a takedown", "APPEAL_WINDOW_CLOSED");
      }
      let appeal: IAppeal;
      try {
        appeal = await Appeal.create({
          kind: "takedown",
          streamId: stream._id,
          userId: dbUser._id,
          text: request.body.text,
          takenDownAt: stream.takenDownAt,
          status: "open",
          note: "",
          reviewedBy: null,
          reviewedAt: null,
        });
      } catch (err) {
        if (err && typeof err === "object" && "code" in err && err.code === 11000) {
          throw new ApiError(409, "You've already appealed this takedown — the team will get back to you", "ALREADY_APPEALED");
        }
        throw err;
      }
      // The admins hear about it, as they do about a report.
      if (config.ADMIN_USERNAMES.length > 0) {
        const admins = await User.find({ username: { $in: config.ADMIN_USERNAMES } }).select("_id").lean();
        await Notification.insertMany(
          admins.map((a) => ({
            userId: a._id,
            type: "appeal",
            actorId: dbUser._id,
            actorName: dbUser.displayName || dbUser.username,
            streamId: stream._id,
            streamTitle: stream.title,
            link: "/admin/appeals",
          })),
        ).then(pushNotifications, () => {});
      }
      return { success: true, data: { appeal: appealView(appeal, stream) } };
    },
  );
};
