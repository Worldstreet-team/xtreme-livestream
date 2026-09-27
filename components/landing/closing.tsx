import { GoLiveLink } from "@/components/app/go-live-link";
import { PillLink } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { Eyebrow, GUTTER, Lines, delay } from "./story-ui";

/** The last word, set as big as the page allows: the one thing to do next. */
export function Closing() {
  return (
    <section aria-labelledby="closing-title" className="overflow-hidden bg-ground pt-28 pb-24 sm:pt-36 lg:pt-40 lg:pb-28">
      <div className={cn("mx-auto flex max-w-[90rem] flex-col gap-10 lg:gap-12", GUTTER)}>
        <Eyebrow>Your room is waiting</Eyebrow>
        {/* The last word slides in against the scroll as you arrive. */}
        <h2
          id="closing-title"
          data-reveal="lines"
          data-parallax-x
          className="font-wide text-[clamp(5.5rem,24vw,25rem)] leading-[0.8] font-bold tracking-[-0.06em] whitespace-nowrap"
        >
          <Lines lines={["Go live."]} />
        </h2>
        <div data-reveal="up" style={delay(300)} className="flex flex-col gap-8 border-t border-hairline pt-6 md:flex-row md:items-end md:justify-between">
          <p className="max-w-[32rem] text-[20px] leading-[1.45] text-muted-foreground">
            One minute from now you could be on air, with a studio, a scoreboard and a wallet already set up.
          </p>
          <div className="flex flex-wrap gap-2">
            <GoLiveLink className="h-[52px] w-auto px-7 text-[16px]" />
            <PillLink href="/explore" variant="glass" size="xl">
              Watch first
            </PillLink>
          </div>
        </div>
      </div>
    </section>
  );
}
