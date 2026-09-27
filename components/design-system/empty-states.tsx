"use client";

import { useState } from "react";
import { ArrowClockwise } from "@/components/icons";
import { Chip, Empty, EmptySceneArt, EMPTY_SCENES } from "@/components/xtream";
import { Section, Spec, StageNote } from "./doc-parts";

type Ground = "page" | "dark" | "light";

/**
 * Empty states — Xtream's own illustrations. Every scene on the shelf is
 * the real drawing; the ground switch pins them to either theme so both
 * can be checked side by side, and Replay runs the entrance again.
 */
export function EmptyStates() {
  const [ground, setGround] = useState<Ground>("page");
  const [take, setTake] = useState(0);

  return (
    <Section
      id="empty"
      act="Components · empty states"
      title="Nothing here, drawn by us."
      intro="An empty screen gets one of our own scenes in place of an icon in a circle: drawn in code, in the page's own ink, with one slow loop so the screen feels awake without asking for attention. The title says what the scene means; Go live still sits under it."
    >
      <Spec
        name="Empty with a scene"
        summary="An empty screen is an invitation, so it always offers Go live, with the page's own way out beside it as the quieter button (off only in the studio or on someone else's channel). Pass scene and the illustration draws, animates and themes itself. It enters once, then idles: a drift, a pulse, a card sliding in. Reduced motion gets the resting pose, and a scene off screen holds still."
        rules={[
          "One family: a faint disc, 2px lines, solid cards with 10–14px corners, a few specks around it.",
          "One accent at most. Chili only when the empty is about being live, Ember for a booked show, gold only for money.",
          "No bitmaps, gradients, glows or glass, and never the Vivid dot sphere or the logo.",
          "compact fits a popover or a narrow pane. onDark keeps the scene in the dark room's tokens over video.",
        ]}
        wire={`import { Empty } from "@/components/xtream";

<Empty scene="live" title="Nobody's live right now" body="…" action={{ label: "Browse categories", href: "/browse" }} />
<Empty scene="broadcasts" title="…" goLive={false} />   // on someone else's channel
<Empty compact scene="notifications" title="No notifications yet" />`}
      >
        <Empty
          scene="live"
          title="Nobody's live in IRL right now"
          body="Which makes this a good minute to be the one on air."
          action={{ label: "Browse categories", onClick: () => {} }}
          className="py-6 md:py-8"
        />
      </Spec>

      <div className="rounded-panel bg-surface p-4 shadow-[inset_0_0_0_1px_var(--hairline-color)] md:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <StageNote className="mr-auto">Every scene · {EMPTY_SCENES.length}</StageNote>
          {(["page", "dark", "light"] as const).map((g) => (
            <Chip key={g} active={ground === g} onClick={() => setGround(g)}>
              {g === "page" ? "This page" : g === "dark" ? "Dark" : "Light"}
            </Chip>
          ))}
          <Chip onClick={() => setTake((t) => t + 1)}>
            <ArrowClockwise size={14} weight="bold" />
            Replay
          </Chip>
        </div>
        <ul
          data-theme={ground === "page" ? undefined : ground}
          className="grid grid-cols-2 gap-2.5 rounded-[14px] bg-background p-2.5 sm:grid-cols-3 lg:grid-cols-4"
        >
          {EMPTY_SCENES.map((s) => (
            <li key={`${s.id}-${take}`} className="flex min-w-0 flex-col items-center rounded-[12px] bg-surface px-2 pt-4 pb-3.5 text-center">
              <EmptySceneArt scene={s.id} className="w-full max-w-[200px]" />
              <p className="mt-2 text-[13.5px] font-semibold text-foreground">{s.label}</p>
              <p className="font-mono text-[10.5px] text-ember-hi">scene=&quot;{s.id}&quot;</p>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{s.use}</p>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
