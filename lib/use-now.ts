"use client";

import { useEffect, useState } from "react";

/**
 * A shared once-a-second clock. Forty cards each running their own
 * setInterval to tick an uptime badge is forty timers doing one job; this
 * is one timer with forty subscribers, started when the first mounts and
 * stopped when the last unmounts.
 */

const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(fn: (now: number) => void) {
  listeners.add(fn);
  if (!timer) {
    timer = setInterval(() => {
      const now = Date.now();
      listeners.forEach((l) => l(now));
    }, 1000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useNow(enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    return subscribe(setNow);
  }, [enabled]);
  return now;
}
