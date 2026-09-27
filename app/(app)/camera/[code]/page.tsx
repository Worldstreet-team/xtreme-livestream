"use client";

import { use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { LocalVideoTrack, Room } from "livekit-client";
import { CameraRotate, Stop, VideoCamera, WarningCircle } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { apiFetch, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * The phone page (Phase 3, angles): scanned off the studio's QR, this
 * phone is the second camera. One job — ask for the camera, then send it
 * into the host's live room as `cam-<hostId>`. It never publishes the mic,
 * subscribes to nothing, and needs no sign-in: the code is the key.
 *
 * It's patient. Before the host goes live it holds the code and asks
 * again every few seconds; when the room drops it comes back on the same
 * token; and it can tell the stream ending from another phone taking over
 * and from a code that's run out.
 */

type Facing = "environment" | "user";
type Phase =
  /** Before the camera's on: one big button. */
  | "idle"
  | "starting"
  /** No permission, or no camera at all. */
  | "denied"
  /** Camera on; the host isn't live yet, and we keep asking. */
  | "waiting"
  | "joining"
  | "sending"
  /** The room dropped: back in on the same token, in a moment. */
  | "reconnecting"
  | "ended"
  /** Another phone joined as this camera. */
  | "elsewhere"
  | "expired"
  | "stopped";

interface Join {
  token: string;
  livekitUrl: string;
  streamId: string;
  hostName: string;
}

/** While sending, look every so often that the stream's still on: the room needn't close when the host ends. */
const LIVE_POLL_MS = 15_000;
/** Back into the room after a drop: quick at first, then every ten seconds. */
const RECONNECT_MS = [2_000, 4_000, 7_000, 10_000];
/** Asking again when the join can't be reached at all (the phone's data blinked). */
const RETRY_MS = 5_000;
/** 720p, like the studio: the room's simulcast ladder sits under it. */
const CAPTURE = { width: 1280, height: 720, frameRate: 30 };
/** Camera, sending, waiting, back in a moment: the phases that keep the screen awake. */
const AWAKE: Phase[] = ["waiting", "joining", "sending", "reconnecting"];

function usePhoneCamera(code: string) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [hostName, setHostName] = useState<string | null>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<LocalVideoTrack | null>(null);
  const roomRef = useRef<Room | null>(null);
  const joinRef = useRef<Join | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const alive = useRef(true);

  const schedule = useCallback((fn: () => void, ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (alive.current) fn();
    }, ms);
  }, []);

  const stopCamera = useCallback(() => {
    const track = trackRef.current;
    trackRef.current = null;
    if (!track) return;
    track.detach();
    track.stop();
  }, []);

  const leaveRoom = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect().catch(() => {});
  }, []);

  /** Into the room on the token we hold, publishing the camera and nothing else. */
  const connect = useCallback(async () => {
    const join = joinRef.current;
    const track = trackRef.current;
    if (!join || !track || !alive.current) return;
    setPhase("joining");
    const { Room: LKRoom, RoomEvent, Track, VideoPresets, DisconnectReason } = await import("livekit-client");
    if (!alive.current) return;
    const room = new LKRoom({
      // Pause simulcast layers nobody is watching.
      dynacast: true,
      publishDefaults: {
        videoCodec: "vp8",
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      },
    });
    roomRef.current = room;
    room
      .on(RoomEvent.Reconnecting, () => roomRef.current === room && setPhase("reconnecting"))
      .on(RoomEvent.Reconnected, () => roomRef.current === room && setPhase("sending"))
      .on(RoomEvent.Disconnected, (reason) => {
        // An old room's news, or our own Stop.
        if (roomRef.current !== room) return;
        roomRef.current = null;
        if (reason === DisconnectReason.CLIENT_INITIATED) return;
        if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
          setPhase("ended");
          stopCamera();
          return;
        }
        if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
          setPhase("elsewhere");
          stopCamera();
          return;
        }
        // LiveKit gave up on its own reconnect: come back on the same token.
        setPhase("reconnecting");
        schedule(() => void connect(), RECONNECT_MS[Math.min(attemptRef.current++, RECONNECT_MS.length - 1)]);
      });
    try {
      await room.connect(join.livekitUrl, join.token);
      await room.localParticipant.publishTrack(track, { source: Track.Source.Camera, simulcast: true });
      if (!alive.current) return;
      attemptRef.current = 0;
      setPhase("sending");
    } catch {
      if (roomRef.current === room) roomRef.current = null;
      void room.disconnect().catch(() => {});
      if (!alive.current) return;
      setPhase("reconnecting");
      schedule(() => void connect(), RECONNECT_MS[Math.min(attemptRef.current++, RECONNECT_MS.length - 1)]);
    }
  }, [schedule, stopCamera]);

  /** Trade the code for a token — or wait, with the same code, until the host is live. */
  const join = useCallback(async () => {
    if (!alive.current) return;
    try {
      const r = await apiFetch<{ success: boolean; data: Join }>(`/api/camera/${encodeURIComponent(code)}/join`, { method: "POST" });
      if (!alive.current) return;
      joinRef.current = r.data;
      setHostName(r.data.hostName);
      await connect();
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError) {
        const body = err.data as { code?: string; retryInMs?: number; hostName?: string } | null;
        if (err.status === 409 && body?.code === "NOT_LIVE") {
          if (body.hostName) setHostName(body.hostName);
          setPhase("waiting");
          schedule(() => void join(), body.retryInMs ?? RETRY_MS);
          return;
        }
        if (err.status === 404 || err.status === 410) {
          setPhase("expired");
          stopCamera();
          return;
        }
      }
      // Couldn't reach the API at all: the phone's data blinked. Ask again.
      setPhase("waiting");
      schedule(() => void join(), RETRY_MS);
    }
  }, [code, connect, schedule, stopCamera]);

  /** Turn the camera on (rear first), show it, and start asking to join. */
  const start = useCallback(
    async (face: Facing = "environment") => {
      setPhase("starting");
      try {
        const { createLocalVideoTrack } = await import("livekit-client");
        const track = await createLocalVideoTrack({ facingMode: face, resolution: CAPTURE });
        if (!alive.current) {
          track.stop();
          return;
        }
        trackRef.current = track;
        setFacing(face);
        if (videoRef.current) track.attach(videoRef.current);
      } catch {
        if (alive.current) setPhase("denied");
        return;
      }
      setPhase("waiting");
      void join();
    },
    [join]
  );

  /** The other camera, keeping the same publication — viewers see the switch, not a gap. */
  const flip = useCallback(async () => {
    const track = trackRef.current;
    if (!track) return;
    const next: Facing = facing === "environment" ? "user" : "environment";
    try {
      await track.restartTrack({ facingMode: next, resolution: CAPTURE });
      if (alive.current) setFacing(next);
    } catch {
      // One camera only: stay on it.
    }
  }, [facing]);

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    leaveRoom();
    stopCamera();
    setPhase("stopped");
  }, [leaveRoom, stopCamera]);

  // Leaving the page is the same as Stop, quietly.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      leaveRoom();
      stopCamera();
    };
  }, [leaveRoom, stopCamera]);

  // Before asking for the camera: whose second camera this would be — and
  // a dead code says so now, not after the phone has handed over its lens.
  useEffect(() => {
    let current = true;
    void apiFetch<{ success: boolean; data: { hostName: string; live: boolean } }>(`/api/camera/${encodeURIComponent(code)}`)
      .then((r) => {
        if (current && alive.current) setHostName(r.data.hostName);
      })
      .catch((err) => {
        if (!current || !alive.current) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 410)) setPhase((p) => (p === "idle" ? "expired" : p));
        // Anything else (the phone's data blinked): the button still works, and the join will say.
      });
    return () => {
      current = false;
    };
  }, [code]);

  // The stream can end without the room closing: check, and stand down.
  useEffect(() => {
    if (phase !== "sending" && phase !== "reconnecting") return;
    const check = async () => {
      const streamId = joinRef.current?.streamId;
      if (!streamId) return;
      try {
        const r = await apiFetch<{ success: boolean; data: { stream: { isLive?: boolean } | null } }>(`/api/streams/${streamId}`);
        // Only a clear "not live" ends it: a blip, or a private practice
        // room the phone can't read, keeps us sending.
        if (alive.current && r.data.stream && r.data.stream.isLive === false) {
          leaveRoom();
          stopCamera();
          setPhase("ended");
        }
      } catch {
        // Ask again next time.
      }
    };
    const timer = setInterval(() => void check(), LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, leaveRoom, stopCamera]);

  // A phone that dims goes dark on air: keep the screen awake while it matters.
  useEffect(() => {
    if (!AWAKE.includes(phase) || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        // Low battery, or a browser that won't: the phone dims as it would.
      }
    };
    // A lock lets go when the page is hidden; take it again when it's back.
    const onVisible = () => {
      if (document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [phase]);

  return { phase, hostName, facing, videoRef, start, flip, stop };
}

/** The line in the corner while the camera's on. */
function statusOf(phase: Phase, hostName: string | null): { dot: string; text: string } | null {
  const host = hostName ?? "the host";
  switch (phase) {
    case "sending":
      return { dot: "bg-chili", text: `Sending · ${host}` };
    case "waiting":
      return { dot: "animate-pulse bg-ember", text: hostName ? `Waiting for ${hostName} to go live` : "Waiting for the host" };
    case "joining":
      return { dot: "animate-pulse bg-ember", text: "Joining…" };
    case "reconnecting":
      return { dot: "animate-pulse bg-white/70", text: "Lost the connection — reconnecting…" };
    default:
      return null;
  }
}

export default function CameraPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { phase, hostName, facing, videoRef, start, flip, stop } = usePhoneCamera(code);
  const cameraOn = phase === "waiting" || phase === "joining" || phase === "sending" || phase === "reconnecting";
  const status = statusOf(phase, hostName);

  // What the screen says when there's no picture to show.
  let note: { title: string; body: string; action?: ReactNode; warn?: boolean } | null = null;
  if (phase === "idle") {
    note = {
      title: hostName ? `${hostName}'s second camera` : "Phone camera",
      body: "Turn on this phone's camera and it becomes a second angle on the stream. No app, no sign-in — and nothing from its mic is ever sent.",
      action: (
        <Pill variant="live" size="xl" icon={<VideoCamera size={19} />} onClick={() => void start()}>
          Turn on the camera
        </Pill>
      ),
    };
  } else if (phase === "starting") {
    note = { title: "Starting the camera…", body: "Allow the camera if the phone asks." };
  } else if (phase === "denied") {
    note = {
      title: "The camera isn't available",
      body: "Allow the camera in this browser's settings, then try again.",
      warn: true,
      action: (
        <Pill variant="primary" size="lg" onClick={() => void start()}>
          Try again
        </Pill>
      ),
    };
  } else if (phase === "ended") {
    note = { title: "The host ended the stream", body: "Thanks — you can put the phone down." };
  } else if (phase === "elsewhere") {
    note = { title: "Another phone took over", body: "This stream's phone camera is sending from another phone now." };
  } else if (phase === "expired") {
    note = { title: "This link has expired", body: "Scan a fresh code in the studio to send from this phone.", warn: true };
  } else if (phase === "stopped") {
    note = { title: "Camera stopped", body: "To send again, scan a fresh code in the studio." };
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background md:min-h-0 md:items-center md:py-10">
      <section aria-label="Phone camera" className="relative flex flex-1 flex-col md:w-[420px] md:flex-none md:rounded-[16px] md:bg-white/[0.04] md:p-3">
        {/* The viewfinder: the whole phone, or a phone-shaped frame on a desktop. */}
        <div className="relative flex-1 overflow-hidden bg-black md:aspect-[9/16] md:flex-none md:rounded-[12px]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            // A selfie reads like a mirror; the rear camera reads like the world.
            className={cn("size-full object-cover", facing === "user" && "-scale-x-100", !cameraOn && "hidden")}
          />
          {status && (
            <p role="status" aria-live="polite" className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[12.5px] font-semibold text-white">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-full", status.dot)} />
              <span className="truncate">{status.text}</span>
            </p>
          )}
          {phase === "waiting" && (
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-6 pb-6 pt-14 text-center text-white">
              <p className="font-wide text-[20px] font-bold tracking-[-0.02em]">Point it at the action</p>
              <p className="text-[13.5px] text-white/75">It starts sending the moment the stream does.</p>
            </div>
          )}
          {note && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-7 text-center">
              <span className={cn("flex size-14 items-center justify-center rounded-full", note.warn ? "bg-chili/15 text-chili-hi" : "bg-white/[0.08] text-white/80")}>
                {note.warn ? <WarningCircle size={26} /> : <VideoCamera size={26} />}
              </span>
              <div>
                <h1 className="font-wide text-[22px] font-bold tracking-[-0.02em] text-white">{note.title}</h1>
                <p className="mt-2 text-[14px] leading-relaxed text-white/70">{note.body}</p>
              </div>
              {note.action}
            </div>
          )}
        </div>

        {/* The two controls, big enough for a thumb. */}
        {cameraOn && (
          <div className="flex items-center justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:px-1 md:pb-1">
            <Pill variant="glass" size="lg" icon={<CameraRotate size={18} />} onClick={() => void flip()}>
              Flip
            </Pill>
            <Pill variant="soft" tone="red" size="lg" icon={<Stop size={18} />} onClick={stop}>
              Stop
            </Pill>
          </div>
        )}
      </section>
    </div>
  );
}
