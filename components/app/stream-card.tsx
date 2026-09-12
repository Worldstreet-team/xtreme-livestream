"use client";

import Link from "next/link";
import { Eye, SealCheck, Play } from "@phosphor-icons/react";
import { type Stream, formatNumber } from "@/lib/categories";
import { formatUptime } from "@/lib/discovery";
import { useImpression, type ImpressionMeta } from "@/lib/impressions";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";
import { Badge, LiveBadge } from "@/components/ui/badge";

/**
 * A stream in a grid or shelf. Borderless on purpose — the thumbnail is the
 * card, and the info sits under it as quiet text. All signal lives in small
 * overlays: LIVE, viewers, uptime. Category renders as muted text, not a
 * coloured chip — six rainbow chips per row read as noise at grid scale.
 *
 * Two targets, not one: the thumbnail and title open the broadcast, while
 * the avatar, name and category open the channel and the category. Nesting
 * those inside a single card-wide <a> would be invalid HTML and would
 * strand every channel page behind a stream nobody wanted to watch.
 *
 * Variants:
 *  - standard   thumbnail, avatar, three text lines
 *  - badges     adds uptime and a category chip on the image
 *  - large      same anatomy, bigger type — for the followed-live shelf
 *  - compact    horizontal: thumbnail left, text right — lists and rails
 */

export type StreamCardVariant = "standard" | "badges" | "large" | "compact";

export function StreamCard({
  stream,
  variant = "standard",
  showFollow = false,
  impression = null,
  className,
}: {
  stream: Stream;
  variant?: StreamCardVariant;
  /** Inline follow button — raises follow rate, adds a third target. */
  showFollow?: boolean;
  /** Where this card is being shown; logs once when half of it is seen for a second. */
  impression?: ImpressionMeta | null;
  className?: string;
}) {
  const ref = useImpression<HTMLDivElement>(impression);
  const badges = variant === "badges" || variant === "large";
  // Only badge variants tick; a plain grid of forty cards has no reason to
  // re-render every second.
  const now = useNow(badges && stream.isLive);
  const uptime = badges && stream.isLive ? formatUptime(stream.startedAt, now) : "";

  const name = stream.streamer.displayName || stream.streamer.username;
  // A shared stage reads as overlapping faces and "Host with Guest".
  const coHosts = stream.liveGuests ?? [];
  const streamHref = `/stream/${stream.id}`;
  const channelHref = `/c/${stream.streamer.username}`;

  const thumb = (
    <Link
      href={streamHref}
      className="group/thumb relative block aspect-video overflow-hidden rounded-sm bg-white/[0.03]"
    >
      <StreamArt
        src={stream.thumbnailUrl}
        category={stream.category}
        alt={stream.title}
        seed={stream.id + stream.title}
        imgClassName="transition-transform duration-300 group-hover/thumb:scale-[1.03]"
        lazy
      />

      {/* Preview affordance: the whole thumbnail is one target, and on
          hover it says so. Preview-before-commit is what Twitch's mobile
          feed is built on; on the web a play mark is the honest version
          until we can afford a muted stream per card. */}
      {stream.isLive && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/thumb:opacity-100">
          <span className="flex size-10 items-center justify-center rounded-full bg-black/55">
            <Play size={16} weight="fill" className="ml-0.5 text-white" />
          </span>
        </span>
      )}

      <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
        {stream.isLive ? <LiveBadge /> : <Badge variant="dark">{stream.duration}</Badge>}
        {uptime && <Badge variant="glass">{uptime}</Badge>}
      </span>

      {badges && (
        <Badge variant="dark" className="absolute bottom-2.5 left-2.5 max-w-[55%]">
          <span className="truncate">{stream.category}</span>
        </Badge>
      )}

      {/* Live streams show who's watching; finished ones show the peak they
          reached, since their live count is always 0. */}
      <Badge variant="glass" icon={<Eye size={12} weight="bold" />} className="absolute right-2.5 bottom-2.5">
        {stream.isLive
          ? formatNumber(stream.viewers)
          : `${formatNumber(stream.peakViewers ?? 0)} peak`}
      </Badge>
    </Link>
  );

  const nameLine = (
    <Link
      href={channelHref}
      className="mt-0.5 flex w-fit max-w-full items-center gap-1 truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="truncate">
        {name}
        {coHosts.length > 0 && (
          <span className="text-muted-foreground/80">
            {" "}with {coHosts[0]!.username}
            {coHosts.length > 1 && ` +${coHosts.length - 1}`}
          </span>
        )}
      </span>
      {stream.streamer.verified && (
        <SealCheck
          size={12}
          weight="fill"
          className="shrink-0 text-sky-400"
          aria-label="Verified streamer"
        />
      )}
    </Link>
  );

  if (variant === "compact") {
    return (
      <div ref={ref} className={cn("group flex gap-3", className)}>
        <div className="w-[42%] shrink-0">{thumb}</div>
        <div className="min-w-0 flex-1 py-0.5">
          <Link href={streamHref}>
            <h3 className="line-clamp-2 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-primary">
              {stream.title}
            </h3>
          </Link>
          {nameLine}
          <Link
            href={`/browse?category=${encodeURIComponent(stream.category)}`}
            className="mt-0.5 block w-fit truncate text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            {stream.category}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("group", className)}>
      {thumb}
      <div className={cn("mt-2.5 flex gap-2.5", variant === "large" && "mt-3")}>
        <Link
          href={channelHref}
          className={cn("flex shrink-0", coHosts.length > 0 && "-space-x-3")}
          aria-label={`${name}'s channel`}
        >
          <UserAvatar
            src={stream.streamer.avatar}
            name={name}
            size={variant === "large" ? 36 : 32}
            className={cn(
              "shrink-0 transition-opacity hover:opacity-80",
              coHosts.length > 0 && "relative z-10 ring-2 ring-background",
              variant === "large" ? "size-9" : "size-8"
            )}
          />
          {coHosts.slice(0, 2).map((g) => (
            <UserAvatar
              key={g.username}
              src={g.avatar}
              name={g.username}
              size={variant === "large" ? 36 : 32}
              className={cn(
                "shrink-0 ring-2 ring-background",
                variant === "large" ? "size-9" : "size-8"
              )}
            />
          ))}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={streamHref}>
            <h3
              className={cn(
                "truncate font-medium text-foreground transition-colors group-hover:text-primary",
                variant === "large" ? "text-[15px]" : "text-sm"
              )}
            >
              {stream.title}
            </h3>
          </Link>
          {nameLine}
          {!badges && (
            <Link
              href={`/browse?category=${encodeURIComponent(stream.category)}`}
              className="mt-0.5 block w-fit truncate text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            >
              {stream.category}
            </Link>
          )}
          {/* Tags the way Twitch's feed wears them: small solid chips under
              the text, three at most, so a row scans as a row. */}
          {stream.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {stream.tags.slice(0, 3).map((tag) => (
                <Link
                  key={tag}
                  href={`/explore?search=${encodeURIComponent(tag)}`}
                  className="rounded-[4px] bg-white/[0.08] px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/80 transition-colors hover:bg-white/[0.14] hover:text-foreground"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}
        </div>
        {showFollow && (
          <FollowButton
            username={stream.streamer.username}
            initialFollowing={false}
            size="sm"
            className="mt-0.5"
          />
        )}
      </div>
    </div>
  );
}
