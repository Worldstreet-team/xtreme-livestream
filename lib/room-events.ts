"use client";

import { useEffect, useRef } from "react";
import type { Room } from "livekit-client";

/**
 * The API's room events, for a component that holds the room: the battle
 * stage's gifts, the studio's battle and games panels. The room is where a
 * live stream's state is pushed from the server, so anything that sits in
 * one listens here instead of polling.
 *
 * Only server-sent packets count (no participant): viewers and guests have
 * no data-publish rights, and a packet from anyone in the room is ignored
 * whatever it claims to be (the room data trust rule). Binary packets (the
 * host's face anchors) and anything that isn't a JSON object with an
 * `__evt` are skipped.
 *
 * `onResync` runs when the room comes back after a drop, and once when
 * the listener is attached: whatever was said while it wasn't listening
 * was missed, so the caller looks once.
 *
 * The latest handlers are always the ones called, so they needn't be
 * memoised; a new listener is attached only when the room or the event
 * list changes.
 */
export function useServerRoomEvents(
  room: Room | null | undefined,
  events: readonly string[],
  onEvent: (evt: string, data: Record<string, unknown>) => void,
  onResync?: () => void,
) {
  const handlers = useRef({ onEvent, onResync });
  useEffect(() => {
    handlers.current = { onEvent, onResync };
  });
  const key = events.join(",");

  useEffect(() => {
    if (!room) return;
    const wanted = new Set(key.split(","));
    let off: (() => void) | undefined;
    let cancelled = false;
    void import("livekit-client").then(({ RoomEvent }) => {
      if (cancelled) return;
      const onData = (payload: Uint8Array, participant?: unknown) => {
        const data = readServerEvent(payload, participant);
        if (data && wanted.has(data.__evt)) handlers.current.onEvent(data.__evt, data);
      };
      const onBack = () => handlers.current.onResync?.();
      room.on(RoomEvent.DataReceived, onData);
      room.on(RoomEvent.Reconnected, onBack);
      off = () => {
        room.off(RoomEvent.DataReceived, onData);
        room.off(RoomEvent.Reconnected, onBack);
      };
      onBack();
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [room, key]);
}

/** A server-sent room event, parsed — or null for anything a participant sent, or that isn't one. */
export function readServerEvent(payload: Uint8Array, participant?: unknown): (Record<string, unknown> & { __evt: string }) | null {
  if (participant) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(payload)) as unknown;
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const evt = (data as { __evt?: unknown }).__evt;
    return typeof evt === "string" && evt ? (data as Record<string, unknown> & { __evt: string }) : null;
  } catch {
    return null;
  }
}
