"use client";

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { Lightning } from "@/components/icons";
import {
  formatClock,
  formatCountdown,
  hostShare,
  inMultiplierWindow,
  isBattleActive,
  leaderOf,
  secondsLeft,
  teamName,
  type BattleView,
} from "@/lib/battles";
import { formatStartsIn } from "@/lib/discovery";
import { DURATION, prefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { LiveBadge, Badge } from "@/components/ui/badge";
import { BattleField } from "./battle-field";
import { TickDigits } from "./tick-digits";
import s from "./battles.module.css";

/**
 * A battle on Home, drawn rather than photographed: two faces on the
 * battle's own ground (./battle-field.tsx) — Chili's field for the host,
 * Ember's for the challenger, a cracked seam between them that gives the
 * leader more ground.
 *
 * - Entrance (once, when it scrolls into view): the faces come in from
 *   their edges, meet in the middle and recoil to their marks; the VS
 *   stamps down on the hit with a ring spreading out of it, and the
 *   tug-of-war line draws out from the centre. ~400 ms, the clash ease.
 * - The score is one line, Chili against Ember, meeting at a knot that
 *   eases toward whoever's ahead. No amounts (owner).
 * - Live, the leader's field breathes — a flat tint rising and falling —
 *   and quickens in the ×2 window. The clock's digits tick.
 * - Booked, it's quieter, with a clean clock and "starts in".
 * - It lifts under the pointer and presses in. Tapping opens the clash
 *   view (./clash-view.tsx); a modified click still follows the link.
 */
export function BattleCard({
  battle: b,
  now,
  index,
  onOpen,
}: {
  battle: BattleView;
  now: number;
  /** Its place in the row, for the stagger. */
  index: number;
  onOpen: (battle: BattleView, from: HTMLElement) => void;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [play, setPlay] = useState<"idle" | "go" | "done">("idle");
  const [visible, setVisible] = useState(false);

  // Play the entrance the first time it's on screen; keep loops paused off it.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        const on = Boolean(e?.isIntersecting);
        setVisible(on);
        if (on) setPlay((p) => (p === "idle" ? (prefersReducedMotion() ? "done" : "go") : p));
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Once it has landed, drop the entrance so hover and the breath own the card.
  useEffect(() => {
    if (play !== "go") return;
    const t = setTimeout(() => setPlay("done"), index * DURATION.clashStagger + DURATION.clash + 900);
    return () => clearTimeout(t);
  }, [play, index]);

  const live = isBattleActive(b);
  const booked = b.status === "scheduled";
  const hot = live && inMultiplierWindow(b, now);
  const lead = live ? leaderOf(b.host.usdMinor, b.challenger.usdMinor) : null;
  const leader = lead ? b[lead] : null;
  const href = live ? `/stream/${b.host.streamId}` : `/c/${b.host.username}`;

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // A new tab or window keeps the link; a plain tap opens the clash.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(b, e.currentTarget);
  };

  const face = (side: BattleView["host"], ring: string) => (
    <span className="relative block">
      <UserAvatar
        src={side.avatar}
        name={side.displayName}
        size={64}
        className={cn("size-14 ring-[3px] ring-offset-[3px] ring-offset-surface sm:size-16", ring, booked && "opacity-85")}
      />
      {side.partner && (
        <UserAvatar
          src={side.partner.avatar}
          name={side.partner.displayName}
          size={28}
          className="absolute -right-2 -bottom-1 size-7 ring-2 ring-surface"
        />
      )}
    </span>
  );

  return (
    <a
      ref={ref}
      href={href}
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={`${teamName(b.host)} versus ${teamName(b.challenger)}${live ? ", live battle" : ", booked battle"}. Open the clash.`}
      className={cn(s.card, "group")}
      data-play={play}
      style={{ ["--delay" as string]: `${index * DURATION.clashStagger}ms` } as CSSProperties}
    >
      <div className={s.art} data-visible={String(visible)}>
        <BattleField id={b.id} share={live ? hostShare(b) : 0.5} lead={lead} tone={live ? "live" : booked ? "booked" : "ended"} hot={hot} />

        <span className={s.impact} aria-hidden />
        <span className={s.face} data-side="host">
          <span className={cn(s.mover, "block")}>{face(b.host, "ring-chili")}</span>
        </span>
        <span className={s.face} data-side="challenger">
          <span className={cn(s.mover, "block")}>{face(b.challenger, "ring-ember")}</span>
        </span>
        <span className={s.vs} aria-hidden>
          <span className={cn(s.mover, "block font-wide text-[20px] font-black tracking-[-0.04em] text-foreground italic")}>VS</span>
        </span>

        <span className="absolute top-2 left-2 flex gap-1">
          {live ? <LiveBadge>{" · Battle"}</LiveBadge> : <Badge variant="glass">Booked</Badge>}
          {b.mode === "2v2" && <Badge variant="glass">2v2</Badge>}
        </span>

        <span className="absolute top-2 right-2">
          {live ? (
            <span className={cn(s.chip, hot ? "bg-ember text-on-ember" : "bg-inverse text-on-inverse")}>
              {hot && (
                <>
                  <Lightning size={10} weight="fill" />
                  <span>×{b.multiplier}</span>
                  <span className="opacity-40">·</span>
                </>
              )}
              {b.status === "overtime" && <span>OT</span>}
              <TickDigits text={formatClock(secondsLeft(b, now))} />
              <span className="sr-only">{formatClock(secondsLeft(b, now))} left</span>
            </span>
          ) : (
            <span className={cn(s.chip, "bg-control text-foreground/85")}>
              <BookedClock />
              {b.scheduledAt ? (
                <StartsIn at={b.scheduledAt} now={now} />
              ) : (
                "Soon"
              )}
            </span>
          )}
        </span>

        {live && (
          <span
            className={cn(s.tug, "inset-x-5 bottom-3.5")}
            style={{ ["--share" as string]: hostShare(b) } as CSSProperties}
            aria-hidden
          >
            <span className={s.tugHost} />
            <span className={s.knotTrack}>
              <span className={s.knot} />
            </span>
          </span>
        )}
      </div>

      <div className={s.meta}>
        <p className="mt-2 truncate text-[14px] font-semibold text-foreground">
          {teamName(b.host)} <span className="font-medium text-muted-foreground">vs</span> {teamName(b.challenger)}
        </p>
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {live
            ? hot
              ? `Gifts count ×${b.multiplier} now · ${leader ? `${leader.displayName} ahead` : "dead level"}`
              : leader
                ? `${leader.displayName} ahead · tap for the clash`
                : "Dead level · tap for the clash"
            : "Starts by itself when both are live"}
        </p>
      </div>
    </a>
  );
}

/** "in 2:31:44" under a day, else the day and time, e.g. "tomorrow 18:34". */
function StartsIn({ at, now }: { at: string; now: number }) {
  const ms = new Date(at).getTime() - now;
  if (ms <= 0) return <span>Starting</span>;
  if (ms >= 86_400_000) return <span suppressHydrationWarning>{formatStartsIn(at, now)}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-sans font-semibold">in</span>
      <TickDigits text={formatCountdown(ms)} />
    </span>
  );
}

/** A clean clock face, 16 px, its hand stepping round once a minute. */
function BookedClock() {
  return (
    <svg viewBox="0 0 16 16" width={12} height={12} aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <line x1="8" y1="8" x2="8" y2="4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <line className={s.clockHand} x1="8" y1="8" x2="10.8" y2="8" stroke="var(--ember)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
