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
  Copy,
  Eye,
  Info,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CATEGORIES, CATEGORY_COLORS, type Category } from "@/lib/mock-data";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import type {
  Room,
  LocalVideoTrack,
  LocalAudioTrack,
} from "livekit-client";

type SourceType = "camera" | "screen";

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

      const res = await apiFetch<{
        success: boolean;
        data: {
          stream: { id: string; livekitRoomName: string };
          livekitToken: string;
          livekitUrl: string;
        };
      }>("/api/streams", {
        method: "POST",
        body: JSON.stringify({ title, category, tags: tagList }),
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

      room.on(RoomEvent.ParticipantConnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });
      room.on(RoomEvent.ParticipantDisconnected, () => {
        setViewerCount(room.remoteParticipants.size);
      });

      await room.connect(livekitUrl, livekitToken);
      roomRef.current = room;

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  return (
    <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          {isLive ? "You're Live!" : "Go Live"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isLive
            ? `Broadcasting for ${elapsed}  •  ${viewerCount} viewer${viewerCount !== 1 ? "s" : ""}`
            : "Set up your stream and go live to the world"}
        </p>
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
          <div className="relative aspect-video overflow-hidden rounded-xl border border-white/5 bg-black">
            <video
              ref={videoElRef}
              autoPlay
              muted
              playsInline
              className="size-full object-cover"
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
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
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
              <button className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20">
                <Gear size={20} />
              </button>
            </div>
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

          {/* Stream key */}
          <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="mb-2 flex items-center gap-2">
              <Info size={14} className="text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Stream Key (for OBS / external software)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-white/5 px-3 py-2 font-mono text-xs text-muted-foreground">
                {"•".repeat(24)}
              </code>
              <button
                onClick={() =>
                  user?.streamKey &&
                  navigator.clipboard?.writeText(user.streamKey)
                }
                className="flex size-8 items-center justify-center rounded-md border border-white/10 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Settings panel (1/3) */}
        <div className="space-y-5">
          {/* Stream info */}
          <div className="space-y-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
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
                  <option key={cat} value={cat}>
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
          </div>

          {/* Preview card */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Stream Preview
            </h3>
            <div className="flex items-center gap-3">
              {user && (
                <Image
                  src={user.avatar}
                  alt={user.displayName}
                  width={36}
                  height={36}
                  className="size-9 rounded-full bg-white/10"
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

          {/* Go Live / End Stream button */}
          {isLive ? (
            <Button
              onClick={endStream}
              className="h-12 w-full gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-700"
            >
              End Stream
            </Button>
          ) : (
            <Button
              onClick={goLive}
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
  );
}
