"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/market";
import type { SceneChart } from "@/lib/scene";

interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface MarketView {
  symbol: string;
  interval: string;
  candles: Candle[];
  last: number;
  changePct: number;
  source: string;
}

const REFRESH_MS = 15_000;
// The drawing's own units; the SVG stretches to the frame, strokes don't.
const W = 1000;
const H = 600;

/**
 * Chart + face's picture: a live market chart drawn on the viewer's own
 * screen — sharp whatever the video's quality — from the API's shared
 * candles (15 s). Candles in the market's own colours (up green, down
 * chili), the last price as a line in the host's accent, the move since
 * the window opened. The host's camera sits in the corner, over it.
 */
export function MarketChart({
  chart,
  accent,
  headerLow = false,
  maxCandles = 90,
}: {
  chart: SceneChart;
  accent: { fill: string; ink: string };
  /** A logo has the top-left corner: the header starts below it. */
  headerLow?: boolean;
  /** Fewer, wider candles on a narrow (portrait) frame. */
  maxCandles?: number;
}) {
  const [view, setView] = useState<MarketView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await apiFetch<{ success: boolean; data: MarketView }>(
          `/api/market/candles?symbol=${encodeURIComponent(chart.symbol)}&interval=${chart.interval}`
        );
        if (!cancelled) {
          setView(r.data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The chart didn't load");
      }
    };
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [chart.symbol, chart.interval]);

  const [base, quote] = chart.symbol.split("-");
  const candles = view?.symbol === chart.symbol ? view.candles.slice(-maxCandles) : [];
  const up = (view?.changePct ?? 0) >= 0;

  // One scale for candles, grid and labels.
  const lows = candles.map((c) => c.l);
  const highs = candles.map((c) => c.h);
  const min = candles.length ? Math.min(...lows) : 0;
  const max = candles.length ? Math.max(...highs) : 1;
  const pad = (max - min || max * 0.01 || 1) * 0.08;
  const lo = min - pad;
  const hi = max + pad;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const step = W / Math.max(candles.length, 1);
  const body = Math.max(step * 0.62, 1);
  const grid = [0.2, 0.4, 0.6, 0.8].map((f) => hi - (hi - lo) * f);
  const last = view && candles.length ? view.last : null;

  return (
    <div className="relative size-full overflow-hidden bg-[#0b0708] text-white">
      {/* The market, its price and its move. */}
      <div className={cn("absolute left-[4%] z-10", headerLow ? "top-[20%]" : "top-[6%]")}>
        <p className="caps font-mono text-[clamp(9px,1.1cqw,13px)] text-white/55">
          {base} / {quote} · {chart.interval}
        </p>
        <p className="mt-[0.2em] flex items-baseline gap-[0.5em] text-[clamp(18px,3.4cqw,44px)] leading-none">
          <span className="font-money tabular-nums">{last !== null ? formatPrice(last) : "—"}</span>
          {view && candles.length > 0 && (
            <span className={cn("font-mono text-[0.42em] font-bold tabular-nums", up ? "text-success" : "text-chili-hi")}>
              {up ? "▲" : "▼"} {Math.abs(view.changePct).toFixed(2)}%
            </span>
          )}
        </p>
      </div>

      {/* The chart itself. */}
      <div className="absolute top-[30%] right-[12%] bottom-[10%] left-[4%]">
        {candles.length > 0 ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full" aria-label={`${chart.symbol} price chart`} role="img">
            {grid.map((p) => (
              <line key={p} x1={0} x2={W} y1={y(p)} y2={y(p)} stroke="rgba(255,236,230,0.07)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {candles.map((c, i) => {
              const x = i * step + step / 2;
              const rise = c.c >= c.o;
              const color = rise ? "#95d477" : "#ff5a66";
              const top = y(Math.max(c.o, c.c));
              const bottom = y(Math.min(c.o, c.c));
              return (
                <g key={c.t}>
                  <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                  <rect x={x - body / 2} y={top} width={body} height={Math.max(bottom - top, 1.5)} fill={color} />
                </g>
              );
            })}
            {last !== null && (
              <line x1={0} x2={W} y1={y(last)} y2={y(last)} stroke={accent.fill} strokeWidth={1.25} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        ) : (
          <div className="flex size-full items-center justify-center">
            <p className="text-center text-[clamp(11px,1.4cqw,16px)] text-white/50">
              {error ?? `Loading ${chart.symbol}…`}
            </p>
          </div>
        )}

        {/* Price labels, on the right edge, on the same scale. */}
        {candles.length > 0 && (
          <div className="pointer-events-none absolute inset-y-0 left-full w-[12cqw]">
            {grid.map((p) => (
              <span
                key={p}
                className="absolute left-[0.6em] -translate-y-1/2 font-mono text-[clamp(8px,1cqw,12px)] text-white/40 tabular-nums"
                style={{ top: `${(y(p) / H) * 100}%` }}
              >
                {formatPrice(p)}
              </span>
            ))}
            {last !== null && (
              <span
                className="absolute left-[0.3em] -translate-y-1/2 rounded-[4px] px-[0.4em] py-[0.1em] font-mono text-[clamp(8px,1.05cqw,13px)] font-bold tabular-nums"
                style={{ top: `${(y(last) / H) * 100}%`, background: accent.fill, color: accent.ink }}
              >
                {formatPrice(last)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Whose numbers, and that they're only that: the same words the price strip carries. */}
      <p className="absolute bottom-[3%] left-[4%] font-mono text-[clamp(8px,0.9cqw,11px)] text-white/30">
        {view?.source ?? "Coinbase"} · {chart.interval} candles · Not financial advice
      </p>
    </div>
  );
}
