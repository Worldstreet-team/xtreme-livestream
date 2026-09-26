"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { apiUrl } from "@/lib/api-client";
import { stageLayout } from "@/lib/stage-layout";
import { useNow } from "@/lib/use-now";
import { serverNow, serverOffset } from "@/lib/server-clock";
import { centsToDollars, giftByEmoji } from "@/lib/gifts";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GiftArt } from "@/components/app/gift-art";
import { QrCode } from "@/components/app/qr-code";
import { MarketChart } from "@/components/app/market-chart";
import { formatQuote, marketBase, useQuotes } from "@/lib/market";
import { Fire } from "@/components/icons";
import {
  goalAmount,
  goalShowing,
  goalUnit,
  heatNow,
  HEAT_NAMES,
  nextMilestone,
  type StreamGoal,
  type StreamHeat,
} from "@/lib/goals";
import {
  ACCENTS,
  BRAND_FONT_CLASS,
  CARDS,
  DEFAULT_BRAND,
  DEFAULT_CHART,
  featuredDeadline,
  formatCountdown,
  guestsShown,
  layerOf,
  shortUrl,
  type Brand,
  type FeaturedItem,
  type LogoCorner,
  type Scene,
  type SceneCard,
  type SceneLayer,
} from "@/lib/scene";

/** How long a graphic takes to leave. */
const EXIT_MS = 320;
/** How long a tile takes to glide to its new place when the layout changes. */
const GLIDE_MS = 440;
/** Quick to go, gentle to land — and never past the mark, so a tile can't cross into its neighbour. */
const GLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** A tile's box in the program's own coordinates, and its corner radius. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

function between(a: Box, b: Box, t: number): Box {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
    r: a.r + (b.r - a.r) * t,
  };
}

/**
 * Layout changes glide (Phase 2, transitions). A tile is two boxes: the
 * cell, which the layout places, and the picture inside it. When the layout
 * changes — a guest joins, split becomes grid, Chart + face takes the host
 * into the corner — every cell is measured before and after, and its
 * picture is eased from the old box to the new one by its edges, so it
 * moves and re-crops like a real frame (a scale would squash a face, and
 * the name on it). A tile that's new fades in where it lands.
 *
 * Boxes are kept relative to the program, so scrolling the page in between
 * doesn't throw them, and re-measured when it resizes, so a resize or a
 * fullscreen just lands. A second change mid-glide carries on from where
 * the picture is. Reduced motion lands at once.
 */
function useGlide(signature: string) {
  const frame = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const boxes = useRef(new Map<string, Box>());
  const gliding = useRef(new Map<string, { from: Box; to: Box; run: Animation }>());
  const lastSignature = useRef<string | null>(null);

  const cell = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      if (el) cells.current.set(key, el);
      else {
        cells.current.delete(key);
        gliding.current.delete(key);
      }
    },
    []
  );

  const measure = useCallback(() => {
    const origin = frame.current?.getBoundingClientRect();
    const next = new Map<string, Box>();
    if (!origin) return next;
    for (const [key, el] of cells.current) {
      const r = el.getBoundingClientRect();
      next.set(key, {
        x: r.left - origin.left,
        y: r.top - origin.top,
        w: r.width,
        h: r.height,
        r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      });
    }
    return next;
  }, []);

  // A resize moves the cells without a render: keep the boxes true to it.
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      boxes.current = measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  useLayoutEffect(() => {
    const changed = lastSignature.current !== null && lastSignature.current !== signature;
    lastSignature.current = signature;
    const before = boxes.current;
    const after = measure();
    boxes.current = after;
    if (!changed || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    for (const [key, el] of cells.current) {
      const picture = el.firstElementChild;
      const to = after.get(key);
      if (!(picture instanceof HTMLElement) || typeof picture.animate !== "function" || !to?.w || !to.h) continue;
      // Mid-glide, the picture is between its last two boxes: carry on from there.
      let from = before.get(key);
      const running = gliding.current.get(key);
      if (running?.run.playState === "running") {
        from = between(running.from, running.to, running.run.effect?.getComputedTiming().progress ?? 1);
      }
      running?.run.cancel();
      gliding.current.delete(key);

      if (!from) {
        picture.animate([{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], {
          duration: GLIDE_MS,
          easing: GLIDE_EASE,
        });
        continue;
      }
      if (Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y), Math.abs(from.w - to.w), Math.abs(from.h - to.h)) < 1) continue;
      // The picture's edges, as insets from the cell it's landing in.
      const edges = (b: Box) => ({
        top: `${b.y - to.y}px`,
        right: `${to.x + to.w - b.x - b.w}px`,
        bottom: `${to.y + to.h - b.y - b.h}px`,
        left: `${b.x - to.x}px`,
        borderRadius: `${b.r}px`,
      });
      const run = picture.animate([edges(from), edges(to)], { id: "glide", duration: GLIDE_MS, easing: GLIDE_EASE });
      gliding.current.set(key, { from, to, run });
    }
  });

  return { frame, cell };
}

/**
 * `value` while it's set; for `ms` after it's cleared, the last one it had,
 * marked leaving — so what it drew can go rather than vanish. Adjusted while
 * rendering, as SceneGraphics holds a featured comment. `value` must keep its
 * identity from render to render (a prop, or memoized).
 */
function useLinger<T>(value: T | null, ms: number): { value: T; leaving: boolean } | null {
  const [prev, setPrev] = useState(value);
  const [gone, setGone] = useState<T | null>(null);
  if (value !== prev) {
    setPrev(value);
    setGone(value === null ? prev : null);
  }
  useEffect(() => {
    if (gone === null) return;
    const t = setTimeout(() => setGone(null), ms);
    return () => clearTimeout(t);
  }, [gone, ms]);
  if (value !== null) return { value, leaving: false };
  return gone === null ? null : { value: gone, leaving: true };
}

export interface SceneCell {
  key: string;
  node: ReactNode;
  /** Whose tile it is, when that isn't its key (a viewer's own tile is "me"): what a spotlight matches. */
  identity?: string;
}

/**
 * One program, drawn from the scene — the same way on the watch page and in
 * the studio's preview (and, once recording lands, in the egress template).
 *
 * The host's main picture is always the first cell, so its video element
 * never remounts as the layout changes. The layout decides which of the
 * others show; a shared screen takes the main picture with the host's
 * camera in the corner; and a card, when the host puts one up, covers the
 * whole frame while the room keeps hearing them. The host's graphics —
 * lower third, banner, ticker, countdown, logo — draw over the lot in their
 * brand accent, as DOM, so they stay sharp at any quality the video drops to.
 */
export function SceneRenderer({
  scene,
  portrait,
  main,
  mainLabel,
  pip,
  pipClassName,
  guests,
  forceAuto = false,
  host,
  brand = DEFAULT_BRAND,
  insets,
  stage,
  goal = null,
  heat = null,
  hideRestricted = false,
}: {
  scene: Scene;
  /** Is the frame taller than it is wide? Splits follow the long axis. */
  portrait: boolean;
  /** The main picture: the host's camera, or their screen when they share one. */
  main: ReactNode;
  /** Named on the picture once it shares the frame. */
  mainLabel?: string;
  /** The host's camera while their screen has the main picture. */
  pip?: ReactNode;
  /** Where the corner camera sits — surfaces have their own chrome to avoid. */
  pipClassName?: string;
  /** Everyone else on stage, in order: a battle's other side, guests, you. */
  guests: SceneCell[];
  /** A battle keeps its split whatever the scene says. */
  forceAuto?: boolean;
  /** Who the cards are about. */
  host: { name: string; avatar?: string | null };
  /** The host's brand kit: the accent the graphics wear, the lower third's shape, the logo. */
  brand?: Brand;
  /**
   * How much of the frame's top and bottom the surface's own chrome takes
   * (CSS lengths): graphics sit in what's left, clear of the player's
   * controls or the phone's chat. Changes glide, so graphics can move out of
   * the way of controls that come and go.
   */
  insets?: { top?: string; bottom?: string };
  /**
   * Where the tiles sit in the frame (CSS lengths) — a battle on an upright
   * phone keeps the two sides in a band under its header. The whole frame
   * when unset. The frame itself doesn't move, so tiles glide in and out.
   */
  stage?: { top: string; height: string };
  /** The host's goal and how far it's got (goals.ts on the API). */
  goal?: StreamGoal | null;
  /** The heat meter as of the last gift. */
  heat?: StreamHeat | null;
  /**
   * This viewer is where crypto, betting and alcohol sponsors stay off
   * screen unless cleared (lib/sponsors.ts): such a card isn't drawn.
   */
  hideRestricted?: boolean;
}) {
  const layout = forceAuto ? "auto" : scene.layout;
  // A sign-language interpreter stays in a corner, whatever the layout, and
  // the layout places everyone else.
  const interpreter = scene.interpreter ? guests.find((g) => (g.identity ?? g.key) === scene.interpreter) : undefined;
  const others = interpreter ? guests.filter((g) => g !== interpreter) : guests;
  // The guest in the spotlight comes first, so a Split shows them beside the
  // host. A battle keeps its own order: its sides are never reshuffled.
  const ordered =
    scene.spotlight && !forceAuto
      ? [...others].sort((a, b) => Number((b.identity ?? b.key) === scene.spotlight) - Number((a.identity ?? a.key) === scene.spotlight))
      : others;
  const shown = ordered.slice(0, guestsShown(layout, ordered.length, forceAuto));
  const grid = stageLayout(1 + shown.length, portrait);
  // Chart + face: the chart has the frame and the host's face the corner.
  const chartMode = layout === "chart-face";
  const showPip = Boolean(pip) && shown.length === 0 && layout !== "solo" && !chartMode;
  // A logo up top lands top-left in chart mode (the camera has the right), so the chart's header steps down.
  const logoTop = Boolean(brand.logoUrl && layerOf(scene.layers, "logo")?.corner.startsWith("top"));
  // What moves the tiles: the layout, who's shown, the frame's shape.
  const { frame, cell } = useGlide([layout, portrait ? "p" : "l", shown.map((g) => g.key).join(","), showPip ? "pip" : ""].join("|"));
  // The chart and a card each stay a moment after they're taken down, fading
  // as the picture comes back over them, rather than cutting to black.
  const chart = useLinger(chartMode ? (scene.chart ?? DEFAULT_CHART) : null, EXIT_MS);
  const cardNow = useMemo(() => (scene.card ? { card: scene.card, note: scene.cardNote } : null), [scene.card, scene.cardNote]);
  const card = useLinger(cardNow, EXIT_MS);

  return (
    // Isolated: the program — picture, card, graphics — is one layer, and
    // whatever the surface draws after it (its controls, its status
    // screens, gifts) sits on top.
    <div ref={frame} className="@container relative isolate size-full">
      {chart && (
        // The chart keeps to the part of the frame the surface leaves clear —
        // under a phone's header and above its chat — like the graphics do.
        <div
          className={cn(
            "absolute inset-x-0 bg-[#0b0708] transition-[top,bottom] duration-300 ease-out",
            chart.leaving
              ? "motion-safe:animate-[fade-out_320ms_ease-in_both] motion-reduce:hidden"
              : "motion-safe:animate-[fade-in_300ms_ease-out_both]"
          )}
          style={{ top: insets?.top ?? 0, bottom: insets?.bottom ?? 0 }}
        >
          <MarketChart chart={chart.value} accent={ACCENTS[brand.accent]} headerLow={logoTop} maxCandles={portrait ? 45 : 90} />
        </div>
      )}
      <div
        className={cn("grid gap-px", stage ? "absolute inset-x-0" : "size-full", grid.container)}
        style={stage ? { top: stage.top, height: stage.height } : undefined}
      >
        {/* In chart mode this same cell becomes the corner camera — restyled,
            not moved, so the host's video element is never remounted. The
            cell is where the layout puts the tile; the picture inside it is
            what glides there (useGlide), so the cell itself doesn't clip. */}
        <div
          ref={cell("host")}
          className={cn(
            "relative",
            chartMode
              ? cn(
                  "absolute z-10 aspect-video rounded-[12px] bg-black [&_video]:object-cover",
                  portrait ? "w-[40%]" : "w-[30%]",
                  pipClassName ?? "top-3 right-3"
                )
              : grid.hostCell
          )}
        >
          <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
            {/* Sharing a screen in chart mode: the face is the camera, so the
                screen stays attached but out of sight. */}
            <div className={cn("size-full", chartMode && pip && "invisible")}>{main}</div>
            {chartMode && pip && <div className="absolute inset-0">{pip}</div>}
            {mainLabel && shown.length > 0 && (
              <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-full bg-black/55 px-2.5 py-1">
                <span className="block truncate text-xs font-semibold text-white">{mainLabel}</span>
              </div>
            )}
            {showPip && (
              <div
                className={cn(
                  "absolute z-10 aspect-video overflow-hidden rounded-[12px] bg-black motion-safe:animate-[fade-in_300ms_ease-out_both]",
                  layout === "screen-face" ? "w-[30%]" : "w-[24%]",
                  pipClassName ?? "top-3 right-3"
                )}
              >
                {pip}
              </div>
            )}
          </div>
        </div>
        {shown.map((g) => (
          <div key={g.key} ref={cell(g.key)} className="relative">
            <div className="absolute inset-0 overflow-hidden rounded-[inherit]">{g.node}</div>
          </div>
        ))}
      </div>
      {card && (
        <SceneCardView
          card={card.value.card}
          note={card.value.note}
          leaving={card.leaving}
          host={host}
          countdown={layerOf(scene.layers, "countdown")}
          accent={ACCENTS[brand.accent].fill}
          fontClass={BRAND_FONT_CLASS[brand.font]}
        />
      )}
      <SceneGraphics
        layers={scene.layers}
        featured={scene.featured ?? null}
        brand={brand}
        carded={Boolean(scene.card)}
        battle={forceAuto}
        pipShown={showPip || chartMode}
        insets={insets}
        goal={goal}
        heat={heat}
        hideRestricted={hideRestricted}
        interpreter={interpreter?.node}
      />
      <GraphicsAnnouncer scene={scene} />
    </div>
  );
}

/** Words a screen reader says when a graphic goes up — a lower third, a banner, a card, a line put on screen. */
function announcementOf(scene: Scene) {
  const said: string[] = [];
  if (scene.card) said.push(`${CARDS.find((c) => c.id === scene.card)?.title ?? "A card"} on screen${scene.cardNote ? `: ${scene.cardNote}` : ""}.`);
  const lower = layerOf(scene.layers, "lower-third");
  if (lower) said.push(`${lower.title}${lower.subtitle ? `, ${lower.subtitle}` : ""}.`);
  const banner = layerOf(scene.layers, "banner");
  if (banner) said.push(`${banner.text}.`);
  const ticker = layerOf(scene.layers, "ticker");
  if (ticker) said.push(`${ticker.text}.`);
  if (scene.featured) said.push(`${scene.featured.username}: ${scene.featured.text}`);
  return said;
}

/**
 * Graphics for screen readers (accessibility): what goes up on screen is
 * said once, politely — only what's new, and no more than one message
 * every few seconds, so a busy show doesn't talk over itself.
 */
function GraphicsAnnouncer({ scene }: { scene: Scene }) {
  const [message, setMessage] = useState("");
  const said = useRef<Set<string>>(new Set());
  const lastAt = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lines = announcementOf(scene).join(" ");
  useEffect(() => {
    const fresh = lines ? announcementOf(scene).filter((l) => !said.current.has(l)) : [];
    said.current = new Set(announcementOf(scene));
    if (fresh.length === 0) return;
    const wait = Math.max(0, lastAt.current + 4000 - Date.now());
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      lastAt.current = Date.now();
      setMessage(fresh.join(" "));
    }, wait);
    // `lines` stands for the scene's words: a new version with the same words says nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    []
  );
  return (
    <p aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}

/**
 * The host's graphics, each in its place: the price strip, banner and
 * countdown at the top, the lower third and ticker at the bottom, the logo
 * in its corner.
 *
 * A card takes the lower third, the banner, the prices and a featured comment down with
 * the picture they're about, and draws the countdown itself, big, as its
 * centrepiece; the ticker and logo stay over it. A battle owns the top of the frame, so
 * what's up there stands aside until it ends; and the corner camera keeps
 * the top right, moving a logo set there across to the left.
 */
function SceneGraphics({
  layers,
  featured,
  brand,
  carded,
  battle,
  pipShown,
  insets,
  goal,
  heat,
  hideRestricted,
  interpreter,
}: {
  layers: SceneLayer[];
  featured: FeaturedItem | null;
  brand: Brand;
  carded: boolean;
  battle: boolean;
  pipShown: boolean;
  insets?: { top?: string; bottom?: string };
  goal: StreamGoal | null;
  heat: StreamHeat | null;
  hideRestricted: boolean;
  /** A sign-language interpreter's picture: in the bottom-right stack, over cards too. */
  interpreter?: ReactNode;
}) {
  const accent = ACCENTS[brand.accent];
  // The goal and the meter keep to the top with the banner: under a card
  // they wait, and a battle has the top to itself.
  const goalUp = !carded && !battle && goalShowing(goal) ? goal : null;
  const heatUp = !carded && !battle ? heat : null;
  const fontClass = BRAND_FONT_CLASS[brand.font] ?? "font-wide";
  const lowerThird = carded ? undefined : layerOf(layers, "lower-third");
  const cta = carded ? undefined : layerOf(layers, "cta");
  // A sponsor's card stays over a card too ("brought to you by"), unless
  // this viewer is somewhere it may not be shown.
  const sponsorCard = layerOf(layers, "sponsor");
  const sponsor = sponsorCard && !(sponsorCard.restricted && hideRestricted) ? sponsorCard : undefined;
  const banner = carded || battle ? undefined : layerOf(layers, "banner");
  const countdown = carded || battle ? undefined : layerOf(layers, "countdown");
  // The price strip keeps the banner's hours: down under a card, and while a battle has the top.
  const prices = carded || battle ? undefined : layerOf(layers, "prices");
  const ticker = layerOf(layers, "ticker");
  const logo = brand.logoUrl ? layerOf(layers, "logo") : undefined;
  let corner: LogoCorner | null = logo?.corner ?? null;
  if (corner === "top-right" && pipShown) corner = "top-left";
  if (corner?.startsWith("top") && battle) corner = null;
  const topLogo = corner?.startsWith("top") ? corner : null;
  const bottomLogo = corner && !corner.startsWith("top") ? corner : null;

  // What's featured, and — for a moment after the host takes it down — what
  // was, so it can leave rather than vanish. Adjusted while rendering, the
  // way React has props drive state, rather than in an effect.
  const [shown, setShown] = useState<{ item: FeaturedItem; leaving: boolean } | null>(
    featured ? { item: featured, leaving: false } : null
  );
  // A new `at` is a new showing — the host can put the same line up again.
  if (featured && (featured.id !== shown?.item.id || featured.at !== shown.item.at)) {
    setShown({ item: featured, leaving: false });
  } else if (!featured && shown && !shown.leaving) {
    setShown({ ...shown, leaving: true });
  }
  const clearShown = useCallback(() => setShown((cur) => (cur?.leaving ? null : cur)), []);
  const card = !carded && shown ? shown : null;
  const logoImg = (className?: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- the host's own logo, served versioned by the API
    <img
      src={brand.logoUrl!}
      alt=""
      draggable={false}
      className={cn("h-[clamp(24px,5.5cqw,68px)] w-auto max-w-[20cqw] shrink-0 object-contain", className)}
    />
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 transition-[padding] duration-300 ease-out"
      style={
        {
          paddingTop: insets?.top,
          paddingBottom: insets?.bottom,
          "--g-fill": accent.fill,
          "--g-ink": accent.ink,
          "--g-m": "clamp(8px, 2.2cqw, 24px)",
        } as CSSProperties
      }
    >
      <div className="relative size-full">
        {topLogo && logoImg(cn("absolute top-[var(--g-m)]", topLogo === "top-left" ? "left-[var(--g-m)]" : "right-[var(--g-m)]"))}

        {(prices || banner || countdown || goalUp || heatUp) && (
          <div
            className={cn(
              "absolute top-[var(--g-m)] flex flex-col items-center gap-[calc(var(--g-m)/2)]",
              // A logo up top keeps its column: the banner narrows rather than run into it.
              topLogo ? "inset-x-[calc(20cqw+var(--g-m)*2)]" : "inset-x-[var(--g-m)]"
            )}
          >
            {/* Prices first, at the very top: a row of pills the banner and the rest sit under. */}
            {prices && <PricesStrip symbols={prices.symbols} />}
            {banner && (
              <p
                key={banner.text}
                className={cn(
                  "max-w-[min(100%,36rem)] rounded-[clamp(4px,0.6cqw,8px)] bg-[var(--g-fill)] px-[0.9em] py-[0.45em] text-center text-[clamp(12px,1.8cqw,24px)] leading-tight font-bold tracking-[-0.01em] text-balance text-[var(--g-ink)] motion-safe:animate-[graphic-in-down_420ms_var(--ease-spring)_both]",
                  fontClass
                )}
              >
                {banner.text}
              </p>
            )}
            {countdown && <CountdownGraphic key={countdown.endsAt} label={countdown.label} endsAt={countdown.endsAt} />}
            {(goalUp || heatUp) && (
              <div className="flex max-w-full flex-wrap items-center justify-center gap-[calc(var(--g-m)/2)]">
                {/* A new goal, or this one reached, enters afresh. */}
                {goalUp && <GoalBar key={`${goalUp.id}:${goalUp.reachedAt ? "reached" : "going"}`} goal={goalUp} fontClass={fontClass} />}
                {heatUp && <HeatMeter heat={heatUp} />}
              </div>
            )}
          </div>
        )}

        {(lowerThird || ticker || bottomLogo || card || cta || sponsor || interpreter) && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[calc(var(--g-m)/2)]">
            {card && (
              <div className={cn("flex px-[var(--g-m)]", !lowerThird && !bottomLogo && !ticker && "pb-[var(--g-m)]")}>
                <FeaturedCard key={`${card.item.id}:${card.item.at}`} item={card.item} leaving={card.leaving} onGone={clearShown} />
              </div>
            )}
            {/* The lower third's row: a bottom logo stacks above it on the
                left, or shares its baseline on the right. */}
            {(lowerThird || bottomLogo || cta || sponsor || interpreter) && (
              // Side by side on a wide frame; on a narrow one (a phone) the
              // right-hand column stacks above, so the name keeps its width.
              <div
                className={cn(
                  "flex flex-col-reverse gap-[calc(var(--g-m)/2)] px-[var(--g-m)] @lg:flex-row @lg:items-end",
                  !ticker && "pb-[var(--g-m)]"
                )}
              >
                {/* Left: the lower third, a bottom-left logo above it. */}
                <div className="flex min-w-0 flex-1 flex-col items-start gap-[calc(var(--g-m)/2)]">
                  {bottomLogo === "bottom-left" && logoImg()}
                  {lowerThird && (
                    <LowerThird
                      key={`${lowerThird.title}|${lowerThird.subtitle}`}
                      title={lowerThird.title}
                      subtitle={lowerThird.subtitle}
                      style={brand.lowerThird}
                      fontClass={fontClass}
                    />
                  )}
                </div>
                {/* Right: the sponsor and the call to action, a bottom-right logo above them. */}
                {(bottomLogo === "bottom-right" || cta || sponsor || interpreter) && (
                  <div className="flex shrink-0 flex-col items-end gap-[calc(var(--g-m)/2)] self-end @lg:self-auto">
                    {interpreter && (
                      <div className="relative aspect-[3/4] w-[clamp(104px,20cqw,240px)] overflow-hidden rounded-[10px] bg-black ring-2 ring-white/85">
                        {interpreter}
                        <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 px-1.5 py-px text-[10px] font-bold text-white">Interpreter</span>
                      </div>
                    )}
                    {bottomLogo === "bottom-right" && logoImg()}
                    {sponsor && <SponsorGraphic key={`${sponsor.source}:${sponsor.sponsorId}`} sponsor={sponsor} fontClass={fontClass} />}
                    {cta && <CtaGraphic key={`${cta.title}|${cta.url}`} title={cta.title} url={cta.url} fontClass={fontClass} />}
                  </div>
                )}
              </div>
            )}
            {ticker && <TickerGraphic key={ticker.text} text={ticker.text} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A chat line or gift the host put on screen: who, and what they said or
 * sent — a gift in gold, since it's money. It slides in, and slides out by
 * itself at its deadline, or at once when the host takes it down.
 */
function FeaturedCard({ item, leaving, onGone }: { item: FeaturedItem; leaving: boolean; onGone: () => void }) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">(() => {
    // Deadlines are on the server's clock (lib/server-clock.ts).
    const deadline = featuredDeadline(item, serverNow());
    return deadline !== null && deadline <= serverNow() ? "gone" : "in";
  });

  // On the times, not the object: a scene update rebuilds the object, and
  // the deadline is taken once, when the showing is first seen.
  const { at, until } = item;
  useEffect(() => {
    const deadline = featuredDeadline({ at, until }, serverNow());
    if (deadline === null) return;
    const left = deadline - serverNow();
    const out = setTimeout(() => setPhase((p) => (p === "gone" ? p : "out")), Math.max(0, left - EXIT_MS));
    const gone = setTimeout(() => setPhase("gone"), Math.max(0, left));
    return () => {
      clearTimeout(out);
      clearTimeout(gone);
    };
  }, [at, until]);

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(onGone, EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving, onGone]);

  if (phase === "gone") return null;
  const request = item.kind === "request";
  const gift = item.kind === "gift" || request;
  const def = gift ? giftByEmoji(item.emoji) : null;
  // A Shout's card is its words; a request's, what was asked for.
  const said = request || def?.id === "shout";
  const amount = gift && item.amount ? centsToDollars(Math.round(parseFloat(item.amount) * 100)) : null;

  return (
    <div
      className={cn(
        "flex max-w-[min(100%,30rem)] min-w-0 items-stretch overflow-hidden rounded-[clamp(8px,1cqw,14px)] bg-black/80 text-[clamp(13px,1.8cqw,22px)]",
        leaving || phase === "out"
          ? "motion-safe:animate-[graphic-out-left_320ms_ease-in_both] motion-reduce:opacity-0"
          : "motion-safe:animate-[graphic-in-left_460ms_var(--ease-spring)_both]"
      )}
    >
      <span aria-hidden className="w-[clamp(3px,0.45cqw,6px)] shrink-0 bg-[var(--g-fill)]" />
      <div className="flex min-w-0 items-center gap-[0.65em] py-[0.6em] pr-[1em] pl-[0.65em]">
        <span className="size-[2.1em] shrink-0">
          {gift ? (
            <GiftArt emoji={item.emoji ?? "🎁"} size={48} className="size-full!" />
          ) : (
            <UserAvatar src={item.avatar} name={item.username} size={48} className="size-full!" />
          )}
        </span>
        <p className="min-w-0">
          <span className="block truncate text-[0.7em] font-semibold text-white/65">
            {request ? `Request from ${item.username}` : item.username}
          </span>
          {said ? (
            <>
              <span className="mt-[0.1em] line-clamp-3 leading-snug font-semibold break-words text-white">
                {item.text}
                {amount && <span className="ml-[0.4em] font-money text-value tabular-nums">{amount}</span>}
              </span>
              {item.note && <span className="mt-[0.2em] line-clamp-2 block text-[0.8em] leading-snug break-words text-white/80">{item.note}</span>}
            </>
          ) : gift ? (
            <span className="mt-[0.1em] block leading-snug font-semibold text-white">
              {def?.verb ?? item.text}
              {amount && <span className="ml-[0.4em] font-money text-value tabular-nums">{amount}</span>}
            </span>
          ) : (
            <span className="mt-[0.1em] line-clamp-3 leading-snug font-medium break-words text-white">{item.text}</span>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * The name on screen. "Bar": a flat block in the accent with the title in
 * its ink, the subtitle on a dark strip beneath. "Pill": the title in an
 * accent capsule inside a dark one, the subtitle beside it.
 */
function LowerThird({
  title,
  subtitle,
  style,
  fontClass,
}: {
  title: string;
  subtitle: string;
  style: Brand["lowerThird"];
  fontClass: string;
}) {
  const enter = "min-w-0 motion-safe:animate-[graphic-in-left_460ms_var(--ease-spring)_both]";
  if (style === "pill") {
    return (
      <div className={cn(enter, "flex max-w-[min(100%,38rem)] items-center gap-[0.6em] rounded-full bg-black/75 p-[0.3em] pr-[1em] text-[clamp(13px,1.8cqw,22px)]")}>
        {/* The name keeps its width; the subtitle is what gives way. */}
        <span className={cn("max-w-full shrink-0 truncate rounded-full bg-[var(--g-fill)] px-[0.8em] py-[0.3em] leading-tight font-bold tracking-[-0.01em] text-[var(--g-ink)]", fontClass)}>
          {title}
        </span>
        {subtitle && <span className="min-w-0 truncate text-[0.85em] font-medium text-white/85">{subtitle}</span>}
      </div>
    );
  }
  return (
    <div className={cn(enter, "flex max-w-[min(62%,34rem)] flex-col items-start")}>
      <span
        className={cn(
          "max-w-full truncate rounded-t-[clamp(3px,0.4cqw,6px)] rounded-br-[clamp(3px,0.4cqw,6px)] bg-[var(--g-fill)] px-[0.7em] py-[0.3em] text-[clamp(14px,2.3cqw,30px)] leading-tight font-bold tracking-[-0.015em] text-[var(--g-ink)]",
          fontClass
        )}
      >
        {title}
      </span>
      {subtitle && (
        <span className="max-w-full truncate rounded-b-[clamp(3px,0.4cqw,6px)] bg-black/80 px-[0.85em] py-[0.35em] text-[clamp(11px,1.5cqw,19px)] leading-tight font-medium text-white/90">
          {subtitle}
        </span>
      )}
    </div>
  );
}

/**
 * A call to action: a QR code on a white tile — drawn as one SVG path, so
 * it stays sharp and scannable whatever the video's quality — the host's
 * line, and the link as people read it. On a viewer's own screen it's also
 * a link they can tap.
 */
function CtaGraphic({ title, url, fontClass }: { title: string; url: string; fontClass: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      // The tap is the link's, not the player's underneath.
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-auto flex max-w-[min(20em,100%)] items-stretch overflow-hidden rounded-[clamp(8px,1cqw,14px)] bg-black/80 text-[clamp(12px,1.55cqw,19px)] motion-safe:animate-[graphic-in-left_460ms_var(--ease-spring)_both]"
    >
      <span aria-hidden className="w-[clamp(3px,0.45cqw,6px)] shrink-0 bg-[var(--g-fill)]" />
      <span className="flex min-w-0 items-center gap-[0.7em] p-[0.5em] pr-[0.9em]">
        <QrCode value={url} label={`QR code for ${shortUrl(url)}`} className="size-[4.8em] shrink-0 rounded-[0.35em]" />
        <span className="min-w-0">
          <span className={cn("block leading-tight font-bold text-white", fontClass)}>{title}</span>
          <span className="mt-[0.35em] block truncate font-mono text-[0.72em] text-white/65">{shortUrl(url)}</span>
        </span>
      </span>
    </a>
  );
}

/**
 * A sponsor's card: "Paid promotion" on it, always — the label isn't the
 * creator's to turn off — then the brand's mark, name and line, and a
 * promo code in the creator's accent. On a viewer's own screen it's a link
 * to the brand (marked sponsored, so it passes nothing on to them).
 */
function SponsorGraphic({ sponsor, fontClass }: { sponsor: Extract<SceneLayer, { kind: "sponsor" }>; fontClass: string }) {
  const body = (
    <>
      <span aria-hidden className="w-[clamp(3px,0.45cqw,6px)] shrink-0 bg-[var(--g-fill)]" />
      <span className="flex min-w-0 flex-col gap-[0.45em] py-[0.55em] pr-[0.9em] pl-[0.6em]">
        <span className="flex items-center gap-[0.4em] text-[max(10px,0.6em)] leading-none font-bold tracking-[0.1em] text-white/70 uppercase">
          <span aria-hidden className="size-[0.5em] min-h-[5px] min-w-[5px] rounded-full bg-white/70" />
          Paid promotion
        </span>
        <span className="flex min-w-0 items-center gap-[0.6em]">
          {sponsor.logoUrl ? (
            <span className="flex size-[2.3em] shrink-0 items-center justify-center overflow-hidden rounded-[0.45em] bg-white p-[0.2em]">
              {/* eslint-disable-next-line @next/next/no-img-element -- the sponsor's logo, served versioned by the API */}
              <img src={apiUrl(sponsor.logoUrl)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
            </span>
          ) : (
            <span aria-hidden className={cn("flex size-[2.3em] shrink-0 items-center justify-center rounded-[0.45em] bg-[var(--g-fill)] text-[1.05em] font-bold text-[var(--g-ink)]", fontClass)}>
              {sponsor.name.trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className={cn("block truncate leading-tight font-bold text-white", fontClass)}>{sponsor.name}</span>
            {sponsor.line && <span className="mt-[0.15em] line-clamp-2 block text-[0.8em] leading-snug text-white/75">{sponsor.line}</span>}
          </span>
        </span>
        {sponsor.code && (
          <span className="self-start rounded-[0.35em] bg-[var(--g-fill)] px-[0.55em] py-[0.2em] font-mono text-[0.76em] font-bold tracking-[0.02em] text-[var(--g-ink)]">
            Code {sponsor.code}
          </span>
        )}
      </span>
    </>
  );
  const cls =
    "pointer-events-auto flex max-w-[min(18em,100%)] items-stretch overflow-hidden rounded-[clamp(8px,1cqw,14px)] bg-black/80 text-[clamp(12px,1.5cqw,18px)] motion-safe:animate-[graphic-in-left_460ms_var(--ease-spring)_both]";
  return sponsor.url ? (
    <a
      href={sponsor.url}
      target="_blank"
      rel="sponsored noopener noreferrer"
      aria-label={`${sponsor.name} — paid promotion`}
      // The tap is the link's, not the player's underneath.
      onClick={(e) => e.stopPropagation()}
      className={cls}
    >
      {body}
    </a>
  ) : (
    <div role="note" aria-label={`${sponsor.name} — paid promotion`} className={cn(cls, "pointer-events-none")}>
      {body}
    </div>
  );
}

/**
 * Live prices (market layer): a pill per market — the coin, its last price
 * and its move over 24 hours, green up and chili down — drawn by each
 * viewer's screen from our shared feed, and always followed by whose
 * numbers they are and that they're only that. No links, no buy buttons.
 * Until the first prices land there's nothing to show, so nothing shows;
 * after a failed fetch the last good ones stay up, marked paused.
 */
function PricesStrip({ symbols }: { symbols: string[] }) {
  const { quotes, source, failed } = useQuotes(symbols);
  if (quotes.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="Live prices"
      className="flex max-w-full flex-wrap items-center justify-center gap-[0.35em] text-[clamp(11px,1.45cqw,18px)] leading-none motion-safe:animate-[graphic-in-down_420ms_var(--ease-spring)_both]"
    >
      {quotes.map((q) => {
        const up = q.changePct >= 0;
        return (
          <span key={q.symbol} className="flex items-baseline gap-[0.45em] rounded-full bg-black/75 px-[0.8em] py-[0.42em] whitespace-nowrap text-white">
            <span className="font-bold tracking-[-0.01em]">{marketBase(q.symbol)}</span>
            <span className="font-money text-[1.08em] tabular-nums">{formatQuote(q.symbol, q.last)}</span>
            <span className={cn("font-mono text-[0.78em] font-bold tabular-nums", up ? "text-success" : "text-chili-hi")}>
              <span aria-hidden>{up ? "▲" : "▼"}</span>
              <span className="sr-only">{up ? "up" : "down"}</span> {Math.abs(q.changePct).toFixed(1)}%
            </span>
          </span>
        );
      })}
      <span className="rounded-full bg-black/60 px-[0.7em] py-[0.42em] font-mono text-[0.72em] whitespace-nowrap text-white/65">
        {source} · {failed && "Paused · "}Not financial advice
      </span>
    </div>
  );
}

/**
 * A crawl along the bottom. The track holds the text twice (repeated until
 * each half is long enough to fill a wide frame), so the loop is seamless at
 * -50%; the speed follows the length. With reduced motion it holds still.
 */
function TickerGraphic({ text }: { text: string }) {
  const unit = text.length + 4;
  const reps = Math.max(1, Math.ceil(120 / unit));
  const seconds = Math.max(12, Math.round(reps * unit * 0.2));
  const half = (copy: number) => (
    <span key={copy} className="flex shrink-0 items-center">
      {Array.from({ length: reps }, (_, i) => (
        <span key={i} className="flex items-center whitespace-nowrap">
          <span className="px-[1.1em]">{text}</span>
          <span className="size-[0.42em] shrink-0 rounded-full bg-[var(--g-fill)]" />
        </span>
      ))}
    </span>
  );
  return (
    <div className="flex w-full items-stretch overflow-hidden bg-black/80 text-[clamp(12px,1.7cqw,21px)] leading-none font-medium text-white motion-safe:animate-[fade-in_300ms_ease-out_both]">
      <span aria-hidden className="w-[clamp(4px,0.55cqw,7px)] shrink-0 bg-[var(--g-fill)]" />
      <div className="min-w-0 flex-1 overflow-hidden py-[0.6em]">
        <span className="sr-only">{text}</span>
        <div
          aria-hidden
          className="flex w-max motion-safe:animate-[marquee_40s_linear_infinite]"
          style={{ animationDuration: `${seconds}s` }}
        >
          {half(0)}
          {half(1)}
        </div>
      </div>
    </div>
  );
}

/**
 * The goal bar: what the host is going for, how far it's got and the next
 * stop on the way, in their accent. Reaching it is a gift moment, so the
 * bar goes heat and says so — and keeps counting past the line.
 */
function GoalBar({ goal, fontClass }: { goal: StreamGoal; fontClass: string }) {
  const reached = Boolean(goal.reachedAt);
  const share = Math.min(1, goal.progress / goal.target);
  const next = reached ? null : nextMilestone(goal);
  const unit = goalUnit(goal.kind, goal.target);
  return (
    <div
      className={cn(
        "w-[min(100%,28em)] rounded-[clamp(6px,0.8cqw,12px)] bg-black/75 px-[0.85em] pt-[0.55em] pb-[0.65em] text-[clamp(12px,1.6cqw,19px)] text-white",
        reached
          ? "motion-safe:animate-[pop-in_520ms_var(--ease-spring)_both]"
          : "motion-safe:animate-[graphic-in-down_420ms_var(--ease-spring)_both]"
      )}
    >
      <div className="flex items-baseline justify-between gap-[0.8em]">
        <p className="min-w-0 truncate">
          <span className={cn("mr-[0.5em] font-mono text-[0.7em] font-bold tracking-[0.1em] uppercase", reached ? "text-ember-hi" : "text-white/55")}>
            {reached ? "Goal reached" : "Goal"}
          </span>
          <span className={cn("font-bold", fontClass)}>{goal.title}</span>
        </p>
        <p className="shrink-0 font-mono text-[0.88em] font-bold tabular-nums">
          {goalAmount(goal.kind, goal.progress)}
          <span className="font-medium text-white/50">
            {" "}/ {goalAmount(goal.kind, goal.target)}
            {unit && ` ${unit}`}
          </span>
        </p>
      </div>
      <div className="relative mt-[0.5em] h-[0.45em] rounded-full bg-white/15">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 [transition-timing-function:var(--ease-spring)]",
            reached ? "bg-heat" : "bg-[var(--g-fill)]"
          )}
          style={{ width: `${Math.max(share * 100, 2.5)}%` }}
        />
        {/* The stops on the way: white once passed. */}
        {goal.milestones.map((m) => (
          <span
            key={m.at}
            aria-hidden
            className={cn(
              "absolute top-1/2 h-[1.35em] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full",
              m.at <= goal.progress ? "bg-white" : "bg-white/40"
            )}
            style={{ left: `${(m.at / goal.target) * 100}%` }}
          />
        ))}
      </div>
      {next && (
        <p className="mt-[0.45em] truncate text-[0.78em] text-white/70">
          Next at <span className="font-mono font-bold text-white tabular-nums">{goalAmount(goal.kind, next.at)}</span> · {next.label}
        </p>
      )}
    </div>
  );
}

/**
 * The heat meter: five steps from Warm to Inferno as the minute's gifts add
 * up, cooling a step every 20 s after the last one (on the server's clock,
 * so every screen agrees). A gift moment — the only place it wears heat.
 */
function HeatMeter({ heat }: { heat: StreamHeat }) {
  const now = useNow() + serverOffset();
  const level = heatNow(heat, now);
  if (level === 0) return null;
  return (
    <div
      role="img"
      aria-label={`Heat: ${HEAT_NAMES[level]}`}
      className="flex items-center gap-[0.5em] rounded-full bg-black/75 py-[0.4em] pr-[0.85em] pl-[0.6em] text-[clamp(11px,1.35cqw,17px)] font-bold text-white motion-safe:animate-[graphic-in-down_420ms_var(--ease-spring)_both]"
    >
      <Fire weight="fill" className="size-[1.1em] shrink-0 text-ember-hi" />
      <span className="flex items-center gap-[0.18em]">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={cn("h-[0.85em] w-[0.42em] rounded-[2px] transition-colors duration-500", step <= level ? "bg-heat" : "bg-white/15")}
          />
        ))}
      </span>
      <span className="whitespace-nowrap">{HEAT_NAMES[level]}</span>
    </div>
  );
}

/**
 * Time left to a moment the host named ("Match starts 4:59"). At zero it
 * says so for a minute, then steps off the screen by itself.
 */
function CountdownGraphic({ label, endsAt }: { label: string; endsAt: string }) {
  // On the server's clock: every viewer counts down together.
  const now = useNow() + serverOffset();
  const left = Date.parse(endsAt) - now;
  if (left < -60_000) return null;
  return (
    <div className="flex items-stretch overflow-hidden rounded-[clamp(4px,0.6cqw,8px)] text-[clamp(12px,1.8cqw,24px)] motion-safe:animate-[graphic-in-down_420ms_var(--ease-spring)_both]">
      {label && (
        <span className="flex max-w-[24ch] items-center truncate bg-black/80 px-[0.8em] text-[0.8em] font-semibold text-white/85">
          {label}
        </span>
      )}
      <span className="flex min-w-[3.6em] items-center justify-center bg-[var(--g-fill)] px-[0.6em] py-[0.35em] font-mono font-bold tabular-nums text-[var(--g-ink)]">
        {left > 0 ? formatCountdown(left) : "Now"}
      </span>
    </div>
  );
}

/**
 * A full-frame card: the host's face, whose stream it is, the card's title
 * and a line — the host's own when they wrote one. Flat on the warm ground;
 * the bars keep moving so the frame never reads as frozen, and a countdown,
 * when the host runs one, takes their place in the brand accent.
 */
function SceneCardView({
  card,
  note,
  leaving = false,
  host,
  countdown,
  accent,
  fontClass = "font-wide",
}: {
  card: SceneCard;
  note: string;
  /** Taken down: it fades off the picture rather than cutting. */
  leaving?: boolean;
  host: { name: string; avatar?: string | null };
  countdown?: { label: string; endsAt: string };
  accent: string;
  fontClass?: string;
}) {
  const def = CARDS.find((c) => c.id === card) ?? CARDS[0];
  const bars =
    card !== "ending" ? (
      <span aria-hidden className="mt-6 flex h-5 items-end gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="w-1 origin-bottom rounded-full bg-ember motion-safe:animate-[scene-bars_1.1s_ease-in-out_infinite]"
            style={{ height: "100%", animationDelay: `${i * 140}ms` }}
          />
        ))}
      </span>
    ) : null;
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-[#0b0708] px-6 text-center",
        leaving
          ? "pointer-events-none motion-safe:animate-[fade-out_320ms_ease-in_both] motion-reduce:hidden"
          : "motion-safe:animate-[fade-in_280ms_ease-out_both]"
      )}
    >
      <div className="flex max-w-full flex-col items-center">
        <UserAvatar
          src={host.avatar}
          name={host.name}
          size={72}
          ring={card === "ending" ? "seen" : "live"}
          ringGapClassName="bg-[#0b0708]"
        />
        <p className="caps mt-4 max-w-full truncate font-mono text-[10.5px] text-white/50 @lg:mt-5 @lg:text-[12px]">{host.name}</p>
        <p className={cn("mt-2 text-[26px] leading-none font-bold tracking-[-0.03em] text-balance text-white @lg:text-[46px]", fontClass)}>{def.title}</p>
        <p className="mt-3 max-w-[36ch] text-[13px] leading-relaxed text-white/60 @lg:text-[16px]">{note || def.body}</p>
        {countdown ? (
          <CardCountdown key={countdown.endsAt} label={countdown.label} endsAt={countdown.endsAt} color={accent} fallback={bars} />
        ) : (
          bars
        )}
      </div>
    </div>
  );
}

/** The card's countdown: the label small, the time big; once it runs out, the bars again. */
function CardCountdown({ label, endsAt, color, fallback }: { label: string; endsAt: string; color: string; fallback: ReactNode }) {
  const now = useNow() + serverOffset();
  const left = Date.parse(endsAt) - now;
  if (left <= 0) return fallback;
  return (
    <div className="mt-4 flex flex-col items-center @lg:mt-6">
      {label && <p className="caps max-w-full truncate font-mono text-[10.5px] text-white/50 @lg:text-[12px]">{label}</p>}
      <p className="mt-1 font-mono text-[30px] leading-none font-bold tabular-nums @lg:text-[44px]" style={{ color }}>
        {formatCountdown(left)}
      </p>
    </div>
  );
}
