"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ConversationRow } from "@worldstreet/messaging-sdk";
import {
  Archive,
  ArrowLeft,
  BellSlash,
  Broadcast,
  ChatCircleDots,
  ImageSquare,
  MagnifyingGlass,
  Microphone,
  PencilSimple,
  Phone,
  X,
} from "@/components/icons";
import { Empty, Notice, Pill, UserAvatar } from "@/components/xtream";
import { CapsuleTabs } from "@/components/ui/capsule-tabs";
import { cn } from "@/lib/utils";
import {
  describeMessage,
  lastSeenLabel,
  messaging,
  personName,
  senderIdOf,
  shortTime,
  threadAvatar,
  threadHref,
  threadTitle,
} from "@/lib/messaging";
import { useMessages } from "./messages-context";
import { NewMessageDialog } from "./new-message";

/**
 * The inbox: every WorldSpace thread you're in, wherever it was opened —
 * Xtream's window onto the same threads WorldSpace and the app show.
 *
 * It leads with how things stand ("3 unread · 1 waiting"), then who's
 * around right now, then the threads. Requests and group invites wait on
 * their own shelf, silent until you answer; archived threads sit at the
 * foot, out of the way but never gone.
 */

type Filter = "all" | "unread" | "requests" | "archived";

const EMPTY_SHELF: Record<Filter, string> = {
  all: "Your inbox is clear.",
  unread: "You're all caught up.",
  requests: "Nobody's waiting on you.",
  archived: "Nothing archived. Archive a conversation from its menu to tuck it away here.",
};

export function InboxPane() {
  const { rows, error, meId, reload, patchRow, removeRow } = useMessages();
  const pathname = usePathname();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const active = rows?.filter((r) => !r.archived) ?? [];
  const archived = rows?.filter((r) => r.archived) ?? [];
  const requests = active.filter((r) => r.isRequestForMe);
  const inbox = active.filter((r) => !r.isRequestForMe);
  const unread = inbox.filter((r) => r.unreadCount > 0);
  // Who's around right now: people you talk to, active in the last couple of minutes.
  const around = inbox.filter((r) => r.kind === "dm" && lastSeenLabel(r.otherParticipant?.lastSeenAt) === "Active now").slice(0, 12);

  const q = query.trim().toLowerCase();
  const matches = (r: ConversationRow) =>
    !q ||
    threadTitle(r).toLowerCase().includes(q) ||
    (r.otherParticipant?.username ?? "").toLowerCase().includes(q) ||
    (r.lastMessage ? describeMessage(r.lastMessage).toLowerCase().includes(q) : false);
  const shelf = filter === "requests" ? requests : filter === "unread" ? unread : filter === "archived" ? archived : inbox;
  const shown = shelf.filter(matches);

  const summary = !rows
    ? "Loading your threads"
    : unread.length
      ? `${unread.length} unread${requests.length ? ` · ${requests.length} waiting` : ""}`
      : requests.length
        ? `${requests.length} waiting for an answer`
        : rows.length
          ? "You're all caught up"
          : "Nothing here yet";

  // A request is accepted; an invite is joined (a group isn't yours to accept
  // until you're in it).
  const accept = async (row: ConversationRow) => {
    setBusyId(row._id);
    try {
      if (row.isInvite) {
        await messaging.groups.join(row._id);
        await reload();
      } else {
        await messaging.conversations.accept(row._id);
        patchRow(row._id, { isRequestForMe: false, status: "accepted" });
      }
    } catch {
      // The row stays where it was; the next tap tries again.
    } finally {
      setBusyId(null);
    }
  };

  // Declining a request deletes the opener, the way WorldSpace does it;
  // declining an invite withdraws it.
  const decline = async (row: ConversationRow) => {
    setBusyId(row._id);
    try {
      if (row.isInvite) {
        if (!meId) throw new Error("not ready");
        await messaging.groups.withdrawInvite(row._id, meId);
      } else {
        await messaging.conversations.remove(row._id);
      }
      removeRow(row._id);
    } catch {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <header className="px-4 pt-7 pb-2 md:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-wide text-[32px] leading-none font-bold tracking-[-0.035em] text-foreground">Messages</h1>
            <p aria-live="polite" className={cn("mt-2.5 text-[13px]", unread.length ? "text-foreground/80" : "text-muted-foreground")}>
              {unread.length > 0 && <span aria-hidden className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-chili" />}
              {summary}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setComposing(true)}
            aria-label="New message"
            title="New message"
            className="msg-press flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-[#0b0708] hover:bg-white/90"
          >
            <PencilSimple size={19} weight="bold" />
          </button>
        </div>

        {rows && rows.length > 0 && (
          <>
            <label className="mt-5 flex h-11 items-center gap-2.5 rounded-full bg-white/[0.06] px-4 shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] transition-[background-color,box-shadow] duration-200 focus-within:bg-white/[0.09] focus-within:shadow-[inset_0_0_0_1.5px_var(--ember)] hover:bg-white/[0.08]">
              <MagnifyingGlass size={17} className="shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                placeholder="Search people and messages"
                aria-label="Search conversations"
                className="min-w-0 flex-1 bg-transparent text-[14.5px] text-foreground outline-none placeholder:text-muted-foreground/70"
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                  <X size={15} />
                </button>
              )}
            </label>
            {filter !== "archived" ? (
              <CapsuleTabs
                label="Filter conversations"
                className="mt-3"
                value={filter}
                onChange={setFilter}
                items={[
                  { id: "all", label: "All" },
                  { id: "unread", label: unread.length ? `Unread ${unread.length}` : "Unread" },
                  { id: "requests", label: requests.length ? `Requests ${requests.length}` : "Requests" },
                ]}
              />
            ) : (
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="msg-press mt-3 flex items-center gap-2 rounded-control px-1 py-2 text-[13.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft size={16} aria-hidden />
                Archived
              </button>
            )}
          </>
        )}
      </header>

      {/* Who's around: a quick way into a conversation with someone active now. */}
      {filter === "all" && !q && around.length > 0 && (
        <section aria-label="Active now" className="pt-3 pb-1">
          <p className="px-5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Active now</p>
          <div className="mt-3 flex gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none]">
            {around.map((r, i) => (
              <Link
                key={r._id}
                href={threadHref(r._id)}
                style={{ "--i": i } as React.CSSProperties}
                className="msg-rise msg-press group flex w-[60px] shrink-0 flex-col items-center gap-1.5"
              >
                <span className="relative">
                  <UserAvatar src={threadAvatar(r)} name={threadTitle(r)} size={56} className="size-14" />
                  <span aria-hidden className="absolute right-0.5 bottom-0.5 size-3.5 rounded-full bg-success ring-[3px] ring-background" />
                </span>
                <span className="w-full truncate text-center text-[11.5px] text-muted-foreground group-hover:text-foreground">
                  {threadTitle(r).split(" ")[0]}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="min-h-0 flex-1 px-2 pt-2 pb-6 md:px-3">
        {error && (
          <div className="px-2 pb-3">
            <Notice
              tone="danger"
              title={error.title}
              action={
                <Pill size="sm" variant="glass" onClick={() => void reload()}>
                  Try again
                </Pill>
              }
            >
              {error.detail}
            </Notice>
          </div>
        )}

        {!rows && <InboxSkeleton />}

        {rows && rows.length === 0 && !error && (
          <Empty
            icon={<ChatCircleDots size={40} weight="duotone" className="text-ember-hi" />}
            title="No conversations yet"
            body="Message a creator from their stream or channel, or start one here. Every thread follows you into WorldSpace and the app."
            action={{ label: "Start a conversation", onClick: () => setComposing(true) }}
            className="py-16"
          />
        )}

        {rows && rows.length > 0 && shown.length === 0 && !(filter === "all" && !q && requests.length > 0) && (
          <p className="mx-auto max-w-xs px-3 py-10 text-center text-[14px] text-muted-foreground">
            {q ? `Nothing matches “${query.trim()}”.` : EMPTY_SHELF[filter]}
          </p>
        )}

        {filter === "all" && !q && requests.length > 0 && (
          <button
            type="button"
            onClick={() => setFilter("requests")}
            className="msg-press mb-1 flex w-full items-center gap-3.5 rounded-panel px-3 py-3 text-left transition-colors hover:bg-white/[0.04]"
          >
            <span className="relative flex h-12 w-[60px] shrink-0 items-center">
              {requests.slice(0, 3).map((r, i) => (
                <span key={r._id} className="absolute rounded-full ring-[3px] ring-background" style={{ left: i * 12 }}>
                  <UserAvatar src={threadAvatar(r)} name={threadTitle(r)} size={36} className="size-9" />
                </span>
              ))}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold text-foreground">Message requests</span>
              <span className="block truncate text-[13px] text-muted-foreground">
                {requests.length === 1 ? requestLine(requests[0]) : `${requests.length} waiting for your answer`}
              </span>
            </span>
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-chili px-1.5 text-[11px] font-bold text-white tabular-nums">
              {requests.length}
            </span>
          </button>
        )}

        {shown.length > 0 && (
          <ul className="space-y-0.5">
            {shown.map((row, i) => (
              <li key={row._id} style={{ "--i": i } as React.CSSProperties} className="msg-rise">
                <InboxRow
                  row={row}
                  meId={meId}
                  active={pathname === threadHref(row._id)}
                  busy={busyId === row._id}
                  onAccept={row.isRequestForMe ? () => void accept(row) : undefined}
                  onDecline={row.isRequestForMe ? () => void decline(row) : undefined}
                />
              </li>
            ))}
          </ul>
        )}

        {/* Archived threads wait at the foot of the list, one quiet row. */}
        {filter === "all" && !q && archived.length > 0 && (
          <button
            type="button"
            onClick={() => setFilter("archived")}
            className="msg-press mt-2 flex w-full items-center gap-3 rounded-panel px-3 py-2.5 text-left text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
          >
            <span className="flex size-12 shrink-0 items-center justify-center">
              <Archive size={20} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 text-[14px] font-medium">Archived</span>
            <span className="pr-1 text-[12.5px] tabular-nums">{archived.length}</span>
          </button>
        )}
      </div>

      {composing && <NewMessageDialog onClose={() => setComposing(false)} />}
    </div>
  );
}

/** "Ada wants to message you", "Sola invited you to Night Owls". */
function requestLine(row: ConversationRow): string {
  if (row.isInvite) {
    const by = row.invite && typeof row.invite.by !== "string" ? personName(row.invite.by) : "Someone";
    return `${by} invited you to ${threadTitle(row)}`;
  }
  return `${threadTitle(row)} wants to message you`;
}

/** The glyph that stands in for a message that isn't words. */
function PreviewGlyph({ type }: { type: string }) {
  if (type === "image" || type === "video") return <ImageSquare size={14} aria-hidden className="mr-1 inline -translate-y-px" />;
  if (type === "audio") return <Microphone size={14} aria-hidden className="mr-1 inline -translate-y-px" />;
  if (type === "call") return <Phone size={14} aria-hidden className="mr-1 inline -translate-y-px" />;
  return null;
}

function InboxRow({
  row,
  meId,
  active,
  busy,
  onAccept,
  onDecline,
}: {
  row: ConversationRow;
  meId: string | null;
  active: boolean;
  busy: boolean;
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const title = threadTitle(row);
  const last = row.lastMessage;
  const unread = row.unreadCount > 0;
  const sender = last?.sender;
  const mine = Boolean(last && meId && senderIdOf(sender) === meId);
  const online = row.kind === "dm" && lastSeenLabel(row.otherParticipant?.lastSeenAt) === "Active now";
  const muted = row.notifyLevel === "none";
  // In a group, say who said it: "Ada: see you at 8".
  const who =
    row.kind === "group" && !mine && last?.type !== "system" && sender && typeof sender !== "string" ? `${personName(sender).split(" ")[0]}: ` : "";
  const preview = row.isInvite ? requestLine(row) : last ? describeMessage(last, meId) : "Say hello";

  return (
    <div
      className={cn(
        "group relative flex items-center gap-3.5 rounded-panel px-3 py-3 transition-colors",
        active ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
      )}
    >
      {/* Selected: a short Ember bar at the edge — the selected state, no outline. */}
      {active && <span aria-hidden className="absolute top-1/2 left-0 h-8 w-[3px] -translate-y-1/2 rounded-full bg-ember" />}
      {/* The whole row opens the thread; the answer buttons sit above it. */}
      <Link
        href={threadHref(row._id)}
        aria-current={active ? "page" : undefined}
        className="absolute inset-0 rounded-panel outline-none focus-visible:ring-2 focus-visible:ring-ember"
      >
        <span className="sr-only">
          {title}
          {unread ? `, ${row.unreadCount} unread` : ""}
        </span>
      </Link>

      <span className="relative shrink-0">
        <UserAvatar src={threadAvatar(row)} name={title} size={52} className="size-[52px]" ring={row.call ? "live" : "none"} />
        {online && <span aria-hidden className="absolute right-0 bottom-0 size-3.5 rounded-full bg-success ring-[3px] ring-background" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className={cn("min-w-0 flex-1 truncate text-[15.5px]", unread ? "font-semibold text-foreground" : "font-medium text-foreground/90")}>
            {title}
          </p>
          {muted && <BellSlash size={13} className="shrink-0 text-muted-foreground" aria-label="Muted" />}
          <span className={cn("shrink-0 text-[12px] tabular-nums", unread ? "font-semibold text-chili-hi" : "text-muted-foreground")}>
            {shortTime(row.lastMessageAt ?? last?.createdAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {row.call ? (
            <p className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-chili-hi">Call in progress · tap to join</p>
          ) : (
            <p className={cn("min-w-0 flex-1 truncate text-[13.5px]", unread ? "text-foreground" : "text-muted-foreground")}>
              {mine && <span className="text-muted-foreground">You: </span>}
              {who && <span className="text-muted-foreground">{who}</span>}
              {last && !row.isInvite && <PreviewGlyph type={last.type} />}
              {preview}
            </p>
          )}
          {unread && (
            <span className="msg-pop flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-chili px-1.5 text-[11px] font-bold text-white tabular-nums">
              {row.unreadCount > 99 ? "99+" : row.unreadCount}
            </span>
          )}
        </div>
        {row.context && !onAccept && (
          <span className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-control px-2 py-0.5 text-[11px] text-muted-foreground">
            <Broadcast size={11} aria-hidden className="shrink-0 text-ember-hi" />
            <span className="truncate">{row.context.title ?? row.context.kind}</span>
          </span>
        )}

        {onAccept && onDecline && (
          <div className="relative z-10 mt-2.5 flex gap-2">
            <Pill size="sm" variant="primary" onClick={onAccept} disabled={busy} className="shadow-none!">
              {row.isInvite ? "Join" : "Accept"}
            </Pill>
            <Pill size="sm" variant="ghost" onClick={onDecline} disabled={busy} className="text-chili-hi">
              {row.isInvite ? "Decline" : "Delete"}
            </Pill>
          </div>
        )}
      </div>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <ul className="space-y-0.5" aria-label="Loading your messages">
      {Array.from({ length: 7 }, (_, i) => (
        <li key={i} className="flex items-center gap-3.5 px-3 py-3">
          <span className="size-[52px] shrink-0 animate-pulse rounded-full bg-white/[0.05]" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="min-w-0 flex-1 space-y-2">
            <span className="block h-3.5 w-2/5 animate-pulse rounded-full bg-white/[0.05]" style={{ animationDelay: `${i * 80}ms` }} />
            <span className="block h-3 w-4/5 animate-pulse rounded-full bg-white/[0.04]" style={{ animationDelay: `${i * 80}ms` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
