import { cn } from "@/lib/utils";

/**
 * The WorldStreet W, drawing itself on the same 5.2s track it runs in the
 * socials app's rail and bottom bar (`components/layout/BrandRitual.tsx`
 * there; the `.ws-brand-mark` rules live in globals.css). Same polygon
 * geometry, so the two apps wear literally the same mark. It fills with
 * the app's brand token, which here is Xtream red.
 */
export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={cn("ws-brand-mark", className)}
      style={{ width: size, height: size * 0.72 }}
      viewBox="0 0 435.32 245.73"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <polygon pathLength={1} points="0,0 159.68,0 217.66,102.5 139.01,245.73" />
      <polygon pathLength={1} points="435.32,0 275.64,0 217.66,102.5 296.32,245.73" />
    </svg>
  );
}

/** The W beside the wordmark. */
export function BrandLockup({ size = 22, wordSize = 20, className }: { size?: number; wordSize?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark size={size} />
      <span className="font-bold tracking-tight text-foreground" style={{ fontSize: wordSize }}>
        Xtream
      </span>
    </span>
  );
}
