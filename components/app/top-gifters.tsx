"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DURATION, MOTION_VARS, staggerDelay } from "@/lib/motion";
import { usePlayOnView } from "@/lib/use-play-on-view";
import { useCountUp } from "@/lib/use-count-up";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Money } from "@/components/xtream/money";
import { UnfoldWindow, unfoldRow } from "@/components/app/unfold-window";
import { Confetti, Crown, Laurel, PodiumScene } from "@/components/app/art";
import u from "./unfold.module.css";

interface Gifter {
  userId: string;
  username: string;
  displayName: string;
  avatar: string;
  verified?: boolean;
  totalUsdMinor: number;
  count: number;
}

/**
 * The board's own ground: the theme's surface — dark in dark, paper in
 * light — with a hairline (owner, 2026-09-28: "let it not use ember
 * anymore: either dark or white depending on the theme, and use our colors
 * as accents"). The palette only accents it: heat on #1's ring, a Chili
 * crown, an Ember edge on #1's step, gold on the amounts.
 */
const GROUND = "bg-surface";
/** Each step's height: a real podium, #1 tallest, its rank on its face. */
const STEP_H = [58, 44, 34];

/**
 * The order the podium builds in: #3, then #2, then #1 lifts last; the
 * crown lands on it, the confetti goes, and 4 and 5 follow.
 */
const T = {
  step: [2 * DURATION.step, DURATION.step, 0] as const,
  first: 3 * DURATION.step + 60,
  crown: 3 * DURATION.step + DURATION.rise * 0.55,
  rows: 3 * DURATION.step + DURATION.rise * 0.7,
};
const stepDelay = (rank: 0 | 1 | 2) => (rank === 0 ? T.first : T.step[rank]);

/** An amount — money, so gold — that counts up from nothing once its step has risen. */
function CountUp({ cents, run, delay, className }: { cents: number; run: boolean; delay: number; className?: string }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [run, delay]);
  const shown = useCountUp(started ? cents : 0, DURATION.count, 0);
  return <Money cents={shown} size="sm" compact className={cn("tabular-nums", className)} />;
}

function Podium({ g, rank, play }: { g: Gifter; rank: 0 | 1 | 2; play: boolean }) {
  const first = rank === 0;
  const delay = stepDelay(rank);
  return (
    <Link
      href={`/c/${g.username}`}
      className={cn("group/pod flex min-w-0 flex-col items-center text-center", first ? "flex-[1.3]" : "flex-1")}
    >
      <span
        className={cn(u.step, "flex w-full flex-col items-center")}
        data-first={first || undefined}
        style={{ "--delay": `${delay}ms` } as CSSProperties}
      >
        {first && <Crown delay={T.crown} className="mb-0.5 w-[30px]" />}
        <span className="relative">
          {first && (
            <Laurel
              delay={T.crown - 80}
              className="pointer-events-none absolute top-1/2 left-1/2 w-[118px] -translate-x-1/2 -translate-y-1/2"
            />
          )}
          <UserAvatar
            src={g.avatar}
            name={g.displayName}
            size={first ? 60 : 46}
            ring={first ? "live" : "seen"}
            ringGapClassName={GROUND}
            className="transition-transform duration-300 group-hover/pod:scale-[1.04]"
          />
        </span>
        <span className={cn("mt-2.5 w-full truncate px-0.5 font-bold text-foreground", first ? "text-[13.5px]" : "text-[12.5px]")}>
          {g.username}
        </span>
        <span className="w-full truncate px-0.5 text-[11.5px] text-muted-foreground">{g.displayName}</span>
        <CountUp
          cents={g.totalUsdMinor}
          run={play}
          delay={delay + DURATION.rise * 0.4}
          className={cn("mt-1.5", first ? "text-[15px]" : "text-[13px]")}
        />
        {/* The step itself: a quiet tint with the rank on its face; #1's wears an Ember edge. */}
        <span
          className={cn(
            "mt-2 flex w-full justify-center rounded-t-[10px] pt-2 font-wide leading-none font-bold tabular-nums",
            first
              ? "bg-tint/[0.08] text-[22px] text-foreground shadow-[inset_0_2px_0_var(--ember),inset_1px_0_0_var(--hairline-color),inset_-1px_0_0_var(--hairline-color)]"
              : "bg-tint/[0.045] text-[17px] text-muted-foreground shadow-[inset_0_1px_0_var(--hairline-color),inset_1px_0_0_var(--hairline-color),inset_-1px_0_0_var(--hairline-color)]",
          )}
          style={{ height: STEP_H[rank] }}
        >
          {rank + 1}
        </span>
      </span>
    </Link>
  );
}

/**
 * Top gifters this week, as a podium on the theme's own surface (dark or
 * paper): #1 in the middle on the tallest step, in a heat ring, a laurel
 * and a Chili crown; #2 and #3 either side; 4 and 5 as rows. Amounts are
 * money, so gold; the steps are quiet tints with the rank on their face. It builds itself when it comes on
 * screen — steps rising #3, #2, then #1 lifting last, the crown dropping
 * on, confetti, amounts counting up.
 *
 * Tapping the board (anywhere but a person) or "See all" unfolds the full
 * top twenty in the same window the bell uses. `heading` receives that
 * "See all" to place in its row. Lives on the right rail.
 */
export function TopGiftersBoard({ heading, className }: { heading?: (seeAll: ReactNode) => ReactNode; className?: string }) {
  const [top, setTop] = useState<Gifter[]>([]);
  const [board, play] = usePlayOnView<HTMLDivElement>(top.length > 0);
  const sectionRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      apiFetch<{ success: boolean; data: { top: Gifter[] } }>(`/api/gifts/leaderboard`)
        .then((r) => !cancelled && setTop(r.data.top))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const toggle = () => {
    if (open) return setOpen(false);
    setAnchor(board.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };

  if (top.length === 0) return null;
  const [one, two, three] = top;
  const go = play === "go";

  const seeAll = (
    <button
      type="button"
      onClick={toggle}
      aria-haspopup="dialog"
      aria-expanded={open}
      className="text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
    >
      See all
    </button>
  );

  return (
    <section ref={sectionRef} aria-label="Top gifters this week" className={className}>
      {heading?.(seeAll)}
      <div
        ref={board}
        data-play={play}
        style={MOTION_VARS}
        onClick={(e) => {
          if ((e.target as Element).closest("a,button")) return;
          toggle();
        }}
        className={cn(
          u.podium,
          "relative isolate cursor-pointer overflow-hidden rounded-panel shadow-[inset_0_0_0_1px_var(--hairline-color)]",
          GROUND,
        )}
      >
        {/* Confetti bursts from #1 as the crown lands, then rests as specks. */}
        <Confetti delay={T.crown} className="pointer-events-none absolute inset-x-0 top-0 -z-10 w-full" />
        {/* Steps rise from below the floor, so the floor clips them. */}
        <div className="flex items-end gap-1.5 overflow-hidden px-3 pt-4">
          {two ? <Podium g={two} rank={1} play={go} /> : <span className="flex-1" />}
          <Podium g={one} rank={0} play={go} />
          {three ? <Podium g={three} rank={2} play={go} /> : <span className="flex-1" />}
        </div>
        <div className="mx-3 h-px bg-tint/[0.12]" />
        {top.length > 3 && (
          <ol start={4} className="flex flex-col gap-px px-3 pt-2 pb-2.5">
            {top.slice(3).map((g, i) => (
              <li key={g.userId} className={u.podiumRow} style={{ "--delay": `${T.rows + i * DURATION.stagger * 2}ms` } as CSSProperties}>
                <Link href={`/c/${g.username}`} className="flex items-center gap-3 rounded-control px-1.5 py-1.5 transition-colors hover:bg-tint/[0.05]">
                  <span className="w-3 shrink-0 text-center font-mono text-[11.5px] font-bold text-muted-foreground">{i + 4}</span>
                  <UserAvatar src={g.avatar} name={g.displayName} size={28} className="size-7 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[13px] font-bold text-foreground">{g.username}</span>
                    <span className="truncate text-[11.5px] text-muted-foreground">{g.displayName}</span>
                  </span>
                  <CountUp cents={g.totalUsdMinor} run={go} delay={T.rows} className="shrink-0 text-[13px]" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>

      <GiftersWindow open={open} onClose={() => setOpen(false)} anchor={anchor} triggerRef={sectionRef} />
    </section>
  );
}

/**
 * The full board: this week's top twenty, in the bell's window — unfolding
 * over the podium on a computer, sliding in from the right on a phone. A
 * drawn podium builds at its head; amounts are money, so they're gold.
 */
function GiftersWindow({
  open,
  onClose,
  anchor,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  anchor: DOMRect | null;
  triggerRef: React.RefObject<HTMLElement | null>;
}) {
  const [rows, setRows] = useState<Gifter[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { top: Gifter[] } }>(`/api/gifts/leaderboard?limit=20`)
      .then((r) => {
        if (cancelled) return;
        setRows(r.data.top);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const total = rows?.reduce((sum, g) => sum + g.totalUsdMinor, 0) ?? 0;
  const gifts = rows?.reduce((sum, g) => sum + g.count, 0) ?? 0;
  const shownTotal = useCountUp(open && rows ? total : 0, DURATION.count, 0);
  const head = unfoldRow(staggerDelay(1));

  return (
    <UnfoldWindow
      open={open}
      onClose={onClose}
      anchor={anchor}
      triggerRef={triggerRef}
      placement="over"
      width={400}
      label="Top gifters this week"
      title="Top gifters"
      aside={<span className="shrink-0 text-[12px] text-muted-foreground">This week</span>}
    >
      <div data-play={open ? "go" : "idle"} style={MOTION_VARS} className="[--art-ground:var(--popover)]">
        <div className="flex items-center gap-4 px-4 pt-3 pb-3">
          <PodiumScene className="w-[132px] shrink-0" />
          <div className={cn("min-w-0", head.className)} style={head.style}>
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              {rows && rows.length > 0 ? `Sent this week by the top ${rows.length}` : "Sent this week"}
            </p>
            <Money cents={shownTotal} size="lg" className="mt-1.5 block tabular-nums" />
            {rows && rows.length > 0 && (
              <p className="mt-1.5 text-[12px] text-muted-foreground tabular-nums">
                {gifts.toLocaleString("en-US")} gift{gifts === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="px-2 pb-2">
        {rows === null && !failed ? (
          <ul aria-busy="true" className="flex flex-col gap-1 px-1 pt-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-2 py-2">
                <span className="h-3 w-4 animate-pulse rounded bg-tint/[0.06]" />
                <span className="size-10 animate-pulse rounded-full bg-tint/[0.06]" />
                <span className="h-3 flex-1 animate-pulse rounded bg-tint/[0.06]" />
                <span className="h-3 w-12 animate-pulse rounded bg-tint/[0.06]" />
              </li>
            ))}
          </ul>
        ) : failed ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the board. Try again in a moment.</p>
        ) : rows && rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">No gifts yet this week.</p>
        ) : (
          <ol className="flex flex-col gap-px">
            {rows!.map((g, i) => {
              const row = unfoldRow(staggerDelay(i + 2, 14));
              return (
                <li key={g.userId} className={row.className} style={row.style}>
                  <Link
                    href={`/c/${g.username}`}
                    onClick={onClose}
                    className="flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors hover:bg-tint/[0.05] focus-visible:bg-tint/[0.05] focus-visible:outline-none"
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold tabular-nums",
                        i === 0 ? "bg-inverse text-on-inverse" : i < 3 ? "bg-tint/[0.08] text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    {/* #1 wears heat here too, as on the board; everyone else is a bare face. */}
                    {i === 0 ? (
                      <UserAvatar src={g.avatar} name={g.displayName} size={32} ring="live" ringGapClassName="bg-popover" />
                    ) : (
                      <UserAvatar src={g.avatar} name={g.displayName} size={40} className="size-10 shrink-0" />
                    )}
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[14px] font-bold text-foreground">{g.username}</span>
                      <span className="truncate text-[12px] text-muted-foreground">
                        {g.displayName} · {g.count} gift{g.count === 1 ? "" : "s"}
                      </span>
                    </span>
                    <Money cents={g.totalUsdMinor} size="sm" compact className="shrink-0 tabular-nums" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </UnfoldWindow>
  );
}
