import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from "node:http";
import type mongoose from "mongoose";
import { ApiError } from "./errors.js";
import { Stream } from "./models.js";

/**
 * The control API's live event feed (Phase 3): what the API tells a live
 * room — a scene change, a rule firing, a gift, a guest coming up — mirrored
 * in-process for whoever holds a control key and is listening on
 * GET /control/events. livekit.ts hands every room payload here on its way
 * out, before LiveKit sees it, so LiveKit being down never stops the feed;
 * and nothing here throws back into the sender.
 *
 * Chat isn't in it: a chat line is a room payload without an event name.
 * A gift is the one chat line that gets one — it reaches the room as a tip
 * line, and a button that fires on gifts is half the point of a feed.
 */

type Listener = (event: string, data: Record<string, unknown>) => void;

/** Who's listening to each room, by LiveKit room name. */
const rooms = new Map<string, Set<Listener>>();

/** A room payload as a named event, or null for one that isn't (a chat line). */
export function feedEvent(data: Record<string, unknown>): { event: string; data: Record<string, unknown> } | null {
  const { __evt, ...rest } = data;
  if (typeof __evt === "string" && __evt) return { event: __evt, data: rest };
  if (data.type === "tip") return { event: "gift", data };
  return null;
}

/** Hand a room's payload to whoever is listening. Never throws. */
export function publishFeed(roomName: string, data: Record<string, unknown>) {
  const listeners = rooms.get(roomName);
  if (!listeners) return;
  const named = feedEvent(data);
  if (!named) return;
  for (const listen of listeners) {
    try {
      listen(named.event, named.data);
    } catch {
      // A listener's trouble is its own.
    }
  }
}

/** Listen to a room's events; what comes back stops it. */
export function subscribeFeed(roomName: string, listen: Listener) {
  let listeners = rooms.get(roomName);
  if (!listeners) rooms.set(roomName, (listeners = new Set()));
  listeners.add(listen);
  return () => {
    listeners.delete(listen);
    if (listeners.size === 0) rooms.delete(roomName);
  };
}

/* ---- The feed as server-sent events, one connection at a time ---- */

/** The most feeds one channel's keys can hold open at once. */
export const MAX_FEED_LISTENERS = 8;
/** What a listener that has stopped reading may leave unread before events are dropped rather than queued. */
const MAX_UNREAD_BYTES = 256 * 1024;
/** How often a feed looks for the channel going live or ending, and how often it pings. */
export const FEED_TIMING = { pollMs: 5_000, pingMs: 15_000 };

/** Open feeds per channel. */
const open = new Map<string, number>();

export function feedListeners(ownerId: unknown) {
  return open.get(String(ownerId)) ?? 0;
}

/** One message on the wire: an id, a name, one line of JSON. */
function frame(id: number, event: string, data: unknown) {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** The channel's live stream as the feed announces it, and the room to listen to. */
async function liveStream(ownerId: mongoose.Types.ObjectId) {
  const stream = await Stream.findOne({ streamerId: ownerId, isLive: true }).select("title livekitRoomName").lean();
  return {
    room: stream?.livekitRoomName ?? null,
    notice: stream ? { live: true, streamId: String(stream._id), title: stream.title } : { live: false, streamId: null, title: null },
  };
}

/**
 * A feed for one connection: takes the channel's slot and reads what's on
 * now (both may refuse, before any header goes out), then `serve` takes the
 * connection over — the current `stream` state first, then the live room's
 * events as they happen, and `stream` again when the channel goes live or
 * ends while the client is connected. There's no room event for either
 * (the room simply opens, or closes), so a cheap poll watches for it —
 * and a new stream's new room is bound without the client reconnecting.
 */
export async function openControlFeed(ownerId: mongoose.Types.ObjectId, timing: Partial<typeof FEED_TIMING> = {}) {
  const owner = String(ownerId);
  const count = open.get(owner) ?? 0;
  if (count >= MAX_FEED_LISTENERS) {
    throw new ApiError(409, `That's the most feeds a channel can have open (${MAX_FEED_LISTENERS}) — close one first`, "TOO_MANY_LISTENERS");
  }
  const first = await liveStream(ownerId);
  open.set(owner, count + 1);
  const { pollMs, pingMs } = { ...FEED_TIMING, ...timing };

  return {
    serve(req: IncomingMessage, res: ServerResponse, headers: Record<string, string | number | string[] | undefined> = {}) {
      res.writeHead(200, {
        ...headers,
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      } as OutgoingHttpHeaders);
      res.write("retry: 3000\n\n");

      let id = 0;
      let dropped = 0;
      const send = (event: string, data: unknown) => {
        if (res.destroyed || res.writableEnded) return;
        // A listener that isn't reading gets fewer events, not a longer queue — and is told.
        if (res.writableLength > MAX_UNREAD_BYTES) {
          dropped++;
          return;
        }
        if (dropped > 0) {
          res.write(frame(++id, "dropped", { count: dropped }));
          dropped = 0;
        }
        res.write(frame(++id, event, data));
      };

      let room = first.room;
      let leave = room ? subscribeFeed(room, send) : null;
      send("stream", first.notice);
      const look = async () => {
        const now = await liveStream(ownerId);
        if (now.room === room) return;
        leave?.();
        room = now.room;
        leave = room ? subscribeFeed(room, send) : null;
        send("stream", now.notice);
      };
      const poll = setInterval(() => void look().catch(() => {}), pollMs);
      const ping = setInterval(() => {
        if (!res.destroyed && !res.writableEnded) res.write(": ping\n\n");
      }, pingMs);

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(ping);
        leave?.();
        leave = null;
        const left = (open.get(owner) ?? 1) - 1;
        if (left > 0) open.set(owner, left);
        else open.delete(owner);
        if (!res.writableEnded) res.end();
      };
      req.on("close", close);
      res.on("close", close);
    },
  };
}
