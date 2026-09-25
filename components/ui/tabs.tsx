"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Plain tabs (owner, 2026-09-23): words on a hairline, no pills, no track.
 * The tab you're on is bright and bold with a short Ember bar under it —
 * the same "you are here" as the rail's dot; the rest sit faint. Counts
 * ride along as small numbers. One component for every tab strip in the
 * app, so they all move together. (The name stays PillTabs for callers.)
 */

export interface PillTab<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ComponentType<{ size?: number; weight?: "regular" | "fill" | "bold" | "duotone" }>;
  count?: number | null;
}

export function PillTabs<T extends string>({
  items,
  value,
  onChange,
  size = "md",
  label,
  className,
}: {
  items: PillTab<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  /** Accessible name for the tab list. */
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full gap-6 overflow-x-auto shadow-[inset_0_-1px_0_rgba(255,236,230,0.08)] scrollbar-none",
        className
      )}
    >
      {items.map((t) => {
        const active = t.id === value;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "relative flex shrink-0 items-center whitespace-nowrap transition-colors duration-200 outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ember",
              // Phones drop the glyphs, so three tabs fit a 375px screen.
              size === "sm" ? "h-9 gap-1.5 text-[13px]" : "h-10 gap-2 text-[14px] md:text-[15px]",
              active ? "font-bold text-foreground" : "font-medium text-foreground/50 hover:text-foreground/85"
            )}
          >
            {active && (
              <span aria-hidden className="absolute inset-x-0 -bottom-px mx-auto h-[2px] w-5 rounded-full bg-ember motion-safe:animate-[xt-pop_.3s_var(--ease-spring)_both]" />
            )}
            {Icon && (
              <span className="hidden md:inline-flex">
                <Icon size={size === "sm" ? 14 : 16} weight={active ? "fill" : "regular"} />
              </span>
            )}
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "text-[0.75rem] font-semibold tabular-nums",
                  active ? "text-ember-hi" : "text-muted-foreground/70"
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
