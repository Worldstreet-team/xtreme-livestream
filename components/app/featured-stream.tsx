"use client";

import Link from "next/link";
import { Eye, SealCheck, Play } from "@phosphor-icons/react";
import { RemoteImage } from "@/components/ui/remote-image";
import { UserAvatar } from "@/components/ui/user-avatar";
import { StreamPreviewThumb } from "@/components/app/stream-preview-thumb";
import { type Stream, formatNumber } from "@/lib/categories";

/**
 * The one broadcast the page leads with.
 *
 * A grid of equal thumbnails gives a newcomer nowhere to start — every card
 * argues for itself equally, so none of them wins. One stream at hero scale
 * makes the first click obvious, which is the whole job of a front page.
 * Shown only on the unfiltered view: once someone searches or picks a
 * category they have already chosen what they came for, and promoting one
 * result over their own filter is just noise.
 */
export function FeaturedStream({ stream }: { stream: Stream }) {
  const name = stream.streamer.displayName || stream.streamer.username;

  return (
    <div className="relative mb-10 overflow-hidden rounded-sm bg-white/[0.03]">
      <Link
        href={`/stream/${stream.id}`}
        className="group block aspect-[16/7] sm:aspect-[16/6] lg:aspect-[16/5]"
      >
        {stream.thumbnailUrl ? (
          <RemoteImage
            src={stream.thumbnailUrl}
            alt={stream.title}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            fallback={<StreamPreviewThumb seed={stream.id + stream.title} />}
          />
        ) : (
          <StreamPreviewThumb seed={stream.id + stream.title} />
        )}

        {/* Legibility floor. Heavier at the bottom, where the text sits. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

        <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded bg-red-600 px-2 py-1 text-[0.65rem] font-semibold tracking-wide text-white">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-white" />
          </span>
          LIVE
        </span>

        <span className="absolute top-3 right-3 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-[0.65rem] font-medium text-white/90 tabular-nums">
          <Eye size={12} />
          {formatNumber(stream.viewers)}
        </span>

        {/* Play affordance — the hero is one big target, so say so. */}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex size-14 items-center justify-center rounded-full bg-white/15">
            <Play size={22} weight="fill" className="ml-0.5 text-white" />
          </span>
        </span>
      </Link>

      {/* Sits on top of the image, but outside the <a> so the channel link
          inside it stays its own target. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 md:p-6">
        <div className="pointer-events-auto flex items-end gap-3">
          <Link href={`/c/${stream.streamer.username}`} className="shrink-0">
            <UserAvatar
              src={stream.streamer.avatar}
              name={name}
              size={44}
              className="size-11 ring-2 ring-white/20 transition-opacity hover:opacity-85"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <Link href={`/stream/${stream.id}`}>
              <h2 className="truncate text-base font-semibold text-white md:text-xl">
                {stream.title}
              </h2>
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-white/75 md:text-sm">
              <Link
                href={`/c/${stream.streamer.username}`}
                className="flex items-center gap-1 font-medium text-white/90 transition-colors hover:text-white"
              >
                {name}
                {stream.streamer.verified && (
                  <SealCheck
                    size={13}
                    weight="fill"
                    className="shrink-0 text-sky-400"
                    aria-label="Verified streamer"
                  />
                )}
              </Link>
              <span className="text-white/40">•</span>
              <Link
                href={`/explore?category=${encodeURIComponent(stream.category)}`}
                className="transition-colors hover:text-white"
              >
                {stream.category}
              </Link>
            </div>
          </div>

          <Link
            href={`/stream/${stream.id}`}
            className="hidden h-9 shrink-0 items-center gap-2 rounded-sm bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 sm:flex"
          >
            <Play size={14} weight="fill" />
            Watch
          </Link>
        </div>
      </div>
    </div>
  );
}
