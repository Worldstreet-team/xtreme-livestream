"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  VideoCamera,
  Monitor,
  Microphone,
  MicrophoneSlash,
  Camera,
  CameraSlash,
  Check,
  Copy,
  CurrencyDollar,
  Broadcast,
  HandWaving,
  Lightning,
  Eye,
  EyeSlash,
  ChatText,
  UsersThree,
  MonitorArrowUp,
  ShareNetwork,
  UploadSimple,
  X,
  Warning,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { CATEGORY_GROUPS, type Category } from "@/lib/categories";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { captureVideoFrame, compressImage } from "@/lib/image-utils";
import { LiveChat } from "@/components/app/live-chat";
import {
  StageTile,
  type AttachableVideoTrack,
} from "@/components/app/stage-tile";
import type {
  Room,
  LocalVideoTrack,
  LocalAudioTrack,
} from "livekit-client";

type SourceType = "camera" | "screen" | "obs";
type StudioTab = "settings" | "chat" | "viewers" | "stage";

/** Mirrors MAX_STAGE_GUESTS in @xtreme/contracts — the API enforces it. */
const MAX_STAGE_GUESTS = 3;

interface StageUser {
  userId: string;
  username: string;
  avatar: string;
}

export default function StudioPage() {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Just Chatting");
  const [tags, setTags] = useState("");
  // Deep-linkable source: socials' Go Live sheet opens /studio?source=screen
  // for screen-share sessions. Read from location (not useSearchParams) to
  // avoid the Suspense boundary requirement in a client page.
  const [source, setSource] = useState<SourceType>(() => {
    if (typeof window === "undefined") return "camera";
    const q = new URLSearchParams(window.location.search).get("source");
    if (q === "screen") return "screen";
    if (q === "obs") return "obs";
    return "camera";
  });
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState("0:00");
  const [activeTab, setActiveTab] = useState<StudioTab>("settings");
  const [liveRoom, setLiveRoom] = useState<Room | null>(null);
  const [connectedViewers, setConnectedViewers] = useState<
    Array<{ identity: string; name: string; joinedAt: Date }>
  >([]);
  const [screenShareActive, setScreenShareActive] = useState(false);

  // ---- OBS / RTMP ----
  /** Ingress credentials returned when the stream was created with source "obs". */
  const [ingressInfo, setIngressInfo] = useState<{
    url: string;
    streamKey: string;
  } | null>(null);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copiedField, setCopiedField] = useState<"url" | "key" | null>(null);
  /** True once the encoder's video is actually arriving. */
  const [obsFeedActive, setObsFeedActive] = useState(false);

  // ---- Session stats ----
  const [peakViewers, setPeakViewers] = useState(0);
  const [sessionTipsMinor, setSessionTipsMinor] = useState(0);

  // ---- Stage guests ----
  const [stageRequests, setStageRequests] = useState<StageUser[]>([]);
  const [liveGuests, setLiveGuests] = useState<StageUser[]>([]);
  /** userId currently being approved/denied/removed, for per-row spinners. */
  const [stageBusyId, setStageBusyId] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  /** Guests' video tracks, rendered as tiles over the preview. */
  const [guestTiles, setGuestTiles] = useState<
    Array<{ identity: string; name: string }>
  >([]);
  const guestTracksRef = useRef<Map<string, AttachableVideoTrack>>(new Map());
  const guestAudioElsRef = useRef<Map<object, HTMLAudioElement>>(new Map());

  // ---- Co-live ----
  /** An open invite from another live host, shown in the Stage tab. */
  const [coLiveInvite, setCoLiveInvite] = useState<{
    fromStreamId: string;
    fromUsername: string;
    fromDisplayName?: string;
    fromAvatar?: string;
    fromTitle?: string;
  } | null>(null);
  const [coLiveBusy, setCoLiveBusy] = useState(false);
  /** Streams I've already invited this session. */
  const [coLiveInvited, setCoLiveInvited] = useState<Set<string>>(new Set());
  /** Other hosts live right now — co-live candidates. */
  const [otherLive, setOtherLive] = useState<
    Array<{
      _id: string;
      title: string;
      viewers: number;
      streamerId?: { displayName?: string; username?: string; avatar?: string };
    }>
  >([]);

  // ---- Tip alerts ----
  const [tipAlerts, setTipAlerts] = useState<
    Array<{ id: string; username: string; amountLabel: string; emoji: string }>
  >([]);
  const chimeCtxRef = useRef<AudioContext | null>(null);

  // Go Live / End Stream confirmation dialog
  const [confirmDialog, setConfirmDialog] = useState<"golive" | "end" | null>(
    null
  );

  // Custom thumbnail (base64 data URI) chosen by the host
  const [customThumbnail, setCustomThumbnail] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Host share feedback
  const [shareCopied, setShareCopied] = useState(false);

  // Auto-hide overlay controls while live
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // LiveKit refs
  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const audioTrackRef = useRef<LocalAudioTrack | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const startTimeRef = useRef<Date | null>(null);
  const elapsedInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preview camera locally before going live
  const [previewTrack, setPreviewTrack] = useState<LocalVideoTrack | null>(
    null
  );

  const startPreview = useCallback(async () => {
    try {
      // Stop any existing preview
      if (previewTrack) {
        previewTrack.stop();
      }

      if (source === "camera") {
        const { createLocalVideoTrack, VideoPresets } = await import("livekit-client");
        const track = await createLocalVideoTrack({
          resolution: VideoPresets.h720.resolution,
        });
        setPreviewTrack(track);
        if (videoElRef.current) {
          track.attach(videoElRef.current);
        }
      }
      // Screen share can't be previewed without a prompt, skip it
    } catch {
      // User denied camera access — that's fine
      setPreviewTrack(null);
    }
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start preview on mount and when source changes (only if not live)
  useEffect(() => {
    if (!isLive && source === "camera") {
      startPreview();
    }
    return () => {
      if (previewTrack) {
        previewTrack.stop();
      }
    };
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps

  // Elapsed timer
  useEffect(() => {
    if (isLive) {
      startTimeRef.current = new Date();
      elapsedInterval.current = setInterval(() => {
        if (!startTimeRef.current) return;
        const diff = Math.floor(
          (Date.now() - startTimeRef.current.getTime()) / 1000
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
      }, 1000);
    } else {
      if (elapsedInterval.current) clearInterval(elapsedInterval.current);
      setElapsed("0:00");
    }
    return () => {
      if (elapsedInterval.current) clearInterval(elapsedInterval.current);
    };
  }, [isLive]);

  const copyIngressField = async (field: "url" | "key", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard unavailable — the value is selectable text anyway.
    }
  };

  // Peak is a session stat the dashboard shows; the server tracks its own.
  useEffect(() => {
    setPeakViewers((p) => Math.max(p, viewerCount));
  }, [viewerCount]);

  /** Two-note chime when a tip lands — the streamer reacts on air, which is
   *  what makes the next tip happen. WebAudio, so no asset to load. */
  const playTipChime = useCallback(() => {
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return;
      if (!chimeCtxRef.current) chimeCtxRef.current = new Ctor();
      const ctx = chimeCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      [880, 1318.5].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const at = now + i * 0.09;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.16, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.55);
      });
    } catch {
      // No audio context — the toast still shows.
    }
  }, []);

  /**
   * Studio-side room events: stage requests/transitions and tip alerts.
   * Chat rows are handled inside LiveChat's own listener on the same room.
   */
  const handleStudioData = useCallback(
    (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload)) as {
          __evt?: string;
          action?: string;
          userId?: string;
          username?: string;
          avatar?: string;
          type?: string;
          tipAmount?: string;
          emoji?: string;
          id?: string;
        };
        if (data.__evt === "colive_invite") {
          const evt = data as {
            fromStreamId?: string;
            fromUsername?: string;
            fromDisplayName?: string;
            fromAvatar?: string;
            fromTitle?: string;
          };
          if (evt.fromStreamId && evt.fromUsername) {
            setCoLiveInvite({
              fromStreamId: evt.fromStreamId,
              fromUsername: evt.fromUsername,
              fromDisplayName: evt.fromDisplayName,
              fromAvatar: evt.fromAvatar,
              fromTitle: evt.fromTitle,
            });
            playTipChime();
          }
          return;
        }
        if (data.__evt === "colive_decline") {
          const evt = data as { byUsername?: string };
          setStageError(
            `${evt.byUsername ?? "They"} declined the co-live invite.`
          );
          return;
        }
        if (data.__evt === "guest_request" && data.userId) {
          const row: StageUser = {
            userId: data.userId,
            username: data.username ?? "viewer",
            avatar: data.avatar ?? "",
          };
          setStageRequests((prev) =>
            prev.some((r) => r.userId === row.userId) ? prev : [...prev, row]
          );
          return;
        }
        if (data.__evt === "guest_update" && data.userId) {
          const uid = data.userId;
          if (data.action === "cancelled" || data.action === "denied") {
            setStageRequests((prev) => prev.filter((r) => r.userId !== uid));
          } else if (data.action === "approved") {
            setStageRequests((prev) => {
              const row = prev.find((r) => r.userId === uid);
              if (row) {
                setLiveGuests((live) =>
                  live.some((g) => g.userId === uid) ? live : [...live, row]
                );
              } else if (data.username) {
                setLiveGuests((live) =>
                  live.some((g) => g.userId === uid)
                    ? live
                    : [
                        ...live,
                        {
                          userId: uid,
                          username: data.username!,
                          avatar: data.avatar ?? "",
                        },
                      ]
                );
              }
              return prev.filter((r) => r.userId !== uid);
            });
          } else if (data.action === "removed" || data.action === "left") {
            setLiveGuests((prev) => prev.filter((g) => g.userId !== uid));
          }
          return;
        }
        if (!data.__evt && data.type === "tip" && data.username) {
          const amountStr = data.tipAmount ?? "0";
          const label = amountStr.endsWith(".00")
            ? `$${amountStr.slice(0, -3)}`
            : `$${amountStr}`;
          const id = String(data.id ?? `tip-${Date.now()}-${Math.random()}`);
          const cents = Math.round(parseFloat(amountStr) * 100) || 0;
          setSessionTipsMinor((t) => t + cents);
          playTipChime();
          setTipAlerts((prev) => [
            ...prev.slice(-2),
            {
              id,
              username: data.username!,
              amountLabel: label,
              emoji: data.emoji || "💰",
            },
          ]);
          setTimeout(
            () => setTipAlerts((prev) => prev.filter((t) => t.id !== id)),
            6000
          );
        }
      } catch {
        // Not an event payload
      }
    },
    [playTipChime]
  );
  const handleStudioDataRef = useRef(handleStudioData);
  handleStudioDataRef.current = handleStudioData;

  // ---- Stage actions (host) ----

  const approveGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/approve`, {
        method: "POST",
      });
      // The guest_update event moves the row too; doing it here as well keeps
      // the UI honest if our own event delivery hiccups.
      setStageRequests((prev) => {
        const row = prev.find((r) => r.userId === userId);
        if (row) {
          setLiveGuests((live) =>
            live.some((g) => g.userId === userId) ? live : [...live, row]
          );
        }
        return prev.filter((r) => r.userId !== userId);
      });
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't approve that request."
      );
    } finally {
      setStageBusyId(null);
    }
  };

  const denyGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/deny`, {
        method: "POST",
      });
      setStageRequests((prev) => prev.filter((r) => r.userId !== userId));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't decline that request."
      );
    } finally {
      setStageBusyId(null);
    }
  };

  const removeGuest = async (userId: string) => {
    if (!streamId || stageBusyId) return;
    setStageBusyId(userId);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${streamId}/guests/${userId}/remove`, {
        method: "POST",
      });
      setLiveGuests((prev) => prev.filter((g) => g.userId !== userId));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't remove that guest."
      );
    } finally {
      setStageBusyId(null);
    }
  };

  // ---- Co-live actions ----

  const inviteCoLive = async (targetStreamId: string) => {
    if (coLiveBusy) return;
    setCoLiveBusy(true);
    setStageError(null);
    try {
      await apiFetch(`/api/streams/${targetStreamId}/colive/invite`, {
        method: "POST",
      });
      setCoLiveInvited((prev) => new Set(prev).add(targetStreamId));
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't send the invite."
      );
    } finally {
      setCoLiveBusy(false);
    }
  };

  const acceptCoLive = async () => {
    if (!coLiveInvite || !streamId || coLiveBusy) return;
    setCoLiveBusy(true);
    setStageError(null);
    try {
      const res = await apiFetch<{
        success: boolean;
        data: { primaryStreamId: string };
      }>(`/api/streams/${streamId}/colive/accept`, {
        method: "POST",
        body: JSON.stringify({ fromStreamId: coLiveInvite.fromStreamId }),
      });
      // My stream is over server-side; hand the room over cleanly and walk
      // onto their stage. ?stage=1 makes the stream page claim publish
      // rights and start the camera instead of tidying the slot away.
      roomRef.current?.disconnect();
      roomRef.current = null;
      window.location.assign(
        `/stream/${res.data.primaryStreamId}?stage=1`
      );
    } catch (err) {
      setStageError(
        err instanceof Error ? err.message : "Couldn't merge the lives."
      );
      setCoLiveBusy(false);
    }
  };

  const declineCoLive = async () => {
    if (!coLiveInvite || !streamId) return;
    const invite = coLiveInvite;
    setCoLiveInvite(null);
    try {
      await apiFetch(`/api/streams/${streamId}/colive/decline`, {
        method: "POST",
        body: JSON.stringify({ fromStreamId: invite.fromStreamId }),
      });
    } catch {
      // Their invite simply times out.
    }
  };

  // Who else is live right now — the co-live candidate list.
  useEffect(() => {
    if (!isLive) {
      setOtherLive([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streams: typeof otherLive };
        }>(`/api/streams?live=true&limit=10&sort=viewers`);
        if (!cancelled) {
          setOtherLive(res.data.streams.filter((s) => s._id !== streamId));
        }
      } catch {
        // Section just stays empty.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, streamId]);

  const goLive = async () => {
    if (!title.trim()) return;
    setIsConnecting(true);
    setError(null);

    let createdStreamId: string | null = null;

    try {
      // Step 1: Call our API to create stream + get LiveKit token
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Custom uploaded thumbnail wins; otherwise auto-capture from preview
      let thumbnail: string | undefined = customThumbnail ?? undefined;
      if (!thumbnail && videoElRef.current) {
        thumbnail = captureVideoFrame(videoElRef.current, 640, 0.75) ?? undefined;
      }

      const res = await apiFetch<{
        success: boolean;
        data: {
          stream: { id: string; livekitRoomName: string };
          livekitToken: string;
          livekitUrl: string;
          ingress?: { url: string; streamKey: string };
        };
      }>("/api/streams", {
        method: "POST",
        body: JSON.stringify({
          title,
          category,
          tags: tagList,
          thumbnail,
          source,
        }),
      });

      const { livekitToken, livekitUrl } = res.data;
      createdStreamId = res.data.stream.id;
      setStreamId(createdStreamId);
      if (res.data.ingress) setIngressInfo(res.data.ingress);

      // Step 2: Stop preview track
      if (previewTrack) {
        previewTrack.stop();
        setPreviewTrack(null);
      }

      // Step 3: Connect to LiveKit room
      const { Room: LKRoom, RoomEvent, Track, VideoPresets } = await import("livekit-client");
      const room = new LKRoom({
        // Pause simulcast layers no subscriber is consuming.
        dynacast: true,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        publishDefaults: {
          videoCodec: "vp8",
          // Explicit ladder under the 720p capture so adaptive viewers
          // (phones, small tiles, bad networks) get a right-sized layer
          // instead of the full feed or nothing.
          simulcast: true,
          videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        },
      });

      // The RTMP encoder joins as obs-<my id> — it's the feed, not a viewer.
      const countViewers = () => {
        let n = 0;
        room.remoteParticipants.forEach((p) => {
          // Neither the RTMP encoder nor the host's own monitor tab counts.
          if (!p.identity.startsWith("obs-") && !p.identity.startsWith("mon-"))
            n += 1;
        });
        return n;
      };
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        setViewerCount(countViewers());
        if (
          participant.identity.startsWith("obs-") ||
          participant.identity.startsWith("mon-")
        )
          return;
        setConnectedViewers((prev) => [
          ...prev,
          {
            identity: participant.identity,
            name: participant.name || participant.identity,
            joinedAt: new Date(),
          },
        ]);
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        setViewerCount(countViewers());
        setConnectedViewers((prev) =>
          prev.filter((v) => v.identity !== participant.identity)
        );
      });

      // Stage guests publish into this room once approved. Their video
      // becomes a tile over the preview; their audio plays out loud so the
      // host can hold an actual conversation.
      room.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (!track) return;
        // The encoder's video IS the program feed — into the main preview,
        // never a guest tile. Its audio stays unattached: monitoring your
        // own mix through the dashboard is a feedback loop.
        if (participant.identity === `obs-${user?.id}`) {
          if (track.kind === Track.Kind.Video && videoElRef.current) {
            track.attach(videoElRef.current);
            setObsFeedActive(true);
          }
          return;
        }
        if (track.kind === Track.Kind.Video) {
          guestTracksRef.current.set(
            participant.identity,
            track as unknown as AttachableVideoTrack
          );
          setGuestTiles((prev) =>
            prev.some((t) => t.identity === participant.identity)
              ? prev
              : [
                  ...prev,
                  {
                    identity: participant.identity,
                    name: participant.name || "Guest",
                  },
                ]
          );
        }
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach() as HTMLAudioElement;
          document.body.appendChild(el);
          guestAudioElsRef.current.set(track, el);
          el.play().catch(() => {});
        }
      });
      room.on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => {
        if (!track) return;
        if (participant.identity === `obs-${user?.id}`) {
          if (track.kind === Track.Kind.Video) setObsFeedActive(false);
          return;
        }
        track.detach().forEach((el) => el.remove());
        guestAudioElsRef.current.delete(track);
        if (track.kind === Track.Kind.Video) {
          guestTracksRef.current.delete(participant.identity);
          setGuestTiles((prev) =>
            prev.filter((t) => t.identity !== participant.identity)
          );
        }
      });

      // Stage requests, stage transitions, and tip alerts.
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        handleStudioDataRef.current(payload);
      });

      await room.connect(livekitUrl, livekitToken);
      roomRef.current = room;
      setLiveRoom(room);

      // Step 4: publish camera/screen + audio — unless OBS is the source,
      // in which case the encoder publishes and this tab only watches.
      if (source !== "obs") {
        if (source === "camera") {
          await room.localParticipant.setCameraEnabled(true);
        } else {
          await room.localParticipant.setScreenShareEnabled(true);
        }
        await room.localParticipant.setMicrophoneEnabled(true);

        // Attach local video to preview element
        const videoPubs = room.localParticipant.videoTrackPublications;
        videoPubs.forEach((pub) => {
          if (pub.track && videoElRef.current) {
            pub.track.attach(videoElRef.current);
            videoTrackRef.current = pub.track as LocalVideoTrack;
          }
        });

        const audioPubs = room.localParticipant.audioTrackPublications;
        audioPubs.forEach((pub) => {
          if (pub.track) {
            audioTrackRef.current = pub.track as LocalAudioTrack;
          }
        });
      }

      setIsLive(true);
      setActiveTab("chat");
    } catch (err) {
      // Cleanup: if stream was created but connection/publish failed, end it
      if (createdStreamId) {
        try {
          await apiFetch(`/api/streams/${createdStreamId}/end`, {
            method: "POST",
          });
        } catch {
          // best-effort cleanup
        }
        setStreamId(null);
      }

      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }

      const msg =
        err instanceof Error ? err.message : "Failed to start stream";
      setError(
        msg.toLowerCase().includes("permission") ||
          msg.toLowerCase().includes("notallowed") ||
          msg.toLowerCase().includes("denied")
          ? "Camera/microphone permission denied. Please allow access in your browser settings and try again."
          : msg
      );

      // Restart preview
      startPreview();
    } finally {
      setIsConnecting(false);
    }
  };

  const endStream = async () => {
    try {
      if (streamId) {
        await apiFetch(`/api/streams/${streamId}/end`, { method: "POST" });
      }
    } catch {
      // Best-effort
    }

    // Disconnect from LiveKit
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }

    videoTrackRef.current = null;
    audioTrackRef.current = null;
    setIsLive(false);
    setStreamId(null);
    setViewerCount(0);
    setLiveRoom(null);
    setConnectedViewers([]);
    setActiveTab("settings");
    setScreenShareActive(false);
    // Stage state is per-session; the room's death took the guests with it.
    setStageRequests([]);
    setLiveGuests([]);
    setGuestTiles([]);
    setTipAlerts([]);
    setStageError(null);
    setIngressInfo(null);
    setObsFeedActive(false);
    setKeyVisible(false);
    setPeakViewers(0);
    setSessionTipsMinor(0);
    guestTracksRef.current.clear();
    guestAudioElsRef.current.forEach((el) => el.remove());
    guestAudioElsRef.current.clear();

    // Restart preview
    startPreview();
  };

  const toggleMic = async () => {
    if (isLive && roomRef.current) {
      await roomRef.current.localParticipant.setMicrophoneEnabled(!micEnabled);
    }
    setMicEnabled(!micEnabled);
  };

  const toggleCam = async () => {
    if (isLive && roomRef.current && source === "camera") {
      await roomRef.current.localParticipant.setCameraEnabled(!camEnabled);
    }
    setCamEnabled(!camEnabled);
  };

  // Toggle screen share while live
  const toggleScreenShare = async () => {
    if (!isLive || !roomRef.current) return;
    try {
      if (screenShareActive) {
        await roomRef.current.localParticipant.setScreenShareEnabled(false);
        setScreenShareActive(false);
      } else {
        await roomRef.current.localParticipant.setScreenShareEnabled(true);
        setScreenShareActive(true);
      }
    } catch {
      // User cancelled screen share picker — that's fine
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    const guestAudioEls = guestAudioElsRef.current;
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
      // Guests' audio elements live on document.body, outside this tree.
      guestAudioEls.forEach((el) => el.remove());
      guestAudioEls.clear();
    };
  }, []);

  /**
   * Recover from an orphaned stream.
   *
   * The browser is the publisher, so refreshing or crashing this tab kills the
   * broadcast — but the Mongo row stays flagged live until reconciliation
   * notices, and the host lands back on a studio that looks idle. There's no
   * way to resume (the tracks are gone), so the honest option is to tell them
   * and let them close it out before starting fresh.
   */
  const [orphan, setOrphan] = useState<{ id: string; title: string } | null>(
    null
  );
  const [endingOrphan, setEndingOrphan] = useState(false);

  useEffect(() => {
    if (!user || isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { stream: { id: string; title: string } | null };
        }>("/api/streams/active/mine");
        if (!cancelled) setOrphan(res.data.stream);
      } catch {
        // Non-critical — the Go Live path ends any stale stream anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isLive]);

  const endOrphan = async () => {
    if (!orphan) return;
    setEndingOrphan(true);
    try {
      await apiFetch(`/api/streams/${orphan.id}/end`, { method: "POST" });
      setOrphan(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not end the previous stream"
      );
    } finally {
      setEndingOrphan(false);
    }
  };

  // Show overlay controls, then hide them after 3s of inactivity (live only)
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (isLive) {
      showControls();
    } else {
      setControlsVisible(true);
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    }
    return () => {
      if (controlsTimer.current) clearTimeout(controlsTimer.current);
    };
  }, [isLive, showControls]);

  // Live thumbnails: the card on Explore (and the post relayed to socials)
  // should show what the stream looks like NOW. Explore re-polls every 15s
  // and thumbnail URLs are versioned, so the pipeline is: capture a frame
  // from the program feed, PATCH it up, the endpoint bumps thumbnailVersion.
  //
  // Two cadences: an eager loop right after going live that retries every
  // couple of seconds until the feed actually has frames (screen share and
  // OBS have NOTHING at go-live — the camera path was the only source that
  // got an instant thumbnail), then a steady refresh every minute.
  useEffect(() => {
    if (!isLive || !streamId) return;

    const capture = () => {
      const el = videoElRef.current;
      if (!el || el.videoWidth === 0) return false;
      // A disabled camera means the element is showing a frozen last frame —
      // keep the previous thumbnail rather than upload that.
      if (source === "camera" && !camEnabled) return false;
      const thumb = captureVideoFrame(el, 640, 0.75);
      if (!thumb) return false;
      void apiFetch(`/api/streams/${streamId}`, {
        method: "PATCH",
        body: JSON.stringify({ thumbnail: thumb }),
      }).catch(() => {
        // Missed refresh — the next tick tries again.
      });
      return true;
    };

    // Eager: first real frame wins. Gives up after ~30s (an OBS stream the
    // encoder never feeds) and leaves it to the steady loop.
    let attempts = 0;
    const eager = setInterval(() => {
      attempts += 1;
      if (capture() || attempts >= 15) clearInterval(eager);
    }, 2_000);

    const steady = setInterval(capture, 60_000);
    return () => {
      clearInterval(eager);
      clearInterval(steady);
    };
  }, [isLive, streamId, source, camEnabled]);

  // Warn before closing/refreshing the tab while live — leaving stops the
  // broadcast. Not for OBS streams: the encoder carries the feed there.
  useEffect(() => {
    if (!isLive || source === "obs") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isLive]);

  // Warn before in-app navigation while live (the browser is the publisher,
  // so leaving the studio page ends the broadcast). OBS streams survive it.
  useEffect(() => {
    if (!isLive || source === "obs") return;
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      const leave = window.confirm(
        "You're live! Leaving the studio will end your stream for all viewers. Leave anyway?"
      );
      if (!leave) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [isLive]);

  // Host share: share/copy the public stream link
  const shareStream = async () => {
    if (!streamId) return;
    const url = `${window.location.origin}/stream/${streamId}`;
    const text = `I'm live on Xtreme — ${title}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // Fall through to clipboard
      }
    }
    try {
      await navigator.clipboard?.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  };

  // Thumbnail upload
  const handleThumbnailFile = async (file: File | undefined) => {
    if (!file) return;
    setThumbError(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setThumbError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setThumbError("Image is too large (max 10MB).");
      return;
    }
    try {
      const dataUri = await compressImage(file, 640, 0.75);
      setCustomThumbnail(dataUri);
    } catch {
      setThumbError("Could not process that image. Try another file.");
    }
  };

  const liveTab = activeTab === "settings" ? "chat" : activeTab;
  const tipsLabel =
    sessionTipsMinor % 100 === 0
      ? `$${sessionTipsMinor / 100}`
      : `$${(sessionTipsMinor / 100).toFixed(2)}`;

  return (
    <div className="min-h-screen p-4 pt-16 md:p-8">
      <div className="mx-auto max-w-[1600px]">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {isLive ? "You're live" : "Go live"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {isLive
                ? source === "obs" && !obsFeedActive
                  ? "Stream created — waiting for your encoder to connect"
                  : `Broadcasting for ${elapsed}`
                : "Set up your stream and go live to the world"}
            </p>
          </div>
          {isLive && streamId && (
            <button
              onClick={shareStream}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/[0.05] px-4 text-sm text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
            >
              <ShareNetwork size={16} />
              {shareCopied ? "Link copied" : "Share stream"}
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {orphan && !isLive && (
          <div className="mb-4 flex flex-col gap-3 rounded-lg bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Warning size={18} className="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p className="text-sm font-medium text-amber-300">
                  &ldquo;{orphan.title}&rdquo; is still marked live
                </p>
                <p className="mt-0.5 text-xs text-amber-400/70">
                  The broadcast stopped when this tab closed, but the stream
                  was never ended. Close it out before going live again.
                </p>
              </div>
            </div>
            <button
              onClick={endOrphan}
              disabled={endingOrphan}
              className="h-9 shrink-0 rounded-lg bg-amber-500/20 px-4 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
            >
              {endingOrphan ? "Ending…" : "End it"}
            </button>
          </div>
        )}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          {/* ---- Stage: the program feed ---- */}
          <div className="min-w-0 flex-1">
            <div
              className="relative aspect-video overflow-hidden rounded-xl bg-black"
              onMouseMove={isLive ? showControls : undefined}
              onTouchStart={isLive ? showControls : undefined}
            >
              {/* Stage grid — the preview splits exactly the way viewers
                  see it: 2 side by side, 3 host-tall, 4 in a 2×2. */}
              {(() => {
                const stageCount = 1 + guestTiles.length;
                return (
                  <div
                    className={cn(
                      "grid size-full gap-px",
                      stageCount === 2 && "grid-cols-2",
                      stageCount >= 3 && "grid-cols-2 grid-rows-2"
                    )}
                  >
                    <div
                      className={cn(
                        "relative overflow-hidden",
                        stageCount === 3 && "row-span-2"
                      )}
                    >
                      <video
                        ref={videoElRef}
                        autoPlay
                        muted
                        playsInline
                        className={cn(
                          "size-full object-cover",
                          // Mirror only the camera: people expect a mirror of
                          // themselves, but never of their screen or OBS scene.
                          source === "camera" && "-scale-x-100"
                        )}
                      />
                      {stageCount > 1 && (
                        <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 backdrop-blur-sm">
                          <span className="text-xs font-medium text-white">
                            You
                          </span>
                        </div>
                      )}
                    </div>
                    {guestTiles.map((t) => (
                      <StageTile
                        key={t.identity}
                        fill
                        track={guestTracksRef.current.get(t.identity)}
                        label={t.name}
                      />
                    ))}
                  </div>
                );
              })()}

              {/* Tip alerts — the on-air moment */}
              {tipAlerts.length > 0 && (
                <div className="pointer-events-none absolute top-4 right-4 z-30 flex flex-col items-end gap-2">
                  {tipAlerts.map((t) => (
                    <div
                      key={t.id}
                      className="flex animate-in items-center gap-2 rounded-full bg-black/80 py-1.5 pr-3.5 pl-2.5 backdrop-blur-sm slide-in-from-right-4"
                    >
                      <span className="text-lg leading-none">{t.emoji}</span>
                      <span className="max-w-[9rem] truncate text-xs font-semibold text-white">
                        {t.username}
                      </span>
                      <span className="flex items-center gap-0.5 text-xs font-bold text-yellow-300">
                        <CurrencyDollar size={12} />
                        {t.amountLabel.replace("$", "")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pre-live states */}
              {!isLive && source === "camera" && !previewTrack && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <VideoCamera size={40} className="mx-auto text-white/15" />
                    <p className="mt-3 text-sm text-white/40">
                      Requesting camera access…
                    </p>
                  </div>
                </div>
              )}
              {!isLive && source === "screen" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <Monitor size={40} className="mx-auto text-white/15" />
                    <p className="mt-3 text-sm text-white/40">
                      Screen share starts when you go live
                    </p>
                  </div>
                </div>
              )}
              {!isLive && source === "obs" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="px-6 text-center">
                    <Broadcast size={40} className="mx-auto text-white/15" />
                    <p className="mt-3 text-sm font-medium text-white/50">
                      Stream from OBS or any RTMP encoder
                    </p>
                    <p className="mt-1 text-xs text-white/35">
                      Go live to get your server URL and stream key.
                    </p>
                  </div>
                </div>
              )}

              {/* Live but the encoder hasn't connected yet */}
              {isLive && source === "obs" && !obsFeedActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="px-6 text-center">
                    <div className="mx-auto mb-3 size-7 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
                    <p className="text-sm font-medium text-white/60">
                      Waiting for your encoder
                    </p>
                    <p className="mt-1 text-xs text-white/35">
                      Paste the connection details below into OBS and start
                      streaming.
                    </p>
                  </div>
                </div>
              )}

              {/* Live badges */}
              {isLive && (
                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                    </span>
                    LIVE
                  </div>
                  <div className="rounded-md bg-black/60 px-2 py-1 font-mono text-xs text-white/80 backdrop-blur-sm">
                    {elapsed}
                  </div>
                </div>
              )}

              {/* Device dock — meaningless for OBS, hidden there */}
              {source !== "obs" && (
                <div
                  className={cn(
                    "absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 transition-opacity duration-300",
                    isLive && !controlsVisible && "pointer-events-none opacity-0"
                  )}
                >
                  <button
                    onClick={toggleMic}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full transition-colors",
                      micEnabled
                        ? "bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                        : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    )}
                  >
                    {micEnabled ? (
                      <Microphone size={19} />
                    ) : (
                      <MicrophoneSlash size={19} />
                    )}
                  </button>
                  <button
                    onClick={toggleCam}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-full transition-colors",
                      camEnabled
                        ? "bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                        : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    )}
                  >
                    {camEnabled ? (
                      <Camera size={19} />
                    ) : (
                      <CameraSlash size={19} />
                    )}
                  </button>
                  {isLive && (
                    <button
                      onClick={toggleScreenShare}
                      title={
                        screenShareActive ? "Stop screen share" : "Share screen"
                      }
                      className={cn(
                        "flex size-10 items-center justify-center rounded-full transition-colors",
                        screenShareActive
                          ? "bg-primary/25 text-primary hover:bg-primary/35"
                          : "bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                      )}
                    >
                      <MonitorArrowUp size={19} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Session stats */}
            {isLive && (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Viewers", value: String(viewerCount) },
                  { label: "Peak", value: String(peakViewers) },
                  { label: "Duration", value: elapsed },
                  { label: "Tips", value: tipsLabel },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-lg bg-white/[0.03] px-3.5 py-3"
                  >
                    <p className="text-[0.62rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                      {stat.label}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* OBS connection details */}
            {source === "obs" && ingressInfo && (
              <div className="mt-4 rounded-xl bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                    Encoder connection
                  </p>
                  {isLive &&
                    (obsFeedActive ? (
                      <span className="flex items-center gap-1.5 text-xs text-green-400">
                        <span className="size-1.5 rounded-full bg-green-400" />
                        Receiving
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-amber-400">
                        <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
                        Waiting
                      </span>
                    ))}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      Server
                    </span>
                    <code className="min-w-0 flex-1 truncate rounded-md bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-foreground/90">
                      {ingressInfo.url}
                    </code>
                    <button
                      onClick={() => copyIngressField("url", ingressInfo.url)}
                      title="Copy server URL"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {copiedField === "url" ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      Stream key
                    </span>
                    <code className="min-w-0 flex-1 truncate rounded-md bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-foreground/90">
                      {keyVisible
                        ? ingressInfo.streamKey
                        : "••••••••••••••••••••••••"}
                    </code>
                    <button
                      onClick={() => setKeyVisible((v) => !v)}
                      title={keyVisible ? "Hide key" : "Reveal key"}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {keyVisible ? <EyeSlash size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() =>
                        copyIngressField("key", ingressInfo.streamKey)
                      }
                      title="Copy stream key"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {copiedField === "key" ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground/60">
                  In OBS: Settings → Stream → Service &ldquo;Custom&rdquo;,
                  then paste both fields. Keep the key private — anyone with
                  it can broadcast as you.
                </p>
              </div>
            )}

            {/* Source picker */}
            {!isLive && (
              <div className="mt-4 flex gap-2">
                {(
                  [
                    { key: "camera", label: "Camera", icon: VideoCamera },
                    { key: "screen", label: "Screen", icon: Monitor },
                    { key: "obs", label: "OBS / RTMP", icon: Broadcast },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSource(opt.key)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm transition-colors",
                      source === opt.key
                        ? "bg-white/[0.08] font-medium text-foreground"
                        : "bg-white/[0.03] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <opt.icon size={17} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ---- Rail: setup before the show, the room during it ---- */}
          <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl bg-white/[0.02] xl:sticky xl:top-8 xl:h-[calc(100vh-6rem)] xl:w-[360px]">
            {!isLive ? (
              <>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                  <h2 className="text-sm font-medium text-foreground">
                    Stream setup
                  </h2>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Title
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. BTC live trading & analysis"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={100}
                      className="h-9 w-full rounded-lg bg-white/[0.05] px-3 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:bg-white/[0.07]"
                    />
                    <p className="mt-1 text-right text-[0.65rem] text-muted-foreground/50">
                      {title.length}/100
                    </p>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as Category)}
                      className="h-9 w-full cursor-pointer rounded-lg bg-white/[0.05] px-3 text-sm text-foreground transition-colors outline-none focus:bg-white/[0.07]"
                    >
                      {CATEGORY_GROUPS.map((group) => (
                        <optgroup
                          key={group.label}
                          label={group.label}
                          className="bg-background text-foreground"
                        >
                          {group.topics.map((cat) => (
                            <option
                              className="bg-background text-foreground"
                              key={cat}
                              value={cat}
                            >
                              {cat}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Tags
                    </label>
                    <input
                      type="text"
                      placeholder="bitcoin, trading, analysis"
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      className="h-9 w-full rounded-lg bg-white/[0.05] px-3 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:bg-white/[0.07]"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Thumbnail
                    </label>
                    <input
                      ref={thumbInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        handleThumbnailFile(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                    {customThumbnail ? (
                      <div className="relative overflow-hidden rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={customThumbnail}
                          alt="Stream thumbnail"
                          className="aspect-video w-full object-cover"
                        />
                        <button
                          onClick={() => setCustomThumbnail(null)}
                          title="Remove thumbnail"
                          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => thumbInputRef.current?.click()}
                        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.12] bg-white/[0.02] py-6 text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground"
                      >
                        <UploadSimple size={18} />
                        <span className="text-xs font-medium">
                          Upload a custom thumbnail
                        </span>
                        <span className="text-[0.62rem] text-muted-foreground/60">
                          Otherwise one is captured from your feed
                        </span>
                      </button>
                    )}
                    {thumbError && (
                      <p className="mt-1.5 text-xs text-red-400">{thumbError}</p>
                    )}
                  </div>

                  <div className="rounded-lg bg-white/[0.04] p-3">
                    <h3 className="mb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                      Preview
                    </h3>
                    <div className="flex items-center gap-3">
                      {user && (
                        <UserAvatar
                          src={user.avatar}
                          name={user.displayName}
                          size={32}
                          className="size-8"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {title || "Untitled stream"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/60">
                          {category}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/[0.06] p-3">
                  <Button
                    onClick={() => setConfirmDialog("golive")}
                    disabled={!title.trim() || isConnecting}
                    className="h-10 w-full gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <>
                        <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Connecting…
                      </>
                    ) : (
                      <>
                        <Lightning size={16} weight="fill" />
                        Go live
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Tabs */}
                <div className="flex gap-1 p-1.5">
                  {(
                    [
                      { key: "chat", label: "Chat", icon: ChatText },
                      { key: "stage", label: "Stage", icon: HandWaving },
                      { key: "viewers", label: String(viewerCount), icon: UsersThree },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setActiveTab(t.key)}
                      className={cn(
                        "relative flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs transition-colors",
                        liveTab === t.key
                          ? "bg-white/[0.08] font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <t.icon size={14} />
                      {t.label}
                      {t.key === "stage" && stageRequests.length > 0 && (
                        <span className="absolute top-1 right-2 flex size-4 items-center justify-center rounded-full bg-primary text-[0.55rem] font-bold text-primary-foreground">
                          {stageRequests.length}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Chat — always mounted so messages persist across tabs */}
                <div
                  className={cn(
                    "min-h-0 flex-1",
                    liveTab !== "chat" && "hidden"
                  )}
                >
                  <div className="h-[440px] xl:h-full">
                    {streamId && (
                      <LiveChat
                        streamId={streamId}
                        room={liveRoom}
                        isLive={isLive}
                        isHost
                      />
                    )}
                  </div>
                </div>

                {/* Stage */}
                <div
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10",
                    liveTab !== "stage" && "hidden"
                  )}
                >
                  <div className="h-[440px] space-y-5 p-4 xl:h-auto">
                    {stageError && (
                      <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">
                        {stageError}
                      </p>
                    )}

                    {/* Incoming co-live invite */}
                    {coLiveInvite && (
                      <div className="rounded-lg bg-primary/[0.08] p-3">
                        <div className="flex items-center gap-2.5">
                          <UserAvatar
                            src={coLiveInvite.fromAvatar ?? ""}
                            name={
                              coLiveInvite.fromDisplayName ??
                              coLiveInvite.fromUsername
                            }
                            size={30}
                            className="size-[30px]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {coLiveInvite.fromDisplayName ??
                                coLiveInvite.fromUsername}{" "}
                              wants to co-live
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              Your stream merges into &ldquo;
                              {coLiveInvite.fromTitle ?? "their live"}&rdquo;
                              — your viewers come with you.
                            </p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex gap-2">
                          <button
                            onClick={acceptCoLive}
                            disabled={coLiveBusy}
                            className="h-8 flex-1 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
                          >
                            {coLiveBusy ? "Merging…" : "Accept & merge"}
                          </button>
                          <button
                            onClick={declineCoLive}
                            disabled={coLiveBusy}
                            className="h-8 flex-1 rounded-md bg-white/[0.06] text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                          On stage
                        </h3>
                        <span className="text-[0.65rem] text-muted-foreground/60">
                          {liveGuests.length}/{MAX_STAGE_GUESTS} slots
                        </span>
                      </div>
                      {liveGuests.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50">
                          No guests yet. Approve a request below and they join
                          with their camera.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {liveGuests.map((g) => (
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
                              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
                                {g.username}
                              </p>
                              <button
                                onClick={() => removeGuest(g.userId)}
                                disabled={stageBusyId !== null}
                                title="Remove from stage"
                                className="flex h-7 items-center gap-1 rounded-md bg-red-500/10 px-2 text-[0.65rem] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                              >
                                <X size={12} />
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h3 className="mb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                        Requests
                      </h3>
                      {stageRequests.length === 0 ? (
                        <p className="text-xs text-muted-foreground/50">
                          When viewers tap &ldquo;Join stream&rdquo;, they show
                          up here for you to approve.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {stageRequests.map((r) => (
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
                              <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/90">
                                {r.username}
                              </p>
                              <button
                                onClick={() => approveGuest(r.userId)}
                                disabled={
                                  stageBusyId !== null ||
                                  liveGuests.length >= MAX_STAGE_GUESTS
                                }
                                title={
                                  liveGuests.length >= MAX_STAGE_GUESTS
                                    ? "The stage is full"
                                    : "Bring them on"
                                }
                                className="flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[0.65rem] font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
                              >
                                {stageBusyId === r.userId ? (
                                  <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                                ) : (
                                  <Check size={12} />
                                )}
                                Accept
                              </button>
                              <button
                                onClick={() => denyGuest(r.userId)}
                                disabled={stageBusyId !== null}
                                title="Decline"
                                className="flex size-7 items-center justify-center rounded-md bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Co-live: other hosts on air right now */}
                    {otherLive.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                          Live now — invite to co-live
                        </h3>
                        <div className="space-y-1.5">
                          {otherLive.map((s) => {
                            const name =
                              s.streamerId?.displayName ||
                              s.streamerId?.username ||
                              "Streamer";
                            const invited = coLiveInvited.has(s._id);
                            return (
                              <div
                                key={s._id}
                                className="flex items-center gap-2.5 rounded-lg bg-white/[0.04] px-2.5 py-2"
                              >
                                <span className="relative shrink-0">
                                  <UserAvatar
                                    src={s.streamerId?.avatar ?? ""}
                                    name={name}
                                    size={28}
                                    className="size-7"
                                  />
                                  <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-red-500 ring-2 ring-[oklch(0.13_0.005_285)]" />
                                </span>
                                <div className="min-w-0 flex-1 leading-tight">
                                  <p className="truncate text-sm text-foreground/90">
                                    {name}
                                  </p>
                                  <p className="truncate text-[0.65rem] text-muted-foreground/70">
                                    {s.title}
                                  </p>
                                </div>
                                <button
                                  onClick={() => inviteCoLive(s._id)}
                                  disabled={coLiveBusy || invited}
                                  className={cn(
                                    "h-7 shrink-0 rounded-md px-2.5 text-[0.65rem] font-medium transition-colors disabled:opacity-60",
                                    invited
                                      ? "bg-white/[0.06] text-muted-foreground"
                                      : "bg-white/[0.08] text-foreground hover:bg-white/[0.12]"
                                  )}
                                >
                                  {invited ? "Invited" : "Invite"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[0.65rem] leading-relaxed text-muted-foreground/50">
                          If they accept, their stream ends and they join your
                          stage — their viewers are brought along.
                        </p>
                      </div>
                    )}

                    <p className="text-[0.65rem] leading-relaxed text-muted-foreground/50">
                      Guests broadcast their camera and mic to everyone
                      watching. You can remove anyone instantly.
                    </p>
                  </div>
                </div>

                {/* Viewers */}
                <div
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10",
                    liveTab !== "viewers" && "hidden"
                  )}
                >
                  <div className="h-[440px] p-4 xl:h-auto">
                    {connectedViewers.length === 0 ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="text-center">
                          <UsersThree
                            size={28}
                            className="mx-auto text-muted-foreground/20"
                          />
                          <p className="mt-2 text-xs text-muted-foreground/50">
                            No viewers yet
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <p className="mb-3 text-xs font-medium text-muted-foreground">
                          {connectedViewers.length} viewer
                          {connectedViewers.length !== 1 ? "s" : ""} connected
                        </p>
                        {connectedViewers.map((v) => (
                          <div
                            key={v.identity}
                            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.03]"
                          >
                            <div className="flex size-7 items-center justify-center rounded-full bg-white/[0.06] text-xs font-medium text-foreground/80">
                              {v.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground/80">
                                {v.name}
                              </p>
                              <p className="text-[0.6rem] text-muted-foreground/50">
                                Joined{" "}
                                {v.joinedAt.toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-white/[0.06] p-3">
                  <Button
                    onClick={() => setConfirmDialog("end")}
                    className="h-10 w-full gap-2 rounded-lg bg-red-600 text-sm font-medium text-white transition-colors hover:bg-red-700"
                  >
                    End stream
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Go live / end confirmation */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-xl border border-white/[0.08] bg-[oklch(0.15_0.005_285)]/95 p-6 text-center shadow-[0_16px_50px_-16px_rgba(0,0,0,0.85)] backdrop-blur-2xl">
            <div
              className={cn(
                "mx-auto mb-4 flex size-12 items-center justify-center rounded-full",
                confirmDialog === "golive" ? "bg-primary/10" : "bg-red-500/10"
              )}
            >
              {confirmDialog === "golive" ? (
                <Lightning size={22} weight="fill" className="text-primary" />
              ) : (
                <Warning size={22} className="text-red-400" />
              )}
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {confirmDialog === "golive" ? "Ready to go live?" : "End stream?"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmDialog === "golive"
                ? source === "obs"
                  ? `This creates "${title}" and hands you the RTMP details for your encoder.`
                  : `You're about to broadcast "${title}" to everyone on Xtreme.`
                : `Your stream will end for all ${viewerCount} viewer${viewerCount !== 1 ? "s" : ""} and can't be resumed.`}
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="h-10 flex-1 rounded-lg bg-white/[0.06] text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-foreground"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const action = confirmDialog;
                  setConfirmDialog(null);
                  if (action === "golive") goLive();
                  else endStream();
                }}
                className={cn(
                  "h-10 flex-1 rounded-lg text-sm font-medium text-white transition-colors",
                  confirmDialog === "golive"
                    ? "bg-primary text-primary-foreground hover:bg-primary/85"
                    : "bg-red-600 hover:bg-red-700"
                )}
              >
                {confirmDialog === "golive" ? "Go live" : "End stream"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
