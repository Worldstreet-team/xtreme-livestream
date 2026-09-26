"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LocalVideoTrack } from "livekit-client";
import {
  ArrowClockwise,
  CornersOut,
  Eye,
  Microphone,
  MicrophoneSlash,
  Stop,
  VideoCamera,
  VideoCameraSlash,
} from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { formatNumber } from "@/lib/categories";
import { cn } from "@/lib/utils";

type Corner = "tl" | "tr" | "bl" | "br";
const CORNER_KEY = "xtream:mini-live-corner";
/** Past the mark and home again: the card lands in its corner like it was thrown there. */
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";
/** Quick to go, gentle to land — the same curve the program's tiles glide on. */
const GLIDE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Where each corner is: clear of the phone's top bar and tab bar (and the
 * notch), and on a wide screen of the top bar and the rail — `--rail-w`
 * comes down from the app's main column.
 */
const CORNERS: Record<Corner, string> = {
  tl: "left-3 top-[calc(env(safe-area-inset-top)+4.25rem)] md:left-[calc(var(--rail-w,0px)+1rem)] md:top-20",
  tr: "right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] md:right-4 md:top-20",
  bl: "left-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+0.75rem)] md:left-[calc(var(--rail-w,0px)+1rem)] md:bottom-4",
  br: "right-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+0.75rem)] md:right-4 md:bottom-4",
};

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface MiniTip {
  id: string;
  username: string;
  amountLabel: string;
  emoji: string;
}

/**
 * The broadcast, minimized: what you're sending, a corner of the screen
 * while you browse the app. It grows out of the studio's stage when you
 * leave it and back into it when you return; drag it and it springs to the
 * nearest corner (and stays there next time). The clock, who's watching,
 * the mic and camera, and — while the connection heals — a way to get back
 * on air now rather than at the next retry. A gift still chimes, and shows
 * for a moment over the card.
 */
export function MiniLive({
  getTrack,
  trackKey,
  getOrigin,
  onPlaced,
  mirrored,
  portrait,
  source,
  elapsed,
  viewers,
  conn,
  micOn,
  camOn,
  host,
  tip,
  onToggleMic,
  onToggleCam,
  onReconnect,
  onEnd,
}: {
  /** The picture — the shared screen or the camera. Read in an effect, never while rendering. */
  getTrack: () => LocalVideoTrack | null;
  /** Changes when the picture's source does, so it re-attaches. */
  trackKey: string;
  /** Where the studio's picture last was: the card grows out of it. */
  getOrigin: () => DOMRect | null;
  /** Where the card came to rest, for the studio to grow back out of. */
  onPlaced: (rect: DOMRect) => void;
  mirrored: boolean;
  portrait: boolean;
  source: "camera" | "screen" | "obs";
  elapsed: string;
  viewers: number;
  conn: "live" | "reconnecting" | "rejoining";
  micOn: boolean;
  camOn: boolean;
  host: { name: string; avatar?: string | null };
  tip: MiniTip | null;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onReconnect: () => void;
  onEnd: () => void;
}) {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [place, setPlace] = useState<{ corner: Corner; tick: number }>(() => {
    try {
      const saved = window.localStorage.getItem(CORNER_KEY);
      if (saved === "tl" || saved === "tr" || saved === "bl" || saved === "br") return { corner: saved, tick: 0 };
    } catch {
      // No storage: the default corner.
    }
    return { corner: "br", tick: 0 };
  });
  const [confirmEnd, setConfirmEnd] = useState(false);
  const drag = useRef<{ id: number; x0: number; y0: number; dx: number; dy: number; moved: boolean } | null>(null);
  /** Where the card was let go, so it can spring from there to its corner. */
  const dropRect = useRef<DOMRect | null>(null);

  // The picture: the same track the studio publishes, on a second element.
  useEffect(() => {
    const el = videoRef.current;
    const track = getTrack();
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trackKey names the picture
  }, [trackKey]);

  // Arriving: grow out of the studio's stage into the corner.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    // Measured at rest: a grow already under way (effects can run twice)
    // would otherwise be measured as the corner.
    el.getAnimations().forEach((a) => a.cancel());
    const to = el.getBoundingClientRect();
    onPlaced(to);
    const from = getOrigin();
    if (!from || !from.width || reducedMotion()) return;
    const s = from.width / to.width;
    el.animate(
      [
        { transformOrigin: "top left", transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${s})`, borderRadius: `${20 / s}px` },
        { transformOrigin: "top left", transform: "none", borderRadius: "16px" },
      ],
      { duration: 520, easing: GLIDE }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // Let go: spring from where it was dropped to its corner.
  useLayoutEffect(() => {
    const el = cardRef.current;
    const from = dropRect.current;
    dropRect.current = null;
    if (!el || !from) return;
    el.getAnimations().forEach((a) => a.cancel());
    const to = el.getBoundingClientRect();
    onPlaced(to);
    if (reducedMotion()) return;
    el.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: "none" }], {
      duration: 460,
      easing: SPRING,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per placement
  }, [place]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Controls are controls; the rest of the card is a handle.
    if ((e.target as HTMLElement).closest("button, a")) return;
    drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = cardRef.current;
    if (!d || !el || d.id !== e.pointerId) return;
    d.dx = e.clientX - d.x0;
    d.dy = e.clientY - d.y0;
    if (!d.moved && Math.hypot(d.dx, d.dy) > 6) {
      d.moved = true;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // The pointer's already gone; the drag still follows its moves.
      }
    }
    if (d.moved) el.style.transform = `translate(${d.dx}px, ${d.dy}px) scale(1.03)`;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = cardRef.current;
    drag.current = null;
    if (!d || !el || d.id !== e.pointerId) return;
    // A tap opens the studio.
    if (!d.moved) {
      router.push("/studio");
      return;
    }
    const r = el.getBoundingClientRect();
    const corner = `${r.top + r.height / 2 < window.innerHeight / 2 ? "t" : "b"}${r.left + r.width / 2 < window.innerWidth / 2 ? "l" : "r"}` as Corner;
    el.style.transform = "";
    dropRect.current = r;
    setPlace((p) => ({ corner, tick: p.tick + 1 }));
    try {
      window.localStorage.setItem(CORNER_KEY, corner);
    } catch {
      // It just won't be remembered.
    }
  };

  const healing = conn !== "live";
  const showPicture = source !== "obs" && camOn;

  return (
    <div
      ref={cardRef}
      role="region"
      aria-label="Your stream, minimized"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        if (cardRef.current) cardRef.current.style.transform = "";
      }}
      className={cn(
        "group fixed z-[65] cursor-grab touch-none overflow-hidden rounded-[16px] bg-black shadow-[0_14px_36px_rgba(0,0,0,0.55)] ring-1 ring-white/10 select-none active:cursor-grabbing",
        portrait ? "aspect-[9/16] w-[104px] md:w-[168px]" : "aspect-video w-[176px] md:w-[300px]",
        CORNERS[place.corner]
      )}
    >
      {/* The picture, or who's on when there isn't one. */}
      {showPicture ? (
        <video ref={videoRef} autoPlay muted playsInline className={cn("size-full object-cover", mirrored && "-scale-x-100")} />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-[#0b0708]">
          <UserAvatar src={host.avatar} name={host.name} size={40} className="size-9 md:size-11" />
          <span className="px-2 text-center text-[10.5px] font-semibold text-white/60">
            {source === "obs" ? "Your encoder is on air" : "Camera off"}
          </span>
        </div>
      )}

      {/* Light falls off top and bottom, so the chips and controls read on any picture. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-black/65" />

      <div className="absolute inset-x-1.5 top-1.5 flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-center gap-1 rounded-full bg-black/55 py-0.5 pr-1.5 pl-1 text-[10px] font-bold text-white tabular-nums md:text-[11px]">
          <span className={cn("rounded-full px-1 py-px tracking-[0.04em] text-white", healing ? "bg-white/20" : "bg-chili")}>LIVE</span>
          <span className="font-mono">{elapsed}</span>
        </span>
        <span className="hidden items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 tabular-nums md:flex md:text-[11px]">
          <Eye size={11} />
          {formatNumber(viewers)}
        </span>
      </div>

      {healing ? (
        // Off the air for a moment: say so, and offer to get back now.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 px-2 text-center">
          <span className="size-5 animate-spin rounded-full border-2 border-white/80 border-t-transparent md:size-6" />
          <span className="text-[10.5px] leading-tight font-semibold text-white md:text-[12px]">
            {conn === "rejoining" ? "Getting you back on" : "Reconnecting"}
          </span>
          <button
            type="button"
            onClick={onReconnect}
            className="press flex h-7 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-semibold text-[#0b0708]"
          >
            <ArrowClockwise size={12} weight="bold" />
            Retry now
          </button>
        </div>
      ) : confirmEnd ? (
        <div className="absolute inset-x-1.5 bottom-1.5 flex flex-col gap-1.5 rounded-[12px] bg-black/80 p-2">
          <p className="text-center text-[11.5px] font-semibold text-white">End your stream?</p>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setConfirmEnd(false)} className="press h-7 flex-1 rounded-full bg-white/15 text-[11.5px] font-semibold text-white">
              Keep going
            </button>
            <button type="button" onClick={onEnd} className="press h-7 flex-1 rounded-full bg-chili text-[11.5px] font-semibold text-white">
              End
            </button>
          </div>
        </div>
      ) : (
        <div className="absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <MiniButton label={micOn ? "Mute your mic" : "Unmute your mic"} onClick={onToggleMic} tone={micOn ? "plain" : "off"}>
              {micOn ? <Microphone size={14} weight="fill" /> : <MicrophoneSlash size={14} weight="fill" />}
            </MiniButton>
            {source === "camera" && (
              <MiniButton label={camOn ? "Turn your camera off" : "Turn your camera on"} onClick={onToggleCam} tone={camOn ? "plain" : "off"} wide>
                {camOn ? <VideoCamera size={14} weight="fill" /> : <VideoCameraSlash size={14} weight="fill" />}
              </MiniButton>
            )}
          </div>
          <div className="flex items-center gap-1">
            <MiniButton label="End your stream" onClick={() => setConfirmEnd(true)} tone="end" wide>
              <Stop size={13} weight="fill" />
            </MiniButton>
            <MiniButton label="Open the studio" onClick={() => router.push("/studio")} tone="plain" wide>
              <CornersOut size={14} weight="bold" />
            </MiniButton>
          </div>
        </div>
      )}

      {/* A gift lands: it shows for a moment over the picture (the chime already played). */}
      {tip && !healing && (
        <div
          key={tip.id}
          className="pointer-events-none absolute inset-x-1.5 top-8 flex justify-center motion-safe:animate-[pop-in_320ms_var(--ease-spring)_both] md:top-9"
        >
          <span className="flex max-w-full items-center gap-1 truncate rounded-full bg-black/75 px-2 py-0.5 text-[10.5px] font-semibold text-white md:text-[11.5px]">
            <span aria-hidden>{tip.emoji}</span>
            <span className="truncate">{tip.username}</span>
            <span className="font-money text-value">{tip.amountLabel}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/** One of the card's round controls. `wide` ones only show where there's room. */
function MiniButton({
  label,
  onClick,
  tone,
  wide = false,
  children,
}: {
  label: string;
  onClick: () => void;
  tone: "plain" | "off" | "end";
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "press size-7 items-center justify-center rounded-full text-white md:size-8",
        wide ? "hidden md:flex" : "flex",
        tone === "plain" && "bg-black/55 hover:bg-black/70",
        tone === "off" && "bg-chili",
        tone === "end" && "bg-black/55 text-chili-hi hover:bg-chili hover:text-white"
      )}
    >
      {children}
    </button>
  );
}
