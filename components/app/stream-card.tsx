import Link from "next/link";
import { Eye, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { type Stream, formatNumber } from "@/lib/categories";
import { RemoteImage } from "@/components/ui/remote-image";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";

/**
 * A stream in the grid. Borderless on purpose — the thumbnail is the card,
 * and the info sits under it as quiet text (the Twitch/YouTube shape). All
 * signal lives in small overlays: LIVE, viewers, duration. Category renders
 * as muted text, not a colored chip — six rainbow chips per row read as
 * noise at grid scale.
 */
export function StreamCard({ stream }: { stream: Stream }) {
  return (
    <Link href={`/stream/${stream.id}`} className="group block">
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden rounded-lg bg-white/[0.03]">
        {stream.thumbnailUrl ? (
          <RemoteImage
            src={stream.thumbnailUrl}
            alt={stream.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            fallback={<StreamPreviewThumb seed={stream.id + stream.title} />}
          />
        ) : (
          <StreamPreviewThumb seed={stream.id + stream.title} />
        )}

        {stream.isLive ? (
          <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-white">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-white" />
            </span>
            LIVE
          </span>
        ) : (
          <span className="absolute top-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-medium text-white/80">
            {stream.duration}
          </span>
        )}

        <span className="absolute right-2 bottom-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[0.65rem] font-medium text-white/90 tabular-nums">
          <Eye size={12} />
          {formatNumber(stream.viewers)}
        </span>
      </div>

      {/* Info */}
      <div className="mt-2.5 flex gap-2.5">
        <UserAvatar
          src={stream.streamer.avatar}
          name={stream.streamer.displayName || stream.streamer.username}
          size={32}
          className="size-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
            {stream.title}
          </h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
            {stream.streamer.displayName}
            {stream.streamer.verified && (
              <SealCheck
                size={12}
                weight="fill"
                className="shrink-0 text-sky-400"
                aria-label="Verified streamer"
              />
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground/60">
            {stream.category}
          </p>
        </div>
      </div>
    </Link>
  );
}
