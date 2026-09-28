"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import kit from "@/components/app/art/primitives.module.css";
import { cn } from "@/lib/utils";
import s from "./battle-field.module.css";

/**
 * The ground a battle is fought on, drawn in the art kit's language instead
 * of a dot pattern (owner, 2026-09-28: "arts for the battle backgrounds
 * instead of those dots").
 *
 * - Two fields, Chili for the host and Ember for the challenger, split by a
 *   crack: a jagged seam running on the card's slant, with a small fork.
 * - Each side sweeps toward the seam: a few bold flat bands along the top
 *   and foot, shards in the outer corners and a chevron pointing in. Two
 *   sides pushing at each other, drawn flat.
 * - Every battle's is its own: the crack's zigzag, the bands' lengths and
 *   weights and the shards come from a small generator seeded by its id.
 * - It answers the score: the seam (and both fields with it) slides toward
 *   the side that's behind, so the leader holds a little more ground, on
 *   the clash ease. Live, the leader's field breathes — a flat tint rising
 *   and falling, quicker in the ×2 window.
 * - The middle band (where faces and names sit) is kept clear and the
 *   fills are faint, so everything on top stays readable.
 *
 * Flat, tokens only: no gradients, glows or blur. Static SVG; the only
 * motion is transform (the seam's slide, a slow drift of the bands) and
 * the breath's opacity, and all of it holds still off screen and under
 * reduced motion. The clash view reaches in for its hit effects through
 * `data-field` hooks (a side's surge, a side's flash).
 */

export type FieldTone = "live" | "booked" | "ended";

const H = 180;

/** mulberry32 over a string hash: the same battle always draws the same field. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pt = [number, number];
const pts = (p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** A band: a long parallelogram whose ends lean with the seam. */
function band(x0: number, x1: number, y: number, t: number, lean: number): Pt[] {
  return [
    [x0 + lean, y],
    [x1 + lean, y],
    [x1 - lean, y + t],
    [x0 - lean, y + t],
  ];
}

function compose(id: string, W: number) {
  const r = rng(id);
  const mid = W / 2;
  // The seam runs on the card's slant: right of centre at the top, left at the foot.
  const slant = W * 0.05;
  const steps = 7;
  const crack: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = -8 + ((H + 16) * i) / steps;
    const along = mid + slant - (2 * slant * i) / steps;
    const jag = i === 0 || i === steps ? 0 : (i % 2 ? 1 : -1) * (3 + r() * 6);
    crack.push([along + jag, y]);
  }
  // A fork off the crack, on a random side, somewhere in the middle third.
  const k = 3 + Math.floor(r() * 2);
  const [fx, fy] = crack[k]!;
  const fdir = r() < 0.5 ? -1 : 1;
  const fork: Pt[] = [
    [fx, fy],
    [fx + fdir * (8 + r() * 6), fy + 7 + r() * 5],
    [fx + fdir * (14 + r() * 8), fy + 20 + r() * 8],
  ];

  const far = W * 1.6;
  const hostField: Pt[] = [[-far, -10], ...crack, [-far, H + 10]];
  const chalField: Pt[] = [[W + far, -10], ...crack, [W + far, H + 10]];

  // Sweeps: bands along the top and the foot, pushing in from the outer edge toward the seam.
  const lean = slant * 0.55;
  const sweeps = (dir: 1 | -1) => {
    const out: { p: Pt[]; strong: boolean }[] = [];
    const rows = [
      { y: 10 + r() * 8, t: 5 + r() * 5 },
      { y: 28 + r() * 6, t: 3 + r() * 2.5 },
      { y: H - 44 + r() * 6, t: 3 + r() * 3 },
      { y: H - 26 + r() * 6, t: 7 + r() * 6 },
    ];
    rows.forEach((row, i) => {
      if (i > 0 && i < 3 && r() < 0.3) return;
      const reach = W * (0.22 + r() * 0.12);
      const start = -12;
      const [a, b] = dir === 1 ? [start, reach] : [W - reach, W - start];
      out.push({ p: band(a, b, row.y, row.t, dir === 1 ? lean : -lean), strong: i === 0 || i === 3 });
    });
    return out;
  };
  // Shards: a bold triangle or two in the outer corners, pointing in.
  const shards = (dir: 1 | -1) => {
    const out: Pt[][] = [];
    const edge = dir === 1 ? 0 : W;
    const inward = dir;
    const top: Pt[] = [
      [edge - inward * 4, -4],
      [edge + inward * (W * (0.1 + r() * 0.07)), -4],
      [edge - inward * 4, 30 + r() * 22],
    ];
    const foot: Pt[] = [
      [edge - inward * 4, H + 4],
      [edge + inward * (W * (0.08 + r() * 0.08)), H + 4],
      [edge - inward * 4, H - 30 - r() * 20],
    ];
    if (r() < 0.75) out.push(top);
    if (r() < 0.75 || out.length === 0) out.push(foot);
    return out;
  };
  // A chevron by the outer edge, level with the faces, pointing at the other side.
  const chevron = (dir: 1 | -1): Pt[] => {
    const x = dir === 1 ? W * 0.06 : W * 0.94;
    const y = H * 0.44;
    const w = 7;
    const hgt = 11;
    return [
      [x - dir * w, y - hgt],
      [x + dir * w * 0.6, y],
      [x - dir * w, y + hgt],
    ];
  };

  return {
    hostField,
    chalField,
    crack,
    fork,
    host: { sweeps: sweeps(1), shards: shards(1), chevron: chevron(1) },
    challenger: { sweeps: sweeps(-1), shards: shards(-1), chevron: chevron(-1) },
  };
}

export function BattleField({
  id,
  share = 0.5,
  lead = null,
  tone = "live",
  hot = false,
  wide = false,
  className,
}: {
  /** The battle's id: seeds the drawing. */
  id: string;
  /** The host's part of the score (0–1); the seam gives the leader more ground. */
  share?: number;
  /** Whose field breathes (live only). */
  lead?: "host" | "challenger" | null;
  tone?: FieldTone;
  /** The ×2 window: the breath quickens. */
  hot?: boolean;
  /** A wider box (the clash view's arena) gets a wider drawing, so nothing is cropped away. */
  wide?: boolean;
  className?: string;
}) {
  const W = wide ? 460 : 320;
  const art = useMemo(() => compose(id, W), [id, W]);
  const ref = useRef<SVGSVGElement>(null);

  // Off screen, the drift and the breath hold still (the kit's data-paused).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      if (e) el.dataset.paused = String(!e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The seam slides toward whoever's behind, at most a twelfth of the width.
  const shift = Math.max(-1, Math.min(1, (share - 0.5) * 2.4)) * W * 0.08;
  const quiet = tone !== "live";

  const side = (which: "host" | "challenger") => {
    const a = art[which];
    return (
      <g data-field-surge={which}>
        <g className={cn(!quiet && s.drift)} style={{ ["--dir" as string]: which === "host" ? 1 : -1 } as CSSProperties}>
          {a.shards.map((p, i) => (
            <polygon key={`s${i}`} points={pts(p)} className={s[`${which}Shard`]} />
          ))}
          {a.sweeps.map((b, i) => (
            <polygon key={`b${i}`} points={pts(b.p)} className={b.strong ? s[`${which}Band`] : s[`${which}Thin`]} />
          ))}
          <polyline points={pts(a.chevron)} className={s[`${which}Chevron`]} />
        </g>
      </g>
    );
  };

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={cn(kit.canvas, s.field, "absolute inset-0 size-full", className)}
      data-tone={tone}
      data-hot={hot || undefined}
      data-lead={tone === "live" ? (lead ?? undefined) : undefined}
    >
      <g className={s.seam} style={{ transform: `translateX(${shift.toFixed(1)}px)` }}>
        <polygon points={pts(art.hostField)} className={s.hostField} />
        <polygon points={pts(art.chalField)} className={s.chalField} />
        {/* The breath, and the clash view's flash: the same ground, a flat tint over it. */}
        <polygon points={pts(art.hostField)} className={s.hostHeat} />
        <polygon points={pts(art.chalField)} className={s.chalHeat} />
        <polygon points={pts(art.hostField)} className={s.hostFlash} data-field-flash="host" />
        <polygon points={pts(art.chalField)} className={s.chalFlash} data-field-flash="challenger" />
        <polyline points={pts(art.crack)} className={s.crack} />
        <polyline points={pts(art.fork)} className={s.fork} />
      </g>
      {/* The sides' shapes hold their edges while the seam moves between them. */}
      {side("host")}
      {side("challenger")}
    </svg>
  );
}
