import { cn } from "@/lib/utils";

/**
 * "via WorldSpace": where a message or a call came from when it wasn't
 * Xtream — the mirror of WorldSpace's "via Xstream", in the same place (the
 * bubble's top line). WorldSpace wears its cloud mark so the word isn't the
 * only cue. Ink follows the surface it sits on.
 */
export function ViaTag({
  label,
  tone = "muted",
  className,
}: {
  label: string;
  tone?: "muted" | "on-ember" | "on-dark";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11.5px] leading-4 font-medium",
        tone === "on-ember" ? "text-on-ember/70" : tone === "on-dark" ? "text-muted-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {label.endsWith("WorldSpace") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/images/worldspace-mark-dark.png" alt="" aria-hidden className="size-3.5 shrink-0 object-contain" />
      )}
      {label}
    </span>
  );
}
