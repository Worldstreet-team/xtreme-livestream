"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FlipHorizontal, Minus, Pause, Play, Playlist, Plus, Restart, X } from "@/components/icons";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";

/**
 * The teleprompter (Phase 3, run of show): the on-air segment's script,
 * scrolling up past a reading line near the top of the frame — where the
 * camera is — so the host reads without looking away. Host-only: it sits
 * over the studio's preview, never in the program.
 *
 * Four speeds, like the hardware prompters people know; the text size and
 * a mirror (for a beam-splitter glass) are kept on this device. Drag or
 * scroll to nudge it; Space pauses.
 */

/** Lines a minute at each speed — roughly 110, 140, 170 and 200 words a minute. */
const SPEEDS = [
  { label: "Slow", lines: 13 },
  { label: "Steady", lines: 17 },
  { label: "Quick", lines: 21 },
  { label: "Fast", lines: 26 },
] as const;
const SIZES = [20, 24, 28, 32, 38, 44, 52] as const;
const KEY = "xtream:prompter";
/** The reading line, as a share of the prompter's height from the top. */
const READ_AT = 0.24;
const LINE_HEIGHT = 1.35;

interface Prefs {
  speed: number;
  size: number;
  mirror: boolean;
}

function readPrefs(fallbackSize: number): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return {
      speed: typeof p.speed === "number" && p.speed >= 0 && p.speed < SPEEDS.length ? p.speed : 1,
      size: typeof p.size === "number" && p.size >= 0 && p.size < SIZES.length ? p.size : fallbackSize,
      mirror: p.mirror === true,
    };
  } catch {
    return { speed: 1, size: fallbackSize, mirror: false };
  }
}

export function Teleprompter({
  segment,
  next,
  compact = false,
  onClose,
  onOpenRundown,
  className,
}: {
  /** What's read now: the segment on air (or, before a show, the one being prepared). */
  segment: { id: string; title: string; script: string } | null;
  /** The segment after this one, named at the end of the script. */
  next?: string | null;
  /** A phone: smaller type to start with, and fewer controls in the row. */
  compact?: boolean;
  onClose: () => void;
  onOpenRundown: () => void;
  className?: string;
}) {
  const [prefs, setPrefs] = useState<Prefs>(() => ({ speed: 1, size: compact ? 1 : 3, mirror: false }));
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const viewRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);
  const maxRef = useRef(0);
  const drag = useRef<{ y: number; from: number } | null>(null);

  // This device's settings, once mounted (localStorage isn't there on the server).
  useEffect(() => {
    const t = setTimeout(() => setPrefs(readPrefs(compact ? 1 : 3)), 0);
    return () => clearTimeout(t);
  }, [compact]);
  const save = (next: Prefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode: it just won't be remembered.
    }
  };

  // A new segment starts from the top, paused, adjusted while rendering.
  const [shownId, setShownId] = useState(segment?.id ?? null);
  if ((segment?.id ?? null) !== shownId) {
    setShownId(segment?.id ?? null);
    setOffset(0);
    setPlaying(false);
  }

  const moveTo = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(maxRef.current, value));
    offsetRef.current = clamped;
    setOffset(clamped);
    return clamped;
  }, []);

  // How far the text can travel: until its last line reaches the reading line.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const text = textRef.current;
    if (!view || !text) return;
    const measure = () => {
      // The last line may rise to the reading line, no further.
      maxRef.current = Math.max(0, text.offsetHeight - SIZES[prefs.size] * LINE_HEIGHT * 1.5);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(view);
    ro.observe(text);
    return () => ro.disconnect();
  }, [prefs.size, segment?.script]);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);

  // The scroll itself: pixels a second from lines a minute at this size.
  useEffect(() => {
    if (!playing) return;
    const pxPerSecond = (SPEEDS[prefs.speed].lines * SIZES[prefs.size] * LINE_HEIGHT) / 60;
    let last = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      const at = moveTo(offsetRef.current + pxPerSecond * dt);
      if (at >= maxRef.current) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, prefs.speed, prefs.size, moveTo]);

  const script = segment?.script.trim() ?? "";
  const size = SIZES[prefs.size];
  const iconButton = "press flex size-9 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/[0.1] hover:text-white disabled:opacity-35";

  return (
    <section
      aria-label="Teleprompter"
      className={cn(
        "pointer-events-auto flex flex-col overflow-hidden rounded-[16px] bg-black/80 text-white outline-none focus-visible:ring-2 focus-visible:ring-ember",
        className
      )}
      onKeyDown={(e) => {
        if (e.key === " " && e.target === e.currentTarget) {
          e.preventDefault();
          setPlaying((p) => !p);
        }
      }}
      tabIndex={0}
    >
      <div
        ref={viewRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden touch-none active:cursor-grabbing"
        onWheel={(e) => moveTo(offsetRef.current + e.deltaY)}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, from: offsetRef.current };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) moveTo(drag.current.from - (e.clientY - drag.current.y));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {/* The reading line: eyes here, and the lens is just above. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: `${READ_AT * 100}%` }}>
          <span className="h-0 w-0 border-y-[7px] border-l-[10px] border-y-transparent border-l-ember" />
          <span className="h-px flex-1 bg-ember/35" />
        </div>
        {/* The first line starts on the reading line and the text rises past it. */}
        <div
          className="absolute inset-x-0 px-6 will-change-transform"
          style={{
            top: `calc(${READ_AT * 100}% - ${(size * LINE_HEIGHT) / 2}px)`,
            transform: `translateY(${-offset}px)${prefs.mirror ? " scaleX(-1)" : ""}`,
          }}
        >
          <div ref={textRef} className="mx-auto max-w-[34ch] pb-4" style={{ fontSize: size, lineHeight: LINE_HEIGHT }}>
            {segment && <p className="mb-[0.6em] text-[0.45em] font-bold tracking-[0.14em] text-ember-hi uppercase">{segment.title}</p>}
            {script ? (
              script.split(/\n{2,}/).map((para, i) => (
                <p key={i} className="mb-[0.8em] font-semibold whitespace-pre-line text-white/95">
                  {para}
                </p>
              ))
            ) : (
              <div className="text-[0.62em] leading-snug text-white/60">
                <p>{segment ? "No script for this segment." : "Nothing to read yet."}</p>
                <button type="button" onClick={onOpenRundown} className="press mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.1] px-3.5 text-[13px] font-semibold text-white hover:bg-white/[0.16]">
                  <Playlist size={15} />
                  Write it in Run of show
                </button>
              </div>
            )}
            {script && next && <p className="mt-[1.2em] text-[0.5em] font-semibold text-white/45">Next: {next}</p>}
          </div>
        </div>
      </div>

      {/* The controls: play, speed, size, mirror — one row at the bottom. */}
      <div className="flex shrink-0 items-center gap-1 border-t border-white/[0.08] px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => {
            if (!playing && offsetRef.current >= maxRef.current) moveTo(0);
            setPlaying((p) => !p);
          }}
          disabled={!script}
          aria-label={playing ? "Pause" : "Play"}
          className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white pr-3.5 pl-3 text-[12.5px] font-bold text-[#0b0708] disabled:opacity-40"
        >
          {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
          {playing ? "Pause" : "Roll"}
        </button>
        <div className="flex items-center" role="group" aria-label="Speed">
          <Tip label="Scroll slower">
            <button type="button" className={iconButton} disabled={prefs.speed === 0} onClick={() => save({ ...prefs, speed: prefs.speed - 1 })} aria-label="Slower">
              <Minus size={15} weight="bold" />
            </button>
          </Tip>
          <span className="w-12 text-center text-[12px] font-semibold text-white/85 tabular-nums" aria-live="polite">
            {SPEEDS[prefs.speed].label}
          </span>
          <Tip label="Scroll faster">
            <button type="button" className={iconButton} disabled={prefs.speed === SPEEDS.length - 1} onClick={() => save({ ...prefs, speed: prefs.speed + 1 })} aria-label="Faster">
              <Plus size={15} weight="bold" />
            </button>
          </Tip>
        </div>
        <span aria-hidden className="mx-0.5 h-5 w-px bg-white/10" />
        <div className="flex items-center" role="group" aria-label="Text size">
          <Tip label="Smaller text">
            <button type="button" className={iconButton} disabled={prefs.size === 0} onClick={() => save({ ...prefs, size: prefs.size - 1 })} aria-label="Smaller text">
              <span className="text-[12px] font-bold">A</span>
            </button>
          </Tip>
          <Tip label="Larger text">
            <button type="button" className={iconButton} disabled={prefs.size === SIZES.length - 1} onClick={() => save({ ...prefs, size: prefs.size + 1 })} aria-label="Larger text">
              <span className="text-[17px] font-bold">A</span>
            </button>
          </Tip>
        </div>
        {!compact && (
          <>
            <Tip label={prefs.mirror ? "Stop mirroring the text" : "Mirror the text, for prompter glass"}>
              <button
                type="button"
                className={cn(iconButton, prefs.mirror && "bg-white text-[#0b0708] hover:bg-white hover:text-[#0b0708]")}
                aria-pressed={prefs.mirror}
                onClick={() => save({ ...prefs, mirror: !prefs.mirror })}
                aria-label="Mirror the text, for prompter glass"
              >
                <FlipHorizontal size={17} />
              </button>
            </Tip>
            <Tip label="Back to the top">
              <button type="button" className={iconButton} onClick={() => moveTo(0)} aria-label="Back to the top">
                <Restart size={16} />
              </button>
            </Tip>
          </>
        )}
        <button type="button" className={cn(iconButton, "ml-auto")} onClick={onClose} aria-label="Close the teleprompter">
          <X size={16} weight="bold" />
        </button>
      </div>
    </section>
  );
}
