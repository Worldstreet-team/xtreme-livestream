"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { stageLayout } from "@/lib/stage-layout";
import { useNow } from "@/lib/use-now";
import { UserAvatar } from "@/components/ui/user-avatar";
import {
  ACCENTS,
  CARDS,
  DEFAULT_BRAND,
  formatCountdown,
  guestsShown,
  layerOf,
  type Brand,
  type LogoCorner,
  type Scene,
  type SceneCard,
  type SceneLayer,
} from "@/lib/scene";

export interface SceneCell {
  key: string;
  node: ReactNode;
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
}) {
  const layout = forceAuto ? "auto" : scene.layout;
  const shown = guests.slice(0, guestsShown(layout, guests.length, forceAuto));
  const grid = stageLayout(1 + shown.length, portrait);
  const showPip = Boolean(pip) && shown.length === 0 && layout !== "solo";

  return (
    // Isolated: the program — picture, card, graphics — is one layer, and
    // whatever the surface draws after it (its controls, its status
    // screens, gifts) sits on top.
    <div className="@container relative isolate size-full">
      <div className={cn("grid size-full gap-px", grid.container)}>
        <div className={cn("relative overflow-hidden", grid.hostCell)}>
          {main}
          {mainLabel && shown.length > 0 && (
            <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-full bg-black/55 px-2.5 py-1">
              <span className="block truncate text-xs font-semibold text-white">{mainLabel}</span>
            </div>
          )}
          {showPip && (
            <div
              className={cn(
                "absolute z-10 aspect-video overflow-hidden rounded-[12px] bg-black",
                layout === "screen-face" ? "w-[30%]" : "w-[24%]",
                pipClassName ?? "top-3 right-3"
              )}
            >
              {pip}
            </div>
          )}
        </div>
        {shown.map((g) => (
          <div key={g.key} className="relative overflow-hidden">
            {g.node}
          </div>
        ))}
      </div>
      {scene.card && (
        <SceneCardView
          card={scene.card}
          note={scene.cardNote}
          host={host}
          countdown={layerOf(scene.layers, "countdown")}
          accent={ACCENTS[brand.accent].fill}
        />
      )}
      {scene.layers.length > 0 && (
        <SceneGraphics
          layers={scene.layers}
          brand={brand}
          carded={Boolean(scene.card)}
          battle={forceAuto}
          pipShown={showPip}
          insets={insets}
        />
      )}
    </div>
  );
}

/**
 * The host's graphics, each in its place: the banner and countdown at the
 * top, the lower third and ticker at the bottom, the logo in its corner.
 *
 * A card takes the lower third and the banner down with the picture
 * they're about, and draws the countdown itself, big, as its centrepiece;
 * the ticker and logo stay over it. A battle owns the top of the frame, so
 * what's up there stands aside until it ends; and the corner camera keeps
 * the top right, moving a logo set there across to the left.
 */
function SceneGraphics({
  layers,
  brand,
  carded,
  battle,
  pipShown,
  insets,
}: {
  layers: SceneLayer[];
  brand: Brand;
  carded: boolean;
  battle: boolean;
  pipShown: boolean;
  insets?: { top?: string; bottom?: string };
}) {
  const accent = ACCENTS[brand.accent];
  const lowerThird = carded ? undefined : layerOf(layers, "lower-third");
  const banner = carded || battle ? undefined : layerOf(layers, "banner");
  const countdown = carded || battle ? undefined : layerOf(layers, "countdown");
  const ticker = layerOf(layers, "ticker");
  const logo = brand.logoUrl ? layerOf(layers, "logo") : undefined;
  let corner: LogoCorner | null = logo?.corner ?? null;
  if (corner === "top-right" && pipShown) corner = "top-left";
  if (corner?.startsWith("top") && battle) corner = null;
  const topLogo = corner?.startsWith("top") ? corner : null;
  const bottomLogo = corner && !corner.startsWith("top") ? corner : null;
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

        {(banner || countdown) && (
          <div
            className={cn(
              "absolute top-[var(--g-m)] flex flex-col items-center gap-[calc(var(--g-m)/2)]",
              // A logo up top keeps its column: the banner narrows rather than run into it.
              topLogo ? "inset-x-[calc(20cqw+var(--g-m)*2)]" : "inset-x-[var(--g-m)]"
            )}
          >
            {banner && (
              <p
                key={banner.text}
                className="max-w-[min(100%,36rem)] rounded-[clamp(4px,0.6cqw,8px)] bg-[var(--g-fill)] px-[0.9em] py-[0.45em] text-center font-wide text-[clamp(12px,1.8cqw,24px)] leading-tight font-bold tracking-[-0.01em] text-balance text-[var(--g-ink)] motion-safe:animate-[graphic-in-down_420ms_var(--ease-spring)_both]"
              >
                {banner.text}
              </p>
            )}
            {countdown && <CountdownGraphic key={countdown.endsAt} label={countdown.label} endsAt={countdown.endsAt} />}
          </div>
        )}

        {(lowerThird || ticker || bottomLogo) && (
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[calc(var(--g-m)/2)]">
            {/* The lower third's row: a bottom logo stacks above it on the
                left, or shares its baseline on the right. */}
            {(lowerThird || bottomLogo) && (
              <div
                className={cn(
                  "flex gap-[calc(var(--g-m)/2)] px-[var(--g-m)]",
                  bottomLogo === "bottom-left" ? "flex-col items-start" : "items-end",
                  !ticker && "pb-[var(--g-m)]"
                )}
              >
                {bottomLogo === "bottom-left" && logoImg()}
                {lowerThird && (
                  <LowerThird
                    key={`${lowerThird.title}|${lowerThird.subtitle}`}
                    title={lowerThird.title}
                    subtitle={lowerThird.subtitle}
                    style={brand.lowerThird}
                  />
                )}
                {bottomLogo === "bottom-right" && logoImg("ml-auto")}
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
 * The name on screen. "Bar": a flat block in the accent with the title in
 * its ink, the subtitle on a dark strip beneath. "Pill": the title in an
 * accent capsule inside a dark one, the subtitle beside it.
 */
function LowerThird({ title, subtitle, style }: { title: string; subtitle: string; style: Brand["lowerThird"] }) {
  const enter = "min-w-0 motion-safe:animate-[graphic-in-left_460ms_var(--ease-spring)_both]";
  if (style === "pill") {
    return (
      <div className={cn(enter, "flex max-w-[min(100%,38rem)] items-center gap-[0.6em] rounded-full bg-black/75 p-[0.3em] pr-[1em] text-[clamp(13px,1.8cqw,22px)]")}>
        {/* The name keeps its width; the subtitle is what gives way. */}
        <span className="max-w-full shrink-0 truncate rounded-full bg-[var(--g-fill)] px-[0.8em] py-[0.3em] font-wide leading-tight font-bold tracking-[-0.01em] text-[var(--g-ink)]">
          {title}
        </span>
        {subtitle && <span className="min-w-0 truncate text-[0.85em] font-medium text-white/85">{subtitle}</span>}
      </div>
    );
  }
  return (
    <div className={cn(enter, "flex max-w-[min(62%,34rem)] flex-col items-start")}>
      <span className="max-w-full truncate rounded-t-[clamp(3px,0.4cqw,6px)] rounded-br-[clamp(3px,0.4cqw,6px)] bg-[var(--g-fill)] px-[0.7em] py-[0.3em] font-wide text-[clamp(14px,2.3cqw,30px)] leading-tight font-bold tracking-[-0.015em] text-[var(--g-ink)]">
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
 * Time left to a moment the host named ("Match starts 4:59"). At zero it
 * says so for a minute, then steps off the screen by itself.
 */
function CountdownGraphic({ label, endsAt }: { label: string; endsAt: string }) {
  const now = useNow();
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
  host,
  countdown,
  accent,
}: {
  card: SceneCard;
  note: string;
  host: { name: string; avatar?: string | null };
  countdown?: { label: string; endsAt: string };
  accent: string;
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
    <div className="absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-[#0b0708] px-6 text-center">
      <div className="flex max-w-full flex-col items-center">
        <UserAvatar
          src={host.avatar}
          name={host.name}
          size={72}
          ring={card === "ending" ? "seen" : "live"}
          ringGapClassName="bg-[#0b0708]"
        />
        <p className="caps mt-4 max-w-full truncate font-mono text-[10.5px] text-white/50 @lg:mt-5 @lg:text-[12px]">{host.name}</p>
        <p className="mt-2 font-wide text-[26px] leading-none font-bold tracking-[-0.03em] text-balance text-white @lg:text-[46px]">{def.title}</p>
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
  const now = useNow();
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
