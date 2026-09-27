"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CaretLeft, CaretRight } from "@/components/icons";
import { useSiraVivid } from "@/components/vivid/sira-provider";
import { cn } from "@/lib/utils";
import { VividOrb } from "./vivid-orb";
import { BoxPattern } from "./box-pattern";
import { LoopClip } from "./loop-clip";
import { startDots } from "./vivid-dots";
import { ChapterTitle, Eyebrow, GUTTER, INK_MUTED, SECTION_Y, delay } from "./story-ui";
import styles from "./landing.module.css";
import explore from "./vivid-explore.module.css";

/**
 * Chapter 06: Vivid, WorldStreet's assistant, wearing its own dot sphere
 * (the worldwork section's layout: the orb in a soft square, the pitch
 * beside it), then a row of cards that slides, each a loop of Vivid doing one
 * real thing on Xtream (lib/vivid-functions.ts: sendGift, studioControl,
 * sceneControl + startPrediction by voice, openStream), ending on a card of
 * words that resolves into a button. Every button starts an actual session,
 * the same one as the top bar's launcher, with its sign-in hand-off and the
 * live capsule.
 *
 * Dark again (owner, 2026-09-27), with the last card the one white thing in
 * it: the loops are painted on their card's own tile (white 4% over the
 * ground), so a video has no edge of its own, and the end card's dots come
 * together into Vivid's name.
 */
const CARDS = [
  {
    loop: "vivid-card",
    hidden: true, // owner, 2026-09-27: hidden for now
    eyebrow: "Send a gift",
    title: "Ask once. Vivid does it.",
    note: "It says the price out loud and only sends on a clear yes.",
    label: "Someone asks Vivid to send Satoshi a rocket. Vivid says the price, gets a yes, and sends it.",
  },
  {
    loop: "vivid-golive",
    eyebrow: "Go live",
    title: "It sets up. You say yes.",
    note: "Vivid asks what it needs, opens the Studio and waits for your yes before you're on air.",
    label: "Someone asks Vivid to take them live. Vivid asks the show's name, opens the Studio, and presses Go live after a yes.",
  },
  {
    loop: "vivid-voice",
    eyebrow: "Just say it",
    title: "Hold, talk, let go.",
    note: "No typing at all. On air, hold V and Vivid runs the chart, the graphics and the games for you.",
    label: "Someone holds the mic and says switch to SOL and start a prediction. Vivid answers out loud, flips the chart to SOL and opens a prediction.",
  },
  {
    loop: "vivid-find",
    hidden: true, // owner, 2026-09-27: hidden for now
    eyebrow: "Find the room",
    title: "Say what you want to watch.",
    note: "Vivid finds the live stream and takes you straight in.",
    label: "Someone asks who's watching Arsenal tonight. Vivid finds the live watch-along and opens it.",
  },
];

const CARD = "w-[min(30rem,84vw)] shrink-0 snap-start rounded-[2.5rem]";
const INK_BUTTON = "press flex items-center gap-3 rounded-full bg-[#0b0708] text-white transition-colors hover:bg-[#2a2021] disabled:opacity-50";

/** The WorldSpace appended-words build (notebook M05). */
const WORDS = ["Explore", "more", "with"];
const WORD_EVERY = 340;
const STANDARD = "cubic-bezier(0.2, 0, 0, 1)";
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * "Explore more with Vivid" (owner, 2026-09-27). Ink dots drift all round
 * the card. The line builds a word at a time on the WorldSpace timing
 * (Explore → Explore more → Explore more with), then the dots leave their
 * places and fly, letter by letter, into "Vivid" (vivid-dots.ts): the word
 * is made of the card's own dots, in one colour. The phrase folds away, the
 * dotted word glides up, and a button rises in under it. It plays the first
 * time the card is mostly on screen; the finished card, with the word set in
 * type, is what the server paints and what reduced motion sees.
 */
function ExploreCard({ onAsk, disabled, live }: { onAsk: () => void; disabled: boolean; live: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  const lineRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<"idle" | "in" | "done" | "still" | undefined>(undefined);

  useEffect(() => {
    const el = ref.current;
    const canvas = canvasRef.current;
    const word = wordRef.current;
    const line = lineRef.current;
    if (!el || !canvas || !word || !line) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => setState(reduced ? "still" : "idle"));
    if (reduced) return () => cancelAnimationFrame(frame);

    const words = [...line.children] as HTMLElement[];
    words.forEach((w) => (w.style.display = "none"));
    // Add word k; the ones already there slide to their new places (FLIP).
    const reveal = (k: number) => {
      const shown = words.slice(0, k);
      const before = shown.map((w) => w.getBoundingClientRect().left);
      words[k].style.display = "";
      shown.forEach((w, i) => {
        const dx = before[i] - w.getBoundingClientRect().left;
        if (dx) w.animate([{ transform: `translateX(${dx}px)` }, { transform: "none" }], { duration: 320, easing: STANDARD });
      });
      words[k].animate([{ opacity: 0, transform: "translateY(0.25em)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: OUT });
    };

    const dots = startDots(canvas, el, word);
    const timers: number[] = [];
    // Draw only while any of the card is on screen.
    const seen = new IntersectionObserver(([e]) => dots.play(!!e?.isIntersecting));
    seen.observe(el);
    // Play the story once, when most of the card is in view.
    const cue = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        cue.disconnect();
        setState("in");
        WORDS.forEach((_, k) => timers.push(window.setTimeout(() => reveal(k), k * WORD_EVERY)));
        // The field takes off once the line is built.
        dots.converge(((WORDS.length - 1) * WORD_EVERY + 260) / 1000);
        timers.push(window.setTimeout(() => setState("done"), 2500));
      },
      { threshold: 0.6 },
    );
    cue.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((t) => window.clearTimeout(t));
      words.forEach((w) => (w.style.display = ""));
      seen.disconnect();
      cue.disconnect();
      dots.stop();
    };
  }, []);

  return (
    <article ref={ref} data-state={state} aria-labelledby="vivid-explore" className={cn(CARD, explore.card, "min-h-[30rem] bg-white p-8 text-[#0b0708]")}>
      <h3 id="vivid-explore" className="sr-only">
        Explore more with Vivid
      </h3>
      <canvas ref={canvasRef} className={explore.dots} aria-hidden />
      <div className={explore.stack}>
        <div className={explore.phrase} aria-hidden>
          <div className={cn(explore.phraseInner, "font-wide text-[clamp(1.35rem,2.3vw,2rem)] leading-[1.1] font-bold tracking-[-0.04em]")}>
            <span ref={lineRef} className={explore.line}>
              {WORDS.map((w) => (
                <span key={w}>{w}</span>
              ))}
            </span>
          </div>
        </div>
        <span ref={wordRef} aria-hidden className={cn(explore.vivid, "font-wide text-[clamp(3.25rem,6vw,5rem)] leading-[1.02] font-bold tracking-[-0.045em]")}>
          Vivid
        </span>
        <div className={explore.cta}>
          <div className={explore.ctaInner}>
            <button type="button" onClick={onAsk} disabled={disabled} className={cn(INK_BUTTON, "h-14 pr-6 pl-2 text-[16px] font-semibold")}>
              <span className="size-10 overflow-hidden rounded-full bg-[#0b0708]">
                <VividOrb />
              </span>
              {live ? "Vivid is listening" : "Ask Vivid"}
              <ArrowRight size={16} weight="bold" />
            </button>
            <span className={cn("text-[14px]", INK_MUTED)}>Type it or say it. It waits for your yes.</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function ChapterVivid() {
  const vivid = useSiraVivid();
  const wordRef = useRef<HTMLSpanElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const live = vivid ? vivid.state !== "idle" && vivid.state !== "error" : false;

  const ask = useCallback(async () => {
    if (!vivid || live) return;
    if (!vivid.isConnected) await vivid.startSession?.();
  }, [vivid, live]);

  // The arrows page one card at a time; they grey out at either end.
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const start = row.scrollLeft <= 4;
    const end = row.scrollLeft + row.clientWidth >= row.scrollWidth - 4;
    setEdge((e) => (e.start === start && e.end === end ? e : { start, end }));
  }, []);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const frame = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [measure]);
  const page = (dir: 1 | -1) => {
    const row = rowRef.current;
    const card = row?.firstElementChild as HTMLElement | null;
    if (!row || !card) return;
    row.scrollBy({ left: dir * (card.offsetWidth + 20), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  return (
    <section id="vivid" aria-labelledby="vivid-title" className={cn("relative isolate scroll-mt-16 overflow-hidden bg-ground", SECTION_Y)}>
      <BoxPattern theme="spectrum" corner="br" />
      <div className={cn("mx-auto flex max-w-[90rem] flex-col gap-16", GUTTER)}>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,37.5rem)_1fr] lg:gap-20">
          <div data-reveal="window" data-from="left" className="aspect-square w-full rounded-[2.5rem] bg-white/[0.04] p-6 sm:p-8">
            <VividOrb onColor={(k) => wordRef.current?.style.setProperty("--vivid-k", k.toFixed(3))} />
          </div>

          <div className="flex flex-col items-start gap-8">
            <Eyebrow>06 / Just ask Vivid</Eyebrow>
            <ChapterTitle
              id="vivid-title"
              className="text-[clamp(2.75rem,5.6vw,5rem)] leading-[0.98]"
              lines={[
                "Say the word.",
                <span key="vivid" ref={wordRef} className={styles.vividWord}>
                  Vivid
                </span>,
                "runs the room.",
              ]}
            />
            <p data-reveal="up" style={delay(250)} className="max-w-[36rem] text-[18px] leading-[1.55] text-muted-foreground">
              Vivid is the assistant that lives across WorldStreet, and on Xtream it can drive. It reads the page you&apos;re on, finds
              streams, chats and reacts for you, sends gifts and runs the Studio. Anything that spends money or puts you on air waits for a
              clear, spoken yes.
            </p>
            <button
              type="button"
              onClick={ask}
              disabled={!vivid}
              data-reveal="up"
              style={delay(380)}
              className="press flex h-14 items-center gap-3 rounded-full bg-control pr-7 pl-2 text-[16px] font-semibold transition-colors hover:bg-control-hover disabled:opacity-50"
            >
              <span className="size-10 overflow-hidden rounded-full bg-ground">
                <VividOrb />
              </span>
              {live ? "Vivid is listening" : "Ask Vivid"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div data-reveal="up" className="flex items-end justify-between gap-6">
            <span className="caps font-mono text-[12px] text-muted-foreground">Watch Vivid work</span>
            <div className="flex gap-2">
              {([-1, 1] as const).map((dir) => (
                <button
                  key={dir}
                  type="button"
                  aria-label={dir < 0 ? "Previous card" : "Next card"}
                  aria-controls="vivid-row"
                  disabled={dir < 0 ? edge.start : edge.end}
                  onClick={() => page(dir)}
                  className="press grid size-12 place-items-center rounded-full bg-white text-[#0b0708] transition-opacity hover:bg-white/85 disabled:pointer-events-none disabled:opacity-25"
                >
                  {dir < 0 ? <CaretLeft size={18} weight="bold" /> : <CaretRight size={18} weight="bold" />}
                </button>
              ))}
            </div>
          </div>

          {/* The row runs to the page's edges and snaps a card to the gutter.
              Each loop is painted on its card's own tile (Motion Design
              Ideas, loops/vivid-*), so the video has no edge of its own. */}
          <div
            id="vivid-row"
            ref={rowRef}
            onScroll={measure}
            className="-mx-5 flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 py-1 pb-2 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:-mx-20 lg:scroll-px-20 lg:px-20 [&::-webkit-scrollbar]:hidden"
          >
            {CARDS.filter((c) => !("hidden" in c && c.hidden)).map((c) => (
              <article key={c.loop} data-hover-play className={cn(CARD, "flex flex-col overflow-hidden bg-white/[0.04]")}>
                <LoopClip name={c.loop} label={c.label} play="hover" />
                <div className="flex flex-col gap-2 p-6 pt-2 sm:p-8 sm:pt-2">
                  <span className="caps font-mono text-[11px] text-muted-foreground">{c.eyebrow}</span>
                  <span className="text-[22px] leading-snug font-semibold text-balance">{c.title}</span>
                  <p className="text-[14px] leading-[1.5] text-muted-foreground">{c.note}</p>
                </div>
              </article>
            ))}
            <ExploreCard onAsk={ask} disabled={!vivid} live={live} />
          </div>
        </div>
      </div>
    </section>
  );
}
