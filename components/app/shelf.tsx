"use client";

import Link from "next/link";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CaretDown, CaretUp } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * A shelf: one row, one rule, one title.
 *
 * Desktop lays a row out the way Kick and Twitch do: a grid that fills the
 * full width with as many cards as fit — five across on a big display, four
 * on a laptop — and then stops. Nothing peeks off the right edge; "Show
 * more" opens the next row in place. Columns are computed from the measured
 * width rather than breakpoints, so a row inside a narrower panel still
 * fills exactly.
 *
 * Phones do the opposite, the way Twitch's app does: the row slides. Stream
 * cards show one and a sliver of the next, category art shows two and a
 * half, and the edge of the next card is the invitation to swipe. Snap
 * points keep a card whole after every flick.
 */

export type ShelfSize = "large" | "standard" | "compact";

/** Narrowest a card may be before the row drops a column. */
const MIN_CARD: Record<ShelfSize, number> = {
  large: 340,
  standard: 288,
  compact: 236,
};

/** How many cards show at once in the phone's sliding row. */
const PHONE_VISIBLE: Record<ShelfSize, number> = {
  large: 1.2,
  standard: 1.2,
  compact: 2.5,
};

const GAP = 16;
const PHONE_GAP = 12;
const PHONE = "(max-width: 767px)";

function useColumns(size: ShelfSize) {
  const ref = useRef<HTMLDivElement>(null);
  // Four is the right guess for the first server paint on a laptop.
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const n = Math.max(1, Math.floor((w + GAP) / (MIN_CARD[size] + GAP)));
      setColumns((c) => (c === n ? c : n));
    };
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [size]);
  return { ref, columns };
}

/** True on phones. False for the server paint, so the grid renders first. */
export function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return phone;
}

export function Shelf({
  id,
  title,
  reason,
  href,
  size = "standard",
  fullBleed = false,
  accent,
  /** Rows shown before "Show more". */
  rows = 1,
  children,
  className,
}: {
  id: string;
  title: string;
  /** The evidence line — why this row exists for this viewer. */
  reason?: string;
  /** "See all" destination. */
  href?: string;
  size?: ShelfSize;
  /** Break out of the content column to the viewport edge. */
  fullBleed?: boolean;
  /** A small mark beside the title (a live dot, a rising arrow). */
  accent?: ReactNode;
  rows?: number;
  children: ReactNode;
  className?: string;
}) {
  const { ref, columns } = useColumns(size);
  const phone = usePhone();
  const [openRows, setOpenRows] = useState(rows);
  const items = Children.toArray(children);
  const visible = phone ? items : items.slice(0, columns * openRows);
  const hasMore = !phone && items.length > visible.length;
  const expanded = !phone && openRows > rows;

  // On phones every shelf bleeds to the screen edge so the sliding row can
  // run under the page padding and the next card peeks in from the bezel.
  const bleed = fullBleed || phone;

  return (
    <section
      aria-labelledby={`shelf-${id}`}
      data-shelf={id}
      className={cn("group/shelf", bleed && "-mx-4 md:-mx-8", className)}
    >
      <div className={cn("mb-3 flex items-end justify-between gap-4 md:mb-4", bleed && "px-4 md:px-8")}>
        <div className="min-w-0">
          <h2
            id={`shelf-${id}`}
            className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-foreground md:text-[19px]"
          >
            {accent}
            <span className="truncate">{title}</span>
          </h2>
          {reason && (
            <p className="mt-0.5 truncate text-[13px] text-muted-foreground/70">{reason}</p>
          )}
        </div>
        {href && (
          <Link
            href={href}
            className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ArrowRight size={13} />
          </Link>
        )}
      </div>

      {phone ? (
        <div
          ref={ref}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 scrollbar-none"
          style={{ scrollPaddingLeft: 16 }}
        >
          {visible.map((child, i) => (
            <div
              key={i}
              className="shrink-0 snap-start"
              style={{ width: `calc((100% - ${PHONE_GAP * Math.ceil(PHONE_VISIBLE[size] - 1)}px) / ${PHONE_VISIBLE[size]})` }}
            >
              {child}
            </div>
          ))}
        </div>
      ) : (
        <div
          ref={ref}
          className={cn("grid gap-x-4 gap-y-6", bleed && "px-4 md:px-8")}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {visible}
        </div>
      )}

      {(hasMore || expanded) && (
        <div className="relative mt-5 flex items-center justify-center">
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/[0.06]" />
          <button
            type="button"
            onClick={() => setOpenRows((r) => (hasMore ? r + 1 : rows))}
            className="relative flex items-center gap-1.5 bg-background px-4 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {hasMore ? "Show more" : "Show less"}
            {hasMore ? <CaretDown size={13} weight="bold" /> : <CaretUp size={13} weight="bold" />}
          </button>
        </div>
      )}
    </section>
  );
}

/** The pulsing red mark used as a shelf accent for anything live. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-1.5 shrink-0", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
    </span>
  );
}
