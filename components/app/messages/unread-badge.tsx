"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useUnreadState } from "@/lib/messaging";
import { EASE, play, settle } from "./motion";
import { Roll } from "./roll";

const NUDGE: Keyframe[] = [
  { transform: "rotate(0)" },
  { transform: "rotate(-12deg)", offset: 0.2 },
  { transform: "rotate(9deg)", offset: 0.45 },
  { transform: "rotate(-4deg)", offset: 0.7 },
  { transform: "rotate(0)" },
];
const POP: Keyframe[] = [{ transform: "scale(0)" }, { transform: "scale(1.15)", offset: 0.6 }, { transform: "scale(1)" }];

/**
 * The unread count in motion (the owner's pick, badge C). It arrives on the
 * spring the first time; after that the number only rolls. The chat icon
 * shakes once when another conversation becomes unread — the count is of
 * conversations, so more messages in one you already have never shake it.
 * The count a page loads with paints still; only live changes move. Going
 * to nothing, the badge shrinks away.
 */
export function useUnreadBadge(enabled: boolean) {
  const { count, settled } = useUnreadState(enabled);
  const iconRef = useRef<HTMLSpanElement | null>(null);
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  // What the badge shows: it keeps its last number while it shrinks away.
  const [shown, setShown] = useState(count);
  if (count > 0 && shown !== count) setShown(count);
  const last = useRef({ count, settled });

  useLayoutEffect(() => {
    const was = last.current;
    last.current = { count, settled };
    if (!was.settled || count <= was.count) return;
    play(iconRef.current, NUDGE, 460, EASE.out);
    if (was.count === 0) {
      settle(badgeRef.current);
      play(badgeRef.current, POP, 340, EASE.spring);
    }
  }, [count, settled]);

  useEffect(() => {
    if (count > 0 || shown === 0) return;
    const out = play(badgeRef.current, [{ transform: "none", opacity: 1 }, { transform: "scale(0.4)", opacity: 0 }], 140, EASE.in, 0, { fill: "forwards" });
    const t = setTimeout(() => setShown(0), out ? 140 : 0);
    return () => clearTimeout(t);
  }, [count, shown]);

  return { count, shown, iconRef, badgeRef };
}

/** The number itself: rolls as it changes, "99+" past ninety-nine. */
export function UnreadNumber({ count }: { count: number }) {
  return (
    <>
      <Roll value={count > 99 ? "99+" : String(count)} />
      <span className="sr-only"> unread</span>
    </>
  );
}
