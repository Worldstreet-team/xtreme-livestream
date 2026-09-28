"use client";

import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";
import { apiFetch, ApiError } from "@/lib/api-client";

/**
 * Keeps the studio's "live on another device" card true, live (the owner,
 * 2026-09-28: "this should use a socket to know when it ends").
 *
 * While the card is up, the studio listens on the stream's own LiveKit room
 * as the host's monitor (`?monitor=1`: `mon-<id>`, subscribe-only, never
 * counted, and never the broadcaster's identity, so the device on the air
 * stays on it). It subscribes to nothing; it only hears the room:
 *
 *  - the room closing (the server deletes it when the stream ends) → `ended`
 *  - the server's feed events (`__evt: "feed"`, sent with no participant —
 *    room data trust: a participant's packet never counts) → `feed`
 *  - a token refused because the stream is already off → `ended`
 *
 * Anything else (this device's network, the host's own monitor opened
 * elsewhere) falls back to asking the API once, through `recheck`.
 */
export function useOrphanWatch(
  streamId: string | null,
  on: {
    ended: () => void;
    feed: (state: "reconnecting" | "live", graceMs?: number) => void;
    recheck: () => void;
  },
) {
  const handlers = useRef(on);
  useEffect(() => {
    handlers.current = on;
  });

  useEffect(() => {
    if (!streamId) return;
    let room: Room | null = null;
    let gone = false;

    (async () => {
      let token: { token: string; livekitUrl: string };
      try {
        const res = await apiFetch<{ success: boolean; data: { token: string; livekitUrl: string } }>(
          `/api/streams/${streamId}/token?monitor=1`,
        );
        token = res.data;
      } catch (err) {
        if (gone) return;
        // 400 STREAM_OFFLINE / 404: it's already over.
        if (err instanceof ApiError && (err.status === 400 || err.status === 404)) handlers.current.ended();
        return;
      }
      if (gone) return;

      const { Room: LKRoom, RoomEvent, DisconnectReason } = await import("livekit-client");
      if (gone) return;
      const r = new LKRoom();
      room = r;

      r.on(RoomEvent.DataReceived, (payload, participant) => {
        if (participant) return; // Only the server speaks for the stream.
        try {
          const evt = JSON.parse(new TextDecoder().decode(payload)) as { __evt?: string; state?: string; graceMs?: number };
          if (evt.__evt === "feed" && (evt.state === "reconnecting" || evt.state === "live")) {
            handlers.current.feed(evt.state, typeof evt.graceMs === "number" ? evt.graceMs : undefined);
          }
        } catch {
          // Not an event.
        }
      });
      r.on(RoomEvent.Disconnected, (reason) => {
        if (gone || reason === DisconnectReason.CLIENT_INITIATED) return;
        if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
          handlers.current.ended();
          return;
        }
        handlers.current.recheck();
      });

      try {
        await r.connect(token.livekitUrl, token.token, { autoSubscribe: false });
      } catch {
        if (!gone) handlers.current.recheck();
      }
      if (gone) void r.disconnect();
    })();

    return () => {
      gone = true;
      if (room) void room.disconnect();
    };
  }, [streamId]);
}
