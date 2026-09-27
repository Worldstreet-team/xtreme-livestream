"use client";

import { Clock } from "@/components/icons";
import { formatStartsIn, type RowItem } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { RemindButton } from "@/components/app/upcoming-card";

// The top supporters strip that lived here moved into the chat (the top
// gifters bar and rank badges, 2026-09-25); the schedule rows stay.

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
              <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-[10px] bg-tint/[0.06] leading-none">
                <span className="caps font-mono text-[9px] text-ember-hi">
                  {at.toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span className="mt-1 font-wide text-[17px] font-bold tracking-[-0.02em] text-foreground tabular-nums">
                  {at.getDate()}
                </span>
              </span>
            ) : (
              <span className="flex size-11 shrink-0 items-center justify-center rounded-[10px] bg-tint/[0.06] text-muted-foreground">
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
