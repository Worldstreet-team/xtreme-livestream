"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { ConversationRow, Message, UserEvent } from "@worldstreet/messaging-sdk";
import {
  getMessagingSession,
  messaging,
  messagingFailure,
  nudgeUnread,
  senderIdOf,
  useMessagingEvents,
  type MessagingFailure,
} from "@/lib/messaging";

/**
 * The inbox, loaded once for the whole /messages section. On a wide screen
 * the list and an open thread sit side by side, so they share one copy of
 * the rows and one set of live events: reading a thread clears its count in
 * the list, a new message moves its row to the top, and a thread opened
 * from a deep link still finds its header without a second fetch.
 */

interface MessagesState {
  /** null until the first load finishes. */
  rows: ConversationRow[] | null;
  error: MessagingFailure | null;
  /** The signed-in person's messaging profile id. */
  meId: string | null;
  reload: () => Promise<void>;
  /** Merge fields into one row (read marks, accept, mute…). */
  patchRow: (id: string, patch: Partial<ConversationRow>) => void;
  /** Drop a row (deleted, declined, left). */
  removeRow: (id: string) => void;
}

const MessagesContext = createContext<MessagesState | null>(null);

/** A thread's newest message as its inbox row shows it. */
function asLast(m: Message): NonNullable<ConversationRow["lastMessage"]> {
  return {
    _id: m._id,
    sender: m.sender,
    content: m.content,
    type: m.type,
    mediaUrl: m.mediaUrl,
    durationSec: m.durationSec,
    amountMinor: m.amountMinor,
    systemEvent: m.systemEvent,
    createdAt: m.createdAt,
  };
}

/** How long after the last live change the rows are re-read from the
 *  gateway, to pick up anything an event doesn't carry. */
const RECONCILE_MS = 1500;

export function useMessages(): MessagesState {
  const ctx = useContext(MessagesContext);
  if (!ctx) throw new Error("useMessages must be used inside the /messages layout");
  return ctx;
}

export function MessagesProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<MessagingFailure | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      // Archived rows stay: the inbox shelves them, and a thread opened from
      // a link still finds its header.
      setRows(await messaging.conversations.list());
      setError(null);
    } catch (err) {
      setError(messagingFailure(err));
      setRows((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      let failure: unknown = null;
      const [list, session] = await Promise.all([
        messaging.conversations.list().catch((err: unknown) => {
          failure = err;
          return null;
        }),
        getMessagingSession().catch(() => null),
      ]);
      if (cancelled) return;
      if (session) setMeId(session.me.id);
      if (list) {
        setRows(list);
        setError(null);
      } else {
        setError(messagingFailure(failure));
        setRows((cur) => cur ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const patchRow = useCallback((id: string, patch: Partial<ConversationRow>) => {
    setRows((cur) => cur?.map((r) => (r._id === id ? { ...r, ...patch } : r)) ?? cur);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((cur) => cur?.filter((r) => r._id !== id) ?? cur);
    nudgeUnread();
  }, []);

  // The event is the news: a new message moves its row to the top with its
  // words and count straight from the socket, with no round trip first.
  // A quiet re-read afterwards picks up what an event doesn't carry
  // (a request becoming a thread, a count the gateway settled).
  const rowsRef = useRef(rows);
  const meRef = useRef(meId);
  const openId = usePathname()?.match(/^\/messages\/([^/?#]+)/)?.[1] ?? null;
  const openRef = useRef(openId);
  useEffect(() => {
    rowsRef.current = rows;
    meRef.current = meId;
    openRef.current = openId;
  }, [rows, meId, openId]);

  const reconcileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconcile = useCallback(() => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
    reconcileTimer.current = setTimeout(() => void reload(), RECONCILE_MS);
  }, [reload]);
  useEffect(() => () => {
    if (reconcileTimer.current) clearTimeout(reconcileTimer.current);
  }, []);

  const onEvent = useCallback(
    (event: UserEvent) => {
      switch (event.type) {
        case "message:new": {
          const msg = event.message;
          // A thread the list hasn't got yet: only the gateway can describe it.
          if (!rowsRef.current?.some((r) => r._id === event.conversationId)) {
            void reload();
            break;
          }
          const mine = senderIdOf(msg.sender) === meRef.current;
          const open = openRef.current === event.conversationId;
          setRows((cur) => {
            const at = cur?.findIndex((r) => r._id === event.conversationId) ?? -1;
            if (!cur || at < 0 || cur[at].lastMessage?._id === msg._id) return cur;
            const row = cur[at];
            const next: ConversationRow = {
              ...row,
              lastMessage: asLast(msg),
              lastMessageAt: msg.createdAt,
              // Replying reads the thread; an open thread reads itself.
              unreadCount: mine ? 0 : open ? row.unreadCount : row.unreadCount + 1,
            };
            return [next, ...cur.slice(0, at), ...cur.slice(at + 1)];
          });
          reconcile();
          break;
        }
        case "message:read":
          // Read on another device (or this one): the count clears now.
          if (event.readerId === meRef.current) patchRow(event.conversationId, { unreadCount: 0 });
          reconcile();
          break;
        case "message:edited":
          // The preview takes the new words if it was the newest message.
          setRows(
            (cur) =>
              cur?.map((r) =>
                r._id === event.conversationId && r.lastMessage?._id === event.messageId
                  ? { ...r, lastMessage: { ...r.lastMessage, content: event.content } }
                  : r,
              ) ?? cur,
          );
          reconcile();
          break;
        case "message:unsent":
        case "message:removed":
          // The preview falls back to the message before, which only the gateway knows.
          void reload();
          break;
        case "group:updated":
        case "member:joined":
        case "member:left":
        case "member:removed":
        case "invite:received":
          void reload();
          break;
        case "conversation:removed":
        case "conversation:deleted":
          removeRow(event.conversationId);
          break;
        // A group call starting or ending changes its row's Join bar.
        case "call:started":
          patchRow(event.conversationId, {
            call: { startedBy: event.by, startedAt: new Date().toISOString(), video: event.video },
          });
          break;
        case "call:ended":
          patchRow(event.conversationId, { call: undefined });
          break;
      }
    },
    [reload, reconcile, removeRow, patchRow],
  );
  useMessagingEvents(onEvent);

  const value = useMemo(
    () => ({ rows, error, meId, reload, patchRow, removeRow }),
    [rows, error, meId, reload, patchRow, removeRow],
  );
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
