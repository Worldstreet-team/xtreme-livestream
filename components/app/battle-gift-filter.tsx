"use client";

import { Gift } from "@/components/icons";
import { GIFT_CATALOG } from "@/lib/gifts";
import { giftFilterLine } from "@/lib/battles";
import { Chip, GiftArt } from "@/components/xtream";
import { CapsuleTabs } from "@/components/ui/capsule-tabs";

/**
 * "Which gifts count": a battle's optional gift filter, set with an invite
 * or a booking. All gifts by default; otherwise the host picks the gifts
 * that move the score, as chips wearing their animated faces. Every gift
 * still reaches the host as money — only the score skips the rest. Quick
 * match never carries one.
 */
export function BattleGiftFilter({
  onlySome,
  onOnlySome,
  chosen,
  onChosen,
}: {
  onlySome: boolean;
  onOnlySome: (on: boolean) => void;
  /** Catalog ids picked, in the order they were tapped (the API puts them in catalog order). */
  chosen: string[];
  onChosen: (ids: string[]) => void;
}) {
  const line = giftFilterLine(chosen);
  return (
    <div className="mb-2">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground/70 uppercase">
        <Gift size={12} weight="fill" />
        Which gifts count
      </p>
      <CapsuleTabs
        label="Which gifts count"
        items={[
          { id: "all" as const, label: "All gifts" },
          { id: "some" as const, label: "Only some" },
        ]}
        value={onlySome ? "some" : "all"}
        onChange={(v) => onOnlySome(v === "some")}
      />
      {onlySome && (
        <>
          <div role="group" aria-label="Gifts that count" className="mt-2 flex flex-wrap gap-1.5">
            {GIFT_CATALOG.map((g) => {
              const on = chosen.includes(g.id);
              return (
                <Chip
                  key={g.id}
                  active={on}
                  onClick={() => onChosen(on ? chosen.filter((id) => id !== g.id) : [...chosen, g.id])}
                  className="h-8 gap-1.5 pr-3 pl-1.5 text-[12px]"
                >
                  <GiftArt art={g.art} emoji={g.emoji} size={20} />
                  {g.name}
                </Chip>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            {line ? `${line}. Every gift still reaches you.` : "Pick the gifts that move the score."} Quick match counts every gift.
          </p>
        </>
      )}
    </div>
  );
}
