"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Camera, Check, Copy } from "@/components/icons";
import { QrCode } from "@/components/app/qr-code";
import { LayoutThumb } from "@/components/app/scene-controls";
import { Pill } from "@/components/ui/pill";
import { PHONE_SHOTS, PHONE_SLOT_CHOICES, cameraIdentityOf, phoneOnScreen, phoneShotOf, phoneShotWords } from "@/lib/angles";
import { apiFetch } from "@/lib/api-client";
import { formatCountdown, LAYOUTS, type PhoneSlot, type SceneLayout } from "@/lib/scene";
import { serverNow } from "@/lib/server-clock";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const noSubscribe = () => () => {};

interface CameraLink {
  code: string;
  /** Relative: `/camera/<code>`. Made absolute with this browser's origin. */
  url: string;
  expiresAt: string;
}

/**
 * A second camera, from the studio's Stage panel: a phone scans a code and
 * becomes another angle on the stream — no app, no sign-in, its mic never
 * sent. The code is one-time and lives ten minutes; a phone waiting on it
 * starts sending the moment the host goes live. Once it's in, the host
 * places it in the picture like any other source: full frame, beside them,
 * or in the corner — over their screen as their face, say.
 */
export function SecondCameraPanel({
  hostId,
  layout,
  phoneSlot,
  onPlace,
  sharing = false,
  hasCamera = false,
  phoneConnected,
  disabled = false,
  headless = false,
}: {
  hostId: string;
  /** The layout on air (`scene.layout`). */
  layout: SceneLayout;
  /** Where the phone sits (`scene.phoneSlot`). */
  phoneSlot: PhoneSlot;
  /** Write a placement — and, for a shot, its layout — to the scene. */
  onPlace: (patch: { layout?: SceneLayout; phoneSlot: PhoneSlot }) => void;
  /** A screen has the host's main picture: the corner is their face. */
  sharing?: boolean;
  /** The host has a camera of their own to put in the corner. */
  hasCamera?: boolean;
  /** A `cam-<hostId>` participant is publishing in the room. */
  phoneConnected: boolean;
  /** Everything off — the console is read-only, say. */
  disabled?: boolean;
  /** Inside a section that already names it: no title of its own. */
  headless?: boolean;
}) {
  // The address as this browser reaches the app; empty on the server's paint.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const [link, setLink] = useState<CameraLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The countdown only ticks while a code is on screen.
  const now = useNow(Boolean(link) && !phoneConnected);

  // Another channel's studio (a console switching hosts) starts over.
  useEffect(() => {
    setLink(null);
    setError(null);
  }, [hostId]);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ success: boolean; data: CameraLink }>("/api/users/me/camera-link", { method: "POST" });
      setLink(r.data);
    } catch {
      setError("Couldn't make a code just now — try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard (an insecure origin): the address is on screen to type.
    }
  };

  // `now` keeps this re-rendering; the clock itself is the server's.
  void now;
  const msLeft = link ? Date.parse(link.expiresAt) - serverNow() : 0;
  const expired = Boolean(link) && msLeft <= 0;
  const absolute = link && origin ? `${origin}${link.url}` : "";
  const shown = absolute.replace(/^https?:\/\//, "");
  const canSwitch = phoneConnected && !disabled;

  return (
    <section aria-labelledby="second-camera-title" className="rounded-[14px] bg-white/[0.04] p-3.5" data-camera={cameraIdentityOf(hostId)}>
      <p id="second-camera-title" className={cn("flex items-center gap-2 text-[13.5px] font-semibold", headless && "sr-only")}>
        <Camera size={16} className="text-ember-hi" />
        Second camera
      </p>
      <p className={cn("text-[12px] leading-snug text-muted-foreground", !headless && "mt-1")}>
        Point a phone at the action. It scans a code and sends its camera — no app, no sign-in, and its mic is never sent.
      </p>

      {/* The phone's state: a red dot while it's sending, ember while we wait for it. */}
      {phoneConnected ? (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p role="status" className="flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
            <span aria-hidden className="size-2 rounded-full bg-chili" />
            Phone sending
          </p>
          <Pill size="sm" variant="ghost" onClick={() => void ask()} disabled={busy || disabled}>
            Swap phone
          </Pill>
        </div>
      ) : link && !expired ? (
        <p role="status" className="mt-3 flex items-center gap-2 text-[12.5px] font-semibold text-foreground">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-ember" />
          Waiting for the phone
        </p>
      ) : null}

      {/* The code: a QR to scan, the address to type, and how long it's good for. */}
      {link && (!phoneConnected || busy) ? (
        <div className="mt-3">
          <div className="flex items-start gap-3.5">
            {origin && !expired && <QrCode value={absolute} label={`QR code for ${shown}`} className="size-28 shrink-0 rounded-[10px]" />}
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-snug text-muted-foreground">
                {expired ? "This code has run out — make a new one." : "Scan it with the phone's camera, or type the address."}
              </p>
              <p className={cn("mt-2 font-mono text-[11.5px] tabular-nums", expired ? "text-chili-hi" : "text-muted-foreground")}>
                {expired ? "Expired" : `Expires in ${formatCountdown(msLeft)}`}
              </p>
              {expired && (
                <Pill size="sm" variant="primary" onClick={() => void ask()} disabled={busy || disabled} className="mt-2">
                  New code
                </Pill>
              )}
            </div>
          </div>
          {/* The address on its own line: the whole thing reads, even on a phone. */}
          {!expired && (
            <div className="mt-3 flex items-center gap-1.5">
              <span className="h-9 min-w-0 flex-1 truncate rounded-full bg-white/[0.06] px-3.5 font-mono text-[12px] leading-9 text-foreground/85" title={absolute}>
                {shown || link.url}
              </span>
              <button
                type="button"
                onClick={() => void copy(absolute)}
                disabled={!absolute}
                className="press flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[12.5px] font-bold text-[#0b0708] disabled:opacity-40"
              >
                {copied ? <Check size={14} weight="bold" /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
        </div>
      ) : !phoneConnected ? (
        <Pill variant="primary" icon={<Camera size={16} />} onClick={() => void ask()} disabled={busy || disabled} className="mt-3">
          {busy ? "Making a code…" : "Add a phone camera"}
        </Pill>
      ) : null}
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-chili-hi">
          {error}
        </p>
      )}

      <PhoneShots className="mt-4" layout={layout} slot={phoneSlot} onPlace={onPlace} enabled={canSwitch} sharing={sharing} hasCamera={hasCamera} />
    </section>
  );
}

/**
 * Where the phone goes, as shots: each a layout and a placement together,
 * drawn small the way the program will place them (the ember tile is the
 * phone), so one tap puts it exactly there. Nothing to choose until the
 * phone's in — in the studio's panel, and on its own in the producer's
 * console. Any other framing (Trio with the phone beside, say) is the
 * Scenes panel's, and reads here as it is.
 */
export function PhoneShots({
  layout,
  slot,
  onPlace,
  enabled,
  sharing = false,
  hasCamera = false,
  crew = false,
  className,
}: {
  layout: SceneLayout;
  slot: PhoneSlot;
  onPlace: (patch: { layout?: SceneLayout; phoneSlot: PhoneSlot }) => void;
  /** A phone is sending, and this surface may change the scene. */
  enabled: boolean;
  sharing?: boolean;
  hasCamera?: boolean;
  /** A producer's console: the words are about the host. */
  crew?: boolean;
  className?: string;
}) {
  const active = phoneShotOf(layout, slot);
  const shots = PHONE_SHOTS.filter((s) => !s.needsCamera || hasCamera);
  const line = !enabled
    ? "Once the phone's sending, choose where it goes."
    : active
      ? `${phoneShotWords(active, { sharing, crew }).hint}.`
      : phoneOnScreen(slot, layout)
        ? `${LAYOUTS.find((l) => l.id === layout)?.label ?? layout} with the phone ${(PHONE_SLOT_CHOICES.find((c) => c.id === slot)?.label ?? slot).toLowerCase()}, set in Scenes.`
        : `${LAYOUTS.find((l) => l.id === layout)?.label ?? layout} has no room for the phone ${slot === "beside" ? "beside" : "there"}, so it isn't in the picture — pick a shot to place it.`;
  return (
    <div className={className}>
      <p id="phone-shots-label" className={LABEL}>
        Where the phone goes
      </p>
      <div role="radiogroup" aria-labelledby="phone-shots-label" aria-disabled={!enabled} className="mt-2 grid grid-cols-3 gap-2">
        {shots.map((shot) => {
          const on = active === shot.id;
          const words = phoneShotWords(shot.id, { sharing, crew });
          return (
            <button
              key={shot.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!enabled}
              title={words.hint}
              onClick={() => !on && onPlace(shot.layout ? { layout: shot.layout, phoneSlot: shot.slot } : { phoneSlot: shot.slot })}
              className={cn(
                "press flex flex-col items-stretch gap-1.5 rounded-[12px] p-2 text-[11.5px] font-semibold transition-colors disabled:opacity-40",
                on ? "bg-inverse text-on-inverse" : "bg-tint/[0.05] text-foreground/85 hover:bg-tint/[0.08]"
              )}
            >
              {/* "Not shown" is the layout on air without the phone. */}
              <LayoutThumb layout={shot.layout ?? layout} phone={shot.slot} />
              {/* Two lines at most, so "Screen + phone" reads whole in a narrow column. */}
              <span className="line-clamp-2 text-center leading-tight">{words.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
        {line} {enabled && "Viewers can pin an angle of their own."}
      </p>
    </div>
  );
}
