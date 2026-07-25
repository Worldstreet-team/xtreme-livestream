import Link from "next/link";
import { Eye, SealCheck } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { type Stream, CATEGORY_COLORS, formatNumber } from "@/lib/categories";
import { RemoteImage } from "@/components/ui/remote-image";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";

export function StreamCard({ stream }: { stream: Stream }) {
  return (
    <Link href={`/stream/${stream.id}`}>
      <article className="group cursor-pointer overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-all hover:border-white/10 hover:bg-white/[0.04]">
        {/* Thumbnail */}
        <div className="relative aspect-video overflow-hidden">
          {stream.thumbnailUrl ? (
            <RemoteImage
              src={stream.thumbnailUrl}
              alt={stream.title}
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              fallback={<StreamPreviewThumb seed={stream.id + stream.title} />}
            />
          ) : (
            <StreamPreviewThumb seed={stream.id + stream.title} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />

          {/* Live badge */}
          {stream.isLive && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
              </span>
              LIVE
            </div>
          )}

          {/* Duration for past streams */}
          {!stream.isLive && (
            <div className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white/80 backdrop-blur-sm">
              {stream.duration}
            </div>
          )}

          {/* Viewers */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
            <Eye size={14} />
            {formatNumber(stream.viewers)}
          </div>
        </div>

        {/* Info */}
        <div className="flex gap-3 p-3">
          <UserAvatar
            src={stream.streamer.avatar}
            name={stream.streamer.displayName || stream.streamer.username}
            size={36}
            className="size-9"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {stream.title}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              {stream.streamer.displayName}
              {stream.streamer.verified && (
                <SealCheck
                  size={13}
                  weight="fill"
                  className="shrink-0 text-sky-400"
                  aria-label="Verified streamer"
                />
              )}
            </p>
            <span
              className={cn(
                "mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[0.65rem] font-medium",
                CATEGORY_COLORS[stream.category]
              )}
            >
              {stream.category}
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
