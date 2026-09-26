"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A line that changes by rolling: the old words slide up and out (120 ms,
 * accelerating away), the new ones up and in (180 ms, settling). The first
 * paint is still; only a change moves. Counts, "typing", a preview, a time.
 * Reduced motion turns it into a cut (messaging.css drops the animation).
 */
export function Roll<T extends string | number>({
  value,
  render = (v) => v,
  className,
}: {
  value: T;
  /** Draw a value (the default prints it). Called for the outgoing one too. */
  render?: (v: T) => ReactNode;
  className?: string;
}) {
  const [roll, setRoll] = useState<{ value: T; prev: T | null; n: number }>({ value, prev: null, n: 0 });
  if (roll.value !== value) setRoll({ value, prev: roll.value, n: roll.n + 1 });

  // The outgoing line leaves the tree once it's out of sight.
  useEffect(() => {
    if (roll.prev === null) return;
    const n = roll.n;
    const t = setTimeout(() => setRoll((r) => (r.n === n ? { ...r, prev: null } : r)), 260);
    return () => clearTimeout(t);
  }, [roll.n, roll.prev]);

  return (
    <span className={cn("msg-roll", className)}>
      {roll.prev !== null && (
        <span key={`out-${roll.n}`} aria-hidden className="msg-roll-out">
          {render(roll.prev)}
        </span>
      )}
      <span key={`in-${roll.n}`} className={roll.n ? "msg-roll-in" : undefined}>
        {render(value)}
      </span>
    </span>
  );
}
