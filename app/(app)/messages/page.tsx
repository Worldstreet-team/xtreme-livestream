"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChatCircle } from "@phosphor-icons/react";
import type { ConversationRow, UserEvent } from "@worldstreet/messaging-sdk";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/ui/user-avatar";
import { messaging, shortTime, threadHref, useMessagingEvents } from "@/lib/messaging";

/**
 * The inbox: every WorldSpace thread the signed-in person is in, wherever
 * it was opened. Quiet rows in the sidebar's language; the same threads
 * appear in WorldSpace and the phone app, this is just Xstream's window
 * onto them.
 */

function rowTitle(row: ConversationRow) {
  if (row.kind === "group") return row.name ?? "Group";
  const p = row.otherParticipant;
  if (!p) return "Conversation";
  return `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.username;
}

function rowPreview(row: ConversationRow) {
  const last = row.lastMessage;
  if (!last) return "No messages yet";
  switch (last.type) {
    case "image":
      return "Photo";
    case "video":
      return "Video";
    case "audio":
      return "Voice note";
    case "call":
      return "Call";
    case "payment":
      return "Payment";
    case "system":
      return "Update";
    case "contact":
      return "Contact";
    default:
      return last.content;
  }
}

export default function MessagesPage() {
  const { user, isLoading } = useAuth();
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await messaging.conversations.list();
      setRows(list.filter((r) => !r.archived));
      setError(null);
    } catch {
      setError("Could not load your messages");
      setRows((cur) => cur ?? []);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const list = await messaging.conversations.list().catch(() => null);
      if (cancelled) return;
      if (list) {
        setRows(list.filter((r) => !r.archived));
        setError(null);
      } else {
        setError("Could not load your messages");
        setRows((cur) => cur ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const onEvent = useCallback(
    (event: UserEvent) => {
      if (
        event.type === "message:new" ||
        event.type === "message:read" ||
        event.type === "conversation:removed" ||
        event.type === "conversation:deleted"
      )
        void load();
    },
    [load],
  );
  useMessagingEvents(onEvent);

  if (isLoading) return null;

  const requests = rows?.filter((r) => r.isRequestForMe) ?? [];
  const inbox = rows?.filter((r) => !r.isRequestForMe) ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Messages</h1>
        <p className="text-xs text-muted-foreground">Shared with WorldSpace</p>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {rows && rows.length === 0 && !error && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-white/5 bg-white/2 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-lg bg-white/[0.05] text-foreground">
            <ChatCircle size={22} />
          </span>
          <p className="text-sm font-medium text-foreground">No messages yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Message a streamer from their stream page. Threads you start here
            also show in WorldSpace and the app.
          </p>
        </div>
      )}

      {requests.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
            Requests
          </h2>
          <ThreadList rows={requests} />
        </section>
      )}

      {inbox.length > 0 && <ThreadList rows={inbox} />}
    </div>
  );
}

function ThreadList({ rows }: { rows: ConversationRow[] }) {
  return (
    <ul className="space-y-0.5">
      {rows.map((row) => {
        const unread = row.unreadCount > 0;
        return (
          <li key={row._id}>
            <Link
              href={threadHref(row._id)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
            >
              <UserAvatar
                src={row.kind === "group" ? row.avatar ?? "" : row.otherParticipant?.avatar ?? ""}
                name={rowTitle(row)}
                size={40}
                className="size-10"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p
                    className={cn(
                      "truncate text-sm",
                      unread ? "font-semibold text-foreground" : "text-foreground",
                    )}
                  >
                    {rowTitle(row)}
                  </p>
                  <span className="shrink-0 text-[0.7rem] tabular-nums text-muted-foreground">
                    {shortTime(row.lastMessageAt)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {row.context && (
                    <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-px text-[0.65rem] text-muted-foreground">
                      {row.context.title ?? row.context.kind}
                    </span>
                  )}
                  <p
                    className={cn(
                      "truncate text-xs",
                      unread ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {rowPreview(row)}
                  </p>
                </div>
              </div>
              {unread && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.65rem] font-semibold tabular-nums text-primary-foreground">
                  {row.unreadCount}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
