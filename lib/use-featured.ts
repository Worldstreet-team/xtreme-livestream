"use client";

import { useEffect, useState } from "react";
import { featuredDeadline, type FeaturedItem } from "@/lib/scene";
import { serverNow } from "@/lib/server-clock";

/**
 * The featured item while it's still on screen, and null once its time is
 * up. One timer, set for its deadline — not a clock ticking every second —
 * so a chat of hundreds of lines can mark "On stream" without redrawing
 * them all each second.
 */
export function useFeaturedShowing(featured: FeaturedItem | null | undefined): FeaturedItem | null {
  const key = featured ? `${featured.id}:${featured.at}` : null;
  const at = featured?.at ?? null;
  const until = featured?.until ?? null;
  const [expired, setExpired] = useState<string | null>(null);

  // Keyed on the showing, not the object: scene updates rebuild the object,
  // and the deadline must be taken once, when the showing is first seen.
  useEffect(() => {
    if (!key || !at || !until) return;
    // Deadlines are on the server's clock (lib/server-clock.ts).
    const deadline = featuredDeadline({ at, until }, serverNow())!;
    const t = setTimeout(() => setExpired(key), Math.max(0, deadline - serverNow()));
    return () => clearTimeout(t);
  }, [key, at, until]);

  return featured && expired !== key ? featured : null;
}
