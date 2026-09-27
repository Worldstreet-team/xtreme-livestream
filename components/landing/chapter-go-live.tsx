import Image from "next/image";
import { Eye, Microphone, MonitorArrowUp, Ticket, VideoCamera, GearIcon, Question } from "@/components/icons";
import { cn } from "@/lib/utils";
import { BoxPattern } from "./box-pattern";
import { LoopClip } from "./loop-clip";
import { ChapterHead, GUTTER, Illustration } from "./story-ui";

/**
 * Chapter 01: the Studio, drawn in its own grammar: the tally, the clock,
 * Chart + face with the camera in the corner, the scene switcher, and the
 * Games tab mid-prediction. The candles are a fixed random walk, so the
 * picture is the same on every render (and on the server).
 */
function candles(count: number, seed = 7) {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  let p = 58;
  return Array.from({ length: count }, () => {
    const open = p;
    const close = Math.max(10, Math.min(90, open + (rnd() - 0.42) * 12));
    const high = Math.max(open, close) + rnd() * 4;
    const low = Math.min(open, close) - rnd() * 4;
    p = close;
    return { open, close, high, low };
  });
}

const CANDLES = candles(58);

function CandleChart() {
  const W = 1000;
  const H = 440;
  const step = W / CANDLES.length;
  const y = (v: number) => H - (v / 100) * H;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full">
      {CANDLES.map((c, i) => {
        const up = c.close >= c.open;
        const x = i * step + step / 2;
        const color = up ? "var(--success)" : "var(--chili-hi)";
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <rect
              x={x - step * 0.34}
              width={step * 0.68}
              y={y(Math.max(c.open, c.close))}
              height={Math.max(2, Math.abs(y(c.open) - y(c.close)))}
              rx={1}
              fill={color}
            />
          </g>
        );
      })}
    </svg>
  );
}

const onPicture = "rounded-full bg-black/55 px-2.5 py-1 text-[12px]";

function StudioPicture() {
  return (
    <div className="relative flex min-h-[26rem] flex-1 flex-col gap-4 overflow-hidden rounded-sm bg-[#0e0a0b] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-chili px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] text-white">
            <span className="size-1.5 rounded-full bg-white" />
            LIVE
          </span>
          <span className={cn(onPicture, "font-mono tabular-nums")}>01:24:07</span>
          <span className={cn(onPicture, "hidden items-center gap-1.5 font-mono tabular-nums sm:inline-flex")}>
            <Eye size={13} /> 11,482
          </span>
        </div>
        <span className={cn(onPicture, "hidden gap-2 font-mono tabular-nums md:flex")}>
          <span className="text-muted-foreground">BTC / USD · 15s</span>
          <span className="font-semibold">90,412.08</span>
          <span className="font-semibold text-success">+2.41%</span>
        </span>
      </div>

      <div className="relative min-h-0 flex-1 pr-[18%]">
        <CandleChart />
      </div>

      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-3 rounded-panel bg-black/55 py-2 pr-4 pl-2">
          <span className="rounded-full bg-heat p-[2px]">
            <Image src="/images/stage/p-streamer.webp" alt="" width={36} height={36} className="size-9 rounded-full object-cover" />
          </span>
          <span className="min-w-0">
            <span className="block text-[14px] font-bold">Satoshi</span>
            <span className="block truncate text-[13px] text-foreground/70">BTC reclaiming 90k, live desk, open Q&amp;A</span>
          </span>
        </div>
        <div className="relative hidden aspect-video w-[27%] shrink-0 overflow-hidden rounded-sm ring-1 ring-white/20 sm:block">
          <Image src="/images/stage/streamer.webp" alt="" fill sizes="240px" className="object-cover" />
        </div>
      </div>
    </div>
  );
}

function ControlBar() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex flex-wrap gap-1.5">
        {["Chart + face", "Camera", "Screen", "Be right back"].map((scene, i) => (
          <span
            key={scene}
            className={cn(
              "rounded-full px-4 py-2 text-[13px] font-semibold",
              i === 0 ? "bg-white text-[#0b0708]" : "bg-control text-foreground",
            )}
          >
            {scene}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        {[Microphone, VideoCamera, MonitorArrowUp, GearIcon].map((Icon, i) => (
          <span key={i} className="flex size-10 items-center justify-center rounded-full bg-control">
            <Icon size={17} />
          </span>
        ))}
        <span className="rounded-full bg-chili/15 px-4 py-2.5 text-[13px] font-semibold text-chili-hi">End stream</span>
      </div>
    </div>
  );
}

function GamesPanel() {
  return (
    <div className="flex w-full flex-col gap-4 rounded-sm bg-surface-raised p-4 lg:w-[22.5rem]">
      <div className="flex rounded-full bg-control p-1">
        {["Chat", "Games", "Graphics"].map((tab) => (
          <span
            key={tab}
            className={cn(
              "flex-1 rounded-full py-2 text-center text-[13px] font-semibold",
              tab === "Games" ? "bg-white text-[#0b0708]" : "text-muted-foreground",
            )}
          >
            {tab}
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-3.5 rounded-sm bg-surface p-4">
        <div className="flex items-center justify-between">
          <span className="caps font-mono text-[11px] text-ember-hi">Prediction · open</span>
          <span className="font-mono text-[12px] text-muted-foreground tabular-nums">04:12</span>
        </div>
        <p className="text-[18px] leading-snug font-semibold">Does BTC close above 91k tonight?</p>
        {[
          ["Yes, send it", 68, true],
          ["No, it rejects", 32, false],
        ].map(([label, pct, lead]) => (
          <div key={label as string} className="flex flex-col gap-2">
            <div className="flex justify-between text-[14px]">
              <span className="font-medium">{label}</span>
              <span className={cn("font-mono text-[13px]", lead ? "text-ember-hi" : "text-muted-foreground")}>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-control">
              <div className={cn("h-full rounded-full", lead ? "bg-ember" : "bg-foreground/35")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
        <div className="flex justify-between border-t border-hairline pt-3 text-[13px]">
          <span className="text-muted-foreground">Pool</span>
          <span className="font-mono tabular-nums">18,400 pts · 612 in</span>
        </div>
        <div className="flex gap-2">
          <span className="flex-1 rounded-full bg-white py-2.5 text-center text-[13px] font-semibold text-[#0b0708]">Settle</span>
          <span className="flex-1 rounded-full bg-control py-2.5 text-center text-[13px] font-semibold">Cancel &amp; refund</span>
        </div>
      </div>

      <p className="caps font-mono text-[11px] text-muted-foreground">Also ready</p>
      {[
        [Ticket, "Raffle", "Draw a winner from the room"],
        [Question, "Quiz", "Reveals itself on the clock"],
      ].map(([Icon, title, sub]) => {
        const Glyph = Icon as typeof Ticket;
        return (
          <div key={title as string} className="flex items-center gap-3 rounded-sm bg-surface p-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-control">
              <Glyph size={16} />
            </span>
            <span>
              <span className="block text-[14px] font-semibold">{title as string}</span>
              <span className="block text-[13px] text-muted-foreground">{sub as string}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ChapterGoLive() {
  return (
    <section
      id="go-live"
      aria-labelledby="go-live-title"
      className="relative isolate scroll-mt-16 overflow-hidden bg-ground pt-24 sm:pt-32 lg:pt-40"
    >
      <BoxPattern theme="monitors" corner="tl" />
      <div className={cn("mx-auto flex max-w-[90rem] flex-col gap-16 lg:gap-20", GUTTER)}>
        <ChapterHead
          id="go-live"
          eyebrow="01 / Go live"
          title={["You're one minute", "from being on air."]}
          body="Camera, screen or your OBS rig. Your followers hear about it the second you start, and the studio gives you the scoreboard, the games and the chart to run the room."
        />

        {/* The film (Motion Design Ideas, films/live-minute): Your channel →
            Go live → the composer → live, Chart + face, Games, on a loop. It
            ends on the picture below, which is what reduced motion gets.
            On desktop it plays in a browser window, the same bezel and bar
            as the 03/04 screens but no rail (the film has the app's own);
            below lg it stands on its own, pending a phone direction.
            Either way it runs out through the section's foot, cut by the
            section itself (owner, 2026-09-27), like the 02–04 screens. */}
        <div className="-mb-12 sm:-mb-20 lg:-mb-36">
          <div
            data-reveal="window"
            data-from="up"
            className="rounded-panel bg-ground ring-1 ring-hairline motion-reduce:hidden lg:rounded-[30px] lg:bg-[#1c1617] lg:p-3 lg:ring-white/10"
          >
            <div className="overflow-hidden rounded-panel lg:rounded-[18px]">
              <div aria-hidden className="hidden h-11 items-center gap-4 border-b border-hairline bg-[#1c1617] px-4 lg:flex">
                <span className="flex gap-1.5">
                  <span className="size-3 rounded-full bg-[#ff5f57]" />
                  <span className="size-3 rounded-full bg-[#febc2e]" />
                  <span className="size-3 rounded-full bg-[#28c840]" />
                </span>
                <span className="mx-auto rounded-full bg-white/[0.06] px-4 py-1 font-mono text-[12px] text-muted-foreground">
                  xtream.worldstreetgold.com/studio
                </span>
                <span className="w-[52px]" />
              </div>
              <LoopClip
                name="live-minute"
                label="Going live on Xtream in under a minute: from Your channel, Go live opens the Studio; a title and a category, then Go live, and the stream is on air with the chart, the camera in the corner and a prediction open."
              />
            </div>
          </div>

          <Illustration
            label="The Xtream studio: a live market chart with the host's camera in the corner, scene buttons, and a prediction game open in the side panel."
            className="hidden flex-col gap-3 rounded-panel bg-surface p-3 ring-1 ring-hairline motion-reduce:flex lg:motion-reduce:flex-row"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <StudioPicture />
              <ControlBar />
            </div>
            <GamesPanel />
          </Illustration>
        </div>
      </div>
    </section>
  );
}
