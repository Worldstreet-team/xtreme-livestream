"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import {
  VideoCamera,
  Monitor,
  Microphone,
  MicrophoneSlash,
  Camera,
  CameraSlash,
  Gear,
  Lightning,
  Eye,
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
import { CATEGORIES, CATEGORY_COLORS, type Category } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { captureVideoFrame, compressImage } from "@/lib/image-utils";
import { LiveChat } from "@/components/app/live-chat";
import type {
  Room,
  LocalVideoTrack,
  LocalAudioTrack,
} from "livekit-client";

type SourceType = "camera" | "screen";
type StudioTab = "settings" | "chat" | "viewers";

export default function StudioPage() {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("Bitcoin Trading");
  const [tags, setTags] = useState("");
  const [source, setSource] = useState<SourceType>("camera");
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
        };
      }>("/api/streams", {
        method: "POST",
        body: JSON.stringify({ title, category, tags: tagList, thumbnail }),
      });

      const { livekitToken, livekitUrl } = res.data;
      createdStreamId = res.data.stream.id;
      setStreamId(createdStreamId);

      // Step 2: Stop preview track
      if (previewTrack) {
        previewTrack.stop();
        setPreviewTrack(null);
      }

      // Step 3: Connect to LiveKit room
      const { Room: LKRoom, RoomEvent, VideoPresets } = await import("livekit-client");
      const room = new LKRoom({
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        publishDefaults: {
          videoCodec: "vp8",
        },
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        setViewerCount(room.remoteParticipants.size);
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
        setViewerCount(room.remoteParticipants.size);
        setConnectedViewers((prev) =>
          prev.filter((v) => v.identity !== participant.identity)
        );
      });

      await room.connect(livekitUrl, livekitToken);
      roomRef.current = room;
      setLiveRoom(room);

      // Step 4: Publish camera/screen + audio (this triggers browser permission prompts)
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
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

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

  // Warn before closing/refreshing the tab while live — leaving stops the broadcast
  useEffect(() => {
    if (!isLive) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isLive]);

  // Warn before in-app navigation while live (the browser is the publisher,
  // so leaving the studio page ends the broadcast)
  useEffect(() => {
    if (!isLive) return;
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

  return (
    <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {isLive ? "You're Live!" : "Go Live"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isLive
              ? `Broadcasting for ${elapsed}  •  ${viewerCount} viewer${viewerCount !== 1 ? "s" : ""}`
              : "Set up your stream and go live to the world"}
          </p>
        </div>
        {isLive && streamId && (
          <button
            onClick={shareStream}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ShareNetwork size={16} />
            {shareCopied ? "Link copied!" : "Share stream"}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Preview panel (2/3) */}
        <div className="lg:col-span-2">
          {/* Video preview */}
          <div
            className="relative aspect-video overflow-hidden rounded-xl border border-white/5 bg-black"
            onMouseMove={isLive ? showControls : undefined}
            onTouchStart={isLive ? showControls : undefined}
          >
            <video
              ref={videoElRef}
              autoPlay
              muted
              playsInline
              className="size-full object-cover -scale-x-100"
            />

            {/* LIVE badge overlay */}
            {isLive && (
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-white" />
                  </span>
                  LIVE
                </div>
                <div className="flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white/80 backdrop-blur-sm">
                  <Eye size={14} />
                  {viewerCount}
                </div>
                <div className="rounded-md bg-black/60 px-2 py-1 text-xs font-mono text-white/80 backdrop-blur-sm">
                  {elapsed}
                </div>
              </div>
            )}

            {/* No preview fallback */}
            {!previewTrack && !isLive && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  {source === "camera" ? (
                    <VideoCamera
                      size={48}
                      className="mx-auto text-white/20"
                    />
                  ) : (
                    <Monitor size={48} className="mx-auto text-white/20" />
                  )}
                  <p className="mt-3 text-sm text-white/40">
                    {source === "camera"
                      ? "Requesting camera access..."
                      : "Screen share will start when you go live"}
                  </p>
                </div>
              </div>
            )}

            {/* Stream overlay controls */}
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
                    ? "bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
                    : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                )}
              >
                {micEnabled ? (
                  <Microphone size={20} />
                ) : (
                  <MicrophoneSlash size={20} />
                )}
              </button>
              <button
                onClick={toggleCam}
                className={cn(
                  "flex size-10 items-center justify-center rounded-full transition-colors",
                  camEnabled
                    ? "bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
                    : "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                )}
              >
                {camEnabled ? (
                  <Camera size={20} />
                ) : (
                  <CameraSlash size={20} />
                )}
              </button>
              {isLive && (
                <button
                  onClick={toggleScreenShare}
                  title={screenShareActive ? "Stop screen share" : "Share screen"}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full transition-colors",
                    screenShareActive
                      ? "bg-primary/20 text-primary hover:bg-primary/30"
                      : "bg-white/10 text-white backdrop-blur-sm hover:bg-white/20"
                  )}
                >
                  <MonitorArrowUp size={20} />
                </button>
              )}
              <button
                onClick={() => setActiveTab("settings")}
                title="Stream settings"
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Gear size={20} />
              </button>
            </div>

          {/* Source selection (disabled when live) */}
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => !isLive && setSource("camera")}
              disabled={isLive}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors",
                source === "camera"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                isLive && "cursor-not-allowed opacity-50"
              )}
            >
              <VideoCamera size={18} />
              Camera
            </button>
            <button
              onClick={() => !isLive && setSource("screen")}
              disabled={isLive}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg border py-3 text-sm font-medium transition-colors",
                source === "screen"
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                isLive && "cursor-not-allowed opacity-50"
              )}
            >
              <Monitor size={18} />
              Screen Share
            </button>
          </div>
        </div>

        {/* Right panel (1/3) — tabbed */}
        <div className="flex flex-col">
          {/* Tab bar */}
          <div className="flex rounded-t-xl border border-white/5 bg-white/[0.02]">
            <button
              onClick={() => setActiveTab("settings")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-tl-xl py-2.5 text-xs font-medium transition-colors",
                activeTab === "settings"
                  ? "border-b-2 border-primary bg-primary/5 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Gear size={14} />
              Settings
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors",
                activeTab === "chat"
                  ? "border-b-2 border-primary bg-primary/5 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ChatText size={14} />
              Chat
              {isLive && activeTab !== "chat" && (
                <span className="absolute top-1.5 right-3 size-1.5 animate-pulse rounded-full bg-green-400" />
              )}
            </button>
            <button
              onClick={() => setActiveTab("viewers")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-tr-xl py-2.5 text-xs font-medium transition-colors",
                activeTab === "viewers"
                  ? "border-b-2 border-primary bg-primary/5 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UsersThree size={14} />
              {isLive ? viewerCount : 0}
            </button>
          </div>

          {/* Tab content */}
          <div className="rounded-b-xl border border-t-0 border-white/5">
            {/* Settings tab */}
            <div className={cn(
              "max-h-[480px] space-y-4 overflow-y-auto p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10",
              activeTab !== "settings" && "hidden"
            )}>
                <h2 className="text-sm font-semibold text-foreground">
                  Stream Details
                </h2>

                {/* Title */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Title *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., BTC Live Trading & Analysis"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    disabled={isLive}
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    {title.length}/100
                  </p>
                </div>

                {/* Category */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                    disabled={isLive}
                    className="h-10 w-full cursor-pointer rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-foreground focus:border-primary/50 focus:outline-none disabled:opacity-50"
                  >
                    {CATEGORIES.map((cat) => (
                      <option className="bg-background text-foreground" key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Tags */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    Tags (comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="bitcoin, trading, analysis"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    disabled={isLive}
                    className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
                  />
                </div>

                {/* Thumbnail */}
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
                    <div className="relative overflow-hidden rounded-lg border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={customThumbnail}
                        alt="Stream thumbnail"
                        className="aspect-video w-full object-cover"
                      />
                      <button
                        onClick={() => setCustomThumbnail(null)}
                        disabled={isLive}
                        title="Remove thumbnail"
                        className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-black/60 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/80 hover:text-white disabled:opacity-50"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => thumbInputRef.current?.click()}
                      disabled={isLive}
                      className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/15 bg-white/[0.03] py-6 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <UploadSimple size={20} />
                      <span className="text-xs font-medium">
                        Upload a custom thumbnail
                      </span>
                      <span className="text-[0.6rem] text-muted-foreground/60">
                        JPEG, PNG or WebP — otherwise we capture one from your
                        camera
                      </span>
                    </button>
                  )}
                  {thumbError && (
                    <p className="mt-1.5 text-xs text-red-400">{thumbError}</p>
                  )}
                </div>

                {/* Preview card */}
                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Stream Preview
                  </h3>
                  <div className="flex items-center gap-3">
                    {user && (
                      <UserAvatar
                        src={user.avatar}
                        name={user.displayName}
                        size={36}
                        className="size-9"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {title || "Untitled Stream"}
                      </p>
                      <span
                        className={cn(
                          "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[0.6rem] font-medium",
                          CATEGORY_COLORS[category]
                        )}
                      >
                        {category}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Chat tab — always mounted so messages persist */}
            <div className={cn("h-[480px]", activeTab !== "chat" && "hidden")}>
              {streamId ? (
                <LiveChat
                  streamId={streamId}
                  room={liveRoom}
                  isLive={isLive}
                  isHost
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <ChatText
                      size={32}
                      className="mx-auto text-muted-foreground/20"
                    />
                    <p className="mt-2 text-xs text-muted-foreground/50">
                      Go live to enable chat
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Viewers tab */}
            <div
              className={cn(
                "h-[480px] overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10",
                activeTab !== "viewers" && "hidden"
              )}
            >
              <div className="p-4">
                {!isLive ? (
                  <div className="flex h-full items-center justify-center pt-20">
                    <div className="text-center">
                      <UsersThree
                        size={32}
                        className="mx-auto text-muted-foreground/20"
                      />
                      <p className="mt-2 text-xs text-muted-foreground/50">
                        Go live to see viewers
                      </p>
                    </div>
                  </div>
                ) : connectedViewers.length === 0 ? (
                  <div className="flex h-full items-center justify-center pt-20">
                    <div className="text-center">
                      <UsersThree
                        size={32}
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
                        <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
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
          </div>

          {/* Go Live / End Stream button */}
          <div className="mt-4">
            {isLive ? (
              <Button
                onClick={() => setConfirmDialog("end")}
                className="h-12 w-full gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-700"
              >
                End Stream
              </Button>
            ) : (
              <Button
                onClick={() => setConfirmDialog("golive")}
                disabled={!title.trim() || isConnecting}
                className="h-12 w-full gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isConnecting ? (
                  <>
                    <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Lightning size={20} weight="fill" />
                    Go Live
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Go Live / End Stream confirmation dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-background p-6 text-center shadow-2xl">
            <div
              className={cn(
                "mx-auto mb-4 flex size-14 items-center justify-center rounded-full",
                confirmDialog === "golive" ? "bg-primary/10" : "bg-red-500/10"
              )}
            >
              {confirmDialog === "golive" ? (
                <Lightning size={26} weight="fill" className="text-primary" />
              ) : (
                <Warning size={26} className="text-red-400" />
              )}
            </div>
            <h2 className="text-lg font-bold text-foreground">
              {confirmDialog === "golive" ? "Ready to go live?" : "End stream?"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {confirmDialog === "golive"
                ? `You're about to broadcast "${title}" to everyone on Xtreme.`
                : `Your stream will end for all ${viewerCount} viewer${viewerCount !== 1 ? "s" : ""} and can't be resumed.`}
            </p>
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => setConfirmDialog(null)}
                className="h-11 flex-1 rounded-lg border border-white/10 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
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
                  "h-11 flex-1 rounded-lg text-sm font-semibold text-white transition-colors",
                  confirmDialog === "golive"
                    ? "bg-primary text-primary-foreground hover:bg-primary/80"
                    : "bg-red-600 hover:bg-red-700"
                )}
              >
                {confirmDialog === "golive" ? "Go Live" : "End Stream"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
