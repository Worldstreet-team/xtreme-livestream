"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { giftArtUrl } from "@/lib/gifts";
import { fallbackFace, frameBox, mapFace, mixFace, visibleBox, type AnchorFeed, type FaceGeo, type Fit } from "@/lib/face-anchors";
import { admitEffect, effectDef, posePiece, startEffect, type EffectId, type EffectRun, type Piece } from "@/lib/gift-effects";
import { effectForGift, setArt, type GiftRef, type SetManifest } from "@/lib/sets";
import { cn } from "@/lib/utils";

/**
 * Gift effects on the picture (Phase 4, Sets): a crown on the host's head,
 * shades on their eyes, hearts, fire, confetti, a rocket, diamonds — drawn
 * over the main tile on every screen, around the face the host's browser
 * found (lib/face-anchors.ts), or centre-frame when no face is known.
 *
 * It sits inside the tile, over the video, and takes the video's crop
 * (`fit`) and mirror, so a crown lands where the head is drawn. Gifts come
 * in through the handle from `onReady` — tip lines arrive in a LiveKit
 * callback, not through React state (GiftOverlay's pattern). One clock
 * runs while anything plays; each frame the face is sampled, eased, and
 * every piece's transform written straight to the DOM. Several gifts stack:
 * a crown already up stays longer and pulses, a fourth confetti cuts the
 * first short. Under reduced motion each gift is a still badge instead.
 */

export interface GiftEffectsHandle {
  /** A gift landed (by its tip line's emoji or catalog id): plays the set's effect for it, if any. Returns what played. */
  gift(gift: GiftRef, opts?: { id?: string }): EffectId | null;
  /** Play an effect outright — the Sets panel's "Try it". */
  play(effect: EffectId): void;
  /** Everything off at once. */
  clear(): void;
}

export interface GiftEffectsProps {
  /** The stream's Set: which gift plays which effect, and the colours its confetti wears. Null: gifts draw nothing (Try it still plays). */
  set?: SetManifest | null;
  /** Where the host's face is: the feed the room's "anchors" packets go into, or the studio's own. Null: centre-frame. */
  anchors?: AnchorFeed | null;
  /** How the video sits in the tile — its object-fit. */
  fit?: Fit;
  /** The picture's drawn mirrored (the host's own front camera): so are the effects. */
  mirrored?: boolean;
  /**
   * How far behind the anchors the picture runs, ms. A viewer's video
   * trails the data channel — ~200 meets it; the host's own preview is
   * live, so ~80 (enough to glide between detections).
   */
  delayMs?: number;
  onReady?: (handle: GiftEffectsHandle) => void;
  className?: string;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  const m = window.matchMedia?.(REDUCED);
  m?.addEventListener("change", onChange);
  return () => m?.removeEventListener("change", onChange);
}
/** The viewer asked for less motion. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, () => Boolean(window.matchMedia?.(REDUCED).matches), () => false);
}

/** How long a still badge stays. */
const BADGE_MS = 3000;
const NO_SAMPLE = { face: null, aspect: null };

interface Badge {
  key: string;
  effect: EffectId;
  x: number;
  y: number;
}

export function GiftEffects({ set = null, anchors = null, fit = "cover", mirrored = false, delayMs = 200, onReady, className }: GiftEffectsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [runs, setRuns] = useState<EffectRun[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const reduced = useReducedMotion();

  // What the clock reads each frame, kept current without restarting it.
  const live = useRef({ set, anchors, fit, mirrored, delayMs, reduced });
  useLayoutEffect(() => {
    live.current = { set, anchors, fit, mirrored, delayMs, reduced };
  });

  const runsRef = useRef<EffectRun[]>([]);
  const nodes = useRef(new Map<string, HTMLElement>());
  const tile = useRef({ w: 0, h: 0 });
  const geo = useRef<FaceGeo | null>(null);
  const seen = useRef<string[]>([]);
  const count = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  // The tile's size, as it changes (a resize, a layout glide, fullscreen).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const read = () => {
      tile.current = { w: el.clientWidth, h: el.clientHeight };
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** Where the face is on the tile now, in the picture's own (unmirrored) coordinates. */
  const target = useCallback((now: number): FaceGeo => {
    const { anchors: feed, delayMs: delay, fit: f } = live.current;
    const { w, h } = tile.current;
    const s = feed ? feed.sample(delay, now) : NO_SAMPLE;
    const aspect = s.aspect ?? w / Math.max(1, h);
    if (s.face) return mapFace(s.face, aspect, w, h, f);
    return fallbackFace(visibleBox(frameBox(aspect, w, h, f), w, h));
  }, []);

  const measure = () => {
    const el = rootRef.current;
    if (el && (tile.current.w === 0 || tile.current.h === 0)) tile.current = { w: el.clientWidth, h: el.clientHeight };
    return tile.current;
  };

  const play = useCallback(
    (effect: EffectId) => {
      const now = performance.now();
      const t = measure();
      const g = geo.current ?? target(now);
      const n = ++count.current;
      if (live.current.reduced) {
        // A still badge above the head instead: no movement at all.
        const x = live.current.mirrored ? t.w - g.cx : g.cx;
        const y = Math.max(10, Math.min(t.h - 44, g.cy - g.fh * 0.62 - g.fw * 0.3));
        const key = `badge-${n}`;
        setBadges((prev) => [...prev.slice(-2), { key, effect, x, y }]);
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          setBadges((prev) => prev.filter((b) => b.key !== key));
        }, BADGE_MS);
        timers.current.add(timer);
        return;
      }
      if (t.w === 0 || t.h === 0) return;
      const admitted = admitEffect(runsRef.current, effect, now);
      if (admitted.kind === "add") {
        const flip = effect === "rocket" && runsRef.current.filter((r) => r.effect === "rocket").length % 2 === 1;
        const run = startEffect(effect, g, t, { now, key: `${effect}-${n}`, seed: n * 7919 + Math.floor(now), palette: live.current.set?.palette, flip });
        runsRef.current = [...runsRef.current, run];
      }
      setRuns([...runsRef.current]);
    },
    [target]
  );

  const gift = useCallback(
    (ref: GiftRef, opts?: { id?: string }) => {
      // The same chat line twice (a resend, a reconnect) plays once.
      if (opts?.id) {
        if (seen.current.includes(opts.id)) return null;
        seen.current = [...seen.current.slice(-49), opts.id];
      }
      const effect = effectForGift(live.current.set, ref);
      if (effect) play(effect);
      return effect;
    },
    [play]
  );

  const clear = useCallback(() => {
    runsRef.current = [];
    setRuns([]);
    setBadges([]);
  }, []);

  useEffect(() => {
    onReady?.({ gift, play, clear });
  }, [onReady, gift, play, clear]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // The set's art, loaded before its first gift lands.
  useEffect(() => {
    for (const a of setArt(set)) {
      const img = new Image();
      img.decoding = "async";
      img.src = giftArtUrl(a);
    }
  }, [set]);

  // The clock: only while something plays.
  const playing = runs.length > 0;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.max(0, now - last);
      last = now;
      const { w, h } = tile.current;
      if (w > 0 && h > 0) {
        const want = target(now);
        const cur = geo.current;
        // Eased: quick while following a face, gentler when it's found or lost.
        geo.current = cur ? mixFace(cur, want, 1 - Math.exp(-dt / (cur.known === want.known ? 45 : 180))) : want;
        const g = geo.current;
        let ended = false;
        for (const run of runsRef.current) {
          if (now >= run.end) {
            ended = true;
            continue;
          }
          run.pieces.forEach((p, i) => {
            const el = nodes.current.get(`${run.key}:${i}`);
            if (!el) return;
            const pose = posePiece(run, p, now, g, { w, h });
            if (!pose || pose.o <= 0.001) {
              el.style.opacity = "0";
              return;
            }
            el.style.transform = `translate3d(${(pose.x - p.w / 2).toFixed(1)}px, ${(pose.y - p.h / 2).toFixed(1)}px, 0) rotate(${pose.rot.toFixed(2)}deg) scale(${pose.sx.toFixed(3)}, ${pose.sy.toFixed(3)})`;
            el.style.opacity = pose.o.toFixed(3);
            el.style.zIndex = String(pose.z ?? 1);
          });
        }
        if (ended) {
          runsRef.current = runsRef.current.filter((r) => now < r.end);
          setRuns(runsRef.current);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, target]);

  // Stable, so a piece already on screen isn't redrawn when another run starts.
  const onNode = useCallback((key: string, el: HTMLElement | null) => {
    if (el) nodes.current.set(key, el);
    else nodes.current.delete(key);
  }, []);

  return (
    <div ref={rootRef} aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden [contain:strict]", className)}>
      <div className="absolute inset-0" style={mirrored ? { transform: "scaleX(-1)" } : undefined}>
        {runs.map((run) => run.pieces.map((p, i) => <PieceView key={`${run.key}:${i}`} nodeKey={`${run.key}:${i}`} piece={p} onNode={onNode} />))}
      </div>
      {badges.map((b, i) => {
        const def = effectDef(b.effect);
        return (
          <span
            key={b.key}
            className="absolute flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 py-1 pr-3 pl-1.5 text-[12px] font-semibold whitespace-nowrap text-white"
            style={{ left: b.x, top: b.y + i * 34 }}
          >
            <span className="text-[16px] leading-none">{def.emoji}</span>
            {def.label}
          </span>
        );
      })}
    </div>
  );
}

/** One piece: sized once, moved by the clock. Hidden until its first pose. */
const PieceView = memo(function PieceView({ piece, nodeKey, onNode }: { piece: Piece; nodeKey: string; onNode: (key: string, el: HTMLElement | null) => void }) {
  const nodeRef = useCallback((el: HTMLElement | null) => onNode(nodeKey, el), [onNode, nodeKey]);
  const base: CSSProperties = { position: "absolute", left: 0, top: 0, width: piece.w, height: piece.h, opacity: 0, willChange: "transform, opacity" };
  const look = piece.look;
  switch (look.kind) {
    case "art":
      return <EffectArt art={look.art} emoji={look.emoji} style={base} nodeRef={nodeRef} />;
    case "shades":
      return (
        <div ref={nodeRef} style={base}>
          <ShadesArt className="size-full" />
        </div>
      );
    case "bit":
      return <div ref={nodeRef} style={{ ...base, background: look.color, borderRadius: look.round ? "50%" : 1 }} />;
    case "puff":
      return <div ref={nodeRef} style={{ ...base, borderRadius: "50%", background: "rgba(255, 248, 240, 0.8)" }} />;
    case "spark":
      return (
        <div ref={nodeRef} style={base}>
          <SparkArt color={look.color} className="size-full" />
        </div>
      );
  }
});

/** The gift's animated art; its emoji at the same size if the art won't load. */
function EffectArt({ art, emoji, style, nodeRef }: { art: string; emoji: string; style: CSSProperties; nodeRef: (el: HTMLElement | null) => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span ref={nodeRef} style={{ ...style, fontSize: Number(style.height) * 0.8, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {emoji}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote animated WebP; next/image would freeze it
    <img
      ref={nodeRef}
      src={giftArtUrl(art)}
      alt=""
      width={Number(style.width)}
      height={Number(style.height)}
      loading="eager"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ ...style, objectFit: "contain", userSelect: "none" }}
    />
  );
}

/** Shades, drawn: two black lenses on a bar, a glint on each. */
export function ShadesArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 64" className={className} aria-hidden>
      <path d="M2 9.5C2 7 4 5 6.5 5h187c2.5 0 4.5 2 4.5 4.5v3c0 2.5-2 4.5-4.5 4.5H6.5C4 17 2 15 2 12.5z" fill="#0b0708" />
      <path d="M10 12h80c2.8 0 4.6 2.8 3.6 5.4L84 48c-2 6-7.5 10-13.8 10H32.2c-6.6 0-12.3-4.4-14-10.8L7 16.6C6.3 14.3 7.8 12 10 12z" fill="#0b0708" />
      <path d="M110 12h80c2.2 0 3.7 2.3 3 4.6l-11.2 30.6c-1.7 6.4-7.4 10.8-14 10.8h-37.6c-6.3 0-11.8-4-13.8-10l-9.6-30.6c-1-2.6.8-5.4 3.6-5.4z" fill="#0b0708" />
      <path d="M22 20h14L27 46h-8z" fill="#fff" opacity="0.3" />
      <path d="M122 20h14l-9 26h-8z" fill="#fff" opacity="0.3" />
    </svg>
  );
}

/** A four-point sparkle. */
function SparkArt({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 0c1 7.6 4.4 11 12 12-7.6 1-11 4.4-12 12-1-7.6-4.4-11-12-12C7.6 11 11 7.6 12 0z" fill={color} />
    </svg>
  );
}
