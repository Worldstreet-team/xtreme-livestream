"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { nameColor, type ChatMsg } from "./lines";

export interface LineAction {
  id: string;
  label: string;
  icon: ReactNode;
  tone?: "danger" | "on";
  run: () => void;
}

/**
 * A chatter's actions, with words on them. The chat panel's line tools are
 * icons that appear on hover; over video, and on a phone, nobody found
 * them (owner, 2026-09-28: "tap on a user in the chat, there are actions
 * there"). This is the same set — the handlers are LiveChat's own — as a
 * sheet on phones and a small card elsewhere.
 */
export function LineActions({
  msg,
  badges,
  actions,
  busy,
  onClose,
  children,
}: {
  msg: ChatMsg;
  badges?: ReactNode;
  actions: LineAction[];
  busy?: boolean;
  onClose: () => void;
  /** Extra content under the list (a report's reasons). */
  children?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-theme="dark" className="fixed inset-0 z-[60] flex items-end justify-center md:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="animate-fade-in absolute inset-0 bg-black/55" />
      <div
        role="dialog"
        aria-label={`Actions for ${msg.username}`}
        className="animate-sheet-up md:animate-pop-in relative w-full rounded-t-overlay bg-popover px-3 pt-3 pb-[max(env(safe-area-inset-bottom),14px)] text-foreground shadow-[inset_0_1px_0_rgba(255,236,230,0.06)] md:mx-4 md:max-w-sm md:rounded-overlay md:pb-3"
      >
        <div className="flex items-start gap-3 px-2 pt-1 pb-3">
          <UserAvatar src={msg.avatar} name={msg.username} size={40} className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center text-[15px] font-semibold">
              <span className="truncate" style={{ color: nameColor(msg.username) }}>
                {msg.username}
              </span>
            </p>
            {badges && <div className="mt-0.5 leading-none">{badges}</div>}
            {msg.content && msg.type !== "stage" && (
              <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug break-words text-muted-foreground">{msg.content}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press -mt-1 -mr-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-tint/[0.06] hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={a.run}
              disabled={busy}
              className={cn(
                "press flex h-12 items-center gap-3 rounded-[12px] px-3 text-left text-[14.5px] font-medium transition-colors disabled:opacity-50",
                a.tone === "danger" ? "text-chili-hi hover:bg-chili/[0.12]" : a.tone === "on" ? "text-ember-hi hover:bg-ember/[0.12]" : "hover:bg-tint/[0.06]",
              )}
            >
              <span className="flex size-5 shrink-0 items-center justify-center">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
