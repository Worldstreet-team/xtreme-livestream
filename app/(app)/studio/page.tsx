"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { registerStudioBridge, registerVividContext, type StudioAction } from "@/lib/vivid/page-context";
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
  Tag,
  Aperture,
  CheckCircle,
  Circle,
  Bell,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PillTabs } from "@/components/ui/tabs";
import { LiveBadge } from "@/components/ui/badge";
import { BrandMark } from "@/components/ui/brand-mark";
import { SelectField } from "@/components/ui/select-field";
import { StreamArt } from "@/components/app/stream-art";
import { GiftArt } from "@/components/app/gift-art";
import { cn } from "@/lib/utils";
import { BattlePanel } from "@/components/app/battle-panel";
import { GamesPanel } from "@/components/app/games-panel";
import { LivePreview } from "@/components/app/live-preview";
import { sideOf, type BattleView } from "@/lib/battles";
import { CATEGORY_GROUPS, type Category } from "@/lib/categories";
import { stageLayout } from "@/lib/stage-layout";
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
  /** The chip composer's in-progress tag; Enter or a comma commits it. */
  const [tagInput, setTagInput] = useState("");
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
  /** The encoder disconnected mid-broadcast; the stream is holding for it. */
  const [feedDropped, setFeedDropped] = useState(false);
  const [graceMs, setGraceMs] = useState(300_000);
  /**
   * The account's permanent encoder credentials, shown before going live so
   * OBS/vMix can be set up once and never touched again.
   */
  const [streamKey, setStreamKey] = useState<{ url: string; streamKey: string } | null>(null);
  const [rotatingKey, setRotatingKey] = useState(false);

  // ---- Session stats ----
  const [peakViewers, setPeakViewers] = useState(0);
  const [sessionTipsMinor, setSessionTipsMinor] = useState(0);

  // ---- Stage guests ----
  const [stageRequests, setStageRequests] = useState<StageUser[]>([]);
  // The battle this broadcast is in, fed by the battle panel; the preview
  // splits to show the opponent the way viewers see it.
  const [battle, setBattle] = useState<BattleView | null>(null);
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
          state?: string;
          graceMs?: number;
        };
        // The encoder dropped or came back — the API decides, we display.
        if (data.__evt === "feed") {
          setFeedDropped(data.state === "reconnecting");
          if (typeof data.graceMs === "number") setGraceMs(data.graceMs);
          return;
        }
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

  /**
   * Start broadcasting — or, with `resume`, rejoin an OBS stream that is
   * already live (the encoder never stopped; this tab just left). A resume
   * skips creating a stream and is always the encoder path.
   */
  const goLive = async (resume?: {
    id: string;
    livekitToken: string;
    livekitUrl: string;
    ingress?: { url: string; streamKey: string };
  }) => {
    if (!resume && !title.trim()) return;
    const src: SourceType = resume ? "obs" : source;
    setIsConnecting(true);
    setError(null);

    let createdStreamId: string | null = null;

    try {
      let livekitToken: string;
      let livekitUrl: string;
      if (resume) {
        ({ livekitToken, livekitUrl } = resume);
        setStreamId(resume.id);
        if (resume.ingress) setIngressInfo(resume.ingress);
      } else {
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
            source: src,
          }),
        });

        ({ livekitToken, livekitUrl } = res.data);
        createdStreamId = res.data.stream.id;
        setStreamId(createdStreamId);
        if (res.data.ingress) setIngressInfo(res.data.ingress);
      }

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
          // A fresh array even when the guest is already listed: the tile
          // reads its track from the ref during render, so a republished
          // track (camera toggle, reconnect) only reaches it on re-render.
          setGuestTiles((prev) =>
            prev.some((t) => t.identity === participant.identity)
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
      if (src !== "obs") {
        if (src === "camera") {
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
      // Cleanup: if a stream was created here but connection/publish failed,
      // end it. A failed resume leaves the live stream alone — the encoder
      // is still feeding it.
      if (createdStreamId && !resume) {
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
    setFeedDropped(false);
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

  // ── Vivid bridge ──────────────────────────────────────────────────────────
  // Vivid's studioControl tool presses these controls on the user's behalf.
  // The handlers above are recreated every render, so the bridge reads the
  // latest ones through a ref; the registration itself happens once.
  const vividRef = useRef({ goLive, endStream, toggleMic, toggleCam, toggleScreenShare, isLive, micEnabled, camEnabled, screenShareActive, source, title, category, streamId, viewerCount, elapsed, isConnecting, confirmDialog });
  useEffect(() => {
    vividRef.current = { goLive, endStream, toggleMic, toggleCam, toggleScreenShare, isLive, micEnabled, camEnabled, screenShareActive, source, title, category, streamId, viewerCount, elapsed, isConnecting, confirmDialog };
  });
  useEffect(() => {
    const unregisterBridge = registerStudioBridge(async (action: StudioAction) => {
      const v = vividRef.current;
      switch (action) {
        case "mute_mic":
        case "unmute_mic": {
          const wantOn = action === "unmute_mic";
          if (v.micEnabled === wantOn) return { success: true, micEnabled: v.micEnabled, note: "already there" };
          await v.toggleMic();
          return { success: true, micEnabled: wantOn };
        }
        case "camera_on":
        case "camera_off": {
          if (v.source !== "camera") return { error: "The camera toggle only applies to the camera source." };
          const wantOn = action === "camera_on";
          if (v.camEnabled === wantOn) return { success: true, cameraEnabled: v.camEnabled, note: "already there" };
          await v.toggleCam();
          return { success: true, cameraEnabled: wantOn };
        }
        case "start_screen_share":
        case "stop_screen_share": {
          if (!v.isLive) return { error: "Screen share is only available while live." };
          const wantOn = action === "start_screen_share";
          if (v.screenShareActive === wantOn) return { success: true, screenShareActive: wantOn, note: "already there" };
          await v.toggleScreenShare();
          return { success: true, screenShareActive: wantOn, note: wantOn ? "The browser asks the user to pick a window." : undefined };
        }
        case "go_live": {
          if (v.isLive) return { error: "Already live." };
          if (v.isConnecting) return { error: "Already starting." };
          if (!v.title.trim()) return { error: "The stream needs a title first — ask the user for one; they type it into the title field." };
          setConfirmDialog(null);
          await v.goLive();
          return { success: true, title: v.title, category: v.category };
        }
        case "end_stream": {
          if (!v.isLive) return { error: "Not live." };
          setConfirmDialog(null);
          await v.endStream();
          return { success: true, ended: true };
        }
      }
    });
    const unregisterContext = registerVividContext("studio", () => {
      const v = vividRef.current;
      return {
        isLive: v.isLive,
        starting: v.isConnecting,
        source: v.source,
        title: v.title || null,
        category: v.category,
        micOn: v.micEnabled,
        cameraOn: v.camEnabled,
        screenSharing: v.screenShareActive,
        ...(v.isLive ? { viewers: v.viewerCount, liveFor: v.elapsed, streamId: v.streamId } : {}),
        openDialog: v.confirmDialog === "golive" ? "go live confirmation" : v.confirmDialog === "end" ? "end stream confirmation" : null,
      };
    });
    return () => {
      unregisterBridge();
      unregisterContext();
    };
  }, []);

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
  const [orphan, setOrphan] = useState<{ id: string; title: string; source: string } | null>(
    null
  );
  const [endingOrphan, setEndingOrphan] = useState(false);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    if (!user || isLive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { stream: { id: string; title: string; source?: string } | null };
        }>("/api/streams/active/mine");
        if (!cancelled) {
          const s = res.data.stream;
          setOrphan(s ? { id: s.id, title: s.title, source: s.source ?? "camera" } : null);
        }
      } catch {
        // Non-critical — the Go Live path ends any stale stream anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isLive]);

  // The account's permanent encoder key, ready before the stream exists so
  // OBS/vMix can be configured once. Fetched only when the encoder path is
  // chosen — it mints the ingress on first use.
  useEffect(() => {
    if (!user || isLive || source !== "obs" || streamKey) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>("/api/users/me/stream-key")
      .then((r) => !cancelled && setStreamKey({ url: r.data.url, streamKey: r.data.streamKey }))
      .catch(() => {
        // The key appears at go-live instead; the stage copy says so.
      });
    return () => {
      cancelled = true;
    };
  }, [user, isLive, source, streamKey]);

  const rotateKey = async () => {
    if (rotatingKey) return;
    if (!window.confirm("Replace your stream key? The current one stops working immediately and OBS/vMix will need the new one.")) return;
    setRotatingKey(true);
    try {
      const r = await apiFetch<{ success: boolean; data: { url: string; streamKey: string } }>("/api/users/me/stream-key/rotate", { method: "POST" });
      setStreamKey({ url: r.data.url, streamKey: r.data.streamKey });
      setKeyVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't replace the key");
    } finally {
      setRotatingKey(false);
    }
  };

  /** Back into the room of an OBS stream this tab left running. */
  const resumeStream = async () => {
    if (!orphan || resuming) return;
    setResuming(true);
    setError(null);
    try {
      const r = await apiFetch<{
        success: boolean;
        data: {
          stream: { id: string; title: string; category: Category; feedDroppedAt: string | null };
          livekitToken: string;
          livekitUrl: string;
          ingress?: { url: string; streamKey: string };
        };
      }>(`/api/streams/${orphan.id}/resume`, { method: "POST" });
      setTitle(r.data.stream.title);
      setCategory(r.data.stream.category);
      setSource("obs");
      setFeedDropped(!!r.data.stream.feedDroppedAt);
      await goLive({
        id: r.data.stream.id,
        livekitToken: r.data.livekitToken,
        livekitUrl: r.data.livekitUrl,
        ...(r.data.ingress ? { ingress: r.data.ingress } : {}),
      });
      setOrphan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reopen the studio");
    } finally {
      setResuming(false);
    }
  };

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
    const text = `I'm live on Xtream — ${title}`;
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

  // The tag list as chips, and the ways to grow or shrink it.
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const commitTag = () => {
    const next = tagInput.replace(/,/g, "").trim().toLowerCase();
    setTagInput("");
    if (!next || tagList.includes(next) || tagList.length >= 6) return;
    setTags([...tagList, next].join(", "));
  };
  const removeTag = (tag: string) => setTags(tagList.filter((t) => t !== tag).join(", "));

  /** Grab the current preview frame as the thumbnail. */
  const captureFrame = () => {
    const el = videoElRef.current;
    if (!el) return;
    const frame = captureVideoFrame(el, 640, 0.8);
    if (frame) {
      setCustomThumbnail(frame);
      setThumbError(null);
    } else {
      setThumbError("No frame yet — wait for the camera to settle.");
    }
  };

  // What still stands between you and the button.
  const ready = {
    source: source === "obs" || source === "screen" || !!previewTrack,
    title: title.trim().length >= 3,
    category: !!category,
  };
  const readyCount = Object.values(ready).filter(Boolean).length;

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-[1600px]">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-foreground">
              {isLive ? "You're live" : "Go live"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLive
                ? source === "obs" && !obsFeedActive
                  ? feedDropped
                    ? "Encoder disconnected — holding the stream while it reconnects"
                    : "Stream created — waiting for your encoder to connect"
                  : `Broadcasting for ${elapsed}`
                : "Pick a source, name the stream, and you're on in under a minute."}
            </p>
          </div>
          {!isLive && (
            // Readiness: three checks, no scolding — the missing one is the next tap.
            <div className="flex items-center gap-1.5 rounded-full bg-white/[0.05] p-1 pr-3 text-[12px]">
              {(
                [
                  { key: "source", label: source === "obs" ? "Encoder" : source === "screen" ? "Screen" : "Camera" },
                  { key: "title", label: "Title" },
                  { key: "category", label: "Category" },
                ] as const
              ).map((c) => (
                <span
                  key={c.key}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-1 font-medium",
                    ready[c.key] ? "bg-emerald-500/[0.14] text-emerald-300" : "text-muted-foreground"
                  )}
                >
                  {ready[c.key] ? <CheckCircle size={13} weight="fill" /> : <Circle size={13} />}
                  {c.label}
                </span>
              ))}
              <span className="ml-1 text-muted-foreground/70 tabular-nums">{readyCount}/3</span>
            </div>
          )}
          {isLive && streamId && (
            <div className="flex shrink-0 flex-wrap items-start justify-end gap-2">
              <GamesPanel streamId={streamId} />
              <BattlePanel streamId={streamId} onBattle={setBattle} />
              <button
                onClick={shareStream}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-sm bg-white/[0.05] px-4 text-sm text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
              >
                <ShareNetwork size={16} />
                {shareCopied ? "Link copied" : "Share stream"}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-sm bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {orphan && !isLive && (
          <div className={cn("mb-4 flex flex-col gap-3 rounded-sm px-4 py-3 sm:flex-row sm:items-center sm:justify-between", orphan.source === "obs" ? "bg-emerald-500/10" : "bg-amber-500/10")}>
            <div className="flex items-start gap-2.5">
              {orphan.source === "obs" ? (
                <Broadcast size={18} weight="fill" className="mt-0.5 shrink-0 text-emerald-300" />
              ) : (
                <Warning size={18} className="mt-0.5 shrink-0 text-amber-400" />
              )}
              <div>
                <p className={cn("text-sm font-medium", orphan.source === "obs" ? "text-emerald-200" : "text-amber-300")}>
                  {orphan.source === "obs" ? <>&ldquo;{orphan.title}&rdquo; is still live</> : <>&ldquo;{orphan.title}&rdquo; is still marked live</>}
                </p>
                <p className={cn("mt-0.5 text-xs", orphan.source === "obs" ? "text-emerald-200/70" : "text-amber-400/70")}>
                  {orphan.source === "obs"
                    ? "Your encoder is the broadcaster, so closing this tab changed nothing for viewers. Reopen the studio to get chat, guests and tips back."
                    : "The broadcast stopped when this tab closed, but the stream was never ended. Close it out before going live again."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {orphan.source === "obs" && (
                <button
                  onClick={resumeStream}
                  disabled={resuming || endingOrphan}
                  className="flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-100 disabled:opacity-50"
                >
                  {resuming ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Broadcast size={14} weight="fill" />}
                  Reopen studio
                </button>
              )}
              <button
                onClick={endOrphan}
                disabled={endingOrphan || resuming}
                className={cn("h-9 rounded-full px-4 text-sm font-medium transition-colors disabled:opacity-50", orphan.source === "obs" ? "bg-white/[0.08] text-foreground hover:bg-white/[0.12]" : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30")}
              >
                {endingOrphan ? "Ending…" : "End it"}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          {/* ---- Stage: the program feed ---- */}
          <div className="min-w-0 flex-1">
            <div
              className="relative aspect-video overflow-hidden rounded-sm bg-black"
              onMouseMove={isLive ? showControls : undefined}
              onTouchStart={isLive ? showControls : undefined}
            >
              {/* Stage grid — the preview splits exactly the way viewers
                  see it: 2 side by side, 3 host-tall, 4 in a 2×2. */}
              {(() => {
                const opponentStreamId =
                  battle && streamId
                    ? sideOf(battle, streamId) === "host"
                      ? battle.challenger.streamId
                      : battle.host.streamId
                    : null;
                // A battle opponent takes a cell of its own, same as a guest.
                const stageCount = 1 + guestTiles.length + (opponentStreamId ? 1 : 0);
                // The studio preview is 16:9 — always the wide split.
                const layout = stageLayout(stageCount, false);
                return (
                  <div
                    className={cn("grid size-full gap-px", layout.container)}
                  >
                    <div
                      className={cn(
                        "relative overflow-hidden",
                        layout.hostCell
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
                        <div className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-2 py-1">
                          <span className="text-xs font-medium text-white">
                            You
                          </span>
                        </div>
                      )}
                    </div>
                    {opponentStreamId && battle && streamId && (
                      <div className="relative overflow-hidden bg-black">
                        <LivePreview
                          streamId={opponentStreamId}
                          className="absolute inset-0"
                          poster={<div className="absolute inset-0 bg-black" />}
                          fallbackSrc={null}
                        />
                        <div className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-2 py-1">
                          <span className="text-xs font-medium text-white">
                            {(sideOf(battle, streamId) === "host" ? battle.challenger : battle.host).displayName} · opponent
                          </span>
                        </div>
                      </div>
                    )}
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
                      className="flex animate-in items-center gap-2 rounded-full bg-black/80 py-1 pr-3.5 pl-1.5 slide-in-from-right-4"
                    >
                      <GiftArt emoji={t.emoji} size={30} />
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

              {/* Pre-live idle stage: a lit set, not a black box. The W
                  sits faint in the backdrop; the copy says what happens next. */}
              {!isLive && (source !== "camera" || !previewTrack) && (
                <div className="absolute inset-0 overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(220,38,38,0.35),transparent_55%),radial-gradient(ellipse_at_top_right,rgba(124,58,237,0.28),transparent_50%),linear-gradient(180deg,#141416,#0b0b0d)]" />
                  <BrandMark size={320} className="absolute -right-10 -bottom-16 opacity-[0.07]" />
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                    <div className="max-w-sm">
                      <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-white/[0.08] text-white">
                        {source === "camera" ? <VideoCamera size={28} weight="fill" /> : source === "screen" ? <Monitor size={28} weight="fill" /> : <Broadcast size={28} weight="fill" />}
                      </span>
                      <p className="mt-4 text-[17px] font-semibold text-white">
                        {source === "camera" ? "Setting up your camera" : source === "screen" ? "Your screen is the stage" : "Stream from OBS or any encoder"}
                      </p>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">
                        {source === "camera"
                          ? "Allow camera and microphone access when the browser asks. Your preview appears here."
                          : source === "screen"
                            ? "The share picker opens the moment you go live, so nothing is captured before you say so."
                            : "Your server URL and stream key are just below. Set them once in OBS or vMix — they never change."}
                      </p>
                      {source === "camera" && (
                        <span className="mt-4 inline-flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-[12px] font-medium text-white/80">
                          <span className="size-3 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                          Waiting for permission
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Source picker rides the stage's top edge. */}
              {!isLive && (
                <div className="absolute top-3 left-3 z-10">
                  <PillTabs
                    size="sm"
                    value={source}
                    onChange={(s) => setSource(s)}
                    items={[
                      { id: "camera", label: "Camera", icon: VideoCamera },
                      { id: "screen", label: "Screen", icon: Monitor },
                      { id: "obs", label: "OBS / RTMP", icon: Broadcast },
                    ]}
                  />
                </div>
              )}
              {!isLive && source === "camera" && previewTrack && (
                <button
                  type="button"
                  onClick={captureFrame}
                  title="Use this frame as the thumbnail"
                  className="absolute top-3 right-3 z-10 flex h-8 items-center gap-1.5 rounded-full bg-black/55 px-3 text-[12px] font-medium text-white transition-colors hover:bg-black/75"
                >
                  <Aperture size={14} weight="fill" />
                  Capture thumbnail
                </button>
              )}

              {/* Live but the encoder hasn't connected yet */}
              {isLive && source === "obs" && !obsFeedActive && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="px-6 text-center">
                    <div className={cn("mx-auto mb-3 size-7 animate-spin rounded-full border-2", feedDropped ? "border-amber-400/20 border-t-amber-300" : "border-white/15 border-t-white/60")} />
                    <p className={cn("text-sm font-medium", feedDropped ? "text-amber-200" : "text-white/60")}>
                      {feedDropped ? "Encoder disconnected — reconnecting" : "Waiting for your encoder"}
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-white/35">
                      {feedDropped
                        ? `Your stream stays live for ${Math.round(graceMs / 60_000)} minutes while OBS reconnects on the same key. Viewers have been told.`
                        : "Start streaming in OBS or vMix with your key — the picture lands here."}
                    </p>
                  </div>
                </div>
              )}

              {/* Live badges */}
              {isLive && (
                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-sm bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                    </span>
                    LIVE
                  </div>
                  <div className="rounded-sm bg-black/60 px-2 py-1 font-mono text-xs text-white/80">
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
                        ? "bg-black/50 text-white hover:bg-black/70"
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
                        ? "bg-black/50 text-white hover:bg-black/70"
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
                          : "bg-black/50 text-white hover:bg-black/70"
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
                    className="rounded-sm bg-white/[0.03] px-3.5 py-3"
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
              <div className="mt-4 rounded-sm bg-white/[0.02] p-4">
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
                    <code className="min-w-0 flex-1 truncate rounded-sm bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-foreground/90">
                      {ingressInfo.url}
                    </code>
                    <button
                      onClick={() => copyIngressField("url", ingressInfo.url)}
                      title="Copy server URL"
                      className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
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
                    <code className="min-w-0 flex-1 truncate rounded-sm bg-white/[0.04] px-2.5 py-1.5 font-mono text-xs text-foreground/90">
                      {keyVisible
                        ? ingressInfo.streamKey
                        : "••••••••••••••••••••••••"}
                    </code>
                    <button
                      onClick={() => setKeyVisible((v) => !v)}
                      title={keyVisible ? "Hide key" : "Reveal key"}
                      className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {keyVisible ? <EyeSlash size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      onClick={() =>
                        copyIngressField("key", ingressInfo.streamKey)
                      }
                      title="Copy stream key"
                      className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-white/[0.05] text-muted-foreground transition-colors hover:text-foreground"
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
                  Same key as always — if it&apos;s already in OBS or vMix, just press Start Streaming.
                  Keep it private; anyone with it can broadcast as you. If the connection drops, keep
                  the encoder running: the stream holds for {Math.round(graceMs / 60_000)} minutes and picks up on its own.
                </p>
              </div>
            )}

            {/* The encoder key — permanent, so it is shown before there is
                a stream to attach it to. */}
            {!isLive && source === "obs" && (
              <div className="mt-5 rounded-sm bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">Your encoder key</p>
                  <button
                    type="button"
                    onClick={rotateKey}
                    disabled={rotatingKey || !streamKey}
                    className="text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {rotatingKey ? "Replacing…" : "Replace key"}
                  </button>
                </div>
                {streamKey ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">Server</span>
                      <code className="min-w-0 flex-1 truncate rounded-sm bg-white/[0.05] px-2.5 py-2 font-mono text-xs text-foreground/90">{streamKey.url}</code>
                      <button onClick={() => copyIngressField("url", streamKey.url)} title="Copy server URL" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground">
                        {copiedField === "url" ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0 text-xs text-muted-foreground">Stream key</span>
                      <code className="min-w-0 flex-1 truncate rounded-sm bg-white/[0.05] px-2.5 py-2 font-mono text-xs text-foreground/90">{keyVisible ? streamKey.streamKey : "••••••••••••••••••••••••"}</code>
                      <button onClick={() => setKeyVisible((v) => !v)} title={keyVisible ? "Hide key" : "Reveal key"} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground">
                        {keyVisible ? <EyeSlash size={14} /> : <Eye size={14} />}
                      </button>
                      <button onClick={() => copyIngressField("key", streamKey.streamKey)} title="Copy stream key" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground">
                        {copiedField === "key" ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 h-[76px] animate-pulse rounded-sm bg-white/[0.04]" />
                )}
                <ul className="mt-3 space-y-1.5 text-[12px] leading-relaxed text-muted-foreground/70">
                  <li>This key is yours for good: set it once in OBS or vMix and start every broadcast from Xtream, then hit Start Streaming in the encoder.</li>
                  <li>If the connection drops mid-stream, keep the encoder running. The stream stays live for {Math.round(graceMs / 60_000)} minutes and picks up where it left off — no new key, no restart.</li>
                  <li>On a weak network: 720p at 30fps, 1500–2500 kbps CBR, keyframe every 2 seconds. Viewers get a lighter picture instead of a dropped one.</li>
                </ul>
              </div>
            )}

            {/* How it will appear on Home, live as you type. */}
            {!isLive && (
              <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-start">
                <div>
                  <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">On the home page</p>
                  <div className="group">
                    <div className="relative aspect-video overflow-hidden rounded-sm bg-white/[0.03]">
                      {customThumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data URI preview
                        <img src={customThumbnail} alt="" className="size-full object-cover" />
                      ) : (
                        <StreamArt src={undefined} category={category} alt="" seed={category} />
                      )}
                      <LiveBadge className="absolute top-2.5 left-2.5" />
                      <span className="absolute right-2.5 bottom-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white">0 watching</span>
                    </div>
                    <div className="mt-2.5 flex gap-2.5">
                      {user && <UserAvatar src={user.avatar} name={user.displayName} size={32} className="size-8 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-medium", title ? "text-foreground" : "text-muted-foreground/60")}>{title || "Your title shows here"}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.displayName ?? "You"}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground/60">{category}</p>
                        {tagList.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {tagList.slice(0, 3).map((t) => (
                              <span key={t} className="rounded-[4px] bg-white/[0.08] px-1.5 py-0.5 text-[10.5px] font-medium text-foreground/80">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-sm bg-white/[0.03] p-4">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">When you go live</p>
                  <ul className="mt-2.5 space-y-2 text-[13px] text-muted-foreground">
                    <li className="flex items-start gap-2.5"><Bell size={15} weight="fill" className="mt-0.5 shrink-0 text-foreground/70" />Your followers get a notification the moment you start, and the stream posts to WorldSpace.</li>
                    <li className="flex items-start gap-2.5"><HandWaving size={15} weight="fill" className="mt-0.5 shrink-0 text-foreground/70" />Viewers can ask to join your stage; you approve them from the rail.</li>
                    <li className="flex items-start gap-2.5"><CurrencyDollar size={15} weight="fill" className="mt-0.5 shrink-0 text-foreground/70" />Gifts land in your wallet as they arrive, and show on the stage for everyone.</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* ---- Rail: setup before the show, the room during it ---- */}
          <div className="flex w-full shrink-0 flex-col overflow-hidden rounded-sm bg-white/[0.02] xl:sticky xl:top-8 xl:h-[calc(100vh-6rem)] xl:w-[360px]">
            {!isLive ? (
              <>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
                  <div>
                    <h2 className="text-[15px] font-semibold text-foreground">Stream setup</h2>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">What viewers see before they click.</p>
                  </div>

                  <div>
                    <label htmlFor="studio-title" className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-foreground/80">
                      Title
                      <span className="text-[11px] font-normal text-muted-foreground/60 tabular-nums">{title.length}/100</span>
                    </label>
                    <input
                      id="studio-title"
                      type="text"
                      placeholder="What's happening today?"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      maxLength={100}
                      className="h-11 w-full rounded-sm bg-white/[0.06] px-3.5 text-[15px] text-foreground transition-colors outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09]"
                    />
                  </div>

                  <div>
                    <label htmlFor="studio-category" className="mb-1.5 block text-[12px] font-medium text-foreground/80">Category</label>
                    <SelectField
                      id="studio-category"
                      full
                      value={category}
                      onChange={(v) => setCategory(v as Category)}
                      groups={CATEGORY_GROUPS.map((g) => ({
                        label: g.label,
                        options: g.topics.map((cat) => ({ value: cat, label: cat })),
                      }))}
                    />
                  </div>

                  <div>
                    <label htmlFor="studio-tags" className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-foreground/80">
                      Tags
                      <span className="text-[11px] font-normal text-muted-foreground/60 tabular-nums">{tagList.length}/6</span>
                    </label>
                    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-sm bg-white/[0.06] px-2.5 py-2 transition-colors focus-within:bg-white/[0.09]">
                      {tagList.map((t) => (
                        <span key={t} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] font-semibold text-neutral-950">
                          {t}
                          <button type="button" onClick={() => removeTag(t)} aria-label={`Remove ${t}`} className="text-neutral-950/60 hover:text-neutral-950">
                            <X size={11} weight="bold" />
                          </button>
                        </span>
                      ))}
                      <input
                        id="studio-tags"
                        type="text"
                        placeholder={tagList.length === 0 ? "Add a tag, press Enter" : ""}
                        value={tagInput}
                        onChange={(e) => (e.target.value.endsWith(",") ? (setTagInput(e.target.value), commitTag()) : setTagInput(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitTag();
                          } else if (e.key === "Backspace" && !tagInput && tagList.length > 0) {
                            removeTag(tagList[tagList.length - 1]!);
                          }
                        }}
                        onBlur={commitTag}
                        className="h-7 min-w-[8rem] flex-1 bg-transparent px-1 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/60"
                      />
                      <Tag size={14} className="ml-auto shrink-0 text-muted-foreground/50" />
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-[12px] font-medium text-foreground/80">Thumbnail</p>
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
                      <div className="relative overflow-hidden rounded-sm">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={customThumbnail} alt="Stream thumbnail" className="aspect-video w-full object-cover" />
                        <button
                          onClick={() => setCustomThumbnail(null)}
                          title="Remove thumbnail"
                          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/60 text-white/80 transition-colors hover:bg-black/80 hover:text-white"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={captureFrame}
                          disabled={!(source === "camera" && previewTrack)}
                          className="flex flex-col items-center justify-center gap-1.5 rounded-sm bg-white/[0.06] py-4 text-foreground/85 transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Aperture size={18} weight="fill" />
                          <span className="text-[12px] font-medium">Capture frame</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => thumbInputRef.current?.click()}
                          className="flex flex-col items-center justify-center gap-1.5 rounded-sm bg-white/[0.06] py-4 text-foreground/85 transition-colors hover:bg-white/[0.09]"
                        >
                          <UploadSimple size={18} weight="bold" />
                          <span className="text-[12px] font-medium">Upload</span>
                        </button>
                        <p className="col-span-2 text-[11px] text-muted-foreground/60">Skip it and a frame is captured the moment you go live.</p>
                      </div>
                    )}
                    {thumbError && <p className="mt-1.5 text-xs text-red-400">{thumbError}</p>}
                  </div>
                </div>

                <div className="border-t border-white/[0.06] p-3">
                  <Button
                    onClick={() => setConfirmDialog("golive")}
                    disabled={!ready.title || isConnecting}
                    className="shine h-12 w-full gap-2 rounded-full bg-red-600 text-[15px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isConnecting ? (
                      <>
                        <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Connecting…
                      </>
                    ) : (
                      <>
                        <Lightning size={17} weight="fill" />
                        Go live
                      </>
                    )}
                  </Button>
                  {!ready.title && <p className="mt-2 text-center text-[11.5px] text-muted-foreground/70">Give the stream a title to go live.</p>}
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
                        "relative flex flex-1 items-center justify-center gap-1.5 rounded-sm py-2 text-xs transition-colors",
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
                      <p className="rounded-sm bg-red-500/10 px-3 py-2 text-xs text-red-400">
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
                              className="flex items-center gap-2.5 rounded-sm bg-white/[0.04] px-2.5 py-2"
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
                                className="flex h-7 items-center gap-1 rounded-sm bg-red-500/10 px-2 text-[0.65rem] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
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
                              className="flex items-center gap-2.5 rounded-sm bg-white/[0.04] px-2.5 py-2"
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
                                className="flex h-7 items-center gap-1 rounded-sm bg-primary px-2 text-[0.65rem] font-medium text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-50"
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
                                className="flex size-7 items-center justify-center rounded-sm bg-white/[0.06] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
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
                            className="flex items-center gap-3 rounded-sm px-2 py-2 hover:bg-white/[0.03]"
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
                    className="h-10 w-full gap-2 rounded-sm bg-red-600 text-sm font-medium text-white transition-colors hover:bg-red-700"
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
        <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="animate-pop-in mx-4 w-full max-w-sm rounded-sm border border-white/[0.08] bg-[oklch(0.15_0.005_285)] p-6 text-center shadow-[0_16px_50px_-16px_rgba(0,0,0,0.85)]">
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
                  : `You're about to broadcast "${title}" to everyone on Xtream.`
                : `Your stream will end for all ${viewerCount} viewer${viewerCount !== 1 ? "s" : ""} and can't be resumed.`}
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="h-10 flex-1 rounded-sm bg-white/[0.06] text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.09] hover:text-foreground"
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
                  "h-10 flex-1 rounded-sm text-sm font-medium text-white transition-colors",
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
