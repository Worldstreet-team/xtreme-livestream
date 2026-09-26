"use client";

import { useEffect, useRef, useState } from "react";
import type { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { EASE, done, ghost, play } from "./motion";

/**
 * What you can do to a message, in two shapes:
 *  - wide screens: a quiet toolbar beside the bubble on hover, and a
 *    reaction strip or a menu that float over the thread — nothing in the
 *    conversation moves when they open
 *  - phones: long-press opens a sheet with big reactions and big rows,
 *    the way phones do it
 * Destructive rows ask twice: the first tap turns the row into its question.
 *
 * Reacting (the owner's pick, react B): the strip springs out of the bubble
 * with its emoji arriving 18ms apart; your pick leaves on an arc for its
 * chip (thread-motion.ts) while the strip collapses behind it.
 */

export const QUICK_REACTIONS = ["❤️", "😂", "🔥", "👏", "😮", "😢"];

export interface MessageAction {
  key: string;
  label: string;
  icon: Icon;
  onSelect: () => void;
  /** Destructive: Chili, and a second tap to confirm with this question. */
  confirm?: string;
}

/** Six reactions in a row; the one you already gave sits on Ember. */
export function ReactionStrip({
  mineEmoji,
  onReact,
  big = false,
  className,
}: {
  mineEmoji: string | null;
  /** `from` is the button tapped: the emoji flies from there. */
  onReact: (emoji: string, from: HTMLElement) => void;
  big?: boolean;
  className?: string;
}) {
  return (
    <div role="toolbar" aria-label="React" className={cn("flex items-center", big ? "justify-between" : "gap-0.5", className)}>
      {QUICK_REACTIONS.map((e, i) => (
        <button
          key={e}
          type="button"
          onClick={(ev) => onReact(e, ev.currentTarget)}
          aria-label={mineEmoji === e ? `Remove ${e}` : `React ${e}`}
          aria-pressed={mineEmoji === e}
          style={{ "--i": i } as React.CSSProperties}
          className={cn(
            "msg-press msg-emoji-in flex items-center justify-center rounded-full transition-transform hover:-translate-y-0.5 hover:scale-110",
            big ? "size-12 text-[28px]" : "size-9 text-[20px]",
            mineEmoji === e && "bg-ember/25",
          )}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

/** Rows in a list, with the two-step confirm for destructive ones. */
function ActionRows({ items, onDone, big }: { items: MessageAction[]; onDone: () => void; big?: boolean }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <>
      {items.map((a) => {
        const asking = confirming === a.key;
        const Glyph = a.icon;
        return (
          <button
            key={a.key}
            type="button"
            role="menuitem"
            onClick={() => {
              if (a.confirm && !asking) return setConfirming(a.key);
              onDone();
              a.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-3 text-left transition-colors outline-none",
              big ? "h-[52px] rounded-control px-4 text-[15.5px]" : "px-3.5 py-2.5 text-sm",
              a.confirm ? "text-chili-hi" : "text-foreground/90",
              asking ? "bg-chili/15" : "hover:bg-white/[0.05] focus-visible:bg-white/[0.07]",
            )}
          >
            <Glyph size={big ? 20 : 17} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1" aria-live={a.confirm ? "polite" : undefined}>
              {asking ? a.confirm : a.label}
            </span>
          </button>
        );
      })}
    </>
  );
}

/**
 * The strip (or sheet) collapsing behind a pick: a copy of it shrinks and
 * fades on the quick exit curve while the real one is already gone. The
 * picked emoji isn't in the copy — it's on its way to the bubble.
 */
function collapse(el: HTMLElement | null, picked: HTMLElement, frames: Keyframe[], ms: number) {
  if (!el) return;
  const copy = ghost(el);
  copy.style.transformOrigin = getComputedStyle(el).transformOrigin;
  const i = [...el.querySelectorAll("button")].indexOf(picked as HTMLButtonElement);
  const gone = copy.querySelectorAll("button")[i];
  if (gone) gone.style.visibility = "hidden";
  void done(play(copy, frames, ms, EASE.in, 0, { fill: "forwards" })).then(() => copy.remove());
}

/** Closes on a press outside and on Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Next tick, so the press that opened it doesn't also close it.
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onClose]);
}

/** Wide screens: the reaction strip, floating over the bubble. */
export function FloatingReactions({
  mineEmoji,
  onReact,
  onClose,
  align,
  below,
}: {
  mineEmoji: string | null;
  onReact: (emoji: string, from: HTMLElement) => void;
  onClose: () => void;
  align: "start" | "end";
  below: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  return (
    <div
      ref={ref}
      // It springs out of the bubble's corner.
      style={{ transformOrigin: `${align === "end" ? "calc(100% - 18px)" : "18px"} ${below ? "-10%" : "110%"}` }}
      className={cn(
        "msg-bar-in absolute z-30 rounded-full bg-surface-raised p-1 shadow-[0_18px_44px_-16px_rgba(0,0,0,0.95)]",
        below ? "top-full mt-2" : "bottom-full mb-2",
        align === "end" ? "right-0" : "left-0",
      )}
    >
      <ReactionStrip
        mineEmoji={mineEmoji}
        onReact={(emoji, from) => {
          collapse(ref.current, from, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.9)" }], 160);
          onReact(emoji, from);
        }}
      />
    </div>
  );
}

/** Wide screens: the "more" menu, floating beside the toolbar. */
export function FloatingMenu({
  items,
  onClose,
  align,
  below,
}: {
  items: MessageAction[];
  onClose: () => void;
  align: "start" | "end";
  below: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);
  return (
    <div
      ref={ref}
      role="menu"
      className={cn(
        "msg-lift absolute z-30 w-56 overflow-hidden rounded-panel bg-popover py-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)]",
        below ? "top-full mt-2" : "bottom-full mb-2",
        align === "end" ? "right-0" : "left-0",
      )}
    >
      <ActionRows items={items} onDone={onClose} />
    </div>
  );
}

/** Phones: the long-press sheet — reactions, a glimpse of the message, rows. */
export function ActionSheet({
  preview,
  mineEmoji,
  onReact,
  items,
  onClose,
}: {
  preview: { who: string; text: string };
  mineEmoji: string | null;
  onReact: (emoji: string, from: HTMLElement) => void;
  items: MessageAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div ref={rootRef} className="msg-fade fixed inset-0 z-[57] flex items-end bg-black/65" onClick={onClose}>
      <div
        ref={ref}
        role="menu"
        aria-label="Message actions"
        onClick={(e) => e.stopPropagation()}
        className="animate-sheet-up w-full rounded-t-overlay bg-popover px-3 pt-2 pb-[max(env(safe-area-inset-bottom),14px)]"
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <div className="px-2">
          <ReactionStrip
            mineEmoji={mineEmoji}
            onReact={(e, from) => {
              // The sheet goes on the quick exit curve while your pick flies to the bubble.
              collapse(rootRef.current, from, [{ opacity: 1 }, { opacity: 0 }], 180);
              onReact(e, from);
              onClose();
            }}
            big
          />
        </div>
        <div className="mx-1 mt-3 mb-2 rounded-control bg-white/[0.04] px-3.5 py-2.5">
          <p className="text-[12px] font-semibold text-ember-hi">{preview.who}</p>
          <p className="line-clamp-2 text-[14px] text-foreground/85">{preview.text}</p>
        </div>
        <ActionRows items={items} onDone={onClose} big />
      </div>
    </div>
  );
}
