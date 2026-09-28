"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LocalVideoTrack, RemoteTrack } from "livekit-client";
import {
  CameraRotate,
  CornersOut,
  Microphone,
  MicrophoneSlash,
  Phone,
  PhoneDisconnect,
  PictureInPicture,
  VideoCamera,
  VideoCameraSlash,
  WarningCircle,
  X,
} from "@/components/icons";
import { UserAvatar } from "@/components/xtream";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";
import { CALL_END_COPY, callManager, formatCallClock, type CallPeer } from "@/lib/call-manager";
import { useCall } from "./call-provider";
import { ViaTag } from "@/components/app/messages/via-tag";
import { reducedMotion } from "@/components/app/messages/motion";
import { RING_CYCLE_MS, ringClock, type RingMode } from "./use-call-tones";

/**
 * The one surface a call lives on, in all its shapes:
 *
 *  - ringing in, on a wide screen — a card drops in top-right and the app
 *    stays usable underneath; on a phone it takes the screen, like phones do
 *  - a voice call — the person, big, and a clock; a video call — the picture
 *    is the ground, controls float over it on the flat video chip (`.obj`)
 *  - a group call — everyone tiled, an Ember ring on whoever is speaking
 *  - docked — a small card you can drag anywhere while you keep browsing
 *
 * All of it renders from one state, so docking never touches the media.
 * Afterglow throughout: flat fills, no outlines, the heat gradient only as
 * the caller's ring, Chili only on the red button that hangs up.
 */

/* ------------------------------------------------------------------ media */

function useAttach(ref: React.RefObject<HTMLMediaElement | null>, track: LocalVideoTrack | RemoteTrack | null) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [ref, track]);
}

function VideoTile({ track, mirrored, className }: { track: LocalVideoTrack | RemoteTrack | null; mirrored?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useAttach(ref, track);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      // Your own preview stays muted, or you hear yourself.
      muted={mirrored}
      className={cn("size-full object-cover", mirrored && "-scale-x-100", className)}
    />
  );
}

/** Remote audio has to live in the page, or the call is silent. */
function RemoteAudio({ track }: { track: RemoteTrack | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useAttach(ref, track);
  return <audio ref={ref} autoPlay className="hidden" />;
}

/* ---------------------------------------------------------------- helpers */

function useElapsed(startedAt: number | null) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [startedAt]);
  return startedAt && now ? formatCallClock(now - startedAt) : null;
}

/** Asked once a camera is live: enumerateDevices is only honest after permission. */
function useHasMultipleCameras(active: boolean) {
  const [many, setMany] = useState(false);
  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => !cancelled && setMany(devices.filter((d) => d.kind === "videoinput").length > 1))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active]);
  return many;
}

function Dots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("msg-dots", className)}>
      <span />
      <span />
      <span />
    </span>
  );
}

type Tone = "neutral" | "engaged" | "end" | "accept" | "obj";

/** A round call control. Engaged toggles (muted, camera off) turn white —
 *  the one thing that's on is white, the same flat language as the stage. */
function RoundButton({
  label,
  tip,
  onClick,
  tone = "neutral",
  size = "lg",
  showLabel = false,
  disabled,
  children,
}: {
  label: string;
  /** The tooltip, when the label alone is too terse ("Flip"). Defaults to the label. */
  tip?: string;
  onClick: () => void;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // No tooltip while the label is printed under the button.
  const button = (
    <Tip label={tip ?? label} disabled={showLabel}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          "msg-press flex shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50",
          size === "lg" ? "size-16" : size === "md" ? "size-12" : "size-10",
          tone === "neutral" && "bg-white/[0.09] text-white hover:bg-white/[0.15]",
          tone === "obj" && "obj text-white hover:bg-black/70",
          tone === "engaged" && "bg-white text-[#0b0708]",
          tone === "end" && "bg-chili text-white hover:brightness-110",
          tone === "accept" && "bg-white text-[#0b0708] hover:bg-white/90",
        )}
      >
        {children}
      </button>
    </Tip>
  );
  if (!showLabel) return button;
  return (
    <span className="flex w-[4.5rem] flex-col items-center gap-2">
      {button}
      <span className="text-[12px] font-medium text-white/70">{label}</span>
    </span>
  );
}

/** Hang-up glyph: the handset turned down, so decline and accept differ by
 *  shape, not only by colour. */
function HangUp({ size }: { size: number }) {
  return <PhoneDisconnect size={size} weight="fill" />;
}

/** Where a call is while you wait on it: ringing in, ringing out, or connecting. */
type RingPhase = RingMode | "connecting" | null;

const ease = { out: "cubic-bezier(0.2, 0.8, 0.2, 1)", io: "cubic-bezier(0.45, 0, 0.55, 1)" };
/** Ringing in: two beats while the tone sounds (its first second of three), each sending a ripple out; then still. */
const BEATS: Record<RingMode, { ring: Keyframe[]; ripples: Keyframe[][] }> = {
  incoming: {
    ring: [
      { transform: "scale(1)", offset: 0, easing: ease.out },
      { transform: "scale(1.07)", offset: 0.05, easing: ease.io },
      { transform: "scale(1)", offset: 0.14, easing: ease.out },
      { transform: "scale(1.05)", offset: 0.19, easing: ease.io },
      { transform: "scale(1)", offset: 0.3 },
      { transform: "scale(1)", offset: 1 },
    ],
    ripples: [
      [
        { transform: "scale(1)", opacity: 0.55, offset: 0, easing: ease.out },
        { transform: "scale(1.5)", opacity: 0, offset: 0.4 },
        { transform: "scale(1.5)", opacity: 0, offset: 1 },
      ],
      [
        { transform: "scale(1)", opacity: 0, offset: 0 },
        { transform: "scale(1)", opacity: 0, offset: 0.139 },
        { transform: "scale(1)", opacity: 0.4, offset: 0.14, easing: ease.out },
        { transform: "scale(1.4)", opacity: 0, offset: 0.5 },
        { transform: "scale(1.4)", opacity: 0, offset: 1 },
      ],
    ],
  },
  // Ringing out: one slow swell for the ringback's pulse (1.1s of every 4), one ripple.
  outgoing: {
    ring: [
      { transform: "scale(1)", offset: 0, easing: ease.out },
      { transform: "scale(1.06)", offset: 0.08, easing: ease.io },
      { transform: "scale(1)", offset: 0.275 },
      { transform: "scale(1)", offset: 1 },
    ],
    ripples: [
      [
        { transform: "scale(1)", opacity: 0.45, offset: 0, easing: ease.out },
        { transform: "scale(1.5)", opacity: 0, offset: 0.35 },
        { transform: "scale(1.5)", opacity: 0, offset: 1 },
      ],
    ],
  },
};

/**
 * The person (or group) on the call, in their heat ring (the owner's picks,
 * 2026-09-26). Ringing, the ring beats in time with the tone — both read
 * one clock — and each beat sends a hollow ripple out; between tones it
 * rests. Connecting, a short arc of heat orbits it once every 1.8s. Rings
 * are on Afterglow's heat allowlist; a ring, never a filled glow.
 */
function CallFace({ peer, size, phase, isGroup }: { peer: CallPeer; size: number; phase: RingPhase; isGroup: boolean }) {
  const ringRef = useRef<HTMLSpanElement>(null);
  const rippleRefs = [useRef<HTMLSpanElement>(null), useRef<HTMLSpanElement>(null)];
  const beating: RingMode | null = phase === "incoming" || phase === "outgoing" ? phase : null;

  useLayoutEffect(() => {
    if (!beating || reducedMotion()) return;
    const cycle = RING_CYCLE_MS[beating];
    const start = ringClock(beating);
    const loop = (el: HTMLElement | null, frames: Keyframe[]) => {
      if (!el) return null;
      const a = el.animate(frames, { duration: cycle, iterations: Infinity });
      // Locked to the tone: time zero is the moment it started ringing.
      a.startTime = start;
      return a;
    };
    const beat = BEATS[beating];
    const anims = [loop(ringRef.current, beat.ring), ...beat.ripples.map((frames, i) => loop(rippleRefs[i].current, frames))];
    return () => anims.forEach((a) => a?.cancel());
    // The refs are stable; the beat changes with the phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beating]);

  const hollow = "absolute inset-0 rounded-full bg-heat p-[2px] opacity-0 [mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]";
  return (
    <span className="relative inline-flex shrink-0 p-[2px]">
      {beating && <span ref={rippleRefs[0]} aria-hidden className={hollow} />}
      {beating === "incoming" && <span ref={rippleRefs[1]} aria-hidden className={hollow} />}
      <span ref={ringRef} aria-hidden className={cn("absolute inset-0 rounded-full bg-heat transition-opacity duration-300", phase === "connecting" && "opacity-55")} />
      {phase === "connecting" && <span aria-hidden className="call-orbit absolute -inset-[6px] rounded-full" />}
      <span className="relative inline-flex rounded-full bg-[#0b0708] p-[2px]">
        <UserAvatar src={peer.avatar} name={isGroup ? peer.name || "Group" : peer.name} size={size} />
      </span>
    </span>
  );
}

function Chip({ children, tone = "obj" }: { children: React.ReactNode; tone?: "obj" | "danger" }) {
  return (
    <span
      className={cn(
        "msg-fade inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium",
        tone === "danger" ? "bg-chili text-white" : "obj text-white",
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- surface */

export function CallSurface() {
  const call = useCall();
  const {
    status,
    isIncoming,
    isVideo,
    peer,
    isGroup,
    groupCaller,
    participantCount,
    minimized,
    startedAt,
    endReason,
    micOn,
    camOn,
    facing,
    switchingCam,
    remoteMuted,
    remoteVideoOn,
    poorConnection,
    error,
    rejoinable,
    via,
  } = call;

  const elapsed = useElapsed(startedAt);
  const hasMultipleCameras = useHasMultipleCameras(camOn);
  const open = status !== "idle";

  // A failure line is read once, then cleared.
  useEffect(() => {
    if (!error || open) return;
    const t = setTimeout(() => call.clearError(), 4000);
    return () => clearTimeout(t);
  }, [error, open, call]);

  // Escape docks a call rather than ending it.
  useEffect(() => {
    if (!open || minimized || (status === "ringing" && isIncoming)) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && status !== "ended" && call.setMinimized(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, minimized, status, isIncoming, call]);

  if (!open || !peer) {
    if (rejoinable) return <RejoinPill />;
    if (error) return <FailureToast message={error} onClose={call.clearError} />;
    return null;
  }

  const pending = status === "ringing" || status === "connecting";
  const ringPhase: RingPhase = status === "ringing" ? (isIncoming ? "incoming" : "outgoing") : status === "connecting" ? "connecting" : null;
  let line: string;
  if (status === "ended") line = CALL_END_COPY[endReason ?? "ended"];
  else if (status === "connected") line = isGroup ? `${elapsed ?? "0:00"} · ${participantCount + 1} in the call` : (elapsed ?? "Connected");
  else if (status === "connecting") line = "Connecting";
  else if (isIncoming) line = isGroup ? `${groupCaller?.name ?? "Someone"} is calling the group` : isVideo ? "wants to video call" : "is calling you";
  else line = isGroup ? "Ringing the group" : "Calling";

  const localVideo = callManager.localVideoTrack;
  const remoteVideo = callManager.remoteVideo;
  const remoteAudio = callManager.remoteAudio;
  const videoStage = isVideo && (remoteVideoOn || camOn) && status !== "ended";
  const groupStage = isGroup && status === "connected";
  const kind = isVideo ? "Video call" : "Voice call";

  const audio = isGroup
    ? callManager.remoteParticipantsInfo.map((p) => (p.audioTrack ? <RemoteAudio key={`a-${p.identity}`} track={p.audioTrack} /> : null))
    : <RemoteAudio track={remoteAudio} />;

  /* Ringing in: a card on wide screens, the whole screen on a phone. */
  if (status === "ringing" && isIncoming) {
    return (
      <>
        <div
          role="alertdialog"
          aria-label={`${peer.name} ${line}`}
          className="msg-drop fixed top-5 right-5 z-[62] hidden w-[392px] md:block"
        >
          <div className="flex items-center gap-4 rounded-overlay bg-surface-raised p-4 pr-3.5 shadow-[0_28px_70px_-20px_rgba(0,0,0,0.95)]">
            <CallFace peer={peer} size={52} phase="incoming" isGroup={isGroup} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-[0.14em] whitespace-nowrap text-ember-hi uppercase">{kind}</p>
              <p className="mt-0.5 truncate text-[16px] font-semibold text-foreground">{peer.name}</p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[12.5px] text-muted-foreground">
                {/* Where it's ringing from says more than "wants to call" (the
                    eyebrow already says what kind of call it is). */}
                {via && !isGroup ? <ViaTag label={via} /> : <span className="truncate">{line}</span>}
                <Dots />
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <RoundButton label="Decline" tone="end" size="md" onClick={call.declineCall}>
                <HangUp size={20} />
              </RoundButton>
              <RoundButton label={isVideo ? "Answer with video" : "Answer"} tone="accept" size="md" onClick={call.acceptCall}>
                {isVideo ? <VideoCamera size={20} weight="fill" /> : <Phone size={20} weight="fill" />}
              </RoundButton>
            </div>
          </div>
        </div>
        <div role="alertdialog" aria-label={`${peer.name} ${line}`} className="msg-fade fixed inset-0 z-[62] flex flex-col bg-[#0b0708] md:hidden">
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <p className="text-[11.5px] font-semibold tracking-[0.16em] text-ember-hi uppercase">
              {kind}
              {via ? ` · ${via}` : ""}
            </p>
            <div className="mt-8">
              <CallFace peer={peer} size={132} phase="incoming" isGroup={isGroup} />
            </div>
            <h2 className="mt-8 font-wide text-[30px] leading-tight font-bold tracking-[-0.02em] text-white">{peer.name}</h2>
            <p className="mt-2 flex items-center gap-2 text-[15px] text-white/60">
              {line}
              <Dots />
            </p>
          </div>
          <div className="flex justify-center gap-16 pt-4 pb-[max(env(safe-area-inset-bottom),40px)]">
            <RoundButton label="Decline" tone="end" showLabel onClick={call.declineCall}>
              <HangUp size={26} />
            </RoundButton>
            <RoundButton label="Answer" tone="accept" showLabel onClick={call.acceptCall}>
              {isVideo ? <VideoCamera size={26} weight="fill" /> : <Phone size={26} weight="fill" />}
            </RoundButton>
          </div>
        </div>
      </>
    );
  }

  /* Docked: keep browsing, the call keeps running. */
  if (minimized) {
    return (
      <>
        {audio}
        <CallDock
          peer={peer}
          isGroup={isGroup}
          line={line}
          pending={pending}
          ringPhase={ringPhase}
          micOn={micOn}
          poorConnection={poorConnection}
          remoteVideo={videoStage && remoteVideoOn ? remoteVideo : null}
          onExpand={() => call.setMinimized(false)}
          onToggleMic={call.toggleMic}
          onEnd={call.endCall}
        />
      </>
    );
  }

  const controls = (
    <Controls
      ended={status === "ended"}
      line={line}
      micOn={micOn}
      camOn={camOn}
      canFlip={hasMultipleCameras && camOn}
      switchingCam={switchingCam}
      onMic={call.toggleMic}
      onCam={call.toggleCam}
      onFlip={call.flipCamera}
      onEnd={call.endCall}
      overVideo={videoStage || groupStage}
      videoCall={isVideo}
    />
  );

  return (
    <>
      {audio}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${kind} with ${peer.name}`}
        className="msg-fade fixed inset-0 z-[62] flex items-stretch justify-center bg-[#0b0708] md:items-center md:bg-black/75 md:p-6"
      >
        <div
          className={cn(
            "msg-lift relative flex w-full flex-col overflow-hidden bg-[#0b0708] md:rounded-overlay md:shadow-[0_40px_100px_-30px_rgba(0,0,0,1)]",
            videoStage || groupStage ? "md:h-[min(86vh,800px)] md:max-w-[1080px]" : "md:max-w-[440px] md:bg-surface",
          )}
        >
          {groupStage ? (
            <GroupStage micOn={micOn} camOn={camOn} facing={facing} localVideo={localVideo} self={call.self} />
          ) : videoStage ? (
            <div className="absolute inset-0 bg-black">
              {remoteVideo && remoteVideoOn ? (
                <VideoTile track={remoteVideo} />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-5 px-6 text-center">
                  <CallFace peer={peer} size={112} phase={ringPhase} isGroup={isGroup} />
                  <p className="flex items-center gap-2 text-[14px] text-white/60">
                    {status === "connected" ? `${peer.name.split(" ")[0]}'s camera is off` : line}
                    {pending && <Dots />}
                  </p>
                </div>
              )}
              {camOn && localVideo && (
                <div className="absolute right-3 bottom-[7.5rem] z-10 h-[150px] w-[112px] overflow-hidden rounded-xl bg-surface md:right-5 md:bottom-28 md:h-[210px] md:w-[158px]">
                  <VideoTile track={localVideo} mirrored={facing === "user"} />
                  {hasMultipleCameras && (
                    <Tip label="Flip camera">
                      <button
                        type="button"
                        onClick={call.flipCamera}
                        disabled={switchingCam}
                        aria-label="Switch camera"
                        className="msg-press obj absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full text-white disabled:opacity-50"
                      >
                        <CameraRotate size={15} />
                      </button>
                    </Tip>
                  )}
                  {!micOn && (
                    <span className="obj absolute bottom-1.5 left-1.5 flex size-7 items-center justify-center rounded-full text-white">
                      <MicrophoneSlash size={13} />
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Voice: the person, big, and the clock.
            <div className="flex flex-1 flex-col items-center justify-center px-8 pt-16 pb-10 text-center md:pt-14 md:pb-8">
              <CallFace peer={peer} size={128} phase={ringPhase} isGroup={isGroup} />
              <h2 className="mt-8 font-wide text-[30px] leading-tight font-bold tracking-[-0.02em] text-white md:text-[26px]">
                {peer.name}
              </h2>
              <p
                aria-live="polite"
                className={cn(
                  "mt-2 flex items-center gap-2 text-[15px] tabular-nums",
                  status === "ended" ? "text-chili-hi" : "text-white/60",
                )}
              >
                {line}
                {pending && <Dots />}
              </p>
              {(peer.username || via) && !isGroup && (
                <p className="mt-1 text-[13px] text-white/35">
                  {peer.username ? `@${peer.username}` : ""}
                  {peer.username && via ? " · " : ""}
                  {via ?? ""}
                </p>
              )}
              <div className="mt-5 flex min-h-7 flex-wrap justify-center gap-2">
                {remoteMuted && status === "connected" && (
                  <Chip>
                    <MicrophoneSlash size={13} />
                    {peer.name.split(" ")[0]} is muted
                  </Chip>
                )}
                {poorConnection && (
                  <Chip>
                    <WarningCircle size={13} />
                    Weak connection
                  </Chip>
                )}
                {error && (
                  <Chip tone="danger">
                    <WarningCircle size={13} />
                    {error}
                  </Chip>
                )}
              </div>
            </div>
          )}

          {/* Over the picture: who, how long, and the way to dock it. */}
          <div className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3 pt-[max(env(safe-area-inset-top),12px)] md:p-4">
            {videoStage || groupStage ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="obj inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-full pr-3.5 pl-1.5 text-[13px] font-semibold text-white">
                  <UserAvatar src={peer.avatar} name={peer.name} size={24} className="size-6" />
                  <span className="truncate">{peer.name}</span>
                  <span className="font-medium text-white/60 tabular-nums">{line}</span>
                  {pending && <Dots className="text-white/60" />}
                </span>
                {remoteMuted && !isGroup && (
                  <Chip>
                    <MicrophoneSlash size={13} />
                    Muted
                  </Chip>
                )}
                {poorConnection && (
                  <Chip>
                    <WarningCircle size={13} />
                    Weak connection
                  </Chip>
                )}
                {error && (
                  <Chip tone="danger">
                    <WarningCircle size={13} />
                    {error}
                  </Chip>
                )}
              </div>
            ) : (
              <p className="pt-2 pl-2 text-[11px] font-semibold tracking-[0.16em] text-white/45 uppercase">
                {kind}
                {isGroup ? ` · ${peer.name}` : ""}
              </p>
            )}
            {status !== "ended" && (
              <RoundButton label="Minimize call" tone={videoStage || groupStage ? "obj" : "neutral"} size="sm" onClick={() => call.setMinimized(true)}>
                <PictureInPicture size={18} />
              </RoundButton>
            )}
          </div>

          <div
            className={cn(
              "z-20",
              videoStage || groupStage
                ? "absolute inset-x-0 bottom-0 flex justify-center p-4 pb-[max(env(safe-area-inset-bottom),20px)]"
                : "pb-[max(env(safe-area-inset-bottom),36px)] md:pb-8",
            )}
          >
            {controls}
          </div>
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- controls */

/** One control set for voice and video, so both share one muscle memory. */
function Controls({
  ended,
  line,
  micOn,
  camOn,
  canFlip,
  switchingCam,
  onMic,
  onCam,
  onFlip,
  onEnd,
  overVideo,
  videoCall,
}: {
  ended: boolean;
  line: string;
  micOn: boolean;
  camOn: boolean;
  canFlip: boolean;
  switchingCam: boolean;
  onMic: () => void;
  onCam: () => void;
  onFlip: () => void;
  onEnd: () => void;
  overVideo: boolean;
  /** Camera-off only reads as a switched-off state on a video call. */
  videoCall: boolean;
}) {
  if (ended) {
    return (
      <p className={cn("text-center text-[14px] font-medium text-white/60", overVideo && "obj rounded-full px-4 py-2")}>{line}</p>
    );
  }
  const neutral: Tone = overVideo ? "obj" : "neutral";
  const buttons = (
    <>
      <RoundButton label={micOn ? "Mute" : "Unmute"} tone={micOn ? neutral : "engaged"} showLabel={!overVideo} onClick={onMic}>
        {micOn ? <Microphone size={24} /> : <MicrophoneSlash size={24} />}
      </RoundButton>
      <RoundButton label={camOn ? "Stop video" : "Start video"} tone={camOn || !videoCall ? neutral : "engaged"} showLabel={!overVideo} onClick={onCam}>
        {camOn ? <VideoCamera size={24} /> : <VideoCameraSlash size={24} />}
      </RoundButton>
      {canFlip && (
        <RoundButton label="Flip" tip="Flip camera" tone={neutral} showLabel={!overVideo} onClick={onFlip} disabled={switchingCam}>
          <CameraRotate size={24} />
        </RoundButton>
      )}
      <RoundButton label="End" tip="End call" tone="end" showLabel={!overVideo} onClick={onEnd}>
        <HangUp size={26} />
      </RoundButton>
    </>
  );
  return overVideo ? (
    <div className="obj flex items-center gap-3 rounded-full p-2">{buttons}</div>
  ) : (
    <div className="flex items-start justify-center gap-4 md:gap-5">{buttons}</div>
  );
}

/* ------------------------------------------------------------------ group */

function GroupStage({
  micOn,
  camOn,
  facing,
  localVideo,
  self,
}: {
  micOn: boolean;
  camOn: boolean;
  facing: "user" | "environment";
  localVideo: LocalVideoTrack | null;
  self: { name: string; avatar: string } | null;
}) {
  const people = callManager.remoteParticipantsInfo;
  const total = people.length + 1;
  const cols = total <= 1 ? 1 : total <= 4 ? 2 : 3;
  return (
    <div className="absolute inset-0 p-2 pt-16 pb-28 md:p-3 md:pt-16 md:pb-28">
      <div
        className="grid size-full gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: "1fr" }}
      >
        <Tile name={self?.name ?? "You"} avatar={self?.avatar} self video={camOn ? localVideo : null} micMuted={!micOn} speaking={false} mirrored={facing === "user"} />
        {people.map((p, i) => (
          <Tile key={p.identity} index={i + 1} name={p.name} video={p.videoTrack} micMuted={p.micMuted} speaking={p.speaking} />
        ))}
      </div>
    </div>
  );
}

function Tile({
  name,
  avatar,
  video,
  micMuted,
  speaking,
  mirrored,
  self,
  index = 0,
}: {
  name: string;
  avatar?: string;
  video: LocalVideoTrack | RemoteTrack | null;
  micMuted: boolean;
  speaking: boolean;
  mirrored?: boolean;
  self?: boolean;
  index?: number;
}) {
  return (
    <div
      style={{ "--i": index } as React.CSSProperties}
      className={cn(
        "msg-rise relative overflow-hidden rounded-xl bg-surface transition-shadow duration-300",
        // Speaking: an inset Ember ring, never an outline.
        speaking && "shadow-[inset_0_0_0_2px_var(--ember)]",
      )}
    >
      {video ? (
        <VideoTile track={video} mirrored={mirrored} />
      ) : (
        <div className="flex size-full items-center justify-center">
          <UserAvatar src={avatar} name={name} size={64} className="size-16" />
        </div>
      )}
      <span className="obj absolute bottom-2 left-2 inline-flex max-w-[calc(100%-16px)] items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-medium text-white">
        {micMuted && <MicrophoneSlash size={12} />}
        <span className="truncate">{self ? "You" : name}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------- dock */

/** Where the dock may travel, kept inside the screen through resizes. */
function clampOffset(x: number, y: number, el: HTMLElement | null) {
  if (!el) return { x, y };
  const rect = el.getBoundingClientRect();
  const baseLeft = rect.left - x;
  const baseTop = rect.top - y;
  const minX = 12 - baseLeft;
  const maxX = window.innerWidth - 12 - rect.width - baseLeft;
  const minY = 12 - baseTop;
  const maxY = window.innerHeight - 12 - rect.height - baseTop;
  return { x: Math.min(maxX, Math.max(minX, x)), y: Math.min(maxY, Math.max(minY, y)) };
}

function CallDock({
  peer,
  isGroup,
  line,
  pending,
  ringPhase,
  micOn,
  poorConnection,
  remoteVideo,
  onExpand,
  onToggleMic,
  onEnd,
}: {
  peer: CallPeer;
  isGroup: boolean;
  line: string;
  pending: boolean;
  ringPhase: RingPhase;
  micOn: boolean;
  poorConnection: boolean;
  remoteVideo: RemoteTrack | null;
  onExpand: () => void;
  onToggleMic: () => void;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    const onResize = () => setOffset((o) => clampOffset(o.x, o.y, ref.current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-dock-control]")) return;
    drag.current = { startX: e.clientX, startY: e.clientY, x: offset.x, y: offset.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    setOffset(clampOffset(d.x + dx, d.y + dy, ref.current));
  };
  const onPointerUp = () => {
    dragged.current = Boolean(drag.current?.moved);
    drag.current = null;
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className="msg-lift fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[62] w-[240px] cursor-grab touch-none select-none active:cursor-grabbing md:right-6 md:bottom-28"
      role="region"
      aria-label={`Call with ${peer.name}`}
    >
      <div className="overflow-hidden rounded-panel bg-surface-raised shadow-[0_24px_60px_-18px_rgba(0,0,0,0.95)]">
        {/* The dock drags by touch: a held finger is moving it, not asking. */}
        <Tip label="Expand call" touch={false}>
          <button
            type="button"
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              onExpand();
            }}
            aria-label="Expand call"
            className="group relative block h-[132px] w-full overflow-hidden bg-black"
          >
            {remoteVideo ? (
              <VideoTile track={remoteVideo} />
            ) : (
              <span className="flex size-full items-center justify-center">
                <CallFace peer={peer} size={56} phase={ringPhase} isGroup={isGroup} />
              </span>
            )}
            <span className="obj absolute top-2 right-2 flex size-8 items-center justify-center rounded-full text-white transition-colors group-hover:bg-black/75">
              <CornersOut size={15} />
            </span>
            {(poorConnection || !micOn) && (
              <span className="obj absolute bottom-2 left-2 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-white">
                {poorConnection ? <WarningCircle size={12} /> : <MicrophoneSlash size={12} />}
                {poorConnection ? "Weak connection" : "Muted"}
              </span>
            )}
          </button>
        </Tip>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-foreground">{peer.name}</p>
            <p className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground tabular-nums">
              <span className="truncate">{line}</span>
              {pending && <Dots />}
            </p>
          </div>
          <span data-dock-control className="flex items-center gap-1.5">
            <RoundButton label={micOn ? "Mute" : "Unmute"} tone={micOn ? "neutral" : "engaged"} size="sm" onClick={onToggleMic}>
              {micOn ? <Microphone size={17} /> : <MicrophoneSlash size={17} />}
            </RoundButton>
            <RoundButton label="End call" tone="end" size="sm" onClick={onEnd}>
              <HangUp size={17} />
            </RoundButton>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- after a drop */

/** A reload dropped a connected call: offer the way back, never auto-join. */
function RejoinPill() {
  const call = useCall();
  const record = call.rejoinable;
  if (!record) return null;
  return (
    <div className="msg-lift fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[62] flex items-center gap-2 rounded-full bg-surface-raised py-1.5 pr-1.5 pl-2 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.95)] md:right-6 md:bottom-28">
      <UserAvatar src={record.peer.avatar} name={record.peer.name} size={32} className="size-8" />
      <span className="pr-1 text-[13px] leading-tight text-foreground">
        <span className="block font-semibold">Call with {record.isGroup ? record.peer.name : record.peer.name.split(" ")[0]} dropped</span>
        <span className="block text-[11.5px] text-muted-foreground">Pick it back up?</span>
      </span>
      <button
        type="button"
        onClick={call.rejoin}
        className="msg-press h-9 rounded-full bg-white px-4 text-[13px] font-semibold text-[#0b0708] hover:bg-white/90"
      >
        Rejoin
      </button>
      <button
        type="button"
        onClick={call.dismissRejoin}
        aria-label="Dismiss"
        className="msg-press flex size-9 items-center justify-center rounded-full bg-control text-foreground hover:bg-control-hover"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/** A call that failed before it began: say why, briefly. */
function FailureToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="alert"
      className="msg-lift fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-[62] flex max-w-[calc(100vw-24px)] items-center gap-2.5 rounded-full bg-surface-raised py-2 pr-2 pl-4 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.95)] md:right-6 md:bottom-28"
    >
      <WarningCircle size={16} className="shrink-0 text-chili-hi" aria-hidden />
      <span className="text-[13px] text-foreground">{message}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="msg-press flex size-8 items-center justify-center rounded-full hover:bg-white/[0.06]">
        <X size={14} />
      </button>
    </div>
  );
}
