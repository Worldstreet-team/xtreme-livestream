"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, SealCheck, CaretLeft, CaretRight, TrendUp, Sparkle, Heart, Fire, ArrowRight } from "@phosphor-icons/react";
import { formatNumber } from "@/lib/categories";
import { LEAD_LABEL, type HomeLead, type HomeRow, type LeadReason, type RowItem } from "@/lib/discovery";
import { HERO_PROMOS, type HeroPromo } from "@/lib/ecosystem";
import { BrandMark } from "@/components/ui/brand-mark";
import { WolfIcon } from "@/components/ui/wolf-icon";
import { logImpression } from "@/lib/impressions";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { StreamArt } from "@/components/app/stream-art";
import { LivePreview } from "@/components/app/live-preview";

/**
 * The hero: a carousel of what's live, then what else WorldStreet does.
 *
 * Five cards across — the centre one big and playing a muted preview, two
 * smaller on each side, the outer pair slipping under the edge. No meta
 * panel, no follow button, no reasons in prose: the picture is the pitch.
 * Click a side card and it slides to the centre; arrows and the keyboard do
 * the same; it also advances on its own every few seconds until you touch
 * it. The leads the rows engine picked go first (their reason survives as
 * a small chip), then the biggest live rooms fill the ring.
 *
 * The last four slots always belong to the sibling products the rail lists
 * under Products — each with a line worth reading, one of them carrying a
 * clip. That is what keeps the stage from being empty at four in the
 * morning: the hero is never a blank frame, it is the rest of the platform.
 */

const ICON: Record<LeadReason, typeof Heart> = {
  followed: Heart,
  trending: TrendUp,
  rising: Sparkle,
  popular: Fire,
};

const RING = 9;
const AUTO_MS = 8000;

/**
 * Where each offset from the centre sits, as a deck: x is the card's centre
 * as a fraction of the container width from the middle, s its scale, and
 * `shade` how much it is darkened for sitting further back. The centre card
 * is 40% wide; each neighbour tucks about a tenth of the width under the
 * card in front of it, and all five stay inside the frame — nothing is
 * clipped by the container edge. Beyond ±2 the card is parked out of sight.
 */
const SLOT: Record<number, { x: number; s: number; shade: number }> = {
  [-2]: { x: -0.38, s: 0.55, shade: 0.45 },
  [-1]: { x: -0.24, s: 0.75, shade: 0.22 },
  [0]: { x: 0, s: 1, shade: 0 },
  [1]: { x: 0.24, s: 0.75, shade: 0.22 },
  [2]: { x: 0.38, s: 0.55, shade: 0.45 },
};
const SLOT_COMPACT: Record<number, { x: number; s: number; shade: number }> = {
  [-1]: { x: -0.36, s: 0.82, shade: 0.3 },
  [0]: { x: 0, s: 1, shade: 0 },
  [1]: { x: 0.36, s: 0.82, shade: 0.3 },
};

function useMinWidth(px: number) {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width:${px}px)`);
    const update = () => setOk(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return ok;
}

/** A card in the deck: a live room, or one of the house promos. */
type Slide =
  | { kind: "stream"; key: string; item: RowItem }
  | { kind: "promo"; key: string; promo: HeroPromo };

export function Leads({ leads, rows = [] }: { leads: HomeLead[]; rows?: HomeRow[] }) {
  const wide = useMinWidth(768);

  // Leads first, then every other live room on the page, deduped — capped
  // so the promos always keep their seats at the end of the ring.
  const { items, reason } = useMemo(() => {
    const seen = new Set<string>();
    const live: RowItem[] = [];
    const why = new Map<string, LeadReason>();
    const push = (it: RowItem) => {
      if (!it.isLive || seen.has(it._id)) return;
      seen.add(it._id);
      live.push(it);
    };
    leads.forEach((l) => {
      why.set(l.item._id, l.reason);
      push(l.item);
    });
    rows.filter((r) => r.kind === "streams").forEach((r) => r.items.forEach(push));

    const slides: Slide[] = [
      ...live.slice(0, RING - HERO_PROMOS.length).map((item) => ({ kind: "stream" as const, key: item._id, item })),
      ...HERO_PROMOS.map((promo) => ({ kind: "promo" as const, key: `promo-${promo.id}`, promo })),
    ];
    return { items: slides, reason: why };
  }, [leads, rows]);

  const n = items.length;
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (n === 0) return;
      setActive((a) => (a + dir + n) % n);
    },
    [n]
  );
  const pick = (i: number) => {
    setTouched(true);
    setActive(i);
  };

  // Auto-advance until the viewer takes the wheel, and never while hovered
  // or while the tab is in the background.
  useEffect(() => {
    if (touched || hover || n < 2) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") go(1);
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [touched, hover, n, go]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { setTouched(true); go(1); }
      if (e.key === "ArrowLeft") { setTouched(true); go(-1); }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [go]);

  useEffect(() => {
    const current = items[active];
    if (current?.kind !== "stream") return;
    const { item } = current;
    logImpression({ streamId: item._id, surface: "home", row: "hero", slot: active, explore: reason.get(item._id) === "rising" });
  }, [active, items, reason]);

  if (n === 0) return null;
  const idx = Math.min(active, n - 1);
  const half = Math.floor(n / 2);
  const slots = wide ? SLOT : SLOT_COMPACT;
  const reach = wide ? 2 : 1;

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label="Live now and across WorldStreet"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group/hero relative mb-10 outline-none"
    >
      {/* Stage height follows the centre card: 40% wide at 16:9 on desktop, 72% on phones. */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: wide ? "400 / 90" : "400 / 162" }}
      >
        {items.map((s, i) => {
          // Signed distance from the centre, wrapping around the ring.
          let off = ((i - idx) % n + n) % n;
          if (off > half) off -= n;
          const slot = slots[off];
          const shown = Math.abs(off) <= reach && !!slot;
          const style = shown
            ? { left: `${50 + slot.x * 100}%`, transform: `translate(-50%, -50%) scale(${slot.s})`, opacity: 1, zIndex: 10 - Math.abs(off) }
            : { left: `${50 + Math.sign(off || 1) * 60}%`, transform: "translate(-50%, -50%) scale(0.4)", opacity: 0, zIndex: 0 };
          const centre = off === 0;
          const far = Math.abs(off) === 2;
          return (
            <div
              key={s.key}
              className={cn("absolute top-1/2 aspect-video transition-[left,transform,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)]", wide ? "w-[40%]" : "w-[72%]", !shown && "pointer-events-none")}
              style={style}
              aria-hidden={!shown}
            >
              {s.kind === "promo" ? (
                <PromoCard promo={s.promo} centre={centre} far={far} shade={slot?.shade ?? 0.45} onPick={() => pick(i)} />
              ) : centre ? (
                <CentreCard item={s.item} reason={reason.get(s.item._id)} />
              ) : (
                <SideCard item={s.item} onPick={() => pick(i)} far={far} shade={slot?.shade ?? 0.45} />
              )}
            </div>
          );
        })}

        {n > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous stream"
              onClick={() => { setTouched(true); go(-1); }}
              className="absolute top-1/2 left-3 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 md:left-6"
            >
              <CaretLeft size={20} weight="bold" />
            </button>
            <button
              type="button"
              aria-label="Next stream"
              onClick={() => { setTouched(true); go(1); }}
              className="absolute top-1/2 right-3 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 md:right-6"
            >
              <CaretRight size={20} weight="bold" />
            </button>
          </>
        )}
      </div>

      {n > 1 && (
        <div className="mt-4 flex items-center justify-center gap-1.5" role="tablist" aria-label="Featured">
          {items.map((s, i) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={i === idx}
              aria-label={s.kind === "promo" ? s.promo.eyebrow : s.item.title}
              onClick={() => pick(i)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === idx ? "w-7 bg-foreground" : s.kind === "promo" ? "w-1.5 bg-white/15 hover:bg-white/40" : "w-1.5 bg-white/25 hover:bg-white/50"
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CentreCard({ item, reason }: { item: RowItem; reason?: LeadReason }) {
  const name = item.streamerId.displayName || item.streamerId.username;
  const Icon = reason ? ICON[reason] : null;
  const poster = <StreamArt src={item.thumbnailUrl} category={item.category} alt={item.title} seed={item._id + item.title} size={{ w: 1280, h: 720 }} />;
  return (
    <Link href={`/stream/${item._id}`} className="group/card relative block size-full overflow-hidden rounded-sm bg-white/[0.03] shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]">
      <LivePreview streamId={item._id} poster={poster} fallbackSrc={item.previewUrl ?? null} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />

      <div className="absolute top-4 left-4 flex items-center gap-2">
        <LiveBadge size="md" />
        {Icon && reason && (
          <Badge variant="glass" size="md" icon={<Icon size={12} weight="fill" />} className="uppercase">
            {LEAD_LABEL[reason]}
          </Badge>
        )}
      </div>
      <Badge variant="glass" size="md" icon={<Eye size={13} weight="bold" />} className="absolute top-4 right-4">
        {formatNumber(item.viewers)}
      </Badge>

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-5">
        <UserAvatar src={item.streamerId.avatar} name={name} size={44} className="size-11 shrink-0 ring-2 ring-red-600" />
        <div className="min-w-0 flex-1 text-white">
          <h2 className="line-clamp-2 text-lg font-semibold leading-snug md:text-xl">{item.title}</h2>
          <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-white/80">
            <span className="truncate font-medium">{name}</span>
            {item.streamerId.verified && <SealCheck size={13} weight="fill" className="shrink-0 text-sky-400" />}
            <span className="text-white/50">·</span>
            <span className="truncate">{item.category}</span>
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * A house promo, in whichever seat of the deck it sits.
 *
 * One component for every position, on purpose: the card's DOM stays the
 * same element as it slides between the centre and the side, so the clip on
 * the Go live card is never unmounted — it keeps playing through every move
 * instead of restarting each time it comes back round. Only the copy and
 * the thing you click change with the seat.
 *
 * Layers, bottom to top: the solid colour, the clip, the pattern, the
 * gloss, a light deck shade on side seats, a scrim under the copy. The
 * shade is kept light because these are colour cards — the full shade a
 * photograph can take is what made them look drained at the sides.
 */
function PromoCard({
  promo,
  centre,
  far,
  shade,
  onPick,
}: {
  promo: HeroPromo;
  centre: boolean;
  far: boolean;
  shade: number;
  onPick: () => void;
}) {
  const external = promo.href.startsWith("http");
  const label = `${promo.cta} — ${promo.eyebrow}`;
  return (
    <div
      className={cn(
        "group/promo relative size-full overflow-hidden rounded-sm",
        promo.shine && "shine",
        centre
          ? "shadow-[0_30px_80px_-30px_rgba(0,0,0,.9)]"
          : "shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] transition-transform hover:scale-[1.02]"
      )}
    >
      {/* A black base, so a card is never transparent in the moment before
          its first frame paints. Nothing else sits under the clip. */}
      <div className="absolute inset-0 bg-[#0b0b0d]" />
      {promo.video ? (
        // The background IS the clip: people doing something, blurred well
        // past recognition, so it plays as light and movement behind the
        // copy rather than as footage you are meant to watch. Scaled up
        // because a gaussian blur pulls a frame's edges inward — at this
        // radius, without the scale, the card shows four soft grey borders.
        <video
          src={promo.video}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 size-full scale-150 object-cover blur-xl"
        />
      ) : (
        // A painted card instead of a filmed one, for the promo whose own
        // artwork is the point.
        <div className={cn("absolute inset-0", promo.ground)} />
      )}
      <div className="card-gloss pointer-events-none absolute inset-0" />
      <div
        className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-300 group-hover/promo:opacity-0"
        style={{ opacity: centre ? 0 : shade * 0.3 }}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-t to-transparent",
          centre ? "from-black/65 via-black/10" : "from-black/50 via-transparent"
        )}
      />

      {/* The mark, bare on the card — no tile behind it. One variation of
          the W in the whole app: the one that draws itself, in white. The
          Wolf is the exception, because the wolf IS that promo's artwork. */}
      <span className={cn("absolute flex items-center gap-2.5 text-white", centre ? "top-4 left-4 md:top-5 md:left-5" : "top-3 left-3")}>
        {promo.mark === "wolf" ? (
          <WolfIcon size={centre ? 34 : 30} />
        ) : (
          <BrandMark size={centre ? 34 : 30} className="drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]" />
        )}
        {centre && (
          <span className="text-[10.5px] font-bold tracking-[0.16em] text-white uppercase drop-shadow-[0_1px_6px_rgba(0,0,0,0.35)]">
            {promo.eyebrow}
          </span>
        )}
      </span>

      {centre ? (
        <div className="absolute inset-x-0 bottom-0 p-4 md:p-5">
          <h2 className="text-[18px] leading-tight font-bold text-white md:text-[21px]">{promo.title}</h2>
          <p className="mt-1.5 line-clamp-2 max-w-[38ch] text-[12.5px] leading-snug text-white/80">{promo.tagline}</p>
          <span className={cn("mt-3 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors", promo.action)}>
            {promo.cta}
            <ArrowRight size={13} weight="bold" />
          </span>
        </div>
      ) : (
        !far && (
          <div className="absolute inset-x-0 bottom-0 p-4 text-white">
            <p className="text-[10px] font-bold tracking-[0.16em] text-white/75 uppercase">{promo.eyebrow}</p>
            <p className="mt-0.5 line-clamp-1 text-base font-semibold">{promo.title}</p>
          </div>
        )
      )}

      {/* What a click does depends on the seat: the centre card goes where
          it says, a side card comes to the centre. One full-bleed hit area
          either way, so the whole card is the target. */}
      {centre ? (
        external ? (
          <a href={promo.href} target="_blank" rel="noopener noreferrer" aria-label={label} className="absolute inset-0 z-10" />
        ) : (
          <Link href={promo.href} aria-label={label} className="absolute inset-0 z-10" />
        )
      ) : (
        <button type="button" onClick={onPick} aria-label={`Show ${promo.eyebrow}`} className="absolute inset-0 z-10" />
      )}
    </div>
  );
}

function SideCard({ item, onPick, far, shade }: { item: RowItem; onPick: () => void; far: boolean; shade: number }) {
  const name = item.streamerId.displayName || item.streamerId.username;
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={`Show ${item.title}`}
      className="group/side relative block size-full overflow-hidden rounded-sm bg-white/[0.03] text-left shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)] ring-1 ring-white/[0.06] transition-transform hover:scale-[1.02]"
    >
      <StreamArt src={item.thumbnailUrl} category={item.category} alt={item.title} seed={item._id + item.title} size={{ w: 960, h: 540 }} />
      {/* Darker the further back it sits in the deck — a shade, not
          transparency, so the card in front never shows through it. */}
      <div className="pointer-events-none absolute inset-0 bg-black transition-opacity group-hover/side:opacity-0" style={{ opacity: shade }} />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-transparent" />
      <LiveBadge className="absolute top-3 left-3" />
      <Badge variant="glass" icon={<Eye size={12} weight="bold" />} className="absolute top-3 right-3">
        {formatNumber(item.viewers)}
      </Badge>
      {!far && (
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <p className="line-clamp-1 text-base font-semibold">{item.title}</p>
          <p className="mt-0.5 truncate text-sm text-white/75">{name} · {item.category}</p>
        </div>
      )}
    </button>
  );
}
