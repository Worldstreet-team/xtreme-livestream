/**
 * Realtime pushes from the Xtream API, as they reach a browser (the pure
 * half; lib/xtream-live-events.ts wires it to the messaging session and
 * React). The API tells the WorldSpace gateway (services/api/src/
 * xtream-events.ts), and the gateway publishes on Ably:
 *
 * - public events on the `xtream` channel, the message name being the
 *   event (`stream.started`, `stream.ended`, `stream.updated`,
 *   `battle.started`, `battle.ended`);
 * - personal events on the person's own `user:<profileId>` channel, as
 *   message `xtream` with the event's name in `data.type` (`notification`,
 *   `live`).
 *
 * The hub turns both into one stream of pushes and keeps one fact the
 * polls pace themselves by: pushes are arriving right now (at least one
 * has come this session, and the connection is up). Until then every
 * poll keeps its own pace; after, polls slow to a backstop and refetch
 * when a push says something changed. A dropped connection puts them back
 * on their own pace, and coming back asks everyone to refetch once
 * ("resync"), since whatever happened in between was missed.
 */

export const XTREAM_PUBLIC_CHANNEL = "xtream";
export const XTREAM_USER_MESSAGE = "xtream";

export type XtreamPushName =
  | "stream.started"
  | "stream.ended"
  | "stream.updated"
  | "battle.started"
  | "battle.ended"
  | "notification"
  | "live";

export interface XtreamPush {
  name: string;
  data: Record<string, unknown>;
  /** Came on the person's own channel (not the public one). */
  personal: boolean;
}

/** A push, or "resync" after the connection came back. */
export type XtreamSignal = XtreamPush | "resync";

function objectOf(data: unknown): Record<string, unknown> {
  if (typeof data === "string") {
    try {
      return objectOf(JSON.parse(data));
    } catch {
      return {};
    }
  }
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

/** The push an Ably message carries, or null when it isn't one. */
export function readPush(message: { name?: unknown; data?: unknown } | null | undefined, personal: boolean): XtreamPush | null {
  if (!message) return null;
  if (personal) {
    if (message.name !== XTREAM_USER_MESSAGE) return null;
    const { type, ...rest } = objectOf(message.data);
    return typeof type === "string" && type ? { name: type, data: rest, personal: true } : null;
  }
  if (typeof message.name !== "string" || !message.name) return null;
  return { name: message.name, data: objectOf(message.data), personal: false };
}

type Handler = (m: { name?: unknown; data?: unknown }) => void;
interface ChannelLike {
  subscribe(nameOrHandler: string | Handler, handler?: Handler): unknown;
  unsubscribe(handler?: Handler): void;
}
interface StateChange {
  current?: string;
}
/** The bit of an Ably Realtime client the hub touches. */
export interface AblyClientLike {
  channels: { get(name: string): ChannelLike };
  connection?: {
    state?: string;
    on?(listener: (change: StateChange) => void): void;
    off?(listener: (change: StateChange) => void): void;
  };
}

export function createXtreamPushHub() {
  let seen = false;
  let connected = false;
  let detach: (() => void) | null = null;
  const listeners = new Set<(signal: XtreamSignal) => void>();
  const paceListeners = new Set<() => void>();

  const live = () => seen && connected;
  function change(apply: () => void) {
    const before = live();
    apply();
    if (live() !== before) paceListeners.forEach((l) => l());
  }
  function emit(signal: XtreamSignal) {
    listeners.forEach((l) => {
      try {
        l(signal);
      } catch {
        // One screen's handler never stops the others hearing it.
      }
    });
  }
  function onPush(push: XtreamPush | null) {
    if (!push) return;
    // A push is proof enough the connection is up.
    change(() => {
      seen = true;
      connected = true;
    });
    emit(push);
  }

  return {
    /** Start listening on the public channel and this person's own. */
    attach(client: AblyClientLike, profileId: string) {
      detach?.();
      const pub = client.channels.get(XTREAM_PUBLIC_CHANNEL);
      const mine = client.channels.get(`user:${profileId}`);
      const onPublic: Handler = (m) => onPush(readPush(m, false));
      const onMine: Handler = (m) => onPush(readPush(m, true));
      const quiet = (p: unknown) => void Promise.resolve(p).catch(() => {});
      quiet(pub.subscribe(onPublic));
      quiet(mine.subscribe(XTREAM_USER_MESSAGE, onMine));
      connected = client.connection?.state === "connected";
      const onState = (s: StateChange) => {
        const now = s?.current === "connected";
        const back = now && !connected && seen;
        change(() => {
          connected = now;
        });
        if (back) emit("resync");
      };
      client.connection?.on?.(onState);
      detach = () => {
        pub.unsubscribe(onPublic);
        mine.unsubscribe(onMine);
        client.connection?.off?.(onState);
      };
    },
    detach() {
      detach?.();
      detach = null;
      change(() => {
        seen = false;
        connected = false;
      });
    },
    /** Every push (and resync). Returns the unsubscribe. */
    listen(listener: (signal: XtreamSignal) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Told whenever `live()` flips. */
    onPace(listener: () => void) {
      paceListeners.add(listener);
      return () => void paceListeners.delete(listener);
    },
    /** Pushes are arriving: polls may slow to their backstop. */
    live,
  };
}

export type XtreamPushHub = ReturnType<typeof createXtreamPushHub>;

/** The interval a poll should run at: its own until pushes arrive, the backstop after. */
export function pollPace(fastMs: number, backstopMs: number, pushesLive: boolean) {
  return pushesLive ? Math.max(fastMs, backstopMs) : fastMs;
}
