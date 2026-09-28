import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { ApiError } from "../errors.js";
import { User } from "../models.js";
import { MAX_SNOOZE_HOURS, MAX_TOURS, SNOOZE_HOURS, TOUR_ID, tourIds, toursView } from "../tours.js";

const tourId = z.string().regex(TOUR_ID, "A tour id is lowercase letters, digits and dashes");

const markBody = z.discriminatedUnion("state", [
  z.object({ state: z.literal("seen") }),
  z.object({ state: z.literal("snoozed"), hours: z.number().int().min(1).max(MAX_SNOOZE_HOURS).optional() }),
]);

/**
 * The walkthrough's record on the account (see ../tours.ts). The web and
 * the app both read it with the profile (`tours` on GET /user/me, or here)
 * and write it when a tour ends.
 */
export const tourRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/user/me/tours",
    {
      schema: {
        tags: ["Users"],
        summary: "The walkthrough tours this account has finished or snoozed, shared by the web and the app",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      return { success: true, data: { tours: toursView(dbUser.tours) } };
    },
  );

  app.put(
    "/user/me/tours/:tourId",
    {
      schema: {
        tags: ["Users"],
        summary: "Record a tour as seen (finished or skipped, never again) or snoozed (\"Later\", 24 hours unless `hours` says otherwise)",
        params: z.object({ tourId }),
        body: markBody,
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const id = request.params.tourId;
      const held = tourIds(dbUser.tours);
      if (!held.has(id) && held.size >= MAX_TOURS) throw new ApiError(409, "Too many tours recorded", "TOO_MANY_TOURS");

      const body = request.body;
      const update =
        body.state === "seen"
          ? // The first time counts; a second device's "seen" doesn't move it.
            { $min: { [`tours.seen.${id}`]: new Date() }, $unset: { [`tours.snoozed.${id}`]: "" } }
          : { $set: { [`tours.snoozed.${id}`]: new Date(Date.now() + (body.hours ?? SNOOZE_HOURS) * 3_600_000) } };
      const user = await User.findByIdAndUpdate(dbUser._id, update, { new: true }).select("tours").lean();
      return { success: true, data: { tours: toursView(user?.tours) } };
    },
  );

  app.post(
    "/user/me/tours/seen",
    {
      schema: {
        tags: ["Users"],
        summary: "Record several tours as seen at once (a client carrying over what it remembered on the device)",
        body: z.object({ ids: z.array(tourId).min(1).max(50) }),
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const ids = [...new Set(request.body.ids)];
      const held = tourIds(dbUser.tours);
      const room = Math.max(0, MAX_TOURS - held.size);
      const fresh = ids.filter((id) => !held.has(id)).slice(0, room);
      const keep = ids.filter((id) => held.has(id)).concat(fresh);
      if (keep.length === 0) return { success: true, data: { tours: toursView(dbUser.tours) } };
      const now = new Date();
      const user = await User.findByIdAndUpdate(
        dbUser._id,
        {
          $min: Object.fromEntries(keep.map((id) => [`tours.seen.${id}`, now])),
          $unset: Object.fromEntries(keep.map((id) => [`tours.snoozed.${id}`, ""])),
        },
        { new: true },
      )
        .select("tours")
        .lean();
      return { success: true, data: { tours: toursView(user?.tours) } };
    },
  );

  app.delete(
    "/user/me/tours",
    {
      schema: {
        tags: ["Users"],
        summary: "Forget every tour this account has seen or snoozed, so the walkthrough plays again",
        security: [{ bearerAuth: [] }],
      },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      await User.updateOne({ _id: dbUser._id }, { $unset: { tours: "" } });
      return { success: true, data: { tours: toursView(undefined) } };
    },
  );
};
