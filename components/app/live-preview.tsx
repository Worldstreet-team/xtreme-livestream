"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Room, RoomEvent, Track, type RemoteTrack } from "livekit-client";
import { apiFetch } from "@/lib/api-client";
import { useDataMode } from "@/lib/data-mode";
import { cn } from "@/lib/utils";

/**
 * A muted, silent look at a live broadcast, for heroes and channel pages.
 *
 * "The best way to figure out whether you want to watch a stream is to see
 * the stream" — Twitch's stated reason for preroll-free previews. This joins
 * the room as a guest in preview mode (no join announcement, no watch
 * session) and shows the broadcaster's video with the sound off. One
 * preview at a time: opening another disconnects the last, so a page never
 * holds several live connections. With Data saver on it stays a still
 * picture: no room, no clip — nothing downloads but the poster.
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
  const saving = useDataMode() === "saver";

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
    if (!enabled || saving) return;
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
  }, [streamId, enabled, saving]);

  return (
    <div className={cn("relative overflow-hidden bg-black", className)}>
      <div className={cn("absolute inset-0 transition-opacity duration-500", showing || fallbackPlaying ? "opacity-0" : "opacity-100")}>
        {poster}
      </div>
      {fallbackSrc && !saving && (
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

/**
 * Every camera in a room at once, for a 2v2's other side — their host and
 * their partner — over one connection, keeping LivePreview's one-preview
 * rule. Tracks come back keyed by who publishes them; with Data saver on,
 * nothing connects.
 */
export function useRoomPreview(streamId: string | null, enabled = true) {
  // Kept with the room they came from, so another room never shows the last one's.
  const [seen, setSeen] = useState<{ streamId: string; tracks: ReadonlyMap<string, RemoteTrack> } | null>(null);
  const saving = useDataMode() === "saver";

  useEffect(() => {
    if (!streamId || !enabled || saving) return;
    let cancelled = false;
    let room: Room | null = null;
    const sync = () => {
      if (cancelled || !room) return;
      const next = new Map<string, RemoteTrack>();
      for (const p of room.remoteParticipants.values()) {
        const pubs = [...p.videoTrackPublications.values()].filter((pub) => pub.track);
        // Someone sending a camera and a screen: the camera is the face.
        const pub = pubs.find((x) => x.source === Track.Source.Camera) ?? pubs[0];
        if (pub?.track) next.set(p.identity, pub.track);
      }
      setSeen({ streamId, tracks: next });
    };

    async function start() {
      try {
        const res = await apiFetch<{ success: boolean; data: { token: string; livekitUrl: string } }>(`/api/streams/${streamId}/token?preview=true`);
        if (cancelled) return;
        room = new Room({ adaptiveStream: true, dynacast: true });
        if (active && active !== room) void active.disconnect().catch(() => {});
        active = room;
        room.on(RoomEvent.TrackSubscribed, sync).on(RoomEvent.TrackUnsubscribed, sync).on(RoomEvent.ParticipantDisconnected, sync);
        await room.connect(res.data.livekitUrl, res.data.token);
        sync();
      } catch {
        // Empty tiles; a preview that fails is just a dark square.
      }
    }
    void start();

    return () => {
      cancelled = true;
      if (room) {
        if (active === room) active = null;
        void room.disconnect().catch(() => {});
      }
    };
  }, [streamId, enabled, saving]);

  return streamId && enabled && !saving && seen?.streamId === streamId ? seen.tracks : EMPTY_TRACKS;
}

const EMPTY_TRACKS: ReadonlyMap<string, RemoteTrack> = new Map();

/** Which of a room's cameras is its host's: their browser, their encoder, or whoever else isn't the partner. */
export function hostTrackOf(tracks: ReadonlyMap<string, RemoteTrack>, host: { userId: string }, partnerId?: string | null) {
  const own = tracks.get(host.userId) ?? tracks.get(`obs-${host.userId}`);
  if (own) return own;
  for (const [identity, track] of tracks) if (identity !== partnerId && !identity.startsWith("mon-")) return track;
  return undefined;
}

/** One camera from useRoomPreview, muted, filling its tile. */
export function PreviewVideo({ track, className }: { track: RemoteTrack | undefined; className?: string }) {
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
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      aria-hidden
      className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", track ? "opacity-100" : "opacity-0", className)}
    />
  );
}
