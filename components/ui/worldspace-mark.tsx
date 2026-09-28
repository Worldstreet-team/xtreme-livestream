"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The WorldSpace lockup, as the socials app draws it in its own rail
 * (`components/layout/BrandRitual.tsx`): the cloud mark beside "WorldSpace."
 * in Poppins, with the full stop in the brand cyan.
 *
 * The mark is the CLOUD, not the WorldStreet W — WorldSpace is its own brand
 * and the W belongs to the parent. Xtreme is dark-only, so only the dark cut
 * of the artwork (white glow under the cloud) is used. `unoptimized`: ~13KB
 * drawn at ~40px, and the responsive pipeline once broke the mark upstream.
 */
/** The cloud alone. `follow` swaps in the light cut on a light page. */
export function WorldSpaceMark({ size = 40, follow = false }: { size?: number; follow?: boolean }) {
  const mark = (src: string, extra?: string) => (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      aria-hidden
      priority
      unoptimized
      className={cn("shrink-0 object-contain", extra)}
      style={{ height: size, width: size }}
    />
  );
  if (!follow) return mark("/images/worldspace-mark-dark.png");
  return (
    <>
      {mark("/images/worldspace-mark-dark.png", "[[data-theme=light]_&]:hidden")}
      {mark("/images/worldspace-mark-light.png", "hidden [[data-theme=light]_&]:block")}
    </>
  );
}

export function WorldSpaceLockup({
  size = 40,
  wordSize = 20,
  className,
  follow = false,
}: {
  size?: number;
  wordSize?: number;
  className?: string;
  /** Follow the page's light or dark (the light cut of the mark, ink words) instead of the dark-only cut. */
  follow?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <WorldSpaceMark size={size} follow={follow} />
      <span className={cn("font-poppins font-bold tracking-tight", follow ? "text-current" : "text-[#FAFAF9]")} style={{ fontSize: wordSize }}>
        WorldSpace<i className={cn("not-italic", follow ? "text-[color:var(--pa-accent-ink,#67DCF0)]" : "text-[#67DCF0]")}>.</i>
      </span>
    </span>
  );
}
