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
export function WorldSpaceLockup({
  size = 40,
  wordSize = 20,
  className,
}: {
  size?: number;
  wordSize?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/images/worldspace-mark-dark.png"
        alt=""
        width={size}
        height={size}
        aria-hidden
        priority
        unoptimized
        className="shrink-0 object-contain"
        style={{ height: size, width: size }}
      />
      <span className="font-poppins font-bold tracking-tight text-[#FAFAF9]" style={{ fontSize: wordSize }}>
        WorldSpace<i className="not-italic text-[#67DCF0]">.</i>
      </span>
    </span>
  );
}
