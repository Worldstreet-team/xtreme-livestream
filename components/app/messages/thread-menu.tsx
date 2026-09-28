"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Bell, BellSlash, CaretLeft, CaretRight, DotsThree, SignOut, Trash, type Icon } from "@/components/icons";
import { IconButton } from "@/components/xtream";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

/**
 * A thread's options, from the header's dots: mute (a second page of
 * choices, so the first stays short), archive, and delete — or leave, in a
 * group you don't own. Same surface and rows as the rail's account menu:
 * warm popover, no outline, the destructive row in Chili.
 */

export type MuteChoice = "8h" | "1w" | "forever";

export function ThreadMenu({
  isGroup,
  owner,
  archived,
  onMute,
  onMentionsOnly,
  onUnmute,
  onArchive,
  onDelete,
}: {
  isGroup: boolean;
  /** Groups: only the owner may delete one; everyone else leaves. */
  owner: boolean;
  /** On the Archived shelf: the row offers the way back instead. */
  archived: boolean;
  onMute: (until: MuteChoice) => void;
  onMentionsOnly: () => void;
  onUnmute: () => void;
  onArchive: () => void;
  /** Delete the thread, or leave the group (the caller confirms). */
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"main" | "mute">("main");
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Outside click and Escape close it; opening (or changing page) puts
  // focus on the first row so the keyboard can take it from there.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setPage("main");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      setPage("main");
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, page]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    setPage("main");
    fn();
  };

  // Up and down walk the rows, wrapping.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const rows = [...(panelRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (at + 1) % rows.length : (at - 1 + rows.length) % rows.length;
    rows[next]?.focus();
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <Tip label="More options" side="bottom">
        <IconButton
          ref={triggerRef}
          icon={DotsThree}
          label="Conversation options"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setPage("main");
          }}
        />
      </Tip>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={page === "mute" ? "Mute notifications" : "Conversation options"}
          onKeyDown={onKeyDown}
          className="animate-rise absolute top-full right-0 z-40 mt-2 w-64 overflow-hidden rounded-panel bg-popover py-1 shadow-popover"
        >
          {page === "main" ? (
            <>
              <Row icon={BellSlash} label="Mute notifications" trailing onClick={() => setPage("mute")} />
              <Row icon={Archive} label={archived ? "Move to inbox" : "Archive"} onClick={run(onArchive)} />
              <Divider />
              {isGroup && !owner ? (
                <Row icon={SignOut} label="Leave group" danger onClick={run(onDelete)} />
              ) : (
                <Row icon={Trash} label={isGroup ? "Delete group" : "Delete conversation"} danger onClick={run(onDelete)} />
              )}
            </>
          ) : (
            <>
              <Row icon={CaretLeft} label="Mute notifications" strong onClick={() => setPage("main")} />
              <Divider />
              <Row label="For 8 hours" onClick={run(() => onMute("8h"))} />
              <Row label="For a week" onClick={run(() => onMute("1w"))} />
              <Row label="Until I turn it back on" onClick={run(() => onMute("forever"))} />
              {isGroup && <Row label="Only when I'm mentioned" onClick={run(onMentionsOnly)} />}
              <Divider />
              <Row icon={Bell} label="Turn notifications on" onClick={run(onUnmute)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  icon: Glyph,
  label,
  onClick,
  danger,
  strong,
  trailing,
}: {
  icon?: Icon;
  label: string;
  onClick: () => void;
  danger?: boolean;
  strong?: boolean;
  /** Opens a second page: a caret says so. */
  trailing?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors outline-none hover:bg-tint/[0.04] focus-visible:bg-tint/[0.06]",
        danger ? "text-chili-hi" : "text-foreground/90",
        strong && "font-semibold text-foreground",
        !Glyph && "pl-[42px]",
      )}
    >
      {Glyph && <Glyph size={18} aria-hidden className="shrink-0" />}
      <span className="min-w-0 flex-1">{label}</span>
      {trailing && <CaretRight size={14} aria-hidden className="shrink-0 text-muted-foreground" />}
    </button>
  );
}

function Divider() {
  return <div role="separator" className="my-1 h-px bg-tint/[0.06]" />;
}
