"use client";

import { useEffect, useRef } from "react";
import { MicrophoneSlash } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * The minimal surface of a LiveKit video track the stage UI needs.
 * `detach` mirrors LiveKit's overloads: no argument releases every attached
 * element, an argument releases just that one.
 */
export interface AttachableVideoTrack {
  attach: (el: HTMLVideoElement) => unknown;
  detach: {
    (): unknown;
    (el: HTMLVideoElement): unknown;
  };
}

/**
 * One face on the stage — a guest's video, or your own local preview while
 * broadcasting. Two modes: a small corner tile, or (`fill`) a cell in the
 * split-screen grid the player becomes once guests join. The track object
 * lives in the parent's ref; the tile owns nothing but the element it
 * renders into.
 */
export function StageTile({
  track,
  label,
  self = false,
  micOn = true,
  fill = false,
}: {
  track: AttachableVideoTrack | undefined;
  label: string;
  self?: boolean;
  micOn?: boolean;
  /** Fill the parent cell (split-screen grid) instead of a small corner tile. */
  fill?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-black",
        fill
          ? "size-full"
          : "aspect-video rounded-lg shadow-lg"
      )}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        // My own preview is muted (echo) and mirrored (a mirror is what
        // people expect to see of themselves).
        muted={self}
        className={cn("size-full object-cover", self && "-scale-x-100")}
      />
      <div
        className={cn(
          "absolute flex items-center gap-1",
          fill
            ? "bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-black/60 px-2 py-1 backdrop-blur-sm"
            : "right-1 bottom-0.5 left-1"
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-medium text-white",
            fill ? "text-xs" : "text-[0.6rem] drop-shadow"
          )}
        >
          {label}
        </span>
        {self && !micOn && (
          <MicrophoneSlash
            size={fill ? 12 : 10}
            className="shrink-0 text-red-400"
          />
        )}
      </div>
    </div>
  );
}
