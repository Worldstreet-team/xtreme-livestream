"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sword, X, Check, Lightning, Trophy, MagnifyingGlass, Eye, CalendarBlank, UsersThree, ShareNetwork } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatScorePair, winnerSide } from "@/lib/battle-result";
import { formatClock, giftFilterLine, inMultiplierWindow, isBattleActive, secondsLeft, sideOf, teamName, type BattleMode, type BattleView } from "@/lib/battles";
import { formatNumber } from "@/lib/categories";
import type { RowItem } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Pill } from "@/components/ui/pill";
import { LiveBadge } from "@/components/ui/badge";
import { CapsuleTabs } from "@/components/ui/capsule-tabs";
import { BattleResultSheet } from "@/components/app/battle-result-card";
import { BattleGiftFilter } from "@/components/app/battle-gift-filter";

/** The host's own line about the battle that just ended: "You won", "$1,234 to $987". */
function resultLine(b: BattleView, streamId: string) {
  const mine = sideOf(b, streamId) ?? "host";
  const theirs = mine === "host" ? "challenger" : "host";
  const winner = winnerSide(b);
  const scores = formatScorePair(b.host.usdMinor, b.challenger.usdMinor);
  const me = b[mine];
  return {
    won: winner === mine,
    said: winner === null ? "It's a draw" : winner === mine ? (me.partner ? `You and ${me.partner.displayName} won` : "You won") : `${teamName(b[theirs])} won`,
    scores: `${scores[mine]} to ${scores[theirs]}`,
  };
}

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
  // Which gifts count — goes with an invite or a booking; all by default.
  const [onlySome, setOnlySome] = useState(false);
  const [chosenGifts, setChosenGifts] = useState<string[]>([]);
  const giftFilter = onlySome ? chosenGifts : [];
  const needsGifts = onlySome && chosenGifts.length === 0;
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

  // The battle that just ended, for the host to post: picked up the moment
  // the live one drops out of `mine` (settled or cancelled — only a settled
  // one has a result), or, when the studio opens, a result still fresh.
  const [result, setResult] = useState<BattleView | null>(null);
  const [sharing, setSharing] = useState<BattleView | null>(null);
  const liveId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ success: boolean; data: { battle: BattleView | null } }>(`/api/streams/${streamId}/battle`)
      .then((r) => {
        if (!cancelled && r.data.battle?.status === "ended") setResult(r.data.battle);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [streamId]);

  useEffect(() => {
    if (active) {
      liveId.current = active.id;
      return;
    }
    const id = liveId.current;
    if (!id) return;
    liveId.current = null;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { battle: BattleView } }>(`/api/battles/${id}`)
      .then((r) => {
        if (!cancelled) setResult(r.data.battle.status === "ended" ? r.data.battle : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active]);

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
          {giftFilterLine(active.giftFilter) && <p className="mt-0.5 truncate text-[10.5px] font-semibold text-ember-hi">{giftFilterLine(active.giftFilter)}</p>}
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
        {/* The last result stays open if the next battle starts under it. */}
        {sharing && <BattleResultSheet battle={sharing} streamId={streamId} onClose={() => setSharing(null)} />}
      </div>
    );
  }

  const line = result ? resultLine(result, streamId) : null;

  return (
    <div className={cn("flex flex-col gap-2", inline ? "items-stretch" : "items-end")}>
      {/* The last battle's result, with the card to post it, until it's put away. */}
      {result && line && (
        <div className={cn("flex items-start gap-2.5 rounded-sm bg-white/[0.05] p-2.5", inline ? "w-full" : "w-[360px]")}>
          {line.won ? (
            <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-foil text-[#1a1206]">
              <Trophy size={11} weight="fill" />
            </span>
          ) : (
            <Sword size={16} weight="fill" className="mt-0.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <span className="font-semibold text-foreground">{line.said}</span>
              <span className="text-muted-foreground"> · {line.scores}</span>
            </p>
            <Pill size="sm" variant="primary" icon={<ShareNetwork size={14} weight="fill" />} onClick={() => setSharing(result)} className="mt-2">
              Share the result
            </Pill>
          </div>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            aria-label="Put the result away"
          >
            <X size={13} />
          </button>
        </div>
      )}
      {sharing && <BattleResultSheet battle={sharing} streamId={streamId} onClose={() => setSharing(null)} />}
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
            {giftFilterLine(b.giftFilter) && <span className="w-full pb-0.5 text-[12px] font-semibold">{giftFilterLine(b.giftFilter)} toward the score.</span>}
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
            {giftFilterLine(outgoing.giftFilter) && <span className="text-[12px] text-ember-hi">{giftFilterLine(outgoing.giftFilter)}</span>}
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
          <BattleGiftFilter onlySome={onlySome} onOnlySome={setOnlySome} chosen={chosenGifts} onChosen={setChosenGifts} />
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
                disabled={busy || needsPartner || needsGifts}
                onClick={() => act(`/api/battles/invite`, { challengerUsername: s.streamerId.username, forfeit: forfeit.trim(), mode, giftFilter })}
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
                disabled={busy || !bookName.trim() || !bookAt || needsGifts}
                onClick={() =>
                  act(`/api/battles/schedule`, {
                    challengerUsername: bookName.trim().replace(/^@/, ""),
                    scheduledAt: new Date(bookAt).toISOString(),
                    forfeit: forfeit.trim(),
                    mode,
                    giftFilter,
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
                      {giftFilterLine(b.giftFilter) ? ` · ${giftFilterLine(b.giftFilter)!.replace(/^Only/, "only")}` : ""}
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
