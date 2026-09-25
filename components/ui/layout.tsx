import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const gaps = { 1: "gap-1", 2: "gap-2", 3: "gap-3", 4: "gap-4", 6: "gap-6", 8: "gap-8", 12: "gap-12" };
type LayoutProps = ComponentProps<"div"> & { gap?: keyof typeof gaps };

/** Vertical rhythm: label→field 8, related controls 16, groups 24, sections 32/48. */
export function Stack({ gap = 4, className, ...props }: LayoutProps) {
  return <div className={cn("flex min-w-0 flex-col", gaps[gap], className)} {...props} />;
}

/** Wrapping rows never rely on fixed widths to fit mobile. */
export function Cluster({ gap = 3, className, ...props }: LayoutProps) {
  return <div className={cn("flex flex-wrap items-center", gaps[gap], className)} {...props} />;
}

export function Surface({ level = "base", className, ...props }: ComponentProps<"div"> & { level?: "base" | "raised" | "floating" }) {
  return <div className={cn("rounded-panel p-4 sm:p-6", { base: "bg-card", raised: "bg-surface-raised", floating: "bg-surface-raised shadow-floating" }[level], className)} {...props} />;
}

export function SectionHeader({ id, eyebrow, title, description, action }: { id?: string; eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4">
    <Stack gap={2}>
      {eyebrow && <p className="text-caption font-medium uppercase tracking-widest text-warning">{eyebrow}</p>}
      <h2 id={id} className="ds-display text-title font-bold">{title}</h2>
      {description && <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </Stack>
    {action}
  </div>;
}
