import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Lightning, Play } from "@phosphor-icons/react/dist/ssr";

/**
 * The landing hero.
 *
 * One headline, one line under it, two ways in — and nothing else. It was
 * carrying an early-access badge, a camera-effect toggle, two red glows and
 * a row of year-one target figures; all of it competed with the sentence
 * that actually has to land, and the figures were projections wearing the
 * clothes of achievements. Owner, 2026-09-22.
 *
 * The background is the filming clip, held under a heavy scrim so it reads
 * as light and movement rather than footage the eye tries to watch.
 */
export function Hero() {
  return (
    <section className="relative flex min-h-screen items-end justify-center overflow-hidden">
      <div className="absolute inset-0">
        {/* The grid is the ground the film sits on: it shows before the
            first frame paints, and it is the whole background for anyone
            who has asked their system for less motion. */}
        <div
          className="h-full w-full bg-[#030303]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        <video
          src="/promo/live-phones.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 size-full object-cover motion-reduce:hidden"
        />
        {/* Footage is atmosphere, not the subject. It keeps most of its
            light at the top and falls away to near-black at the foot,
            where the copy sits — so the type never fights the picture. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/65 to-black/95 motion-reduce:hidden" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-4 pt-28 pb-20 text-center sm:px-6 md:pb-28 lg:px-8">
        {/* One sentence per line, and the size is chosen so the longer of
            the two still fits the measure — `text-balance` is deliberately
            absent, since it only fights an explicit break. */}
        <h1 className="font-[family-name:var(--font-display)] text-[2.15rem] leading-[1.04] font-extrabold tracking-[-0.035em] text-white sm:text-[3rem] md:text-[4rem] lg:text-[4.75rem]">
          Your bags are pumping.
          <br />
          Your stream should be too.
        </h1>

        <p className="mt-7 max-w-[46ch] text-lg leading-relaxed text-white/75 sm:text-xl">
          Go live, flex your alpha, and get tipped in crypto — all
          while&nbsp;the&nbsp;charts do the talking.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            className="h-12 gap-2 rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
          >
            <Link href="/studio">
              <Lightning size={20} weight="fill" />
              Start streaming
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 gap-2 rounded-full border-white/15 bg-white/5 px-8 text-base font-semibold text-white transition-colors hover:border-white/25 hover:bg-white/10"
          >
            <Link href="/explore">
              <Play size={20} weight="fill" />
              Explore streams
            </Link>
          </Button>
        </div>
      </div>

      {/* Bottom fade into the page below. */}
      <div className="pointer-events-none absolute right-0 bottom-0 left-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
}
