"use client";

import Link from "next/link";
import { SealCheck, Play, User } from "@/components/icons";
import { type Stream, formatNumber } from "@/lib/categories";
import { useImpression, type ImpressionMeta } from "@/lib/impressions";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";
import { Badge, LiveBadge } from "@/components/ui/badge";

/**
 * A stream in a grid or shelf, at its simplest (owner, 2026-09-23: "just
 * the name of the stream and the streamer — high-tier simplicity"). The
 * thumbnail is the card: LIVE and the viewer count on the picture, nothing
 * else. Under it, the face, the title and who's streaming. No tags, no
 * category, no uptime — the shelf's header already says what kind it is.
 *
 * Two targets, not one: the thumbnail and title open the broadcast, while
 * the avatar, name and category open the channel and the category. Nesting
 * those inside a single card-wide <a> would be invalid HTML and would
 * strand every channel page behind a stream nobody wanted to watch.
 *
 * Variants:
 *  - standard / badges   thumbnail, avatar, title, streamer
 *  - large               same anatomy, bigger type — for the followed-live shelf
 *  - compact             horizontal: thumbnail left, text right — lists and rails
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

      {/* LIVE and who's watching, together in the corner; a finished
          stream shows its length and the peak it reached instead. */}
      <span className="absolute top-2 left-2 flex items-center gap-1">
        {stream.isLive ? <LiveBadge /> : <Badge variant="dark">{stream.duration}</Badge>}
        <Badge variant="glass" icon={<User size={11} weight="fill" />}>
          {stream.isLive ? formatNumber(stream.viewers) : `${formatNumber(stream.peakViewers ?? 0)} peak`}
        </Badge>
      </span>
    </Link>
  );

  const nameLine = (
    <Link
      href={channelHref}
      className="mt-0.5 flex w-fit max-w-full items-center gap-1 truncate text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
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
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("group", className)}>
      {thumb}
      <div className={cn("mt-2 flex items-center gap-2.5", variant === "large" && "mt-2.5")}>
        <Link
          href={channelHref}
          className={cn("flex shrink-0", coHosts.length > 0 && "-space-x-3")}
          aria-label={`${name}'s channel`}
        >
          <UserAvatar
            src={stream.streamer.avatar}
            name={name}
            size={variant === "large" ? 34 : 30}
            className={cn(
              "shrink-0 transition-opacity hover:opacity-80",
              coHosts.length > 0 && "relative z-10 ring-2 ring-background",
              variant === "large" ? "size-[34px]" : "size-[30px]"
            )}
          />
          {coHosts.slice(0, 2).map((g) => (
            <UserAvatar
              key={g.username}
              src={g.avatar}
              name={g.username}
              size={variant === "large" ? 34 : 30}
              className={cn(
                "shrink-0 ring-2 ring-background",
                variant === "large" ? "size-[34px]" : "size-[30px]"
              )}
            />
          ))}
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={streamHref}>
            <h3
              className={cn(
                "truncate font-semibold text-foreground transition-colors group-hover:text-foreground/80",
                variant === "large" ? "text-[15px]" : "text-[14px]"
              )}
            >
              {stream.title}
            </h3>
          </Link>
          {nameLine}
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
