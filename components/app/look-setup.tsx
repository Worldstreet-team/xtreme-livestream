"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Eye, ImageSquare } from "@/components/icons";
import { Pill, pillClass } from "@/components/ui/pill";
import { BACKGROUNDS, LOOKS, SMOOTH_STEPS, gradeColor, isPlainLook, type Look, type LookSettings } from "@/lib/looks";
import { FACE_EFFECTS, notoUrl } from "@/lib/face-effects";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

/**
 * A look's chip: four reference tones — a highlight, a skin tone, a blue,
 * a shadow — put through the look itself, so the chip is the grade, not a
 * picture of it.
 */
const REFERENCE: [number, number, number][] = [
  [0.93, 0.88, 0.8],
  [0.76, 0.55, 0.42],
  [0.3, 0.55, 0.75],
  [0.12, 0.1, 0.11],
];
const STOPS = ["0%", "36%", "68%", "100%"];

function swatch(look: Look) {
  // Hard stops: four flat tones, not a blend — the chip reads as the look's colours.
  const stops = REFERENCE.map(([r, g, b], i) => {
    const [R, G, B] = gradeColor(look, r, g, b);
    const c = `rgb(${Math.round(R * 255)} ${Math.round(G * 255)} ${Math.round(B * 255)})`;
    return `${c} ${i === 0 ? "0%" : STOPS[i - 1]} ${STOPS[i]}`;
  });
  return `conic-gradient(from 45deg, ${stops.join(", ")})`;
}

/** The thumbnail's edge, in pixels: sharp at 56 CSS px on a 2x screen, and cheap to grade 14 times. */
const THUMB = 112;

/**
 * One still of the camera as captured (before any look or effect), square
 * and centred — what the look thumbnails are made from, the way camera
 * apps show a filter tray: your own face in each look.
 */
function useCameraStill(source: (() => MediaStreamTrack | null) | undefined) {
  const [still, setStill] = useState<ImageData | null>(null);
  useEffect(() => {
    const track = source?.();
    if (!track || track.readyState !== "live") return;
    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    const grab = () => {
      if (cancelled || !video.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = c.height = THUMB;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const side = Math.min(video.videoWidth, video.videoHeight);
      // Centred, a little high: faces sit in the upper middle of a frame.
      const sx = (video.videoWidth - side) / 2;
      const sy = Math.max(0, (video.videoHeight - side) * 0.35);
      ctx.drawImage(video, sx, sy, side, side, 0, 0, THUMB, THUMB);
      setStill(ctx.getImageData(0, 0, THUMB, THUMB));
      video.pause();
      video.srcObject = null;
    };
    video.addEventListener("loadeddata", () => requestAnimationFrame(grab), { once: true });
    void video.play().catch(() => {});
    return () => {
      cancelled = true;
      video.pause();
      video.srcObject = null;
    };
  }, [source]);
  return still;
}

/** The still through a look, as an image URL. */
function gradeStill(still: ImageData, look: Look): string {
  const c = document.createElement("canvas");
  c.width = still.width;
  c.height = still.height;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  const out = ctx.createImageData(still.width, still.height);
  const src = still.data;
  const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const [r, g, b] = gradeColor(look, src[i]! / 255, src[i + 1]! / 255, src[i + 2]! / 255);
    dst[i] = r * 255;
    dst[i + 1] = g * 255;
    dst[i + 2] = b * 255;
    dst[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return c.toDataURL("image/jpeg", 0.85);
}

export interface LookSetupProps {
  settings: LookSettings;
  onChange: (next: LookSettings) => void;
  /** Chrome or Edge with the frame pipeline (`isLooksSupported()`); off elsewhere. */
  supported: boolean;
  /** `deviceTest`'s verdict: null until it has run. */
  deviceOk: boolean | null;
  /** The host picked a picture of their own — it stays on this device. */
  onPickImage: (file: File) => void;
  /** That picture, as an object URL, once picked. */
  imageUrl?: string | null;
  /** Press and hold to see the camera as it is; the studio bypasses the processor while held. */
  compare?: { start(): void; stop(): void } | null;
  /** The camera as captured, for the looks' thumbnails (your own face in each look). */
  cameraSource?: () => MediaStreamTrack | null;
  /** The front camera: thumbnails are mirrored like the preview. */
  mirrored?: boolean;
  className?: string;
}

/**
 * The Look half of "Sound & look" on the setup screen: what's behind you,
 * the grade your picture wears, skin smoothing, and a face effect to wear
 * (a crown, puppy ears…). Every choice is a pill or a tile; the file
 * input is the "Your image" pill itself. Compact on a phone, a row where
 * there's room.
 */
export function LookSetup({ settings, onChange, supported, deviceOk, onPickImage, imageUrl, compare, cameraSource, mirrored = false, className }: LookSetupProps) {
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const swatches = useMemo(() => Object.fromEntries(LOOKS.map((l) => [l.id, swatch(l.id)])) as Record<Look, string>, []);
  const still = useCameraStill(cameraSource);
  const thumbs = useMemo(() => (still ? (Object.fromEntries(LOOKS.map((l) => [l.id, gradeStill(still, l.id)])) as Record<Look, string>) : null), [still]);
  const anythingOn = !isPlainLook(settings);
  // The nearest step, so a value from elsewhere still lights a pill.
  const smoothStep = SMOOTH_STEPS.reduce((best, s) => (Math.abs(s.value - settings.smooth) < Math.abs(best.value - settings.smooth) ? s : best), SMOOTH_STEPS[0]);
  const backgroundHint = BACKGROUNDS.find((b) => b.id === settings.background)?.hint;

  return (
    <div className={cn("@container flex flex-col gap-4", className)}>
      {/* What's behind you. */}
      <fieldset disabled={!supported} className="min-w-0 disabled:opacity-60">
        <legend className={LABEL}>Background</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {BACKGROUNDS.map((b) => {
            const selected = settings.background === b.id;
            if (b.id === "image") {
              // No picture yet: the pill is the file input. With one: the pill picks it, "Change" swaps it.
              return (
                <span key={b.id} className="flex items-center gap-1">
                  {imageUrl ? (
                    <Pill
                      size="sm"
                      variant={selected ? "primary" : "glass"}
                      aria-pressed={selected}
                      onClick={() => onChange({ ...settings, background: "image" })}
                      icon={
                        // eslint-disable-next-line @next/next/no-img-element -- an object URL, never fetched
                        <img src={imageUrl} alt="" className="size-4 rounded-full object-cover" />
                      }
                    >
                      {b.label}
                    </Pill>
                  ) : (
                    <label
                      htmlFor={fileId}
                      className={pillClass({
                        size: "sm",
                        variant: "glass",
                        className: cn(
                          "cursor-pointer focus-within:ring-2 focus-within:ring-ember focus-within:ring-offset-2 focus-within:ring-offset-background",
                          // A label doesn't dim with the fieldset; do it by hand.
                          !supported && "pointer-events-none opacity-50"
                        ),
                      })}
                    >
                      <ImageSquare size={14} />
                      {b.label}
                    </label>
                  )}
                  {imageUrl && selected && (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="press h-8 rounded-full px-2.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Change
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    id={fileId}
                    type="file"
                    accept="image/*"
                    aria-label="Your image — stays on this device"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onPickImage(file);
                      e.target.value = "";
                    }}
                  />
                </span>
              );
            }
            return (
              <Pill
                key={b.id}
                size="sm"
                variant={selected ? "primary" : "glass"}
                aria-pressed={selected}
                onClick={() => onChange({ ...settings, background: b.id })}
              >
                {b.label}
              </Pill>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground/70">
          {supported ? backgroundHint : "Backgrounds and looks need Chrome or Edge on a computer. Your picture goes out as it is."}
        </p>
        {supported && deviceOk === false && (
          <p role="status" className="mt-1.5 text-[12.5px] leading-snug text-value">
            Your device can&apos;t keep up with blur, so it&apos;s off.
          </p>
        )}
      </fieldset>

      {/* The grade, as a filter tray: your own face through each look, in a
          row that scrolls sideways — the way camera apps do it. Before the
          camera's up, each chip shows the look's four tones instead. */}
      <fieldset disabled={!supported} className="min-w-0 disabled:opacity-60">
        <legend className={LABEL}>Look</legend>
        <div className="relative -mx-1 mt-2">
          <div className="flex snap-x gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LOOKS.map((l) => {
              const selected = settings.look === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={selected}
                  title={l.hint}
                  onClick={() => onChange({ ...settings, look: l.id })}
                  className="press flex w-[60px] shrink-0 snap-start flex-col items-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-[56px] overflow-hidden rounded-full bg-white/[0.06] transition-shadow",
                      selected ? "ring-2 ring-ember ring-offset-2 ring-offset-surface" : "ring-1 ring-white/10"
                    )}
                    style={thumbs ? undefined : { background: swatches[l.id] }}
                  >
                    {thumbs && (
                      // eslint-disable-next-line @next/next/no-img-element -- a data URL graded on this device
                      <img src={thumbs[l.id]} alt="" draggable={false} className={cn("size-full object-cover", mirrored && "-scale-x-100")} />
                    )}
                  </span>
                  <span className={cn("max-w-full truncate text-[11.5px] leading-none", selected ? "font-bold text-foreground" : "font-medium text-muted-foreground")}>{l.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </fieldset>

      {/* Face effects: worn on camera, following the face. Tiles, the way camera apps show them. */}
      <fieldset disabled={!supported} className="min-w-0 disabled:opacity-60">
        <legend className={LABEL}>Face effects</legend>
        <div className="mt-2 grid grid-cols-4 gap-1.5 @[420px]:grid-cols-7">
          {FACE_EFFECTS.map((fx) => {
            const selected = settings.face === fx.id;
            return (
              <button
                key={fx.id}
                type="button"
                aria-pressed={selected}
                aria-label={fx.label}
                title={fx.label}
                onClick={() => onChange({ ...settings, face: fx.id })}
                className={cn(
                  "press flex aspect-square min-w-0 flex-col items-center justify-center gap-1 rounded-[12px] transition-colors",
                  selected ? "bg-white text-black ring-2 ring-ember" : "bg-white/[0.06] text-foreground hover:bg-white/[0.1]"
                )}
              >
                {fx.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a small remote vector, cached by the browser
                  <img src={notoUrl(fx.icon)} alt="" aria-hidden width={30} height={30} loading="lazy" className="size-[30px]" draggable={false} />
                ) : (
                  <span aria-hidden className="flex size-[30px] items-center justify-center rounded-full border-2 border-current opacity-60">
                    <span className="h-0.5 w-4 rotate-45 rounded-full bg-current" />
                  </span>
                )}
                <span className="max-w-full truncate px-1 text-[10.5px] font-semibold leading-none">{fx.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground/70">
          {settings.face !== "none"
            ? "Drawn into your picture, so everyone watching sees it. It follows your face; look at the camera if it doesn't show."
            : "Wear something on camera: it follows your face and everyone watching sees it."}
        </p>
      </fieldset>

      {/* Skin smoothing: off unless the host asks for it. */}
      <fieldset disabled={!supported} className="min-w-0 disabled:opacity-60">
        <legend className={LABEL}>Skin</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SMOOTH_STEPS.map((step) => {
            const selected = smoothStep.value === step.value;
            return (
              <Pill
                key={step.label}
                size="sm"
                variant={selected ? "primary" : "glass"}
                aria-pressed={selected}
                onClick={() => onChange({ ...settings, smooth: step.value })}
              >
                {step.label}
              </Pill>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground/70">
          {settings.smooth > 0
            ? "Evens out your skin. Eyes, brows and lips stay sharp. Viewers see an Effects on tag while it's on."
            : "Evens out your skin while you're live. Off by default."}
        </p>
      </fieldset>

      {supported && compare && anythingOn && <ComparePill compare={compare} />}
    </div>
  );
}

/** Hold to see the camera as it is — pointer or keyboard, and it lets go when anything interrupts. */
function ComparePill({ compare }: { compare: { start(): void; stop(): void } }) {
  const [held, setHeld] = useState(false);
  // The guard lives in a ref: a pointer-up and a lost capture can land in the same tick.
  const holding = useRef(false);
  const hold = () => {
    if (holding.current) return;
    holding.current = true;
    setHeld(true);
    compare.start();
  };
  const release = () => {
    if (!holding.current) return;
    holding.current = false;
    setHeld(false);
    compare.stop();
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    hold();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      hold();
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") release();
  };
  return (
    <div className="flex items-center gap-3">
      <Pill
        size="sm"
        variant={held ? "primary" : "glass"}
        icon={<Eye size={14} />}
        aria-pressed={held}
        aria-label="Hold to see your picture without the look"
        className="touch-none"
        onPointerDown={onPointerDown}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {held ? "As it is" : "Hold to compare"}
      </Pill>
      <span className="text-[12px] text-muted-foreground/70">{held ? "This is the camera alone." : "See it without."}</span>
    </div>
  );
}
