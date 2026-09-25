"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CaretLeft, CaretRight, Clock, Eye, Fire, Heart, Play, Sparkle, TrendUp } from "@/components/icons";
import { formatNumber } from "@/lib/categories";
import { formatStartsIn, LEAD_LABEL, type HomeLead, type HomeRow, type LeadReason, type RowItem } from "@/lib/discovery";
import { HERO_PROMOS, type HeroPromo } from "@/lib/ecosystem";
import { logImpression } from "@/lib/impressions";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { PillLink } from "@/components/ui/pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { WolfIcon } from "@/components/ui/wolf-icon";
import { StreamArt } from "@/components/app/stream-art";
import { LivePreview } from "@/components/app/live-preview";
import { RemindButton } from "@/components/app/upcoming-card";
import { UserAvatar } from "@/components/ui/user-avatar";

/**
 * The home's stage (desktop and tablet; phones open on rings, chips and
 * shelves): a deck you slide through.
 *
 * A row of same-size cards — the centre one whole and playing, the ones
 * beside it cut off by the frame and dimmed. The centre card
 * carries the words — who and what, the title set wide, one way in — and
 * they rise in line by line as it arrives and drop away as it leaves. Click a side
 * card and it slides to the centre; the arrows and ← → do the same; it
 * advances on its own every few seconds until you touch it. No dots under
 * it (owner, 2026-09-23) — the deck itself shows there's more.
 *
 * What's live goes first, then — when the night is quiet — what's booked,
 * with a reminder, then the rest of WorldStreet, so the stage is never an
 * empty frame. The owner loved the old deck (2026-09-23); this is it in
 * Afterglow, with the Up next column gone — the deck already is up next.
 */

const ICON: Record<LeadReason, typeof Heart> = {
  followed: Heart,
  trending: TrendUp,
  rising: Sparkle,
  popular: Fire,
};

const AUTO_MS = 8000;
const MAX_LIVE = 6;

/**
 * The cards sit side by side at one size (owner, 2026-09-24): the centre
 * one whole, its neighbours cut off by the edges of the frame. `x` is a
 * card's centre as a fraction of the frame width from the middle; a card
 * two seats out is fully outside the frame, so a swap slides it in.
 */
const CENTRE = { wide: 0.6, compact: 0.78 };
const STEP_GAP = 0.012;
function slotFor(off: number, wide: boolean) {
  const step = CENTRE[wide ? "wide" : "compact"] + STEP_GAP;
  return { x: off * step, shade: off === 0 ? 0 : 0.45 };
}

type Slide =
  | { kind: "live"; key: string; item: RowItem }
  | { kind: "booked"; key: string; item: RowItem }
  | { kind: "promo"; key: string; promo: HeroPromo };

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

export function HomeStage({ leads, rows }: { leads: HomeLead[]; rows: HomeRow[] }) {
  const wide = useMinWidth(1024);

  const { slides, reason } = useMemo(() => {
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
    const booked = rows
      .filter((r) => r.kind === "upcoming")
      .flatMap((r) => r.items)
      .filter((it) => it.scheduledStartAt)
      .sort((a, b) => Date.parse(a.scheduledStartAt!) - Date.parse(b.scheduledStartAt!))
      .slice(0, live.length >= 3 ? 0 : 3);
    const out: Slide[] = [
      ...live.slice(0, MAX_LIVE).map((item) => ({ kind: "live" as const, key: item._id, item })),
      ...booked.map((item) => ({ kind: "booked" as const, key: item._id, item })),
      ...HERO_PROMOS.map((promo) => ({ kind: "promo" as const, key: `promo-${promo.id}`, promo })),
    ];
    return { slides: out, reason: why };
  }, [leads, rows]);

  const n = slides.length;
  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  const [hover, setHover] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  const go = useCallback((dir: 1 | -1) => setActive((a) => (a + dir + n) % n), [n]);
  const pick = (i: number) => {
    setTouched(true);
    setActive(i);
  };

  // Advance until the viewer takes the wheel; never while hovered or hidden.
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

  const idx = n ? Math.min(active, n - 1) : 0;
  const current = slides[idx];
  useEffect(() => {
    if (current?.kind !== "live") return;
    const { item } = current;
    logImpression({ streamId: item._id, surface: "home", row: "hero", slot: idx, explore: reason.get(item._id) === "rising" });
  }, [current, idx, reason]);

  if (n === 0) return null;
  const half = Math.floor(n / 2);

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label="On the stage"
      tabIndex={0}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group/hero relative outline-none"
    >
      {/* Height follows the centre card at 16:9: 60% of the width on desktop, 78% on tablets. */}
      <div className="relative w-full overflow-hidden" style={{ aspectRatio: wide ? "80 / 27" : "800 / 351" }}>
        {slides.map((s, i) => {
          let off = ((i - idx) % n + n) % n;
          if (off > half) off -= n;
          // Two seats either side are placed (one just outside the frame,
          // so it can slide in); anything further is parked and hidden.
          const shown = Math.abs(off) <= 2;
          const slot = slotFor(Math.max(-3, Math.min(3, off)), wide);
          const style = {
            left: `${50 + slot.x * 100}%`,
            transform: "translate(-50%, -50%)",
            opacity: shown ? 1 : 0,
            zIndex: shown ? 10 - Math.abs(off) : 0,
          };
          const centre = off === 0;
          return (
            <div
              key={s.key}
              className={cn(
                "absolute top-1/2 aspect-video transition-[left,opacity] duration-500 ease-[cubic-bezier(.22,1,.36,1)]",
                wide ? "w-[60%]" : "w-[78%]",
                !shown && "pointer-events-none",
              )}
              style={style}
              aria-hidden={!shown}
            >
              <div
                className={cn(
                  "relative isolate size-full overflow-hidden rounded-xl bg-ground",
                  !centre && "group/side",
                  centre ? "shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)]" : "shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)]",
                )}
              >
                {/* The picture, then the caption. The caption stays mounted in
                    every seat and transitions on `on`, so the words play out
                    as a card leaves the centre and in as the next arrives. */}
                <Media slide={s} centre={centre} />
                <Caption slide={s} on={centre} reason={s.kind === "live" ? reason.get(s.item._id) : undefined} />
                {!centre && (
                  <>
                    <SideLabel slide={s} />
                    <div
                      className="pointer-events-none absolute inset-0 bg-black transition-opacity duration-300 group-hover/side:opacity-0"
                      style={{ opacity: slot.shade }}
                    />
                    <button
                      type="button"
                      onClick={() => pick(i)}
                      aria-label={`Bring ${s.kind === "promo" ? s.promo.eyebrow : s.item.title} to the stage`}
                      className="absolute inset-0 z-10"
                      tabIndex={shown ? 0 : -1}
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}

        {n > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous"
              onClick={() => { setTouched(true); go(-1); }}
              className="obj press absolute top-1/2 left-2 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-white md:left-4"
            >
              <CaretLeft size={19} weight="bold" />
            </button>
            <button
              type="button"
              aria-label="Next"
              onClick={() => { setTouched(true); go(1); }}
              className="obj press absolute top-1/2 right-2 z-30 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-white md:right-4"
            >
              <CaretRight size={19} weight="bold" />
            </button>
          </>
        )}
      </div>

    </section>
  );
}

/* ------------------------------------------------------------------ */

/** The picture: a live room plays only in the centre; everything else is a still. */
function Media({ slide, centre }: { slide: Slide; centre: boolean }) {
  if (slide.kind === "promo") {
    const { promo } = slide;
    return (
      <>
        {promo.video ? (
          <video src={promo.video} autoPlay muted loop playsInline preload="metadata" aria-hidden className="absolute inset-0 -z-20 size-full scale-150 object-cover blur-xl" />
        ) : (
          <div className={cn("absolute inset-0 -z-20", promo.ground)} />
        )}
        <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
      </>
    );
  }
  const { item } = slide;
  const poster = <StreamArt src={item.thumbnailUrl} category={item.category} alt="" seed={item._id + item.title} size={{ w: 1280, h: 720 }} />;
  return (
    <>
      {slide.kind === "live" && centre ? (
        <LivePreview streamId={item._id} poster={poster} fallbackSrc={item.previewUrl ?? null} className="absolute inset-0 -z-20" />
      ) : (
        <div className={cn("absolute inset-0 -z-20", slide.kind === "booked" && "saturate-[.7]")}>{poster}</div>
      )}
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,0.4),rgba(0,0,0,0)_30%,rgba(0,0,0,0)_45%,rgba(0,0,0,0.85))]" />
      {slide.kind === "live" && centre && (
        <Link
          href={`/stream/${item._id}`}
          className="absolute inset-0 -z-[5]"
          aria-label={`Watch ${item.streamerId.displayName || item.streamerId.username}: ${item.title}`}
          tabIndex={-1}
        />
      )}
    </>
  );
}

/**
 * The words on the stage, set like a magazine cover rather than a
 * broadcast strap: a quiet line of who and what, the title big and wide
 * under it, one way in. Each line rises out of its own mask in turn when a
 * card takes the centre, and drops away first when it leaves.
 */
function Caption({ slide, on, reason }: { slide: Slide; on: boolean; reason?: LeadReason }) {
  const now = useNow(slide.kind === "booked" && on);
  // Exit fast and all together; enter staggered, top line first.
  const line = (step: number) => ({
    className: cn(
      "block transition-[transform,opacity] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none",
      on ? "translate-y-0 opacity-100 duration-700" : "translate-y-[110%] opacity-0 duration-300",
    ),
    style: { transitionDelay: on ? `${160 + step * 90}ms` : "0ms" },
  });
  const mask = "overflow-hidden pb-[0.12em]";

  let meta: React.ReactNode;
  let title: string;
  let action: React.ReactNode;
  let corner: React.ReactNode = null;

  if (slide.kind === "promo") {
    const { promo } = slide;
    const external = promo.href.startsWith("http");
    meta = (
      <span className="flex items-center gap-2 text-white/80">
        {promo.mark === "wolf" ? <WolfIcon size={20} /> : <BrandMark size={20} />}
        <span className="caps font-mono text-[10.5px]">{promo.eyebrow}</span>
      </span>
    );
    title = promo.title;
    action = (
      <PillLink
        href={promo.href}
        external={external}
        variant="primary"
        size="md"
        trailing={<ArrowRight size={14} weight="bold" />}
        tabIndex={on ? 0 : -1}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {promo.cta}
      </PillLink>
    );
  } else {
    const { item } = slide;
    const name = item.streamerId.displayName || item.streamerId.username;
    const live = slide.kind === "live";
    const Why = reason ? ICON[reason] : null;
    meta = (
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-white/75">
        <UserAvatar src={item.streamerId.avatar} name={name} size={24} ring={live ? "live" : "seen"} ringGapClassName="bg-black" />
        <span className="truncate font-semibold text-white">{name}</span>
        <span aria-hidden className="text-white/35">·</span>
        <span className="truncate">{item.category}</span>
        {Why && reason && (
          <span className="flex shrink-0 items-center gap-1 font-semibold text-ember-hi">
            <Why size={12} weight="fill" aria-hidden />
            {LEAD_LABEL[reason]}
          </span>
        )}
      </span>
    );
    title = item.title;
    action = live ? (
      <PillLink href={`/stream/${item._id}`} variant="primary" size="md" icon={<Play size={14} weight="fill" />} tabIndex={on ? 0 : -1}>
        Watch now
      </PillLink>
    ) : (
      <RemindButton streamId={item._id} initial={item.reminded ?? false} size="default" onPicture />
    );
    corner = live ? (
      <>
        <LiveBadge size="md" />
        <Badge variant="glass" size="md" icon={<Eye size={13} weight="bold" />}>
          {formatNumber(item.viewers)}
        </Badge>
      </>
    ) : (
      <Badge variant="glass" size="md" icon={<Clock size={13} weight="bold" />}>
        <span suppressHydrationWarning>Starts {formatStartsIn(item.scheduledStartAt!, now)}</span>
      </Badge>
    );
  }

  return (
    <div aria-hidden={!on} className={cn("absolute inset-0", !on && "pointer-events-none")}>
      {corner && (
        <div
          className={cn(
            "absolute top-3.5 left-3.5 flex items-center gap-1.5 transition-opacity md:top-4 md:left-4",
            on ? "opacity-100 duration-500" : "opacity-0 duration-200",
          )}
          style={{ transitionDelay: on ? "120ms" : "0ms" }}
        >
          {corner}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-1.5 p-4 md:p-5">
        <div className={cn(mask, "max-w-full")}>
          <span {...line(0)}>{meta}</span>
        </div>
        {/* The whole title, never cut with "…" (owner) — it wraps instead.
            The type lives on the h2 so the measure is in the title's own size. */}
        <h2 className={cn(mask, "max-w-[24ch] font-wide text-[clamp(1.05rem,1.55vw,1.55rem)] leading-[1.08] font-bold tracking-[-0.035em] text-balance text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)]")}>
          <span {...line(1)}>
            {title}
          </span>
        </h2>
        <div className={cn(mask, "pointer-events-auto mt-1")}>
          <span {...line(2)}>{action}</span>
        </div>
      </div>
    </div>
  );
}

/** A side seat: the picture and just enough to know whose it is. */
function SideLabel({ slide }: { slide: Slide }) {
  const label = slide.kind === "promo" ? slide.promo.eyebrow : slide.item.streamerId.displayName || slide.item.streamerId.username;
  return (
    <>
      {slide.kind === "live" && <LiveBadge size="md" className="absolute top-3 left-3" />}
      <p className="absolute inset-x-0 bottom-0 truncate p-3.5 font-wide text-[15px] font-bold tracking-[-0.02em] text-white">{label}</p>
    </>
  );
}
