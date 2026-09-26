"use client";

import { useState } from "react";
import { BesideYou } from "@/components/app/director-switch";
import {
  CARDS,
  CHART_INTERVAL_LABELS,
  CHART_MARKETS,
  DEFAULT_CHART,
  LAYOUTS,
  type ChartInterval,
  type Scene,
  type SceneChart,
  type SceneLayout,
} from "@/lib/scene";
import { cn } from "@/lib/utils";

const LABEL = "caps font-mono text-[10.5px] text-muted-foreground";

/** The layouts' hints as a producer reads them — about the host, not "you". */
const CREW_HINTS: Record<SceneLayout, string> = {
  auto: "Splits for whoever's on",
  solo: "Just the host",
  split: "The host and one guest",
  trio: "The host and two guests",
  grid: "Up to four on screen",
  "screen-face": "Their screen, their camera in the corner",
  "chart-face": "A live market chart, their camera in the corner",
};

/** A layout drawn small: where the people go, the way the scene will place them. */
export function LayoutThumb({ layout }: { layout: SceneLayout }) {
  const cell = "rounded-[3px] bg-current opacity-35";
  return (
    <span aria-hidden className="relative block aspect-video w-full overflow-hidden rounded-[6px] bg-current/[0.08] p-[3px]">
      {layout === "auto" ? (
        <span className="flex size-full items-center justify-center font-mono text-[10px] font-bold opacity-70">AUTO</span>
      ) : layout === "solo" ? (
        <span className={cn("block size-full", cell)} />
      ) : layout === "split" ? (
        <span className="grid size-full grid-cols-2 gap-[3px]">
          <span className={cell} />
          <span className={cell} />
        </span>
      ) : layout === "trio" ? (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-[3px]">
          <span className={cn("row-span-2", cell)} />
          <span className={cell} />
          <span className={cell} />
        </span>
      ) : layout === "grid" ? (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-[3px]">
          <span className={cell} />
          <span className={cell} />
          <span className={cell} />
          <span className={cell} />
        </span>
      ) : layout === "chart-face" ? (
        // A little rising chart, the face in the corner.
        <span className="relative block size-full">
          <svg viewBox="0 0 40 22" preserveAspectRatio="none" className="absolute inset-0 size-full opacity-60">
            <polyline points="1,18 8,15 14,16 20,10 26,12 32,6 39,8" fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="absolute top-[3px] right-[3px] h-[38%] w-[34%] rounded-[2px] bg-current opacity-80" />
        </span>
      ) : (
        <span className="relative block size-full">
          <span className={cn("absolute inset-0", cell)} />
          <span className="absolute top-[3px] right-[3px] h-[38%] w-[34%] rounded-[2px] bg-current opacity-80" />
        </span>
      )}
    </span>
  );
}

/**
 * Chart + face's market: the usual ones a tap away, any other pair typed
 * ("ADA-USD"), and the candle size. Changes go straight to the room.
 */
export function MarketPicker({ chart, onChart }: { chart: SceneChart; onChart: (chart: SceneChart) => void }) {
  const [draft, setDraft] = useState("");
  const typed = draft.trim().toUpperCase();
  const valid = /^[A-Z0-9]{2,10}-[A-Z]{3,4}$/.test(typed);
  return (
    <div className="mt-3 rounded-[12px] bg-white/[0.04] p-3">
      <p className="text-[12.5px] font-semibold">Market</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {CHART_MARKETS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={chart.symbol === m}
            onClick={() => chart.symbol !== m && onChart({ ...chart, symbol: m })}
            className={cn(
              "press h-8 rounded-full px-3 font-mono text-[11.5px] font-semibold transition-colors",
              chart.symbol === m ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
            )}
          >
            {m.replace("-", "/")}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onChart({ ...chart, symbol: typed });
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={CHART_MARKETS.includes(chart.symbol as (typeof CHART_MARKETS)[number]) ? "Another pair, like ADA-USD" : chart.symbol}
          aria-label="Another market"
          maxLength={15}
          className="h-9 min-w-0 flex-1 rounded-full bg-white/[0.06] px-3.5 font-mono text-[12.5px] text-foreground uppercase outline-none placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground focus:bg-white/[0.09]"
        />
        <button
          type="submit"
          disabled={!valid}
          className="press h-9 shrink-0 rounded-full bg-white px-3.5 text-[12px] font-bold text-[#0b0708] disabled:opacity-40"
        >
          Chart it
        </button>
      </form>
      <div role="radiogroup" aria-label="Candle size" className="mt-3 flex items-center gap-1.5">
        <span className="mr-1 text-[12px] text-muted-foreground">Candles</span>
        {(Object.keys(CHART_INTERVAL_LABELS) as ChartInterval[]).map((iv) => (
          <button
            key={iv}
            type="button"
            role="radio"
            aria-checked={chart.interval === iv}
            onClick={() => chart.interval !== iv && onChart({ ...chart, interval: iv })}
            className={cn(
              "press h-7 rounded-full px-2.5 font-mono text-[11.5px] font-semibold transition-colors",
              chart.interval === iv ? "bg-white text-[#0b0708]" : "bg-white/[0.06] text-foreground/85 hover:bg-white/[0.1]"
            )}
          >
            {CHART_INTERVAL_LABELS[iv]}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The picture's framing — layout, who's beside the host, the chart's market —
 * and the full-screen cards, in the Scenes panel of the studio and of a
 * producer's console alike.
 */
export function LayoutAndCards({
  scene,
  battle,
  guests,
  cardNote,
  onCardNote,
  onScene,
  crew = false,
}: {
  scene: Scene;
  /** A battle keeps its split until it ends. */
  battle: boolean;
  /** Guests on stage, for "Beside you". */
  guests: { identity: string; name: string }[];
  cardNote: string;
  onCardNote: (note: string) => void;
  onScene: (patch: Partial<Pick<Scene, "layout" | "card" | "cardNote" | "chart" | "spotlight">>) => void;
  /** A producer's console: the words are about the host. */
  crew?: boolean;
}) {
  const hint = (layout: SceneLayout) => (crew ? CREW_HINTS[layout] : LAYOUTS.find((l) => l.id === layout)?.hint);
  return (
    <>
      <section aria-labelledby="scenes-layout">
        <p id="scenes-layout" className={LABEL}>
          Layout
        </p>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {LAYOUTS.map((l) => {
            const on = scene.layout === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onScene(l.id === "chart-face" && !scene.chart ? { layout: l.id, chart: DEFAULT_CHART } : { layout: l.id })}
                aria-pressed={on}
                title={hint(l.id)}
                className={cn(
                  "press flex flex-col items-stretch gap-2 rounded-[12px] p-2 text-[12px] font-semibold transition-colors",
                  on ? "bg-white text-[#0b0708]" : "bg-white/[0.05] text-foreground/85 hover:bg-white/[0.08]"
                )}
              >
                <LayoutThumb layout={l.id} />
                <span className="truncate text-center">{l.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
          {hint(scene.layout)}. {battle ? "A battle keeps its split until it ends." : "Viewers see the change at once."}
        </p>
        {scene.layout === "chart-face" && <MarketPicker chart={scene.chart ?? DEFAULT_CHART} onChart={(chart) => onScene({ chart })} />}
        {(scene.layout === "split" || scene.layout === "trio") && guests.length > 1 && !battle && (
          <BesideYou
            guests={guests}
            spotlight={scene.spotlight ?? null}
            onPick={(identity) => onScene({ spotlight: identity })}
            label={crew ? "Beside the host" : "Beside you"}
          />
        )}
      </section>

      <section aria-labelledby="scenes-cards">
        <p id="scenes-cards" className={LABEL}>
          Cards
        </p>
        <div className="mt-2.5 flex flex-col gap-2">
          {CARDS.map((c) => {
            const on = scene.card === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onScene({ card: on ? null : c.id, cardNote: cardNote.trim() })}
                aria-pressed={on}
                className={cn(
                  "press flex items-center justify-between gap-3 rounded-[12px] px-3.5 py-3 text-left transition-colors",
                  on ? "bg-ember text-on-ember" : "bg-white/[0.05] text-foreground hover:bg-white/[0.08]"
                )}
              >
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{c.title}</span>
                  <span className={cn("mt-0.5 block text-[12px] leading-snug", on ? "text-on-ember/75" : "text-muted-foreground")}>
                    {on ? "On screen now — tap to take it down" : c.body}
                  </span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", on ? "bg-on-ember/[0.14]" : "bg-white/[0.08]")}>
                  {on ? "Showing" : "Show"}
                </span>
              </button>
            );
          })}
        </div>
        <label className="mt-3 block">
          <span className="sr-only">A line under the card</span>
          <input
            value={cardNote}
            onChange={(e) => onCardNote(e.target.value)}
            onBlur={() => {
              // A card already up takes the new line.
              if (scene.card && cardNote.trim() !== scene.cardNote) onScene({ cardNote: cardNote.trim() });
            }}
            maxLength={80}
            placeholder="Add a line under the card (optional)"
            className="h-10 w-full rounded-full bg-white/[0.06] px-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:bg-white/[0.09]"
          />
        </label>
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">A card covers the picture; the room still hears the host.</p>
      </section>
    </>
  );
}
