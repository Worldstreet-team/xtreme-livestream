"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { isBattleActive, type BattleView } from "@/lib/battles";
import { MOTION_VARS } from "@/lib/motion";
import { useNow } from "@/lib/use-now";
import { Shelf } from "@/components/app/shelf";
import { BattleCard } from "@/components/app/battles/battle-card";
import { ClashView } from "@/components/app/battles/clash-view";

/**
 * Battles on Home: the ones running now first, then the ones booked, as a
 * sliding row of battle cards (./battles/battle-card.tsx). Tapping a card
 * opens the clash view (./battles/clash-view.tsx) — a window unfolding out
 * of the card on a computer, a sheet on a phone — where the battle plays
 * out live: gifts flying in, the meter yanked, lead changes called.
 */
export function BattlesRow() {
  const [live, setLive] = useState<BattleView[]>([]);
  const [upcoming, setUpcoming] = useState<BattleView[]>([]);
  const [open, setOpen] = useState<{ battle: BattleView; from: DOMRect } | null>(null);
  const [shown, setShown] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  // Live clocks tick every second; a booked one counts down too, when it's under a day out.
  const now = useNow(live.length + upcoming.length > 0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [l, u] = await Promise.all([
        apiFetch<{ success: boolean; data: { battles: BattleView[] } }>(`/api/battles/live`).then((r) => r.data.battles).catch(() => []),
        apiFetch<{ success: boolean; data: { battles: BattleView[] } }>(`/api/battles/upcoming`).then((r) => r.data.battles).catch(() => []),
      ]);
      if (cancelled) return;
      setLive(l.filter(isBattleActive));
      setUpcoming(u);
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const items = [...live, ...upcoming];
  if (items.length === 0 && !open) return null;

  return (
    <div style={MOTION_VARS}>
      <Shelf id="battles" title="Battles" size="standard" peek>
        {items.map((b, i) => (
          <BattleCard
            key={b.id}
            battle={b}
            now={now}
            index={i}
            onOpen={(battle, el) => {
              trigger.current = el;
              setOpen({ battle, from: el.getBoundingClientRect() });
              setShown(true);
            }}
          />
        ))}
      </Shelf>
      <ClashView
        battle={open?.battle ?? null}
        from={open?.from ?? null}
        open={shown}
        triggerRef={trigger}
        onClose={() => setShown(false)}
        onGone={() => setOpen(null)}
      />
    </div>
  );
}
