"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import {
  Eye,
  Heart,
  ShareNetwork,
  Flag,
  UserPlus,
  UserMinus,
  Clock,
  CornersOut,
  HandPalm,
} from "@phosphor-icons/react";
import { LiveChat } from "@/components/app/live-chat";
import {
  CATEGORY_COLORS,
  formatNumber,
  type Category,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import type { Room } from "livekit-client";

interface StreamData {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  isLive: boolean;
  viewers: number;
  duration: string;
  startedAt: string;
  livekitRoomName: string;
  streamerId: {
    _id: string;
    username: string;
    displayName: string;
    avatar: string;
    bio?: string;
    followers: number;
    isLive: boolean;
  };
}

export default function StreamPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const router = useRouter();
  const [stream, setStream] = useState<StreamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [elapsed, setElapsed] = useState("0:00");

  // LiveKit
  const roomRef = useRef<Room | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const elapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  // Like & share state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [streamEnded, setStreamEnded] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Fetch stream data
  useEffect(() => {
    async function fetchStream() {
      setLoading(true);
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { stream: StreamData };
        }>(`/api/streams/${id}`);
        setStream(res.data.stream);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load stream"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchStream();
  }, [id]);

  // Check follow status
  useEffect(() => {
    if (!stream?.streamerId?.username || !user) return;
    async function checkFollow() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { user: { isFollowing?: boolean } };
        }>(`/api/user/${stream!.streamerId.username}`);
        setIsFollowing(res.data.user.isFollowing ?? false);
      } catch {
        // ignore
      }
    }
    checkFollow();
  }, [stream?.streamerId?.username, user]);

  // Elapsed timer
  useEffect(() => {
    if (!stream?.isLive || !stream.startedAt) return;
    const updateElapsed = () => {
      const diff = Math.floor(
        (Date.now() - new Date(stream.startedAt).getTime()) / 1000
      );
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(
        h > 0
          ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(
              2,
              "0"
            )}`
          : `${m}:${String(s).padStart(2, "0")}`
      );
    };
    updateElapsed();
    elapsedInterval.current = setInterval(updateElapsed, 1000);
    return () => {
      if (elapsedInterval.current) clearInterval(elapsedInterval.current);
    };
  }, [stream?.isLive, stream?.startedAt]);

  // Connect to LiveKit as viewer
  const connectToStream = useCallback(async () => {
    if (!stream?.isLive || connected) return;

    try {
      const res = await apiFetch<{
        success: boolean;
        data: { token: string; livekitUrl: string };
      }>(`/api/streams/${id}/token`);

      // Dynamic import to avoid SSR issues
      const { Room: LKRoom, RoomEvent, Track } = await import("livekit-client");

      const room = new LKRoom();

      // Handle remote tracks (the streamer's video/audio)
      room.on(
        RoomEvent.TrackSubscribed,
        (track, _publication, participant) => {
          if (!track) return;
          if (track.kind === Track.Kind.Video && videoElRef.current) {
            track.attach(videoElRef.current);
          }
          if (track.kind === Track.Kind.Audio) {
            const audioEl = track.attach();
            audioEl.id = `audio-${participant.identity}`;
            document.body.appendChild(audioEl);
          }
        }
      );

      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track) {
          track.detach().forEach((el) => el.remove());
        }
      });

      room.on(RoomEvent.ParticipantConnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        // Host ended the stream — show modal
        setStreamEnded(true);
      });

      await room.connect(res.data.livekitUrl, res.data.token);
      roomRef.current = room;
      setConnected(true);
      setViewerCount(room.remoteParticipants.size);

      // Attach any already-published tracks
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.track && pub.isSubscribed) {
            if (pub.track.kind === Track.Kind.Video && videoElRef.current) {
              pub.track.attach(videoElRef.current);
            }
            if (pub.track.kind === Track.Kind.Audio) {
              const audioEl = pub.track.attach();
              audioEl.id = `audio-${participant.identity}`;
              document.body.appendChild(audioEl);
            }
          }
        });
      });
    } catch {
      // Stream may have ended or token request failed
    }
  }, [stream?.isLive, id, connected]);

  // Auto-connect when stream loads
  useEffect(() => {
    if (stream?.isLive && !connected) {
      connectToStream();
    }
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
  }, [stream?.isLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track fullscreen exits (e.g. pressing Escape)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Stream-ended countdown & redirect
  useEffect(() => {
    if (!streamEnded) return;
    if (countdown <= 0) {
      router.push("/explore");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [streamEnded, countdown, router]);

  // Follow / unfollow
  const toggleFollow = async () => {
    if (!stream?.streamerId?.username || followLoading) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await apiFetch(`/api/user/${stream.streamerId.username}/follow`, {
          method: "DELETE",
        });
        setIsFollowing(false);
      } else {
        await apiFetch(`/api/user/${stream.streamerId.username}/follow`, {
          method: "POST",
        });
        setIsFollowing(true);
      }
    } catch {
      // ignore
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-foreground">
            Stream not found
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error || "This stream may have ended or doesn't exist."}
          </p>
        </div>
      </div>
    );
  }

  const streamer = stream.streamerId;

  return (
    <div className="min-h-screen p-4 pt-16 md:p-0 md:pt-0">
      <div className="flex flex-col lg:h-screen lg:flex-row">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {/* Video player */}
          <div className="relative aspect-video w-full bg-black" ref={videoContainerRef}>
            <video
              ref={videoElRef}
              autoPlay
              playsInline
              className="size-full object-contain"
            />

            {/* Offline fallback */}
            {!stream.isLive && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center">
                  <p className="text-lg font-semibold text-white/60">
                    Stream Ended
                  </p>
                  <p className="mt-1 text-sm text-white/40">
                    This stream is no longer live
                  </p>
                </div>
              </div>
            )}

            {/* Stream overlay info */}
            <div className="absolute top-4 left-4 flex items-center gap-2">
              {stream.isLive && (
                <div className="flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                  </span>
                  LIVE
                </div>
              )}
              <div className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 backdrop-blur-sm">
                <Eye size={14} />
                {stream.isLive
                  ? `${viewerCount + 1} watching`
                  : `${formatNumber(stream.viewers)} watched`}
              </div>
              {stream.isLive && (
                <div className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs font-mono text-white/80 backdrop-blur-sm">
                  <Clock size={14} />
                  {elapsed}
                </div>
              )}
            </div>

            {/* Fullscreen button */}
            <button
              onClick={() => {
                if (!videoContainerRef.current) return;
                if (!document.fullscreenElement) {
                  videoContainerRef.current.requestFullscreen();
                  setIsFullscreen(true);
                } else {
                  document.exitFullscreen();
                  setIsFullscreen(false);
                }
              }}
              className="absolute bottom-4 right-4 flex size-8 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
              <CornersOut size={18} />
            </button>
          </div>

          {/* Stream info below player */}
          <div className="p-4 md:p-6">
            {/* Title & actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold text-foreground sm:text-xl">
                  {stream.title}
                </h1>
                <span
                  className={cn(
                    "mt-2 inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                    CATEGORY_COLORS[stream.category]
                  )}
                >
                  {stream.category}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => {
                    setLiked(!liked);
                    setLikeCount((c) => (liked ? c - 1 : c + 1));
                  }}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                    liked
                      ? "border-red-500/30 bg-red-500/10 text-red-400"
                      : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Heart size={14} weight={liked ? "fill" : "regular"} />
                  {likeCount > 0 ? likeCount : "Like"}
                </button>
                <button
                  onClick={() => {
                    const url = window.location.href;
                    const text = `Watch ${stream.title} live on Xtreme!`;
                    if (navigator.share) {
                      navigator.share({ title: stream.title, text, url }).catch(() => {});
                    } else {
                      navigator.clipboard?.writeText(url);
                    }
                  }}
                  className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ShareNetwork size={14} />
                  Share
                </button>
                {stream.isLive && (
                  <button
                    onClick={() => {
                      setHandRaised(!handRaised);
                      // Send raise/lower hand via LiveKit data message
                      if (roomRef.current?.localParticipant) {
                        const msg = {
                          type: handRaised ? "guest-lower" : "guest-request",
                          name: user?.displayName || user?.username || "Viewer",
                        };
                        const data = new TextEncoder().encode(JSON.stringify(msg));
                        roomRef.current.localParticipant.publishData(data, { reliable: true });
                      }
                    }}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                      handRaised
                        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-400"
                        : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <HandPalm size={14} weight={handRaised ? "fill" : "regular"} />
                    {handRaised ? "Hand raised" : "Raise hand"}
                  </button>
                )}
                <button className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
                  <Flag size={14} />
                  Report
                </button>
              </div>
            </div>

            {/* Streamer info */}
            <div className="mt-5 flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="flex items-center gap-3">
                <Image
                  src={streamer.avatar}
                  alt={streamer.username}
                  width={44}
                  height={44}
                  className="size-11 rounded-full bg-white/10"
                />
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {streamer.displayName}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(streamer.followers)} followers
                  </p>
                </div>
              </div>
              {user && streamer._id !== user.id && (
                <button
                  onClick={toggleFollow}
                  disabled={followLoading}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-50",
                    isFollowing
                      ? "border border-white/10 bg-white/5 text-muted-foreground hover:border-red-500/30 hover:text-red-400"
                      : "bg-primary text-primary-foreground hover:bg-primary/80"
                  )}
                >
                  {isFollowing ? (
                    <>
                      <UserMinus size={16} />
                      Unfollow
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} />
                      Follow
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Tags */}
            {stream.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {stream.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Chat sidebar */}
        <div className="h-[500px] shrink-0 lg:h-screen lg:w-80 xl:w-96">
          <LiveChat
            streamId={id}
            room={roomRef.current}
            isLive={stream.isLive}
          />
        </div>
      </div>

      {/* Stream ended modal */}
      {streamEnded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-background p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-500/10">
              <Eye size={28} className="text-red-400" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              Stream Has Ended
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              The host has ended this livestream.
            </p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Redirecting to Explore in{" "}
              <span className="font-semibold text-foreground">
                {countdown}s
              </span>
            </p>
            <button
              onClick={() => router.push("/explore")}
              className="mt-6 h-10 w-full rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Go to Explore Now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
