import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createStreamBodySchema,
  listStreamsQuerySchema,
  streamIdParamsSchema,
  updateStreamBodySchema,
} from "@xtreme/contracts";
import { authenticate } from "../auth.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { ensureUserIngress,
  createToken } from "../livekit.js";
import { Stream, User, type IStream } from "../models.js";
import { relayLiveEvent } from "../socials-relay.js";
import {
  notifyFollowersOfLive,
  notifyRemindersOfLive,
} from "../notifications.js";
import {
  markStreamEnded,
  reconcileLeanStreams,
  reconcileStream,
  thumbnailUrlFor,
} from "../stream-service.js";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
      const filter: Record<string, unknown> = {};

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
        { $match: { isLive: true } },
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
        summary: "Start a stream and receive a publisher token",
        security: [{ bearerAuth: [] }],
        body: createStreamBodySchema,
      },
      config: {
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (request) => {
      const { dbUser } = await authenticate(request);

      const existing = await Stream.findOne({
        streamerId: dbUser._id,
        isLive: true,
      });
      if (existing) await markStreamEnded(existing);

      const roomName = `stream-${dbUser._id}-${Date.now()}`;

      // OBS path: mint an RTMP ingress instead of expecting a browser
      // publisher. The encoder's push joins the room as the broadcaster.
      let ingress: {
        ingressId: string;
        url: string;
        streamKey: string;
      } | null = null;
      if (request.body.source === "obs") {
        // The account's persistent ingress, re-pointed at this room. The
        // encoder joins under its own identity: if it shared the browser's,
        // opening the studio dashboard (same user id) would make LiveKit
        // kick the ingress — killing the feed the moment the streamer looked
        // at their own stream.
        ingress = await ensureUserIngress(dbUser, roomName);
      }

      const livekitToken = await createToken(
        roomName,
        dbUser._id.toString(),
        dbUser.displayName,
        {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          roomCreate: true,
        },
      );

      const { scheduledStreamId, ...body } = request.body;
      const fields = {
        ...body,
        // Stamps the version the thumbnail URL is cache-busted on.
        thumbnailVersion: body.thumbnail ? Date.now() : 0,
        livekitRoomName: roomName,
        status: "live" as const,
        isLive: true,
        startedAt: new Date(),
        endedAt: null,
        ...(ingress ? { ingressId: ingress.ingressId } : {}),
      };

      // Starting a scheduled stream keeps its document: the upcoming card,
      // its URL and the reminders people set on it all become this live
      // broadcast instead of pointing at an orphan.
      let stream: IStream;
      let fromSchedule = false;
      if (scheduledStreamId) {
        const scheduled = await Stream.findOne({
          _id: scheduledStreamId,
          streamerId: dbUser._id,
          status: "upcoming",
        });
        if (!scheduled) {
          throw new ApiError(
            404,
            "Scheduled stream not found",
            "STREAM_NOT_FOUND",
          );
        }
        // No new thumbnail on go-live means keep the one it was scheduled with.
        if (!body.thumbnail && scheduled.thumbnail) {
          fields.thumbnail = scheduled.thumbnail;
          fields.thumbnailVersion = scheduled.thumbnailVersion;
        }
        Object.assign(scheduled, fields);
        await scheduled.save();
        stream = scheduled;
        fromSchedule = true;
      } else {
        stream = await Stream.create({ streamerId: dbUser._id, ...fields });
      }

      dbUser.isLive = true;
      await dbUser.save();

      void relayLiveEvent("started", stream);

      // In-app bell for our own users; the socials relay handles that
      // platform's feed separately.
      if (stream.notifyFollowers !== false) {
        void notifyFollowersOfLive(stream, dbUser);
      }
      if (fromSchedule) void notifyRemindersOfLive(stream, dbUser);

      return {
        success: true,
        message: "Stream started",
        data: {
          stream: {
            id: stream._id,
            title: stream.title,
            category: stream.category,
            source: stream.source,
            livekitRoomName: roomName,
            startedAt: stream.startedAt,
          },
          livekitToken,
          livekitUrl: config.LIVEKIT_URL,
          // OBS connection details — shown once to the broadcaster.
          ...(ingress
            ? { ingress: { url: ingress.url, streamKey: ingress.streamKey } }
            : {}),
        },
      };
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
          },
        },
      };
    },
  );

  /**
   * Reopen the studio on an OBS stream that is still live. The encoder is
   * the publisher, so a closed or crashed studio tab never ended anything;
   * the host just needs a fresh token into the same room to see chat,
   * guests and tips again. Browser-fed streams can't be resumed — their
   * tracks died with the tab.
   */
  app.post(
    "/streams/:id/resume",
    {
      schema: {
        tags: ["Streams"],
        summary: "A fresh host token for the caller's live OBS stream",
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
      if (stream.source !== "obs") {
        throw new ApiError(
          409,
          "Only encoder-fed streams can be reopened — the browser was this stream's camera",
          "NOT_RESUMABLE",
        );
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
            feedDroppedAt: stream.feedDroppedAt ?? null,
          },
          livekitToken,
          livekitUrl: config.LIVEKIT_URL,
          ...(dbUser.obsIngress
            ? { ingress: { url: dbUser.obsIngress.url, streamKey: dbUser.obsIngress.streamKey } }
            : {}),
        },
      };
    },
  );

  app.get(
    "/streams/:id",
    {
      schema: {
        tags: ["Streams"],
        summary: "Get stream details",
        params: streamIdParamsSchema,
      },
    },
    async (request) => {
      const stream = await Stream.findById(request.params.id);

      if (!stream) {
        throw new ApiError(404, "Stream not found", "STREAM_NOT_FOUND");
      }

      // The list route and the token route both reconcile; this one didn't,
      // so a direct link to a stream whose broadcaster had silently dropped
      // returned isLive: true. The page then rendered a LIVE badge and a
      // running timer over a player that could never connect, because the
      // token request it fires next *does* reconcile and rejects with 400.
      await reconcileStream(stream);

      await stream.populate(
        "streamerId",
        "username displayName avatar bio followers isLive verified",
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

      // Bump the version only on an actual image change, so cached copies
      // survive ordinary title/category edits.
      if (
        request.body.thumbnail !== undefined &&
        request.body.thumbnail !== stream.thumbnail
      ) {
        stream.thumbnailVersion = request.body.thumbnail ? Date.now() : 0;
      }
      Object.assign(stream, request.body);
      await stream.save();

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
