import Image from "next/image";
import { ArrowUpRight } from "@/components/icons";
import { PillLink } from "@/components/ui/pill";
import { Eyebrow, GUTTER, Lines, delay } from "./story-ui";

/**
 * The landing hero: the whole pitch in three beats, set big enough to be
 * the picture's caption rather than a line on top of it.
 *
 * The background is still the filming clip (`/promo/live-phones.mp4`),
 * graded warm and held under a scrim that's heaviest where the type sits,
 * so it reads as light and movement. Its first frame is the poster, and the
 * whole picture for anyone who has asked their system for less motion.
 *
 * No figures here: the owner took the year-one targets off the hero
 * (2026-09-22) because projections were wearing the clothes of results.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate flex min-h-[100svh] flex-col justify-end overflow-hidden">
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        {/* The film arrives zoomed and settles, then drifts slower than
            the page as you scroll away from it. It's taller than the frame
            so the drift never shows an edge. */}
        <div data-reveal="zoom" className="absolute inset-0">
          <div data-parallax="0.2" className="absolute inset-x-0 -top-[12%] h-[124%]">
            <Image src="/promo/live-phones-poster.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
            <video
              id="hero-film"
              src="/promo/live-phones.mp4"
              poster="/promo/live-phones-poster.jpg"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              className="absolute inset-0 size-full object-cover motion-reduce:hidden"
            />
          </div>
        </div>
        {/* Warm the footage toward the ground, then scrim it: heaviest at
            the left and the foot, where the words are. */}
        <div className="absolute inset-0 bg-[#3a1208]/25 mix-blend-multiply" />
        <div className="absolute inset-0 bg-gradient-to-r from-ground/95 via-ground/60 to-ground/10" />
        <div className="absolute inset-0 bg-gradient-to-b from-ground/60 via-transparent via-40% to-ground" />
      </div>

      <div className={`mx-auto flex w-full max-w-[90rem] flex-col gap-14 pt-32 pb-16 sm:pb-20 ${GUTTER}`}>
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-7">
            <Eyebrow>The live layer of WorldStreet</Eyebrow>
            <h1
              id="hero-title"
              data-reveal="lines"
              style={delay(150)}
              className="font-wide text-[clamp(3.25rem,8vw,7.75rem)] leading-[0.88] font-bold tracking-[-0.05em] text-foreground"
            >
              <Lines lines={["Go live.", "Get backed.", "Get paid."]} />
            </h1>
          </div>

          <div data-reveal="up" style={delay(650)} className="flex max-w-[23rem] flex-col gap-7 lg:pb-3">
            <p className="text-[17px] leading-[1.5] text-foreground/85">
              Xtream is where WorldStreet goes live: a studio, a scoreboard and a wallet in one room. Every gift, follow and battle win
              counts.
            </p>
            <div className="flex flex-wrap gap-2">
              <PillLink href="/studio" variant="primary" size="xl" trailing={<ArrowUpRight size={17} weight="bold" />}>
                Start streaming
              </PillLink>
              <PillLink href="/explore" variant="glass" size="xl" className="bg-white/[0.12] hover:bg-white/[0.18]">
                Watch live
              </PillLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
