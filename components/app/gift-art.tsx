"use client";

import { useState } from "react";
import { giftArtUrl, giftByEmoji } from "@/lib/gifts";
import { cn } from "@/lib/utils";

/**
 * A gift's animated face. Takes either a catalog `art` path or the plain
 * emoji from a chat payload and draws the looping WebP; if the image can't
 * load, or the emoji isn't in the catalog, the emoji itself stands in at
 * the same size so nothing ever renders as a broken square.
 */
export function GiftArt({
  art,
  emoji,
  size = 40,
  className,
}: {
  art?: string;
  emoji?: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const path = art ?? giftByEmoji(emoji)?.art;
  const fallback = emoji ?? "🎁";

  if (!path || failed) {
    return (
      <span className={cn("inline-flex items-center justify-center leading-none", className)} style={{ width: size, height: size, fontSize: size * 0.78 }} aria-hidden>
        {fallback}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote animated WebP; next/image would freeze it
    <img
      src={giftArtUrl(path)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("inline-block shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}
