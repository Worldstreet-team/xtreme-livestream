"use client";

import { useEffect, useMemo, useState } from "react";
import { Sword, X, Check, Lightning, Trophy, MagnifyingGlass, Eye, CalendarBlank } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatClock, inMultiplierWindow, isBattleActive, secondsLeft, type BattleView } from "@/lib/battles";
import { formatNumber } from "@/lib/categories";
import type { RowItem } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill } from "@/components/ui/pill";
import { LiveBadge } from "@/components/ui/badge";

/**
 * The studio's battle controls: challenge a live creator, answer an invite,
 * and follow the score while it runs. Polls the caller's battles every few
 * seconds — a studio tab is one place, not an audience, so polling is the
 * simplest correct thing.
 */
export function BattlePanel({ streamId, onBattle }: { streamId: string; onBattle?: (b: BattleView | null) => void }) {
  const { user } = useAuth();
  const [mine, setMine] = useState<BattleView[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [live, setLive] = useState<RowItem[]>([]);
  const now = useNow(true);

  const active = useMemo(() => mine.find(isBattleActive) ?? null, [mine]);
  const booked = useMemo(() => mine.filter((b) => b.status === "scheduled"), [mine]);
  const [bookName, setBookName] = useState("");
  const [bookAt, setBookAt] = useState("");
  const outgoing = useMemo(() => mine.find((b) => b.status === "invited" && b.host.userId === user?.id) ?? null, [mine, user?.id]);
  const incoming = useMemo(() => mine.filter((b) => b.status === "invited" && b.challenger.userId === user?.id), [mine, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { battles: BattleView[] } }>(`/api/battles/mine`)
        .then((r) => !cancelled && setMine(r.data.battles))
        .catch(() => {});
    void load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [streamId]);

  useEffect(() => {
    onBattle?.(active);
  }, [active, onBattle]);

  useEffect(() => {
    if (!open) return;
    apiFetch<{ success: boolean; data: { streams: RowItem[] } }>(`/api/streams?live=true&sort=viewers&limit=30`)
      .then((r) => setLive(r.data.streams.filter((s) => s.streamerId.username !== user?.username)))
      .catch(() => setLive([]));
  }, [open, user?.username]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { battle: BattleView } }>(path, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setMine((m) => [r.data.battle, ...m.filter((b) => b.id !== r.data.battle.id)]);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const candidates = live.filter((s) => {
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return s.streamerId.displayName.toLowerCase().includes(term) || s.streamerId.username.toLowerCase().includes(term);
  });

  // A running battle: the compact scoreboard.
  if (active) {
    const left = secondsLeft(active, now);
    const hot = inMultiplierWindow(active, now);
    const total = active.host.usdMinor + active.challenger.usdMinor;
    const share = total ? active.host.usdMinor / total : 0.5;
    return (
      <div className={cn("flex items-center gap-3 rounded-sm bg-white/[0.05] px-3 py-2", hot && "ring-1 ring-amber-400/60")}>
        <UserAvatar src={active.host.avatar} name={active.host.displayName} size={28} className="size-7 ring-2 ring-red-500" />
        <div className="w-40">
          <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.12]">
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-500 to-amber-400 transition-[width]" style={{ width: `${share * 100}%` }} />
            <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-violet-500 to-sky-400 transition-[width]" style={{ width: `${(1 - share) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground tabular-nums">
            <span>${Math.round(active.host.usdMinor / 100)}</span>
            <span>${Math.round(active.challenger.usdMinor / 100)}</span>
          </div>
        </div>
        <UserAvatar src={active.challenger.avatar} name={active.challenger.displayName} size={28} className="size-7 ring-2 ring-sky-400" />
        <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums", hot ? "bg-amber-400 text-neutral-950" : "bg-white text-neutral-950")}>
          {hot && <Lightning size={11} weight="fill" />}
          {active.status === "overtime" ? "OT " : ""}
          {formatClock(left)}
        </span>
        <Pill size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act(`/api/battles/${active.id}/cancel`)} disabled={busy} title="End the battle early — no bonus">
          End
        </Pill>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {incoming.map((b) => (
          <div key={b.id} className="flex items-center gap-2 rounded-sm bg-amber-400/[0.12] py-1.5 pr-1.5 pl-2.5 text-sm text-amber-200">
            <Sword size={15} weight="fill" />
            <UserAvatar src={b.host.avatar} name={b.host.displayName} size={22} className="size-[22px]" />
            <span className="font-medium">{b.host.displayName} challenges you</span>
            <Pill size="sm" variant="primary" icon={<Check size={13} weight="bold" />} onClick={() => act(`/api/battles/${b.id}/accept`)} disabled={busy}>
              Accept
            </Pill>
            <Pill size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act(`/api/battles/${b.id}/decline`)} disabled={busy}>
              Decline
            </Pill>
          </div>
        ))}
        {outgoing ? (
          <div className="flex items-center gap-2 rounded-sm bg-white/[0.05] py-1.5 pr-1.5 pl-2.5 text-sm text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-amber-400" />
            Waiting for {outgoing.challenger.displayName}…
            <Pill size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act(`/api/battles/${outgoing.id}/cancel`)} disabled={busy}>
              Withdraw
            </Pill>
          </div>
        ) : (
          <Pill size="md" variant="glass" icon={<Sword size={15} weight="fill" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Battle
          </Pill>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && !outgoing && (
        <div className="w-[360px] rounded-sm border border-white/[0.08] bg-[oklch(0.14_0.005_285)] p-3 shadow-2xl">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
            <Trophy size={12} weight="fill" />
            Challenge a live creator
          </p>
          <div className="relative mb-2">
            <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Who's live?"
              className="h-9 w-full rounded-sm bg-white/[0.06] pr-3 pl-9 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
            />
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin">
            {candidates.length === 0 && <p className="px-2 py-4 text-center text-sm text-muted-foreground">Nobody else is live right now.</p>}
            {candidates.map((s) => (
              <button
                key={s._id}
                type="button"
                disabled={busy}
                onClick={() => act(`/api/battles/invite`, { challengerUsername: s.streamerId.username })}
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-50"
              >
                <UserAvatar src={s.streamerId.avatar} name={s.streamerId.displayName} size={32} className="size-8" />
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-sm font-medium text-foreground">{s.streamerId.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <LiveBadge size="xs" />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums"><Eye size={11} />{formatNumber(s.viewers)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/60">Five minutes on the clock. Gifts decide it; the last 30 seconds count double.</p>

          {/* Or book one: it starts by itself once both are live at the time. */}
          <div className="mt-3 border-t border-white/[0.08] pt-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
              <CalendarBlank size={12} weight="bold" />
              Or book for later
            </p>
            <div className="flex gap-1.5">
              <input
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                placeholder="@username"
                className="h-8 min-w-0 flex-1 rounded-sm bg-white/[0.06] px-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
              />
              <input
                type="datetime-local"
                value={bookAt}
                onChange={(e) => setBookAt(e.target.value)}
                className="h-8 rounded-sm bg-white/[0.06] px-2 text-[12px] text-foreground outline-none focus:bg-white/[0.09] [color-scheme:dark]"
              />
              <Pill
                size="sm"
                variant="glass"
                disabled={busy || !bookName.trim() || !bookAt}
                onClick={() => act(`/api/battles/schedule`, { challengerUsername: bookName.trim().replace(/^@/, ""), scheduledAt: new Date(bookAt).toISOString() })}
              >
                Book
              </Pill>
            </div>
            {booked.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {booked.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 rounded-sm bg-white/[0.04] px-2 py-1.5 text-[12px] text-muted-foreground">
                    <CalendarBlank size={12} />
                    <span className="min-w-0 flex-1 truncate">
                      vs <span className="text-foreground">{b.host.userId === user?.id ? b.challenger.displayName : b.host.displayName}</span> · {b.scheduledAt ? new Date(b.scheduledAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}
                    </span>
                    <button type="button" onClick={() => act(`/api/battles/${b.id}/cancel`)} disabled={busy} className="text-muted-foreground hover:text-foreground" aria-label="Cancel booking">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
