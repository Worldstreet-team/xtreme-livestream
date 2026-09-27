import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { BoxPattern } from "./box-pattern";
import { GUTTER, INK_MUTED, PAPER } from "./story-ui";

const STATEMENT =
  "Most platforms pay you for being watched. Xtream pays you for what the room does: the gift that lands, the battle you win, the allies who come back every night.";

/**
 * Why Xtream, in one sentence, read at the speed you scroll: each word
 * lights up as the reading line passes it. Then four facts about how the
 * product works. They're rules of the product (a minute to air, three games, a weekly race,
 * one wallet), not results, so they stay true on day one.
 */
const FACTS: Array<[string, string, string]> = [
  ["60s", "From sign-in to on air", "Camera, screen or your OBS rig."],
  ["3", "Live games built in", "Predictions, raffles and quizzes."],
  ["7", "Days in every Wolf race", "The pelt changes hands weekly."],
  ["1", "Wallet for everything", "Gifts, payouts and points."],
];

export function Manifesto() {
  return (
    <section aria-label="Why Xtream" className={cn("relative isolate overflow-hidden", PAPER, "py-24 sm:py-32 lg:py-40")}>
      <BoxPattern theme="tiles" corner="br" />
      <div className={cn("mx-auto flex max-w-[90rem] flex-col gap-24 lg:gap-32", GUTTER)}>
        <div className="grid gap-8 lg:grid-cols-[17.5rem_1fr] lg:gap-20">
          <p data-reveal="up" className={cn("caps pt-3 font-mono text-[12px]", INK_MUTED)}>
            Why Xtream
          </p>
          <p
            data-scrub="words"
            style={{ "--n": STATEMENT.split(" ").length } as CSSProperties}
            className="font-wide text-[clamp(1.9rem,3.8vw,3.4rem)] leading-[1.06] font-bold tracking-[-0.04em] text-balance"
          >
            {STATEMENT.split(" ").map((word, i) => (
              <span key={i} className="lm-word" style={{ "--i": i } as CSSProperties}>
                {word}{" "}
              </span>
            ))}
          </p>
        </div>

        <dl data-reveal="stagger" className="grid grid-cols-2 gap-y-12 border-t border-black/15 lg:grid-cols-4">
          {FACTS.map(([value, label, detail], i) => (
            <div key={label} className="flex flex-col gap-3 pt-8 pr-6">
              <dt className="order-2 text-[16px] font-semibold">{label}</dt>
              <dd data-count={i * 120} className="order-1 font-money text-[clamp(4rem,7vw,6rem)] leading-none tracking-[-0.05em]">{value}</dd>
              <dd className={cn("order-3 text-[14px]", INK_MUTED)}>{detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
