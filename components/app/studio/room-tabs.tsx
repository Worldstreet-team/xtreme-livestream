"use client";

import { useEffect, useRef, useState } from "react";
import type { Icon } from "@/components/icons";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

export interface RoomTab<T extends string> {
  id: T;
  /** The word under the icon: short, the tool's real name. */
  label: string;
  icon: Icon;
  /** What it's for, in a few words — the tooltip. */
  tip: string;
  /** A count worth interrupting for (people asking to join) — a Chili badge on the icon. */
  badge?: number | null;
  /** A walkthrough target name (`data-tour`). */
  tour?: string;
}

/**
 * The live studio's tools, each with its name under its icon. The icon-only
 * capsule read as a row of mystery buttons (Greg's practice run,
 * 2026-09-28: he drew an arrow at them and asked what they were). The one
 * that's open is a white pill, as before; when the row is wider than the
 * sheet it scrolls sideways, with an edge that fades to say so, and the open
 * tab scrolls itself into view.
 */
export function RoomTabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: RoomTab<T>[];
  /** null when none is open (the chat is on screen and the sheet is compact). */
  value: T | null;
  onChange: (id: T) => void;
  /** Accessible name for the tab list. */
  label: string;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  /** Which edges have more tabs past them. */
  const [more, setMore] = useState({ left: false, right: false });

  const measure = () => {
    const t = trackRef.current;
    if (!t) return;
    const left = t.scrollLeft > 2;
    const right = t.scrollLeft + t.clientWidth < t.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };

  useEffect(() => {
    const t = trackRef.current;
    if (!t) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(t);
    return () => ro.disconnect();
  }, []);

  // The open tab stays in view when it changes from elsewhere (a chip, the coach, Vivid).
  useEffect(() => {
    const t = trackRef.current;
    const el = t?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!t || !el) return;
    const pad = 24;
    if (el.offsetLeft - pad < t.scrollLeft) t.scrollTo({ left: el.offsetLeft - pad, behavior: "smooth" });
    else if (el.offsetLeft + el.offsetWidth + pad > t.scrollLeft + t.clientWidth)
      t.scrollTo({ left: el.offsetLeft + el.offsetWidth + pad - t.clientWidth, behavior: "smooth" });
  }, [value]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = [...(trackRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]?.focus();
  };

  return (
    <div className={cn("relative rounded-[18px] bg-tint/[0.06]", className)}>
      <div
        ref={trackRef}
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        onScroll={measure}
        className={cn(
          "flex items-stretch gap-0.5 overflow-x-auto overscroll-x-contain p-1 scrollbar-none",
          // The edge with more past it fades out, so the row reads as one you can slide.
          more.right && more.left
            ? "[mask-image:linear-gradient(to_right,transparent,black_2rem,black_calc(100%-2rem),transparent)]"
            : more.right
              ? "[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]"
              : more.left && "[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]",
        )}
      >
        {items.map((t) => {
          const on = t.id === value;
          const TabIcon = t.icon;
          return (
            <Tip key={t.id} label={t.tip}>
              <button
                type="button"
                role="tab"
                data-tour={t.tour}
                aria-selected={on}
                tabIndex={on || (value === null && t === items[0]) ? 0 : -1}
                onClick={() => onChange(t.id)}
                className={cn(
                  "press relative flex h-[52px] min-w-[2.75rem] flex-1 shrink-0 flex-col items-center justify-center gap-[3px] rounded-[14px] px-1 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ember",
                  "transition-colors duration-200",
                  on ? "bg-inverse text-on-inverse" : "text-muted-foreground hover:bg-tint/[0.07] hover:text-foreground",
                )}
              >
                <TabIcon size={19} weight={on ? "fill" : "regular"} className="shrink-0" />
                <span className="text-[11px] leading-none font-semibold">{t.label}</span>
                {t.badge ? (
                  <span className="absolute top-1 left-1/2 ml-1.5 min-w-[17px] rounded-full bg-chili px-1 text-center text-[10px] leading-[17px] font-bold text-white tabular-nums ring-2 ring-surface">
                    {t.badge}
                  </span>
                ) : null}
              </button>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}
