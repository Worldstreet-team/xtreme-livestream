import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A section's corner art: a few fine lines drawn from the section's own
 * subject, tucked into one corner and fading toward the middle so it never
 * sits under the words. It replaced a field of boxes (owner, 2026-09-27:
 * "remove those boxes in the backgrounds, i want some arts there too,
 * minimal but artistic").
 *
 *  - tiles      broadcast arcs spreading from the corner (the manifesto)
 *  - monitors   a lens: rings, a hairline cross, the tally light (the studio)
 *  - battle     two sweeps meeting at a seam, a spark where they touch
 *  - ledger     a climbing price line over faint rules, gold at its head
 *  - steps      the podium in one continuous line, a crown over the top step
 *  - streak     a dotted orbit with the days lit along it (rewards)
 *  - feed       three overlapping circles, one WorldSpace dot (WorldSpace)
 *  - spectrum   stacked sound lines in Vivid's hues
 *
 * Each line draws itself once as the section arrives (`data-reveal="art"`,
 * scroll-stage.css), then holds still: no loops, so it costs nothing after.
 * Without the motion (reduced motion, `?static`) the art is simply there.
 * The section needs `relative isolate overflow-hidden`.
 */
export type BoxTheme = "tiles" | "monitors" | "battle" | "ledger" | "steps" | "streak" | "feed" | "spectrum";

const SIZE = 720;

/** Ink on paper, bone on the dark grounds. */
const INK = "rgba(11,7,8,0.16)";
const INK_SOFT = "rgba(11,7,8,0.09)";
const BONE = "rgba(255,236,230,0.16)";
const BONE_SOFT = "rgba(255,236,230,0.08)";
const EMBER = "rgba(194,65,12,0.55)";
const CHILI = "#e3122a";
const GOLD = "rgba(234,179,8,0.7)";
const CYAN = "#22c3e6";

/** One drawn stroke: it knows its place in the sequence so they draw in turn. */
function Line({ i, ...props }: { i: number } & React.SVGProps<SVGPathElement>) {
  return <path pathLength={1} className="lm-draw" style={{ "--i": i } as CSSProperties} fill="none" vectorEffect="non-scaling-stroke" strokeLinecap="round" {...props} />;
}

function arc(r: number, from = 0, to = 90) {
  const a = (d: number) => (d * Math.PI) / 180;
  const x0 = r * Math.cos(a(from));
  const y0 = r * Math.sin(a(from));
  const x1 = r * Math.cos(a(to));
  const y1 = r * Math.sin(a(to));
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function circle(cx: number, cy: number, r: number) {
  return `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx + r} ${cy}`;
}

/** A soft sine across the field, for Vivid's sound lines. */
function wave(y: number, amp: number, len: number, phase: number) {
  let d = `M 0 ${y}`;
  for (let x = 0; x <= SIZE; x += 12) d += ` L ${x} ${(y + Math.sin(x / len + phase) * amp * (1 - x / SIZE)).toFixed(1)}`;
  return d;
}

function art(theme: BoxTheme): ReactNode {
  switch (theme) {
    case "tiles":
      return (
        <>
          {[150, 260, 370, 480, 590].map((r, i) => (
            <Line key={r} i={i} d={arc(r, 4, 86)} stroke={i === 1 ? EMBER : INK} strokeWidth={i === 1 ? 1.6 : 1.1} />
          ))}
          <circle cx={0} cy={0} r={34} fill={EMBER} opacity={0.5} />
        </>
      );
    case "monitors":
      return (
        <>
          {[70, 150, 230].map((r, i) => (
            <Line key={r} i={i} d={circle(250, 250, r)} stroke={i === 0 ? BONE : BONE_SOFT} strokeWidth={1.1} />
          ))}
          <Line i={3} d="M 250 0 L 250 560" stroke={BONE_SOFT} strokeWidth={1} />
          <Line i={3} d="M 0 250 L 560 250" stroke={BONE_SOFT} strokeWidth={1} />
          <circle cx={384} cy={116} r={6} fill={CHILI} />
        </>
      );
    case "battle":
      return (
        <>
          <Line i={0} d="M 0 520 C 140 470, 220 380, 300 300" stroke={CHILI} strokeOpacity={0.55} strokeWidth={1.6} />
          <Line i={0} d="M 520 0 C 470 140, 380 220, 300 300" stroke={EMBER} strokeWidth={1.6} />
          <Line i={1} d="M 0 620 C 180 560, 300 440, 380 380" stroke={INK_SOFT} strokeWidth={1} />
          <Line i={1} d="M 620 0 C 560 180, 440 300, 380 380" stroke={INK_SOFT} strokeWidth={1} />
          {[0, 90, 180, 270].map((d, k) => {
            const a = ((d + 45) * Math.PI) / 180;
            return <Line key={d} i={2 + k * 0.3} d={`M ${300 + Math.cos(a) * 16} ${300 + Math.sin(a) * 16} L ${300 + Math.cos(a) * 34} ${300 + Math.sin(a) * 34}`} stroke={INK} strokeWidth={1.4} />;
          })}
        </>
      );
    case "ledger":
      return (
        <>
          {[140, 260, 380, 500].map((y, i) => (
            <Line key={y} i={i * 0.5} d={`M 0 ${y} L ${SIZE - y * 0.6} ${y}`} stroke={INK_SOFT} strokeWidth={1} />
          ))}
          <Line i={2} d="M 0 470 C 60 460, 90 400, 150 410 S 230 330, 290 340 S 360 220, 420 250 S 500 130, 560 120" stroke={INK} strokeWidth={1.5} />
          <circle cx={560} cy={120} r={7} fill={GOLD} />
        </>
      );
    case "steps":
      return (
        <>
          <Line i={0} d="M 0 520 L 150 520 L 150 400 L 290 400 L 290 280 L 430 280 L 430 400 L 570 400 L 570 520 L 700 520" stroke={GOLD} strokeOpacity={0.5} strokeWidth={1.4} />
          <Line i={1} d="M 322 236 L 334 204 L 360 224 L 386 204 L 398 236 Z" stroke={GOLD} strokeWidth={1.4} strokeLinejoin="round" />
          <Line i={2} d="M 0 600 L 700 600" stroke={BONE_SOFT} strokeWidth={1} />
        </>
      );
    case "streak":
      return (
        <>
          {/* Dotted, so it fades in rather than drawing (the draw uses the dash). */}
          <path d="M 40 420 C 40 200, 420 60, 600 150 C 700 200, 560 380, 300 450 C 160 488, 40 480, 40 420 Z" fill="none" stroke={BONE} strokeWidth={1.4} strokeDasharray="2 9" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {[
            [118, 300],
            [220, 196],
            [352, 132],
            [486, 118],
            [590, 176],
          ].map(([x, y], k) => (
            <circle key={k} cx={x} cy={y} r={k === 4 ? 7 : 5} fill={EMBER} opacity={k === 4 ? 1 : 0.35 + k * 0.12} />
          ))}
        </>
      );
    case "feed":
      return (
        <>
          {/* Kept tight to the corner: the WorldSpace cards' words sit just above it. */}
          <Line i={0} d={circle(120, 120, 120)} stroke={INK} strokeWidth={1.1} />
          <Line i={1} d={circle(235, 120, 120)} stroke={INK_SOFT} strokeWidth={1.1} />
          <Line i={2} d={circle(178, 222, 120)} stroke={INK_SOFT} strokeWidth={1.1} />
          <circle cx={178} cy={154} r={6} fill={CYAN} />
        </>
      );
    case "spectrum": {
      const hues = ["255,90,102", "248,160,8", "149,212,119", "103,220,240", "163,186,255", "217,140,255"];
      return (
        <>
          {hues.map((h, k) => (
            <Line key={h} i={k * 0.5} d={wave(140 + k * 60, 38 - k * 3, 70 + k * 6, k * 0.7)} stroke={`rgba(${h},0.42)`} strokeWidth={1.2} />
          ))}
        </>
      );
    }
  }
}

export function BoxPattern({ theme, corner, className }: { theme: BoxTheme; corner: "tl" | "br"; className?: string }) {
  const flip = corner === "br";
  return (
    <div
      aria-hidden
      data-parallax="0.12"
      data-reveal="art"
      className={cn(
        "pointer-events-none absolute -z-10 size-[42rem] max-sm:size-[26rem]",
        flip ? "-right-10 -bottom-10" : "-top-10 -left-10",
        flip
          ? "[mask-image:radial-gradient(circle_at_bottom_right,black_18%,transparent_74%)]"
          : "[mask-image:radial-gradient(circle_at_top_left,black_18%,transparent_74%)]",
        className,
      )}
    >
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full overflow-visible">
        {/* Anchored at the corner: the art grows from it either way. */}
        <g transform={flip ? `translate(${SIZE} ${SIZE}) scale(-1 -1)` : undefined}>{art(theme)}</g>
      </svg>
    </div>
  );
}
