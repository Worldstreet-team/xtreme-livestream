"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ConversationRow, UserEvent } from "@worldstreet/messaging-sdk";
import {
  getMessagingSession,
  messaging,
  messagingFailure,
  nudgeUnread,
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

  // A message anywhere reorders the list and updates previews and counts —
  // cheapest correct answer is to reload the rows (one small request).
  const onEvent = useCallback(
    (event: UserEvent) => {
      switch (event.type) {
        case "message:new":
        case "message:edited":
        case "message:unsent":
        case "message:removed":
        case "message:read":
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
    [reload, removeRow, patchRow],
  );
  useMessagingEvents(onEvent);

  const value = useMemo(
    () => ({ rows, error, meId, reload, patchRow, removeRow }),
    [rows, error, meId, reload, patchRow, removeRow],
  );
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}
