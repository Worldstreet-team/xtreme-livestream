"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowBendUpLeft, Check, Microphone, PaperPlaneRight, PencilSimple, Plus, WarningCircle, X } from "@/components/icons";
import { RecorderBar, useVoiceRecorder, type VoiceClip } from "./voice-recorder";
import { handOff } from "./motion";
import { COMPOSER_LAUNCH, type Launch } from "./thread-motion";

/**
 * The thread's foot.
 *
 * One row: add, the field, and one button that is a mic until there is
 * something to send and a send button once there is — the grammar every
 * chat app has taught. Photos and clips go several at a time (they arrive
 * as one album); a reply or an edit sits above the field; while you record
 * a voice note the recorder takes the row. Enter sends, Shift+Enter breaks
 * the line, Escape backs out of a reply or an edit.
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
  const finishVoice = async (keep: boolean) => {
    const clip = await voice.stop(keep);
    onRecording(false);
    if (clip) onSendVoice(clip);
  };
  useEffect(() => {
    onLimitRef.current = () => void finishVoice(true);
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
        <div className="msg-lift mb-2 flex items-center gap-3 rounded-[18px] bg-white/[0.04] py-2 pr-1.5 pl-3.5">
          <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full bg-ember" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ember-hi">
              {editing ? <PencilSimple size={13} aria-hidden /> : <ArrowBendUpLeft size={13} aria-hidden />}
              {editing ? "Editing your message" : `Replying to ${replyingTo?.name}`}
            </p>
            {!editing && replyingTo && <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{replyingTo.snippet}</p>}
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

      {voice.recording ? (
        <RecorderBar
          elapsed={voice.elapsed}
          levels={voice.levels}
          onCancel={() => void finishVoice(false)}
          onSend={() => void finishVoice(true)}
        />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSend) submit();
          }}
          className="flex items-end gap-2"
        >
          {!editing && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Add photos or clips"
              className="msg-press flex size-11 shrink-0 items-center justify-center rounded-full bg-control text-foreground hover:bg-control-hover disabled:opacity-40"
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
            <button
              key="mic"
              type="button"
              disabled={disabled}
              onClick={async () => {
                if (await voice.start()) onRecording(true);
              }}
              aria-label="Record a voice note"
              className="msg-press msg-pop flex size-11 shrink-0 items-center justify-center rounded-full bg-control text-foreground hover:bg-control-hover disabled:opacity-40"
            >
              <Microphone size={20} />
            </button>
          )}
        </form>
      )}
    </div>
  );
}
