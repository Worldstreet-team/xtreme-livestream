"use client";

import { useEffect, useRef, useState } from "react";
import type { Message, Poll } from "@worldstreet/messaging-sdk";
import {
  ArrowBendUpLeft,
  ChartBar,
  CheckCircle,
  DotsThree,
  Play,
  Smiley,
  WarningCircle,
} from "@/components/icons";
import { UserAvatar, formatUsd } from "@/components/xtream";
import { cn } from "@/lib/utils";
import { clockTime, describeMessage, personName, pollFootnote, senderIdOf } from "@/lib/messaging";
import { FloatingMenu, FloatingReactions, type MessageAction } from "./message-actions";
import { EASE, boxOf, play, type Box } from "./motion";
import { VoiceNote } from "./voice-note";
import { ViaTag } from "./via-tag";

/**
 * One message in a thread.
 *
 * Yours are flat Ember with its dark ink; theirs sit on the quiet control
 * tone. A run from one person groups: the corners that meet tighten, their
 * face shows once at the foot of the run, and in a group their name once
 * at the top. A message that is only an emoji or three drops the bubble
 * and speaks big. Pictures sent together are one album; clips open in the
 * viewer; voice notes play in place.
 *
 * Wide screens: hover shows a quiet toolbar beside the bubble (react,
 * reply, more). Touch: long-press opens the actions sheet, and a swipe to
 * the right replies — the bubble follows your finger on a rubber band, the
 * reply glyph grows and pops as you cross the line, and on release the
 * bubble springs home while its words travel down into the reply bar
 * (the owner's pick, reply C).
 */

/** The words a reply quotes, where they were when you replied. */
export type Quote = { el: HTMLElement; box: Box };

/** A message as the thread holds it: the wire shape plus send state. */
export type ThreadMessage = Message & {
  /** Optimistic: shown before the gateway has answered. */
  pending?: boolean;
  /** The send failed; the row offers a retry. */
  failed?: boolean;
};

const LONG_PRESS_MS = 420;
const SWIPE_REPLY_PX = 56;
const SWIPE_MAX_PX = 84;

/** Up to three emoji and nothing else: said big, without a bubble. */
function bigEmoji(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 16) return false;
  if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+$/u.test(t)) return false;
  if (!/\p{Extended_Pictographic}/u.test(t)) return false;
  const segs = typeof Intl !== "undefined" && "Segmenter" in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t.replace(/\s/g, ""))].length
    : t.replace(/\s/g, "").length / 2;
  return segs >= 1 && segs <= 3 && !/^\d+$/.test(t);
}

/** Text with its links made tappable. */
function Linkified({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,:;"')\]!?])/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "break-all underline decoration-1 underline-offset-2",
              mine ? "decoration-on-ember/50 hover:decoration-on-ember" : "text-ember-hi decoration-ember-hi/40 hover:decoration-ember-hi",
            )}
          >
            {part.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function MessageBubble({
  rowKey,
  m,
  album,
  mine,
  groupedAbove,
  groupedBelow,
  showName,
  meId,
  highlighted,
  via,
  open,
  placeBelow,
  actions,
  onOpen,
  onClose,
  onReact,
  onReply,
  onRetry,
  onJumpTo,
  onVote,
  onOpenMedia,
}: {
  /** The row's key in the thread; the motion reads it. */
  rowKey: string;
  m: ThreadMessage;
  /** Pictures sent together: this row paints all of them. */
  album?: ThreadMessage[];
  mine: boolean;
  groupedAbove: boolean;
  groupedBelow: boolean;
  showName: boolean;
  meId: string | null;
  /** Briefly lit after a jump to it. */
  highlighted: boolean;
  /** "via WorldSpace" when it came from elsewhere (first of a run only). */
  via?: string | null;
  /** Which floating control is open on this message (wide screens). */
  open: "react" | "menu" | null;
  placeBelow: boolean;
  actions: MessageAction[];
  onOpen: (kind: "react" | "menu" | "sheet", placeBelow: boolean) => void;
  onClose: () => void;
  /** `from` is what was tapped (a strip's emoji, a chip): the reaction flies from there. */
  onReact: (emoji: string, from?: HTMLElement) => void;
  /** With the words it quotes, so they can travel into the reply bar. */
  onReply: (quote: Quote | null) => void;
  onRetry: () => void;
  onJumpTo: (messageId: string) => void;
  onVote: (optionIds: string[]) => void;
  onOpenMedia: (messageId: string) => void;
}) {
  const sender = typeof m.sender === "string" ? null : m.sender;
  const removed = Boolean(m.removedBy);
  const items = album && album.length > 1 ? album : null;
  const isMedia = !removed && (m.type === "image" || m.type === "video") && Boolean(m.mediaUrl);
  const isPoll = !removed && m.type === "poll" && Boolean(m.poll);
  const isVoice = !removed && m.type === "audio" && Boolean(m.mediaUrl);
  const emojiOnly = !removed && m.type === "text" && !m.replyTo && bigEmoji(m.content);
  const unframed = ((isMedia || items) && !m.content && !m.replyTo) || isPoll || emojiOnly;
  // A picture with words: the bubble frames it tightly and pads the words.
  const mediaFramed = Boolean(isMedia || items) && !unframed;
  const interactive = !m.pending && !removed;
  const mineEmoji = m.reactions?.find((r) => senderIdOf(r.profile) === meId)?.emoji ?? null;

  const rowRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<HTMLSpanElement>(null);
  const gesture = useRef<{
    x: number;
    y: number;
    timer: ReturnType<typeof setTimeout> | null;
    swiping: boolean;
    fired: boolean;
    /** Past the reply line: the glyph has popped. */
    armed: boolean;
  } | null>(null);

  /** The words, where they are right now. */
  const quote = (): Quote | null => {
    const el = bubbleRef.current?.querySelector<HTMLElement>("[data-words]");
    return el ? { el, box: boxOf(el) } : null;
  };

  // A long-press timer never outlives the bubble.
  useEffect(() => () => {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
  }, []);

  /** Where a floating control should open: below when the bubble is near the top. */
  const placeFor = () => {
    const top = bubbleRef.current?.getBoundingClientRect().top ?? 400;
    return top < 170;
  };

  const setSwipe = (dx: number) => {
    const el = bubbleRef.current;
    if (el) el.style.transform = dx ? `translateX(${dx}px)` : "";
    const g = glyphRef.current;
    if (g) {
      const p = Math.min(1, dx / SWIPE_REPLY_PX);
      g.style.opacity = String(p);
      g.style.transform = `scale(${0.6 + 0.4 * p})`;
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || !interactive) return;
    const start = { x: e.clientX, y: e.clientY };
    gesture.current = {
      ...start,
      swiping: false,
      fired: false,
      armed: false,
      timer: setTimeout(() => {
        if (!gesture.current || gesture.current.swiping) return;
        gesture.current.fired = true;
        navigator.vibrate?.(8);
        onOpen("sheet", false);
      }, LONG_PRESS_MS),
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.swiping && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      if (g.timer) clearTimeout(g.timer);
      g.timer = null;
      // Only a mostly-horizontal drag to the right is a reply swipe.
      if (dx > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        g.swiping = true;
        if (bubbleRef.current) bubbleRef.current.style.transition = "none";
      } else {
        gesture.current = null;
        return;
      }
    }
    if (g.swiping) {
      // Resistance past the line, so it feels tethered.
      const eased = dx < SWIPE_REPLY_PX ? dx : SWIPE_REPLY_PX + (dx - SWIPE_REPLY_PX) * 0.35;
      setSwipe(Math.max(0, Math.min(SWIPE_MAX_PX, eased)));
      // Crossing the line: the glyph pops once and the phone ticks.
      const armed = dx >= SWIPE_REPLY_PX;
      if (armed && !g.armed) {
        navigator.vibrate?.(6);
        play(glyphRef.current, [{ transform: "scale(1)" }, { transform: "scale(1.2)", offset: 0.5 }, { transform: "scale(1)" }], 140, EASE.out);
      }
      g.armed = armed;
    }
  };
  const endGesture = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.timer) clearTimeout(g.timer);
    if (g.swiping) {
      const dx = e.clientX - g.x;
      // The words leave from where the swipe let them go.
      const words = dx >= SWIPE_REPLY_PX ? quote() : null;
      if (bubbleRef.current) bubbleRef.current.style.transition = "transform 0.42s var(--ease-spring), border-radius 0.18s var(--ease-out)";
      setSwipe(0);
      if (dx >= SWIPE_REPLY_PX) onReply(words);
    }
  };

  // Round everywhere, except where a bubble meets its neighbour in a run.
  const corners = mine
    ? cn(groupedAbove && "rounded-tr-md", groupedBelow && "rounded-br-md")
    : cn(groupedAbove && "rounded-tl-md", groupedBelow && "rounded-bl-md");

  const toolButton =
    "msg-press flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-tint/[0.07] hover:text-foreground";
  const toolbar = interactive && (
    <div
      className={cn(
        "absolute top-1/2 z-20 hidden -translate-y-1/2 items-center gap-0.5 rounded-full bg-surface-raised p-0.5 opacity-0 shadow-popover transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100 md:flex",
        mine ? "right-full mr-2" : "left-full ml-2",
        open && "opacity-100",
      )}
    >
      <button
        type="button"
        onClick={() => (open === "react" ? onClose() : onOpen("react", placeFor()))}
        aria-label="React"
        title="React"
        aria-expanded={open === "react"}
        className={cn(toolButton, open === "react" && "bg-tint/[0.08] text-foreground")}
      >
        <Smiley size={16} />
      </button>
      <button type="button" onClick={() => onReply(quote())} aria-label="Reply" title="Reply" className={toolButton}>
        <ArrowBendUpLeft size={16} />
      </button>
      <button
        type="button"
        onClick={() => (open === "menu" ? onClose() : onOpen("menu", placeFor()))}
        aria-label="More"
        title="More"
        aria-expanded={open === "menu"}
        className={cn(toolButton, open === "menu" && "bg-tint/[0.08] text-foreground")}
      >
        <DotsThree size={16} weight="bold" />
      </button>
    </div>
  );

  return (
    <div
      ref={rowRef}
      id={`m-${m._id}`}
      data-row={rowKey}
      data-msg="1"
      data-from={senderIdOf(m.sender)}
      data-mine={mine ? "1" : undefined}
      data-client-key={m.clientKey}
      className={cn(
        "group/msg relative flex items-end gap-2 [touch-action:pan-y]",
        mine ? "justify-end" : "justify-start",
        groupedAbove ? "mt-[3px]" : "mt-3",
        highlighted && "msg-flash",
      )}
    >
      {!mine && (
        <span className="w-7 shrink-0 self-end">
          {!groupedBelow && sender && (
            // Their face sits at the foot of their run and follows it down.
            <span data-face={sender._id} className="block">
              <UserAvatar src={sender.avatar ?? ""} name={personName(sender)} size={28} className="size-7" />
            </span>
          )}
        </span>
      )}

      <div className={cn("relative flex max-w-[80%] min-w-0 flex-col md:max-w-[66%]", mine ? "items-end" : "items-start")}>
        {showName && sender && <p className="mb-1 ml-3.5 text-[12px] font-semibold text-muted-foreground">{personName(sender)}</p>}

        <div className="relative max-w-full">
          {/* The reply glyph a swipe fills in. */}
          <span
            ref={glyphRef}
            aria-hidden
            className="pointer-events-none absolute top-1/2 -left-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-control text-foreground opacity-0 md:hidden"
          >
            <ArrowBendUpLeft size={16} />
          </span>

          {removed ? (
            // An admin took it down for everyone: the row stays, the words don't.
            <p data-bubble className={cn("rounded-[22px] bg-tint/[0.03] px-4 py-2.5 text-[14px] text-muted-foreground italic", corners)}>
              Message removed by an admin
            </p>
          ) : (
            <div
              ref={bubbleRef}
              data-bubble
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
              onContextMenu={(e) => {
                // Desktop right-click opens the menu; touch long-press has its own path.
                if (!interactive || window.matchMedia("(pointer: coarse)").matches) return;
                e.preventDefault();
                onOpen("menu", placeFor());
              }}
              title={clockTime(m.createdAt)}
              className={cn(
                "relative min-w-0 text-[15px] leading-[1.38] break-words whitespace-pre-wrap select-text",
                unframed
                  ? cn(!emojiOnly && "overflow-hidden rounded-[20px]")
                  : cn(
                      "rounded-[22px]",
                      mediaFramed ? "p-1" : isVoice ? "px-2.5 py-2" : "px-4 py-2.5",
                      mine ? "bg-ember text-on-ember" : "bg-control text-foreground",
                    ),
                !emojiOnly && cn("msg-corners", corners),
                m.pending && "msg-pending",
              )}
            >
              {via && !unframed && (
                <ViaTag label={via} tone={mine ? "on-ember" : "muted"} className={cn("mb-1 flex", mediaFramed && "px-2 pt-1")} />
              )}
              {m.replyTo && <ReplyQuote reply={m.replyTo} onMine={mine} onJump={() => onJumpTo(m.replyTo!._id)} />}
              {items ? (
                <Album items={items} onOpen={onOpenMedia} framed={!unframed} />
              ) : (
                isMedia && <MediaBody m={m} framed={!unframed} onOpen={() => onOpenMedia(m._id)} />
              )}
              {isVoice && <VoiceNote id={m._id} src={m.mediaUrl!} durationSec={m.durationSec} peaks={m.peaks} mine={mine} />}
              {isPoll && <PollCard poll={m.poll!} disabled={Boolean(m.pending)} onVote={onVote} />}
              {m.type === "payment" && typeof m.amountMinor === "number" && (
                // Money reads in gold, wherever it is.
                <p className="font-semibold">
                  <span className={mine ? "" : "text-value"}>{formatUsd(m.amountMinor)}</span>
                  <span className={cn("ml-1.5 font-normal", mine ? "text-on-ember/75" : "text-muted-foreground")}>{payeeLine(m, mine, meId)}</span>
                </p>
              )}
              {emojiOnly ? (
                <p data-words className="px-1 text-[44px] leading-[1.15] select-text">
                  {m.content}
                </p>
              ) : (
                m.content &&
                !isPoll &&
                m.type !== "payment" && (
                  <p data-words className={cn(mediaFramed && "px-2.5 pt-1.5 pb-1")}>
                    <Linkified text={m.content} mine={mine} />
                  </p>
                )
              )}
              {!m.content && !isMedia && !items && !isPoll && !isVoice && m.type !== "text" && m.type !== "payment" && (
                <p className="italic opacity-80">{describeMessage(m)}</p>
              )}
            </div>
          )}

          {toolbar}
          {open === "react" && (
            <FloatingReactions
              mineEmoji={mineEmoji}
              onReact={(e, from) => (onReact(e, from), onClose())}
              onClose={onClose}
              align={mine ? "end" : "start"}
              below={placeBelow}
            />
          )}
          {open === "menu" && <FloatingMenu items={actions} onClose={onClose} align={mine ? "end" : "start"} below={placeBelow} />}
        </div>

        {!removed && m.reactions && m.reactions.length > 0 && (
          <Reactions reactions={m.reactions} meId={meId} onReact={onReact} alignEnd={mine} />
        )}

        {via && unframed && <ViaTag label={via} className={cn("mt-1 px-1.5", mine && "self-end")} />}

        {(m.editedAt || m.failed) && !removed && (
          <p className={cn("mt-1 flex items-center gap-1.5 px-1.5 text-[11px] text-muted-foreground", mine ? "justify-end" : "justify-start")}>
            {m.failed ? (
              <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold text-chili-hi hover:underline">
                <WarningCircle size={12} aria-hidden />
                Not sent · Tap to retry
              </button>
            ) : (
              <span>Edited</span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/** "sent to Ada", "sent to you". In a DM someone else's payment is to you;
 *  in a group it names whoever it went to. */
function payeeLine(m: Message, mine: boolean, meId: string | null): string {
  const payee = mine || (m.payTo && m.payTo !== meId) ? m.payToName : "you";
  return payee ? `sent to ${payee}` : "sent";
}

/** The message this one answers, quoted at the top of the bubble. */
function ReplyQuote({ reply, onMine, onJump }: { reply: NonNullable<Message["replyTo"]>; onMine: boolean; onJump: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onJump();
      }}
      className={cn(
        "mb-2 flex w-full gap-2 rounded-[14px] py-1.5 pr-3 pl-2 text-left transition-colors",
        onMine ? "bg-on-ember/[0.12] hover:bg-on-ember/[0.18]" : "bg-tint/[0.06] hover:bg-tint/[0.09]",
      )}
    >
      <span aria-hidden className={cn("w-[3px] shrink-0 rounded-full", onMine ? "bg-on-ember/60" : "bg-ember")} />
      <span className="min-w-0">
        <span className={cn("block text-[12px] font-semibold", onMine ? "text-on-ember" : "text-ember-hi")}>
          {personName(reply.sender) || "Message"}
        </span>
        <span className={cn("line-clamp-2 block text-[13px]", onMine ? "text-on-ember/80" : "text-muted-foreground")}>
          {describeMessage(reply)}
        </span>
      </span>
    </button>
  );
}

/** One picture or clip. Clips show their first frame and open in the viewer. */
function MediaBody({ m, framed, onOpen }: { m: Message; framed: boolean; onOpen: () => void }) {
  const ratio = m.width && m.height ? `${m.width} / ${m.height}` : undefined;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      aria-label={m.type === "video" ? "Open clip" : "Open photo"}
      data-media-id={m._id}
      className={cn("relative block max-h-[420px] w-[min(18.5rem,64vw)] overflow-hidden bg-black/40", framed && "rounded-[18px]")}
      style={{ aspectRatio: ratio ?? (m.type === "video" ? "9 / 12" : "4 / 5") }}
    >
      {m.type === "video" ? (
        <>
          <video src={m.mediaUrl} muted playsInline preload="metadata" className="pointer-events-none size-full object-cover" />
          <span className="obj absolute top-1/2 left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-white">
            <Play size={20} weight="fill" className="translate-x-0.5" />
          </span>
          {typeof m.durationSec === "number" && (
            <span className="obj absolute right-2 bottom-2 rounded-full px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
              {Math.floor(m.durationSec / 60)}:{String(Math.round(m.durationSec % 60)).padStart(2, "0")}
            </span>
          )}
        </>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.mediaUrl} alt="" loading="lazy" className="size-full object-cover" draggable={false} />
      )}
    </button>
  );
}

/** Pictures sent together, as one tight grid; the last tile counts the rest. */
function Album({ items, onOpen, framed }: { items: ThreadMessage[]; onOpen: (id: string) => void; framed: boolean }) {
  const shown = items.slice(0, 4);
  const more = items.length - shown.length;
  const layout = shown.length === 2 ? "grid-cols-2" : shown.length === 3 ? "grid-cols-2 [&>*:first-child]:row-span-2" : "grid-cols-2";
  return (
    <div className={cn("grid w-[min(18.5rem,64vw)] gap-0.5 overflow-hidden", layout, framed && "rounded-[18px]")}>
      {shown.map((it, i) => (
        <button
          key={it._id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(it._id);
          }}
          aria-label={`Open photo ${i + 1} of ${items.length}`}
          data-media-id={it._id}
          className={cn("relative overflow-hidden bg-black/40", shown.length === 3 && i === 0 ? "aspect-[1/2]" : "aspect-square")}
        >
          {it.type === "video" ? (
            <video src={it.mediaUrl} muted playsInline preload="metadata" className="pointer-events-none size-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.mediaUrl} alt="" loading="lazy" className="size-full object-cover" draggable={false} />
          )}
          {i === shown.length - 1 && more > 0 && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/55 font-wide text-[22px] font-bold text-white">
              +{more}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * A poll, voted on in place. Results show once you've voted or it's over
 * (so the first votes aren't herded by the early count); your picks carry
 * the Ember selected state. Tapping your only pick takes the vote back.
 */
function PollCard({ poll, disabled, onVote }: { poll: Poll; disabled: boolean; onVote: (optionIds: string[]) => void }) {
  const mine = poll.mine ?? [];
  // Read once when the card mounts; "ends in" won't drift in a way that matters.
  const [openedAt] = useState(() => Date.now());
  const closed = Boolean(poll.endsAt && new Date(poll.endsAt).getTime() <= openedAt);
  const showResults = closed || mine.length > 0;
  const total = poll.total ?? 0;

  const pick = (id: string) => {
    if (disabled || closed) return;
    if (poll.multi) onVote(mine.includes(id) ? mine.filter((x) => x !== id) : [...mine, id]);
    else onVote(mine.includes(id) ? [] : [id]);
  };

  return (
    <div className="w-[min(20rem,72vw)] bg-control p-4 text-foreground" onClick={(e) => e.stopPropagation()}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        <ChartBar size={13} aria-hidden />
        {poll.multi ? "Poll · pick any" : "Poll"}
      </p>
      <p className="mt-1.5 text-[16px] leading-snug font-semibold">{poll.question}</p>
      <ul className="mt-3.5 space-y-1.5">
        {poll.options.map((o) => {
          const count = poll.counts?.[o.id] ?? 0;
          const pct = total ? Math.round((count / total) * 100) : 0;
          const picked = mine.includes(o.id);
          return (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => pick(o.id)}
                disabled={disabled || closed}
                aria-pressed={picked}
                className={cn(
                  "msg-press relative flex min-h-11 w-full items-center gap-2.5 overflow-hidden rounded-control bg-tint/[0.04] px-3 py-2 text-left text-[14px] enabled:hover:bg-tint/[0.07] disabled:cursor-default",
                  picked && "shadow-[inset_0_0_0_1.5px_var(--ember)]",
                )}
              >
                {showResults && (
                  <span
                    aria-hidden
                    className={cn("absolute inset-y-0 left-0 transition-[width] duration-700", picked ? "bg-ember/25" : "bg-tint/[0.07]")}
                    style={{ width: `${pct}%`, transitionTimingFunction: "var(--ease-out)" }}
                  />
                )}
                <span className="relative flex size-4 shrink-0 items-center justify-center">
                  {picked ? (
                    <CheckCircle size={16} weight="fill" className="msg-pop text-ember-hi" aria-hidden />
                  ) : (
                    <span aria-hidden className="size-3.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--border-control)]" />
                  )}
                </span>
                <span className="relative min-w-0 flex-1 break-words">{o.text}</span>
                {showResults && <span className="relative shrink-0 text-[12.5px] font-semibold text-muted-foreground tabular-nums">{pct}%</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11.5px] text-muted-foreground">{pollFootnote(poll, openedAt)}</p>
    </div>
  );
}

/** Reactions under a bubble, one chip per emoji; yours sit on Ember. A chip
 *  that arrives while you watch pops in; a count that changes rolls. */
function Reactions({
  reactions,
  meId,
  onReact,
  alignEnd,
}: {
  reactions: NonNullable<Message["reactions"]>;
  meId: string | null;
  onReact: (emoji: string, from?: HTMLElement) => void;
  alignEnd: boolean;
}) {
  const byEmoji = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const e = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
    e.count += 1;
    if (meId && senderIdOf(r.profile) === meId) e.mine = true;
    byEmoji.set(r.emoji, e);
  }
  return (
    <div className={cn("relative z-[1] -mt-2 flex flex-wrap gap-1 px-2", alignEnd ? "justify-end" : "justify-start")}>
      {[...byEmoji].map(([emoji, { count, mine }]) => (
        <button
          key={emoji}
          type="button"
          data-reaction={emoji}
          onClick={(e) => onReact(emoji, e.currentTarget)}
          aria-pressed={mine}
          aria-label={`${emoji} ${count}${mine ? ", yours — tap to remove" : ""}`}
          className={cn(
            "msg-press msg-pop inline-flex h-7 items-center gap-1 rounded-full px-2 text-[14px] ring-[3px] ring-background",
            mine ? "bg-ember/25" : "bg-surface-raised",
          )}
        >
          <span data-reaction-glyph aria-hidden>
            {emoji}
          </span>
          {count > 1 && (
            <span key={count} className="msg-pop text-[11.5px] font-semibold text-foreground/80 tabular-nums">
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Three dots while they type; a mic while they record. The bubble grows out
 * of their corner on the spring and the dots wave; when their words arrive
 * this same bubble stretches into the message (thread-motion.ts). If they
 * stop instead, it shrinks back into its corner and goes.
 */
export function TypingBubble({
  recording,
  leaving,
  joins,
  face,
}: {
  recording?: boolean;
  /** They stopped: shrinking away. */
  leaving?: boolean;
  /** It continues their run: tighter corner, and it carries their face. */
  joins?: boolean;
  face?: { id: string; src: string; name: string } | null;
}) {
  return (
    <div
      data-row="typing"
      data-from={face?.id}
      data-leaving={leaving ? "1" : undefined}
      className={cn("flex items-end gap-2", joins ? "mt-[3px]" : "mt-3")}
      aria-live="polite"
    >
      <span className="w-7 shrink-0 self-end">
        {face && (
          <span data-face={face.id} className="block">
            <UserAvatar src={face.src} name={face.name} size={28} className="size-7" />
          </span>
        )}
      </span>
      <div
        data-typing-bubble
        className={cn(
          "flex h-10 items-center gap-2 rounded-[22px] bg-control px-4 text-muted-foreground",
          joins && "rounded-tl-md",
          leaving ? "msg-typing-out" : "msg-typing-in",
        )}
      >
        <span className="sr-only">{recording ? "Recording a voice note" : "Typing"}</span>
        {recording && <span aria-hidden className="rec-blink size-2 rounded-full bg-chili" />}
        <span aria-hidden className="msg-dots msg-wave">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
