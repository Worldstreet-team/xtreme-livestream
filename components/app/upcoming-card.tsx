"use client";

import Link from "next/link";
import { useState } from "react";
import { Clock, BellRinging, Bell, SealCheck } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatStartsIn, type RowItem } from "@/lib/discovery";
import { useImpression, type ImpressionMeta } from "@/lib/impressions";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamArt } from "@/components/app/stream-art";

const SIGN_IN_URL = "https://www.worldstreetgold.com/login";

/**
 * A scheduled stream. Nothing here should look watchable now: the art is
 * dimmed, the badge is a clock, and the one action is "remind me". Live
 * inventory evaporates hourly — this is the card that lets a small
 * streamer build an audience *before* going live rather than needing one
 * to get one.
 */
export function UpcomingCard({
  item,
  impression = null,
  className,
}: {
  item: RowItem;
  impression?: ImpressionMeta | null;
  className?: string;
}) {
  const ref = useImpression<HTMLDivElement>(impression);
  const now = useNow(true);
  const name = item.streamerId.displayName || item.streamerId.username;
  const channelHref = `/c/${item.streamerId.username}`;
  const startsIn = item.scheduledStartAt
    ? formatStartsIn(item.scheduledStartAt, now)
    : "";

  return (
    <div ref={ref} className={cn("group", className)}>
      <Link
        href={channelHref}
        className="relative block aspect-video overflow-hidden rounded-sm bg-white/[0.03]"
      >
        <div className="absolute inset-0 opacity-60 grayscale-[35%] transition-opacity group-hover:opacity-75">
          <StreamArt src={item.thumbnailUrl} category={item.category} alt={item.title} seed={item._id + item.title} />
        </div>
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-medium text-white/90">
          <Clock size={11} weight="bold" />
          {startsIn}
        </span>
      </Link>

      <div className="mt-2.5 flex gap-2.5">
        <Link href={channelHref} className="shrink-0" aria-label={`${name}'s channel`}>
          <UserAvatar
            src={item.streamerId.avatar}
            name={name}
            size={32}
            className="size-8 shrink-0 transition-opacity hover:opacity-80"
          />
        </Link>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground">
            {item.title}
          </h3>
          <Link
            href={channelHref}
            className="mt-0.5 flex w-fit max-w-full items-center gap-1 truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">{name}</span>
            {item.streamerId.verified && (
              <SealCheck size={12} weight="fill" className="shrink-0 text-sky-400" aria-label="Verified streamer" />
            )}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground/60">
            {item.category}
          </p>
        </div>
        <RemindButton streamId={item._id} initial={item.reminded ?? false} />
      </div>
    </div>
  );
}

/**
 * Toggle a reminder. Optimistic, rolls back on failure, and sends a
 * signed-out visitor to sign-in — wanting to be told when someone goes live
 * is about the best reason there is to make an account.
 */
export function RemindButton({
  streamId,
  initial,
  size = "sm",
  className,
}: {
  streamId: string;
  initial: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const { isAuthenticated } = useAuth();
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (!isAuthenticated) {
      window.location.href = SIGN_IN_URL;
      return;
    }
    if (pending) return;
    const next = !on;
    setOn(next);
    setPending(true);
    try {
      await apiFetch(`/api/streams/${streamId}/remind`, {
        method: next ? "POST" : "DELETE",
      });
    } catch {
      setOn(!next);
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      title={on ? "Reminder set" : "Remind me when this starts"}
      className={cn(
        "flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium transition-colors disabled:opacity-60",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-4 text-sm",
        on
          ? "bg-primary/15 text-primary"
          : "bg-white/[0.06] text-foreground hover:bg-white/[0.09]",
        className
      )}
    >
      {on ? <BellRinging size={13} weight="fill" /> : <Bell size={13} />}
      {on ? "Reminding" : "Remind me"}
    </button>
  );
}
