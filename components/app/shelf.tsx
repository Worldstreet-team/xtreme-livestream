"use client";

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CaretLeft, CaretRight } from "@/components/icons";
import { cn } from "@/lib/utils";

/**
 * A shelf: one row, one rule, one title — and it slides.
 *
 * Every width is a carousel now (owner, 2026-09-23: "carousels instead of
 * view all — people will want to slide and swipe through"). Desktop shows
 * as many whole cards as fit, measured rather than set by breakpoint, and
 * two round arrows in the header page through the rest a screenful at a
 * time; a trackpad swipe works too. Phones swipe, the way Twitch's app
 * does: stream cards show one and a sliver of the next, category art shows
 * two and a half. Snap points keep a card whole after every flick.
 *
 * `rows={2}` makes the desktop row a two-deep grid that pages as a block —
 * eight cards to a screen on a laptop, in reading order — while phones
 * still get the single sliding row. Cards sit close (12px) so a screen
 * reads as one feed, not a set of separate tiles.
 */

export type ShelfSize = "large" | "standard" | "compact";

/** Narrowest a card may be before the row fits one fewer. */
const MIN_CARD: Record<ShelfSize, number> = {
  large: 360,
  standard: 300,
  compact: 132,
};

/** How many cards show at once in the phone's sliding row. */
const PHONE_VISIBLE: Record<ShelfSize, number> = {
  large: 1.2,
  standard: 1.2,
  compact: 2.6,
};

const GAP = 12;
/** Space between the two rows of a two-row shelf — room for the text under a card. */
const ROW_GAP = 20;
const PHONE_GAP = 12;
const PHONE = "(max-width: 767px)";

function useColumns(size: ShelfSize) {
  const ref = useRef<HTMLDivElement>(null);
  // Four is the right guess for the first server paint on a laptop.
  const [columns, setColumns] = useState(size === "compact" ? 7 : 4);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // The row runs out to the page panel's edges on desktop and pads back
      // in, so the padding isn't room for cards.
      const cs = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
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
  size = "standard",
  fullBleed = false,
  accent,
  rows = 1,
  peek = false,
  children,
  className,
}: {
  id: string;
  title: string;
  /** The evidence line — why this row exists for this viewer. */
  reason?: string;
  /** Kept for callers; the row slides now rather than linking out. */
  href?: string;
  size?: ShelfSize;
  /** Break out of the content column to the viewport edge. */
  fullBleed?: boolean;
  /** A small mark beside the title (a live dot, a rising arrow). */
  accent?: ReactNode;
  /** Desktop rows per page. Phones always slide one row. */
  rows?: 1 | 2;
  /**
   * Show a half card past the last whole one on desktop, cut by the edge,
   * so the row reads as something to slide (owner, 2026-09-24, Battles:
   * "3 and 1/2 so it looks a bit cutout"). Arrows still page whole cards.
   */
  peek?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { ref, columns } = useColumns(size);
  const phone = usePhone();
  const items = Children.toArray(children);
  const [edge, setEdge] = useState({ start: true, end: items.length <= columns });

  // Which arrows make sense: none at the start, none at the end.
  const readEdges = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft <= 4;
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, [ref]);
  useEffect(() => {
    readEdges();
  }, [readEdges, columns, items.length]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const from = el.scrollLeft;
    // A peeking row pages by its whole cards, so the half one comes round to the front.
    const card = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
    const step = peek && card ? columns * (card + GAP) : el.clientWidth + GAP;
    const to = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, from + dir * step));
    el.scrollTo({ left: to, behavior: "smooth" });
    // Smooth scrolling rides animation frames; where none run (a background
    // tab, some embedded views) it never starts, so jump instead.
    setTimeout(() => {
      if (Math.abs(el.scrollLeft - from) < 2) el.scrollTo({ left: to, behavior: "instant" });
    }, 350);
  };

  // On phones every shelf bleeds to the screen edge so the sliding row can
  // run under the page padding and the next card peeks in from the bezel.
  const bleed = fullBleed || phone;
  const gap = phone ? PHONE_GAP : GAP;
  const across = phone ? PHONE_VISIBLE[size] : peek ? columns + 0.5 : columns;
  const whole = Math.ceil(across) - 1;
  const width = `calc((100% - ${gap * whole}px) / ${across})`;
  const arrows = !phone && !(edge.start && edge.end);
  // Two rows only when there's more than one row's worth to show.
  const deep = !phone && rows === 2 && items.length > columns;
  const perPage = columns * 2;
  const pages = deep ? Array.from({ length: Math.ceil(items.length / perPage) }, (_, p) => items.slice(p * perPage, (p + 1) * perPage)) : [];

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
            className="flex items-center gap-2.5 font-wide text-[17px] font-bold tracking-[-0.02em] text-foreground md:text-[19px]"
          >
            {accent}
            <span className="truncate">{title}</span>
          </h2>
          {reason && <p className="mt-0.5 truncate text-[13px] text-muted-foreground/70">{reason}</p>}
        </div>
        {arrows && (
          <div className="flex shrink-0 gap-1.5">
            {([-1, 1] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => page(dir)}
                disabled={dir === -1 ? edge.start : edge.end}
                aria-label={dir === -1 ? `Back through ${title}` : `More ${title}`}
                aria-controls={`shelf-row-${id}`}
                className="press flex size-9 items-center justify-center rounded-full bg-control text-foreground transition-[background-color,opacity] hover:bg-control-hover disabled:pointer-events-none disabled:opacity-30"
              >
                {dir === -1 ? <CaretLeft size={16} weight="bold" /> : <CaretRight size={16} weight="bold" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        ref={ref}
        id={`shelf-row-${id}`}
        onScroll={readEdges}
        // Desktop: the row reaches past the page's padding to the panel's
        // edges, so cards slide out under the rails, not at the padding
        // (owner, 2026-09-28); the first card still sits on the gutter.
        className={cn("flex snap-x snap-mandatory overflow-x-auto pb-1 scrollbar-none", bleed ? "px-4 md:px-8" : "md:-mx-6 md:scroll-px-6 md:px-6")}
        style={{ gap, scrollPaddingLeft: bleed ? 16 : undefined }}
      >
        {deep
          ? pages.map((page, p) => (
              <div
                key={p}
                className="grid w-full shrink-0 snap-start"
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP, rowGap: ROW_GAP }}
              >
                {page}
              </div>
            ))
          : items.map((child, i) => (
              <div key={i} className="shrink-0 snap-start" style={{ width }}>
                {child}
              </div>
            ))}
      </div>
    </section>
  );
}

/** The pulsing red mark used as a shelf accent for anything live. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-1.5 shrink-0", className)}>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-chili opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-chili" />
    </span>
  );
}
