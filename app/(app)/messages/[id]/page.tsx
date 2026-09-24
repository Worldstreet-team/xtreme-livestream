"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, PaperPlaneRight } from "@phosphor-icons/react";
import type {
  ConversationRow,
  Message,
  MessagingRealtime,
  UserEvent,
} from "@worldstreet/messaging-sdk";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/ui/user-avatar";
import { getMessagingSession, messaging, useMessagingEvents } from "@/lib/messaging";

/**
 * One thread. Text in and out, read marks, typing, live updates. Media a
 * WorldSpace user sent renders (pictures inline, the rest as a link); this
 * composer sends text only, which is what a viewer writing a streamer
 * needs. The full composer lives in WorldSpace and the app.
 */

const PAGE = 50;

function senderId(m: Message): string {
  return typeof m.sender === "string" ? m.sender : m.sender._id;
}

function senderName(m: Message): string {
  if (typeof m.sender === "string") return "";
  return `${m.sender.firstName ?? ""} ${m.sender.lastName ?? ""}`.trim() || m.sender.username;
}

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user, isLoading } = useAuth();
  const [meId, setMeId] = useState<string | null>(null);
  const [row, setRow] = useState<ConversationRow | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<ReturnType<MessagingRealtime["thread"]> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const scrollToEnd = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Identity, the thread row, the newest page, and the live signal channel.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ me, live }, list, page] = await Promise.all([
          getMessagingSession(),
          messaging.conversations.list(),
          messaging.messages.list(id, { limit: PAGE }),
        ]);
        if (cancelled) return;
        setMeId(me.id);
        setRow(list.find((r) => r._id === id) ?? null);
        setMessages(page);
        setHasMore(page.length === PAGE);
        void messaging.messages.markRead(id).catch(() => {});
        const thread = live.thread(id);
        threadRef.current = thread;
        void thread.enter();
        thread.onSignal((name) => {
          if (name === "typing" || name === "recording") {
            setTyping(true);
            if (typingTimer.current) clearTimeout(typingTimer.current);
            typingTimer.current = setTimeout(() => setTyping(false), 4000);
          } else if (name === "typing:stop") {
            setTyping(false);
          }
        });
        requestAnimationFrame(scrollToEnd);
      } catch {
        if (!cancelled) setError("Could not load this conversation");
      }
    })();
    return () => {
      cancelled = true;
      threadRef.current?.leave();
      threadRef.current = null;
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [user, id, scrollToEnd]);

  // Messages landing while the thread is open.
  const onEvent = useCallback(
    (event: UserEvent) => {
      if (event.type === "message:new" && event.conversationId === id) {
        setMessages((cur) =>
          cur.some((m) => m._id === event.message._id) ? cur : [...cur, event.message],
        );
        setTyping(false);
        void messaging.messages.markRead(id).catch(() => {});
        requestAnimationFrame(scrollToEnd);
      } else if (event.type === "message:unsent" && event.conversationId === id) {
        setMessages((cur) => cur.filter((m) => m._id !== event.messageId));
      }
    },
    [id, scrollToEnd],
  );
  useMessagingEvents(onEvent);

  const loadOlder = async () => {
    const oldest = messages[0]?._id;
    if (!oldest) return;
    try {
      const older = await messaging.messages.list(id, { limit: PAGE, before: oldest });
      setMessages((cur) => [...older, ...cur]);
      setHasMore(older.length === PAGE);
    } catch {
      /* the next tap tries again */
    }
  };

  const onDraft = (value: string) => {
    setDraft(value);
    const now = Date.now();
    if (value && now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      void threadRef.current?.send("typing");
    }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    const clientKey = crypto.randomUUID();
    try {
      const saved = await messaging.messages.send({ conversationId: id, content, clientKey });
      setMessages((cur) => (cur.some((m) => m._id === saved._id) ? cur : [...cur, saved]));
      setDraft("");
      void threadRef.current?.send("typing:stop");
      requestAnimationFrame(scrollToEnd);
    } catch (err) {
      setError((err as Error)?.message || "Could not send");
    } finally {
      setSending(false);
    }
  };

  if (isLoading) return null;

  const title =
    row?.kind === "group"
      ? row.name ?? "Group"
      : row?.otherParticipant
        ? `${row.otherParticipant.firstName ?? ""} ${row.otherParticipant.lastName ?? ""}`.trim() ||
          row.otherParticipant.username
        : "Conversation";

  return (
    <div className="mx-auto flex h-[calc(100dvh-0px)] w-full max-w-2xl flex-col px-4 md:px-8">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Link
          href="/messages"
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
          aria-label="Back to messages"
        >
          <ArrowLeft size={18} />
        </Link>
        <UserAvatar
          src={row?.kind === "group" ? row.avatar ?? "" : row?.otherParticipant?.avatar ?? ""}
          name={title}
          size={32}
          className="size-8"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {typing ? "typing…" : row?.isRequestForMe ? "Message request" : "WorldSpace"}
          </p>
        </div>
        {row?.context?.url && (
          <a
            href={row.context.url}
            className="flex items-center gap-1 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {row.context.title ?? row.context.kind}
            <ArrowUpRight size={12} />
          </a>
        )}
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 space-y-1 overflow-y-auto pb-4 scrollbar-thin">
        {hasMore && (
          <button
            type="button"
            onClick={loadOlder}
            className="mx-auto mb-3 block rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
          >
            Earlier messages
          </button>
        )}
        {messages.map((m) => {
          const mine = meId !== null && senderId(m) === meId;
          if (m.type === "system" || m.type === "call") {
            return (
              <p key={m._id} className="py-1 text-center text-[0.7rem] text-muted-foreground">
                {m.type === "call" ? "Call" : m.systemEvent?.kind.replace(/^platform:/, "") ?? "Update"}
              </p>
            );
          }
          return (
            <div key={m._id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[75%] rounded-xl px-3 py-2 text-sm",
                  mine
                    ? "bg-primary text-primary-foreground"
                    : "bg-white/[0.06] text-foreground",
                )}
              >
                {!mine && row?.kind === "group" && (
                  <p className="mb-0.5 text-[0.65rem] font-medium opacity-70">{senderName(m)}</p>
                )}
                {m.type === "image" && m.mediaUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.mediaUrl} alt="" className="mb-1 max-h-72 rounded-lg" />
                ) : m.mediaUrl && m.type !== "text" ? (
                  <a href={m.mediaUrl} className="underline underline-offset-2">
                    {m.type === "audio" ? "Voice note" : m.type === "video" ? "Video" : "Attachment"}
                  </a>
                ) : null}
                {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t border-white/5 py-3"
      >
        <textarea
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={row?.isRequestForMe ? "Reply to accept this request" : "Message"}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-white/20"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-40"
          aria-label="Send"
        >
          <PaperPlaneRight size={16} weight="fill" />
        </button>
      </form>
      {error && <p className="pb-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
