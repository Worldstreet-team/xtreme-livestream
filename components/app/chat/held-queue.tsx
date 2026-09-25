"use client";

import { useState } from "react";
import { CaretDown, Check, ShieldStar, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { nameColor, type ChatMsg } from "./lines";
import type { ChatSkin } from "./chat-lines";

/** A line the filter is holding: the line, and why. */
export type HeldLine = ChatMsg & { heldLabel: string };

/**
 * Held for review (safety kit): what the chat filter caught, waiting on the
 * host or a moderator. Only they see it — the rest of the room never does
 * unless it's let in. Oldest first, so nobody waits longest for no reason.
 */
export function HeldQueue({
  held,
  skin,
  busyId,
  onApprove,
  onDeny,
}: {
  held: HeldLine[];
  skin: ChatSkin;
  busyId: string | null;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  if (held.length === 0) return null;
  const overlay = skin === "overlay";
  const shown = overlay ? held.slice(0, 2) : held;

  return (
    <section
      aria-label="Held for review"
      className={cn(
        "rounded-[12px]",
        overlay ? "pointer-events-auto mb-2 w-full max-w-[340px] bg-black/70 p-2" : "mx-2 mb-2 bg-surface-raised p-2"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[8px] px-1.5 py-1 text-left"
      >
        <ShieldStar size={14} weight="fill" className="shrink-0 text-ember-hi" />
        <span className={cn("caps flex-1 font-mono text-[10.5px]", overlay ? "text-white/70" : "text-muted-foreground")}>
          Held for review
        </span>
        <span className="rounded-full bg-ember px-1.5 py-px font-mono text-[10.5px] font-bold text-on-ember tabular-nums">{held.length}</span>
        <CaretDown size={13} className={cn("shrink-0 transition-transform", overlay ? "text-white/60" : "text-muted-foreground", !open && "-rotate-90")} />
      </button>

      {open && (
        <ul className={cn("mt-1 flex flex-col", overlay ? "gap-1" : "gap-1.5")}>
          {shown.map((line) => (
            <li key={line.id} className={cn("rounded-[10px] px-2 py-1.5", overlay ? "bg-white/[0.06]" : "bg-white/[0.04]")}>
              <p className={cn("text-[12.5px] leading-snug break-words", overlay ? "text-white" : "text-foreground/90")}>
                <span className="mr-1.5 font-semibold" style={overlay ? undefined : { color: nameColor(line.username) }}>
                  {line.username}
                </span>
                {line.content}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className={cn(
                    "mr-auto rounded-[4px] px-1.5 py-px text-[10.5px] font-semibold",
                    overlay ? "bg-white/[0.1] text-white/75" : "bg-white/[0.07] text-muted-foreground"
                  )}
                >
                  {line.heldLabel}
                </span>
                <button
                  type="button"
                  onClick={() => onDeny(line.id)}
                  disabled={busyId === line.id}
                  aria-label={`Keep ${line.username}'s line out`}
                  className={cn(
                    "press flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-semibold transition-colors disabled:opacity-50",
                    overlay ? "bg-white/[0.1] text-white hover:bg-white/[0.16]" : "bg-white/[0.07] text-foreground hover:bg-white/[0.11]"
                  )}
                >
                  <X size={12} weight="bold" />
                  Deny
                </button>
                <button
                  type="button"
                  onClick={() => onApprove(line.id)}
                  disabled={busyId === line.id}
                  aria-label={`Let ${line.username}'s line in`}
                  className="press flex h-7 items-center gap-1 rounded-full bg-white px-2.5 text-[11.5px] font-bold text-[#0b0708] disabled:opacity-50"
                >
                  <Check size={12} weight="bold" />
                  Let in
                </button>
              </div>
            </li>
          ))}
          {overlay && held.length > shown.length && (
            <li className="px-1.5 text-[11px] text-white/60">+{held.length - shown.length} more waiting</li>
          )}
        </ul>
      )}
    </section>
  );
}
