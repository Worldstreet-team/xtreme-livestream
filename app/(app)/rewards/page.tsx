"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Broadcast,
  CalendarPlus,
  ChatCircleDots,
  Check,
  Clock,
  Coins,
  Crown,
  Fire,
  Gift,
  Lightning,
  PlayCircle,
  Sparkle,
  SquaresFour,
  Ticket,
  Trophy,
  UserPlus,
  Wallet,
  Warning,
} from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { announcePoints, formatPoints } from "@/lib/games";
import { cn } from "@/lib/utils";
import { PillTabs } from "@/components/ui/tabs";
import { Money } from "@/components/xtream/money";
import { useCountUp } from "@/lib/use-count-up";

/**
 * Rewards, rebuilt (owner, 2026-09-24). A bento board, not a statement:
 * your balance on the lacquered ember tile, the level you're climbing,
 * the week's streak, then the quests — small things to do today, bigger
 * ones this week, and milestones — each with its progress and a one-tap
 * claim. Cashing out and the history sit under it. Points come from
 * showing up, never from a card; the copy says so wherever it matters.
 */

type Cadence = "daily" | "weekly" | "milestone";
type QuestIcon = "watch" | "rooms" | "chat" | "predict" | "win" | "streak" | "follow" | "live" | "schedule";

interface Quest {
  id: string;
  cadence: Cadence;
  title: string;
  blurb: string;
  icon: QuestIcon;
  unit: string;
  target: number;
  progress: number;
  points: number;
  claimed: boolean;
  claimable: boolean;
  resetsAt: string | null;
  creator: boolean;
}
interface Level {
  level: number;
  tier: string;
  nextTier: { name: string; level: number } | null;
  xp: number;
  floor: number;
  next: number;
}
interface PayoutRow {
  id: string;
  kind: "points_redemption" | "battle_bonus";
  points: number;
  usdMinor: number;
  status: "pending" | "paid" | "failed";
  createdAt: string;
  paidAt: string | null;
}
interface Rewards {
  balance: number;
  level: Level;
  streak: { days: number; week: { day: string; active: boolean }[]; nextBonus: number };
  quests: Quest[];
  earn: { dripPoints: number; dripMinutes: number };
  rules: { pointsPerUsd: number; minPoints: number; dailyCapPoints: number; minAccountAgeDays: number; treasuryReady: boolean };
  payouts: PayoutRow[];
  ledger: { delta: number; balanceAfter: number; reason: string; at: string }[];
}

const QUEST_ICON: Record<QuestIcon, typeof Coins> = {
  watch: PlayCircle,
  rooms: SquaresFour,
  chat: ChatCircleDots,
  predict: Sparkle,
  win: Trophy,
  streak: Fire,
  follow: UserPlus,
  live: Broadcast,
  schedule: CalendarPlus,
};

const REASON: Record<string, { label: string; icon: typeof Coins }> = {
  welcome: { label: "Welcome gift", icon: Gift },
  watch: { label: "Watching live", icon: PlayCircle },
  streak: { label: "Daily streak", icon: Fire },
  drop: { label: "Drop in a live room", icon: Gift },
  game_stake: { label: "Prediction stake", icon: Sparkle },
  game_win: { label: "Called it", icon: Trophy },
  game_refund: { label: "Stake returned", icon: Sparkle },
  raffle_ticket: { label: "Raffle ticket", icon: Ticket },
  raffle_win: { label: "Raffle win", icon: Ticket },
  quiz_win: { label: "Quiz right", icon: Sparkle },
  quest: { label: "Quest claimed", icon: Crown },
  redeem: { label: "Cashed out", icon: Wallet },
  adjust: { label: "Adjustment", icon: Coins },
};

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

/* ------------------------------------------------------------------ */

function countdown(iso: string | null, now: number) {
  if (!iso) return "";
  const ms = Math.max(0, new Date(iso).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */

export default function RewardsPage() {
  const [data, setData] = useState<Rewards | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Cadence>("daily");
  const [now, setNow] = useState(() => Date.now());
  const [gain, setGain] = useState<{ key: number; points: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ success: boolean; data: Rewards }>(`/api/user/me/rewards`);
      setData(r.data);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    // Progress moves while you watch in another tab; keep up quietly.
    const refresh = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [load]);

  const claim = async (quest: Quest) => {
    const r = await apiFetch<{ success: boolean; data: { points: number; pointsBalance: number } }>(`/api/user/me/quests/${quest.id}/claim`, { method: "POST" });
    announcePoints(r.data.pointsBalance);
    setGain({ key: Date.now(), points: r.data.points });
    setData((d) =>
      d
        ? {
            ...d,
            balance: r.data.pointsBalance,
            quests: d.quests.map((q) => (q.id === quest.id ? { ...q, claimed: true, claimable: false } : q)),
          }
        : d,
    );
    void load();
  };

  if (failed && !data) {
    return (
      <Shell>
        <div className={cn(TILE, "grid place-items-center px-6 py-20 text-center")}>
          <Warning size={28} className="text-chili-hi" />
          <p className="mt-3 font-wide text-[20px] font-bold tracking-[-0.02em]">Rewards didn&apos;t load</p>
          <p className="mt-1 max-w-[42ch] text-[14px] text-muted-foreground">Your points are safe — this is just the page. Try again in a moment.</p>
          <button type="button" onClick={() => void load()} className="press mt-5 h-10 rounded-full bg-white px-5 text-[14px] font-semibold text-[#0b0708]">
            Try again
          </button>
        </div>
      </Shell>
    );
  }

  if (!data) return <Shell><Skeleton /></Shell>;

  const ready = (c: Cadence) => data.quests.filter((q) => q.cadence === c && q.claimable).length;

  return (
    <Shell>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4 md:mb-9">
        <div>
          <p className={EYEBROW}>Rewards</p>
          <h1 className="mt-2 max-w-[18ch] font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">
            Show up. It adds up.
          </h1>
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-muted-foreground">
            Points come from watching, chatting and calling it — never from your card. Finish quests to earn faster, climb levels, and cash out when you&apos;re ready.
          </p>
        </div>
        <Link href="/explore" className="press flex h-10 items-center gap-2 rounded-full bg-control px-4 text-[14px] font-semibold hover:bg-control-hover">
          <PlayCircle size={17} weight="fill" className="text-chili-hi" />
          Find a live room
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6 lg:grid-cols-12">
        <BalanceTile balance={data.balance} rules={data.rules} gain={gain} />
        <LevelTile level={data.level} />
        <StreakTile streak={data.streak} />
      </div>

      <section aria-labelledby="quests-title" className="mt-10 md:mt-14">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="quests-title" className="scroll-mt-24 font-wide text-[24px] font-bold tracking-[-0.03em]">Quests</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {tab === "daily" && "Four small ones, every day. They reset at midnight UTC."}
              {tab === "weekly" && "Bigger asks, bigger payouts. The week turns over on Monday."}
              {tab === "milestone" && "Once each, ever. The firsts worth remembering."}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {tab !== "milestone" && (
              <span className="flex items-center gap-1.5 font-mono text-[12px] text-muted-foreground tabular-nums">
                <Clock size={14} />
                Resets in {countdown(data.quests.find((q) => q.cadence === tab)?.resetsAt ?? null, now)}
              </span>
            )}
            <PillTabs
              label="Quest cadence"
              items={[
                { id: "daily" as const, label: "Daily", count: ready("daily") || null },
                { id: "weekly" as const, label: "Weekly", count: ready("weekly") || null },
                { id: "milestone" as const, label: "Milestones", count: ready("milestone") || null },
              ]}
              value={tab}
              onChange={setTab}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.quests
            .filter((q) => q.cadence === tab)
            .sort((a, b) => Number(b.claimable) - Number(a.claimable) || Number(a.claimed) - Number(b.claimed))
            .map((q) => (
              <QuestCard key={q.id} quest={q} onClaim={claim} />
            ))}
        </div>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-3 md:mt-14 lg:grid-cols-12">
        <RedeemTile balance={data.balance} rules={data.rules} waiting={data.quests.filter((q) => !q.claimed).reduce((sum, q) => sum + q.points, 0)} onDone={load} />
        <EarnTile earn={data.earn} streakBonus={data.streak.nextBonus} />
        <ActivityTile ledger={data.ledger} />
        <PayoutsTile payouts={data.payouts} />
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[1180px]">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function BalanceTile({ balance, rules, gain }: { balance: number; rules: Rewards["rules"]; gain: { key: number; points: number } | null }) {
  const shown = useCountUp(balance);
  const cents = Math.floor(balance / rules.pointsPerUsd) * 100;
  return (
    <div
      className={cn(
        "relative isolate flex min-h-[248px] flex-col overflow-hidden rounded-panel bg-ember text-on-ember p-6 md:col-span-6 lg:col-span-5 md:p-7",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="caps font-mono text-[10.5px] text-on-ember/70">Balance</p>
        <span className="flex items-center gap-1.5 rounded-full bg-on-ember/10 px-2.5 py-1 text-[11.5px] font-semibold text-on-ember/85">
          <Lightning size={12} weight="fill" className="text-on-ember" />
          Never for sale
        </span>
      </div>
      <div className="relative mt-auto">
        <p className="flex items-baseline gap-3">
          <span className="font-money text-[clamp(3.25rem,7vw,5.25rem)] leading-none text-on-ember tabular-nums">{formatPoints(shown)}</span>
          <span className="font-wide text-[16px] font-bold tracking-[-0.02em] text-on-ember/70">pts</span>
        </p>
        {gain && (
          <span
            key={gain.key}
            className="pointer-events-none absolute -top-2 left-1 font-mono text-[15px] font-bold text-on-ember motion-safe:animate-[xt-rise_1.4s_var(--ease-out)_both]"
          >
            +{formatPoints(gain.points)}
          </span>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-2 text-[14px] text-on-ember/80">
          Worth <Money cents={cents} size="sm" className="font-bold text-on-ember" /> when you cash out
          <span className="text-on-ember/45">·</span>
          <span className="font-mono text-[12.5px]">{formatPoints(rules.pointsPerUsd)} pts = $1</span>
        </p>
      </div>
    </div>
  );
}

function LevelTile({ level }: { level: Level }) {
  const span = Math.max(1, level.next - level.floor);
  const into = Math.max(0, level.xp - level.floor);
  const pct = Math.min(1, into / span);
  const r = 54;
  const c = 2 * Math.PI * r;
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDrawn(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className={cn(TILE, "flex items-center gap-5 p-6 md:col-span-3 lg:col-span-4")}>
      <div className="relative size-[132px] shrink-0">
        <svg viewBox="0 0 132 132" className="size-full -rotate-90" aria-hidden>
          <defs>
            {/* Rings are one of heat's three homes. */}
            <linearGradient id="level-heat" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff2b45" />
              <stop offset="0.52" stopColor="#f85810" />
              <stop offset="1" stopColor="#f8a008" />
            </linearGradient>
          </defs>
          <circle cx="66" cy="66" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" />
          <circle
            cx="66"
            cy="66"
            r={r}
            fill="none"
            stroke="url(#level-heat)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - drawn)}
            className="transition-[stroke-dashoffset] duration-[1100ms] [transition-timing-function:var(--ease-out)]"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-money text-[40px] leading-none tabular-nums">{level.level}</p>
            <p className="caps mt-1 font-mono text-[9.5px] text-muted-foreground">Level</p>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <p className={EYEBROW}>Tier</p>
        <p className="mt-1 font-wide text-[26px] leading-none font-bold tracking-[-0.03em]">{level.tier}</p>
        <p className="mt-3 text-[13.5px] leading-snug text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">{formatPoints(level.next - level.xp)}</span> pts to level {level.level + 1}
        </p>
        {level.nextTier && (
          <p className="mt-1.5 text-[12.5px] text-muted-foreground/80">
            {level.nextTier.name} at level {level.nextTier.level}
          </p>
        )}
      </div>
    </div>
  );
}

function StreakTile({ streak }: { streak: Rewards["streak"] }) {
  const letters = streak.week.map((d) => new Date(d.day + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" }));
  return (
    <div className={cn(TILE, "flex flex-col p-6 md:col-span-3 lg:col-span-3")}>
      <div className="flex items-center justify-between">
        <p className={EYEBROW}>Streak</p>
        <Fire size={18} weight="fill" className={streak.days > 0 ? "text-chili-hi" : "text-muted-foreground/40"} />
      </div>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="font-money text-[52px] leading-none tabular-nums">{streak.days}</span>
        <span className="text-[14px] text-muted-foreground">day{streak.days === 1 ? "" : "s"}</span>
      </p>
      <div className="mt-auto pt-5">
        <div className="flex justify-between gap-1">
          {streak.week.map((d, i) => (
            <div key={d.day} className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "size-2.5 rounded-full transition-colors",
                  d.active ? "bg-ember" : "bg-white/[0.09]",
                  i === streak.week.length - 1 && !d.active && "ring-1 ring-ember/60",
                )}
              />
              <span className="font-mono text-[10px] text-muted-foreground/70">{letters[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] leading-snug text-muted-foreground">
          {streak.week[streak.week.length - 1]?.active
            ? `Tomorrow's first watch pays +${streak.nextBonus}.`
            : `Watch today to keep it — first watch pays +${streak.nextBonus}.`}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function QuestCard({ quest, onClaim }: { quest: Quest; onClaim: (q: Quest) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const Icon = QUEST_ICON[quest.icon] ?? Sparkle;
  const pct = Math.round((quest.progress / quest.target) * 100);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await onClaim(quest);
      setBurst((b) => b + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't claim that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={cn(
        TILE,
        "group flex min-h-[208px] flex-col p-5 transition-[background-color,transform] duration-300 hover:bg-surface-raised",
        // Ready to claim: solid Ember, ink on it (owner, 2026-09-24).
        quest.claimable && "bg-ember text-on-ember hover:bg-ember hover:brightness-105",
      )}
    >
      {burst > 0 && (
        <span
          key={burst}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-panel shadow-[inset_0_0_0_2px_rgba(248,88,16,0.9)] motion-safe:animate-[xt-ring-burst_.8s_var(--ease-out)_both] motion-reduce:hidden"
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex size-10 items-center justify-center rounded-control", quest.claimed ? "bg-white/[0.05] text-muted-foreground" : quest.claimable ? "bg-on-ember/10 text-on-ember" : "bg-control text-foreground")}>
          <Icon size={20} weight={quest.claimable ? "fill" : "regular"} />
        </span>
        <span className={cn("rounded-full px-2.5 py-1 font-mono text-[12px] font-bold tabular-nums", quest.claimed ? "bg-white/[0.05] text-muted-foreground" : quest.claimable ? "bg-on-ember/[0.12] text-on-ember" : "bg-ember/[0.14] text-ember-hi")}>
          +{formatPoints(quest.points)}
        </span>
      </div>
      <div className="mt-4">
        <h3 className="flex items-center gap-2 font-wide text-[16.5px] leading-tight font-bold tracking-[-0.02em]">
          {quest.title}
          {quest.creator && <span className={cn("caps rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold", quest.claimable ? "bg-on-ember/10 text-on-ember/75" : "bg-white/[0.06] text-muted-foreground")}>Creator</span>}
        </h3>
        <p className={cn("mt-1.5 text-[13.5px] leading-snug", quest.claimable ? "text-on-ember/75" : "text-muted-foreground")}>{quest.blurb}</p>
      </div>
      <div className="mt-auto pt-5">
        {quest.claimed ? (
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
            <Check size={15} weight="bold" className="text-ember-hi" />
            Claimed{quest.cadence === "daily" ? " — back tomorrow" : quest.cadence === "weekly" ? " — back Monday" : ""}
          </p>
        ) : quest.claimable ? (
          <button
            type="button"
            onClick={claim}
            disabled={busy}
            className="press flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white text-[14px] font-semibold text-[#0b0708] transition-opacity disabled:opacity-70"
          >
            {busy ? "Claiming…" : `Claim +${formatPoints(quest.points)}`}
            {!busy && <ArrowRight size={15} weight="bold" />}
          </button>
        ) : (
          <>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-ember transition-[width] duration-700 [transition-timing-function:var(--ease-out)]" style={{ width: `${Math.max(pct, 2)}%` }} />
            </div>
            <p className="mt-2 flex justify-between font-mono text-[12px] text-muted-foreground tabular-nums">
              <span>
                {formatPoints(quest.progress)} / {formatPoints(quest.target)} {quest.unit}
              </span>
              <span>{pct}%</span>
            </p>
          </>
        )}
        {error && <p className={cn("mt-2 text-[12.5px]", quest.claimable ? "font-semibold text-on-ember" : "text-chili-hi")}>{error}</p>}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

function RedeemTile({ balance, rules, waiting, onDone }: { balance: number; rules: Rewards["rules"]; waiting: number; onDone: () => void }) {
  const maxK = Math.max(0, Math.min(Math.floor(balance / rules.pointsPerUsd), Math.floor(rules.dailyCapPoints / rules.pointsPerUsd)));
  const minK = Math.ceil(rules.minPoints / rules.pointsPerUsd);
  const [k, setK] = useState(minK);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const eligible = maxK >= minK;
  const value = Math.min(Math.max(k, minK), Math.max(maxK, minK));
  const points = value * rules.pointsPerUsd;

  const redeem = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { payout: PayoutRow; pointsBalance: number } }>(`/api/user/me/points/redeem`, {
        method: "POST",
        body: JSON.stringify({ points }),
      });
      announcePoints(r.data.pointsBalance);
      const usd = `$${(r.data.payout.usdMinor / 100).toFixed(2)}`;
      setNote({ ok: true, text: r.data.payout.status === "paid" ? `${usd} just landed in your wallet.` : `${usd} is queued — it pays out the moment the treasury is connected. Nothing is lost.` });
      onDone();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't cash out" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="redeem-title" className={cn(TILE, "flex flex-col p-6 lg:col-span-7 md:p-7")}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={EYEBROW}>Cash out</p>
          <h2 id="redeem-title" className="mt-2 font-wide text-[22px] font-bold tracking-[-0.03em]">Turn points into wallet money</h2>
        </div>
        <Wallet size={22} weight="duotone" className="text-muted-foreground" />
      </div>

      {eligible ? (
        <>
          <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
            <div>
              <p className="font-money text-[44px] leading-none tabular-nums">{formatPoints(points)}</p>
              <p className="mt-1.5 text-[13px] text-muted-foreground">points</p>
            </div>
            <ArrowRight size={22} className="mb-5 hidden text-muted-foreground/50 sm:block" />
            <div className="text-right">
              <Money cents={value * 100} size="lg" />
              <p className="mt-1.5 text-[13px] text-muted-foreground">to your wallet</p>
            </div>
          </div>
          <input
            type="range"
            min={minK}
            max={Math.max(maxK, minK)}
            step={1}
            value={value}
            onChange={(e) => setK(Number(e.target.value))}
            aria-label="How many points to cash out"
            className="mt-6 w-full accent-ember"
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground tabular-nums">
            <span>{formatPoints(minK * rules.pointsPerUsd)}</span>
            <span>{formatPoints(Math.max(maxK, minK) * rules.pointsPerUsd)}</span>
          </div>
          <button
            type="button"
            onClick={redeem}
            disabled={busy}
            className="press mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-[#0b0708] shadow-glow-white disabled:opacity-60 sm:w-auto sm:px-7"
          >
            {busy ? "Cashing out…" : `Cash out $${value}.00`}
          </button>
        </>
      ) : (
        <div className="mt-6">
          <p className="flex items-baseline gap-2.5 font-money tabular-nums">
            <span className="text-[44px] leading-none">{formatPoints(balance)}</span>
            <span className="text-[18px] leading-none text-muted-foreground">/ {formatPoints(rules.minPoints)} pts</span>
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-ember" style={{ width: `${Math.min(100, (balance / rules.minPoints) * 100)}%` }} />
          </div>
          <p className="mt-3 text-[14px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{formatPoints(Math.max(0, rules.minPoints - balance))}</span> more points and you can cash out your first{" "}
            <Money cents={(rules.minPoints / rules.pointsPerUsd) * 100} size="sm" />.
          </p>
          {waiting > 0 && (
            <a
              href="#quests-title"
              className="press mt-5 flex items-center justify-between gap-3 rounded-[12px] bg-white/[0.04] px-4 py-3.5 transition-colors hover:bg-white/[0.07]"
            >
              <span className="text-[14px] leading-snug">
                <span className="font-semibold tabular-nums">{formatPoints(waiting)} pts</span>{" "}
                <span className="text-muted-foreground">are waiting in quests — the fastest way there.</span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
            </a>
          )}
        </div>
      )}

      {note && (
        <p className={cn("mt-4 flex items-start gap-2 text-[13.5px]", note.ok ? "text-foreground" : "text-chili-hi")}>
          {note.ok ? <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-ember-hi" /> : <Warning size={15} className="mt-0.5 shrink-0" />}
          {note.text}
        </p>
      )}
      <p className="mt-auto pt-5 text-[12.5px] leading-relaxed text-muted-foreground/80">
        In thousands, from {formatPoints(rules.minPoints)} · up to {formatPoints(rules.dailyCapPoints)} a day · once your account is {rules.minAccountAgeDays} days old.
        {!rules.treasuryReady && " Payouts queue until the treasury is connected."}
      </p>
    </section>
  );
}

function EarnTile({ earn, streakBonus }: { earn: Rewards["earn"]; streakBonus: number }) {
  const ways = [
    { icon: PlayCircle, title: "Watch live", note: `+${earn.dripPoints} every ${earn.dripMinutes} minutes you're in a room` },
    { icon: Fire, title: "Keep the streak", note: `Your first watch each day pays up to +60 — yours is +${streakBonus} now` },
    { icon: Gift, title: "Catch a drop", note: "+50 to someone watching a busy room, every 20 minutes" },
    { icon: Sparkle, title: "Call it", note: "Predictions, raffles and quizzes — stake points, win more" },
    { icon: Crown, title: "Finish quests", note: "The fastest way up. New ones every day and every Monday" },
  ];
  return (
    <section aria-labelledby="earn-title" className={cn(TILE, "p-6 lg:col-span-5 md:p-7")}>
      <p className={EYEBROW}>How points come in</p>
      <h2 id="earn-title" className="mt-2 font-wide text-[22px] font-bold tracking-[-0.03em]">Ways to earn</h2>
      <ul className="mt-5 flex flex-col gap-4">
        {ways.map((w) => (
          <li key={w.title} className="flex items-start gap-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-control">
              <w.icon size={18} className="text-foreground/85" />
            </span>
            <span className="min-w-0">
              <span className="block text-[14.5px] font-semibold">{w.title}</span>
              <span className="block text-[13px] leading-snug text-muted-foreground">{w.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ActivityTile({ ledger }: { ledger: Rewards["ledger"] }) {
  return (
    <section aria-labelledby="activity-title" className={cn(TILE, "p-6 lg:col-span-7 md:p-7")}>
      <p className={EYEBROW}>Ledger</p>
      <h2 id="activity-title" className="mt-2 font-wide text-[22px] font-bold tracking-[-0.03em]">Recent points</h2>
      {ledger.length === 0 ? (
        <p className="mt-5 text-[14px] text-muted-foreground">Nothing yet. Your first ten minutes in a live room starts this list.</p>
      ) : (
        <ol className="mt-4 flex flex-col">
          {ledger.slice(0, 10).map((l, i) => {
            const r = REASON[l.reason] ?? REASON.adjust!;
            return (
              <li key={i} className="flex items-center gap-3 border-t border-white/[0.05] py-2.5 first:border-t-0">
                <r.icon size={16} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[14px]">{r.label}</span>
                <span className="hidden font-mono text-[11.5px] text-muted-foreground sm:block">{when(l.at)}</span>
                <span className={cn("w-16 text-right font-mono text-[13.5px] font-bold tabular-nums", l.delta > 0 ? "text-ember-hi" : "text-muted-foreground")}>
                  {l.delta > 0 ? "+" : ""}
                  {formatPoints(l.delta)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function PayoutsTile({ payouts }: { payouts: PayoutRow[] }) {
  const tone = useMemo(
    () => ({ paid: "text-[#95D477]", pending: "text-[#FFC16E]", failed: "text-chili-hi" }) as Record<PayoutRow["status"], string>,
    [],
  );
  return (
    <section aria-labelledby="payouts-title" className={cn(TILE, "p-6 lg:col-span-5 md:p-7")}>
      <p className={EYEBROW}>Wallet</p>
      <h2 id="payouts-title" className="mt-2 font-wide text-[22px] font-bold tracking-[-0.03em]">Payouts</h2>
      {payouts.length === 0 ? (
        <p className="mt-5 text-[14px] text-muted-foreground">Your first cash-out or battle bonus lands here, with its status.</p>
      ) : (
        <ol className="mt-4 flex flex-col">
          {payouts.map((p) => (
            <li key={p.id} className="flex items-center gap-3 border-t border-white/[0.05] py-2.5 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px]">{p.kind === "battle_bonus" ? "Battle bonus" : `${formatPoints(p.points)} pts cashed out`}</span>
                <span className="block font-mono text-[11.5px] text-muted-foreground">
                  {when(p.createdAt)} · <span className={tone[p.status]}>{p.status}</span>
                </span>
              </span>
              <Money cents={p.usdMinor} size="sm" />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-6 lg:grid-cols-12" aria-busy>
      <div className="h-[248px] animate-pulse rounded-panel bg-white/[0.04] md:col-span-6 lg:col-span-5" />
      <div className="h-[248px] animate-pulse rounded-panel bg-white/[0.04] md:col-span-3 lg:col-span-4" />
      <div className="h-[248px] animate-pulse rounded-panel bg-white/[0.04] md:col-span-3 lg:col-span-3" />
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[208px] animate-pulse rounded-panel bg-white/[0.04] md:col-span-3 lg:col-span-3" />
      ))}
    </div>
  );
}
