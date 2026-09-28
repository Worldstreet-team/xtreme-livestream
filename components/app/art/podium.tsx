"use client";

import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { ArtCanvas, Bar, Card, Coin, Enter, Figure, Ground, Idle, Star, delay, paint } from "./primitives";
import pd from "./podium.module.css";

/**
 * The top gifters' art, built on the kit (./primitives.tsx): a crown, a
 * laurel wreath, confetti for the board, a drawn podium for the full
 * leaderboard's head, and two small heading marks.
 *
 * Same language as the kit — 2px round lines over solid token cards, a
 * faint disc and specks, one accent — with two additions from
 * ./podium.module.css: the board's paint (the kit's ink on the theme's own
 * surface, Chili on #1's crown, a speck of Ember in the confetti), and
 * entrances that wait for an ancestor's `data-play="go"` so the rail's
 * board can build itself when it scrolls into view. Pieces with no
 * `data-play` above them simply show. Every colour is a token, so it all
 * reads on dark and on light.
 */

/* ---- crown -------------------------------------------------------------- */

const CROWN = "M5 21 3.2 8.6l8 5.4L18 4l6.8 10 8-5.4L31 21z";

/**
 * The crown for #1: three points with a jewel on each and one in the band.
 * Solid Chili — heat belongs to #1 — with the band and middle jewel punched
 * back to the ground it sits on (`--art-ground`, the surface by default).
 * Drops in and settles.
 */
export function Crown({ delay: ms = 0, className }: { delay?: number; className?: string }) {
  return (
    <ArtCanvas viewBox="0 0 36 26" className={className}>
      <g className={pd.drop} style={delay(ms)}>
        <path className={pd.crown} d={CROWN} />
        <path className={pd.jewel} opacity={0.4} d="M6 17.6h24v2.4H6z" />
        <circle className={pd.jewel} cx={18} cy={12.6} r={1.9} />
        <circle className={pd.crown} cx={3.2} cy={7.4} r={1.9} />
        <circle className={pd.crown} cx={18} cy={3} r={1.9} />
        <circle className={pd.crown} cx={32.8} cy={7.4} r={1.9} />
      </g>
    </ArtCanvas>
  );
}

/* ---- laurel ------------------------------------------------------------- */

/** Leaves along one side of a circle, from its foot up to its shoulder. */
function branch(count: number, leaf: number) {
  const cx = 50;
  const cy = 50;
  const r = 42;
  const from = 104;
  const to = 222;
  const at = (t: number) => [cx + r * Math.cos((t * Math.PI) / 180), cy + r * Math.sin((t * Math.PI) / 180)] as const;
  const leaves = Array.from({ length: count }, (_, k) => {
    const t = from + ((to - from) * k) / (count - 1);
    const [x, y] = at(t);
    // The tangent runs up the branch; alternate leaves lean out and in.
    return { k, x, y, rot: t + 90 + (k % 2 === 0 ? -34 : 30) };
  });
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  const stem = `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  const almond = `M0 0q${leaf / 2} ${-leaf * 0.36} ${leaf} 0q${-leaf / 2} ${leaf * 0.36} ${-leaf} 0z`;
  return { leaves, stem, almond };
}

/**
 * SVG's own transform semantics for a group placed with a `transform`
 * attribute. The kit sets every part's origin to its own centre (for its
 * CSS motion), which would mirror the right branch about itself and spin
 * each leaf about its middle instead of its base.
 */
const PLACED: CSSProperties = { transformBox: "view-box", transformOrigin: "0 0" };

/**
 * A laurel wreath: two branches meeting under whatever sits in the middle
 * (#1's face on the board), or alone as a mark. Leaves grow from the stem
 * one after another. Size it with a width class.
 */
export function Laurel({ leaves = 6, delay: ms = 0, className, style }: { leaves?: number; delay?: number; className?: string; style?: CSSProperties }) {
  const { leaves: pts, stem, almond } = branch(leaves, leaves > 5 ? 11 : 13);
  const side = (mirror: boolean) => (
    <g transform={mirror ? "translate(100 0) scale(-1 1)" : undefined} style={PLACED}>
      <path className={cn(pd.stem, pd.fadeIn)} style={delay(ms)} d={stem} />
      {pts.map((p) => (
        <g key={p.k} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.rot.toFixed(1)})`} style={PLACED}>
          <path className={cn(pd.leaf, pd.grow)} style={delay(ms + p.k * 55)} d={almond} />
        </g>
      ))}
    </g>
  );
  return (
    <span className={cn("block", className)} style={style} aria-hidden>
      <ArtCanvas viewBox="0 0 100 100" className="w-full">
        {side(false)}
        {side(true)}
      </ArtCanvas>
    </span>
  );
}

/* ---- confetti ----------------------------------------------------------- */

type Piece = { x: number; y: number; rot: number; kind: "ribbon" | "dot" | "curl" | "square" | "live" | "ember"; o?: number };

// Rest positions on a 300 × 110 field; they burst from its middle-top.
const PIECES: Piece[] = [
  { x: 34, y: 22, rot: -24, kind: "ribbon" },
  { x: 62, y: 60, rot: 18, kind: "ember" },
  { x: 86, y: 14, rot: 40, kind: "curl" },
  { x: 108, y: 44, rot: -12, kind: "square", o: 0.7 },
  { x: 122, y: 8, rot: 10, kind: "live" },
  { x: 180, y: 10, rot: -30, kind: "ribbon" },
  { x: 196, y: 46, rot: 22, kind: "dot" },
  { x: 214, y: 18, rot: -8, kind: "curl" },
  { x: 244, y: 56, rot: 36, kind: "ember" },
  { x: 268, y: 24, rot: 14, kind: "live" },
  { x: 20, y: 72, rot: 30, kind: "dot", o: 0.6 },
  { x: 282, y: 84, rot: -20, kind: "ribbon", o: 0.6 },
];
const ORIGIN = { x: 150, y: 44 };

function Shape({ kind }: { kind: Piece["kind"] }) {
  switch (kind) {
    case "ribbon":
      return <rect className={pd.confetti} x={-5} y={-1.4} width={10} height={2.8} rx={1.4} />;
    case "dot":
      return <circle className={pd.confetti} r={1.8} />;
    case "curl":
      return <path className={pd.confettiLine} d="M-7 0c1.8-3 3.5 3 5.2 0s3.5 3 5.2 0 3.5 3 3.6 0" />;
    case "square":
      return <rect className={pd.confettiLine} x={-3} y={-3} width={6} height={6} rx={1.2} />;
    case "live":
      // A gift's ribbon is Chili, as in the kit's Gift.
      return <rect className={paint.live} x={-4} y={-1.5} width={8} height={3} rx={1.5} />;
    case "ember":
      // Ember only ever as a small outline — a detail, never a fill.
      return <rect className={pd.confettiEmber} x={-2.6} y={-2.6} width={5.2} height={5.2} rx={1.2} />;
  }
}

/**
 * Confetti and gift ribbon for the board: it bursts from #1 and lands
 * around, then rests as quiet specks — a celebration that doesn't keep
 * asking for attention. Fixed pieces, so every render matches.
 */
export function Confetti({ delay: ms = 0, className }: { delay?: number; className?: string }) {
  return (
    <span className={cn("block", className)} aria-hidden>
      <ArtCanvas viewBox="0 0 300 110" className="w-full">
        {PIECES.map((p, k) => (
          <g key={k} transform={`translate(${p.x} ${p.y})`}>
            <g
              className={pd.burst}
              style={
                {
                  "--bx": `${ORIGIN.x - p.x}px`,
                  "--by": `${ORIGIN.y - p.y}px`,
                  "--br": `${k % 2 ? 120 : -140}deg`,
                  ...delay(ms + (k % 4) * 40),
                } as CSSProperties
              }
            >
              <g transform={`rotate(${p.rot})`} opacity={p.o ?? 0.85}>
                <Shape kind={p.kind} />
              </g>
            </g>
          </g>
        ))}
      </ArtCanvas>
    </span>
  );
}

/* ---- the leaderboard's head --------------------------------------------- */

/**
 * A podium on the kit's ground: three steps with a figure on each, the
 * crown over the middle one, and two coins for what was given (gold, money
 * only). It builds in the board's order — #3, #2, then #1 lifted last, the
 * crown dropping on — using the kit's own entrances, since it mounts when
 * its window opens.
 */
export function PodiumScene({ className }: { className?: string }) {
  return (
    <ArtCanvas viewBox="8 6 164 108" className={className}>
      <Ground cx={90} cy={66} r={52} specks={[[20, 40, 1.6, 0], [160, 26, 2, 1.4], [164, 92, 1.5, 2.6]]} />
      {/* #3, right */}
      <Enter kind="rise" delay={120}>
        <Card x={114} y={80} w={36} h={24} r={6} paint="card2" />
        <Bar x={126} y={87} w={12} h={4} />
        <Figure cx={132} cy={66} r={10} />
      </Enter>
      {/* #2, left */}
      <Enter kind="rise" delay={220}>
        <Card x={30} y={72} w={36} h={32} r={6} paint="card2" />
        <Bar x={42} y={79} w={12} h={4} />
        <Figure cx={48} cy={57} r={10} />
      </Enter>
      {/* #1, middle, lifted last */}
      <Enter kind="rise" delay={360}>
        <Card x={64} y={58} w={52} h={46} r={7} />
        <Bar x={83} y={66} w={14} h={4.5} paint="ember" />
        <Figure cx={90} cy={40} r={12} />
      </Enter>
      {/* The crown drops on: Chili, as on the board. */}
      <Enter kind="pop" delay={620}>
        <path className={pd.crown} d="M80.5 25.5 79.2 16.4l5.8 3.9 5-7.6 5 7.6 5.8-3.9-1.3 9.1z" />
        <circle className={pd.jewel} cx={90} cy={21.4} r={1.4} />
      </Enter>
      {/* What was given. */}
      <Enter kind="pop" delay={760}>
        <Idle kind="float" offset={0.6}>
          <Coin cx={150} cy={50} r={7} />
        </Idle>
      </Enter>
      <Enter kind="pop" delay={860}>
        <Idle kind="float" offset={1.8}>
          <Coin cx={24} cy={62} r={5} />
        </Idle>
      </Enter>
      <path className={paint.line} d="M20 104h140" />
    </ArtCanvas>
  );
}

/* ---- heading marks ------------------------------------------------------ */

/**
 * A gift for the "Top gifters" heading: the kit's gift (card box and lid, a
 * Chili ribbon) redrawn at glyph size, where the kit's 82-unit gift would
 * thin its lines to nothing.
 */
export function GiftMark({ className }: { className?: string }) {
  return (
    <ArtCanvas viewBox="0 0 24 24" className={cn("w-5 shrink-0", className)}>
      <rect className={paint.card} style={{ strokeWidth: 1.75 }} x={4} y={11} width={16} height={10} rx={2.5} />
      <rect className={paint.live} x={10.9} y={11.9} width={2.2} height={8.2} />
      <rect className={paint.card} style={{ strokeWidth: 1.75 }} x={2.75} y={7.5} width={18.5} height={4.5} rx={2} />
      <rect className={paint.live} x={10.9} y={8.4} width={2.2} height={2.7} />
      <path className={paint.liveLine} style={{ strokeWidth: 1.8 }} d="M12 7.2C10.6 4 7.2 3.4 7 5.3c-.2 1.6 2.6 2 5 1.9zM12 7.2c1.4-3.2 4.8-3.8 5-1.9.2 1.6-2.6 2-5 1.9z" />
    </ArtCanvas>
  );
}

/** A small wreath round an Ember star — "the pick of the week". */
export function HighlightMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative block w-5 shrink-0", className)} aria-hidden>
      <Laurel leaves={4} className="w-full" />
      <ArtCanvas viewBox="0 0 24 24" className="absolute inset-[25%] w-1/2">
        <Star cx={12} cy={12.6} R={10} paint="ember" />
      </ArtCanvas>
    </span>
  );
}
