import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  createStreamBodySchema,
  listStreamsQuerySchema,
  sceneBodySchema,
  streamIdParamsSchema,
  updateStreamBodySchema,
} from "@xtreme/contracts";
import { authenticate, getOptionalAuthUserId } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import mongoose from "mongoose";
import { closeRoom, ensureUserIngress,
  createToken, sendRoomData, sendRoomDataTo, setRoomScene } from "../livekit.js";
import { PreparedStream, Stream, User, type IStream, type IUser } from "../models.js";
import { PREPARED_STREAM_TTL_MS } from "../stream-prepare.js";
import { startPractice } from "../practice.js";
import { previewAccess } from "../preview.js";
import { relayLiveEvent } from "../socials-relay.js";
import { xtreamStreamStarted, xtreamStreamUpdated } from "../xtream-events.js";
import { resolveSceneLayers, sponsorLayerOf, trackSponsorExposure } from "../sponsors.js";
import { atLeast, requireChannelRole, roleIn } from "../safety/roles.js";
import {
  notifyFollowersOfLive,
  notifyRemindersOfLive,
} from "../notifications.js";
import {
  defaultStreamTitle,
  markStreamEnded,
  reconcileLeanStreams,
  reconcileStream,
  thumbnailUrlFor,
} from "../stream-service.js";
import { cardMoment, recordMoment } from "../analytics.js";
import { putScene } from "../scene-put.js";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CreateStreamBody = z.infer<typeof createStreamBodySchema>;
type StreamBody = Omit<CreateStreamBody, "scheduledStreamId" | "scene" | "prepare">;

/**
 * Everything POST /streams writes on a new broadcast except the live
 * switch (liveSwitch) — what a prepared stream keeps until its commit.
 */
function freshStreamFields(dbUser: IUser, body: StreamBody, scene: CreateStreamBody["scene"], roomName: string) {
  // A practice run (practice.ts): decided here and never changed.
  const practice = body.practice === true;
  return {
    ...body,
    // Going live needs no name: a blank title is the host's default.
    title: body.title || defaultStreamTitle(dbUser, body.category),
    practice,
    // A fresh program every broadcast — a reused booking must not
    // inherit last time's card.
    scene: {
      layout: scene?.layout ?? "auto",
      card: scene?.card ?? null,
      cardNote: scene?.cardNote ?? "",
      chart: scene?.chart ?? null,
      // A sponsor card goes up through the scene route, where it's
      // checked and its on-screen time starts counting.
      layers: (scene?.layers ?? []).filter((l) => l.kind !== "sponsor"),
      featured: null,
      version: scene ? 1 : 0,
    },
    // Each broadcast starts with Shield down and no suggestions waiting,
    // no goal and a cold meter.
    shield: { on: false, at: null, by: null },
    featureQueue: [],
    goal: null,
    heat: null,
    health: [],
    requestsOpen: false,
    // A fresh show: the rundown starts from the top.
    rundown: null,
    // Stamps the version the thumbnail URL is cache-busted on.
    thumbnailVersion: body.thumbnail ? Date.now() : 0,
    livekitRoomName: roomName,
  };
}
type StreamFields = ReturnType<typeof freshStreamFields>;

/** On air, from now. */
function liveSwitch() {
  return { status: "live" as const, isLive: true, startedAt: new Date(), endedAt: null };
}

/**
 * The account's persistent ingress, re-pointed at this room. The encoder
 * joins under its own identity: if it shared the browser's, opening the
 * studio dashboard (same user id) would make LiveKit kick the ingress —
 * killing the feed the moment the streamer looked at their own stream.
 */
async function pointIngress(dbUser: IUser, roomName: string) {
  const ingress = await ensureUserIngress(dbUser, roomName);
  // A WHIP key set up too: point it here as well, so whichever the
  // encoder speaks lands in this room. Never fails the go-live.
  if (dbUser.whipIngress?.ingressId) {
    await ensureUserIngress(dbUser, roomName, "whip").catch(() => {});
  }
  return ingress;
}

function hostToken(roomName: string, dbUser: IUser) {
  return createToken(roomName, dbUser._id.toString(), dbUser.displayName, {
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomCreate: true,
  });
}

/** The host's own booking, still upcoming — or the 404 a start from it gets. */
async function findBooking(dbUser: IUser, scheduledStreamId: string | mongoose.Types.ObjectId) {
  const scheduled = await Stream.findOne({
    _id: scheduledStreamId,
    streamerId: dbUser._id,
    status: "upcoming",
  });
  if (!scheduled) {
    throw new ApiError(404, "Scheduled stream not found", "STREAM_NOT_FOUND");
  }
  return scheduled;
}

/** What a booking keeps when the start doesn't say otherwise: its title and its thumbnail. */
function keepBookingDetails(scheduled: IStream, fields: StreamFields, asked: { title: string; thumbnail: string }) {
  // No title on go-live keeps the one it was booked under.
  if (!asked.title && scheduled.title) fields.title = scheduled.title;
  // No new thumbnail on go-live means keep the one it was scheduled with.
  if (!asked.thumbnail && scheduled.thumbnail) {
    fields.thumbnail = scheduled.thumbnail;
    fields.thumbnailVersion = scheduled.thumbnailVersion;
  }
}

/**
 * Everything that happens because a stream went live. `followers` is how
 * many followers the go-live bell went to — the studio's coach says "We're
 * telling your N followers": 0 when nobody is told (a practice run, a
 * booking that opted out), settled at once; otherwise the lookup, which
 * resolves to the count, 0 with no followers, or null when it failed.
 */
async function announceStart(
  stream: IStream,
  dbUser: IUser,
  { practice, fromSchedule }: { practice: boolean; fromSchedule: boolean },
): Promise<{ followers: number | Promise<number | null> }> {
  if (practice) {
    // A rehearsal: the live ring stays off, nobody is told, nothing is
    // posted — whatever the body said about followers or WorldSpace —
    // and the simulated audience files in.
    startPractice(stream);
    return { followers: 0 };
  }
  dbUser.isLive = true;
  await dbUser.save();
  // Every client hears it at once (xtream-events.ts), WorldSpace post or not.
  xtreamStreamStarted(stream, dbUser);

  // Only when the broadcaster asked for it — see postToWorldSpace.
  if (stream.postToWorldSpace) void relayLiveEvent("started", stream);

  // In-app bell for our own users; the socials relay handles that
  // platform's feed separately.
  const followers = stream.notifyFollowers !== false ? notifyFollowersOfLive(stream, dbUser) : 0;
  if (fromSchedule) void notifyRemindersOfLive(stream, dbUser);
  return { followers };
}

/**
 * Get a stream ready behind the studio's 3·2·1 (stream-prepare.ts): its
 * room and a publisher token, nothing else. It isn't a Stream yet — so it
 * can't be listed, counted or found — nobody is told, and an encoder isn't
 * re-pointed until the commit. A booking is checked now, so a stale one
 * fails at the tap rather than at "1".
 */
async function prepareStream(dbUser: IUser, requestBody: CreateStreamBody) {
  const { scheduledStreamId, scene, ...body } = requestBody;
  delete body.prepare;
  const roomName = `stream-${dbUser._id}-${Date.now()}`;
  const fields = freshStreamFields(dbUser, body, scene, roomName);
  const booking = scheduledStreamId && !fields.practice ? await findBooking(dbUser, scheduledStreamId) : null;
  if (booking) keepBookingDetails(booking, fields, body);

  const livekitToken = await hostToken(roomName, dbUser);

  // One per host: an earlier one — a count called off, then tapped again
  // before its cancel landed — goes, and so does its room.
  const earlier = await PreparedStream.find({ streamerId: dbUser._id }).select("_id livekitRoomName").lean();
  for (const row of earlier) {
    await PreparedStream.deleteOne({ _id: row._id });
    void closeRoom(row.livekitRoomName).catch(() => {});
  }

  // The id the stream will have: a booking keeps its own.
  const id = booking ? (booking._id as mongoose.Types.ObjectId) : new mongoose.Types.ObjectId();
  const expiresAt = new Date(Date.now() + PREPARED_STREAM_TTL_MS);
  await PreparedStream.create({
    _id: id,
    streamerId: dbUser._id,
    livekitRoomName: roomName,
    fields,
    scheduledStreamId: booking ? id : null,
    expiresAt,
  });

  return {
    success: true,
    message: "Stream prepared",
    data: {
      stream: {
        id,
        title: fields.title,
        category: fields.category,
        source: fields.source,
        livekitRoomName: roomName,
        startedAt: null,
        practice: fields.practice,
        prepared: true,
        expiresAt,
      },
      livekitToken,
      livekitUrl: config.LIVEKIT_URL,
    },
  };
}

/** The commit's answer: the one-shot start's, less the token the prepare already gave. */
function goAnswer(stream: IStream, ingress: { url: string; streamKey: string } | null, followersTold?: number) {
  const practice = stream.practice === true;
  return {
    success: true,
    message: practice ? "Practice run started" : "Stream started",
    data: {
      stream: {
        id: stream._id,
        title: stream.title,
        category: stream.category,
        source: stream.source,
        livekitRoomName: stream.livekitRoomName,
        startedAt: stream.startedAt,
        practice,
      },
      ...(followersTold !== undefined ? { followersTold } : {}),
      // OBS connection details — shown once to the broadcaster.
      ...(ingress ? { ingress: { url: ingress.url, streamKey: ingress.streamKey } } : {}),
    },
  };
}

export const streamRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/streams",
    {
      schema: {
        tags: ["Streams"],
        summary: "List streams",
        querystring: listStreamsQuerySchema,
      },
    },
    async (request) => {
      const {
        live,
        status,
        category,
        search,
        streamer,
        tag,
        sort,
        limit,
        page,
      } = request.query;
      const skip = (page - 1) * limit;
      // What a platform admin took down after a report stays out of every
      // list — and so does a practice run, which is live but private
      // ($ne, so streams from before the field existed still list).
      const filter: Record<string, unknown> = { takenDownAt: null, practice: { $ne: true } };

      if (live !== undefined) filter.isLive = live === "true";
      if (status) {
        filter.status = status;
        if (status === "upcoming") {
          // A scheduled stream whose time passed without going live is a
          // stale promise, not an upcoming broadcast.
          filter.scheduledStartAt = { $gte: new Date(Date.now() - 60 * 60_000) };
        }
      }
      if (category && category !== "All") filter.category = category;
      if (search) {
        filter.title = { $regex: escapeRegex(search), $options: "i" };
      }
      if (tag) {
        filter.tags = tag;
        // A tag is a discovery axis and therefore a targeting axis. A
        // streamer who keeps a tag for their own community but opted out of
        // being found by it stays out of tag-filtered results.
        const optedOut = await User.find({ "settings.discoverableByTag": false })
          .select("_id")
          .lean();
        if (optedOut.length > 0) {
          filter.streamerId = { $nin: optedOut.map((u) => u._id) };
        }
      }
      if (streamer) {
        const host = await User.findOne({ username: streamer })
          .select("_id")
          .lean();
        // An unknown username is an empty channel, not every stream on the
        // platform — without this the filter would silently be dropped.
        if (!host) {
          return {
            success: true,
            data: {
              streams: [],
              pagination: { page, limit, total: 0, pages: 0 },
            },
          };
        }
        filter.streamerId = host._id;
      }

      let sortObject: Record<string, 1 | -1> = { viewers: -1 };
      if (sort === "viewers_asc") sortObject = { viewers: 1, startedAt: -1 };
      if (sort === "recent") sortObject = { startedAt: -1 };
      // Growth, not level: velocity is written by the sweep from the count
      // ten minutes ago, so a small stream climbing fast outranks a large
      // one sitting flat — the thing the old viewers-then-startedAt sort
      // (a popularity sort with a tiebreak that never fired) could not do.
      if (sort === "trending") sortObject = { velocity: -1, viewers: -1 };
      if (status === "upcoming" && sort === "viewers") {
        sortObject = { scheduledStartAt: 1 };
      }

      const [streams, total] = await Promise.all([
        Stream.find(filter)
          .sort(sortObject)
          .skip(skip)
          .limit(limit)
          // The thumbnail blob stays out of this response. Explore re-polls
          // this endpoint every 15s purely to refresh viewer counts, and
          // inlined base64 made each poll a multi-megabyte transfer of bytes
          // that hadn't changed and couldn't be cached. Clients load
          // `thumbnailUrl` instead, which is versioned and cacheable forever.
          .select("-thumbnail")
          .populate("streamerId", "username displayName avatar isLive verified")
          .lean(),
        Stream.countDocuments(filter),
      ]);

      const staleIds = await reconcileLeanStreams(streams);
      const visible =
        live === "true" && staleIds.size > 0
          ? streams.filter((stream) => !staleIds.has(String(stream._id)))
          : streams.map((stream) =>
              staleIds.has(String(stream._id))
                ? { ...stream, isLive: false }
                : stream,
            );
      const adjustedTotal =
        live === "true" ? Math.max(0, total - staleIds.size) : total;

      const withThumbnails = visible.map((stream) => ({
        ...stream,
        thumbnailUrl: thumbnailUrlFor(stream),
      }));

      return {
        success: true,
        data: {
          streams: withThumbnails,
          pagination: {
            page,
            limit,
            total: adjustedTotal,
            pages: Math.ceil(adjustedTotal / limit),
          },
        },
      };
    },
  );

  app.get(
    "/streams/categories",
    {
      schema: {
        tags: ["Streams"],
        summary: "Categories with live streams right now, busiest first",
      },
    },
    async () => {
      // Drives Explore's dynamic filter row: the chips are whatever people
      // are actually streaming, not a hardcoded list. Category is a free
      // string (the socials taxonomy has ~100 of them), so enumerating the
      // live set is the only honest way to build the row.
      // Ranked by audience, not by how many streams: ten three-viewer
      // streams should not outrank one with thirty thousand. The busiest
      // stream in each category supplies the card art.
      const rows = await Stream.aggregate<{
        _id: string;
        live: number;
        viewers: number;
        coverId: unknown;
        coverVersion: number;
      }>([
        { $match: { isLive: true, practice: { $ne: true } } },
        { $sort: { viewers: -1 } },
        {
          $group: {
            _id: "$category",
            live: { $sum: 1 },
            viewers: { $sum: "$viewers" },
            coverId: { $first: "$_id" },
            coverVersion: { $first: "$thumbnailVersion" },
          },
        },
        { $sort: { viewers: -1, _id: 1 } },
        { $limit: 30 },
      ]);

      return {
        success: true,
        data: {
          categories: rows.map((r) => ({
            category: r._id,
            live: r.live,
            viewers: r.viewers,
            cover: thumbnailUrlFor({
              _id: r.coverId,
              thumbnailVersion: r.coverVersion,
            }),
          })),
        },
      };
    },
  );

  app.post(
    "/streams",
    {
      schema: {
        tags: ["Streams"],
        summary: "Start a stream and receive a publisher token — or, with prepare: true, only get it ready",
        security: [{ bearerAuth: [] }],
        body: createStreamBodySchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      // The studio's 3·2·1: ready now, live on commit (stream-prepare.ts).
      if (request.body.prepare === true) return prepareStream(dbUser, request.body);

      const existing = await Stream.findOne({
        streamerId: dbUser._id,
        isLive: true,
      });
      if (existing) await markStreamEnded(existing);

      const roomName = `stream-${dbUser._id}-${Date.now()}`;

      // OBS path: mint an RTMP ingress instead of expecting a browser
      // publisher. The encoder's push joins the room as the broadcaster.
      const ingress = request.body.source === "obs" ? await pointIngress(dbUser, roomName) : null;

      const livekitToken = await hostToken(roomName, dbUser);

      const { scheduledStreamId, scene, ...body } = request.body;
      delete body.prepare;
      const fields = {
        ...freshStreamFields(dbUser, body, scene, roomName),
        ...liveSwitch(),
        ...(ingress ? { ingressId: ingress.ingressId } : {}),
      };
      const practice = fields.practice;

      // Starting a scheduled stream keeps its document: the upcoming card,
      // its URL and the reminders people set on it all become this live
      // broadcast instead of pointing at an orphan. A practice run never
      // starts a booking, though: the rehearsal is its own private
      // document, and the scheduled card stays up for the real broadcast.
      let stream: IStream;
      let fromSchedule = false;
      if (scheduledStreamId && !practice) {
        const scheduled = await findBooking(dbUser, scheduledStreamId);
        keepBookingDetails(scheduled, fields, body);
        Object.assign(scheduled, fields);
        await scheduled.save();
        stream = scheduled;
        fromSchedule = true;
      } else {
        stream = await Stream.create({ streamerId: dbUser._id, ...fields });
      }

      /**
       * How many followers the go-live bell went to: the studio's coach says
       * "We're telling your N followers". 0 when nobody is told (a practice
       * run, a booking that opted out, no followers); null when the lookup
       * failed.
       */
      const { followers } = await announceStart(stream, dbUser, { practice, fromSchedule });
      const followersTold = await followers;

      return {
        success: true,
        message: practice ? "Practice run started" : "Stream started",
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            category: stream.category,
            source: stream.source,
            livekitRoomName: roomName,
            startedAt: stream.startedAt,
            practice,
          },
          livekitToken,
          livekitUrl: config.LIVEKIT_URL,
          followersTold,
          // OBS connection details — shown once to the broadcaster.
          ...(ingress
            ? { ingress: { url: ingress.url, streamKey: ingress.streamKey } }
            : {}),
        },
      };
    },
  );

  /**
   * Commit a prepared stream: it goes live now. What the one-shot start does
   * after its token — end any stream still live, point the encoder, write
   * the stream, light the ring, tell every client, relay, ring the bell —
   * except the bell's count, which is not waited for: it reaches the host
   * afterwards as `{ __evt: "followers_told", streamId, followersTold }`
   * on the room, sent to the host alone.
   *
   * Asked again for a stream it already started (the answer was lost),
   * it answers the same way instead of failing.
   */
  app.post(
    "/streams/:id/go",
    {
      schema: {
        tags: ["Streams"],
        summary: "Commit a prepared stream: it goes live now",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const id = request.params.id;
      const now = Date.now();

      // Claimed by deleting it: two commits can't both start it.
      const prepared = await PreparedStream.findOne({ _id: id, streamerId: dbUser._id });
      const claimed = prepared ? (await PreparedStream.deleteOne({ _id: prepared._id })).deletedCount === 1 : false;
      if (!prepared || !claimed || new Date(prepared.expiresAt).getTime() <= now) {
        const started = await Stream.findOne({ _id: id, streamerId: dbUser._id, isLive: true });
        if (started) {
          const obs = started.source === "obs" && dbUser.obsIngress ? { url: dbUser.obsIngress.url, streamKey: dbUser.obsIngress.streamKey } : null;
          return goAnswer(started, obs);
        }
        throw new ApiError(404, "That start expired — tap Go live again", "PREPARED_NOT_FOUND");
      }

      const existing = await Stream.findOne({ streamerId: dbUser._id, isLive: true });
      if (existing) await markStreamEnded(existing);

      const roomName = prepared.livekitRoomName;
      const fields = { ...(prepared.fields as StreamFields) };
      const ingress = fields.source === "obs" ? await pointIngress(dbUser, roomName) : null;
      Object.assign(fields, liveSwitch(), ingress ? { ingressId: ingress.ingressId } : {});
      const practice = fields.practice === true;

      let stream: IStream;
      let fromSchedule = false;
      if (prepared.scheduledStreamId && !practice) {
        const scheduled = await findBooking(dbUser, prepared.scheduledStreamId);
        Object.assign(scheduled, fields);
        await scheduled.save();
        stream = scheduled;
        fromSchedule = true;
      } else {
        stream = await Stream.create({ _id: prepared._id, streamerId: dbUser._id, ...fields });
      }

      const { followers } = await announceStart(stream, dbUser, { practice, fromSchedule });
      // Settled already (nobody's told): in the answer. Otherwise it follows on the room.
      if (typeof followers === "number") return goAnswer(stream, ingress, followers);
      const streamId = String(stream._id);
      void followers
        .then((followersTold) =>
          sendRoomDataTo(roomName, [dbUser._id.toString()], { __evt: "followers_told", streamId, followersTold }),
        )
        .catch((error) => console.error("followers told failed:", error));
      return goAnswer(stream, ingress);
    },
  );

  /**
   * Throw a prepared stream away — Go live's count was called off. Nothing
   * was announced, so there's nothing to take back; the room is closed.
   * Harmless to repeat, and it never touches a stream that already went
   * live.
   */
  app.delete(
    "/streams/:id/prepare",
    {
      schema: {
        tags: ["Streams"],
        summary: "Cancel a prepared stream",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const prepared = await PreparedStream.findOne({ _id: request.params.id, streamerId: dbUser._id })
        .select("_id livekitRoomName")
        .lean();
      const cancelled = prepared
        ? (await PreparedStream.deleteOne({ _id: prepared._id, streamerId: dbUser._id })).deletedCount === 1
        : false;
      if (prepared && cancelled) void closeRoom(prepared.livekitRoomName).catch(() => {});
      return { success: true, data: { cancelled } };
    },
  );

  app.get(
    "/streams/active/mine",
    {
      schema: {
        tags: ["Streams"],
        summary:
          "The caller's currently-live stream, if any (null when not live)",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findOne({
        streamerId: dbUser._id,
        isLive: true,
      });

      // Reconcile before answering: a stream orphaned by a studio refresh or
      // a crashed tab stays flagged live in Mongo until something checks
      // LiveKit. Without this the studio would offer to "resume" a room that
      // no longer exists.
      if (!stream || !(await reconcileStream(stream))) {
        return { success: true, data: { stream: null } };
      }

      return {
        success: true,
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            category: stream.category,
            startedAt: stream.startedAt,
            viewers: stream.viewers,
            peakViewers: stream.peakViewers,
            livekitRoomName: stream.livekitRoomName,
            source: stream.source ?? "camera",
            feedDroppedAt: stream.feedDroppedAt ?? null,
            // So a reloaded studio knows it's back in a rehearsal.
            practice: stream.practice === true,
          },
          graceMs: config.OBS_RECONNECT_GRACE_MS,
        },
      };
    },
  );

  /**
   * A fresh host token into a stream that is still live — how the studio
   * gets back on air after a drop, and how a host carries a live stream
   * over to another device.
   *
   * OBS: the encoder is the publisher, so a closed studio tab never ended
   * anything; the token just brings back chat, guests and gifts. Browser
   * streams: the stream holds through the reconnect grace window after its
   * camera drops (see holdForReconnect), and the studio republishes with
   * this token — automatically after a network drop, or from the "Resume"
   * banner after a reload. Joining from a second device under the same
   * identity makes LiveKit close the first session, which is the handover.
   */
  app.post(
    "/streams/:id/resume",
    {
      schema: {
        tags: ["Streams"],
        summary: "A fresh host token for the caller's live stream",
        params: streamIdParamsSchema,
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findOne({
        _id: request.params.id,
        streamerId: dbUser._id,
        isLive: true,
      });
      if (!stream || !(await reconcileStream(stream))) {
        throw new ApiError(404, "That stream is no longer live", "STREAM_NOT_FOUND");
      }
      const livekitToken = await createToken(
        stream.livekitRoomName,
        dbUser._id.toString(),
        dbUser.displayName,
        { canPublish: true, canSubscribe: true, canPublishData: true, roomCreate: true },
      );
      return {
        success: true,
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            category: stream.category,
            startedAt: stream.startedAt,
            source: stream.source ?? "camera",
            feedDroppedAt: stream.feedDroppedAt ?? null,
            practice: stream.practice === true,
          },
          livekitToken,
          livekitUrl: config.LIVEKIT_URL,
          graceMs: config.OBS_RECONNECT_GRACE_MS,
          ...(stream.source === "obs" && dbUser.obsIngress
            ? { ingress: { url: dbUser.obsIngress.url, streamKey: dbUser.obsIngress.streamKey } }
            : {}),
        },
      };
    },
  );

  /**
   * Set the program's scene — the layout, and any card over it. The host's
   * call, while live. The version only goes up, and the scene reaches the
   * room twice: as room metadata, which a viewer joining later reads on
   * connect, and as a data event (`__evt: scene`), which everyone already
   * in — WorldSpace clients included — hears at once.
   */
  app.put(
    "/streams/:id/scene",
    {
      schema: {
        tags: ["Streams"],
        summary: "Set the live scene: layout and card",
        params: streamIdParamsSchema,
        body: sceneBodySchema,
        security: [{ bearerAuth: [] }],
      },
      config: {
        rateLimit: { max: 60, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);
      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      // The host, or a producer running the show from their console.
      await requireChannelRole(stream, dbUser._id, "producer");
      if (!stream.isLive) {
        throw new ApiError(409, "Go live first", "NOT_LIVE");
      }
      // Written only if nobody changed the scene in between (scene-put.ts):
      // a show rule's banner can't be lost under a host's tap that read the
      // scene a moment earlier. The featured line stays the feature routes'.
      const scene = await putScene(stream._id, request.body);
      return { success: true, data: { scene } };
    },
  );

  app.get(
    "/streams/:id",
    {
      schema: {
        tags: ["Streams"],
        summary: "Get stream details",
        params: streamIdParamsSchema,
        querystring: z.object({
          /** A practice run's preview key (preview.ts): the one way in for anyone but the crew. */
          previewKey: z.string().max(128).optional(),
        }),
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (stream.takenDownAt) {
        throw new ApiError(410, "This stream was removed for breaking the community rules", "TAKEN_DOWN");
      }

      // A practice run is the host's and their producers' alone. Everyone
      // else — signed out, a stranger, a moderator, a bad token — gets the
      // 404 a stream that doesn't exist would, so the id never confirms a
      // rehearsal is on.
      // Holding its preview link opens it too — the same 404 otherwise.
      if (stream.practice) {
        const viewer = getOptionalAuthUserId(request) ? await authenticate(request).catch(() => null) : null;
        const streamer = viewer ? await User.findById(stream.streamerId).select("safety").lean() : null;
        const crew = Boolean(viewer && streamer && atLeast(roleIn(streamer, viewer.dbUser._id), "producer"));
        if (!crew && !(await previewAccess(stream._id, request.query.previewKey))) {
          throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
        }
      }

      // The list route and the token route both reconcile; this one didn't,
      // so a direct link to a stream whose broadcaster had silently dropped
      // returned isLive: true. The page then rendered a LIVE badge and a
      // running timer over a player that could never connect, because the
      // token request it fires next *does* reconcile and rejects with 400.
      await reconcileStream(stream);

      await stream.populate(
        "streamerId",
        // The brand kit rides along (not the logo's bytes — its version,
        // which builds the logo's URL) so graphics draw in the right accent.
        // …and whether its request line is open, so Join only shows when it is.
        "username displayName avatar bio followers isLive verified brand.accent brand.lowerThird brand.font brand.logoVersion brand.set settings.stageRequests",
      );

      return { success: true, data: { stream: stream.toJSON() } };
    },
  );

  app.patch(
    "/streams/:id",
    {
      schema: {
        tags: ["Streams"],
        summary: "Update a stream",
        security: [{ bearerAuth: [] }],
        params: streamIdParamsSchema,
        body: updateStreamBodySchema,
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }
      if (!stream.streamerId.equals(dbUser._id)) {
        throw new ApiError(403, "Not authorized", "FORBIDDEN");
      }

      const patch = { ...request.body };
      // Clearing the title names the stream after its host (and category) again.
      if (patch.title !== undefined && !patch.title) {
        patch.title = defaultStreamTitle(dbUser, patch.category ?? stream.category);
      }
      const detailsChanged =
        (patch.title !== undefined && patch.title !== stream.title) ||
        (patch.category !== undefined && patch.category !== stream.category);
      const fxChanged = patch.appearanceFx !== undefined && patch.appearanceFx !== Boolean(stream.appearanceFx);

      // Bump the version only on an actual image change, so cached copies
      // survive ordinary title/category edits.
      if (
        patch.thumbnail !== undefined &&
        patch.thumbnail !== stream.thumbnail
      ) {
        stream.thumbnailVersion = patch.thumbnail ? Date.now() : 0;
      }
      Object.assign(stream, patch);
      await stream.save();

      // Renamed mid-broadcast: everyone watching sees the new title and
      // category at once. The API is the room's one voice for this.
      if (detailsChanged && stream.isLive) {
        void sendRoomData(stream.livekitRoomName, {
          __evt: "details",
          title: stream.title,
          category: stream.category,
        });
        xtreamStreamUpdated(stream);
      }
      // Smoothing went on or off: the "Effects on" tag follows on every screen.
      if (fxChanged && stream.isLive) {
        void sendRoomData(stream.livekitRoomName, { __evt: "fx", appearanceFx: Boolean(stream.appearanceFx) });
      }

      return {
        success: true,
        message: "Stream updated",
        data: {
          stream: { ...stream.toJSON(), thumbnailUrl: thumbnailUrlFor(stream) },
        },
      };
    },
  );
};
