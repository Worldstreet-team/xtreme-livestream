"use client";

import { cn } from "@/lib/utils";
import s from "./battles.module.css";

/**
 * A clock's text whose characters tick: a character that changes drops in
 * from above (transform and opacity, a 220 ms clash ease) and the rest hold
 * still. Each is keyed by its place from the right plus its value, so only
 * a changed character mounts afresh, and only a fresh mount animates —
 * "1:00" becoming "0:59" ticks the three that changed and nothing slides.
 */
export function TickDigits({ text, className }: { text: string; className?: string }) {
  const chars = [...text];
  return (
    <span className={cn(s.digits, className)} aria-hidden>
      {chars.map((c, i) => (
        <span key={`${chars.length - i}-${c}`} className={s.digit} data-tick={/\d/.test(c) || undefined}>
          {c}
        </span>
      ))}
    </span>
  );
}
