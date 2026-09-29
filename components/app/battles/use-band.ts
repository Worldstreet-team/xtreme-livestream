"use client";

import { useEffect, useLayoutEffect, useState, type CSSProperties } from "react";
import { BAR_H, columnBand, onStage, resultUntil } from "@/lib/battle-stage";
import type { BattleView } from "@/lib/battles";
import { serverNow } from "@/lib/server-clock";

/**
 * The battle band's geometry as the CSS custom properties BattleStage and
 * SceneRenderer's `stage` read, for a frame measured live (a computer's
 * player, the studio's picture, a phone held sideways): a centred portrait
 * column under the bar. Attach `ref` to the frame. Off (no battle), nothing
 * is measured and the style is empty.
 */
export function useColumnBand(on: boolean, opts: { top?: number; bottom?: number } = {}) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const { top = 12, bottom = 12 } = opts;

  useLayoutEffect(() => {
    if (!on || !el) return;
    const read = () => setSize((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, on]);

  if (!on || !size || size.w === 0 || size.h === 0) return { ref: setEl, style: undefined, stage: undefined };
  const r = columnBand(size.w, size.h, { top, bottom });
  const style = {
    "--bar-top": `${r.barTop}px`,
    "--bar-h": `${BAR_H}px`,
    "--band-top": `${r.bandTop}px`,
    "--band-h": `${r.bandH}px`,
    "--band-left": `${r.bandLeft}px`,
    "--band-w": `${r.bandW}px`,
  } as CSSProperties;
  return { ref: setEl, style, stage: { top: `${r.bandTop}px`, height: `${r.bandH}px`, left: `${r.bandLeft}px`, width: `${r.bandW}px` } };
}

/**
 * An upright screen's band in CSS alone (the phone's watch page and
 * studio): the bar at `top`, then the feeds full width, each half 9:16 —
 * min(50vw × 16/9, 45dvh) — or in container units where the frame is a
 * size container.
 */
export function portraitBandStyle(top: string, units: "viewport" | "container" = "viewport") {
  const w = units === "viewport" ? "100vw" : "100cqw";
  const h = units === "viewport" ? "100dvh" : "100cqh";
  return {
    "--bar-top": top,
    "--bar-h": `${BAR_H}px`,
    "--band-top": `calc(${top} + ${BAR_H}px)`,
    "--band-h": `min(calc(${w} * 8 / 9), calc(${h} * 0.45))`,
    "--band-left": "0px",
    "--band-w": w,
  } as CSSProperties;
}

/**
 * Whether a battle owns the stage: while it runs, and through its result
 * (the victory lap, or a draw's few seconds) — re-checked the moment the
 * result is due to come down, on the server's clock, without ticking the
 * whole surface every second.
 */
export function useOnStage(b: BattleView | null) {
  const until = b ? resultUntil(b) : null;
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    if (until === null) return;
    const t = setTimeout(() => setNow(serverNow()), Math.max(0, until - serverNow()) + 30);
    return () => clearTimeout(t);
  }, [until]);
  return onStage(b, now);
}
