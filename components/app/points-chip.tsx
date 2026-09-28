"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Coins, Fire } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { formatPoints } from "@/lib/games";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tip";

/**
 * Your points and your watch streak, in the top bar. Reads once (which also
 * pays the welcome grant the first time), then follows `xtreme:points`
 * events from anywhere on the page — a stake, a win, a drop — with a pop.
 * Both open the Rewards page. An ember dot means a quest is finished and
 * waiting to be claimed there.
 */
export function PointsChip() {
  const [balance, setBalance] = useState<number | null>(null);
  const [streak, setStreak] = useState(0);
  const [ready, setReady] = useState(0);
  const [pop, setPop] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { balance: number; streakDays: number; questsReady?: number } }>(`/api/user/me/points`)
        .then((r) => {
          if (cancelled) return;
          setBalance(r.data.balance);
          setStreak(r.data.streakDays);
          setReady(r.data.questsReady ?? 0);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    let recount: ReturnType<typeof setTimeout> | undefined;
    const onPoints = (e: Event) => {
      const next = (e as CustomEvent<number | undefined>).detail;
      if (typeof next === "number") setBalance(next);
      // Quests move with points — a claim, a win — so recount shortly after.
      clearTimeout(recount);
      recount = setTimeout(() => void load(), typeof next === "number" ? 1500 : 0);
      setPop(true);
      setTimeout(() => setPop(false), 600);
    };
    window.addEventListener("xtreme:points", onPoints);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearTimeout(recount);
      window.removeEventListener("xtreme:points", onPoints);
    };
  }, []);

  if (balance === null) return null;
  const quests = `${ready} ${ready === 1 ? "quest" : "quests"} ready to claim`;
  return (
    <Tip side="bottom" label={ready > 0 ? `${quests} on Rewards` : `Your points · ${streak}-day watch streak`}>
    <Link
      href="/rewards"
      data-tour="points"
      aria-label={`Rewards: ${formatPoints(balance)} points, ${streak}-day watch streak${ready > 0 ? `, ${quests}` : ""}`}
      className={cn(
        "press relative flex h-10 items-center gap-2.5 rounded-full bg-control px-3.5 text-[13.5px] font-semibold text-foreground tabular-nums transition-[transform,background-color] hover:bg-control-hover",
        pop && "scale-110"
      )}
    >
      <span className="flex items-center gap-1.5">
        <Coins size={16} weight="fill" className="text-ember-hi" />
        {formatPoints(balance)}
      </span>
      <span className="h-4 w-px bg-tint/[0.12]" aria-hidden />
      <span className="flex items-center gap-1 text-[13px]">
        <Fire size={15} weight="fill" className={streak > 0 ? "text-chili-hi" : "text-muted-foreground/50"} />
        {streak}d
      </span>
      {ready > 0 && (
        <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-ember ring-2 ring-background">
          <span className="sr-only">
            {ready} {ready === 1 ? "quest" : "quests"} ready to claim
          </span>
        </span>
      )}
    </Link>
    </Tip>
  );
}
