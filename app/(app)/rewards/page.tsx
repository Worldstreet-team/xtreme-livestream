"use client";

import { useEffect, useState } from "react";
import { Coins, Fire, Wallet, ArrowRight, Check, Clock, Warning, Sparkle, Ticket, Gift, Eye } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { announcePoints, formatPoints } from "@/lib/games";
import { cn } from "@/lib/utils";
import { Pill } from "@/components/ui/pill";
import { Empty } from "@/components/app/empty";

/**
 * Your points: what you have, how you earned it, and the one thing you can
 * do with it beyond playing — turn thousands into wallet money. The rules
 * are printed, not hidden; a redemption that can't be paid this minute is
 * shown as pending, not lost.
 */

interface Ledger {
  delta: number;
  balanceAfter: number;
  reason: string;
  at: string;
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
interface Rules {
  pointsPerUsd: number;
  minPoints: number;
  dailyCapPoints: number;
  minAccountAgeDays: number;
  treasuryReady: boolean;
}

const REASON: Record<string, { label: string; icon: typeof Coins }> = {
  welcome: { label: "Welcome", icon: Sparkle },
  watch: { label: "Watching", icon: Eye },
  streak: { label: "Daily streak", icon: Fire },
  drop: { label: "Drop", icon: Gift },
  game_stake: { label: "Prediction stake", icon: Sparkle },
  game_win: { label: "Prediction win", icon: Sparkle },
  game_refund: { label: "Refund", icon: Sparkle },
  raffle_ticket: { label: "Raffle ticket", icon: Ticket },
  raffle_win: { label: "Raffle win", icon: Ticket },
  quiz_win: { label: "Quiz", icon: Sparkle },
  redeem: { label: "Redeemed", icon: Wallet },
  adjust: { label: "Adjustment", icon: Coins },
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function RewardsPage() {
  const [balance, setBalance] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [thousands, setThousands] = useState(5);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const [p, o] = await Promise.all([
      apiFetch<{ success: boolean; data: { balance: number; streakDays: number; ledger: Ledger[] } }>(`/api/user/me/points`).then((r) => r.data).catch(() => null),
      apiFetch<{ success: boolean; data: { payouts: PayoutRow[]; rules: Rules } }>(`/api/user/me/payouts`).then((r) => r.data).catch(() => null),
    ]);
    if (p) {
      setBalance(p.balance);
      setStreak(p.streakDays);
      setLedger(p.ledger);
    }
    if (o) {
      setPayouts(o.payouts);
      setRules(o.rules);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const points = thousands * 1000;
  const canRedeem = rules && balance !== null && points >= rules.minPoints && points <= balance;

  const redeem = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { payout: PayoutRow; pointsBalance: number } }>(`/api/user/me/points/redeem`, {
        method: "POST",
        body: JSON.stringify({ points }),
      });
      announcePoints(r.data.pointsBalance);
      setNote({ ok: true, text: r.data.payout.status === "paid" ? `$${(r.data.payout.usdMinor / 100).toFixed(2)} is in your wallet.` : `$${(r.data.payout.usdMinor / 100).toFixed(2)} is on its way — pending until the treasury pays it out.` });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't redeem" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-4xl">
        {/* Balance */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-sm bg-white/[0.04] p-5 sm:col-span-2">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">Your points</p>
            <p className="mt-2 flex items-center gap-3 text-4xl font-bold tracking-tight text-foreground tabular-nums">
              <Coins size={30} weight="fill" className="text-amber-300" />
              {balance === null ? "—" : formatPoints(balance)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Earned by watching, playing and winning. Never for sale. {rules ? `${formatPoints(rules.pointsPerUsd)} points is $1.` : ""}
            </p>
          </div>
          <div className="rounded-sm bg-white/[0.04] p-5">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">Watch streak</p>
            <p className="mt-2 flex items-center gap-2 text-4xl font-bold tracking-tight text-foreground tabular-nums">
              <Fire size={28} weight="fill" className="text-orange-400" />
              {streak}
              <span className="text-base font-medium text-muted-foreground">day{streak === 1 ? "" : "s"}</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Your first watch each day pays more the longer the run.</p>
          </div>
        </div>

        {/* Redeem */}
        <section className="mt-6 rounded-sm bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-[17px] font-semibold text-foreground">
                <Wallet size={18} weight="fill" />
                Redeem to your wallet
              </h2>
              <p className="mt-1 max-w-[56ch] text-sm text-muted-foreground">
                {rules
                  ? `At least ${formatPoints(rules.minPoints)} points, in thousands, up to ${formatPoints(rules.dailyCapPoints)} a day, once your account is ${rules.minAccountAgeDays} days old.`
                  : "Loading the rules…"}
                {rules && !rules.treasuryReady ? " Payouts are queued until the treasury account is connected." : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full bg-[#26262D]">
                <button type="button" onClick={() => setThousands((t) => Math.max(1, t - 1))} className="size-9 rounded-full text-foreground hover:bg-white/[0.08]" aria-label="Less">−</button>
                <span className="min-w-[7.5rem] text-center text-sm font-semibold text-foreground tabular-nums">
                  {formatPoints(points)} pts → ${thousands}
                </span>
                <button type="button" onClick={() => setThousands((t) => Math.min(20, t + 1))} className="size-9 rounded-full text-foreground hover:bg-white/[0.08]" aria-label="More">+</button>
              </div>
              <Pill size="md" variant="primary" icon={<ArrowRight size={15} weight="bold" />} onClick={redeem} disabled={!canRedeem || busy}>
                Redeem
              </Pill>
            </div>
          </div>
          {note && (
            <p className={cn("mt-3 flex items-center gap-1.5 text-sm", note.ok ? "text-emerald-300" : "text-red-400")}>
              {note.ok ? <Check size={14} weight="bold" /> : <Warning size={14} weight="bold" />}
              {note.text}
            </p>
          )}
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Payouts */}
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-foreground">Payouts</h2>
            {payouts.length === 0 ? (
              <Empty
                className="rounded-sm border border-dashed border-white/[0.1] py-8"
                title="Nothing yet"
                body="Your first redemption or battle bonus lands here."
              />
            ) : (
              <div className="flex flex-col gap-1.5">
                {payouts.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-sm bg-white/[0.03] px-3.5 py-2.5">
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", p.status === "paid" ? "bg-emerald-500/[0.16] text-emerald-300" : p.status === "failed" ? "bg-red-500/[0.16] text-red-300" : "bg-amber-400/[0.16] text-amber-300")}>
                      {p.status === "paid" ? <Check size={14} weight="bold" /> : p.status === "failed" ? <Warning size={14} weight="bold" /> : <Clock size={14} weight="bold" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="text-sm font-medium text-foreground">{p.kind === "battle_bonus" ? "Battle bonus" : `${formatPoints(p.points)} pts redeemed`}</span>
                      <span className="text-xs text-muted-foreground">{when(p.createdAt)} · {p.status}</span>
                    </span>
                    <span className="text-sm font-semibold text-foreground tabular-nums">${(p.usdMinor / 100).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Ledger */}
          <section>
            <h2 className="mb-3 text-[15px] font-semibold text-foreground">Recent activity</h2>
            {ledger.length === 0 ? (
              <Empty
                className="rounded-sm border border-dashed border-white/[0.1] py-8"
                title="Nothing earned yet"
                body="Watching pays points, and so does being the one streaming."
                action={{ label: "Watch a stream", href: "/explore" }}
              />
            ) : (
              <div className="flex flex-col gap-1">
                {ledger.map((l, i) => {
                  const r = REASON[l.reason] ?? REASON.adjust!;
                  const Icon = r.icon;
                  return (
                    <div key={i} className="flex items-center gap-3 rounded-sm px-2 py-2">
                      <Icon size={15} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground/90">{r.label}</span>
                      <span className="text-xs text-muted-foreground">{when(l.at)}</span>
                      <span className={cn("w-16 text-right text-sm font-semibold tabular-nums", l.delta > 0 ? "text-emerald-300" : "text-foreground/80")}>
                        {l.delta > 0 ? "+" : ""}
                        {formatPoints(l.delta)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
