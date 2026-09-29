"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Plus } from "@/components/icons";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GoLiveSheet, useOnAir } from "@/components/app/go-live-fab";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { BACKSTOP_VIEWERS_MS, STREAM_PUSHES, useXtreamPoll } from "@/lib/xtream-live-events";
import { cn } from "@/lib/utils";

/**
 * Phones: who's live right now, as a row of rings under the top bar on
 * Home, Browse and Messages — WorldSpace's stories rail, in Afterglow's
 * finish. You first (your face with a Chili plus: Go live), then your
 * Allies who are on air, then everyone else live, busiest first. A tap on
 * a ring opens the stream; yours offers Start now or Schedule live, or —
 * once you're on air — takes you back to the studio. Desktop has the rail,
 * so this never renders from `md` up. Nobody else live, no row.
 *
 * The shell mounts it inside the sticky chrome, so it stays in reach while
 * you read — and gets out of the way while you scroll down, coming back
 * after a deliberate scroll up, and always at the top.
 */

const ROUTES = ["/explore", "/browse", "/messages"];
const REFRESH_MS = 30_000;
const MAX_RINGS = 30;
/** Only the rings a phone shows at once take part in the entrance. */
const CASCADE_RINGS = 8;
const INTRO_KEY = "xtream:rings-intro";

interface LiveStream {
  _id: string;
  viewers: number;
  streamerId: { _id: string; username: string; displayName: string; avatar: string };
}
interface FollowedChannel {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  stream: { id: string; viewers: number } | null;
}
interface Ring {
  streamId: string;
  username: string;
  displayName: string;
  avatar: string;
  ally: boolean;
}

/* ---- phone? ------------------------------------------------------- */

const PHONE_QUERY = "(max-width: 767px)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** True below `md`; false for the server paint, so nothing fetches on a desktop. */
export function usePhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/* ---- scroll-away -------------------------------------------------- */

/** Sustained downward travel before the row gets out of the way. */
const COLLAPSE_AFTER_DOWN_PX = 120;
/**
 * Sustained upward travel before it comes back — deliberately larger than
 * the collapse distance: reappearing pushes the page down under your eyes,
 * so it has to be meant. A flick or a rubber-band bounce isn't.
 */
const REVEAL_AFTER_UP_PX = 280;
/** Up here the row is simply the top of the page. */
const NEAR_TOP_PX = 64;
/** Sub-pixel and jitter deltas don't count as travel. */
const NOISE_FLOOR_PX = 4;
/** Outlasts the height transition, so its own reflow isn't read as travel. */
const SETTLE_MS = 460;

/**
 * Distance accumulates in one direction and resets the moment the direction
 * flips, so a jiggle never crosses either threshold. Toggling resizes the
 * sticky chrome, which reflows the page and fires a scroll of its own —
 * ignored for a beat, or the row would flip straight back.
 */
function useCollapseOnScrollDown(active: boolean) {
  const [collapsed, setCollapsed] = useState(false);
  const collapsedRef = useRef(false);

  useEffect(() => {
    if (!active) return;
    let last = window.scrollY;
    let down = 0;
    let up = 0;
    let settleUntil = 0;

    const apply = (next: boolean) => {
      if (next === collapsedRef.current) return;
      collapsedRef.current = next;
      down = 0;
      up = 0;
      settleUntil = performance.now() + SETTLE_MS;
      setCollapsed(next);
    };

    const onScroll = () => {
      const y = window.scrollY;
      if (performance.now() < settleUntil) {
        last = y;
        return;
      }
      const dy = y - last;
      if (Math.abs(dy) < NOISE_FLOOR_PX) return;
      last = y;
      if (dy > 0) {
        down += dy;
        up = 0;
      } else {
        up += -dy;
        down = 0;
      }
      if (y <= NEAR_TOP_PX) return apply(false);
      if (!collapsedRef.current && down >= COLLAPSE_AFTER_DOWN_PX) apply(true);
      else if (collapsedRef.current && up >= REVEAL_AFTER_UP_PX) apply(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      // A new page starts at its top, with the row in view.
      collapsedRef.current = false;
      setCollapsed(false);
    };
  }, [active]);

  return active && collapsed;
}

/* ---- the entrance ------------------------------------------------- */

/** The rings cascade in once a session — not on every visit home or refresh. */
let introPlayed = false;
function introDue() {
  if (introPlayed || typeof window === "undefined" || reducedMotion()) return false;
  try {
    return window.sessionStorage.getItem(INTRO_KEY) !== "1";
  } catch {
    return true;
  }
}
function markIntro() {
  introPlayed = true;
  try {
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // The module flag still holds for this page load.
  }
}

/* ------------------------------------------------------------------ */

export function LiveRingsBar() {
  const pathname = usePathname();
  const phone = usePhone();
  const on = phone && ROUTES.includes(pathname);
  const { user, isAuthenticated } = useAuth();
  const { live: onAir } = useOnAir();
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [followed, setFollowed] = useState<FollowedChannel[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const selfRef = useRef<HTMLButtonElement>(null);
  const collapsed = useCollapseOnScrollDown(on);
  const [cascade, setCascade] = useState(introDue);

  // Who went live or ended is pushed; the poll is the backstop for viewer order.
  const { pace, tick } = useXtreamPoll(REFRESH_MS, BACKSTOP_VIEWERS_MS, STREAM_PUSHES);

  // The same list the rail's "Live now" reads, plus who you're an Ally of.
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      apiFetch<{ success: boolean; data: { streams: LiveStream[] } }>(`/api/streams?live=true&sort=viewers&limit=${MAX_RINGS}`)
        .then((r) => !cancelled && setStreams(r.data.streams))
        .catch(() => {
          // Keep the last good row; the next look will try again.
        });
      if (isAuthenticated) {
        apiFetch<{ success: boolean; data: { channels: FollowedChannel[] } }>(`/api/user/me/following`)
          .then((r) => !cancelled && setFollowed(r.data.channels))
          .catch(() => {});
      }
    };
    load();
    const timer = setInterval(load, pace);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [on, isAuthenticated, pace, tick]);

  const rings = useMemo<Ring[]>(() => {
    const seen = new Set<string>(user ? [user.username] : []);
    const allies = (isAuthenticated ? followed : [])
      .filter((c) => c.isLive && c.stream && !seen.has(c.username))
      .sort((a, b) => (b.stream?.viewers ?? 0) - (a.stream?.viewers ?? 0))
      .map((c) => {
        seen.add(c.username);
        return { streamId: c.stream!.id, username: c.username, displayName: c.displayName, avatar: c.avatar, ally: true };
      });
    const others = streams.flatMap((s) => {
      const u = s.streamerId;
      if (!u || seen.has(u.username)) return [];
      seen.add(u.username);
      return [{ streamId: s._id, username: u.username, displayName: u.displayName, avatar: u.avatar, ally: false }];
    });
    return [...allies, ...others].slice(0, MAX_RINGS);
  }, [followed, streams, user, isAuthenticated]);

  // Once the first rings have played their entrance, later ones just appear.
  useEffect(() => {
    if (!cascade || rings.length === 0) return;
    markIntro();
    const t = setTimeout(() => setCascade(false), 900);
    return () => clearTimeout(t);
  }, [cascade, rings.length]);

  // Your own ring is the way in to Go live, so it shows even when nobody else is on.
  if (!on || (rings.length === 0 && !user)) return null;

  const firstName = (user?.displayName || "").trim().split(/\s+/)[0] || "You";

  return (
    <>
      {/* 1fr → 0fr animates to the row's own height; nothing needs to know it. */}
      <div
        className={cn(
          "grid bg-background transition-[grid-template-rows,opacity] duration-[400ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none md:hidden",
          collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
        )}
        aria-hidden={collapsed || undefined}
        inert={collapsed}
      >
        {/* The row scrolls inside itself and never widens the page. Both
            boxes are positioned so they contain the rings' absolute bits
            (the sr-only labels too): unpositioned, those escape to the
            sticky chrome and stretch the page sideways. */}
        <div className="relative min-h-0 min-w-0 overflow-hidden">
          <section aria-label="Live now" data-tour="live-rings" className="shadow-[inset_0_-1px_0_var(--hairline-color)]">
            <ul className="relative flex gap-1.5 overflow-x-auto overscroll-x-contain px-3 pt-2.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {user && (
                <li className="shrink-0">
                  {onAir ? (
                    <Link href="/studio" aria-label="You're on air — open the studio" className="press flex w-[72px] flex-col items-center gap-1.5 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ember">
                      <span className="relative">
                        <UserAvatar src={user.avatar} name={user.displayName || user.username} size={56} ring="live" className="size-14" />
                        <LiveTag />
                      </span>
                      <span className="w-full truncate text-center text-[11.5px] font-semibold text-foreground">{firstName}</span>
                    </Link>
                  ) : (
                    <button
                      ref={selfRef}
                      type="button"
                      onClick={() => setMenuOpen(true)}
                      aria-label="Go live"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      className="press flex w-[72px] flex-col items-center gap-1.5 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ember"
                    >
                      <span className="relative">
                        <UserAvatar src={user.avatar} name={user.displayName || user.username} size={56} ring="seen" className="size-14" />
                        <span
                          aria-hidden
                          className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full border-2 border-background bg-chili text-white"
                        >
                          <Plus size={11} weight="bold" />
                        </span>
                      </span>
                      <span className="w-full truncate text-center text-[11.5px] font-semibold text-foreground/85">{firstName}</span>
                    </button>
                  )}
                </li>
              )}
              {rings.map((c, i) => (
                <li
                  key={c.streamId}
                  className={cn("shrink-0", cascade && i < CASCADE_RINGS && "animate-rise")}
                  style={cascade && i < CASCADE_RINGS ? { animationDelay: `${60 + i * 45}ms` } : undefined}
                >
                  <Link
                    href={`/stream/${c.streamId}`}
                    className="press flex w-[72px] flex-col items-center gap-1.5 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ember"
                  >
                    <span className="relative">
                      <UserAvatar src={c.avatar} name={c.displayName || c.username} size={56} ring="live" className="size-14" />
                      <LiveTag />
                    </span>
                    <span className="w-full truncate text-center text-[11.5px] font-semibold text-foreground/85">
                      {c.username}
                      <span className="sr-only">{c.ally ? ", your Ally, live now" : ", live now"}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      {menuOpen && (
        <GoLiveSheet
          onDismiss={() => {
            setMenuOpen(false);
            selfRef.current?.focus();
          }}
          onPick={() => setMenuOpen(false)}
        />
      )}
    </>
  );
}

function LiveTag() {
  return (
    <span
      aria-hidden
      className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-[4px] bg-chili px-1 py-px text-[8px] leading-none font-bold tracking-[0.06em] text-white uppercase ring-2 ring-background"
    >
      Live
    </span>
  );
}
