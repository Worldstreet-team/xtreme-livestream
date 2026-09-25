"use client";

import Link from "next/link";
import { formatNumber } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";

export interface RingItem {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  href: string;
  viewers?: number | null;
}

/**
 * A strip of channel avatars; a heat ring means live now (rings are one of
 * the gradient's three homes in Afterglow). The cheapest dense
 * live surface there is — twelve channels in one row — and the shape every
 * platform converged on for "your people, right now". Live channels sort
 * first because that's the question the row answers.
 */
export function AvatarRingsRow({
  items,
  size = 56,
  className,
}: {
  items: RingItem[];
  size?: number;
  className?: string;
}) {
  const sorted = [...items].sort((a, b) => Number(b.isLive) - Number(a.isLive));
  return (
    <div className={cn("flex gap-4 overflow-x-auto pb-1 scrollbar-none", className)}>
      {sorted.map((c) => {
        const name = c.displayName || c.username;
        return (
          <Link
            key={c.id}
            href={c.href}
            className="group flex w-[72px] shrink-0 flex-col items-center gap-1.5 text-center"
          >
            <span
              className={cn(
                "relative rounded-full p-[2.5px] transition-transform group-hover:scale-105",
                c.isLive
                  ? "bg-heat shadow-[0_0_18px_-4px_rgba(248,88,16,0.7)]"
                  : "bg-white/[0.08]"
              )}
            >
              <span className="block rounded-full bg-background p-[2px]">
                <UserAvatar src={c.avatar} name={name} size={size - 9} />
              </span>
              {c.isLive && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-chili px-1.5 py-px text-[0.55rem] font-bold tracking-wide text-white shadow-[0_0_0_2px_var(--background)]">
                  LIVE
                </span>
              )}
            </span>
            <span className="w-full truncate text-[0.7rem] leading-tight text-foreground/85">
              {name}
            </span>
            {c.isLive && c.viewers != null && (
              <span className="-mt-1 text-[0.62rem] text-muted-foreground tabular-nums">
                {formatNumber(c.viewers)}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
