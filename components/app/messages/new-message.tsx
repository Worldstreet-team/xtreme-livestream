"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, WarningCircle } from "@/components/icons";
import { Dialog, DialogContent, UserAvatar } from "@/components/xtream";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import { openFailure, openThreadWith, threadAvatar, threadHref, threadTitle } from "@/lib/messaging";
import { useMessages } from "./messages-context";

interface Person {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
  isLive: boolean;
  stream: { title: string } | null;
}

/**
 * Start a conversation. Before you type, the people you already talk to;
 * as you type, anyone on Xtream — live channels first, wearing their ring,
 * because someone searching a name usually means the one on air.
 */
export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { rows } = useMessages();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      setSearching(true);
      apiFetch<{ data: { channels: Person[] } }>(`/api/users/search?q=${encodeURIComponent(term)}&limit=8`)
        .then((res) => !cancelled && setPeople(res.data.channels ?? []))
        .catch(() => !cancelled && setPeople([]))
        .finally(() => !cancelled && setSearching(false));
    }, 240);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  const open = async (p: Person) => {
    setOpening(p.username);
    setError(null);
    try {
      const id = await openThreadWith(p.username);
      onClose();
      router.push(threadHref(id));
    } catch (err) {
      setError(openFailure(err));
      setOpening(null);
    }
  };

  const term = q.trim();
  const recent = (rows ?? []).filter((r) => r.kind === "dm" && !r.archived && !r.isRequestForMe).slice(0, 6);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="New message"
        description="Anyone on Xtream. The thread follows you into WorldSpace and the app."
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        className="md:max-w-[440px]"
      >
        <label className="flex h-12 items-center gap-2.5 rounded-full bg-white/[0.06] px-4 shadow-[inset_0_0_0_1px_rgba(255,236,230,0.1)] focus-within:bg-white/[0.09] focus-within:shadow-[inset_0_0_0_1.5px_var(--ember)]">
          <MagnifyingGlass size={17} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or @handle"
            aria-label="Search people"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          {searching && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />}
        </label>

        {error && (
          <p role="alert" className="mt-3 flex items-center gap-1.5 px-1 text-[13px] text-chili-hi">
            <WarningCircle size={14} aria-hidden />
            {error}
          </p>
        )}

        <div className="-mx-2 mt-4 max-h-[min(22rem,52vh)] overflow-y-auto">
          {term.length < 2 ? (
            recent.length > 0 ? (
              <>
                <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Recent</p>
                {recent.map((r, i) => (
                  <button
                    key={r._id}
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push(threadHref(r._id));
                    }}
                    style={{ "--i": i } as React.CSSProperties}
                    className="msg-rise flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <UserAvatar src={threadAvatar(r)} name={threadTitle(r)} size={40} className="size-10" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-[14.5px] font-semibold text-foreground">{threadTitle(r)}</span>
                      <span className="block truncate text-[12.5px] text-muted-foreground">@{r.otherParticipant?.username}</span>
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <p className="px-3 py-8 text-center text-[13.5px] leading-relaxed text-muted-foreground">
                Type a name to find someone. Live channels show first.
              </p>
            )
          ) : people && people.length === 0 && !searching ? (
            <p className="px-3 py-8 text-center text-[13.5px] text-muted-foreground">Nobody on Xtream goes by “{term}”.</p>
          ) : (
            (people ?? []).map((p, i) => (
              <button
                key={p.id}
                type="button"
                disabled={Boolean(opening)}
                onClick={() => void open(p)}
                style={{ "--i": i } as React.CSSProperties}
                className={cn(
                  "msg-rise flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-60",
                  opening === p.username && "bg-white/[0.05]",
                )}
              >
                <UserAvatar src={p.avatar} name={p.displayName || p.username} size={40} ring={p.isLive ? "live" : "none"} ringGapClassName="bg-surface-raised" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14.5px] font-semibold text-foreground">{p.displayName || p.username}</span>
                    {p.isLive && (
                      <span className="shrink-0 rounded-[4px] bg-chili px-1.5 py-px text-[10px] font-bold tracking-[0.06em] text-white">LIVE</span>
                    )}
                  </span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {p.isLive && p.stream ? p.stream.title : `@${p.username}`}
                  </span>
                </span>
                {opening === p.username && (
                  <span aria-label="Opening" className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
