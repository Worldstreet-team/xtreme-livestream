"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Coins, Fire } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { formatPoints } from "@/lib/games";
import { cn } from "@/lib/utils";

/**
 * Your points and your watch streak, in the top bar. Reads once (which also
 * pays the welcome grant the first time), then follows `xtreme:points`
 * events from anywhere on the page — a stake, a win, a drop — with a pop.
 * Both open the Rewards page.
 */
export function PointsChip() {
  const [balance, setBalance] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { balance: number; streakDays: number } }>(`/api/user/me/points`)
        .then((r) => {
          if (cancelled) return;
          setBalance(r.data.balance);
          setStreak(r.data.streakDays);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    const onPoints = (e: Event) => {
      const next = (e as CustomEvent<number | undefined>).detail;
      if (typeof next === "number") setBalance(next);
      else void load();
      setPop(true);
      setTimeout(() => setPop(false), 600);
    };
    window.addEventListener("xtreme:points", onPoints);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener("xtreme:points", onPoints);
    };
  }, []);

  if (balance === null) return null;
  return (
    <Link
      href="/rewards"
      title="Your points and watch streak — redeem points on the Rewards page"
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-full bg-[#26262D] px-3 text-sm font-semibold text-foreground tabular-nums transition-[transform,background-color] hover:bg-[#31313A]",
        pop && "scale-110"
      )}
    >
      <span className="flex items-center gap-1.5">
        <Coins size={15} weight="fill" className="text-amber-300" />
        {formatPoints(balance)}
      </span>
      <span className="h-4 w-px bg-white/[0.12]" aria-hidden />
      <span className="flex items-center gap-1 text-[13px]" title={`${streak}-day watch streak`}>
        <Fire size={14} weight="fill" className={streak > 0 ? "text-orange-400" : "text-muted-foreground/50"} />
        {streak}d
      </span>
    </Link>
  );
}
