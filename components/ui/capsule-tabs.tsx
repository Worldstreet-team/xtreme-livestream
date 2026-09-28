"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tip";

export interface CapsuleTab<T extends string> {
  id: T;
  label: string;
  icon?: Icon;
  /** A count worth interrupting for (stage requests) — a Chili badge on the icon. */
  badge?: number | null;
  /** A walkthrough target name (`data-tour`), for tours that point at this tab. */
  tour?: string;
}

/**
 * Tabs as a capsule. The owner turned down underlined tabs in the studio
 * ("i don't like the tab style… go through dribble", 2026-09-24); this is
 * the expanding tab bar that keeps turning up there — a dark track, and the
 * tab that's on is a white pill.
 *
 * With icons, the tabs that are off are just their icon and the one that's
 * on grows to say its name, so six destinations (seven, a little tighter)
 * fit a phone drawer without scrolling and the choice reads at a glance.
 * Without icons it's a segmented control: every label shows and a white
 * thumb slides between them. `onDark` lays the track as a glass object for
 * use over video, and keeps it dark in the light theme (stays dark: video).
 */
export function CapsuleTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  onDark = false,
  className,
}: {
  items: CapsuleTab<T>[];
  /** null when none of these is on (the panel was opened some other way). */
  value: T | null;
  onChange: (id: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  onDark?: boolean;
  className?: string;
}) {
  const expanding = items.every((i) => i.icon);
  // Seven destinations (the studio, with Requests): the one that's on takes
  // a larger share, so it still says its name across a phone drawer.
  const crowded = items.length > 6;
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Segmented: the thumb is measured off the tab that's on, and follows it
  // if the track changes size.
  useLayoutEffect(() => {
    if (expanding) return;
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = track.querySelector<HTMLElement>('[aria-selected="true"]');
      setThumb(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [expanding, value, items.length]);

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={label}
      data-theme={onDark ? "dark" : undefined}
      className={cn("relative flex items-center gap-1 rounded-full p-1", onDark ? "obj" : "bg-tint/[0.06]", className)}
    >
      {!expanding && thumb && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-full bg-inverse transition-[left,width] duration-300 [transition-timing-function:var(--ease-spring)] motion-reduce:transition-none"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {items.map((t) => {
        const on = t.id === value;
        const TabIcon = t.icon;
        return (
          <Tip key={t.id} label={t.label} disabled={!expanding || on}>
          <button
            type="button"
            role="tab"
            data-tour={t.tour}
            aria-selected={on}
            aria-label={expanding ? t.label : undefined}
            onClick={() => onChange(t.id)}
            className={cn(
              "press relative z-10 flex h-9 min-w-0 items-center justify-center rounded-full text-[13.5px] font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ember",
              expanding
                ? cn(
                    "transition-[flex-grow,background-color,color,box-shadow] duration-300 [transition-timing-function:var(--ease-spring)] motion-reduce:transition-none",
                    on
                      ? cn("gap-2 bg-inverse text-on-inverse", crowded ? "flex-[3.4] px-3" : "flex-[2.6] px-3.5")
                      : "flex-1 text-muted-foreground hover:bg-tint/[0.07] hover:text-foreground",
                  )
                : cn("flex-1 px-4 transition-colors duration-200", on ? "text-on-inverse" : "text-muted-foreground hover:text-foreground"),
            )}
          >
            {TabIcon && <TabIcon size={17} weight={on ? "fill" : "regular"} className="shrink-0" />}
            {expanding ? (
              <span className={cn("overflow-hidden transition-[max-width,opacity] duration-300", on ? "max-w-[7rem] opacity-100" : "max-w-0 opacity-0")}>{t.label}</span>
            ) : (
              t.label
            )}
            {t.badge ? (
              // Over the icon while it's off; on the open pill, its corner — clear of the name.
              <span
                className={cn(
                  "absolute top-0 min-w-[17px] rounded-full bg-chili px-1 text-center text-[10px] leading-[17px] font-bold text-white tabular-nums ring-2 ring-surface",
                  on && expanding ? "-top-1 right-0" : "left-1/2 ml-1.5",
                )}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
          </Tip>
        );
      })}
    </div>
  );
}
