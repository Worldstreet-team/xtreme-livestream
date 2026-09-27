"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, Heart } from "@/components/icons";
import { GIFT_CATALOG } from "@/lib/gifts";
import { cn } from "@/lib/utils";
import { chapters } from "@/components/design-system/catalog";
import { Colour, Type, Shape, Light, Motion } from "@/components/design-system/foundations";
import { Themes } from "@/components/design-system/themes";
import { Actions, Status, People, Discovery } from "@/components/design-system/component-demos";
import { Giving, Competing, Talking, Forms, Surfaces, Rules } from "@/components/design-system/product-standards";
import { STAGE } from "@/components/design-system/sample-data";
import { BrandMark, ChatBubble, Chip, GiftAlert, GiftToken, LowerThird, Pill, UserAvatar } from "@/components/xtream";

/**
 * /design-system — Afterglow 2.0 (owner's pick, 2026-09-23).
 *
 * A lookbook, not a manual: it opens on the product in motion, and every
 * part below is the real component doing its job, with the one line that
 * wires it. The rules the old reference held (targets, focus, contrast,
 * motion) are in the appendix, one scroll down, not lost.
 */
export default function DesignSystemPage() {
  return (
    <div id="top" className="ds-catalog min-h-screen bg-background text-foreground">
      <a href="#colour" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[80] focus:rounded-full focus:bg-inverse focus:px-4 focus:py-2 focus:text-on-inverse">
        Skip to the system
      </a>
      <Masthead />
      <main className="mx-auto w-full max-w-[1240px] px-4 pb-28 md:px-8">
        <Cover />
        <Principles />
        <Colour />
        <Themes />
        <Type />
        <Shape />
        <Light />
        <Motion />
        <Actions />
        <Status />
        <People />
        <Discovery />
        <Giving />
        <Competing />
        <Talking />
        <Forms />
        <Surfaces />
        <Rules />
      </main>
      <footer className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-3 border-t border-hairline px-4 py-8 font-mono text-[11px] text-muted-foreground md:px-8">
        <span className="flex items-center gap-2.5">
          <BrandMark size={20} /> Xtream · Afterglow 2.0
        </span>
        <span>tokens app/design-system.css · parts @/components/xtream · rules docs/design-system.md</span>
      </footer>
    </div>
  );
}

/** The header: glass (navigation is glass's one home), chapters that follow you. */
function Masthead() {
  const [active, setActive] = useState<string>(chapters[0].id);
  const rail = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const els = chapters.map((c) => document.getElementById(c.id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setActive(seen[0].target.id);
      },
      { rootMargin: "-25% 0px -65% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Keep the lit chapter in view on a phone, where the rail scrolls.
  useEffect(() => {
    const chip = rail.current?.querySelector<HTMLElement>(`[data-chapter="${active}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-background/80 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-2.5 md:gap-5 md:px-8">
        <Link href="/explore" className="flex shrink-0 items-center gap-2" aria-label="Back to Xtream">
          <BrandMark size={26} />
          <span className="hidden text-[17px] font-bold tracking-tight sm:inline">Xtream</span>
        </Link>
        <span className="hidden shrink-0 rounded-full bg-tint/[0.06] px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground lg:inline">
          Design system · Afterglow 2.0
        </span>
        <nav aria-label="Chapters" className="ml-auto min-w-0">
          <div ref={rail} className="flex gap-1 overflow-x-auto scrollbar-none">
            {chapters.map((c) => (
              <a
                key={c.id}
                href={`#${c.id}`}
                data-chapter={c.id}
                aria-current={active === c.id ? "true" : undefined}
                className={cn(
                  "press shrink-0 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                  active === c.id ? "bg-inverse text-on-inverse shadow-glow-white" : "text-muted-foreground hover:bg-tint/[0.06] hover:text-foreground",
                )}
              >
                {c.label}
              </a>
            ))}
          </div>
        </nav>
      </div>
    </header>
  );
}

const tsion = GIFT_CATALOG.find((g) => g.id === "tsion-car")!;
const crown = GIFT_CATALOG.find((g) => g.id === "crown")!;

/** The cover: the product in motion, on a real frame. */
function Cover() {
  return (
    // Stays dark: the cover is a live frame.
    <section aria-labelledby="ds-title" data-theme="dark" className="relative isolate mt-5 overflow-hidden rounded-[32px] bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
      <video
        aria-hidden
        className="absolute inset-0 -z-20 size-full object-cover motion-reduce:hidden"
        src="/promo/crowd.mp4"
        poster={STAGE.cover}
        autoPlay
        muted
        loop
        playsInline
      />
      <span aria-hidden className="absolute inset-0 -z-20 hidden bg-cover bg-center motion-reduce:block" style={{ backgroundImage: `url(${STAGE.cover})` }} />
      <span
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_70%_at_10%_16%,rgba(242,14,33,0.3),transparent_62%),linear-gradient(90deg,rgba(11,7,8,0.95),rgba(11,7,8,0.72)_46%,rgba(11,7,8,0.3))]"
      />
      <span aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-black/75 to-transparent" />

      <div className="grid gap-10 p-6 pt-12 md:p-10 md:pt-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end lg:p-14">
        <div>
          <p className="caps font-mono text-[10.5px] text-muted-foreground">Xtream design system · Afterglow 2.0</p>
          <h1 id="ds-title" className="ds-display mt-5 text-[clamp(3rem,8.4vw,6.5rem)] leading-[0.92] text-foreground">
            Warm light
            <br />
            after dark.
          </h1>
          <p className="mt-6 max-w-[48ch] text-[16.5px] leading-relaxed text-foreground/80 text-pretty">
            Two colours from the chili, one ring of heat, and a moment for everything that happens in a live room.
            Every part on this page is the real component, shown with the line that wires it.
          </p>
          <div className="mt-8 flex flex-wrap gap-2.5">
            <a href="#colour" className="press inline-flex h-11 items-center gap-2 rounded-full bg-inverse px-5 text-[15px] font-semibold text-on-inverse shadow-glow-white">
              Start with colour <ArrowDown size={16} weight="bold" />
            </a>
            <a href="#rules" className="obj press inline-flex h-11 items-center rounded-full px-5 text-[15px] font-semibold text-white">
              The rules
            </a>
          </div>
        </div>

        {/* A live moment, made of the parts below. */}
        <div className="flex min-w-0 flex-col items-start gap-3">
          <LowerThird
            name="Ada Okafor"
            meta="IRL · rooftop sessions"
            action={<Pill size="sm" variant="primary" icon={<Heart size={14} weight="fill" />}>Follow</Pill>}
          />
          <div className="flex max-w-full gap-2 overflow-x-auto scrollbar-none">
            <Chip active onPicture>For you</Chip>
            <Chip onPicture live>Music</Chip>
            <Chip onPicture live>IRL</Chip>
            <Chip onPicture>Markets</Chip>
          </div>
          <div className="mt-1 flex flex-col items-start gap-1.5">
            <ChatBubble name="nneka">this is the one 🔥</ChatBubble>
            <ChatBubble kind="host" name="Ada">welcome in, drop your city 👇</ChatBubble>
          </div>
          <GiftAlert art={tsion.art} emoji={tsion.emoji} giftName="Tsion Car" from="Amara" amountLabel="$2,500" className="mt-1" />
        </div>
      </div>
    </section>
  );
}

/** The three ideas everything else follows. */
function Principles() {
  const tile = "flex min-h-[220px] flex-col justify-between gap-6 rounded-panel bg-surface p-6 shadow-[inset_0_0_0_1px_var(--hairline-color)]";
  return (
    <div className="mt-5 grid gap-4 md:grid-cols-3">
      <div className={tile}>
        <div className="flex items-center gap-2">
          <span className="size-11 rounded-full bg-chili shadow-glow-chili" />
          <span className="size-11 rounded-full bg-ember shadow-glow-ember" />
        </div>
        <div>
          <h2 className="font-wide text-[21px] font-bold tracking-[-0.025em]">Two colours</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/72">
            <b className="text-chili-hi">Chili</b> for live and action, <b className="text-ember-hi">Ember</b> for energy and choice. They’re used everywhere, and never mixed on one control.
          </p>
        </div>
      </div>
      <div className={tile}>
        <div className="flex items-center gap-3">
          <UserAvatar name="Ada Okafor" size={44} ring="live" ringGapClassName="bg-surface" />
          <UserAvatar name="Kenzo Vale" size={44} ring="story" ringGapClassName="bg-surface" />
          <UserAvatar name="Rolo" size={44} ring="seen" ringGapClassName="bg-surface" />
        </div>
        <div>
          <h2 className="font-wide text-[21px] font-bold tracking-[-0.025em]">One ring</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/72">
            <b className="text-heat">Heat</b>, the gradient, lives on rings, Go live and gift moments, and nowhere else. That’s why they read as moments.
          </p>
        </div>
      </div>
      <div className={tile}>
        <div className="flex items-end gap-2">
          <GiftToken gift={crown} state="landed" combo={2} size="sm" />
        </div>
        <div>
          <h2 className="font-wide text-[21px] font-bold tracking-[-0.025em]">Moments, not rows</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-foreground/72">
            Allied, gifted, on air, won. Each state is designed as an event with its own beat, instead of a line in a table.
          </p>
        </div>
      </div>
    </div>
  );
}
