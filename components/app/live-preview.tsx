"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * A muted, silent look at a live broadcast, for heroes and channel pages.
 *
 * "The best way to figure out whether you want to watch a stream is to see
 * the stream" — Twitch's stated reason for preroll-free previews. This joins
 * the room as a guest in preview mode (no join announcement, no watch
 * session) and shows the broadcaster's video with the sound off. One
 * preview at a time: opening another disconnects the last, so a page never
 * holds several live connections.
 */

let active: Room | null = null;

export function LivePreview({
  streamId,
  poster,
  className,
  enabled = true,
  fallbackSrc,
}: {
  streamId: string;
  /** Rendered until the first frame arrives, and if the connection fails. */
  poster: ReactNode;
  className?: string;
  enabled?: boolean;
  /**
   * A looping clip to play when the room has no video to give us — the
   * seeded streams in development, or a broadcaster between encoder
   * reconnects. A real track always takes over the moment it arrives.
   */
  fallbackSrc?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fallbackRef = useRef<HTMLVideoElement>(null);
  const [showing, setShowing] = useState(false);
  const [fallbackPlaying, setFallbackPlaying] = useState(false);

  // The clip plays until a live track shows up, then it stops so two
  // videos never decode at once.
  useEffect(() => {
    const el = fallbackRef.current;
    if (!el || !fallbackSrc) return;
    if (showing) {
      el.pause();
      return;
    }
    const onPlaying = () => setFallbackPlaying(true);
    el.addEventListener("playing", onPlaying);
    void el.play().catch(() => {});
    return () => el.removeEventListener("playing", onPlaying);
  }, [fallbackSrc, showing]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let room: Room | null = null;
    let attached: RemoteTrack | null = null;
    // Pinned now: by cleanup time the ref may point at a different node.
    const videoEl = videoRef.current;

    async function start() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { token: string; livekitUrl: string };
        }>(`/api/streams/${streamId}/token?preview=true`);
        if (cancelled) return;

        room = new Room({ adaptiveStream: true, dynacast: true });
        if (active && active !== room) {
          void active.disconnect().catch(() => {});
        }
        active = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind !== Track.Kind.Video || attached || !videoEl) return;
          attached = track;
          track.attach(videoEl);
          setShowing(true);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          if (track === attached) {
            track.detach();
            attached = null;
            setShowing(false);
          }
        });

        await room.connect(res.data.livekitUrl, res.data.token);
      } catch {
        // Poster stays; a preview that fails is just a thumbnail.
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (attached && videoEl) attached.detach(videoEl);
      if (room) {
        if (active === room) active = null;
        void room.disconnect().catch(() => {});
      }
    };
  }, [streamId, enabled]);

  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      <div className={cn("absolute inset-0 transition-opacity duration-500", showing || fallbackPlaying ? "opacity-0" : "opacity-100")}>
        {poster}
      </div>
      {fallbackSrc && (
        <video
          ref={fallbackRef}
          src={fallbackSrc}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-500",
            fallbackPlaying && !showing ? "opacity-100" : "opacity-0"
          )}
        />
      )}
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        aria-hidden={!showing}
        className={cn(
          "absolute inset-0 size-full object-cover transition-opacity duration-500",
          showing ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}
