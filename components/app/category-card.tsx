"use client";

import Link from "next/link";
import { formatNumber } from "@/lib/categories";
import type { CategorySummary } from "@/lib/discovery";
import { cn } from "@/lib/utils";
import { StreamArt } from "@/components/app/stream-art";

/**
 * A category as portrait box art, and two quiet lines under it: the name,
 * and how many are watching. Nothing on the art — the art is the sign.
 * (TikTok LIVE's category row was the owner's reference, 2026-09-23.) The
 * cover is the category's own poster (lib/cover-art) — the same art in every
 * grid, whether or not anyone is live — never a stretched live thumbnail.
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
          src={null}
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
