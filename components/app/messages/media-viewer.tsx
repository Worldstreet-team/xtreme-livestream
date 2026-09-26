"use client";

import { useEffect, useRef } from "react";
import { CaretLeft, CaretRight, DownloadIcon, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { stampLabel } from "@/lib/messaging";

export interface ViewerItem {
  id: string;
  url: string;
  type: "image" | "video";
  who: string;
  at: string;
  caption?: string;
}

/**
 * Photos and clips from the thread, full screen. Arrows (or a swipe) walk
 * the whole thread's media, not just the album you tapped; Escape closes.
 * Black, not the warm ground: this is a media surface, the picture decides.
 */
export function MediaViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: ViewerItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const item = items[index];
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const go = (step: number) => {
    const next = index + step;
    if (next >= 0 && next < items.length) onIndex(next);
  };

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
  }, [index, items.length, onClose]);

  if (!item) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${item.type === "video" ? "Clip" : "Photo"} from ${item.who}`}
      className="msg-fade fixed inset-0 z-[58] flex flex-col bg-black"
      onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
        else if (dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.4) onClose();
      }}
    >
      <div className="flex items-center gap-3 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-3 md:px-5">
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
          onClick={onClose}
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
          <img key={item.id} src={item.url} alt={item.caption ?? ""} className="msg-fade max-h-full max-w-full rounded-md object-contain select-none" draggable={false} />
        )}
        {index > 0 && (
          <button
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
        <p className="mx-auto max-w-xl px-6 pb-[max(env(safe-area-inset-bottom),20px)] text-center text-[14px] text-white/85">
          {item.caption}
        </p>
      )}
      {items.length > 1 && (
        // A strip of the thread's media: where you are, and a tap to jump.
        <div className={cn("flex justify-center gap-1.5 overflow-x-auto px-4 pb-[max(env(safe-area-inset-bottom),16px)]", item.caption && "pt-1")}>
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
