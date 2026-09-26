"use client";

import * as Ably from "ably";
import {
  MessagingError,
  createMessaging,
  type ConversationRow,
  type Identity,
  type Message,
  type MessagingRealtime,
  type ThreadContext,
  type UserEvent,
} from "@worldstreet/messaging-sdk";
import { useEffect, useSyncExternalStore } from "react";
import { createCorsSafeFetch } from "@/lib/messaging-transport";
import { apiFetch } from "@/lib/api-client";
import { personName } from "@/lib/messaging-copy";

/**
 * Xtream's door into WorldSpace messaging (platform plan, phase 3).
 *
 * Messaging is a WorldStreet platform service: the threads live in the
 * social gateway, and Xtream is one of the apps that can open and read
 * them. The same Clerk session that signs the Xtream API calls signs
 * these; a viewer who has never opened WorldSpace gets a messaging profile
 * on first contact, and a streamer who has never opened it can still be
 * written to (the thread waits as a request until they look).
 *
 * `platform: "xstream"` scopes the realtime token to messaging and stamps
 * every thread opened here with where it came from.
 */

const SOCIAL_API = (
  process.env.NEXT_PUBLIC_SOCIAL_API_URL ?? "https://social-api.worldstreetgold.com"
).replace(/\/+$/, "");

interface ClerkGlobal {
  session?: { getToken(): Promise<string | null> } | null;
}

async function getSessionToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const clerk = (window as { Clerk?: ClerkGlobal }).Clerk;
    return (await clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

export const messaging = createMessaging({
  baseUrl: SOCIAL_API,
  platform: "xstream",
  getToken: getSessionToken,
  // Carries the platform as ?platform= instead of a header the gateway's
  // CORS allowlist rejects — see lib/messaging-transport.ts.
  //
  // The arrow around `fetch` is load-bearing: the SDK's realtime auth calls
  // it as `args.fetch(url)`, and a browser's native fetch invoked as a method
  // of another object throws "Illegal invocation" — the realtime token is
  // never fetched and live messages, typing and the badge never arrive.
  fetch: createCorsSafeFetch((input, init) => fetch(input, init)),
});

/** Why a messaging call failed, in words: a title, a line of help, and in
 *  development the likely fix. A 401 locally almost always means the app's
 *  Clerk instance and the gateway don't match (dev sign-in against the
 *  production gateway) — the one thing the old "couldn't load" never said. */
export interface MessagingFailure {
  title: string;
  detail: string;
}

export function messagingFailure(err: unknown, what = "Your messages"): MessagingFailure {
  const dev = process.env.NODE_ENV !== "production";
  const status = err instanceof MessagingError ? err.status : -1;
  if (status === 0)
    return {
      title: "Couldn't reach messaging",
      detail: dev
        ? `Nothing answered at ${SOCIAL_API}. Is the gateway running? (NEXT_PUBLIC_SOCIAL_API_URL)`
        : "Messaging runs on WorldSpace. Check your connection and try again.",
    };
  if (status === 401 || status === 403)
    return {
      title: "Messaging didn't accept your sign-in",
      detail: dev
        ? `${SOCIAL_API} refused this session. Local sign-in uses Clerk's development instance, which only the local gateway trusts — set NEXT_PUBLIC_SOCIAL_API_URL to it (http://localhost:2500).`
        : "Sign out and back in, then try again.",
    };
  if (status === 404) return { title: `${what} couldn't be found`, detail: "It may have been deleted, or you're no longer in it." };
  return {
    title: `${what} couldn't load`,
    detail: "Messaging runs on WorldSpace. If it's down, nothing is lost — try again in a moment.",
  };
}

/** Where a thread lives in this app. */
export const threadHref = (conversationId: string) => `/messages/${conversationId}`;

/* ---------------- One live session per tab ---------------- */

export interface MessagingSession {
  me: Identity;
  live: MessagingRealtime;
}

let sessionPromise: Promise<MessagingSession> | null = null;

/** Identity plus the realtime connection, made once and shared: the inbox,
 *  the thread and the badges all listen on the same socket. */
export function getMessagingSession(): Promise<MessagingSession> {
  if (!sessionPromise) {
    sessionPromise = messaging.me().then((me) => ({
      me,
      live: messaging.realtime.connect(Ably, me.id),
    }));
    sessionPromise.catch(() => {
      // Signed out or the gateway is down: let the next caller try again.
      sessionPromise = null;
    });
  }
  return sessionPromise;
}

/** Every gateway event for the signed-in person, for as long as the
 *  component is mounted. Pass a stable handler (useCallback). */
export function useMessagingEvents(handler: (event: UserEvent) => void) {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    void getMessagingSession()
      .then(({ live }) => {
        if (cancelled) return;
        stop = live.onEvent(handler);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [handler]);
}

/* ---------------- The unread badge ---------------- */

/**
 * Threads with something new from someone else. The rail and the phone
 * drawer both show it, so they share ONE poll and ONE event subscription
 * rather than each running its own.
 */
const UNREAD_POLL_MS = 30_000;
const unread = {
  count: 0,
  listeners: new Set<() => void>(),
  timer: null as ReturnType<typeof setInterval> | null,
  stop: null as (() => void) | null,
};

async function refreshUnread() {
  try {
    const res = await messaging.conversations.unread();
    if (res.threads !== unread.count) {
      unread.count = res.threads;
      unread.listeners.forEach((l) => l());
    }
  } catch {
    // Signed out or unreachable: the badge keeps its last value.
  }
}

function subscribeUnread(listener: () => void) {
  unread.listeners.add(listener);
  if (unread.listeners.size === 1) {
    void refreshUnread();
    unread.timer = setInterval(() => void refreshUnread(), UNREAD_POLL_MS);
    void getMessagingSession()
      .then(({ live }) => {
        if (!unread.listeners.size) return;
        unread.stop = live.onEvent((event) => {
          if (
            event.type === "message:new" ||
            event.type === "message:read" ||
            event.type === "conversation:removed" ||
            event.type === "conversation:deleted"
          ) {
            void refreshUnread();
          }
        });
      })
      .catch(() => {});
  }
  return () => {
    unread.listeners.delete(listener);
    if (!unread.listeners.size) {
      if (unread.timer) clearInterval(unread.timer);
      unread.timer = null;
      unread.stop?.();
      unread.stop = null;
    }
  };
}

/** Stable, so a signed-out caller doesn't resubscribe on every render. */
const subscribeNothing = () => () => {};

/** The unread-thread count, or 0 while signed out. */
export function useUnreadThreads(enabled: boolean): number {
  const count = useSyncExternalStore(
    enabled ? subscribeUnread : subscribeNothing,
    () => unread.count,
    () => 0,
  );
  return enabled ? count : 0;
}

/** Let the inbox or a thread nudge the badge after reading or deleting. */
export function nudgeUnread() {
  void refreshUnread();
}

/* ---------------- Display helpers ---------------- */

// The wording lives in messaging-copy.ts (pure, so it's tested on its own);
// re-exported here so screens import everything messaging from one place.
export {
  EDIT_WINDOW_MS,
  STAMP_GAP_MS,
  UNSEND_WINDOW_MS,
  callOutcome,
  clockTime,
  contextHref,
  dayLabel,
  describeMessage,
  durationLabel,
  lastSeenLabel,
  needsStamp,
  personName,
  platformName,
  pollFootnote,
  shortTime,
  stampLabel,
  streamContext,
  systemEventCopy,
  viaPlatform,
  waveformBars,
} from "@/lib/messaging-copy";

/** The name a thread goes by in the list and its header. */
export function threadTitle(row: ConversationRow | null | undefined): string {
  if (!row) return "Conversation";
  if (row.kind === "group") return row.name || "Group";
  return personName(row.otherParticipant) || "Conversation";
}

/** The face a thread wears. */
export function threadAvatar(row: ConversationRow | null | undefined): string {
  if (!row) return "";
  return (row.kind === "group" ? row.avatar : row.otherParticipant?.avatar) ?? "";
}

/** The sender's id, whether the gateway populated them or not. */
export function senderIdOf(sender: Message["sender"] | undefined): string {
  if (!sender) return "";
  return typeof sender === "string" ? sender : sender._id;
}

/**
 * Open (or find) the one thread with an Xtream user and return its id. The
 * gateway addresses people by their Clerk id — it takes one and makes a
 * WorldSpace profile on first contact — so the public profile supplies it.
 */
export async function openThreadWith(username: string, context?: ThreadContext): Promise<string> {
  const res = await apiFetch<{ data: { user: { authUserId?: string } } }>(`/api/user/${encodeURIComponent(username)}`);
  const to = res.data.user.authUserId;
  if (!to) throw new Error("This person can't be messaged yet");
  const thread = await messaging.conversations.open(to, context);
  return thread._id;
}

/** Why opening a thread failed, in one line. */
export function openFailure(err: unknown): string {
  if (err instanceof MessagingError) return err.status === 0 ? "Messaging is unreachable right now" : err.message;
  return (err as Error)?.message || "Couldn't open the conversation";
}
