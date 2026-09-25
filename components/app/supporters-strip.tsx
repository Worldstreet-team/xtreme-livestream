"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Crown, Gift, Clock } from "@/components/icons";
import { formatStartsIn, type RowItem } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { RemindButton } from "@/components/app/upcoming-card";

export interface Supporter {
  userId?: string;
  username: string;
  displayName?: string;
  avatar: string;
  totalUsdMinor: number;
  count?: number;
}

function usd(minor: number) {
  return (minor / 100) % 1 === 0 ? `$${minor / 100}` : `$${(minor / 100).toFixed(2)}`;
}

/** Rank chips as on the top gifters board: #1 ink (on its Ember card), #2 white, #3 Chili. */
const RANK_CHIP = ["bg-on-ember text-white", "bg-white text-[#0b0708]", "bg-chili text-white"];

/**
 * The room's top supporters as borderless pills — rank chip, face, name,
 * total, share of the top five — in one strip that fades out at the right
 * edge instead of wrapping. The eye reads "there's more"; the strip never
 * fights the schedule beside it for height. The leader's pill is solid
 * Ember with ink on it, like the top gifters board; the totals are money,
 * so the rest wear them in gold.
 */
export function SupportersStrip({ gifters }: { gifters: Supporter[] }) {
  const total = gifters.reduce((n, g) => n + g.totalUsdMinor, 0) || 1;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [edge, setEdge] = useState<"none" | "right" | "left" | "both">("right");

  // Which edges fade: only where there is more to see.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const more = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    const before = el.scrollLeft > 2;
    setEdge(more && before ? "both" : more ? "right" : before ? "left" : "none");
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [measure, gifters.length]);

  // Drag to scroll with a mouse; touch and trackpads scroll natively. A drag
  // that actually moved swallows the click so it doesn't open a channel.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || !ref.current) return;
    drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !ref.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    ref.current.scrollLeft = drag.current.left - dx;
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
      className={cn(
        "relative -mx-1 cursor-grab overflow-x-auto px-1 pb-1 select-none scrollbar-none active:cursor-grabbing",
        edge === "right" && "[mask-image:linear-gradient(to_right,black_84%,transparent)]",
        edge === "left" && "[mask-image:linear-gradient(to_right,transparent,black_16%)]",
        edge === "both" && "[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
      )}
    >
      <div className="flex w-max gap-2.5">
        {gifters.map((g, i) => {
          const name = g.displayName || g.username;
          const share = Math.round((g.totalUsdMinor / total) * 100);
          const first = i === 0;
          return (
            <Link
              key={g.userId ?? g.username}
              href={`/c/${g.username}`}
              className={cn(
                "group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-[14px] py-2 pr-4 pl-2 text-left transition-[transform,background-color] duration-300 [transition-timing-function:var(--ease-spring)] hover:-translate-y-0.5",
                first ? "bg-ember text-on-ember" : "bg-surface text-foreground hover:bg-surface-hover"
              )}
            >
              {first && (
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0))]" />
              )}
              <span className="relative">
                <UserAvatar
                  src={g.avatar}
                  name={name}
                  size={first ? 36 : 40}
                  ring={first ? "live" : "none"}
                  ringGapClassName="bg-ember"
                />
                <span
                  className={cn(
                    "absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full font-mono text-[10px] font-bold ring-2",
                    first ? "ring-ember" : "ring-surface",
                    RANK_CHIP[i] ?? "bg-[#3a3234] text-white"
                  )}
                >
                  {first ? <Crown size={10} weight="fill" /> : i + 1}
                </span>
              </span>
              <span className="relative flex min-w-0 flex-col leading-tight">
                <span className="max-w-[10rem] truncate text-[13.5px] font-bold">{name}</span>
                <span className={cn("flex items-center gap-1.5 text-[11.5px] tabular-nums", first ? "text-on-ember/70" : "text-muted-foreground")}>
                  {g.count ? (
                    <>
                      <Gift size={11} weight="fill" />
                      {g.count} gift{g.count === 1 ? "" : "s"} ·
                    </>
                  ) : null}
                  {share}% of the top
                </span>
              </span>
              <span className={cn("relative ml-1 font-mono text-[14.5px] font-bold tabular-nums", first ? "text-on-ember" : "text-value")}>
                {usd(g.totalUsdMinor)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** The host's next broadcasts as rows — a calendar leaf, a live countdown and a reminder. */
export function ScheduleList({ items }: { items: RowItem[] }) {
  const now = useNow(true);
  return (
    <div className="flex flex-col gap-1.5">
      {items.slice(0, 4).map((item) => {
        const at = item.scheduledStartAt ? new Date(item.scheduledStartAt) : null;
        return (
          <div key={item._id} className="flex items-center gap-3 rounded-[14px] bg-surface py-2 pr-2 pl-2">
            {at ? (
              <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-white/[0.06] leading-none">
                <span className="caps font-mono text-[9px] text-ember-hi">
                  {at.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="mt-1 font-wide text-[17px] font-bold tracking-[-0.02em] text-foreground tabular-nums">
                  {at.getDate()}
                </span>
              </span>
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.06] text-muted-foreground">
                <Clock size={16} weight="bold" />
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-[13.5px] font-semibold text-foreground">{item.title}</span>
              <span className="mt-0.5 truncate text-[11.5px] text-muted-foreground tabular-nums">
                {item.scheduledStartAt ? formatStartsIn(item.scheduledStartAt, now) : "Soon"}
                {at ? ` · ${at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""} · {item.category}
              </span>
            </span>
            <RemindButton streamId={item._id} initial={item.reminded ?? false} size="sm" />
          </div>
        );
      })}
    </div>
  );
}
