"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Broadcast, Info, Phone, VideoCamera } from "@/components/icons";
import { UserAvatar } from "@/components/xtream";
import { cn } from "@/lib/utils";
import { contextHref } from "@/lib/messaging";
import { formatCallClock } from "@/lib/call-manager";
import { Roll } from "./roll";

/**
 * The thread's top bar — sticky glass, the one place glass belongs off the
 * tab bar. Who, and how they are (typing in Ember, active with a green dot);
 * what the thread is about; and the two things you most often want next:
 * call them, or look closer. A call that's already on shows a Chili pill
 * that brings it back; a group call in progress offers Join instead.
 */
export function ThreadHeader({
  title,
  avatar,
  status,
  statusTone,
  online,
  context,
  canCall,
  inCall,
  groupCall,
  detailsOpen,
  onBack,
  onVoiceCall,
  onVideoCall,
  onJoinCall,
  onReturnToCall,
  onToggleDetails,
  menu,
}: {
  title: string;
  avatar: string;
  status: string;
  statusTone: "typing" | "active" | "muted";
  online: boolean;
  context: { kind: string; title?: string; url?: string } | null;
  canCall: boolean;
  /** A call on this thread right now: its clock start (or null while ringing). */
  inCall: { startedAt: number | null } | null;
  /** A group call someone else started, still going. */
  groupCall: { video: boolean } | null;
  detailsOpen: boolean;
  onBack: () => void;
  onVoiceCall: () => void;
  onVideoCall: () => void;
  onJoinCall: () => void;
  onReturnToCall: () => void;
  onToggleDetails: () => void;
  menu: React.ReactNode;
}) {
  const ctx = context?.url ? contextHref(context.url) : null;
  const iconButton =
    "msg-press flex size-10 shrink-0 items-center justify-center rounded-full text-foreground/85 hover:bg-tint/[0.07] hover:text-foreground disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <header className="z-20 shrink-0 bg-background/85 pt-[env(safe-area-inset-top)] shadow-[inset_0_-1px_0_var(--hairline-color)] backdrop-blur-xl">
      <div className="flex h-16 min-w-0 items-center gap-2 px-2 md:gap-3 md:px-4">
        <button type="button" onClick={onBack} aria-label="Back to messages" className={cn(iconButton, "lg:hidden")}>
          <ArrowLeft size={20} />
        </button>

        <button
          type="button"
          onClick={onToggleDetails}
          className="msg-press flex min-w-0 flex-1 items-center gap-3 rounded-control py-1 pr-2 text-left"
          aria-label={`${title} — conversation details`}
        >
          <span className="relative shrink-0">
            <span data-hero-avatar className="block">
              <UserAvatar src={avatar} name={title} size={40} className="size-10" />
            </span>
            {online && (
              <span aria-hidden className="absolute right-0 bottom-0 size-3 rounded-full bg-success ring-[2.5px] ring-background" />
            )}
          </span>
          <span className="min-w-0 leading-tight">
            <span data-hero-name className="block truncate text-[15.5px] font-semibold text-foreground">
              {title}
            </span>
            {/* "Active now" rolls to "typing" and back. */}
            <span aria-live="polite" className="flex text-[12.5px]">
              <Roll value={`${statusTone}|${status}`} render={statusLine} />
            </span>
          </span>
        </button>

        {ctx && context && (
          <ContextChip href={ctx.href} internal={ctx.internal} label={context.title ?? context.kind} kind={context.kind} />
        )}

        {inCall ? (
          <button
            type="button"
            onClick={onReturnToCall}
            className="msg-press flex h-9 shrink-0 items-center gap-2 rounded-full bg-chili px-3.5 text-[13px] font-semibold text-white"
          >
            <span aria-hidden className="rec-blink size-1.5 rounded-full bg-white" />
            {inCall.startedAt ? <CallClock startedAt={inCall.startedAt} /> : "Calling"}
          </button>
        ) : groupCall ? (
          <button
            type="button"
            onClick={onJoinCall}
            className="msg-press flex h-9 shrink-0 items-center gap-2 rounded-full bg-inverse px-4 text-[13px] font-semibold text-on-inverse hover:bg-inverse/90"
          >
            {groupCall.video ? <VideoCamera size={15} weight="fill" /> : <Phone size={15} weight="fill" />}
            Join call
          </button>
        ) : (
          <>
            <button type="button" onClick={onVoiceCall} disabled={!canCall} aria-label="Voice call" title="Voice call" className={iconButton}>
              <Phone size={20} />
            </button>
            <button type="button" onClick={onVideoCall} disabled={!canCall} aria-label="Video call" title="Video call" className={iconButton}>
              <VideoCamera size={21} />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onToggleDetails}
          aria-label="Conversation details"
          aria-pressed={detailsOpen}
          title="Details"
          className={cn(iconButton, "hidden md:flex", detailsOpen && "bg-tint/[0.08] text-foreground")}
        >
          <Info size={20} weight={detailsOpen ? "fill" : undefined} />
        </button>
        {menu}
      </div>
    </header>
  );
}

function statusLine(value: string) {
  const bar = value.indexOf("|");
  const tone = value.slice(0, bar);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5",
        tone === "typing" ? "text-ember-hi" : tone === "active" ? "text-success" : "text-muted-foreground",
      )}
    >
      <span className="truncate">{value.slice(bar + 1)}</span>
      {tone === "typing" && (
        <span aria-hidden className="msg-dots">
          <span />
          <span />
          <span />
        </span>
      )}
    </span>
  );
}

function ContextChip({ href, internal, label, kind }: { href: string; internal: boolean; label: string; kind: string }) {
  const className =
    "msg-press hidden h-8 max-w-[13rem] shrink-0 items-center gap-1.5 rounded-full bg-control px-3 text-[12.5px] text-foreground/90 hover:bg-control-hover xl:inline-flex";
  const body = (
    <>
      <Broadcast size={14} aria-hidden className="shrink-0 text-ember-hi" />
      <span className="truncate">{label}</span>
    </>
  );
  const title = `This conversation started on ${label || `a ${kind}`}`;
  return internal ? (
    <Link href={href} className={className} title={title}>
      {body}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={className} title={title}>
      {body}
    </a>
  );
}

/** The running call's clock, ticking from an effect so render stays pure. */
function CallClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return <span className="tabular-nums">{now ? formatCallClock(now - startedAt) : "0:00"}</span>;
}
