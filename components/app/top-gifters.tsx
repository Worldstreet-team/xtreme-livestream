"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DURATION, MOTION_VARS, staggerDelay } from "@/lib/motion";
import { usePlayOnView } from "@/lib/use-play-on-view";
import { useCountUp } from "@/lib/use-count-up";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Money, formatUsd } from "@/components/xtream/money";
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

/** Rank chips on the ember ground: #1 ink, #2 and #3 a veil of it. */
const RANK_CHIP = ["bg-on-ember text-ember", "bg-on-ember/[0.16] text-on-ember", "bg-on-ember/[0.16] text-on-ember"];
/** The board's own ground — solid Ember (owner, 2026-09-24: "i just need the solid ember"); ink sits on it. */
const GROUND = "bg-ember";
/** Each step's height: a real podium, #1 tallest. */
const STEP_H = [54, 40, 30];

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

/** An amount that counts up from nothing once its step has risen. */
function CountUp({ cents, run, delay, compact = true }: { cents: number; run: boolean; delay: number; compact?: boolean }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t);
  }, [run, delay]);
  const shown = useCountUp(started ? cents : 0, DURATION.count, 0);
  return <>{formatUsd(shown, compact)}</>;
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
        {first && <Crown onEmber delay={T.crown} className="mb-0.5 w-[30px]" />}
        <span className="relative">
          {first && (
            <Laurel
              onEmber
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
          <span
            className={cn(
              "absolute -bottom-1.5 left-1/2 flex size-5 -translate-x-1/2 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ring-2 ring-ember",
              RANK_CHIP[rank],
            )}
          >
            {rank + 1}
          </span>
        </span>
        <span className={cn("mt-3 w-full truncate px-0.5 font-bold", first ? "text-[13.5px] text-on-ember" : "text-[12.5px] text-on-ember/90")}>
          {g.username}
        </span>
        <span className="w-full truncate px-0.5 text-[11.5px] text-on-ember/65">{g.displayName}</span>
        {/* The step itself, with what they gave on it. */}
        <span
          className={cn(
            "mt-2 flex w-full justify-center rounded-t-[10px] border-2 border-b-0 pt-1.5",
            first ? "border-on-ember/30 bg-on-ember/[0.14]" : "border-on-ember/20 bg-on-ember/[0.08]",
          )}
          style={{ height: STEP_H[rank] }}
        >
          <span className={cn("font-money leading-none tabular-nums text-on-ember", first ? "text-[15px]" : "text-[13px] text-on-ember/85")}>
            <CountUp cents={g.totalUsdMinor} run={play} delay={delay + DURATION.rise * 0.4} />
          </span>
        </span>
      </span>
    </Link>
  );
}

/**
 * Top gifters this week, as a podium on a solid Ember board: #1 in the
 * middle on the tallest step, in a heat ring, a laurel and a crown; #2 and
 * #3 either side; 4 and 5 as rows. It builds itself when it comes on
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
        className={cn(u.podium, "relative isolate cursor-pointer overflow-hidden rounded-panel", GROUND)}
      >
        {/* Confetti bursts from #1 as the crown lands, then rests as specks. */}
        <Confetti delay={T.crown} className="pointer-events-none absolute inset-x-0 top-0 -z-10 w-full" />
        {/* Steps rise from below the floor, so the floor clips them. */}
        <div className="flex items-end gap-1.5 overflow-hidden px-3 pt-4">
          {two ? <Podium g={two} rank={1} play={go} /> : <span className="flex-1" />}
          <Podium g={one} rank={0} play={go} />
          {three ? <Podium g={three} rank={2} play={go} /> : <span className="flex-1" />}
        </div>
        <div className="h-0.5 bg-on-ember/20" />
        {top.length > 3 && (
          <ol start={4} className="flex flex-col gap-px px-3 pt-2 pb-2.5">
            {top.slice(3).map((g, i) => (
              <li key={g.userId} className={u.podiumRow} style={{ "--delay": `${T.rows + i * DURATION.stagger * 2}ms` } as CSSProperties}>
                <Link href={`/c/${g.username}`} className="flex items-center gap-3 rounded-control px-1.5 py-1.5 transition-colors hover:bg-on-ember/[0.07]">
                  <span className="w-3 shrink-0 text-center font-mono text-[11.5px] font-bold text-on-ember/50">{i + 4}</span>
                  <UserAvatar src={g.avatar} name={g.displayName} size={28} className="size-7 shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-[13px] font-bold text-on-ember">{g.username}</span>
                    <span className="truncate text-[11.5px] text-on-ember/65">{g.displayName}</span>
                  </span>
                  <span className="shrink-0 font-money text-[13px] text-on-ember/85 tabular-nums">
                    <CountUp cents={g.totalUsdMinor} run={go} delay={T.rows} />
                  </span>
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
      <div data-play={open ? "go" : "idle"} style={MOTION_VARS}>
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
                        i === 0 ? "bg-ember text-on-ember" : i < 3 ? "bg-tone-ember text-ember-hi" : "text-muted-foreground",
                      )}
                    >
                      {i + 1}
                    </span>
                    <UserAvatar src={g.avatar} name={g.displayName} size={40} className="size-10 shrink-0" />
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
