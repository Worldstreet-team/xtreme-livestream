import { cn } from "@/lib/utils";

// Deterministic PRNG so a given stream always renders the same preview
function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "AVAX/USDT", "LINK/USDT"];

type Candle = { x: number; open: number; close: number; high: number; low: number };

/**
 * Chart-style stream preview used when a stream has no real thumbnail.
 * Renders a seeded candlestick chart that reads like a trading-stream frame
 * instead of a stock photo.
 *
 * Sizes itself to its parent box via `size-full` rather than `absolute
 * inset-0`. The absolute version silently required every caller to be
 * `position: relative` — and a caller that forgot didn't get a subtly
 * misplaced chart, it got one anchored to the viewport, escaping its
 * `overflow-hidden` (which can't clip a descendant whose containing block
 * sits outside it) and covering the entire page.
 */
export function StreamPreviewThumb({
  seed,
  pair,
  className,
  /** Drop the ticker chip where the box is too small to fit it legibly. */
  showTicker = true,
}: {
  seed: string;
  pair?: string;
  className?: string;
  showTicker?: boolean;
}) {
  const rng = seededRandom(seed);
  const tickerPair = pair ?? PAIRS[Math.floor(rng() * PAIRS.length)];
  const percent = Math.round((rng() * 14 - 6) * 10) / 10;
  const up = percent >= 0;

  // Random walk biased toward the day's direction
  const candles: Candle[] = [];
  let price = 260 + rng() * 60;
  for (let i = 0; i < 26; i++) {
    const drift = (up ? -1.6 : 1.6) + (rng() - 0.5) * 26;
    const open = price;
    const close = Math.min(400, Math.max(60, open + drift));
    const high = Math.min(open, close) - rng() * 14;
    const low = Math.max(open, close) + rng() * 14;
    candles.push({ x: 14 + i * 30, open, close, high, low });
    price = close;
  }

  return (
    <div className={cn("relative size-full overflow-hidden bg-[#0b0d10]", className)}>
      <svg
        viewBox="0 0 800 450"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full"
        aria-hidden
      >
        {/* Grid */}
        {Array.from({ length: 8 }).map((_, i) => (
          <line
            key={`h${i}`}
            x1={0}
            y1={i * 60}
            x2={800}
            y2={i * 60}
            stroke="rgba(255,255,255,0.045)"
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: 13 }).map((_, i) => (
          <line
            key={`v${i}`}
            x1={i * 66}
            y1={0}
            x2={i * 66}
            y2={450}
            stroke="rgba(255,255,255,0.03)"
            strokeWidth={1}
          />
        ))}

        {/* Candles */}
        {candles.map((c, i) => {
          const bullish = c.close <= c.open; // lower y = higher price
          const color = bullish ? "#22c55e" : "#ef4444";
          const bodyTop = Math.min(c.open, c.close);
          const bodyHeight = Math.max(3, Math.abs(c.close - c.open));
          return (
            <g key={i}>
              <line x1={c.x + 9} y1={c.high} x2={c.x + 9} y2={c.low} stroke={color} strokeWidth={2} opacity={0.85} />
              <rect x={c.x} y={bodyTop} width={18} height={bodyHeight} fill={color} opacity={0.85} rx={1.5} />
            </g>
          );
        })}

        {/* Moving-average line */}
        <polyline
          points={candles
            .map((c, i, arr) => {
              const from = Math.max(0, i - 3);
              const avg =
                arr.slice(from, i + 1).reduce((s, k) => s + (k.open + k.close) / 2, 0) /
                (i + 1 - from);
              return `${c.x + 9},${avg + 24}`;
            })
            .join(" ")}
          fill="none"
          stroke="rgba(147,197,253,0.5)"
          strokeWidth={2.5}
        />

        {/* Vignette so overlaid badges stay legible */}
        <rect x={0} y={0} width={800} height={450} fill="url(#previewFade)" />
        <defs>
          <linearGradient id="previewFade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,0,0,0.25)" />
            <stop offset="55%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.45)" />
          </linearGradient>
        </defs>
      </svg>

      {/* Ticker chip */}
      {showTicker && (
        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[0.65rem] font-medium backdrop-blur-sm">
          <span className="text-white/80">{tickerPair}</span>
          <span className={up ? "text-emerald-400" : "text-red-400"}>
            {up ? "+" : ""}
            {percent.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
