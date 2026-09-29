"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/lib/auth-context";
import { getMessagingSession } from "@/lib/messaging";
import {
  createXtreamPushHub,
  pollPace,
  type AblyClientLike,
  type XtreamPush,
  type XtreamPushName,
} from "@/lib/xtream-push";

/**
 * Realtime pushes from the Xtream API on the web (see lib/xtream-push.ts
 * for what arrives where). They ride the Ably session messaging already
 * holds for a signed-in person — one socket for the tab — so a signed-out
 * visitor has none and every poll simply keeps its own pace.
 *
 *   const { pace, tick } = useXtreamPoll(30_000, 60_000, STREAM_EVENTS);
 *   useEffect(() => { load(); const t = setInterval(load, pace); … }, [pace, tick]);
 *
 * A public push reaches every open tab at once, so its refetch waits a
 * random beat (up to PUBLIC_JITTER_MS) and several in a row collapse into
 * one: the API isn't asked by everyone in the same instant.
 */

export type { XtreamPush, XtreamPushName } from "@/lib/xtream-push";

/** What live lists, rings and rails refetch on. */
export const STREAM_PUSHES = ["stream.started", "stream.ended", "stream.updated"] as const satisfies readonly XtreamPushName[];
export const BATTLE_PUSHES = ["battle.started", "battle.ended"] as const satisfies readonly XtreamPushName[];
export const LIVE_LIST_PUSHES = [...STREAM_PUSHES, ...BATTLE_PUSHES] as const;

/** Backstops once pushes arrive. Anything showing viewer counts or scores stays at a minute. */
export const BACKSTOP_VIEWERS_MS = 60_000;
export const BACKSTOP_QUIET_MS = 5 * 60_000;

const PUBLIC_JITTER_MS = 2_000;

const hub = createXtreamPushHub();
let starting = false;
let attached = false;

function ensureStarted() {
  if (starting || attached || typeof window === "undefined") return;
  starting = true;
  void getMessagingSession()
    .then(({ me, live }) => {
      hub.attach(live.client as unknown as AblyClientLike, me.id);
      attached = true;
    })
    .catch(() => {
      // Signed out, or the gateway is down: polls keep their pace; the next mount tries again.
    })
    .finally(() => {
      starting = false;
    });
}

/** Whether pushes are arriving in this tab right now. */
export function useXtreamPushLive(): boolean {
  const { user } = useAuth();
  useEffect(() => {
    if (user) ensureStarted();
  }, [user]);
  const live = useSyncExternalStore(hub.onPace, hub.live, () => false);
  return Boolean(user) && live;
}

/**
 * Call `onPush` when one of `names` arrives (or the connection comes back
 * after a gap). Personal pushes are handled at once; public ones after a
 * short random beat, collapsed. The latest `onPush` is always the one
 * called, so it needn't be memoised.
 */
export function useXtreamPush(names: readonly string[], onPush: (push: XtreamPush | null) => void) {
  const { user } = useAuth();
  const handler = useRef(onPush);
  useEffect(() => {
    handler.current = onPush;
  });
  const key = names.join(",");

  useEffect(() => {
    if (user) ensureStarted();
  }, [user]);

  useEffect(() => {
    const wanted = new Set(key.split(","));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = (push: XtreamPush | null) => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        handler.current(push);
      }, Math.random() * PUBLIC_JITTER_MS);
    };
    const stop = hub.listen((signal) => {
      if (signal === "resync") return later(null);
      if (!wanted.has(signal.name)) return;
      if (signal.personal) handler.current(signal);
      else later(signal);
    });
    return () => {
      stop();
      if (timer) clearTimeout(timer);
    };
  }, [key]);
}

/**
 * A poll's pace and a counter to refetch on. `pace` is `fastMs` (the poll's
 * own) until pushes arrive, then `backstopMs`; `tick` goes up on every
 * relevant push. Put both in the polling effect's deps — or pass `onPush`
 * where re-running the effect would show a spinner.
 */
export function useXtreamPoll(
  fastMs: number,
  backstopMs: number,
  names: readonly string[],
  onPush?: (push: XtreamPush | null) => void,
) {
  const live = useXtreamPushLive();
  const [tick, setTick] = useState(0);
  useXtreamPush(names, (push) => {
    if (onPush) onPush(push);
    else setTick((t) => t + 1);
  });
  return { pace: pollPace(fastMs, backstopMs, live), tick };
}

/**
 * A battle's gifts, pushed on its own channel (`xtream:battle:<id>`) while
 * `battleId` is set — for a clash view watching from outside the battle's
 * rooms. Subscribes on the Ably session messaging already holds, and lets
 * go (unsubscribe and detach) when the view closes, so only open views
 * cost anything. Returns whether it's listening, so the caller can slow its
 * own asking down. The latest `onGift` is always the one called.
 */
export function useXtreamBattleGifts(battleId: string | null, onGift: (data: unknown) => void): boolean {
  const { user } = useAuth();
  const handler = useRef(onGift);
  useEffect(() => {
    handler.current = onGift;
  });
  const [listening, setListening] = useState<string | null>(null);
  useEffect(() => {
    if (!user || !battleId) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void getMessagingSession()
      .then(({ live }) => {
        if (cancelled) return;
        const client = live.client as unknown as {
          channels: { get(name: string): { subscribe(name: string, fn: (m: { data?: unknown }) => void): unknown; unsubscribe(fn?: (m: { data?: unknown }) => void): void; detach?(): unknown } };
        };
        const channel = client.channels.get(`xtream:battle:${battleId}`);
        const onMessage = (m: { data?: unknown }) => handler.current(m?.data);
        void Promise.resolve(channel.subscribe("gift", onMessage))
          .then(() => !cancelled && setListening(battleId))
          .catch(() => {});
        stop = () => {
          channel.unsubscribe(onMessage);
          void Promise.resolve(channel.detach?.()).catch(() => {});
        };
      })
      .catch(() => {
        // Signed out or the gateway is down: the view keeps asking at its own pace.
      });
    return () => {
      cancelled = true;
      stop?.();
      setListening((cur) => (cur === battleId ? null : cur));
    };
  }, [user, battleId]);
  return Boolean(user) && listening !== null && listening === battleId;
}
