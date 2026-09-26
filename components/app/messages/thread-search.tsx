"use client";

import { useEffect, useRef, useState } from "react";
import type { Message } from "@worldstreet/messaging-sdk";
import { MagnifyingGlass, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { describeMessage, messaging, personName, shortTime } from "@/lib/messaging";

/** The query's words, lit in Ember inside a result. */
function Highlight({ text, q }: { text: string; q: string }) {
  const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join("|")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-ember/25 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

/**
 * Find something in this thread. Results come from the gateway (the whole
 * history, not just what's loaded); picking one takes you to it.
 */
export function ThreadSearch({ conversationId, onPick, onClose }: { conversationId: string; onPick: (messageId: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setBusy(true);
      messaging.conversations
        .search(conversationId, { q: term, limit: 20 })
        .then((res) => !cancelled && setResults(res))
        .catch(() => !cancelled && setResults([]))
        .finally(() => !cancelled && setBusy(false));
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, conversationId]);

  const term = q.trim();
  const shown = term.length >= 2 ? results : null;

  return (
    <div className="msg-lift relative z-10 shrink-0 px-3 pt-2 pb-2 md:px-5">
      <div className="flex items-center gap-2">
        <label className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-white/[0.06] px-4 shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] focus-within:bg-white/[0.09] focus-within:shadow-[inset_0_0_0_1.5px_var(--ember)]">
          <MagnifyingGlass size={17} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="Search this conversation"
            aria-label="Search this conversation"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />}
        </label>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="msg-press flex size-11 shrink-0 items-center justify-center rounded-full bg-control text-foreground hover:bg-control-hover"
        >
          <X size={17} />
        </button>
      </div>

      {shown && (
        <div className="msg-lift absolute inset-x-3 top-full z-20 mt-1 max-h-[min(24rem,60vh)] overflow-y-auto rounded-panel bg-popover py-1.5 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)] md:inset-x-5">
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13.5px] text-muted-foreground">Nothing in this conversation matches “{term}”.</p>
          ) : (
            shown.map((m, i) => (
              <button
                key={m._id}
                type="button"
                onClick={() => onPick(m._id)}
                style={{ "--i": i } as React.CSSProperties}
                className={cn("msg-rise flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.05]")}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[12.5px] font-semibold text-foreground/90">
                    {typeof m.sender === "string" ? "Message" : personName(m.sender)}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">{shortTime(m.createdAt)}</span>
                </span>
                <span className="line-clamp-2 text-[14px] text-muted-foreground">
                  <Highlight text={describeMessage(m)} q={term} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
