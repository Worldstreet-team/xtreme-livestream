"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeSlash, Plus, Shield, X } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { SwitchField } from "@/components/ui/selection-controls";
import { MAX_ZONES, MIN_ZONE, clampRect, describeZone, rectFromCorners, type Rect } from "@/lib/privacy-shield-detect";
import {
  DETECTOR_LABELS,
  PANIC_KEY,
  isShieldSupported,
  keepHidden,
  newZoneId,
  prewarmShield,
  setPanic,
  setShieldSettings,
  showAnyway,
  useShieldSettings,
  useShieldStatus,
  type PrivacyZone,
  type ShieldNotice,
  type ShieldSettings,
  type ShieldStatus,
} from "@/lib/privacy-shield";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";
const noSubscribe = () => () => {};

/* ---- the panel ---------------------------------------------------------- */

export interface PrivacyShieldViewProps {
  settings: ShieldSettings;
  onChange: (next: ShieldSettings) => void;
  status: ShieldStatus;
  /** Chrome or Edge on a computer (`isShieldSupported()`). */
  supported: boolean;
  /** A screen is being shared right now. */
  sharing: boolean;
  onPanic: (on: boolean) => void;
  onShowAnyway: (noticeId: string) => void;
  onKeepHidden: (noticeId: string) => void;
  /** The zone editor is up over the preview. */
  editingZones?: boolean;
  /** Put the zone editor up over the preview, or take it down. Without it there's no "Mark on the preview". */
  onEditZones?: (on: boolean) => void;
  /** The time, for "just now" and countdowns. */
  now: number;
  /** Inside a section that already names it: no title row of its own. */
  headless?: boolean;
  className?: string;
}

const ago = (ms: number) => (ms < 10_000 ? "just now" : ms < 60_000 ? `${Math.floor(ms / 1000)} s ago` : `${Math.floor(ms / 60_000)} min ago`);

/**
 * The privacy shield, as the host sets it: Hide (and its key), what the
 * shield just covered — with "Show anyway for 10 s" and "Keep hidden" —
 * the Shield switch and a switch per check, and the zones that are always
 * covered. A leaf: the studio (or `PrivacyShieldPanel`) passes the state.
 *
 * Its words never include "recovery phrase" or "private key": the studio
 * can be in the very screen the shield reads, and the panel mustn't slate
 * the share it's looking after.
 */
export function PrivacyShieldView({
  settings,
  onChange,
  status,
  supported,
  sharing,
  onPanic,
  onShowAnyway,
  onKeepHidden,
  editingZones = false,
  onEditZones,
  now,
  className,
  headless = false,
}: PrivacyShieldViewProps) {
  const titleId = useId();
  const on = settings.enabled && supported;
  const panic = status.panic;
  const d = settings.detectors;
  const setDetector = (id: keyof ShieldSettings["detectors"], v: boolean) => onChange({ ...settings, detectors: { ...d, [id]: v } });
  const zones = settings.zones;

  const state: { text: string; dot: string } = !supported
    ? { text: "Needs Chrome", dot: "bg-white/25" }
    : panic
      ? { text: "Screen hidden", dot: "bg-warning" }
      : !settings.enabled
        ? { text: "Off", dot: "bg-white/25" }
        : !sharing
          ? { text: "Ready", dot: "bg-white/40" }
          : status.phase === "on"
            ? { text: "On", dot: status.reason ? "bg-warning" : "bg-success" }
            : status.phase === "starting"
              ? { text: "Starting", dot: "animate-pulse bg-white/60" }
              : { text: "Off", dot: "bg-warning" };

  const every = status.stats.readEveryMs;
  const reading =
    !on || !sharing
      ? null
      : status.reading === "loading"
        ? "Loading the text checks…"
        : status.reading === "ready"
          ? every <= 1200
            ? "Reading your screen about once a second."
            : `Reading your screen every ${Math.round(every / 100) / 10} s, to go easy on this computer.`
          : null;

  const heading = (
    <>
      <div className={cn("flex items-center justify-between gap-3", headless && "hidden")}>
        <p id={titleId} className="flex items-center gap-2 text-[13.5px] font-semibold">
          <Shield size={16} weight="fill" className="text-foreground/80" />
          Privacy shield
        </p>
        <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold text-foreground/80" aria-live="polite">
          <span aria-hidden className={cn("size-1.5 rounded-full", state.dot)} />
          {state.text}
        </span>
      </div>
      <p className={cn("text-[12px] leading-snug text-muted-foreground", !headless && "mt-1")}>
        Covers what it recognises on your shared screen — a wallet&apos;s words, its keys, its QR codes — and the zones you mark. An assist, not a
        guarantee: it can take a second to catch something.
      </p>
    </>
  );

  // Nothing to set where it can't run: say so, once.
  if (!supported) {
    return (
      <section aria-labelledby={titleId} className={cn("rounded-[14px] bg-white/[0.04] p-3.5", className)}>
        {heading}
        <p role="status" className="mt-3 rounded-[12px] bg-warning/[0.1] px-3.5 py-3 text-[12.5px] leading-snug text-warning">
          The shield needs Chrome or Edge on a computer. Here, your screen goes out as it is.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={cn("@container rounded-[14px] bg-white/[0.04] p-3.5", className)}>
      {heading}

      {/* Hide: the one thing that always works, first — with its key on it. */}
      <Pill
        variant={panic ? "soft" : "primary"}
        tone="amber"
        icon={panic ? <Eye size={16} /> : <EyeSlash size={16} />}
        trailing={
          <kbd aria-hidden className={cn("ml-1 rounded-[6px] px-1.5 py-px font-mono text-[11px] font-bold", panic ? "bg-white/10" : "bg-black/[0.08] text-black/55")}>
            {PANIC_KEY.toUpperCase()}
          </kbd>
        }
        aria-pressed={panic}
        aria-keyshortcuts={PANIC_KEY.toUpperCase()}
        title={`While you share, ${PANIC_KEY.toUpperCase()} hides or shows it too — anywhere in Xtream, unless you're typing`}
        onClick={() => onPanic(!panic)}
        className="mt-3.5 w-full @[360px]:w-auto"
      >
        {panic ? "Show my screen" : "Hide my screen"}
      </Pill>
      {panic && (
        <p role="status" className="mt-2.5 rounded-[12px] bg-warning/[0.1] px-3.5 py-2.5 text-[12.5px] leading-snug text-warning">
          {sharing ? "Your screen is hidden. Viewers see “Screen hidden” until you show it." : "Hidden: your screen share will start hidden."}
        </p>
      )}

      {status.notices.length > 0 && (
        <ul className="mt-3.5 space-y-2" aria-label="What the shield covered">
          {status.notices.map((n) => (
            <NoticeRow key={n.id} notice={n} now={now} onShowAnyway={onShowAnyway} onKeepHidden={onKeepHidden} />
          ))}
        </ul>
      )}

      {/* The checks: the Shield switch, then one per kind of secret. */}
      <div className="mt-4 divide-y divide-white/[0.05] rounded-[12px] bg-white/[0.045] px-3.5 py-1">
        <SwitchField
          label="Shield"
          description={settings.enabled ? "Reads your screen for what's below while you share." : "Off: nothing's read. Your zones and Hide still work."}
          checked={settings.enabled}
          onCheckedChange={(v) => onChange({ ...settings, enabled: v })}
        />
        {DETECTOR_LABELS.map((det) => (
          <SwitchField
            key={det.id}
            label={det.label}
            description={det.id === "qr" && status.qr === false ? "This browser can't read QR codes — Chrome on a Mac or ChromeOS can." : det.hint}
            checked={d[det.id]}
            disabled={!on}
            onCheckedChange={(v) => setDetector(det.id, v)}
          />
        ))}
      </div>

      {/* Zones: parts of the screen that are always covered. */}
      <div className="mt-4">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <p className={LABEL}>Your zones</p>
          {onEditZones && (
            <Pill size="sm" variant={editingZones ? "primary" : "glass"} disabled={!sharing} onClick={() => onEditZones(!editingZones)}>
              {editingZones ? "Done" : "Mark on the preview"}
            </Pill>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
          {zones.length
            ? "Always covered while you share, Shield switch on or off."
            : sharing
              ? "Parts of your screen that are always covered — a balance, a sidebar, your notifications. Draw them on the preview."
              : "Parts of your screen that are always covered — a balance, a sidebar, your notifications. Share your screen to draw them on it."}
        </p>
        {zones.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {zones.map((z, i) => (
              <li key={z.id} className="flex h-10 items-center gap-2.5 rounded-[10px] bg-white/[0.045] pr-1 pl-3">
                <ZoneMap zone={z} />
                <span className="shrink-0 text-[13px] font-semibold">Zone {i + 1}</span>
                <span className="min-w-0 truncate text-[12px] text-muted-foreground">{describeZone(z)}</span>
                <button
                  type="button"
                  aria-label={`Remove zone ${i + 1}`}
                  onClick={() => onChange({ ...settings, zones: zones.filter((x) => x.id !== z.id) })}
                  className="press ml-auto flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
                >
                  <X size={14} weight="bold" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* Only while sharing: a zone added blind, with no screen to see it on, lands anywhere. */}
        {(sharing || zones.length > 1) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sharing && (
              <Pill
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                disabled={zones.length >= MAX_ZONES}
                onClick={() => onChange({ ...settings, zones: [...zones, centredZone()] })}
              >
                Add a zone
              </Pill>
            )}
            {zones.length > 1 && (
              <Pill size="sm" variant="ghost" onClick={() => onChange({ ...settings, zones: [] })}>
                Clear all
              </Pill>
            )}
          </div>
        )}
      </div>

      {(status.reason || reading) && (
        <p role="status" className={cn("mt-3 text-[11.5px] leading-snug", status.reason ? "text-warning" : "text-muted-foreground")}>
          {status.reason ?? reading}
        </p>
      )}
    </section>
  );
}

/** Where a zone sits, in miniature: the screen as a little frame, the zone filled in. */
function ZoneMap({ zone }: { zone: Rect }) {
  return (
    <span aria-hidden className="relative h-[15px] w-[26px] shrink-0 rounded-[3px] bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)]">
      <span
        className="absolute rounded-[1.5px] bg-white/80"
        style={{ left: `${zone.x * 100}%`, top: `${zone.y * 100}%`, width: `max(2px, ${zone.w * 100}%)`, height: `max(2px, ${zone.h * 100}%)` }}
      />
    </span>
  );
}

/** A zone in the middle of the screen, for keyboards and taps: move it and size it from there. */
function centredZone(): PrivacyZone {
  return { id: newZoneId(), x: 0.35, y: 0.4, w: 0.3, h: 0.2 };
}

function NoticeRow({
  notice: n,
  now,
  onShowAnyway,
  onKeepHidden,
}: {
  notice: ShieldNotice;
  now: number;
  onShowAnyway: (id: string) => void;
  onKeepHidden: (id: string) => void;
}) {
  const showing = n.active && n.showingUntil > now;
  const hidden = n.active && !showing;
  const whole = n.kind === "phrase" || n.kind === "key-page";
  const secondsLeft = Math.max(1, Math.ceil((n.showingUntil - now) / 1000));
  return (
    <li className={cn("rounded-[12px] px-3.5 py-3", hidden && !n.kept ? "bg-warning/[0.1]" : "bg-white/[0.045]")}>
      <p className={cn("flex items-center gap-2 text-[13px] font-semibold", hidden && !n.kept ? "text-warning" : n.active ? "text-foreground" : "text-muted-foreground")}>
        {showing ? <Eye size={15} className="shrink-0" /> : <EyeSlash size={15} className="shrink-0" />}
        <span className="min-w-0">{n.text}</span>
      </p>
      <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
        {ago(now - n.at)} ·{" "}
        {!n.active ? "off your screen now" : showing ? `viewers can see it for ${secondsLeft} s` : n.kept ? "kept hidden" : whole ? "viewers see “Screen hidden”" : "covered for viewers"}
      </p>
      {n.active && !n.kept && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {showing ? (
            <Pill size="sm" variant="primary" onClick={() => onKeepHidden(n.id)}>
              Hide it again
            </Pill>
          ) : (
            <>
              <Pill size="sm" variant="primary" onClick={() => onKeepHidden(n.id)}>
                Keep hidden
              </Pill>
              <Pill size="sm" variant="glass" onClick={() => onShowAnyway(n.id)}>
                Show anyway for 10 s
              </Pill>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The shield's panel, wired to the stores: the settings this browser
 * keeps, what the shield on the share is doing, Hide. The studio passes
 * whether a screen is being shared, and — to offer "Mark on the preview" —
 * whether the zone editor is up.
 */
export function PrivacyShieldPanel({
  sharing,
  editingZones,
  onEditZones,
  prewarm = false,
  className,
  headless = false,
}: {
  sharing: boolean;
  editingZones?: boolean;
  onEditZones?: (on: boolean) => void;
  /** Load the shield's code and the text checks now (~7 MB the first time, cached after), so the first share's first read is quick. */
  prewarm?: boolean;
  className?: string;
  /** Inside a section that already names it: no title row of its own. */
  headless?: boolean;
}) {
  const settings = useShieldSettings();
  const status = useShieldStatus();
  // Unknown on the server's paint: assume yes rather than flash "Needs Chrome".
  const supported = useSyncExternalStore(noSubscribe, isShieldSupported, () => true);
  const now = useNow(status.notices.length > 0);
  useEffect(() => {
    if (prewarm) prewarmShield();
  }, [prewarm]);
  return (
    <PrivacyShieldView
      settings={settings}
      onChange={(next) => setShieldSettings(next)}
      status={status}
      supported={supported}
      sharing={sharing}
      onPanic={setPanic}
      onShowAnyway={showAnyway}
      onKeepHidden={keepHidden}
      editingZones={editingZones}
      onEditZones={onEditZones}
      now={now}
      className={className}
      headless={headless}
    />
  );
}

/* ---- the zone editor ------------------------------------------------------ */

type Handle = "nw" | "ne" | "sw" | "se";
type Drag =
  | { kind: "draw"; id: number; ax: number; ay: number; rect: Rect }
  | { kind: "move"; id: number; zone: string; dx: number; dy: number; rect: Rect }
  | { kind: "resize"; id: number; zone: string; handle: Handle; rect: Rect };

export interface PrivacyZonesEditorProps {
  zones: PrivacyZone[];
  /** Called when a drag ends, a zone's removed, or a key moves one — not on every pointer move. */
  onChange: (zones: PrivacyZone[]) => void;
  /** The shared screen's width ÷ height: the editor lies over the picture the way object-fit: contain shows it. Omit to fill the box. */
  aspect?: number | null;
  /** Shows "Done". */
  onDone?: () => void;
  className?: string;
}

/**
 * Zones, drawn over the program preview: drag across the picture to cover
 * part of it, drag a zone to move it, its corners to size it, × to remove
 * it. By keyboard: Tab to a zone, the arrows move it, Shift and the arrows
 * size it, Delete removes it, Escape is Done; "Add a zone" puts one in the
 * middle. Coordinates in and out are the screen's 0..1 square.
 *
 * Mount it where the preview's picture is (its parent positioned, the same
 * box as the video). It marks that box and draws itself above the whole
 * page, pinned to it — so the studio's top row and dock, which sit over
 * the picture, don't cover its edges or its controls while it's up.
 */
export function PrivacyZonesEditor(props: PrivacyZonesEditorProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  // Follow the picture: a layout change, the stacked stage growing when live, a window resize.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = anchorRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const hidden = getComputedStyle(el).visibility === "hidden";
        setBox((cur) =>
          cur && cur.x === r.x && cur.y === r.y && cur.w === r.width && cur.h === r.height && cur.hidden === hidden
            ? cur
            : { x: r.x, y: r.y, w: r.width, h: r.height, hidden }
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      <div ref={anchorRef} aria-hidden className={cn("pointer-events-none absolute inset-0", props.className)} />
      {/* Out of sight (the studio minimized): nothing to draw on. */}
      {box && box.w > 0 && box.h > 0 && createPortal(box.hidden ? <NotInThisLayout box={box} onDone={props.onDone} /> : <ZonesLayer {...props} box={box} />, document.body)}
    </>
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The picture's there but not shown — a layout that hides the screen (the chart with your face). */
  hidden: boolean;
}

const pinned = (box: Box) => ({ left: box.x, top: box.y, width: box.w, height: box.h });

/** The layout doesn't show the shared screen (the chart with your face): nothing to draw on, so say so. */
function NotInThisLayout({ box, onDone }: { box: Box; onDone?: () => void }) {
  return (
    <div className="fixed z-[var(--layer-overlay)] flex items-end justify-center p-3" style={pinned(box)}>
      <div role="status" className="flex max-w-[26rem] flex-col items-center gap-2 rounded-[14px] bg-black/85 px-4 py-3 text-center">
        <p className="text-[13px] font-semibold text-white">Your screen isn&apos;t in this layout</p>
        <p className="text-[12px] leading-snug text-white/70">Zones are drawn over your shared screen. Switch to a layout that shows it to mark them.</p>
        {onDone && (
          <Pill size="sm" variant="primary" onClick={onDone}>
            Done
          </Pill>
        )}
      </div>
    </div>
  );
}

function ZonesLayer({ zones, onChange, aspect, onDone, box }: PrivacyZonesEditorProps & { box: Box }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const focusNext = useRef<string | null>(null);
  const full = zones.length >= MAX_ZONES;

  // Up: the keyboard lands in the editor, so Tab reaches the zones at once.
  useEffect(() => {
    frameRef.current?.focus({ preventScroll: true });
  }, []);

  // A zone just added by keyboard takes focus, so the arrows work on it at once.
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    frameRef.current?.querySelector<HTMLElement>(`[data-zone="${id}"]`)?.focus();
  }, [zones]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const capture = (e: PointerEvent<HTMLElement>) => {
    try {
      frameRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // A pointer the browser doesn't know (a synthetic one): the drag still works while it stays inside.
    }
  };

  const startDraw = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget || full) {
      if (e.target === e.currentTarget) setSelected(null);
      return;
    }
    e.preventDefault();
    const p = point(e);
    capture(e);
    setSelected(null);
    setDrag({ kind: "draw", id: e.pointerId, ax: p.x, ay: p.y, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
  };
  const startMove = (e: PointerEvent<HTMLElement>, z: PrivacyZone) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const p = point(e);
    capture(e);
    setSelected(z.id);
    setDrag({ kind: "move", id: e.pointerId, zone: z.id, dx: p.x - z.x, dy: p.y - z.y, rect: { x: z.x, y: z.y, w: z.w, h: z.h } });
  };
  const startResize = (e: PointerEvent<HTMLElement>, z: PrivacyZone, handle: Handle) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    capture(e);
    setSelected(z.id);
    setDrag({ kind: "resize", id: e.pointerId, zone: z.id, handle, rect: { x: z.x, y: z.y, w: z.w, h: z.h } });
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = point(e);
    if (drag.kind === "draw") {
      setDrag({ ...drag, rect: rectFromCorners(drag.ax, drag.ay, p.x, p.y) });
    } else if (drag.kind === "move") {
      setDrag({ ...drag, rect: clampRect({ ...drag.rect, x: p.x - drag.dx, y: p.y - drag.dy }) });
    } else {
      const z = zones.find((x) => x.id === drag.zone);
      if (!z) return;
      // The opposite corner stays put.
      const ax = drag.handle === "nw" || drag.handle === "sw" ? z.x + z.w : z.x;
      const ay = drag.handle === "nw" || drag.handle === "ne" ? z.y + z.h : z.y;
      setDrag({ ...drag, rect: rectFromCorners(ax, ay, p.x, p.y) });
    }
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.id) return;
    setDrag(null);
    const r = drag.rect;
    if (drag.kind === "draw") {
      // A click, not a drag: nothing to add.
      if (r.w < MIN_ZONE || r.h < MIN_ZONE) return;
      const zone = { id: newZoneId(), ...clampRect(r) };
      setSelected(zone.id);
      onChange([...zones, zone]);
    } else {
      onChange(zones.map((z) => (z.id === drag.zone ? { ...z, ...clampRect(r) } : z)));
    }
  };

  const remove = (id: string) => {
    if (selected === id) setSelected(null);
    onChange(zones.filter((z) => z.id !== id));
  };
  const add = () => {
    if (full) return;
    const z = centredZone();
    focusNext.current = z.id;
    setSelected(z.id);
    onChange([...zones, z]);
  };

  const onZoneKey = (e: KeyboardEvent<HTMLDivElement>, z: PrivacyZone) => {
    const step = 0.01;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key]) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      const next = e.shiftKey ? { ...z, w: z.w + dx, h: z.h + dy } : { ...z, x: z.x + dx, y: z.y + dy };
      onChange(zones.map((x) => (x.id === z.id ? { ...x, ...clampRect(next) } : x)));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(z.id);
      frameRef.current?.focus();
    } else if (e.key === "Escape") {
      // Off the zone; Escape again (on the frame) is Done.
      e.stopPropagation();
      setSelected(null);
      frameRef.current?.focus();
    }
  };
  const onFrameKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && e.target === e.currentTarget && onDone) {
      e.preventDefault();
      onDone();
    }
  };

  // What's on screen: the zones as they are, with the one being dragged where the pointer has it.
  const shown = zones.map((z) => (drag && drag.kind !== "draw" && drag.zone === z.id ? { ...z, ...drag.rect } : z));
  const drawing = drag?.kind === "draw" && drag.rect.w > 0 && drag.rect.h > 0 ? drag.rect : null;
  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="fixed z-[var(--layer-overlay)] [container-type:size]" style={pinned(box)}>
      <div
        ref={frameRef}
        role="group"
        aria-label="Privacy zones on your shared screen"
        aria-describedby={hintId}
        tabIndex={-1}
        onPointerDown={startDraw}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onFrameKey}
        className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 touch-none bg-black/15 outline-none select-none",
          "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.55)]",
          full ? "cursor-default" : "cursor-crosshair",
          !aspect && "size-full"
        )}
        style={aspect ? { aspectRatio: String(aspect), width: `min(100cqw, calc(100cqh * ${aspect}))` } : undefined}
      >
        <p id={hintId} className="sr-only">
          Drag across your screen to cover part of it. Tab to a zone: the arrow keys move it, Shift and the arrow keys size it, Delete removes it. Escape
          is Done.
        </p>
        {shown.map((z, i) => {
          const on = selected === z.id;
          return (
            <div
              key={z.id}
              data-zone={z.id}
              role="group"
              tabIndex={0}
              aria-roledescription="zone"
              aria-label={`Zone ${i + 1}, ${describeZone(z)}`}
              onPointerDown={(e) => startMove(e, z)}
              onFocus={(e) => e.target === e.currentTarget && setSelected(z.id)}
              onKeyDown={(e) => onZoneKey(e, z)}
              className={cn(
                "group absolute cursor-move rounded-[6px] bg-black/60 outline-none",
                on ? "z-10 shadow-[inset_0_0_0_2px_#fff]" : "shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.7)]",
                "focus-visible:shadow-[inset_0_0_0_2px_#fff,0_0_0_3px_var(--ember)]"
              )}
              style={{ left: pct(z.x), top: pct(z.y), width: pct(z.w), height: pct(z.h) }}
            >
              <span className="pointer-events-none absolute top-1.5 left-2 rounded-full bg-black/70 px-1.5 py-px text-[10.5px] font-semibold text-white">
                Zone {i + 1}
              </span>
              <button
                type="button"
                aria-label={`Remove zone ${i + 1}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => remove(z.id)}
                className="press absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-white text-[#0b0708] shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
              >
                <X size={12} weight="bold" />
              </button>
              {on &&
                (["nw", "ne", "sw", "se"] as const).map((h) => (
                  <span
                    key={h}
                    aria-hidden
                    onPointerDown={(e) => startResize(e, z, h)}
                    className={cn(
                      "absolute flex size-7 items-center justify-center",
                      h === "nw" && "-top-3.5 -left-3.5 cursor-nwse-resize",
                      h === "ne" && "-top-3.5 -right-3.5 cursor-nesw-resize",
                      h === "sw" && "-bottom-3.5 -left-3.5 cursor-nesw-resize",
                      h === "se" && "-right-3.5 -bottom-3.5 cursor-nwse-resize"
                    )}
                  >
                    <span className="size-3 rounded-[3px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
                  </span>
                ))}
            </div>
          );
        })}
        {drawing && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[6px] bg-black/45 shadow-[inset_0_0_0_1.5px_#fff]"
            style={{ left: pct(drawing.x), top: pct(drawing.y), width: pct(drawing.w), height: pct(drawing.h) }}
          />
        )}

        {/* What to do — mouse and keys — and the way out, along the bottom, clear of the zones' own controls. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center px-2">
          <div
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-[14px] bg-black/80 py-1.5 pr-1.5 pl-3.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <p aria-hidden className="hidden min-w-0 text-[12px] leading-snug font-medium text-white/85 @[420px]:block">
              {full ? `That's ${MAX_ZONES} zones — the most there can be.` : "Drag across your screen to cover part of it."}
              <span className="hidden text-white/60 @[700px]:inline"> Tab to a zone: arrows move it, Shift + arrows size it, Delete removes it.</span>
            </p>
            <div className="flex items-center gap-1.5">
              <Pill size="sm" variant="glass" icon={<Plus size={14} />} onClick={add} disabled={full}>
                Add a zone
              </Pill>
              {onDone && (
                <Pill size="sm" variant="primary" onClick={onDone}>
                  Done
                </Pill>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
