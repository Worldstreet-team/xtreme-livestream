"use client";

import { useMemo, useState } from "react";
import { Play } from "@/components/icons";
import { GiftArt } from "@/components/app/gift-art";
import { ShadesArt } from "@/components/app/gift-effects";
import { Badge } from "@/components/ui/badge";
import { Pill } from "@/components/ui/pill";
import { apiFetch } from "@/lib/api-client";
import type { FaceTrackState } from "@/lib/face-anchors";
import { effectDef, type EffectId } from "@/lib/gift-effects";
import { GIFT_CATALOG } from "@/lib/gifts";
import { LOOKS, gradeColor, type Look } from "@/lib/looks";
import { BRAND_FONT_CLASS, LAYOUTS, readBrand, type Brand, type SceneLayout } from "@/lib/scene";
import { SETS, giftsFor, setById, setEffects, type SetId, type SetManifest, type SetSounds } from "@/lib/sets";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
/** The look the host had before a set changed it — No set hands it back. */
const LOOK_KEY = "xtream:set-look-before";

export interface SetsPanelProps {
  /** The set on now: `brand.set`. */
  active: SetId | null;
  /** The brand kit as the route returned it after a change (already read with readBrand) — the studio keeps it. */
  onBrand: (brand: Brand) => void;
  /** The camera's look now, so No set can hand it back. */
  look: Look;
  /** Put a look on the camera (the studio's changeLook with this look). */
  onLook: (look: Look) => void;
  /** Switch the program to a layout (the studio's applyScene — Chart + face wants a chart). */
  onLayout: (layout: SceneLayout) => void;
  /** Which pad plays for which gift from now on; {} with No set. */
  onSounds: (sounds: SetSounds) => void;
  /** Play an effect on the host's own preview. */
  onTry: (effect: EffectId) => void;
  /** Face tracking on this device (useFaceAnchors), for the line under the sets. */
  face?: FaceTrackState;
  /** The audio desk is on — gift sounds play through it. */
  soundsReady?: boolean;
  /** Look, don't touch (a console without the rights). */
  disabled?: boolean;
  className?: string;
  /** Inside a section that already names it: no title of its own. */
  headless?: boolean;
}

function rememberLook(look: Look) {
  try {
    localStorage.setItem(LOOK_KEY, look);
  } catch {
    // A private window: No set leaves the look as the set left it.
  }
}

function recallLook(): Look | null {
  try {
    const v = localStorage.getItem(LOOK_KEY);
    localStorage.removeItem(LOOK_KEY);
    return LOOKS.some((l) => l.id === v) ? (v as Look) : null;
  } catch {
    return null;
  }
}

/** A look's chip swatch: reference tones through the look itself (as LookSetup draws them). */
function lookSwatch(look: Look) {
  const tones: [number, number, number][] = [
    [0.93, 0.88, 0.8],
    [0.76, 0.55, 0.42],
    [0.3, 0.55, 0.75],
    [0.12, 0.1, 0.11],
  ];
  const stops = ["0%", "36%", "68%", "100%"];
  return `linear-gradient(135deg, ${tones
    .map(([r, g, b], i) => {
      const [R, G, B] = gradeColor(look, r, g, b);
      return `rgb(${Math.round(R * 255)} ${Math.round(G * 255)} ${Math.round(B * 255)}) ${stops[i]}`;
    })
    .join(", ")})`;
}

/** "Crown, Lion and Whale" — the gifts that play an effect. */
function giftNames(set: SetManifest, effect: EffectId) {
  const names = giftsFor(set, effect).map((id) => GIFT_CATALOG.find((g) => g.id === id)?.name ?? id);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

const FACE_LINE: Record<FaceTrackState, string | null> = {
  off: null,
  loading: "Getting face tracking ready…",
  tracking: "Following your face.",
  searching: "Looking for your face — effects sit centre-frame until it's found.",
  unavailable: "Face tracking can't run in this browser — effects sit centre-frame.",
};

/**
 * The studio's Sets: pick one and the stream takes on its colour, look,
 * layout, gift sounds and effects; No set goes back. Every effect has a
 * Try button that plays it on your own preview only.
 */
export function SetsPanel({ active, onBrand, look, onLook, onLayout, onSounds, onTry, face = "off", soundsReady = true, disabled = false, className, headless = false }: SetsPanelProps) {
  const [busy, setBusy] = useState<SetId | "none" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const swatches = useMemo(() => Object.fromEntries(LOOKS.map((l) => [l.id, lookSwatch(l.id)])) as Record<Look, string>, []);

  const apply = async (id: SetId | null) => {
    if (busy || id === active) return;
    setBusy(id ?? "none");
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { brand: unknown } }>("/api/users/me/brand", {
        method: "PATCH",
        body: JSON.stringify({ set: id }),
      });
      onBrand(readBrand(r.data.brand));
    } catch {
      setError("Couldn't switch sets just now — try again.");
      setBusy(null);
      return;
    }
    const set = setById(id);
    if (set) {
      // From your own look to a set's: keep yours to come back to.
      if (!active) rememberLook(look);
      if (set.look && set.look !== look) onLook(set.look);
      if (set.layout) onLayout(set.layout);
      onSounds(set.sounds);
    } else {
      // Undo only what the set did: a look the host picked since stays.
      const back = recallLook();
      if (back && back !== look && look === setById(active)?.look) onLook(back);
      onSounds({});
    }
    setBusy(null);
  };

  const faceLine = FACE_LINE[face];

  return (
    <section aria-labelledby="sets-title" className={cn("@container", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id="sets-title" className={cn(LABEL, headless && "sr-only")}>
            Sets
          </p>
          <p className={cn("text-[12.5px] leading-snug text-muted-foreground", !headless && "mt-1.5")}>A colour, a look, a layout, gift sounds and effects around your face — on in one tap.</p>
        </div>
        <Pill size="sm" variant={active ? "glass" : "primary"} aria-pressed={!active} onClick={() => void apply(null)} disabled={disabled || busy !== null}>
          {busy === "none" ? "Taking it off…" : "No set"}
        </Pill>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-2 @[640px]:grid-cols-2">
        {SETS.map((set) => {
          const on = active === set.id;
          const layout = set.layout ? LAYOUTS.find((l) => l.id === set.layout) : null;
          const sounds = Object.keys(set.sounds).length;
          const lookLabel = set.look ? LOOKS.find((l) => l.id === set.look)?.label : null;
          return (
            <li key={set.id} className={cn("min-w-0 rounded-[12px] p-3.5", on ? "bg-white/[0.085] ring-1 ring-white/15" : "bg-white/[0.045]")}>
              <div className="flex items-start gap-3">
                {/* Its colours, as swatches. */}
                <span aria-hidden className="mt-0.5 flex shrink-0">
                  {set.palette.map((c, i) => (
                    <span key={c} className={cn("size-4 rounded-full ring-2 ring-[#181213]", i > 0 && "-ml-1.5")} style={{ background: c }} />
                  ))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[15px] leading-tight font-bold tracking-[-0.01em]", BRAND_FONT_CLASS[set.font ?? "wide"])}>{set.name}</p>
                  <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{set.blurb}</p>
                </div>
                {on ? (
                  <Badge variant="ember" size="sm" className="mt-0.5">
                    On
                  </Badge>
                ) : (
                  <Pill size="sm" variant="primary" onClick={() => void apply(set.id)} disabled={disabled || busy !== null} aria-label={`Use ${set.name}`}>
                    {busy === set.id ? "Putting it on…" : "Use"}
                  </Pill>
                )}
              </div>

              {/* What it changes. */}
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px] font-medium text-foreground/80">
                {lookLabel && set.look && (
                  <span className="flex h-7 items-center gap-1.5 rounded-full bg-white/[0.06] pr-2.5 pl-1">
                    <span aria-hidden className="size-5 rounded-full ring-1 ring-white/10" style={{ background: swatches[set.look] }} />
                    {lookLabel} look
                  </span>
                )}
                {layout && <span className="flex h-7 items-center rounded-full bg-white/[0.06] px-2.5">{layout.label} layout</span>}
                {sounds > 0 && (
                  <span className="flex h-7 items-center rounded-full bg-white/[0.06] px-2.5">
                    {sounds} gift sound{sounds === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {/* Its effects: each one plays on your preview. */}
              <p className="mt-3 text-[11px] text-muted-foreground">Gift effects · tap one to try it</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {setEffects(set).map((effect) => {
                  const def = effectDef(effect);
                  return (
                    <button
                      key={effect}
                      type="button"
                      onClick={() => onTry(effect)}
                      title={`${def.hint} — for ${giftNames(set, effect)}`}
                      aria-label={`Try ${def.label.toLowerCase()} on your preview`}
                      className="press flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] pr-2.5 pl-1 text-[12px] font-semibold transition-colors hover:bg-white/[0.11] disabled:opacity-40"
                    >
                      {def.art ? <GiftArt art={def.art} emoji={def.emoji} size={22} /> : <ShadesArt className="h-[22px] w-[26px] px-0.5" />}
                      {def.label}
                      <Play size={10} weight="fill" className="text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 space-y-1.5">
        {faceLine && (
          <p role="status" className="flex items-start gap-2 text-[12px] leading-snug text-foreground/85">
            <span aria-hidden className={cn("mt-[5px] size-1.5 shrink-0 rounded-full", face === "tracking" ? "bg-success" : face === "unavailable" ? "bg-white/30" : "bg-ember")} />
            <span>
              {faceLine}
              {(face === "tracking" || face === "searching") && (
                <span className="block text-[11.5px] text-muted-foreground">Found on this device. Viewers get a few points — where your eyes and mouth are — never a picture.</span>
              )}
            </span>
          </p>
        )}
        {!soundsReady && active && (
          <p className="text-[12px] leading-snug text-warning">Gift sounds play through the audio desk — turn it on under Sound.</p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-chili-hi">
            {error}
          </p>
        )}
        <p className="text-[11.5px] text-muted-foreground/70">Sets from designers are coming later.</p>
      </div>
    </section>
  );
}
