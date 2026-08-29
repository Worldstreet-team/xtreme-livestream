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
  Crown,
  Microphone,
  MicrophoneSlash,
  SignOut,
  SpeakerHigh,
  SpeakerSlash,
  UsersThree,
  X,
  PictureInPicture,
  Sidebar,
  CellSignalLow,
  CaretLeft,
  HandWaving,
  Check,
} from "@phosphor-icons/react";
import { LiveChat, type PinnedMessage } from "@/components/app/live-chat";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatNumber, type Category } from "@/lib/categories";
import { stageLayout } from "@/lib/stage-layout";
import { cn } from "@/lib/utils";
import { use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, apiUrl, ApiError } from "@/lib/api-client";
import type { Room } from "livekit-client";
import {
  GiftOverlay,
  type GiftOverlayHandle,
} from "@/components/app/gift-overlay";
import {
  StageTile,
  type AttachableVideoTrack,
} from "@/components/app/stage-tile";
import {
  FloatingHearts,
  type FloatingHeartsHandle,
} from "@/components/app/floating-hearts";

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
  pinnedMessage?: PinnedMessage | null;
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
  const { user, isLoading: authLoading } = useAuth();
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
  /**
   * Bumped every time the host's video track object is replaced.
   *
   * A publisher restarting video (camera toggle, track republish, the
   * socials app resubscribing) delivers a NEW track while `hasVideo` stays
   * true — so an effect keyed only on `hasVideo` never re-runs and the
   * element keeps rendering the old track, which goes muted the moment it
   * is replaced. That is exactly how a live host renders as a black cell.
   */
  const [hostTrackEpoch, setHostTrackEpoch] = useState(0);
  const videoTrackRef = useRef<AttachableVideoTrack | null>(null);
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

  // ---- Audio ----
  // Playback starts muted: browsers block un-muted autoplay without a fresh
  // user gesture, and the old behaviour (attach + hope) meant viewers landing
  // from a shared link got video with silent audio and no control to fix it.
  // Muted-start plus an explicit "tap to unmute" is the Twitch/YouTube answer.
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const mutedRef = useRef(true);
  const volumeRef = useRef(1);
  /** Every attached remote audio element, keyed by its track object. */
  const audioElsRef = useRef<Map<object, HTMLAudioElement>>(new Map());

  // ---- Stage (guests broadcasting alongside the host) ----
  const [stageState, setStageState] = useState<"idle" | "requested" | "live">(
    "idle"
  );
  const stageStateRef = useRef<"idle" | "requested" | "live">("idle");
  stageStateRef.current = stageState;
  const [stageBusy, setStageBusy] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageMicOn, setStageMicOn] = useState(true);
  /** My own published camera track while on stage. */
  const [localStageTrack, setLocalStageTrack] =
    useState<AttachableVideoTrack | null>(null);
  /** Remote guests currently publishing video (host excluded). */
  const [guestVideos, setGuestVideos] = useState<
    Array<{ identity: string; name: string }>
  >([]);
  const guestTracksRef = useRef<Map<string, AttachableVideoTrack>>(new Map());
  const streamerIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  /** Latest publish/stop functions, reachable from LiveKit callbacks. */
  const publishAsGuestRef = useRef<() => void>(() => {});
  const stopStagePublishRef = useRef<() => void>(() => {});

  // ---- Gifts ----
  const giftOverlayRef = useRef<GiftOverlayHandle | null>(null);
  const handleGiftOverlayReady = useCallback(
    (handle: GiftOverlayHandle) => {
      giftOverlayRef.current = handle;
    },
    []
  );
  const [topGifters, setTopGifters] = useState<
    Array<{
      userId?: string;
      username: string;
      displayName?: string;
      avatar: string;
      totalUsdMinor: number;
    }>
  >([]);

  // ---- Player extras ----
  /** Theater mode hides the chat column so the video takes the width. */
  const [theaterMode, setTheaterMode] = useState(false);
  /** My downlink quality, from LiveKit — only surfaced when it's bad. */
  const [connQuality, setConnQuality] = useState<string | null>(null);

  // ---- Watch next (stream ended) ----
  const [watchNext, setWatchNext] = useState<
    Array<{
      _id: string;
      title: string;
      category: string;
      viewers: number;
      thumbnailUrl?: string | null;
      streamerName: string;
    }>
  >([]);
  const [watchNextLoaded, setWatchNextLoaded] = useState(false);

  // ---- Mobile immersive view ----
  /** Below lg the page becomes a TikTok-style full-screen live view. */
  const [isMobileView, setIsMobileView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobileView(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /**
   * Screen orientation, watched separately from the breakpoint: rotating
   * the phone flips the stage from stacked rows to side-by-side columns.
   */
  const [portraitScreen, setPortraitScreen] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const apply = () => setPortraitScreen(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** Portrait feeds fill the phone screen; landscape ones letterbox. */
  const [feedPortrait, setFeedPortrait] = useState(true);
  useEffect(() => {
    const el = videoElRef.current;
    if (!el || !hasVideo) return;
    const measure = () => {
      if (el.videoWidth && el.videoHeight) {
        setFeedPortrait(el.videoHeight >= el.videoWidth);
      }
    };
    measure();
    el.addEventListener("resize", measure);
    el.addEventListener("loadedmetadata", measure);
    return () => {
      el.removeEventListener("resize", measure);
      el.removeEventListener("loadedmetadata", measure);
    };
  }, [hasVideo, isMobileView]);

  const heartsRef = useRef<FloatingHeartsHandle | null>(null);
  const handleHeartsReady = useCallback((h: FloatingHeartsHandle) => {
    heartsRef.current = h;
  }, []);

  // ---- Host-on-mobile: the owner watching their own stream manages the
  // stage from here (their broadcast usually runs on their phone app). ----
  const isOwner = Boolean(
    user && stream && String(stream.streamerId._id) === user.id
  );
  const isOwnerRef = useRef(false);
  isOwnerRef.current = isOwner;
  const [hostRequests, setHostRequests] = useState<
    Array<{ userId: string; username: string; avatar: string }>
  >([]);
  const [hostLiveGuests, setHostLiveGuests] = useState<
    Array<{ userId: string; username: string; avatar: string }>
  >([]);
  const [showStageSheet, setShowStageSheet] = useState(false);
  const [hostStageBusy, setHostStageBusy] = useState<string | null>(null);

  // ---- Co-live ----
  /** Set when this stream merges into another — brief notice, then follow. */
  const [mergingInto, setMergingInto] = useState<string | null>(null);
  /**
   * ?stage=1: I arrived holding a live stage slot (co-live accept, or a
   * reconnect) — claim publish rights and start the camera instead of
   * tidying the slot away.
   */
  const wantStageRef = useRef(false);
  useEffect(() => {
    wantStageRef.current =
      new URLSearchParams(window.location.search).get("stage") === "1";
  }, []);
  const [claimPending, setClaimPending] = useState(false);

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

  useEffect(() => {
    streamerIdRef.current = stream?.streamerId?._id ?? null;
  }, [stream?.streamerId?._id]);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

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
      // The owner joins as a monitor (mon-<id>): watching your own stream
      // must never steal the broadcaster identity from the device actually
      // publishing it.
      const res = await apiFetch<{
        success: boolean;
        data: { token: string; livekitUrl: string };
      }>(
        `/api/streams/${id}/token${isOwnerRef.current ? "?monitor=1" : ""}`
      );

      // Dynamic import to avoid SSR issues
      const { Room: LKRoom, RoomEvent, Track } = await import("livekit-client");

      // adaptiveStream matches each subscribed video's quality to the size
      // it's actually rendered at; dynacast lets the publisher pause simulcast
      // layers nobody is consuming. Both are free wins for viewers on phones
      // and bad networks — the majority.
      const room = new LKRoom({ adaptiveStream: true, dynacast: true });

      /** Wire up a subscribed remote track: host video to the main player,
       *  guest video to a stage tile, all audio muted-by-default. */
      const addTrack = (
        track: { kind: string; attach: () => HTMLElement } & AttachableVideoTrack,
        participant: { identity: string; name?: string }
      ) => {
        if (track.kind === Track.Kind.Video) {
          // The host's feed arrives as their user id (browser publish) or
          // as obs-<id> (RTMP encoder) — both are the main video, never a
          // guest tile.
          const hostId = streamerIdRef.current;
          if (
            !hostId ||
            participant.identity === hostId ||
            participant.identity === `obs-${hostId}`
          ) {
            videoTrackRef.current = track;
            setHasVideo(true);
            setHostTrackEpoch((n) => n + 1);
          } else {
            guestTracksRef.current.set(participant.identity, track);
            // A fresh array even when the guest is already listed: the tile
            // reads its track from the ref during render, so a republished
            // track only reaches it if React re-renders.
            setGuestVideos((prev) =>
              prev.some((g) => g.identity === participant.identity)
                ? [...prev]
                : [
                    ...prev,
                    {
                      identity: participant.identity,
                      name: participant.name || "Guest",
                    },
                  ]
            );
          }
        }
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach() as HTMLAudioElement;
          // Muted start — see the audio state block. Unmuting flips these
          // elements directly inside the user's click.
          audioEl.muted = mutedRef.current;
          audioEl.volume = volumeRef.current;
          document.body.appendChild(audioEl);
          audioElsRef.current.set(track, audioEl);
        }
      };

      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (!track) return;
        addTrack(track, participant);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
        if (!track) return;
        track.detach().forEach((el) => el.remove());
        audioElsRef.current.delete(track);
        if (track.kind === Track.Kind.Video) {
          const hostId = streamerIdRef.current;
          if (
            participant.identity === hostId ||
            participant.identity === `obs-${hostId}`
          ) {
            videoTrackRef.current = null;
            setHasVideo(false);
          } else {
            guestTracksRef.current.delete(participant.identity);
            setGuestVideos((prev) =>
              prev.filter((g) => g.identity !== participant.identity)
            );
          }
        }
      });

      room.on(RoomEvent.ParticipantConnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      // Surface MY downlink health — viewers blame the streamer for what is
      // usually their own wifi; a quiet chip says which it is.
      room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant === room.localParticipant) {
          setConnQuality(String(quality));
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setHasVideo(false);
        videoTrackRef.current = null;
        audioElsRef.current.forEach((el) => el.remove());
        audioElsRef.current.clear();
        guestTracksRef.current.clear();
        setGuestVideos([]);
        setLocalStageTrack(null);
        setStageState("idle");
        // Host ended the stream — sync UI state and show modal
        setStream((prev) => (prev ? { ...prev, isLive: false } : prev));
        setStreamEnded(true);
      });

      // Real-time engagement events, broadcast by the API server-side.
      // Chat messages are handled inside LiveChat; events carry `__evt`.
      // The event carries the authoritative post-write count — client-sent
      // deltas could drift (drops, replays) and never reached viewers whose
      // sender had no data-publish rights (cross-platform, guests).
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const data = JSON.parse(new TextDecoder().decode(payload)) as {
            __evt?: string;
            likes?: number;
            delta?: number;
            action?: string;
            userId?: string;
            username?: string;
            avatar?: string;
            type?: string;
            tipAmount?: string;
            tipCurrency?: string;
            emoji?: string;
            id?: string;
          };
          if (data.__evt === "like") {
            if (typeof data.likes === "number") {
              setLikeCount(data.likes);
            } else if (typeof data.delta === "number") {
              // Legacy clients still publish deltas; honour them.
              setLikeCount((c) => Math.max(0, c + Math.sign(data.delta!)));
            }
            heartsRef.current?.push();
            return;
          }
          // Host-on-mobile: stage requests reach the owner wherever they are.
          if (data.__evt === "guest_request" && data.userId) {
            if (isOwnerRef.current) {
              const row = {
                userId: data.userId,
                username: data.username ?? "viewer",
                avatar: data.avatar ?? "",
              };
              setHostRequests((prev) =>
                prev.some((r) => r.userId === row.userId)
                  ? prev
                  : [...prev, row]
              );
            }
            return;
          }
          // Stage transitions about *me* drive publishing; everyone else's
          // tiles follow the tracks themselves via TrackSubscribed.
          if (data.__evt === "guest_update" && data.userId) {
            const uid = data.userId;
            if (isOwnerRef.current) {
              if (data.action === "cancelled" || data.action === "denied") {
                setHostRequests((prev) =>
                  prev.filter((r) => r.userId !== uid)
                );
              } else if (data.action === "approved") {
                setHostRequests((prev) => {
                  const row = prev.find((r) => r.userId === uid);
                  if (row) {
                    setHostLiveGuests((live) =>
                      live.some((g) => g.userId === uid) ? live : [...live, row]
                    );
                  }
                  return prev.filter((r) => r.userId !== uid);
                });
              } else if (data.action === "removed" || data.action === "left") {
                setHostLiveGuests((prev) =>
                  prev.filter((g) => g.userId !== uid)
                );
              }
            }
            if (data.userId === userIdRef.current) {
              if (data.action === "approved") {
                publishAsGuestRef.current();
              } else if (
                data.action === "removed" ||
                data.action === "denied"
              ) {
                stopStagePublishRef.current();
                setStageState("idle");
                setStageError(
                  data.action === "removed"
                    ? "The host removed you from the stage."
                    : "The host declined your request."
                );
              }
            }
            return;
          }
          // This stream is merging into another live — follow the party.
          if (data.__evt === "colive_merged") {
            const into = (data as { into?: string }).into;
            if (into) {
              setMergingInto(into);
              setTimeout(() => {
                window.location.assign(`/stream/${into}`);
              }, 1600);
            }
            return;
          }
          // Wallet-charged tips arrive as chat payloads (no __evt). The chat
          // renders the row; this turns the same event into the on-player
          // moment and keeps the supporters strip current.
          if (!data.__evt && data.type === "tip" && data.username) {
            const amountStr = data.tipAmount ?? "0";
            const cents = Math.round(parseFloat(amountStr) * 100) || 0;
            const label = amountStr.endsWith(".00")
              ? `$${amountStr.slice(0, -3)}`
              : `$${amountStr}`;
            giftOverlayRef.current?.push({
              id: String(data.id ?? `tip-${Date.now()}-${Math.random()}`),
              username: data.username,
              emoji: data.emoji || "💰",
              amountLabel: label,
              amountUsdMinor: cents,
            });
            setTopGifters((prev) => {
              const next = prev.map((g) =>
                g.username === data.username
                  ? { ...g, totalUsdMinor: g.totalUsdMinor + cents }
                  : g
              );
              if (!next.some((g) => g.username === data.username)) {
                next.push({
                  username: data.username!,
                  avatar: data.avatar ?? "",
                  totalUsdMinor: cents,
                });
              }
              return next
                .sort((a, b) => b.totalUsdMinor - a.totalUsdMinor)
                .slice(0, 5);
            });
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
            addTrack(pub.track, participant);
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
    const track = videoTrackRef.current;
    const el = videoElRef.current;
    if (!hasVideo || !track || !el) return;
    // Detach first: crossing the mobile/desktop breakpoint swaps the video
    // element, and a track left attached to an unmounted one keeps a stale
    // visibility entry that adaptiveStream can read as "nobody is watching".
    track.detach();
    track.attach(el);
    // hostTrackEpoch: re-attach when the track OBJECT is replaced, which
    // `hasVideo` alone can't see.
  }, [hasVideo, connected, isMobileView, hostTrackEpoch]);

  // Auto-connect when stream loads. Waits for auth to settle: connecting
  // before we know whether this viewer is the OWNER would fetch a normal
  // token and kick their live broadcast off the air.
  useEffect(() => {
    if (stream?.isLive && !connected && !authLoading) {
      connectToStream();
    }
    const audioEls = audioElsRef.current;
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      // The audio elements live on document.body, not in this component's
      // tree — React won't reap them on unmount, so we must.
      audioEls.forEach((el) => el.remove());
      audioEls.clear();
    };
  }, [stream?.isLive, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track fullscreen exits (e.g. pressing Escape)
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  /** Push the current mute/volume state onto every attached audio element. */
  const applyAudioState = useCallback((nextMuted: boolean, nextVolume: number) => {
    mutedRef.current = nextMuted;
    volumeRef.current = nextVolume;
    audioElsRef.current.forEach((el) => {
      el.muted = nextMuted;
      el.volume = nextVolume;
      if (!nextMuted) {
        // Runs inside the user's gesture, so autoplay policy allows it.
        el.play().catch(() => {});
      }
    });
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      applyAudioState(next, volumeRef.current);
      return next;
    });
  }, [applyAudioState]);

  const changeVolume = useCallback(
    (next: number) => {
      setVolume(next);
      // Dragging the slider up is an intent to hear — unmute like every
      // other player does.
      setMuted(next === 0);
      applyAudioState(next === 0, next);
    },
    [applyAudioState]
  );

  const toggleFullscreen = useCallback(() => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoElRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch {
      // Unsupported (Firefox without flag, or no video yet) — button is a
      // no-op rather than an error.
    }
  }, []);

  const toggleTheater = useCallback(() => {
    setTheaterMode((t) => !t);
  }, []);

  // Player keyboard shortcuts: m mute, f fullscreen. Skipped while typing
  // (the chat input lives on this page).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "m" || e.key === "M") toggleMute();
      if (e.key === "f" || e.key === "F") toggleFullscreen();
      if (e.key === "t" || e.key === "T") toggleTheater();
      if (e.key === "p" || e.key === "P") void togglePiP();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMute, toggleFullscreen, toggleTheater, togglePiP]);

  // ---- Stage: request/publish/leave ----

  /** Stop sending my camera/mic. Safe to call when not publishing. */
  const stopStagePublish = useCallback(() => {
    const room = roomRef.current;
    setLocalStageTrack(null);
    setStageMicOn(true);
    if (!room) return;
    void room.localParticipant.setCameraEnabled(false).catch(() => {});
    void room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
  }, []);

  /**
   * Called when the host approves me: my participant now has publish rights
   * (granted server-side), so turning the camera on Just Works. Retried a few
   * times because the grant and the data event race each other to my client.
   */
  const publishAsGuest = useCallback(async () => {
    const room = roomRef.current;
    if (!room || stageStateRef.current === "live") return;
    setStageError(null);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);
        const pub = Array.from(
          room.localParticipant.videoTrackPublications.values()
        )[0];
        setLocalStageTrack(
          (pub?.track as unknown as AttachableVideoTrack) ?? null
        );
        setStageState("live");
        setStageMicOn(true);
        return;
      } catch (err) {
        const msg = String(err).toLowerCase();
        if (msg.includes("permission") || msg.includes("notallowed")) {
          // Camera denied — free the slot instead of squatting on it.
          setStageError(
            "Camera or microphone permission was denied, so you couldn't join."
          );
          setStageState("idle");
          void apiFetch(`/api/streams/${id}/guests/leave`, {
            method: "POST",
          }).catch(() => {});
          return;
        }
        // Grant may not have reached us yet — brief pause, then retry.
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    setStageError("Couldn't start your camera. Try joining again.");
    setStageState("idle");
    void apiFetch(`/api/streams/${id}/guests/leave`, { method: "POST" }).catch(
      () => {}
    );
  }, [id]);

  useEffect(() => {
    publishAsGuestRef.current = () => void publishAsGuest();
    stopStagePublishRef.current = stopStagePublish;
  }, [publishAsGuest, stopStagePublish]);

  const requestStage = async () => {
    if (stageBusy || !user) return;
    setStageBusy(true);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${id}/guests/request`, { method: "POST" });
      setStageState("requested");
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't send the request."
      );
    } finally {
      setStageBusy(false);
    }
  };

  const cancelStageRequest = async () => {
    if (stageBusy) return;
    setStageBusy(true);
    try {
      await apiFetch(`/api/streams/${id}/guests/request`, { method: "DELETE" });
      setStageState("idle");
    } catch {
      // Worst case the host denies a request we no longer care about.
      setStageState("idle");
    } finally {
      setStageBusy(false);
    }
  };

  const leaveStage = async () => {
    if (stageBusy) return;
    setStageBusy(true);
    stopStagePublish();
    setStageState("idle");
    try {
      await apiFetch(`/api/streams/${id}/guests/leave`, { method: "POST" });
    } catch {
      // The webhook cleanup will free the slot if this failed.
    } finally {
      setStageBusy(false);
    }
  };

  const toggleStageMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !stageMicOn;
    setStageMicOn(next);
    try {
      await room.localParticipant.setMicrophoneEnabled(next);
    } catch {
      setStageMicOn(!next);
    }
  };

  // Owner: seed the stage roster (requests + who's on) once live.
  useEffect(() => {
    if (!isOwner || !stream?.isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            live: Array<{ userId: string; username: string; avatar: string }>;
            requests: Array<{
              userId: string;
              username: string;
              avatar: string;
            }>;
          };
        }>(`/api/streams/${id}/guests`);
        if (cancelled) return;
        setHostRequests(res.data.requests);
        setHostLiveGuests(res.data.live);
      } catch {
        // Sheet just starts empty; events fill it in.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner, stream?.isLive, id]);

  const hostApprove = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/approve`, {
        method: "POST",
      });
      setHostRequests((prev) => {
        const row = prev.find((r) => r.userId === userId);
        if (row) {
          setHostLiveGuests((live) =>
            live.some((g) => g.userId === userId) ? live : [...live, row]
          );
        }
        return prev.filter((r) => r.userId !== userId);
      });
    } catch {
      // Row stays; the host can retry.
    } finally {
      setHostStageBusy(null);
    }
  };

  const hostDeny = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/deny`, {
        method: "POST",
      });
      setHostRequests((prev) => prev.filter((r) => r.userId !== userId));
    } catch {
      // Retryable.
    } finally {
      setHostStageBusy(null);
    }
  };

  const hostRemove = async (userId: string) => {
    if (hostStageBusy) return;
    setHostStageBusy(userId);
    try {
      await apiFetch(`/api/streams/${id}/guests/${userId}/remove`, {
        method: "POST",
      });
      setHostLiveGuests((prev) => prev.filter((g) => g.userId !== userId));
    } catch {
      // Retryable.
    } finally {
      setHostStageBusy(null);
    }
  };

  // Reconcile my stage state on load: a pending request survives a refresh,
  // but "live" can't (the refresh killed my published tracks and my publish
  // grant) — release that slot instead of haunting the stage.
  useEffect(() => {
    if (!user || !stream?.isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            live: Array<{ userId: string }>;
            requests: Array<{ userId: string }>;
          };
        }>(`/api/streams/${id}/guests`);
        if (cancelled) return;
        if (res.data.requests.some((g) => g.userId === user.id)) {
          setStageState("requested");
        } else if (res.data.live.some((g) => g.userId === user.id)) {
          if (wantStageRef.current) {
            // Co-live accept or mid-stage reconnect: the slot is mine —
            // re-arm it once the room connection is up.
            setClaimPending(true);
          } else {
            void apiFetch(`/api/streams/${id}/guests/leave`, {
              method: "POST",
            }).catch(() => {});
          }
        }
      } catch {
        // Stage endpoints unavailable — the join button will surface errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, stream?.isLive, id]);

  // Claim a held stage slot once the room is connected (co-live merge /
  // reconnect): server re-grants publish, then the camera goes up.
  useEffect(() => {
    if (!claimPending || !connected) return;
    let cancelled = false;
    (async () => {
      try {
        await apiFetch(`/api/streams/${id}/guests/claim`, { method: "POST" });
        if (!cancelled) {
          setClaimPending(false);
          await publishAsGuest();
        }
      } catch {
        if (!cancelled) {
          setClaimPending(false);
          setStageError("Couldn't rejoin the stage — ask to join again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claimPending, connected, id, publishAsGuest]);

  // Seed the supporters strip from persisted gifts; live tips keep it fresh.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            top: Array<{
              userId: string;
              username: string;
              displayName: string;
              avatar: string;
              totalUsdMinor: number;
            }>;
          };
        }>(`/api/streams/${id}/gifts/top`);
        if (!cancelled) setTopGifters(res.data.top);
      } catch {
        // No gifts yet, or endpoint unavailable — strip stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // When the stream ends, offer what's live *now* instead of ejecting the
  // viewer — the session should roll on, not stop. The auto-redirect only
  // remains for the case where nothing else is live.
  useEffect(() => {
    if (!streamEnded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: {
            streams: Array<{
              _id: string;
              title: string;
              category: string;
              viewers: number;
              thumbnailUrl?: string | null;
              streamerId?: { displayName?: string; username?: string };
              guests?: Array<{ username: string; status: string }>;
            }>;
          };
        }>(`/api/streams?live=true&limit=5&sort=viewers`);
        if (cancelled) return;
        setWatchNext(
          res.data.streams
            .filter((s) => s._id !== id)
            .slice(0, 4)
            .map((s) => {
              const host =
                s.streamerId?.displayName || s.streamerId?.username || "";
              const guest = (s.guests ?? []).find(
                (g) => g.status === "live"
              )?.username;
              return {
                _id: s._id,
                title: s.title,
                category: s.category,
                viewers: s.viewers,
                thumbnailUrl: s.thumbnailUrl,
                streamerName: guest ? `${host} with ${guest}` : host,
              };
            })
        );
      } catch {
        // Fall back to the redirect countdown.
      } finally {
        if (!cancelled) setWatchNextLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [streamEnded, id]);

  // Stream-ended countdown & redirect — only when there's nothing to watch
  // next (otherwise the cards ARE the exit).
  useEffect(() => {
    if (!streamEnded || !watchNextLoaded || watchNext.length > 0) return;
    if (countdown <= 0) {
      router.push("/explore");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [streamEnded, countdown, router, watchNextLoaded, watchNext.length]);

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
    setLiked(nowLiked);
    setLikeCount((c) => Math.max(0, c + (nowLiked ? 1 : -1)));

    // No client-side broadcast: the like endpoint fans the new count into
    // the room itself, so every platform's viewers see it — not only the
    // ones lucky enough to share a data channel with this sender.
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

  // Shared by the desktop page and the mobile immersive view.
  const mergeOverlay = mergingInto && (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-base font-semibold text-foreground">
          The lives are merging
        </p>
        <p className="text-sm text-muted-foreground">
          Taking you to the combined stream…
        </p>
      </div>
    </div>
  );

  const endedOverlay = streamEnded && (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 backdrop-blur-sm">
      <div
        className={cn(
          "mx-4 my-8 w-full rounded-2xl border border-white/10 bg-background p-6 text-center shadow-2xl sm:p-8",
          watchNext.length > 0 ? "max-w-2xl" : "max-w-sm"
        )}
      >
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-red-500/10">
          <Eye size={26} className="text-red-400" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Stream Has Ended</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The host has ended this livestream.
        </p>

        {watchNext.length > 0 ? (
          <>
            <p className="mt-5 mb-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Live right now
            </p>
            <div className="grid grid-cols-2 gap-3 text-left">
              {watchNext.map((s) => (
                <a
                  key={s._id}
                  // Full navigation on purpose: a soft route change to the
                  // same dynamic segment keeps this component instance —
                  // and all its ended-stream state — alive.
                  href={`/stream/${s._id}`}
                  className="group overflow-hidden rounded-xl border border-white/5 bg-white/[0.02] transition-colors hover:border-primary/30"
                >
                  <div className="relative aspect-video bg-black">
                    {s.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={apiUrl(s.thumbnailUrl)}
                        alt=""
                        className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-white/20">
                        <Eye size={24} />
                      </div>
                    )}
                    <span className="absolute top-1.5 left-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
                      LIVE
                    </span>
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[0.6rem] text-white/90">
                      {formatNumber(s.viewers)} watching
                    </span>
                  </div>
                  <div className="p-2.5">
                    <p className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                      {s.title}
                    </p>
                    <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">
                      {s.streamerName}
                    </p>
                  </div>
                </a>
              ))}
            </div>
            <button
              onClick={() => router.push("/explore")}
              className="mt-5 h-10 w-full rounded-lg border border-white/10 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Browse all streams
            </button>
          </>
        ) : (
          <>
            {watchNextLoaded && (
              <p className="mt-1 text-xs text-muted-foreground/60">
                Redirecting to Explore in{" "}
                <span className="font-semibold text-foreground">
                  {countdown}s
                </span>
              </p>
            )}
            <button
              onClick={() => router.push("/explore")}
              className="mt-6 h-10 w-full rounded-lg bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/80"
            >
              Go to Explore Now
            </button>
          </>
        )}
      </div>
    </div>
  );

  // ---- Mobile: full-screen immersive live view ----
  if (isMobileView) {
    const stageCount =
      1 +
      guestVideos.length +
      (stageState === "live" && localStageTrack ? 1 : 0);
    // Split along the screen's long axis — rows while upright, columns once
    // the phone is turned. See lib/stage-layout.ts.
    const layout = stageLayout(stageCount, portraitScreen);
    return (
      <div className="fixed inset-0 z-[60] bg-black">
        {/* Stage — full-bleed, orientation-aware */}
        <div className={cn("absolute inset-0 grid gap-px", layout.container)}>
          <div className={cn("relative overflow-hidden", layout.hostCell)}>
            <video
              ref={videoElRef}
              autoPlay
              playsInline
              className={cn(
                "size-full",
                // Portrait phones fill the frame; landscape feeds letterbox
                // rather than cropping half the scene away.
                stageCount > 1 || feedPortrait
                  ? "object-cover"
                  : "object-contain"
              )}
            />
            {stageCount > 1 && (
              <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-black/60 px-2 py-1 backdrop-blur-sm">
                <span className="truncate text-xs font-medium text-white">
                  {streamer.displayName || streamer.username}
                </span>
              </div>
            )}
          </div>
          {guestVideos.map((g) => (
            <StageTile
              key={g.identity}
              fill
              track={guestTracksRef.current.get(g.identity)}
              label={g.name}
            />
          ))}
          {stageState === "live" && localStageTrack && (
            <StageTile
              fill
              track={localStageTrack}
              label="You"
              self
              micOn={stageMicOn}
            />
          )}
        </div>

        <GiftOverlay onReady={handleGiftOverlayReady} />
        <FloatingHearts onReady={handleHeartsReady} />

        {/* Status overlays */}
        {stream.isLive && connected && !hasVideo && !playbackError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="px-6 text-center">
              <div className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
              <p className="text-base font-semibold text-white/70">
                Waiting for the broadcaster
              </p>
            </div>
          </div>
        )}
        {stream.isLive && playbackError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <div className="px-6 text-center">
              <p className="text-base font-semibold text-white/60">
                {playbackError}
              </p>
              <button
                onClick={() => router.push("/explore")}
                className="mt-4 h-9 rounded-lg bg-white/[0.08] px-4 text-sm font-medium text-white/80"
              >
                Browse live streams
              </button>
            </div>
          </div>
        )}
        {!stream.isLive && !streamEnded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80">
            <p className="text-base font-semibold text-white/60">
              This stream is offline
            </p>
          </div>
        )}

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 z-30 flex items-center gap-2 p-3 pt-[max(env(safe-area-inset-top),12px)]">
          <button
            onClick={() => router.push("/explore")}
            aria-label="Leave stream"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md"
          >
            <CaretLeft size={18} />
          </button>
          <div className="flex min-w-0 items-center gap-2 rounded-full bg-black/45 py-1 pr-1.5 pl-1 backdrop-blur-md">
            <UserAvatar
              src={streamer.avatar}
              name={streamer.displayName || streamer.username}
              size={28}
              className="size-7 shrink-0"
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-semibold text-white">
                {streamer.displayName || streamer.username}
              </p>
              <p className="truncate text-[0.6rem] text-white/60">
                {formatNumber(streamer.followers)} followers
              </p>
            </div>
            {user && !isOwner && !isFollowing && (
              <button
                onClick={toggleFollow}
                disabled={followLoading}
                className="ml-1 h-7 shrink-0 rounded-full bg-primary px-3 text-[0.7rem] font-semibold text-primary-foreground disabled:opacity-50"
              >
                Follow
              </button>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {stream.isLive && (
              <span className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-1 text-[0.65rem] font-bold text-white">
                LIVE
              </span>
            )}
            <span className="flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[0.65rem] text-white/85 tabular-nums backdrop-blur-md">
              <Eye size={12} />
              {formatNumber(connected ? viewerCount : stream.viewers)}
            </span>
          </div>
        </div>

        {/* Unmute pill */}
        {muted && stream.isLive && hasVideo && !playbackError && (
          <button
            onClick={toggleMute}
            className="absolute top-[max(env(safe-area-inset-top),12px)] left-1/2 z-40 mt-14 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm"
          >
            <SpeakerSlash size={16} weight="fill" />
            Tap to unmute
          </button>
        )}

        {/* Right action rail */}
        <div className="absolute right-2 bottom-[calc(max(env(safe-area-inset-bottom),10px)+76px)] z-30 flex flex-col items-center gap-4">
          <button
            onClick={() => {
              heartsRef.current?.push();
              if (user && !liked) void toggleLike();
            }}
            aria-label="Like"
            className="flex flex-col items-center gap-0.5"
          >
            <span className="flex size-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-md">
              <Heart
                size={24}
                weight={liked ? "fill" : "regular"}
                className={liked ? "text-red-500" : "text-white"}
              />
            </span>
            <span className="text-[0.65rem] font-medium text-white/85 tabular-nums">
              {likeCount > 0 ? formatNumber(likeCount) : "Like"}
            </span>
          </button>
          <button
            onClick={() => {
              const url = window.location.href;
              if (navigator.share) {
                navigator
                  .share({ title: stream.title, url })
                  .catch(() => {});
              } else {
                navigator.clipboard?.writeText(url);
              }
            }}
            aria-label="Share"
            className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md"
          >
            <ShareNetwork size={22} />
          </button>
          {user && !isOwner && stream.isLive && connected && (
            stageState === "idle" ? (
              <button
                onClick={requestStage}
                disabled={stageBusy}
                aria-label="Ask to join the stream"
                className="flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md disabled:opacity-50"
              >
                <UsersThree size={22} />
              </button>
            ) : stageState === "requested" ? (
              <button
                onClick={cancelStageRequest}
                disabled={stageBusy}
                aria-label="Cancel stage request"
                className="flex size-11 animate-pulse items-center justify-center rounded-full bg-amber-500/80 text-white backdrop-blur-md"
              >
                <Clock size={22} />
              </button>
            ) : (
              <>
                <button
                  onClick={toggleStageMic}
                  aria-label="Toggle mic"
                  className={cn(
                    "flex size-11 items-center justify-center rounded-full backdrop-blur-md",
                    stageMicOn
                      ? "bg-black/45 text-white"
                      : "bg-red-600/90 text-white"
                  )}
                >
                  {stageMicOn ? (
                    <Microphone size={22} />
                  ) : (
                    <MicrophoneSlash size={22} />
                  )}
                </button>
                <button
                  onClick={leaveStage}
                  disabled={stageBusy}
                  aria-label="Leave stage"
                  className="flex size-11 items-center justify-center rounded-full bg-red-600/90 text-white backdrop-blur-md disabled:opacity-50"
                >
                  <SignOut size={22} />
                </button>
              </>
            )
          )}
          {isOwner && stream.isLive && (
            <button
              onClick={() => setShowStageSheet(true)}
              aria-label="Stage requests"
              className="relative flex size-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md"
            >
              <HandWaving size={22} />
              {hostRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-[0.6rem] font-bold text-primary-foreground ring-2 ring-black">
                  {hostRequests.length}
                </span>
              )}
            </button>
          )}
        </div>

        {/* Chat overlay + input */}
        <div className="absolute inset-x-0 bottom-0 z-30 px-3 pr-16 pb-[max(env(safe-area-inset-bottom),10px)]">
          <div className="h-[46dvh]">
            <LiveChat
              streamId={id}
              room={roomRef.current}
              isLive={stream.isLive}
              isHost={isOwner}
              initialPinned={stream.pinnedMessage ?? null}
              variant="overlay"
            />
          </div>
        </div>

        {/* Host stage sheet */}
        {showStageSheet && (
          <div
            className="fixed inset-0 z-[70] flex items-end bg-black/60"
            onClick={() => setShowStageSheet(false)}
          >
            <div
              className="max-h-[70dvh] w-full overflow-y-auto rounded-t-2xl bg-[oklch(0.14_0.005_285)] p-4 pb-[max(env(safe-area-inset-bottom),16px)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
              <h3 className="mb-3 text-sm font-medium text-foreground">
                Stage
              </h3>

              {hostLiveGuests.length > 0 && (
                <div className="mb-4">
                  <p className="mb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                    On stage
                  </p>
                  <div className="space-y-1.5">
                    {hostLiveGuests.map((g) => (
                      <div
                        key={g.userId}
                        className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2"
                      >
                        <UserAvatar
                          src={g.avatar}
                          name={g.username}
                          size={28}
                          className="size-7"
                        />
                        <p className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                          {g.username}
                        </p>
                        <button
                          onClick={() => hostRemove(g.userId)}
                          disabled={hostStageBusy !== null}
                          className="flex h-8 items-center gap-1 rounded-md bg-red-500/10 px-2.5 text-xs font-medium text-red-400 disabled:opacity-50"
                        >
                          <X size={13} />
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="mb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                Requests
              </p>
              {hostRequests.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground/60">
                  No one is asking to join right now.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {hostRequests.map((r) => (
                    <div
                      key={r.userId}
                      className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2"
                    >
                      <UserAvatar
                        src={r.avatar}
                        name={r.username}
                        size={28}
                        className="size-7"
                      />
                      <p className="min-w-0 flex-1 truncate text-sm text-foreground/90">
                        {r.username}
                      </p>
                      <button
                        onClick={() => hostApprove(r.userId)}
                        disabled={
                          hostStageBusy !== null || hostLiveGuests.length >= 3
                        }
                        className="flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {hostStageBusy === r.userId ? (
                          <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                        ) : (
                          <Check size={13} />
                        )}
                        Accept
                      </button>
                      <button
                        onClick={() => hostDeny(r.userId)}
                        disabled={hostStageBusy !== null}
                        className="flex size-8 items-center justify-center rounded-md bg-white/[0.06] text-muted-foreground disabled:opacity-50"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {mergeOverlay}
        {endedOverlay}
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 pt-16 md:p-0 md:pt-0">
      <div className="flex flex-col lg:h-screen lg:flex-row">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto">
          {/* Video player */}
          <div
            className={cn(
              "relative w-full bg-black",
              theaterMode
                ? "aspect-video lg:aspect-auto lg:h-[85vh]"
                : "aspect-video",
              !controlsVisible && stream.isLive && "cursor-none"
            )}
            ref={videoContainerRef}
            onMouseMove={showControls}
            onTouchStart={showControls}
          >
            {/* Stage grid — the player splits as people join the live:
                1 = full frame, 2 = side by side, 3 = host tall + two
                stacked, 4 = 2×2. The host cell keeps its element across
                layout changes so the track never re-attaches. */}
            {(() => {
              const stageCount =
                1 +
                guestVideos.length +
                (stageState === "live" && localStageTrack ? 1 : 0);
              // The desktop player is always wider than it is tall.
              const layout = stageLayout(stageCount, false);
              return (
                <div className={cn("grid size-full gap-px", layout.container)}>
                  <div
                    className={cn("relative overflow-hidden", layout.hostCell)}
                  >
                    <video
                      ref={videoElRef}
                      autoPlay
                      playsInline
                      className={cn(
                        "size-full",
                        stageCount > 1 ? "object-cover" : "object-contain"
                      )}
                    />
                    {stageCount > 1 && (
                      <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md bg-black/60 px-2 py-1 backdrop-blur-sm">
                        <span className="truncate text-xs font-medium text-white">
                          {stream.streamerId.displayName ||
                            stream.streamerId.username}
                        </span>
                      </div>
                    )}
                  </div>
                  {guestVideos.map((g) => (
                    <StageTile
                      key={g.identity}
                      fill
                      track={guestTracksRef.current.get(g.identity)}
                      label={g.name}
                    />
                  ))}
                  {stageState === "live" && localStageTrack && (
                    <StageTile
                      fill
                      track={localStageTrack}
                      label="You"
                      self
                      micOn={stageMicOn}
                    />
                  )}
                </div>
              );
            })()}

            {/* Gift spectacle layer */}
            <GiftOverlay onReady={handleGiftOverlayReady} />

            {/* Muted-start affordance — the one control that must never hide */}
            {muted && stream.isLive && hasVideo && !playbackError && (
              <button
                onClick={toggleMute}
                className="absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/90"
              >
                <SpeakerSlash size={16} weight="fill" />
                Tap to unmute
              </button>
            )}

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
              {stream.isLive &&
                (connQuality === "poor" || connQuality === "lost") && (
                  <div className="flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-xs text-amber-300 backdrop-blur-sm">
                    <CellSignalLow size={14} weight="fill" />
                    Weak connection
                  </div>
                )}
            </div>

            {/* Volume controls */}
            <div
              className={cn(
                "absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-md bg-black/60 px-2 py-1.5 backdrop-blur-sm transition-all duration-300",
                !controlsVisible && stream.isLive && "pointer-events-none opacity-0"
              )}
            >
              <button
                onClick={toggleMute}
                title={muted ? "Unmute (m)" : "Mute (m)"}
                className="flex size-6 items-center justify-center text-white/80 transition-colors hover:text-white"
              >
                {muted ? <SpeakerSlash size={17} /> : <SpeakerHigh size={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
                className="h-1 w-20 cursor-pointer accent-primary"
              />
            </div>

            {/* Player buttons: PiP, theater, fullscreen */}
            <div
              className={cn(
                "absolute right-4 bottom-4 flex items-center gap-2 transition-all duration-300",
                !controlsVisible && stream.isLive && "pointer-events-none opacity-0"
              )}
            >
              <button
                onClick={() => void togglePiP()}
                className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                title="Picture in picture (p)"
              >
                <PictureInPicture size={18} />
              </button>
              <button
                onClick={toggleTheater}
                className={cn(
                  "hidden size-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors lg:flex",
                  theaterMode
                    ? "bg-primary/30 text-white"
                    : "bg-black/60 text-white/80 hover:bg-black/80 hover:text-white"
                )}
                title={theaterMode ? "Exit theater mode (t)" : "Theater mode (t)"}
              >
                <Sidebar size={18} />
              </button>
              <button
                onClick={toggleFullscreen}
                className="flex size-8 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                title={isFullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
              >
                <CornersOut size={18} />
              </button>
            </div>
          </div>

          {/* Stream info below player */}
          <div className="p-4 md:p-6">
            {/* Title & actions */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold text-foreground sm:text-xl">
                  {stream.title}
                </h1>
                <span className="mt-2 inline-flex rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-muted-foreground">
                  {stream.category}
                </span>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {user &&
                  streamer._id !== user.id &&
                  stream.isLive &&
                  connected &&
                  (stageState === "idle" ? (
                    <button
                      onClick={requestStage}
                      disabled={stageBusy}
                      title="Ask to join this stream with your camera"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                    >
                      <UsersThree size={14} />
                      Join stream
                    </button>
                  ) : stageState === "requested" ? (
                    <button
                      onClick={cancelStageRequest}
                      disabled={stageBusy}
                      title="Waiting for the host — tap to cancel"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      <Clock size={14} />
                      Requested…
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={toggleStageMic}
                        title={stageMicOn ? "Mute your mic" : "Unmute your mic"}
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors",
                          stageMicOn
                            ? "border-green-500/30 bg-green-500/10 text-green-400"
                            : "border-red-500/30 bg-red-500/10 text-red-400"
                        )}
                      >
                        {stageMicOn ? (
                          <Microphone size={14} />
                        ) : (
                          <MicrophoneSlash size={14} />
                        )}
                        Mic
                      </button>
                      <button
                        onClick={leaveStage}
                        disabled={stageBusy}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >
                        <SignOut size={14} />
                        Leave stage
                      </button>
                    </>
                  ))}
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

            {stageError && (
              <p className="mt-2 text-xs text-amber-400">{stageError}</p>
            )}

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

            {/* Top supporters — whole-stream gift leaderboard */}
            {topGifters.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Crown size={13} weight="fill" className="text-yellow-400" />
                  Top supporters
                </span>
                {topGifters.map((g, i) => (
                  <span
                    key={g.userId ?? g.username}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                      i === 0
                        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                        : i === 1
                          ? "border-white/15 bg-white/5 text-foreground/80"
                          : "border-white/10 bg-white/[0.03] text-muted-foreground"
                    )}
                  >
                    <UserAvatar
                      src={g.avatar}
                      name={g.displayName || g.username}
                      size={16}
                      className="size-4"
                    />
                    <span className="max-w-[8rem] truncate font-medium">
                      {g.displayName || g.username}
                    </span>
                    <span className="font-bold">
                      ${(g.totalUsdMinor / 100) % 1 === 0
                        ? g.totalUsdMinor / 100
                        : (g.totalUsdMinor / 100).toFixed(2)}
                    </span>
                  </span>
                ))}
              </div>
            )}

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
        <div
          className={cn(
            "h-[500px] shrink-0 lg:h-screen lg:w-80 xl:w-96",
            theaterMode && "lg:hidden"
          )}
        >
          <LiveChat
            streamId={id}
            room={roomRef.current}
            isLive={stream.isLive}
            initialPinned={stream.pinnedMessage ?? null}
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

      {mergeOverlay}
      {endedOverlay}
    </div>
  );
}
