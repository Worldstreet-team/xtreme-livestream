"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Eye, ImageSquare } from "@/components/icons";
import { Pill, pillClass } from "@/components/ui/pill";
import { BACKGROUNDS, LOOKS, SMOOTH_STEPS, gradeColor, isPlainLook, type Look, type LookSettings } from "@/lib/looks";
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
  const stops = REFERENCE.map(([r, g, b], i) => {
    const [R, G, B] = gradeColor(look, r, g, b);
    return `rgb(${Math.round(R * 255)} ${Math.round(G * 255)} ${Math.round(B * 255)}) ${STOPS[i]}`;
  });
  return `linear-gradient(135deg, ${stops.join(", ")})`;
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
  className?: string;
}

/**
 * The Look half of "Sound & look" on the setup screen: what's behind you,
 * the grade your picture wears, and skin smoothing. Every choice is a pill; the file
 * input is the "Your image" pill itself. Compact on a phone, a row where
 * there's room.
 */
export function LookSetup({ settings, onChange, supported, deviceOk, onPickImage, imageUrl, compare, className }: LookSetupProps) {
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const swatches = useMemo(() => Object.fromEntries(LOOKS.map((l) => [l.id, swatch(l.id)])) as Record<Look, string>, []);
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

      {/* The grade. Six chips: three across on a phone, a row where there's room. */}
      <fieldset disabled={!supported} className="min-w-0 disabled:opacity-60">
        <legend className={LABEL}>Look</legend>
        <div className="mt-2 grid grid-cols-3 gap-1.5 @[420px]:flex @[420px]:flex-wrap">
          {LOOKS.map((l) => {
            const selected = settings.look === l.id;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={selected}
                title={l.hint}
                onClick={() => onChange({ ...settings, look: l.id })}
                className={pillClass({
                  size: "sm",
                  variant: selected ? "primary" : "glass",
                  className: "w-full justify-start gap-2 pl-1.5 pr-3 @[420px]:w-auto",
                })}
              >
                <span
                  aria-hidden
                  className={cn("size-5 shrink-0 rounded-full", selected ? "ring-1 ring-black/15" : "ring-1 ring-white/10")}
                  style={{ background: swatches[l.id] }}
                />
                {l.label}
              </button>
            );
          })}
        </div>
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
