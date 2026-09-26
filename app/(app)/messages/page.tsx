"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConversationRow } from "@worldstreet/messaging-sdk";
import { ArrowRight, ChatCircleDots, Phone, VideoCamera } from "@/components/icons";
import { GoLiveButton, UserAvatar } from "@/components/xtream";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useMessages } from "@/components/app/messages/messages-context";
import { describeMessage, lastSeenLabel, senderIdOf, shortTime, threadAvatar, threadHref, threadTitle } from "@/lib/messaging";

/** "Good evening" by the clock where you are. */
function greetingNow(): string {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "just now", "12 min ago", "3h ago", "on Tuesday", "on Sep 12". */
function wroteWhen(iso: string | undefined): string {
  const s = shortTime(iso);
  if (!s || s === "now") return "just now";
  if (/^\d+m$/.test(s)) return `${parseInt(s, 10)} min ago`;
  if (/^\d+h$/.test(s)) return `${s} ago`;
  return `on ${s}`;
}

/**
 * /messages on a wide screen, before a thread is picked: not an empty pane
 * but a small bento of how things stand — where you left off, what's
 * unread, who's waiting, who's around, calls, and the way on air. Below lg
 * the layout shows only the inbox here, so this never renders on a phone.
 */
export default function MessagesOverview() {
  const { rows, meId } = useMessages();
  const { user } = useAuth();
  const [greeting] = useState(greetingNow);

  if (!rows) return null;

  const active = rows.filter((r) => !r.archived);
  const inbox = active.filter((r) => !r.isRequestForMe);
  const requests = active.filter((r) => r.isRequestForMe);
  const unread = inbox.filter((r) => r.unreadCount > 0);
  const around = inbox.filter((r) => r.kind === "dm" && lastSeenLabel(r.otherParticipant?.lastSeenAt) === "Active now");
  const calling = inbox.find((r) => r.call);
  const lead = unread[0] ?? inbox[0] ?? null;
  const first = user?.displayName?.split(" ")[0] || user?.username || "";

  const line = unread.length
    ? `${threadTitle(unread[0])} wrote ${wroteWhen(unread[0].lastMessageAt ?? unread[0].lastMessage?.createdAt)}.${requests.length ? ` ${requests.length} ${requests.length === 1 ? "person is" : "people are"} waiting on you.` : ""}`
    : requests.length
      ? `${requests.length} ${requests.length === 1 ? "person wants" : "people want"} to message you.`
      : inbox.length
        ? "You're all caught up. Say something first for once."
        : "Your inbox is quiet. Start a conversation, or go live and let them come to you.";

  const tile = "msg-rise rounded-panel bg-surface-raised p-5";

  return (
    <div className="h-full overflow-y-auto px-6 py-8 xl:px-10 xl:py-10">
      <div className="mx-auto w-full max-w-[780px]">
        <p className="msg-rise text-[11.5px] font-semibold tracking-[0.16em] text-ember-hi uppercase">Messages · Shared with WorldSpace</p>
        <h2 className="msg-rise mt-3 font-wide text-[44px] leading-[0.98] font-bold tracking-[-0.04em] text-foreground" style={{ "--i": 1 } as React.CSSProperties}>
          {greeting}
          {first ? `, ${first}` : ""}.
        </h2>
        <p className="msg-rise mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground" style={{ "--i": 2 } as React.CSSProperties}>
          {line}
        </p>

        <div className="mt-8 grid auto-rows-[minmax(120px,auto)] grid-cols-6 gap-3">
          {/* Where you left off: the freshest thread, as a glimpse of the conversation. */}
          <Link
            href={lead ? threadHref(lead._id) : "#"}
            aria-disabled={!lead}
            style={{ "--i": 3 } as React.CSSProperties}
            className={cn(tile, "group col-span-6 row-span-2 flex flex-col justify-between transition-colors hover:bg-surface-hover xl:col-span-4", !lead && "pointer-events-none")}
          >
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {unread.length ? "Waiting for you" : "Pick up where you left off"}
            </p>
            {lead ? (
              <LeadGlimpse row={lead} meId={meId} />
            ) : (
              <p className="mt-6 text-[15px] text-muted-foreground">Your first conversation will show up here.</p>
            )}
            <span className="mt-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
              {lead ? "Open conversation" : ""}
              {lead && <ArrowRight size={15} className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden />}
            </span>
          </Link>

          {/* Unread, as a number you can read across the room. */}
          <Link
            href={unread[0] ? threadHref(unread[0]._id) : "#"}
            style={{ "--i": 4 } as React.CSSProperties}
            className={cn(tile, "col-span-3 flex flex-col justify-between transition-colors hover:bg-surface-hover xl:col-span-2", !unread.length && "pointer-events-none")}
          >
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {unread.length > 0 && <span aria-hidden className="rec-blink size-1.5 rounded-full bg-chili" />}
              Unread
            </p>
            <span className={cn("font-wide text-[56px] leading-none font-bold tracking-[-0.04em] tabular-nums", unread.length ? "text-foreground" : "text-foreground/30")}>
              {unread.length}
            </span>
            <p className="text-[12.5px] text-muted-foreground">{unread.length === 1 ? "thread" : "threads"} with something new</p>
          </Link>

          {/* Who's waiting on an answer. */}
          <Link
            href={requests[0] ? threadHref(requests[0]._id) : "#"}
            style={{ "--i": 5 } as React.CSSProperties}
            className={cn(tile, "col-span-3 flex flex-col justify-between transition-colors hover:bg-surface-hover xl:col-span-2", !requests.length && "pointer-events-none")}
          >
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Requests</p>
            {requests.length ? (
              <span className="relative flex h-10">
                {requests.slice(0, 4).map((r, i) => (
                  <span key={r._id} className="absolute rounded-full ring-[3px] ring-surface-raised" style={{ left: i * 22 }}>
                    <UserAvatar src={threadAvatar(r)} name={threadTitle(r)} size={40} className="size-10" />
                  </span>
                ))}
              </span>
            ) : (
              <span className="font-wide text-[40px] leading-none font-bold tracking-[-0.04em] text-foreground/30">0</span>
            )}
            <p className="text-[12.5px] text-muted-foreground">
              {requests.length ? `${requests.length} waiting for your answer` : "Nobody waiting"}
            </p>
          </Link>

          {/* Who's around. */}
          <div style={{ "--i": 6 } as React.CSSProperties} className={cn(tile, "col-span-6 flex flex-col justify-between md:col-span-3")}>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Active now</p>
            {around.length ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {around.slice(0, 5).map((r) => (
                  <Link key={r._id} href={threadHref(r._id)} className="msg-press group flex flex-col items-center gap-1.5" title={threadTitle(r)}>
                    <span className="relative">
                      <UserAvatar src={threadAvatar(r)} name={threadTitle(r)} size={44} className="size-11" />
                      <span aria-hidden className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-[2.5px] ring-surface-raised" />
                    </span>
                    <span className="max-w-[4rem] truncate text-[11.5px] text-muted-foreground group-hover:text-foreground">{threadTitle(r).split(" ")[0]}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-[14px] leading-relaxed text-muted-foreground">Nobody you talk to is around right now. They&apos;ll show up here the moment they are.</p>
            )}
          </div>

          {/* Calls: what's on, or what's possible. */}
          <div style={{ "--i": 7 } as React.CSSProperties} className={cn(tile, "col-span-6 flex flex-col justify-between md:col-span-3")}>
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Calls</p>
            {calling ? (
              <>
                <p className="mt-3 text-[15px] font-semibold text-foreground">
                  <span aria-hidden className="rec-blink mr-2 inline-block size-2 -translate-y-px rounded-full bg-chili" />A call is on in {threadTitle(calling)}
                </p>
                <Link
                  href={threadHref(calling._id)}
                  className="msg-press mt-4 inline-flex h-9 w-fit items-center gap-2 rounded-full bg-white px-4 text-[13px] font-semibold text-[#0b0708] hover:bg-white/90"
                >
                  {calling.call?.video ? <VideoCamera size={15} weight="fill" /> : <Phone size={15} weight="fill" />}
                  Join
                </Link>
              </>
            ) : (
              <>
                <span className="mt-3 flex gap-2">
                  <span className="flex size-11 items-center justify-center rounded-full bg-control text-foreground">
                    <Phone size={19} />
                  </span>
                  <span className="flex size-11 items-center justify-center rounded-full bg-control text-foreground">
                    <VideoCamera size={19} />
                  </span>
                </span>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">Voice or video, from any thread. It rings in WorldSpace and the app too.</p>
              </>
            )}
          </div>

          {/* The way on air: every quiet screen here offers it. */}
          <div style={{ "--i": 8 } as React.CSSProperties} className={cn(tile, "col-span-6 flex items-center gap-5")}>
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-control text-ember-hi">
              <ChatCircleDots size={22} weight="fill" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-foreground">The best conversations start on air.</p>
              <p className="mt-0.5 text-[13.5px] text-muted-foreground">Go live and your allies can message you straight from your stream.</p>
            </div>
            <GoLiveButton />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The freshest thread, as a little piece of the conversation. */
function LeadGlimpse({ row, meId }: { row: ConversationRow; meId: string | null }) {
  const last = row.lastMessage;
  const mine = Boolean(last && meId && senderIdOf(last.sender) === meId);
  return (
    <div className="mt-5 flex items-end gap-3">
      <UserAvatar src={threadAvatar(row)} name={threadTitle(row)} size={52} className="size-[52px] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate text-[17px] font-semibold text-foreground">{threadTitle(row)}</span>
          <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{shortTime(row.lastMessageAt ?? last?.createdAt)}</span>
        </p>
        {last && (
          <p
            className={cn(
              "mt-2 line-clamp-3 w-fit max-w-full rounded-[22px] px-4 py-2.5 text-[15px] leading-snug",
              mine ? "rounded-br-md bg-ember text-on-ember" : "rounded-bl-md bg-control text-foreground",
            )}
          >
            {describeMessage(last, meId)}
          </p>
        )}
        {row.unreadCount > 1 && (
          <p className="mt-2 text-[12.5px] font-semibold text-chili-hi">+{row.unreadCount - 1} more since</p>
        )}
      </div>
    </div>
  );
}
