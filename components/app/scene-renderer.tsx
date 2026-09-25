"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { stageLayout } from "@/lib/stage-layout";
import { UserAvatar } from "@/components/ui/user-avatar";
import { CARDS, guestsShown, type Scene, type SceneCard } from "@/lib/scene";

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
 * whole frame while the room keeps hearing them.
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
}) {
  const layout = forceAuto ? "auto" : scene.layout;
  const shown = guests.slice(0, guestsShown(layout, guests.length, forceAuto));
  const grid = stageLayout(1 + shown.length, portrait);
  const showPip = Boolean(pip) && shown.length === 0 && layout !== "solo";

  return (
    <div className="@container relative size-full">
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
      {scene.card && <SceneCardView card={scene.card} note={scene.cardNote} host={host} />}
    </div>
  );
}

/**
 * A full-frame card: the host's face, whose stream it is, the card's title
 * and a line — the host's own when they wrote one. Flat on the warm ground;
 * the bars keep moving so the frame never reads as frozen.
 */
function SceneCardView({ card, note, host }: { card: SceneCard; note: string; host: { name: string; avatar?: string | null } }) {
  const def = CARDS.find((c) => c.id === card) ?? CARDS[0];
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
        {card !== "ending" && (
          <span aria-hidden className="mt-6 flex h-5 items-end gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-1 origin-bottom rounded-full bg-ember motion-safe:animate-[scene-bars_1.1s_ease-in-out_infinite]"
                style={{ height: "100%", animationDelay: `${i * 140}ms` }}
              />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
