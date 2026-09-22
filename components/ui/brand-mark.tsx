import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Xtream's mark: the chili on fire.
 *
 * Owner's pick, 2026-09-22 — it replaced the WorldStreet W that this app
 * had shared with the socials rail. The art is a raster cut from an iStock
 * illustration; see public/images/xtream-logo.png and the licence note in
 * the memory file before this ships anywhere public.
 *
 * `size` is the mark's height; it is wider than it is tall (289×220).
 */
const RATIO = 289 / 220;

export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/images/xtream-logo.png"
      alt=""
      aria-hidden
      width={Math.round(size * RATIO)}
      height={size}
      priority
      className={cn("inline-block shrink-0 select-none", className)}
      style={{ width: Math.round(size * RATIO), height: size }}
    />
  );
}

/** The chili beside the wordmark. */
export function BrandLockup({ size = 22, wordSize = 20, className }: { size?: number; wordSize?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={size} />
      <span className="font-bold tracking-tight text-foreground" style={{ fontSize: wordSize }}>
        Xtream
      </span>
    </span>
  );
}
