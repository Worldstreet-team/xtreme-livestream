"use client";

import Link from "next/link";
import { formatNumber } from "@/lib/categories";
import type { CategorySummary } from "@/lib/discovery";
import { cn } from "@/lib/utils";
import { StreamArt } from "@/components/app/stream-art";
import { twitchArtFor } from "@/lib/twitch-categories";
import { categoryArt } from "@/lib/category-art";

/**
 * A category as portrait box art, and two quiet lines under it: the name,
 * and how many are watching. Nothing on the art — the art is the sign.
 * (TikTok LIVE's category row was the owner's reference, 2026-09-23.) The
 * cover is real box art or a photograph, never a generated chart.
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
        <StreamArt
          src={twitchArtFor(category.category, 480, 640) ?? category.cover ?? categoryArt(category.category, { w: 480, h: 640 })}
          category={category.category}
          alt={category.category}
          size={{ w: 480, h: 640 }}
          imgClassName="transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
      <h3 className="mt-2 text-[14.5px] leading-snug font-bold text-foreground">{category.category}</h3>
      <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground tabular-nums">
        {category.viewers > 0 ? `${formatNumber(category.viewers)} watching` : "Nobody live yet"}
      </p>
    </Link>
  );
}
