"use client";

import Link from "next/link";
import { CalendarBlank, Clock } from "@/components/icons";
import type { RowItem } from "@/lib/discovery";
import { useImpression, type ImpressionMeta } from "@/lib/impressions";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { RemindButton } from "@/components/app/upcoming-card";

/**
 * A booked stream as an event — TikTok LIVE's events row was the owner's
 * reference (2026-09-23): no picture, just what it is, who's hosting,
 * the day and the time, and one button. It reads like an invitation
 * rather than a dimmed thumbnail of something that isn't on yet.
 */
export function EventCard({
  item,
  impression = null,
  className,
}: {
  item: RowItem;
  impression?: ImpressionMeta | null;
  className?: string;
}) {
  const ref = useImpression<HTMLDivElement>(impression);
  const name = item.streamerId.displayName || item.streamerId.username;
  const at = item.scheduledStartAt ? new Date(item.scheduledStartAt) : null;

  return (
    <div
      ref={ref}
      className={cn(
        "flex h-full flex-col gap-3 rounded-panel bg-surface p-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-[6px] bg-ember px-1.5 py-0.5 text-[10.5px] font-bold tracking-[0.02em] text-on-ember">Event</span>
        <h3 className="min-w-0 text-[15px] leading-snug font-bold text-foreground">{item.title}</h3>
      </div>

      <Link href={`/c/${item.streamerId.username}`} className="flex w-fit min-w-0 items-center gap-2 hover:opacity-85">
        <UserAvatar src={item.streamerId.avatar} name={name} size={22} className="size-[22px]" />
        <span className="truncate text-[13.5px] font-semibold text-foreground">{name}</span>
        <span className="shrink-0 text-[12.5px] text-muted-foreground">· {item.category}</span>
      </Link>

      {at && (
        <div className="grid gap-1.5 text-[13.5px] text-foreground/80">
          <span className="flex items-center gap-2" suppressHydrationWarning>
            <CalendarBlank size={15} className="text-muted-foreground" aria-hidden />
            {at.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </span>
          <span className="flex items-center gap-2" suppressHydrationWarning>
            <Clock size={15} className="text-muted-foreground" aria-hidden />
            {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      )}

      <div className="mt-auto pt-1">
        <RemindButton streamId={item._id} initial={item.reminded ?? false} size="default" onPicture />
      </div>
    </div>
  );
}
