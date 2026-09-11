"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sword, Play } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import type { BattleView } from "@/lib/battles";
import { LiveBadge } from "@/components/ui/badge";
import { PillLink } from "@/components/ui/pill";
import { UserAvatar } from "@/components/ui/user-avatar";
import { WolfIcon } from "@/components/ui/wolf-icon";

/**
 * One banner under the chips — the wide, low card Kick runs between its
 * player and its category rail: a tag, a title, a line of copy, artwork
 * bleeding in from the right, one call to action. Not a carousel: it shows
 * the one thing most worth a banner right now — a battle in progress if
 * there is one, otherwise the Wolf of WorldStreet race.
 */
export function HomeBanners() {
  const [battle, setBattle] = useState<BattleView | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { battles: BattleView[] } }>(`/api/battles/live`)
        .then((r) => !cancelled && setBattle(r.data.battles[0] ?? null))
        .catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (battle) {
    return (
      <section aria-label="Featured" className="relative mb-8 overflow-hidden rounded-sm bg-[#1a0b0b]">
        <div className="relative grid min-h-[150px] md:grid-cols-[minmax(0,1fr)_minmax(0,46%)]">
          <div className="relative z-10 flex flex-col justify-center gap-2 p-5 md:p-7">
            <div><LiveBadge size="sm">{" · Battle"}</LiveBadge></div>
            <h2 className="line-clamp-1 text-xl font-bold tracking-tight text-foreground md:text-2xl">
              {battle.host.displayName} vs {battle.challenger.displayName}
            </h2>
            <p className="line-clamp-2 max-w-[60ch] text-[13.5px] leading-relaxed text-muted-foreground">
              Two creators, one clock, and the audience decides with gifts. The last thirty seconds count double.
            </p>
          </div>
          <div className="relative hidden items-center justify-end gap-3 pr-44 md:flex">
            <UserAvatar src={battle.host.avatar} name={battle.host.displayName} size={72} className="size-[72px] ring-4 ring-red-500" />
            <Sword size={28} weight="fill" className="text-white/60" />
            <UserAvatar src={battle.challenger.avatar} name={battle.challenger.displayName} size={72} className="size-[72px] ring-4 ring-sky-400" />
          </div>
          <div className="absolute top-1/2 right-5 z-20 -translate-y-1/2 md:right-7">
            <PillLink href={`/stream/${battle.host.streamId}`} size="md" variant="primary" icon={<Play size={14} weight="fill" />}>
              Watch the battle
            </PillLink>
          </div>
        </div>
        <Link href={`/stream/${battle.host.streamId}`} className="absolute inset-0 z-0" aria-hidden tabIndex={-1} />
      </section>
    );
  }

  return (
    <section aria-label="Featured" className="relative mb-8 overflow-hidden rounded-sm bg-[#14100a]">
      <div className="relative grid min-h-[150px] md:grid-cols-[minmax(0,1fr)_minmax(0,46%)]">
        <div className="relative z-10 flex flex-col justify-center gap-2 p-5 md:p-7">
          <span className="flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-amber-300 uppercase">
            <WolfIcon size={14} />
            Competition
          </span>
          <h2 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Wolf of WorldStreet</h2>
          <p className="line-clamp-2 max-w-[60ch] text-[13.5px] leading-relaxed text-muted-foreground">
            The most-backed creator each week wears the pelt. Gifts, follows and battle wins all count toward the race.
          </p>
        </div>
        <div className="relative hidden md:block">
          <video src="/promo/live-phones.mp4" muted loop playsInline autoPlay preload="metadata" aria-hidden className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#14100a] via-[#14100a]/85 to-transparent" />
        </div>
        <div className="absolute top-1/2 right-5 z-20 -translate-y-1/2 md:right-7">
          <PillLink href="https://social.worldstreetgold.com/votes" external size="md" variant="primary">
            Enter the pack
          </PillLink>
        </div>
      </div>
      <a href="https://social.worldstreetgold.com/votes" target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-0" aria-hidden tabIndex={-1} />
    </section>
  );
}
