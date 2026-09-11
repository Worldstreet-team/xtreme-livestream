"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Wallet,
  Plus,
  ArrowLineDown,
  Coins,
  Gift,
  Clock,
  Check,
  Warning,
  ArrowUpRight,
  Receipt,
  Fire,
  Sparkle,
  Ticket,
  Eye,
  ArrowDown,
  ArrowUp,
  Sword,
} from "@phosphor-icons/react";
import { apiFetch, ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatPoints } from "@/lib/games";
import { cn } from "@/lib/utils";
import { PillTabs } from "@/components/ui/tabs";
import { BrandMark } from "@/components/ui/brand-mark";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";
import { Empty } from "@/components/app/empty";

/**
 * The wallet: one screen for the money, laid out the way a banking app lays
 * one out. A balance card at the top with the actions on it, three figures
 * that summarise the account under it, and then one segmented list — gifts,
 * payouts, points — because everything below the balance is history.
 *
 * The dollar balance itself lives in the central WorldStreet wallet, so it
 * can be unreachable while everything else on the page still reads from our
 * own records. That case is drawn as "unavailable", never as zero: a wrong
 * balance is worse than no balance.
 */

const WALLET_HOME = "https://dashboard.worldstreetgold.com";

interface Party {
  _id: string;
  username: string;
  displayName: string;
  avatar: string;
}
interface Txn {
  _id: string;
  senderId: Party | null;
  streamerId: Party | null;
  giftName: string;
  emoji: string;
  grossUsdMinor: number;
  netUsdMinor: number;
  battleId: string | null;
  createdAt: string;
}
interface Earnings {
  balanceUsdMinor: number;
  receivedUsdMinor: number;
  receivedCount: number;
  sentUsdMinor: number;
  sentCount: number;
  commissionPercent: number;
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
interface Ledger {
  delta: number;
  balanceAfter: number;
  reason: string;
  at: string;
}

type Tab = "activity" | "payouts" | "points";

/** Always two decimals: a balance that renders "$8" reads as an estimate. */
const money = (minor: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);

const REASON: Record<string, { label: string; icon: typeof Coins }> = {
  welcome: { label: "Welcome bonus", icon: Sparkle },
  watch: { label: "Watching", icon: Eye },
  streak: { label: "Daily streak", icon: Fire },
  drop: { label: "Caught a drop", icon: Gift },
  game_stake: { label: "Prediction stake", icon: Sparkle },
  game_win: { label: "Prediction win", icon: Sparkle },
  game_refund: { label: "Refund", icon: Sparkle },
  raffle_ticket: { label: "Raffle ticket", icon: Ticket },
  raffle_win: { label: "Raffle win", icon: Ticket },
  quiz_win: { label: "Quiz win", icon: Sparkle },
  redeem: { label: "Redeemed to wallet", icon: Wallet },
  adjust: { label: "Adjustment", icon: Coins },
};

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function WalletPage() {
  const { user, isLoading } = useAuth();
  const [availableMinor, setAvailableMinor] = useState<number | null>(null);
  const [lockedMinor, setLockedMinor] = useState(0);
  const [walletDown, setWalletDown] = useState(false);
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [points, setPoints] = useState<{ balance: number; streakDays: number; ledger: Ledger[] } | null>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const [b, e, o, p] = await Promise.all([
        apiFetch<{ success: boolean; data: { availableUsdMinor: number; lockedUsdMinor: number } }>(`/api/wallet/balance`)
          .then((r) => r.data)
          .catch((err) => (err instanceof ApiError && err.status === 503 ? "down" : null) as "down" | null),
        apiFetch<{ success: boolean; data: { earnings: Earnings; transactions: Txn[] } }>(`/api/user/me/earnings`).then((r) => r.data).catch(() => null),
        apiFetch<{ success: boolean; data: { payouts: PayoutRow[] } }>(`/api/user/me/payouts`).then((r) => r.data).catch(() => null),
        apiFetch<{ success: boolean; data: { balance: number; streakDays: number; ledger: Ledger[] } }>(`/api/user/me/points`).then((r) => r.data).catch(() => null),
      ]);
      if (cancelled) return;
      if (b === "down" || b === null) setWalletDown(true);
      else if (b) {
        setAvailableMinor(b.availableUsdMinor);
        setLockedMinor(b.lockedUsdMinor);
      }
      if (e) {
        setEarnings(e.earnings);
        setTxns(e.transactions);
      }
      if (o) setPayouts(o.payouts);
      if (p) setPoints(p);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!isLoading && !user) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
        <Wallet size={34} className="mb-4 text-muted-foreground/25" />
        <p className="text-[15px] font-semibold text-foreground">Your wallet lives behind sign-in</p>
        <p className="mt-1 max-w-[42ch] text-sm text-muted-foreground">Gifts you receive, payouts and points all land here once you sign in.</p>
        <a href="https://www.worldstreetgold.com/login" className="mt-5 flex h-10 items-center rounded-full bg-white px-5 text-sm font-semibold text-neutral-950">
          Sign in
        </a>
      </div>
    );
  }

  const tabs = [
    { id: "activity" as const, label: "Gifts", icon: Gift, count: txns.length || null },
    { id: "payouts" as const, label: "Payouts", icon: Receipt, count: payouts.length || null },
    { id: "points" as const, label: "Points", icon: Coins, count: null },
  ];

  return (
    <div className="min-h-screen p-4 pb-24 md:p-6">
      {/* Two columns on a wide screen: the account on the left, its history
          on the right, so neither has to scroll past the other. */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2.5 lg:sticky lg:top-20">
        {/* ── The balance card: the money, and the two things you do with it. */}
        <section className="relative overflow-hidden rounded-sm">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(220,38,38,0.32),transparent_55%),linear-gradient(160deg,#1b1b1f,#101012)]" />
          <BrandMark size={260} className="absolute -right-8 -bottom-14 opacity-[0.06]" />
          <div className="relative p-5 md:p-6">
            <div className="flex items-center gap-2">
              <Wallet size={14} weight="fill" className="text-white/60" />
              <span className="text-[11px] font-semibold tracking-[0.14em] text-white/60 uppercase">Available balance</span>
              <span className="ml-auto rounded-full bg-white/[0.1] px-2 py-0.5 text-[11px] font-semibold text-white/80">USD</span>
            </div>

            <p className="mt-3 leading-none font-bold tracking-tight text-white tabular-nums">
              {loading ? (
                <span className="inline-block h-9 w-44 animate-pulse rounded bg-white/10 align-middle" />
              ) : walletDown ? (
                <span className="text-[26px] text-white/45">Unavailable</span>
              ) : (
                <span className="text-[40px] md:text-[44px]">{money(availableMinor ?? 0)}</span>
              )}
            </p>

            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-white/60">
              {walletDown ? (
                <span className="flex items-center gap-1.5 text-amber-300/90">
                  <Warning size={13} weight="fill" />
                  The WorldStreet wallet isn&apos;t reachable from here — your history below is still current.
                </span>
              ) : (
                <>
                  {lockedMinor > 0 && <span>{money(lockedMinor)} on hold</span>}
                  <span>Spend it on gifts anywhere on Xtream.</span>
                </>
              )}
            </p>

            {/* Actions, as a row of round buttons — the app grammar. */}
            <div className="mt-5 flex gap-2.5 overflow-x-auto scrollbar-none">
              <Action icon={<Plus size={19} weight="bold" />} label="Top up" href={WALLET_HOME} external primary />
              <Action icon={<ArrowLineDown size={19} weight="bold" />} label="Withdraw" href={WALLET_HOME} external />
              <Action icon={<Coins size={19} weight="fill" />} label="Redeem points" href="/rewards" />
              <Action icon={<Receipt size={19} weight="fill" />} label="Statement" href={WALLET_HOME} external />
            </div>
          </div>
        </section>

        {/* ── The three figures that describe the account. */}
        <section className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-2">
          <Figure
            label="Earned from gifts"
            value={earnings ? money(earnings.balanceUsdMinor) : "—"}
            note={earnings ? `${earnings.receivedCount} gift${earnings.receivedCount === 1 ? "" : "s"} received` : "No gifts yet"}
            icon={<Gift size={15} weight="fill" className="text-emerald-300" />}
          />
          <Figure
            label="Sent in gifts"
            value={earnings ? money(earnings.sentUsdMinor) : "—"}
            note={earnings ? `${earnings.sentCount} sent` : "Nothing sent yet"}
            icon={<ArrowUp size={15} weight="bold" className="text-sky-300" />}
          />
          <Figure
            label="Points"
            value={points ? formatPoints(points.balance) : "—"}
            note={points ? `${points.streakDays}-day streak · 1,000 = $1` : "Watch to earn"}
            icon={<Coins size={15} weight="fill" className="text-amber-300" />}
            href="/rewards"
            className="col-span-2 md:col-span-1 lg:col-span-2"
          />
        </section>
        </div>

        {/* ── History, one list at a time. */}
        <section className="min-w-0 rounded-sm bg-white/[0.02] p-3 md:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">History</h2>
            <PillTabs size="sm" label="Wallet history" value={tab} onChange={setTab} items={tabs} />
          </div>

          {loading ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-sm bg-white/[0.04]" />
              ))}
            </div>
          ) : tab === "activity" ? (
            txns.length === 0 ? (
              <Empty
                className={PANEL}
                icon={<Gift size={26} />}
                title="No gifts yet"
                body="Gifts you send and receive show up here. Going live is how you start receiving them."
              />
            ) : (
              <div className="flex flex-col gap-1">
                {txns.map((t) => {
                  const received = t.streamerId?._id === user?.id || t.streamerId?.username === user?.username;
                  const other = received ? t.senderId : t.streamerId;
                  const amount = received ? t.netUsdMinor : t.grossUsdMinor;
                  return (
                    <div key={t._id} className="flex items-center gap-3 rounded-sm px-2.5 py-2.5 transition-colors hover:bg-white/[0.03]">
                      <span className={cn("relative flex size-11 shrink-0 items-center justify-center rounded-full", received ? "bg-emerald-500/[0.12]" : "bg-white/[0.06]")}>
                        <GiftArt emoji={t.emoji} size={26} />
                        <span className={cn("absolute -right-0.5 -bottom-0.5 flex size-[18px] items-center justify-center rounded-full ring-2 ring-background", received ? "bg-emerald-500 text-neutral-950" : "bg-[#31313A] text-white")}>
                          {received ? <ArrowDown size={10} weight="bold" /> : <ArrowUp size={10} weight="bold" />}
                        </span>
                      </span>
                      {other && <UserAvatar src={other.avatar} name={other.displayName || other.username} size={28} className="hidden size-7 shrink-0 sm:block" />}
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-[14px] font-medium text-foreground">
                          {t.giftName || "Gift"}
                          <span className="text-muted-foreground"> {received ? "from" : "to"} </span>
                          {other ? (
                            <Link href={`/c/${other.username}`} className="hover:underline">
                              {other.displayName || other.username}
                            </Link>
                          ) : (
                            "someone"
                          )}
                        </span>
                        <span className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
                          {when(t.createdAt)}
                          {t.battleId && (
                            <span className="flex items-center gap-0.5 rounded-[4px] bg-white/[0.08] px-1 py-px text-[10px] font-semibold text-foreground/80">
                              <Sword size={9} weight="fill" />
                              Battle
                            </span>
                          )}
                        </span>
                      </span>
                      <span className={cn("shrink-0 text-[14px] font-semibold tabular-nums", received ? "text-emerald-300" : "text-foreground/85")}>
                        {received ? "+" : "−"}
                        {money(amount)}
                      </span>
                    </div>
                  );
                })}
                {earnings && earnings.receivedCount > 0 && (
                  <p className="mt-2 px-2.5 text-[11.5px] text-muted-foreground/60">
                    Received amounts are what reached you, after the {earnings.commissionPercent}% platform fee.
                  </p>
                )}
              </div>
            )
          ) : tab === "payouts" ? (
            payouts.length === 0 ? (
              <Empty
                className={PANEL}
                icon={<Receipt size={26} />}
                title="No payouts yet"
                body="Redeem points, or win a battle bonus, and the payout lands here."
                action={{ label: "Open Rewards", href: "/rewards" }}
              />
            ) : (
              <div className="flex flex-col gap-1">
                {payouts.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-sm px-2.5 py-2.5">
                    <span
                      className={cn(
                        "flex size-11 shrink-0 items-center justify-center rounded-full",
                        p.status === "paid" ? "bg-emerald-500/[0.14] text-emerald-300" : p.status === "failed" ? "bg-red-500/[0.14] text-red-300" : "bg-amber-400/[0.14] text-amber-300"
                      )}
                    >
                      {p.status === "paid" ? <Check size={17} weight="bold" /> : p.status === "failed" ? <Warning size={17} weight="fill" /> : <Clock size={17} weight="bold" />}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[14px] font-medium text-foreground">
                        {p.kind === "battle_bonus" ? "Battle bonus" : `${formatPoints(p.points)} points redeemed`}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {when(p.createdAt)} · {p.status === "paid" ? "paid to your wallet" : p.status === "failed" ? "failed — nothing was deducted" : "pending"}
                      </span>
                    </span>
                    <span className="shrink-0 text-[14px] font-semibold text-foreground tabular-nums">{money(p.usdMinor)}</span>
                  </div>
                ))}
              </div>
            )
          ) : !points || points.ledger.length === 0 ? (
            <Empty
              className={PANEL}
              icon={<Coins size={26} />}
              title="No points yet"
              body="Watching, playing, winning and streaming all pay points. They are never for sale."
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              {points.ledger.map((l, i) => {
                const r = REASON[l.reason] ?? REASON.adjust!;
                const Icon = r.icon;
                return (
                  <div key={i} className="flex items-center gap-3 rounded-sm px-2.5 py-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground">
                      <Icon size={15} weight="fill" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-foreground/90">{r.label}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{when(l.at)}</span>
                    <span className={cn("w-20 shrink-0 text-right text-[14px] font-semibold tabular-nums", l.delta > 0 ? "text-emerald-300" : "text-foreground/80")}>
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
  );
}

/** One round action on the balance card, with its word underneath. */
function Action({
  icon,
  label,
  href,
  external = false,
  primary = false,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
  external?: boolean;
  primary?: boolean;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "flex size-12 items-center justify-center rounded-full transition-colors",
          primary ? "bg-white text-neutral-950 hover:bg-neutral-100" : "bg-white/[0.1] text-white hover:bg-white/[0.18]"
        )}
      >
        {icon}
      </span>
      <span className="text-[11.5px] font-medium text-white/80">{label}</span>
    </>
  );
  const cls = "flex w-[4.75rem] shrink-0 flex-col items-center gap-1.5 text-center";
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  );
}

/** One summary figure. Becomes a link when there's somewhere to go. */
function Figure({
  label,
  value,
  note,
  icon,
  href,
  className,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] font-semibold tracking-[0.1em] text-muted-foreground/70 uppercase">{label}</span>
        {href && <ArrowUpRight size={12} className="ml-auto text-muted-foreground/50" />}
      </span>
      <span className="mt-2 block text-[22px] font-bold tracking-tight text-foreground tabular-nums">{value}</span>
      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{note}</span>
    </>
  );
  const cls = cn("block rounded-sm bg-white/[0.04] p-4 transition-colors", href && "hover:bg-white/[0.07]", className);
  return href ? (
    <Link href={href} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The history panels keep their own faint tray under the shared empty. */
const PANEL = "rounded-sm bg-white/[0.02] py-12";
