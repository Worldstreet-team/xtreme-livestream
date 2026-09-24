"use client";

import * as Ably from "ably";
import {
  createMessaging,
  type Identity,
  type MessagingRealtime,
  type UserEvent,
} from "@worldstreet/messaging-sdk";
import { useEffect, useState } from "react";

/**
 * Xstream's door into WorldSpace messaging (platform plan, phase 3).
 *
 * Messaging is a WorldStreet platform service: the threads live in the
 * social gateway, and Xstream is one of the apps that can open and read
 * them. The same Clerk session that signs the Xstream API calls signs
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
});

/** Where a thread lives in this app. */
export const threadHref = (conversationId: string) => `/messages/${conversationId}`;

/* ---------------- One live session per tab ---------------- */

export interface MessagingSession {
  me: Identity;
  live: MessagingRealtime;
}

let sessionPromise: Promise<MessagingSession> | null = null;

/** Identity plus the realtime connection, made once and shared: the inbox,
 *  the thread page and the sidebar badge all listen on the same socket. */
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
 *  component is mounted. */
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
    // The handler is read fresh through the closure each mount; callers
    // pass a stable function or accept a resubscribe.
  }, [handler]);
}

const UNREAD_POLL_MS = 30_000;

/** The badge: threads with something new from someone else. Polled like
 *  the bell, and bumped the instant a message lands. */
export function useUnreadThreads(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await messaging.conversations.unread();
        if (!cancelled) setCount(res.threads);
      } catch {
        // Signed out or unreachable: the badge stays as it was.
      }
    };
    void load();
    const timer = setInterval(() => void load(), UNREAD_POLL_MS);
    let stop: (() => void) | null = null;
    void getMessagingSession()
      .then(({ live }) => {
        if (cancelled) return;
        stop = live.onEvent((event) => {
          if (event.type === "message:new" || event.type === "message:read") void load();
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearInterval(timer);
      stop?.();
    };
  }, [enabled]);
  return count;
}

/** "3m", "2h", "Tue": the inbox's timestamp. */
export function shortTime(iso: string | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  if (hours < 24 * 7)
    return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
