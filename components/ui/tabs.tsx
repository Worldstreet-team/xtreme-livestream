"use client";

import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Tabs as a row of pills in a frosted track — the active one lifted, the
 * rest quiet. Counts ride along as tiny pills of their own. One component
 * for every tab strip in the app, so they all move together.
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
        // Clean: a background tone for the track, a lighter one for the
        // active pill, and nothing drawn as an edge.
        "inline-flex max-w-full gap-1 overflow-x-auto rounded-full bg-white/[0.05] p-1 scrollbar-none",
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
              "flex shrink-0 items-center whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-white/40",
              size === "sm" ? "h-8 gap-1.5 px-3.5 text-[13px]" : "h-9 gap-2 px-4 text-sm",
              active
                ? "bg-white/[0.12] text-foreground"
                : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
            )}
          >
            {Icon && <Icon size={size === "sm" ? 14 : 16} weight={active ? "fill" : "regular"} />}
            {t.label}
            {t.count ? (
              <span
                className={cn(
                  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[0.65rem] font-semibold tabular-nums",
                  active ? "bg-white/[0.14] text-foreground" : "bg-white/[0.07] text-muted-foreground"
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
