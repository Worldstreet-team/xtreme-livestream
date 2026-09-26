"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, DownloadIcon, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { stampLabel } from "@/lib/messaging";
import { EASE, done, play, reducedMotion } from "./motion";

export interface ViewerItem {
  id: string;
  url: string;
  type: "image" | "video";
  who: string;
  at: string;
  caption?: string;
}

/** How far down a drag goes before letting go closes the viewer (or a quick flick). */
const DISMISS_PX = 110;
const TILE_RADIUS = 14;

/** The photo's tile in the thread, if it's there to go back to. */
const tileFor = (id: string) => document.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(id)}"]`);

/** The transform and clip that make the photo, where it sits, look exactly like its tile. */
function tileLook(photo: HTMLElement, tile: HTMLElement): Keyframe {
  const f = photo.getBoundingClientRect();
  const t = tile.getBoundingClientRect();
  const s = Math.max(t.width / f.width, t.height / f.height);
  const tx = t.left + t.width / 2 - (f.left + f.width / 2);
  const ty = t.top + t.height / 2 - (f.top + f.height / 2);
  const ix = Math.max(0, (f.width - t.width / s) / 2);
  const iy = Math.max(0, (f.height - t.height / s) / 2);
  return { transform: `translate(${tx}px, ${ty}px) scale(${s})`, clipPath: `inset(${iy}px ${ix}px round ${TILE_RADIUS / s}px)` };
}
/** At rest: its own rounded-md corners. */
const FULL: Keyframe = { transform: "none", clipPath: "inset(0px 0px round 6px)" };

/**
 * Photos and clips from the thread, full screen. Arrows (or a swipe) walk
 * the whole thread's media, not just the album you tapped; Escape closes.
 * Black, not the warm ground: this is a media surface, the picture decides.
 *
 * Opened from the thread (the owner's pick, photos C) the photo grows out
 * of its tile, corners and all, while the backdrop darkens and the chrome
 * fades in. Drag it down: it follows your finger and shrinks toward 80%
 * as the thread shows through. Let go past the line and it flies home to
 * its tile; short of it, it springs back.
 */
export function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
  fromTile = false,
}: {
  items: ViewerItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  /** Opened by tapping a photo in the thread: it grows out of that tile, and goes back to it. */
  fromTile?: boolean;
}) {
  const item = items[index];
  const rootRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const photoRef = useRef<HTMLImageElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  // The picture that grew out of its tile; the ones you step to after it fade in.
  const [grownId] = useState(fromTile ? items[index]?.id : null);
  const drag = useRef<{ id: number; x: number; y: number; at: number; dx: number; dy: number; mode: "down" | "side" | null } | null>(null);

  const chrome = () => [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-chrome]") ?? [])];

  /** Away: home to the tile when it's there to go to, otherwise a fade. */
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const photo = photoRef.current;
    const tile = fromTile && item?.type === "image" ? tileFor(item.id) : null;
    chrome().forEach((el) => play(el, [{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], 100, EASE.in, 0, { fill: "forwards" }));
    play(backdropRef.current, [{ opacity: getComputedStyle(backdropRef.current!).opacity }, { opacity: 0 }], 240, EASE.out, 0, { fill: "forwards" });
    let trip: Animation | null = null;
    if (photo && tile && !reducedMotion()) {
      // From wherever a drag left it.
      const now: Keyframe = { transform: photo.style.transform || "none", clipPath: "inset(0px 0px round 6px)" };
      photo.getAnimations().forEach((a) => a.cancel());
      photo.style.transform = "";
      const home = tileLook(photo, tile);
      trip = play(photo, [now, home], 320, EASE.glide, 0, { fill: "forwards" });
    } else {
      trip = play(rootRef.current, [{ opacity: 1 }, { opacity: 0 }], 160, EASE.in, 0, { fill: "forwards" });
    }
    void done(trip).then(onClose);
  }, [fromTile, item, onClose]);

  const go = (step: number) => {
    const next = index + step;
    if (next >= 0 && next < items.length) onIndex(next);
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
    // go() closes over index; re-bind when it moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, items.length, close]);

  // Opening: the backdrop darkens, the chrome fades in, the photo grows out of its tile.
  useLayoutEffect(() => {
    play(backdropRef.current, [{ opacity: 0 }, { opacity: 1 }], 240, EASE.out);
    chrome().forEach((el) => play(el, [{ opacity: 0 }, { opacity: 1 }], 160, EASE.out, 220));
    const photo = photoRef.current;
    const tile = fromTile && photo && item?.type === "image" ? tileFor(item.id) : null;
    if (!photo || !tile || reducedMotion()) return;
    const grow = () => {
      photo.style.opacity = "";
      play(photo, [tileLook(photo, tile), FULL], 360, EASE.glide);
    };
    // It needs its size to grow into: a cached picture has it at once, else on load.
    if (photo.complete && photo.naturalWidth) return grow();
    photo.style.opacity = "0";
    photo.addEventListener("load", grow, { once: true });
    return () => photo.removeEventListener("load", grow);
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The photo has left its tile: the tile stays empty until it comes home.
  useLayoutEffect(() => {
    const tile = fromTile && item ? tileFor(item.id) : null;
    if (!tile) return;
    tile.style.visibility = "hidden";
    return () => {
      tile.style.visibility = "";
    };
  }, [fromTile, item]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || closing.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), dx: 0, dy: 0, mode: null };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const photo = photoRef.current;
    if (!d || d.id !== e.pointerId || !photo) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    if (!d.mode) {
      if (d.dy > 10 && d.dy > Math.abs(d.dx) * 1.2 && item.type === "image" && !reducedMotion()) {
        d.mode = "down";
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } else if (Math.abs(d.dx) > 10 || Math.abs(d.dy) > 10) d.mode = "side";
    }
    if (d.mode !== "down") return;
    // It follows the finger, shrinking toward 80%; the thread shows through as it goes.
    const p = Math.max(0, Math.min(1, d.dy / 320));
    photo.style.transform = `translate(${d.dx * 0.6}px, ${Math.max(0, d.dy)}px) scale(${1 - 0.2 * p})`;
    if (backdropRef.current) backdropRef.current.style.opacity = String(1 - 0.6 * p);
    chrome().forEach((el) => (el.style.opacity = String(Math.max(0, 1 - p * 3))));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (d.mode === "down") {
      const flick = d.dy / Math.max(1, performance.now() - d.at) > 0.6;
      if (d.dy > DISMISS_PX || flick) return close();
      // Not far enough: back into place on the spring.
      const photo = photoRef.current;
      const from = photo?.style.transform || "none";
      if (photo) photo.style.transform = "";
      play(photo, [{ transform: from }, { transform: "none" }], 420, EASE.spring);
      const shade = backdropRef.current;
      if (shade) {
        play(shade, [{ opacity: shade.style.opacity || "1" }, { opacity: 1 }], 240, EASE.out);
        shade.style.opacity = "";
      }
      chrome().forEach((el) => {
        play(el, [{ opacity: el.style.opacity || "1" }, { opacity: 1 }], 160, EASE.out);
        el.style.opacity = "";
      });
      return;
    }
    const { dx, dy } = d;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
  };

  if (!item) return null;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${item.type === "video" ? "Clip" : "Photo"} from ${item.who}`}
      className="fixed inset-0 z-[58] flex touch-none flex-col"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div ref={backdropRef} aria-hidden className="absolute inset-0 bg-black" />

      <div data-chrome className="relative flex items-center gap-3 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-3 md:px-5">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[14px] font-semibold text-white">{item.who}</p>
          <p className="text-[12px] text-white/55 tabular-nums">{stampLabel(item.at)}</p>
        </div>
        {items.length > 1 && (
          <span className="text-[12.5px] font-medium text-white/55 tabular-nums">
            {index + 1} of {items.length}
          </span>
        )}
        <a
          href={item.url}
          download
          target="_blank"
          rel="noreferrer"
          aria-label="Save"
          className="msg-press obj flex size-10 items-center justify-center rounded-full text-white"
        >
          <DownloadIcon size={18} />
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="Close"
          className="msg-press obj flex size-10 items-center justify-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          <X size={18} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-2 md:px-16">
        {item.type === "video" ? (
          <video key={item.id} src={item.url} controls autoPlay playsInline className="msg-fade max-h-full max-w-full rounded-md" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={photoRef}
            key={item.id}
            src={item.url}
            alt={item.caption ?? ""}
            className={cn("max-h-full max-w-full rounded-md object-contain select-none", item.id !== grownId && "msg-fade")}
            draggable={false}
          />
        )}
        {index > 0 && (
          <button
            data-chrome
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous"
            className="msg-press obj absolute left-3 hidden size-11 items-center justify-center rounded-full text-white md:flex"
          >
            <CaretLeft size={20} />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            data-chrome
            type="button"
            onClick={() => go(1)}
            aria-label="Next"
            className="msg-press obj absolute right-3 hidden size-11 items-center justify-center rounded-full text-white md:flex"
          >
            <CaretRight size={20} />
          </button>
        )}
      </div>

      {item.caption && (
        <p data-chrome className="relative mx-auto max-w-xl px-6 pb-[max(env(safe-area-inset-bottom),20px)] text-center text-[14px] text-white/85">
          {item.caption}
        </p>
      )}
      {items.length > 1 && (
        // A strip of the thread's media: where you are, and a tap to jump.
        <div
          data-chrome
          className={cn("relative flex justify-center gap-1.5 overflow-x-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]", item.caption && "pt-1")}
        >
          {items.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onIndex(i)}
              aria-label={`${it.type === "video" ? "Clip" : "Photo"} ${i + 1}`}
              aria-current={i === index}
              className={cn(
                "msg-press size-11 shrink-0 overflow-hidden rounded-md transition-opacity",
                i === index ? "-translate-y-0.5 opacity-100" : "opacity-40 hover:opacity-80",
              )}
            >
              {it.type === "video" ? (
                <video src={it.url} muted preload="metadata" className="pointer-events-none size-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt="" className="size-full object-cover" loading="lazy" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
