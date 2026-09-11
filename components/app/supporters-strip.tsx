"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Crown, Gift, Clock } from "@phosphor-icons/react";
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

/**
 * The room's top supporters as glossy, borderless pills — rank medal, face,
 * name, total, share of the top five — in one strip that fades out at the
 * right edge instead of wrapping or scrolling. The eye reads "there's more";
 * the strip never fights the schedule beside it for height.
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
          return (
            <Link
              key={g.userId ?? g.username}
              href={`/c/${g.username}`}
              className={cn(
                "group relative flex shrink-0 items-center gap-3 overflow-hidden rounded-[12px] py-2 pr-4 pl-2 text-left transition-transform hover:scale-[1.02]",
                i === 0
                  ? "bg-gradient-to-b from-[#3a2c0e] to-[#241b08] text-amber-100"
                  : i === 1
                    ? "bg-gradient-to-b from-[#2e2e34] to-[#1c1c21] text-foreground"
                    : i === 2
                      ? "bg-gradient-to-b from-[#33241a] to-[#1f1610] text-orange-100"
                      : "bg-gradient-to-b from-[#26262d] to-[#18181d] text-foreground/90"
              )}
            >
              {/* the gloss: a highlight across the top half */}
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[0.12] to-transparent" />
              <span className="relative">
                <UserAvatar src={g.avatar} name={name} size={40} className={cn("size-10 ring-2", i === 0 ? "ring-amber-400" : i === 1 ? "ring-neutral-300" : i === 2 ? "ring-amber-700" : "ring-white/[0.15]")} />
                <span
                  className={cn(
                    "absolute -top-1 -left-1 flex size-[18px] items-center justify-center rounded-full text-[9px] font-bold ring-2 ring-[#141418]",
                    i === 0 ? "bg-amber-400 text-neutral-950" : i === 1 ? "bg-neutral-300 text-neutral-950" : i === 2 ? "bg-amber-700 text-white" : "bg-[#3a3a42] text-white"
                  )}
                >
                  {i === 0 ? <Crown size={10} weight="fill" /> : i + 1}
                </span>
              </span>
              <span className="relative flex min-w-0 flex-col leading-tight">
                <span className="max-w-[10rem] truncate text-[13.5px] font-semibold">{name}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] opacity-70 tabular-nums">
                  {g.count ? (
                    <>
                      <Gift size={11} weight="fill" />
                      {g.count} gift{g.count === 1 ? "" : "s"} ·
                    </>
                  ) : null}
                  {share}% of the top
                </span>
              </span>
              <span className="relative ml-1 text-[15px] font-bold tabular-nums">{usd(g.totalUsdMinor)}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** The host's next broadcasts as rows with a live countdown and a reminder. */
export function ScheduleList({ items }: { items: RowItem[] }) {
  const now = useNow(true);
  return (
    <div className="flex flex-col gap-1.5">
      {items.slice(0, 4).map((item) => (
        <div key={item._id} className="flex items-center gap-3 rounded-[12px] bg-gradient-to-b from-[#26262d] to-[#18181d] py-2 pr-2 pl-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-muted-foreground">
            <Clock size={16} weight="bold" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-[13.5px] font-semibold text-foreground">{item.title}</span>
            <span className="truncate text-[11.5px] text-muted-foreground tabular-nums">
              {item.scheduledStartAt ? formatStartsIn(item.scheduledStartAt, now) : "Soon"} · {item.category}
            </span>
          </span>
          <RemindButton streamId={item._id} initial={item.reminded ?? false} size="sm" />
        </div>
      ))}
    </div>
  );
}
