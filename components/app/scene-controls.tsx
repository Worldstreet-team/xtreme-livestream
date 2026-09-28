"use client";

import { useState } from "react";
import { BesideYou } from "@/components/app/director-switch";
import { PHONE_SLOT_CHOICES, phoneOnScreen, placePhone } from "@/lib/angles";
import {
  CARDS,
  CHART_INTERVAL_LABELS,
  CHART_MARKETS,
  DEFAULT_CHART,
  LAYOUTS,
  type ChartInterval,
  type PhoneSlot,
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

/**
 * A layout drawn small: where the people go, the way the scene will place
 * them — and, with a phone placed (`phone`), where the phone lands, in
 * ember with a phone's outline, read the same way the program reads it
 * (lib/angles.ts `placePhone`).
 */
export function LayoutThumb({ layout, phone = "off" }: { layout: SceneLayout; phone?: PhoneSlot }) {
  const place = placePhone(phone, layout);
  const cell = "rounded-[3px] bg-current opacity-35";
  // The corner: the phone when it's placed there, the host's face otherwise.
  const corner = (onPhone: boolean) =>
    onPhone ? (
      <PhoneMark className="absolute top-[3px] right-[3px] h-[38%] w-[34%] rounded-[2px]" />
    ) : (
      <span className="absolute top-[3px] right-[3px] h-[38%] w-[34%] rounded-[2px] bg-current opacity-80" />
    );
  // The host's own tile, or the phone over it; and the first seat beside the host, or the phone in it.
  const host = (className?: string) => (place.cell ? <PhoneMark className={cn("rounded-[3px]", className)} /> : <span className={cn("block", cell, className)} />);
  const seat = () => (place.beside ? <PhoneMark className="rounded-[3px]" /> : <span className={cell} />);
  return (
    <span aria-hidden className="relative block aspect-video w-full overflow-hidden rounded-[6px] bg-current/[0.08] p-[3px]">
      {layout === "auto" ? (
        phone === "off" ? (
          <span className="flex size-full items-center justify-center font-mono text-[10px] font-bold opacity-70">AUTO</span>
        ) : (
          // Auto with the phone in: whoever's on, as it'd be with just the two of you.
          <span className="relative block size-full">
            <span className={cn("grid size-full gap-[3px]", place.beside && "grid-cols-2")}>
              {host()}
              {place.beside && seat()}
            </span>
            {place.corner && corner(true)}
            <span className="absolute bottom-[3px] left-[4px] font-mono text-[7px] leading-none font-bold opacity-70">AUTO</span>
          </span>
        )
      ) : layout === "solo" ? (
        host("size-full")
      ) : layout === "split" ? (
        <span className="grid size-full grid-cols-2 gap-[3px]">
          {host()}
          {seat()}
        </span>
      ) : layout === "trio" ? (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-[3px]">
          {host("row-span-2")}
          {seat()}
          <span className={cell} />
        </span>
      ) : layout === "grid" ? (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-[3px]">
          {host()}
          {seat()}
          <span className={cell} />
          <span className={cell} />
        </span>
      ) : layout === "chart-face" ? (
        // A little rising chart, the face in the corner.
        <span className="relative block size-full">
          <svg viewBox="0 0 40 22" preserveAspectRatio="none" className="absolute inset-0 size-full opacity-60">
            <polyline points="1,18 8,15 14,16 20,10 26,12 32,6 39,8" fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
          {corner(place.corner)}
        </span>
      ) : (
        <span className="relative block size-full">
          {host("absolute inset-0")}
          {corner(place.corner)}
        </span>
      )}
    </span>
  );
}

/** The phone in a thumb: an ember tile with a phone's outline, so it reads without the colour too. */
function PhoneMark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center justify-center bg-ember text-on-ember", className)}>
      <span className="aspect-[9/16] h-[58%] max-h-[13px] min-h-[5px] rounded-[1.5px] border-[1.25px] border-current" />
    </span>
  );
}

/**
 * The phone as a source in the Scenes panel: where it sits — off, over
 * your picture, beside you, or in the corner — whatever the layout. The
 * thumbs above show where it lands in each.
 */
export function PhoneSlotRow({
  slot,
  layout,
  onSlot,
  crew = false,
}: {
  slot: PhoneSlot;
  layout: SceneLayout;
  onSlot: (slot: PhoneSlot) => void;
  crew?: boolean;
}) {
  const hidden = slot !== "off" && !phoneOnScreen(slot, layout);
  const layoutLabel = LAYOUTS.find((l) => l.id === layout)?.label ?? layout;
  const your = crew ? "the host's" : "your";
  const face = layout === "screen-face" || layout === "chart-face";
  // What the placement does in this layout, in a line.
  const line = hidden
    ? `${layoutLabel} has no room for it ${slot === "beside" ? `beside ${crew ? "the host" : "you"}` : "there"} — the ember tile in each layout shows where it lands.`
    : slot === "off"
      ? "Not in the picture."
      : slot === "beside"
        ? `A tile of its own beside ${crew ? "the host" : "you"}, like a guest.`
        : slot === "corner" || layout === "chart-face"
          ? face
            ? `The phone is ${your} face in the corner.`
            : `Small, in the corner over ${your} picture.`
          : layout === "screen-face"
            ? `The phone takes ${your} picture; ${your} camera goes in the corner.`
            : `The phone takes ${your} picture.`;
  return (
    <div className="mt-3 rounded-[12px] bg-tint/[0.04] p-3">
      <p id="scenes-phone" className="flex items-center justify-between gap-2 text-[12.5px] font-semibold">
        Phone
        <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-chili" />
          Sending
        </span>
      </p>
      <div role="radiogroup" aria-labelledby="scenes-phone" className="mt-2 grid grid-cols-4 gap-1.5">
        {PHONE_SLOT_CHOICES.map((c) => {
          const on = slot === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={c.hint}
              onClick={() => !on && onSlot(c.id)}
              className={cn(
                "press h-8 rounded-full px-2 text-[12px] font-semibold transition-colors",
                on ? "bg-inverse text-on-inverse" : "bg-tint/[0.06] text-foreground/85 hover:bg-tint/[0.1]"
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{line}</p>
    </div>
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
  markets = true,
  phone = false,
}: {
  scene: Scene;
  /** A battle keeps its split until it ends. */
  battle: boolean;
  /** Chart + face among the layouts. Off, it's left out unless it's the one on air. */
  markets?: boolean;
  /** Guests on stage, for "Beside you". */
  guests: { identity: string; name: string }[];
  cardNote: string;
  onCardNote: (note: string) => void;
  onScene: (patch: Partial<Pick<Scene, "layout" | "card" | "cardNote" | "chart" | "spotlight" | "phoneSlot">>) => void;
  /** A producer's console: the words are about the host. */
  crew?: boolean;
  /** The host's phone cam is sending: it's a source to place, and the thumbs show where it lands. */
  phone?: boolean;
}) {
  const hint = (layout: SceneLayout) => (crew ? CREW_HINTS[layout] : LAYOUTS.find((l) => l.id === layout)?.hint);
  const phoneSlot: PhoneSlot = phone ? (scene.phoneSlot ?? "off") : "off";
  return (
    <>
      <section aria-labelledby="scenes-layout">
        <p id="scenes-layout" className={LABEL}>
          Layout
        </p>
        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {LAYOUTS.filter((l) => markets || l.id !== "chart-face" || scene.layout === "chart-face").map((l) => {
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
                <LayoutThumb layout={l.id} phone={phoneSlot} />
                <span className="truncate text-center">{l.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 text-[12px] leading-snug text-muted-foreground">
          {hint(scene.layout)}. {battle ? "A battle keeps its split until it ends." : "Viewers see the change at once."}
        </p>
        {phone && <PhoneSlotRow slot={phoneSlot} layout={scene.layout} onSlot={(slot) => onScene({ phoneSlot: slot })} crew={crew} />}
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
