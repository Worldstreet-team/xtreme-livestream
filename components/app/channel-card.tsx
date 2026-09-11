"use client";

import Link from "next/link";
import { SealCheck, Users } from "@phosphor-icons/react";
import { formatNumber } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { FollowButton } from "@/components/app/follow-button";

export interface ChannelCardData {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  followers: number;
  verified?: boolean;
  isLive: boolean;
  /** What they're streaming right now, if live. */
  liveTitle?: string | null;
  liveViewers?: number | null;
  isFollowing?: boolean;
}

/**
 * A channel as a unit — the card for search results, Following's offline
 * roster and "channels" rows. Big avatar with a live ring, name, one line of
 * context (what they're streaming, or their bio), followers, and a follow
 * button. Half of live viewing is repeat viewing of known channels, so the
 * channel deserves its own card rather than only appearing as a byline.
 */
export function ChannelCard({
  channel,
  className,
}: {
  channel: ChannelCardData;
  className?: string;
}) {
  const name = channel.displayName || channel.username;
  const href = `/c/${channel.username}`;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-sm border border-white/[0.06] p-3 transition-colors hover:bg-white/[0.04]",
        className
      )}
    >
      <Link href={href} className="relative shrink-0" aria-label={`${name}'s channel`}>
        <UserAvatar
          src={channel.avatar}
          name={name}
          size={44}
          className={cn(
            "size-11 ring-2 transition-opacity hover:opacity-85",
            channel.isLive ? "ring-red-600" : "ring-white/[0.08]"
          )}
        />
        {channel.isLive && (
          <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-red-500 ring-2 ring-background" />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="flex items-center gap-1 truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
        >
          <span className="truncate">{name}</span>
          {channel.verified && (
            <SealCheck size={12} weight="fill" className="shrink-0 text-sky-400" aria-label="Verified streamer" />
          )}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
          {channel.isLive && channel.liveTitle ? (
            <>
              <span className="font-medium text-red-400">Live</span>
              <span className="text-muted-foreground/50"> · </span>
              {channel.liveTitle}
            </>
          ) : (
            channel.bio || `@${channel.username}`
          )}
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[0.68rem] text-muted-foreground/60 tabular-nums">
          <Users size={11} />
          {formatNumber(channel.followers)} followers
          {channel.isLive && channel.liveViewers != null && (
            <>
              <span className="text-muted-foreground/40">·</span>
              {formatNumber(channel.liveViewers)} watching
            </>
          )}
        </p>
      </div>

      <FollowButton
        username={channel.username}
        initialFollowing={channel.isFollowing ?? false}
        size="sm"
      />
    </div>
  );
}
