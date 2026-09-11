"use client";

import Link from "next/link";
import { Eye, Broadcast } from "@phosphor-icons/react";
import { formatNumber } from "@/lib/categories";
import type { CategorySummary } from "@/lib/discovery";
import { cn } from "@/lib/utils";
import { StreamArt } from "@/components/app/stream-art";
import { twitchArtFor } from "@/lib/twitch-categories";
import { Badge, LiveBadge } from "@/components/ui/badge";

/**
 * A category as portrait box art. The cover is the busiest live stream's
 * thumbnail when someone is on, and a real photograph for the category
 * when nobody is — never a generated chart. Ranked by audience, not by how
 * many streams, so the card's viewer count is the number that ordered it.
 */
export function CategoryCard({
  category,
  className,
}: {
  category: CategorySummary;
  className?: string;
}) {
  const href = `/browse?category=${encodeURIComponent(category.category)}`;
  return (
    <Link href={href} className={cn("group block", className)}>
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-white/[0.03]">
        {/* Box art first — a category is recognised by its art, not by
            whoever happens to be the busiest stream in it right now. */}
        <StreamArt
          src={twitchArtFor(category.category, 480, 640) ?? category.cover}
          category={category.category}
          alt={category.category}
          size={{ w: 480, h: 640 }}
          imgClassName="transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
        {category.live > 0 && <LiveBadge className="absolute top-2.5 left-2.5">{` · ${category.live}`}</LiveBadge>}
        <Badge variant="glass" icon={<Eye size={12} weight="bold" />} className="absolute right-2.5 bottom-2.5">
          {formatNumber(category.viewers)}
        </Badge>
      </div>
      <h3 className="mt-2 truncate text-[15px] font-semibold text-foreground transition-colors group-hover:text-primary">
        {category.category}
      </h3>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70 tabular-nums">
        <Broadcast size={11} weight="fill" className={category.live > 0 ? "text-red-500" : "text-muted-foreground/40"} />
        {category.live > 0 ? `${category.live} live now` : "Nobody live yet"}
      </p>
    </Link>
  );
}
