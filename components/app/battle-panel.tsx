"use client";

import { useEffect, useMemo, useState } from "react";
import { Sword, X, Check, Lightning, Trophy, MagnifyingGlass, Eye, CalendarBlank, UsersThree } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatClock, inMultiplierWindow, isBattleActive, secondsLeft, teamName, type BattleMode, type BattleView } from "@/lib/battles";
import { formatNumber } from "@/lib/categories";
import type { RowItem } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill } from "@/components/ui/pill";
import { LiveBadge } from "@/components/ui/badge";
import { CapsuleTabs } from "@/components/ui/capsule-tabs";

/**
 * The studio's battle controls: challenge a live creator, answer an invite,
 * and follow the score while it runs. Polls the caller's battles every few
 * seconds — a studio tab is one place, not an audience, so polling is the
 * simplest correct thing.
 *
 * A 2v2 is two pairs: you and the partner on your stage (a guest, or a
 * creator you co-live with) against another pair. Gifts count per stream
 * as ever, and a winning pair splits the bonus.
 */
export function BattlePanel({
  streamId,
  onBattle,
  inline = false,
  partner = null,
}: {
  streamId: string;
  onBattle?: (b: BattleView | null) => void;
  /** Inside a sheet or tab: full width, form open from the start, no toggle. */
  inline?: boolean;
  /** Who's on your stage to pair with for a 2v2, if anyone. */
  partner?: { userId: string; username: string; avatar: string } | null;
}) {
  const { user } = useAuth();
  const [mine, setMine] = useState<BattleView[]>([]);
  const [open, setOpen] = useState(inline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [live, setLive] = useState<RowItem[]>([]);
  const now = useNow(true);

  const active = useMemo(() => mine.find(isBattleActive) ?? null, [mine]);
  const booked = useMemo(() => mine.filter((b) => b.status === "scheduled"), [mine]);
  const [bookName, setBookName] = useState("");
  const [bookAt, setBookAt] = useState("");
  // What the loser does on the victory lap — goes with an invite or a booking.
  const [forfeit, setForfeit] = useState("");
  // Waiting in quick match for whoever's free.
  const [queued, setQueued] = useState(false);
  // One on one, or pairs.
  const [mode, setMode] = useState<BattleMode>("1v1");
  const needsPartner = mode === "2v2" && !partner;
  const outgoing = useMemo(() => mine.find((b) => b.status === "invited" && b.host.userId === user?.id) ?? null, [mine, user?.id]);
  const incoming = useMemo(() => mine.filter((b) => b.status === "invited" && b.challenger.userId === user?.id), [mine, user?.id]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { battles: BattleView[]; queued?: boolean } }>(`/api/battles/mine`)
        .then((r) => {
          if (cancelled) return;
          setMine(r.data.battles);
          setQueued(Boolean(r.data.queued));
        })
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

  /** Quick match: battle whoever else is waiting, or wait for the next to ask. */
  const quickMatch = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { battle: BattleView | null; queued: boolean } }>(`/api/battles/quick`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      const matched = r.data.battle;
      if (matched) setMine((m) => [matched, ...m.filter((b) => b.id !== matched.id)]);
      setQueued(r.data.queued);
      if (matched) setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't look for a match");
    } finally {
      setBusy(false);
    }
  };
  const leaveQuickMatch = () => {
    setQueued(false);
    apiFetch(`/api/battles/quick`, { method: "DELETE" }).catch(() => {});
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
    const pairFaces = (side: BattleView["host"], ring: string) => (
      <span className="flex shrink-0 -space-x-2" title={teamName(side)}>
        <UserAvatar src={side.avatar} name={side.displayName} size={28} className={cn("size-7 ring-2", ring)} />
        {side.partner && <UserAvatar src={side.partner.avatar} name={side.partner.displayName} size={28} className={cn("size-7 ring-2", ring)} />}
      </span>
    );
    return (
      <div className={cn("flex items-center gap-3 rounded-sm bg-white/[0.05] px-3 py-2", hot && "ring-1 ring-ember/60")}>
        {pairFaces(active.host, "ring-chili")}
        <div className="w-40">
          <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.12]">
            <div className="absolute inset-y-0 left-0 bg-chili transition-[width]" style={{ width: `${share * 100}%` }} />
            <div className="absolute inset-y-0 right-0 bg-ember transition-[width]" style={{ width: `${(1 - share) * 100}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-muted-foreground tabular-nums">
            <span>${Math.round(active.host.usdMinor / 100)}</span>
            <span>${Math.round(active.challenger.usdMinor / 100)}</span>
          </div>
        </div>
        {pairFaces(active.challenger, "ring-ember")}
        <span className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums", hot ? "bg-ember text-on-ember" : "bg-white text-neutral-950")}>
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
    <div className={cn("flex flex-col gap-2", inline ? "items-stretch" : "items-end")}>
      <div className="flex flex-wrap items-center gap-2">
        {incoming.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-sm bg-ember/[0.12] py-1.5 pr-1.5 pl-2.5 text-sm text-ember-hi">
            <Sword size={15} weight="fill" />
            <UserAvatar src={b.host.avatar} name={b.host.displayName} size={22} className="size-[22px]" />
            <span className="font-medium">
              {b.host.displayName} challenges you{b.mode === "2v2" ? " to a 2v2" : ""}
            </span>
            <Pill
              size="sm"
              variant="primary"
              icon={<Check size={13} weight="bold" />}
              onClick={() => act(`/api/battles/${b.id}/accept`)}
              disabled={busy || (b.mode === "2v2" && !partner)}
              title={b.mode === "2v2" && !partner ? "Bring a partner on stage to take on a 2v2" : undefined}
            >
              Accept
            </Pill>
            <Pill size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act(`/api/battles/${b.id}/decline`)} disabled={busy}>
              Decline
            </Pill>
            {b.mode === "2v2" && !partner && <span className="w-full pb-0.5 text-[12px] text-muted-foreground">Bring a partner on stage to take it on.</span>}
          </div>
        ))}
        {queued && !outgoing && (
          <div className="flex items-center gap-2 rounded-sm bg-ember/[0.12] py-1.5 pr-1.5 pl-2.5 text-sm text-ember-hi">
            <span className="size-2 animate-pulse rounded-full bg-ember" />
            Looking for an opponent…
            <Pill size="sm" variant="ghost" icon={<X size={13} />} onClick={leaveQuickMatch} disabled={busy}>
              Cancel
            </Pill>
          </div>
        )}
        {outgoing ? (
          <div className="flex items-center gap-2 rounded-sm bg-white/[0.05] py-1.5 pr-1.5 pl-2.5 text-sm text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-ember" />
            Waiting for {outgoing.challenger.displayName}…
            <Pill size="sm" variant="ghost" icon={<X size={13} />} onClick={() => act(`/api/battles/${outgoing.id}/cancel`)} disabled={busy}>
              Withdraw
            </Pill>
          </div>
        ) : inline ? null : (
          <Pill size="md" variant="glass" icon={<Sword size={15} weight="fill" />} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Battle
          </Pill>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {open && !outgoing && (
        <div className={cn("rounded-sm p-3", inline ? "w-full bg-white/[0.03]" : "w-[360px] border border-white/[0.08] bg-popover shadow-2xl")}>
          {/* One on one, or you and your stage partner against another pair. */}
          <CapsuleTabs
            label="Kind of battle"
            className="mb-2.5"
            items={[
              { id: "1v1" as const, label: "1 v 1" },
              { id: "2v2" as const, label: "2 v 2" },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === "2v2" && (
            <div className="mb-3 flex items-center gap-2.5 rounded-sm bg-white/[0.04] px-2.5 py-2">
              {partner ? (
                <UserAvatar src={partner.avatar} name={partner.username} size={28} className="size-7" />
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground">
                  <UsersThree size={14} />
                </span>
              )}
              <p className="min-w-0 text-[12px] leading-snug text-muted-foreground">
                {partner ? (
                  <>
                    You and <span className="font-semibold text-foreground">{partner.username}</span> against another pair. Win, and you split the bonus.
                  </>
                ) : (
                  "Bring your partner on stage first — anyone on your Stage, or a creator you co-live with."
                )}
              </p>
            </div>
          )}
          {/* Quickest way in: whoever else is waiting, straight into a battle. */}
          <div className="mb-3 flex items-center gap-3 rounded-sm bg-ember/[0.1] p-2.5">
            <Pill size="sm" variant="ember" icon={<Lightning size={13} weight="fill" />} onClick={() => void quickMatch()} disabled={busy || queued || needsPartner}>
              {queued ? "Looking…" : "Quick match"}
            </Pill>
            <p className="min-w-0 text-[12px] leading-snug text-muted-foreground">
              {queued
                ? mode === "2v2"
                  ? "You'll be matched with the next pair who's looking."
                  : "You'll be matched with the next creator who's looking."
                : mode === "2v2"
                  ? "Take on whichever pair is free right now — it starts the moment you're matched."
                  : "Battle whoever's free right now — it starts the moment you're paired."}
            </p>
          </div>

          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
            <Trophy size={12} weight="fill" />
            Challenge a live creator
          </p>
          {/* The stakes: what the loser does on the victory lap. */}
          <input
            value={forfeit}
            onChange={(e) => setForfeit(e.target.value)}
            maxLength={60}
            placeholder="What the loser does — “sings a song” (optional)"
            aria-label="What the loser does"
            className="mb-2 h-9 w-full rounded-sm bg-white/[0.06] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
          />
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
                disabled={busy || needsPartner}
                onClick={() => act(`/api/battles/invite`, { challengerUsername: s.streamerId.username, forfeit: forfeit.trim(), mode })}
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
          <p className="mt-2 text-[11px] text-muted-foreground/60">
            Five minutes on the clock. Gifts decide it; the last 30 seconds count double, and a gift in the last 10 resets the clock once.
          </p>

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
                onClick={() =>
                  act(`/api/battles/schedule`, {
                    challengerUsername: bookName.trim().replace(/^@/, ""),
                    scheduledAt: new Date(bookAt).toISOString(),
                    forfeit: forfeit.trim(),
                    mode,
                  })
                }
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
                      {b.mode === "2v2" ? "2v2 " : ""}vs <span className="text-foreground">{b.host.userId === user?.id ? b.challenger.displayName : b.host.displayName}</span> · {b.scheduledAt ? new Date(b.scheduledAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : ""}
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
