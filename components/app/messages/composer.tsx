"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowBendUpLeft, Check, Microphone, PaperPlaneRight, PencilSimple, Plus, WarningCircle, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import {
  CANCEL_PX,
  HoldRecorder,
  LOCK_PX,
  LockHint,
  RecorderBar,
  useVoiceRecorder,
  type Level as VoiceLevel,
  type VoiceClip,
} from "./voice-recorder";
import { EASE, done, ghost, handOff, play, receive, reducedMotion } from "./motion";
import { COMPOSER_LAUNCH, REPLY_QUOTE, type Launch } from "./thread-motion";
import type { Quote } from "./message-bubble";

/**
 * The thread's foot.
 *
 * One row: add, the field, and one button that is a mic until there is
 * something to send and a send button once there is — the grammar every
 * chat app has taught. Photos and clips go several at a time (they arrive
 * as one album); a reply or an edit sits above the field. Hold the mic to
 * talk (slide left to cancel, up to lock), or tap it to record hands-free,
 * when the recorder takes the row. Enter sends, Shift+Enter breaks the
 * line, Escape backs out of a reply or an edit.
 */

export interface Attachment {
  id: string;
  file: File;
  /** Local preview while it uploads (and after, until the thread has a URL). */
  previewUrl: string;
  kind: "image" | "video";
  /** The storage key once uploaded; null while in flight. */
  key: string | null;
  failed?: boolean;
  width?: number;
  height?: number;
}

export const MAX_ATTACHMENTS = 10;

/**
 * The quoted words' trip into the reply bar: a copy leaves the message (from
 * where the swipe let go), shrinks to the bar's size and quiets to its
 * colour on the way down. A paragraph doesn't travel; the bar says it.
 */
function landQuote(quote: Quote, target: HTMLElement) {
  if (reducedMotion() || !quote.el.isConnected) return;
  const from = getComputedStyle(quote.el);
  const line = parseFloat(from.lineHeight) || 20;
  if (quote.box.height > line * 2.2) return;
  const scale = (parseFloat(getComputedStyle(target).fontSize) || 13) / (parseFloat(from.fontSize) || 15);
  const to = target.getBoundingClientRect();
  const copy = ghost(quote.el, { left: quote.box.left, top: quote.box.top, width: Math.min(quote.box.width, to.width / scale), height: line });
  Object.assign(copy.style, { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" });
  target.style.visibility = "hidden";
  const flight = play(
    copy,
    [
      { transform: "none", color: from.color },
      { transform: `translate(${to.left - quote.box.left}px, ${to.top - quote.box.top}px) scale(${scale})`, color: getComputedStyle(target).color },
    ],
    360,
    EASE.glide,
    0,
    { fill: "forwards" },
  );
  void done(flight).then(() => {
    target.style.visibility = "";
    copy.remove();
  });
}

export function Composer({
  draft,
  onDraft,
  onSend,
  sending,
  replyingTo,
  onCancelReply,
  editing,
  onCancelEdit,
  attachments,
  onPickFiles,
  onRemoveAttachment,
  onSendVoice,
  onRecording,
  placeholder,
  disabled,
  locked,
}: {
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  /** "Ada: see you at 8" — set while answering a message. */
  replyingTo: { name: string; snippet: string } | null;
  onCancelReply: () => void;
  editing: boolean;
  onCancelEdit: () => void;
  attachments: Attachment[];
  onPickFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  onSendVoice: (clip: VoiceClip) => void;
  /** So the thread can tell the other side you're recording. */
  onRecording: (active: boolean) => void;
  placeholder: string;
  disabled?: boolean;
  /** A sentence instead of the field, when you can't write here. */
  locked?: string | null;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Just sent: the placeholder waits until the words have lifted off the field.
  const [launching, setLaunching] = useState(false);
  useEffect(() => {
    if (!launching) return;
    const t = setTimeout(() => setLaunching(false), 280);
    return () => clearTimeout(t);
  }, [launching]);

  // At the five-minute limit the note sends itself; the recorder calls this.
  const onLimitRef = useRef<() => void>(() => {});
  const voice = useVoiceRecorder(useCallback(() => onLimitRef.current(), []));

  /**
   * The mic, in hand: held down (with how far the thumb has slid), hands-free
   * once locked or tapped, or on its way out — into the bin, or folding back
   * into the mic as the note sends.
   */
  const [rec, setRec] = useState<"idle" | "hold" | "locked" | "cancel" | "send">("idle");
  const [slide, setSlide] = useState({ dx: 0, dy: 0 });
  // The take as it was when you let go or threw it away, for its way out.
  const [take, setTake] = useState<{ levels: VoiceLevel[]; elapsed: number }>({ levels: [], elapsed: 0 });
  const press = useRef<{ id: number; x: number; y: number; at: number; up: boolean; take: number } | null>(null);
  const takes = useRef(0);

  const stopAndSend = async (keep: boolean) => {
    const clip = await voice.stop(keep);
    onRecording(false);
    if (clip) onSendVoice(clip);
  };
  const finishVoice = (keep: boolean) => {
    setRec("idle");
    void stopAndSend(keep);
  };
  const startHandsFree = async () => {
    if (await voice.start()) {
      onRecording(true);
      setRec("locked");
    }
  };
  const beginHold = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || disabled || rec !== "idle") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const take = ++takes.current;
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), up: false, take };
    setSlide({ dx: 0, dy: 0 });
    setRec("hold");
    void voice.start().then((ok) => {
      // Thrown away before the mic even opened: close it again.
      if (takes.current !== take) return void (ok && voice.stop(false));
      if (!ok) {
        press.current = null;
        return setRec("idle");
      }
      onRecording(true);
      // Let go already — a tap, or a permission prompt took the press: hands-free.
      if (!press.current || press.current.up) {
        press.current = null;
        setRec("locked");
      }
    });
  };
  const moveHold = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId || p.up) return;
    const dx = Math.min(0, e.clientX - p.x);
    const dy = Math.min(0, e.clientY - p.y);
    if (dx <= -CANCEL_PX) {
      // Slid away: into the bin.
      press.current = null;
      takes.current++;
      navigator.vibrate?.(8);
      setTake({ levels: voice.levels, elapsed: voice.elapsed });
      setRec("cancel");
      void voice.stop(false).then(() => onRecording(false));
      return;
    }
    if (dy <= -LOCK_PX && voice.recording) {
      press.current = null;
      navigator.vibrate?.(8);
      setRec("locked");
      return;
    }
    setSlide({ dx, dy });
  };
  const endHold = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    p.up = true;
    if (!voice.recording) return; // still opening the mic: it goes hands-free once it has
    press.current = null;
    if (performance.now() - p.at < 300) return setRec("locked"); // a tap
    setTake({ levels: voice.levels, elapsed: voice.elapsed });
    setRec("send");
    void stopAndSend(true);
  };
  // The browser took the gesture: keep the take, hands-free, rather than send it.
  const loseHold = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    p.up = true;
    if (!voice.recording) return;
    press.current = null;
    setRec("locked");
  };

  useEffect(() => {
    onLimitRef.current = () => {
      if (rec === "hold") {
        press.current = null;
        setTake({ levels: voice.levels, elapsed: voice.elapsed });
        setRec("send");
        void stopAndSend(true);
      } else finishVoice(true);
    };
  });

  // Grow with the text, up to five lines.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [draft]);

  // Starting a reply or an edit puts you straight in the field.
  useEffect(() => {
    if (replyingTo || editing) fieldRef.current?.focus();
  }, [replyingTo, editing]);

  // A reply's words travel down from the message into the bar (measured
  // where the bar will rest, before it starts to grow)...
  const replyKey = replyingTo ? `${replyingTo.name}|${replyingTo.snippet}` : null;
  const snippetRef = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const quote = replyKey ? receive<Quote>(REPLY_QUOTE) : null;
    if (quote && snippetRef.current) landQuote(quote, snippetRef.current);
  }, [replyKey]);

  // ...and the bar grows up out of the field, pushing the thread up with it
  // rather than cutting its last lines off at once (the owner's pick, reply C).
  const barOpen = Boolean(replyingTo || editing);
  const barRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const shell = barRef.current;
    if (!barOpen || !shell) return;
    const height = shell.offsetHeight;
    shell.style.overflow = "hidden";
    const grow = play(shell, [{ height: "0px" }, { height: `${height}px` }], 280, EASE.out);
    play(shell.firstElementChild, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], 280, EASE.out);
    void done(grow).then(() => (shell.style.overflow = ""));
  }, [barOpen]);

  /** Send, and tell the thread where the words sat so they can fly from here. */
  const submit = () => {
    const el = fieldRef.current;
    const text = draft.trim();
    if (el && text && !editing && !attachments.length) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const left = r.left + (parseFloat(cs.paddingLeft) || 0);
      const top = r.top + (parseFloat(cs.paddingTop) || 0) - el.scrollTop;
      handOff<Launch>(COMPOSER_LAUNCH, { text, from: { left, top, width: r.right - left, height: r.bottom - top } });
      setLaunching(true);
    }
    onSend();
  };

  const uploading = attachments.some((a) => !a.key && !a.failed);
  const ready = attachments.filter((a) => a.key);
  const hasContent = draft.trim().length > 0 || ready.length > 0;
  const canSend = !disabled && !sending && !uploading && hasContent;

  if (locked) {
    return (
      <div className="px-4 pt-2 pb-[max(env(safe-area-inset-bottom),16px)] md:px-6 md:pb-5">
        <p className="rounded-[20px] bg-white/[0.04] px-4 py-3 text-center text-[13.5px] text-muted-foreground">{locked}</p>
      </div>
    );
  }

  return (
    <div className="px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] md:px-5 md:pb-5">
      {(replyingTo || editing) && (
        <div ref={barRef} className="pb-2">
          <div className="flex items-center gap-3 rounded-[18px] bg-white/[0.04] py-2 pr-1.5 pl-3.5">
            <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full bg-ember" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ember-hi">
                {editing ? <PencilSimple size={13} aria-hidden /> : <ArrowBendUpLeft size={13} aria-hidden />}
                {editing ? "Editing your message" : `Replying to ${replyingTo?.name}`}
              </p>
              {!editing && replyingTo && (
                <p ref={snippetRef} className="mt-0.5 truncate text-[13px] text-muted-foreground">
                  {replyingTo.snippet}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={editing ? onCancelEdit : onCancelReply}
              aria-label={editing ? "Cancel edit" : "Cancel reply"}
              className="msg-press flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="msg-lift mb-2 flex gap-2 overflow-x-auto pb-0.5">
          {attachments.map((a) => {
            const pending = !a.key && !a.failed;
            return (
              <div key={a.id} className="relative size-[72px] shrink-0 overflow-hidden rounded-[14px] bg-black">
                {a.kind === "video" ? (
                  <video src={a.previewUrl} muted playsInline className="size-full object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.previewUrl} alt="" className="size-full object-cover" />
                )}
                {(pending || a.failed) && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/55">
                    {a.failed ? (
                      <WarningCircle size={20} className="text-chili-hi" aria-label="Upload failed" />
                    ) : (
                      <span aria-label="Uploading" className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    )}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(a.id)}
                  aria-label="Remove"
                  className="obj absolute top-1 right-1 flex size-6 items-center justify-center rounded-full text-white"
                >
                  <X size={12} weight="bold" />
                </button>
              </div>
            );
          })}
          {attachments.length < MAX_ATTACHMENTS && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Add more"
              className="msg-press flex size-[72px] shrink-0 items-center justify-center rounded-[14px] bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07] hover:text-foreground"
            >
              <Plus size={20} />
            </button>
          )}
        </div>
      )}

      {voice.error && (
        <p role="alert" className="msg-fade mb-2 flex items-center gap-1.5 px-2 text-[12.5px] text-chili-hi">
          <WarningCircle size={14} aria-hidden />
          {voice.error}
          <button type="button" onClick={voice.clearError} className="ml-auto text-muted-foreground hover:text-foreground">
            Dismiss
          </button>
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onPickFiles(files);
          e.target.value = "";
        }}
      />

      {rec === "locked" && voice.recording ? (
        <RecorderBar elapsed={voice.elapsed} levels={voice.levels} onCancel={() => finishVoice(false)} onSend={() => finishVoice(true)} />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) submit();
          }}
          className="relative flex items-end gap-2"
        >
          {!editing && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Add photos or clips"
              className={cn(
                "msg-press flex size-11 shrink-0 items-center justify-center rounded-full bg-control text-foreground hover:bg-control-hover disabled:opacity-40",
                rec !== "idle" && "pointer-events-none opacity-0",
              )}
            >
              <Plus size={20} />
            </button>
          )}

          <textarea
            ref={fieldRef}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) submit();
              } else if (e.key === "Escape") {
                if (editing) onCancelEdit();
                else if (replyingTo) onCancelReply();
              }
            }}
            rows={1}
            data-launching={launching ? "" : undefined}
            disabled={disabled}
            placeholder={placeholder}
            aria-label="Message"
            maxLength={4000}
            className="msg-field min-h-11 flex-1 resize-none rounded-[24px] bg-white/[0.06] px-4 py-[11px] text-[15px] leading-[22px] text-foreground shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] outline-none transition-[background-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 hover:bg-white/[0.08] focus-visible:bg-white/[0.09] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ember)] disabled:cursor-not-allowed disabled:opacity-50"
          />

          {hasContent || editing ? (
            <button
              key="send"
              type="submit"
              disabled={!canSend}
              aria-label={editing ? "Save edit" : "Send"}
              className="msg-press msg-pop flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-[#0b0708] hover:bg-white/90 disabled:opacity-40"
            >
              {sending ? (
                <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-black/25 border-t-black" />
              ) : editing ? (
                <Check size={19} weight="bold" />
              ) : (
                <PaperPlaneRight size={19} weight="fill" />
              )}
            </button>
          ) : (
            // Held, it follows the thumb a little as it slides toward the bin.
            <span
              key="mic"
              className="relative shrink-0"
              style={{
                transform: rec === "hold" ? `translateX(${Math.max(-40, slide.dx * 0.35)}px)` : undefined,
                transition: rec === "hold" ? "none" : "transform 0.3s var(--ease-spring)",
              }}
            >
              <button
                type="button"
                disabled={disabled}
                data-held={rec === "hold" ? "" : undefined}
                onPointerDown={beginHold}
                onPointerMove={moveHold}
                onPointerUp={endHold}
                onPointerCancel={loseHold}
                onContextMenu={(e) => e.preventDefault()}
                // Enter or Space: record hands-free.
                onClick={(e) => e.detail === 0 && rec === "idle" && void startHandsFree()}
                aria-label="Record a voice note"
                title="Hold to talk, or tap to record"
                className="msg-press msg-orb msg-pop flex size-11 touch-none items-center justify-center rounded-full bg-control text-foreground select-none hover:bg-control-hover disabled:opacity-40"
              >
                <Microphone size={20} />
              </button>
            </span>
          )}

          {(rec === "hold" || rec === "cancel" || rec === "send") && (
            <HoldRecorder
              phase={rec}
              elapsed={rec === "hold" ? voice.elapsed : take.elapsed}
              levels={rec === "hold" ? voice.levels : take.levels}
              dx={slide.dx}
              onDone={() => setRec("idle")}
            />
          )}
          {rec === "hold" && <LockHint dy={slide.dy} />}
        </form>
      )}
    </div>
  );
}
