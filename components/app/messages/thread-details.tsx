"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Message } from "@worldstreet/messaging-sdk";
import { Archive, Broadcast, MagnifyingGlass, Phone, Play, SignOut, Trash, VideoCamera, X } from "@/components/icons";
import { UserAvatar } from "@/components/xtream";
import { cn } from "@/lib/utils";
import { contextHref, messaging } from "@/lib/messaging";
import type { ViewerItem } from "./media-viewer";

type MuteChoice = "on" | "8h" | "1w" | "forever";

const MUTE_CHOICES: { id: MuteChoice; label: string }[] = [
  { id: "on", label: "On" },
  { id: "8h", label: "8 hours" },
  { id: "1w", label: "1 week" },
  { id: "forever", label: "Off" },
];

/**
 * The thread, looked at closely: who it's with, the three things you do
 * most (call, video, find), how loudly it may reach you, where it started,
 * everything you've shared, and the ways out. Beside the thread on a wide
 * screen; the whole screen on a phone.
 */
export function ThreadDetails({
  conversationId,
  title,
  avatar,
  subtitle,
  online,
  isGroup,
  owner,
  archived,
  context,
  canCall,
  onVoiceCall,
  onVideoCall,
  onSearch,
  onMute,
  onArchive,
  onDelete,
  onOpenMedia,
  onClose,
}: {
  conversationId: string;
  title: string;
  avatar: string;
  subtitle: string;
  online: boolean;
  isGroup: boolean;
  owner: boolean;
  archived: boolean;
  context: { kind: string; title?: string; url?: string } | null;
  canCall: boolean;
  onVoiceCall: () => void;
  onVideoCall: () => void;
  onSearch: () => void;
  onMute: (until: "8h" | "1w" | "forever" | null) => Promise<boolean>;
  onArchive: () => void;
  onDelete: () => void;
  onOpenMedia: (items: ViewerItem[], index: number) => void;
  onClose: () => void;
}) {
  const [media, setMedia] = useState<ViewerItem[] | null>(null);
  const [mute, setMute] = useState<MuteChoice>("on");
  const ctx = context?.url ? contextHref(context.url) : null;

  // Everything shared in the thread: photos and clips, newest first.
  useEffect(() => {
    let cancelled = false;
    const toItem = (m: Message): ViewerItem | null =>
      m.mediaUrl && (m.type === "image" || m.type === "video")
        ? {
            id: m._id,
            url: m.mediaUrl,
            type: m.type,
            who: typeof m.sender === "string" ? title : `${m.sender.firstName ?? ""} ${m.sender.lastName ?? ""}`.trim() || m.sender.username,
            at: m.createdAt,
            caption: m.content || undefined,
          }
        : null;
    void Promise.all([
      messaging.conversations.media(conversationId, { kind: "image", limit: 30 }).catch(() => [] as Message[]),
      messaging.conversations.media(conversationId, { kind: "video", limit: 30 }).catch(() => [] as Message[]),
    ]).then(([images, videos]) => {
      if (cancelled) return;
      const items = [...images, ...videos]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(toItem)
        .filter((x): x is ViewerItem => Boolean(x));
      setMedia(items);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId, title]);

  const chooseMute = async (choice: MuteChoice) => {
    const prev = mute;
    setMute(choice);
    const ok = await onMute(choice === "on" ? null : choice);
    if (!ok) setMute(prev);
  };

  const tile =
    "msg-press flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-panel bg-surface-raised text-[12.5px] font-medium text-foreground/90 hover:bg-surface-hover disabled:opacity-40";

  return (
    <aside aria-label="Conversation details" className="msg-fade flex h-full w-full flex-col overflow-y-auto overscroll-contain bg-background">
      <div className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between bg-background/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <p className="text-[15px] font-semibold text-foreground">Details</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="msg-press flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        >
          <X size={17} />
        </button>
      </div>

      <div className="flex flex-col items-center px-6 pt-2 pb-6 text-center">
        <span className="relative">
          <UserAvatar src={avatar} name={title} size={92} className="size-[92px]" />
          {online && <span aria-hidden className="absolute right-1 bottom-1 size-4 rounded-full bg-success ring-[3px] ring-background" />}
        </span>
        <h2 className="mt-4 font-wide text-[22px] leading-tight font-bold tracking-[-0.02em] text-foreground">{title}</h2>
        <p className={cn("mt-1 text-[13px]", online ? "text-success" : "text-muted-foreground")}>{subtitle}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 px-4">
        <button type="button" onClick={onVoiceCall} disabled={!canCall} className={tile}>
          <Phone size={21} />
          Call
        </button>
        <button type="button" onClick={onVideoCall} disabled={!canCall} className={tile}>
          <VideoCamera size={21} />
          Video
        </button>
        <button type="button" onClick={onSearch} className={tile}>
          <MagnifyingGlass size={21} />
          Search
        </button>
      </div>

      <section className="mt-6 px-4">
        <p className="mb-2 px-1 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Notifications</p>
        <div role="radiogroup" aria-label="Notifications" className="grid grid-cols-4 gap-1 rounded-full bg-surface-raised p-1">
          {MUTE_CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={mute === c.id}
              onClick={() => void chooseMute(c.id)}
              className={cn(
                "msg-press h-9 rounded-full text-[12.5px] font-semibold transition-colors",
                mute === c.id ? "bg-white text-[#0b0708]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </section>

      {context && (
        <section className="mt-6 px-4">
          <div className="rounded-panel bg-surface-raised p-4">
            <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Started from</p>
            <p className="mt-1.5 flex items-center gap-2 text-[15px] font-semibold text-foreground">
              <Broadcast size={16} className="shrink-0 text-ember-hi" aria-hidden />
              <span className="truncate">{context.title ?? `A ${context.kind}`}</span>
            </p>
            {ctx &&
              (ctx.internal ? (
                <Link href={ctx.href} className="mt-3 inline-flex text-[13px] font-semibold text-ember-hi hover:underline">
                  Open the {context.kind}
                </Link>
              ) : (
                <a href={ctx.href} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-[13px] font-semibold text-ember-hi hover:underline">
                  Open the {context.kind}
                </a>
              ))}
          </div>
        </section>
      )}

      <section className="mt-6 px-4">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <p className="text-[11px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Photos & clips</p>
          {media && media.length > 0 && <span className="text-[12px] text-muted-foreground tabular-nums">{media.length}</span>}
        </div>
        {media === null ? (
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className="aspect-square animate-pulse rounded-md bg-white/[0.04]" />
            ))}
          </div>
        ) : media.length === 0 ? (
          <p className="rounded-panel bg-white/[0.03] px-4 py-6 text-center text-[13px] text-muted-foreground">
            Photos and clips you share here collect in one place.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {media.slice(0, 12).map((it, i) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onOpenMedia(media, i)}
                aria-label={`Open ${it.type === "video" ? "clip" : "photo"} from ${it.who}`}
                style={{ "--i": i } as React.CSSProperties}
                className="msg-rise relative aspect-square overflow-hidden rounded-md bg-black/40"
              >
                {it.type === "video" ? (
                  <>
                    <video src={it.url} muted preload="metadata" className="pointer-events-none size-full object-cover" />
                    <span className="obj absolute right-1 bottom-1 flex size-5 items-center justify-center rounded-full text-white">
                      <Play size={9} weight="fill" />
                    </span>
                  </>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.url} alt="" loading="lazy" className="size-full object-cover transition-transform duration-300 hover:scale-105" />
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <p className="mx-4 mt-6 rounded-panel bg-white/[0.03] px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
        This thread is shared with WorldSpace: the same messages, calls and media, in the web app and on the phone app too.
      </p>

      <section className="mt-4 mb-8 px-2 pb-[env(safe-area-inset-bottom)]">
        <button
          type="button"
          onClick={onArchive}
          className="flex w-full items-center gap-3 rounded-control px-3 py-3 text-left text-[14.5px] text-foreground/90 hover:bg-white/[0.04]"
        >
          <Archive size={19} aria-hidden />
          {archived ? "Move to inbox" : "Archive"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex w-full items-center gap-3 rounded-control px-3 py-3 text-left text-[14.5px] text-chili-hi hover:bg-chili/10"
        >
          {isGroup && !owner ? <SignOut size={19} aria-hidden /> : <Trash size={19} aria-hidden />}
          {isGroup && !owner ? "Leave group" : isGroup ? "Delete group" : "Delete conversation"}
        </button>
      </section>
    </aside>
  );
}
