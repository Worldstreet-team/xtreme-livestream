"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { CaretLeft, CaretRight } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * A real calendar and a real clock, for booking streams (owner, 2026-09-24:
 * "make the date proper and the time … I don't want users to be constrained
 * by the dates we give them"). Any day from `min` to `max`, a month at a
 * time; any quarter hour of that day. Both are plain buttons in a grid —
 * arrow keys move the calendar's day, Tab moves between the two.
 */

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Monday first: how the week reads in Lagos, London and most of the world. */
const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
  // 2024-01-01 was a Monday.
  new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: "narrow" }),
);

export function CalendarMonth({
  value,
  onChange,
  min,
  max,
  marked,
  className,
}: {
  value: Date;
  onChange: (day: Date) => void;
  /** First selectable day (its time is ignored). */
  min: Date;
  /** Last selectable day. */
  max: Date;
  /** Days to mark with a dot — your other bookings. Keys from `dayKey`. */
  marked?: Set<string>;
  className?: string;
}) {
  const [view, setView] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
  const today = startOfDay(new Date());
  const lo = startOfDay(min);
  const hi = startOfDay(max);
  const gridRef = useRef<HTMLDivElement>(null);

  // A day picked off-screen (keyboard past the month's edge) brings its month with it.
  // Compared by time, so a parent handing in an equal new Date doesn't yank the view back.
  const shown = value.getFullYear() === view.getFullYear() && value.getMonth() === view.getMonth();
  const [lastValue, setLastValue] = useState(value.getTime());
  if (lastValue !== value.getTime()) {
    setLastValue(value.getTime());
    if (!shown) setView(new Date(value.getFullYear(), value.getMonth(), 1));
  }

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => new Date(view.getFullYear(), view.getMonth(), i + 1))];
  }, [view]);

  const canBack = new Date(view.getFullYear(), view.getMonth(), 0) >= lo;
  const canForward = new Date(view.getFullYear(), view.getMonth() + 1, 1) <= hi;
  const pick = (d: Date) => {
    if (d < lo || d > hi) return;
    onChange(d);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (move === undefined) return;
    e.preventDefault();
    const next = addDays(startOfDay(value), move);
    if (next < lo || next > hi) return;
    onChange(next);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLButtonElement>("[aria-selected=true]")?.focus());
  };

  return (
    <div className={cn("select-none", className)}>
      <div className="flex items-center justify-between">
        <p className="font-wide text-[16px] font-bold tracking-[-0.02em]" aria-live="polite">
          {view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <div className="flex gap-1">
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              disabled={dir === -1 ? !canBack : !canForward}
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + dir, 1))}
              aria-label={dir === -1 ? "Previous month" : "Next month"}
              className="press flex size-8 items-center justify-center rounded-full bg-control text-foreground transition-colors hover:bg-control-hover disabled:pointer-events-none disabled:opacity-25"
            >
              {dir === -1 ? <CaretLeft size={14} weight="bold" /> : <CaretRight size={14} weight="bold" />}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-semibold text-muted-foreground/70">
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1.5">
            {w}
          </span>
        ))}
      </div>
      <div ref={gridRef} role="grid" aria-label="Pick a day" onKeyDown={onKey} className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} aria-hidden />;
          const off = d < lo || d > hi;
          const on = d.getTime() === startOfDay(value).getTime();
          const isToday = d.getTime() === today.getTime();
          const dot = marked?.has(dayKey(d));
          return (
            <button
              key={d.toISOString()}
              type="button"
              role="gridcell"
              aria-selected={on}
              aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
              tabIndex={on ? 0 : -1}
              disabled={off}
              onClick={() => pick(d)}
              className={cn(
                "press relative flex h-10 flex-col items-center justify-center rounded-[10px] font-money text-[15px] tabular-nums transition-colors disabled:pointer-events-none",
                on ? "bg-white text-[#0b0708]" : off ? "text-foreground/20" : "text-foreground hover:bg-white/[0.07]",
                isToday && !on && "text-ember-hi",
              )}
            >
              {d.getDate()}
              {(dot || isToday) && (
                <span className={cn("absolute bottom-1.5 size-1 rounded-full", on ? "bg-[#0b0708]/60" : dot ? "bg-ember" : "bg-ember-hi/70")} aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const PARTS = [
  { from: 0, label: "Late night" },
  { from: 6, label: "Morning" },
  { from: 12, label: "Afternoon" },
  { from: 17, label: "Evening" },
] as const;

export function TimeList({
  day,
  value,
  onChange,
  earliest,
  step = 15,
  className,
}: {
  day: Date;
  /** "HH:MM", 24-hour. */
  value: string;
  onChange: (hhmm: string) => void;
  /** Nothing before this moment can be picked. */
  earliest: number;
  step?: number;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const dayMs = startOfDay(day).getTime();
  const slots = useMemo(() => {
    const d = new Date(dayMs);
    return Array.from({ length: (24 * 60) / step }, (_, i) => {
      const m = i * step;
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60);
      return { hhmm, at, hour: Math.floor(m / 60) };
    });
  }, [dayMs, step]);

  // Keep the chosen time in view — and on a fresh day, start near it, not at midnight.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-slot="${value}"]`);
    if (el && list) list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2, behavior: "instant" as ScrollBehavior });
  }, [value, dayMs]);

  return (
    <div ref={listRef} role="listbox" aria-label="Pick a time" className={cn("relative overflow-y-auto overscroll-contain pr-1 scrollbar-thin scrollbar-thumb-white/10", className)}>
      {slots.map((s) => {
        const part = PARTS.find((p) => p.from === s.hour && s.hhmm.endsWith(":00"));
        const gone = s.at.getTime() < earliest;
        const on = s.hhmm === value;
        return (
          <div key={s.hhmm}>
            {part && <p className="sticky top-0 z-10 bg-surface pt-3 pb-1.5 text-[11px] font-semibold text-muted-foreground/70 first:pt-0">{part.label}</p>}
            <button
              type="button"
              role="option"
              aria-selected={on}
              data-slot={s.hhmm}
              disabled={gone}
              onClick={() => onChange(s.hhmm)}
              className={cn(
                "press mb-1 flex h-10 w-full items-center justify-center rounded-[10px] font-mono text-[13.5px] font-semibold tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-25",
                on ? "bg-white text-[#0b0708]" : "bg-control text-foreground hover:bg-control-hover",
              )}
            >
              {s.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** "WAT", "GMT+1" — the viewer's zone, short, for the label under a picked time. */
export function zoneName(at = new Date()) {
  const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return part?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}
