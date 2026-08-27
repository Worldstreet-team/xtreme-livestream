"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Eye,
  Heart,
  ShareNetwork,
  Flag,
  UserPlus,
  UserMinus,
  Clock,
  CornersOut,
  X,
} from "@phosphor-icons/react";
import { LiveChat } from "@/components/app/live-chat";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  CATEGORY_COLORS,
  formatNumber,
  type Category,
} from "@/lib/categories";
import { cn } from "@/lib/utils";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api-client";
import type { Room } from "livekit-client";

const REPORT_REASONS: Array<{ value: string; label: string }> = [
  { value: "spam", label: "Spam or misleading" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "violence", label: "Violence or dangerous acts" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "scam_or_fraud", label: "Scam or fraud" },
  { value: "copyright", label: "Copyright violation" },
  { value: "other", label: "Other" },
];

interface StreamData {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  isLive: boolean;
  /** Current concurrent viewers — 0 once a stream has ended. */
  viewers: number;
  peakViewers?: number;
  likes?: number;
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
  /** Why the last follow/unfollow was refused, shown next to the button. */
  const [followError, setFollowError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState("0:00");

  // LiveKit
  const roomRef = useRef<Room | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const [connected, setConnected] = useState(false);
  // Joined-the-room and actually-receiving-video are different things: an
  // OBS stream is flagged live the moment the key is issued, long before the
  // encoder pushes. Track them apart so the player can say which it is.
  const [hasVideo, setHasVideo] = useState(false);
  const videoTrackRef = useRef<{ attach: (el: HTMLVideoElement) => void } | null>(
    null,
  );
  /**
   * Concurrent watchers, derived from the room roster.
   *
   * `remoteParticipants` is everyone *except* me — i.e. the broadcaster plus
   * the other viewers. Swapping the broadcaster out for myself leaves the
   * count unchanged, so `remoteParticipants.size` *is* the watcher count.
   * It previously rendered as `viewerCount + 1`, which counted the
   * broadcaster as a viewer and read one higher than both the studio and the
   * server-side count (`participants - 1`, see the LiveKit webhook).
   */
  const [viewerCount, setViewerCount] = useState(0);
  const elapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  /** Set when joining the room fails, so the player doesn't just sit black. */
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  // Like & share state
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeBusy, setLikeBusy] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamEnded, setStreamEnded] = useState(false);
  const [countdown, setCountdown] = useState(3);

  // Report modal state
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<string>("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Auto-hide video controls after mouse inactivity
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    showControls();
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [showControls]);

  // Fetch stream data
  const fetchStream = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (!opts.quiet) setLoading(true);
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { stream: StreamData };
        }>(`/api/streams/${id}`);
        setStream(res.data.stream);
        setLikeCount(res.data.stream.likes ?? 0);
      } catch (err) {
        if (!opts.quiet) {
          setError(err instanceof Error ? err.message : "Failed to load stream");
        }
      } finally {
        if (!opts.quiet) setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void fetchStream();
  }, [fetchStream]);

  // Quiet re-checks in BOTH directions: a stream that starts after the page
  // opened appears without a refresh, and a stream that ends while the page
  // sits on "waiting for the broadcaster" flips to the ended state instead
  // of spinning forever.
  useEffect(() => {
    if (loading) return;
    const poll = setInterval(() => void fetchStream({ quiet: true }), 10_000);
    return () => clearInterval(poll);
  }, [loading, fetchStream]);

  useEffect(() => {
    if (stream && !stream.isLive) setStreamEnded(true);
  }, [stream]);

  // Check follow status
  useEffect(() => {
    if (!stream?.streamerId?.username || !user) return;
    async function checkFollow() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { isFollowing?: boolean };
        }>(`/api/user/${stream!.streamerId.username}`);
        setIsFollowing(res.data.isFollowing ?? false);
      } catch (err) {
        // Don't swallow this. If the status lookup fails the button renders
        // "Follow" regardless of reality, and the follow request that follows
        // is then rejected as a duplicate — which is exactly how the button
        // ends up looking dead.
        console.error("[Follow] status check failed:", err);
      }
    }
    checkFollow();
  }, [stream?.streamerId?.username, user]);

  // Load whether the current user already liked this stream
  useEffect(() => {
    if (!user) return;
    async function checkLiked() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { likes: number; liked: boolean };
        }>(`/api/streams/${id}/like`);
        setLikeCount(res.data.likes);
        setLiked(res.data.liked);
      } catch {
        // Endpoint unavailable — keep local-only state
      }
    }
    checkLiked();
  }, [id, user]);

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
          if (track.kind === Track.Kind.Video) {
            videoTrackRef.current = track;
            setHasVideo(true);
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
          if (track.kind === Track.Kind.Video) {
            videoTrackRef.current = null;
            setHasVideo(false);
          }
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
        setHasVideo(false);
        videoTrackRef.current = null;
        // Host ended the stream — sync UI state and show modal
        setStream((prev) => (prev ? { ...prev, isLive: false } : prev));
        setStreamEnded(true);
      });

      // Real-time engagement events (likes) broadcast by other viewers.
      // Chat messages are handled inside LiveChat; events carry `__evt`.
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as {
            __evt?: string;
            delta?: number;
          };
          if (data.__evt === "like" && typeof data.delta === "number") {
            setLikeCount((c) => Math.max(0, c + Math.sign(data.delta!)));
          }
        } catch {
          // Not an event payload
        }
      });

      await room.connect(res.data.livekitUrl, res.data.token);
      roomRef.current = room;
      setConnected(true);
      setViewerCount(room.remoteParticipants.size);

      // Attach any already-published tracks
      room.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          if (pub.track && pub.isSubscribed) {
            if (pub.track.kind === Track.Kind.Video) {
              videoTrackRef.current = pub.track;
              setHasVideo(true);
            }
            if (pub.track.kind === Track.Kind.Audio) {
              const audioEl = pub.track.attach();
              audioEl.id = `audio-${participant.identity}`;
              document.body.appendChild(audioEl);
            }
          }
        });
      });
      setPlaybackError(null);
    } catch (err) {
      // Swallowing this is what produced the worst failure mode on this page:
      // a stale stream still flagged live rendered the LIVE badge and a ticking
      // timer over a permanently black player, with no indication anything had
      // gone wrong. Surface it instead.
      console.error("[Stream] Failed to join the LiveKit room:", err);
      setPlaybackError(
        err instanceof ApiError && err.status === 400
          ? "This stream has ended."
          : "Couldn't connect to this stream. It may have ended."
      );
    }
  }, [stream?.isLive, id, connected]);

  // Attach the video track whenever BOTH it and the element exist. The old
  // code attached inside the subscribe callback against a ref that could
  // still be null (the element only renders after `stream` resolves), which
  // lost the track for good and left a permanently black player.
  useEffect(() => {
    if (hasVideo && videoTrackRef.current && videoElRef.current) {
      videoTrackRef.current.attach(videoElRef.current);
    }
  }, [hasVideo, connected]);

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

  /** Apply a follow outcome: the button state, plus the follower tally. */
  const syncFollow = (following: boolean, delta: number) => {
    setIsFollowing(following);
    if (delta === 0) return;
    setStream((prev) =>
      prev
        ? {
            ...prev,
            streamerId: {
              ...prev.streamerId,
              followers: Math.max(0, prev.streamerId.followers + delta),
            },
          }
        : prev
    );
  };

  // Follow / unfollow
  const toggleFollow = async () => {
    const username = stream?.streamerId?.username;
    if (!username || followLoading) return;

    const wasFollowing = isFollowing;
    setFollowLoading(true);
    setFollowError(null);

    try {
      await apiFetch(`/api/user/${username}/follow`, {
        method: wasFollowing ? "DELETE" : "POST",
      });
      syncFollow(!wasFollowing, wasFollowing ? -1 : 1);
    } catch (err) {
      const code =
        err instanceof ApiError &&
        err.data &&
        typeof err.data === "object" &&
        "code" in err.data
          ? (err.data as { code?: string }).code
          : undefined;

      // ALREADY_FOLLOWING and NOT_FOLLOWING don't mean the action failed —
      // they mean our local state was stale, and the server is already in the
      // state the user was asking for. Previously both were swallowed into a
      // console log, so the button sat there looking broken however many
      // times you pressed it. Adopt the server's answer instead; the tally
      // doesn't move because it already accounts for us.
      if (code === "ALREADY_FOLLOWING") {
        syncFollow(true, 0);
      } else if (code === "NOT_FOLLOWING") {
        syncFollow(false, 0);
      } else {
        console.error("[Follow] toggle failed:", err);
        setFollowError(
          err instanceof Error ? err.message : "Couldn't update follow."
        );
      }
    } finally {
      setFollowLoading(false);
    }
  };

  // Like / unlike — persists via API and broadcasts to other viewers
  const toggleLike = async () => {
    if (!user || likeBusy) return;
    setLikeBusy(true);

    const nowLiked = !liked;
    const delta = nowLiked ? 1 : -1;
    setLiked(nowLiked);
    setLikeCount((c) => Math.max(0, c + delta));

    // Broadcast so other connected viewers update in real time
    try {
      const room = roomRef.current;
      if (room?.localParticipant) {
        const payload = new TextEncoder().encode(
          JSON.stringify({ __evt: "like", delta })
        );
        room.localParticipant.publishData(payload, { reliable: true });
      }
    } catch {
      // Room may be disconnected
    }

    try {
      const res = await apiFetch<{
        success: boolean;
        data: { likes: number; liked: boolean };
      }>(`/api/streams/${id}/like`, {
        method: nowLiked ? "POST" : "DELETE",
      });
      setLikeCount(res.data.likes);
      setLiked(res.data.liked);
    } catch {
      // Endpoint unavailable — keep the optimistic local state
    } finally {
      setLikeBusy(false);
    }
  };

  // Submit a report
  const submitReport = async () => {
    if (!reportReason || reportBusy) return;
    setReportBusy(true);
    setReportError(null);
    try {
      await apiFetch(`/api/streams/${id}/report`, {
        method: "POST",
        body: JSON.stringify({
          reason: reportReason,
          ...(reportDetails.trim() ? { details: reportDetails.trim() } : {}),
        }),
      });
      setReportDone(true);
    } catch (err) {
      setReportError(
        err instanceof Error ? err.message : "Failed to submit report"
      );
    } finally {
      setReportBusy(false);
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
          <div
            className={cn(
              "relative aspect-video w-full bg-black",
              !controlsVisible && stream.isLive && "cursor-none"
            )}
            ref={videoContainerRef}
            onMouseMove={showControls}
            onTouchStart={showControls}
          >
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

            {/* Live and joined, but nothing is being published yet — the
                normal state for an OBS stream between getting the key and
                the encoder connecting. Previously just a black rectangle. */}
            {stream.isLive && connected && !hasVideo && !playbackError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="px-6 text-center">
                  <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                  <p className="text-base font-semibold text-white/70">
                    Waiting for the broadcaster
                  </p>
                  <p className="mt-1 text-sm text-white/40">
                    The video appears here the moment they start sending.
                  </p>
                </div>
              </div>
            )}

            {/* Flagged live, but we couldn't actually join the room */}
            {stream.isLive && playbackError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="px-6 text-center">
                  <p className="text-lg font-semibold text-white/60">
                    {playbackError}
                  </p>
                  <button
                    onClick={() => router.push("/explore")}
                    className="mt-4 h-9 rounded-lg border border-white/15 px-4 text-sm font-medium text-white/70 transition-colors hover:border-white/30 hover:text-white"
                  >
                    Browse live streams
                  </button>
                </div>
              </div>
            )}

            {/* Stream overlay info */}
            <div
              className={cn(
                "absolute top-4 left-4 flex items-center gap-2 transition-opacity duration-300",
                !controlsVisible && stream.isLive && "opacity-0"
              )}
            >
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
                  ? // Prefer the room roster once we're actually in the room;
                    // until then (or if the join failed) the server's last
                    // known count beats showing a confident "0 watching".
                    `${formatNumber(connected ? viewerCount : stream.viewers)} watching`
                  : // `viewers` is the live concurrent count and is 0 for an
                    // ended stream; peak is what actually describes it.
                    `${formatNumber(stream.peakViewers ?? 0)} peak`}
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
              className={cn(
                "absolute bottom-4 right-4 flex size-8 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-all duration-300 hover:bg-black/80 hover:text-white",
                !controlsVisible && stream.isLive && "pointer-events-none opacity-0"
              )}
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
                  onClick={toggleLike}
                  disabled={!user || likeBusy}
                  title={user ? (liked ? "Unlike" : "Like") : "Sign in to like"}
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
                {user && streamer._id !== user.id && (
                  <button
                    onClick={() => {
                      setReportReason("");
                      setReportDetails("");
                      setReportDone(false);
                      setReportError(null);
                      setShowReport(true);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <Flag size={14} />
                    Report
                  </button>
                )}
              </div>
            </div>

            {/* Streamer info */}
            <div className="mt-5 flex items-center justify-between rounded-xl border border-white/5 bg-white/2 p-4">
              <div className="flex items-center gap-3">
                <UserAvatar
                  src={streamer.avatar}
                  name={streamer.displayName || streamer.username}
                  size={44}
                  className="size-11"
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
              {user && String(streamer._id) !== String(user.id) && (
                <div className="flex flex-col items-end gap-1">
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
                {followError && (
                  <p className="max-w-[14rem] text-right text-[0.65rem] text-red-400">
                    {followError}
                  </p>
                )}
                </div>
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

            {/* Disclaimer */}
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground/60">
              Content is creator opinion, not financial advice. Crypto assets
              are volatile — always do your own research. Tips are voluntary
              gifts to the creator, not investments.
            </p>
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

      {/* Report modal */}
      {showReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-background p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">
                Report Stream
              </h2>
              <button
                onClick={() => setShowReport(false)}
                className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {reportDone ? (
              <div className="mt-4 text-center">
                <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-green-500/10">
                  <Flag size={22} className="text-green-400" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  Report submitted
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Thanks for helping keep Xtreme safe. Our moderation team
                  will review this stream.
                </p>
                <button
                  onClick={() => setShowReport(false)}
                  className="mt-5 h-10 w-full rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <p className="mt-1 text-xs text-muted-foreground">
                  Why are you reporting this stream?
                </p>

                <div className="mt-4 space-y-1.5">
                  {REPORT_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setReportReason(r.value)}
                      className={cn(
                        "w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                        reportReason === r.value
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Additional details (optional)"
                  className="mt-4 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
                />

                {reportError && (
                  <p className="mt-2 text-xs text-red-400">{reportError}</p>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setShowReport(false)}
                    className="h-10 flex-1 rounded-lg border border-white/10 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitReport}
                    disabled={!reportReason || reportBusy}
                    className="h-10 flex-1 rounded-lg bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reportBusy ? "Submitting..." : "Submit Report"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
