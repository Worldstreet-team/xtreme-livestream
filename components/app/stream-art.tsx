"use client";

import { useState } from "react";
import { apiUrl } from "@/lib/api-client";
import { categoryArt } from "@/lib/category-art";
import { cn } from "@/lib/utils";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";

/**
 * The picture for a stream, category or channel surface — always a real
 * photograph if one can be had.
 *
 * Order of preference: the stream's own thumbnail, then a real photo for
 * its category, then (only if the network has failed twice) the generated
 * chart. The chart used to be the first fallback, which is why a grid with
 * a few missing thumbnails read as a wall of synthetic candlesticks.
 */
export function StreamArt({
  src,
  category,
  alt,
  seed,
  className,
  imgClassName,
  size,
  lazy = false,
}: {
  /** API-relative or absolute thumbnail URL; null/empty when the stream has none. */
  src?: string | null;
  category: string;
  alt: string;
  /** Deterministic seed for the last-resort chart. */
  seed?: string;
  className?: string;
  imgClassName?: string;
  /** Requested art size for the category fallback. */
  size?: { w: number; h: number };
  /**
   * Defer loading until near the viewport. Only for long grids and shelves:
   * anything above the fold loads eagerly, because a lazy image in a tab the
   * browser considers hidden can sit unloaded — a black tile — until the
   * page is scrolled.
   */
  lazy?: boolean;
}) {
  const primary = src ? apiUrl(src) : "";
  const fallback = categoryArt(category, size);
  // Which source we're on: 0 = own thumbnail, 1 = category photo, 2 = chart.
  // Reset when the thumbnail arrives late (a tile that mounted before its
  // category loaded should switch to the live cover, not stay on the photo).
  const [stage, setStage] = useState(primary ? 0 : 1);
  const [seen, setSeen] = useState(primary);
  if (seen !== primary) {
    setSeen(primary);
    setStage(primary ? 0 : 1);
  }
  const current = stage === 0 ? primary : stage === 1 ? fallback : "";

  return (
    <div className={cn("absolute inset-0 overflow-hidden", className)}>
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={current}
          src={current}
          alt={alt}
          loading={lazy ? "lazy" : "eager"}
          onError={() => setStage((s) => s + 1)}
          className={cn("absolute inset-0 size-full object-cover", imgClassName)}
        />
      ) : (
        <StreamPreviewThumb seed={seed ?? alt} />
      )}
    </div>
  );
}
