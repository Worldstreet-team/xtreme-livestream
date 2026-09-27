"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { SIGN_IN_URL } from "@/lib/auth-urls";
import { useAuth } from "@/lib/auth-context";
import { BrandMark } from "@/components/ui/brand-mark";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PillLink } from "@/components/ui/pill";
import { VividLauncher } from "@/components/vivid/vivid-voice-control";
import { ArrowUpRight } from "@/components/icons";
import { cn } from "@/lib/utils";
import "./side-menu.css";

/**
 * The landing's phone menu (owner, 2026-09-27): a frosted glass sheet that
 * slides in from the right, with the chapters set as big display words
 * straight on the glass. No cards, no boxes, no borders; space and type
 * scale do the separating. Desktop keeps the inline top nav, so this only
 * exists below `md` and closes itself if the window grows past it.
 *
 * The glass is the owner's call and the one place the landing blurs; where
 * backdrop-filter isn't supported the sheet is a solid dark tint instead.
 *
 * Motion runs on CSS keyframes that start the moment the sheet mounts, so
 * opening never waits on a frame callback; a timer finishes any animation
 * that a stalled timeline (a hidden tab or pane) left at its first frame.
 *
 * It's a real modal dialog: focus moves in and is trapped, the rest of the
 * page goes inert and stops scrolling (the landing's wheel inertia too),
 * Escape or a tap outside the words closes it and focus returns to the
 * hamburger. A chapter closes the menu, then glides to its section and
 * hands focus to it. Reduced motion gets a plain fade.
 */

/** The story in the page's own order; the numbers are the chapter eyebrows'. */
const CHAPTERS = [
  { n: "01", label: "Studio", href: "#go-live" },
  { n: "02", label: "Battles", href: "#backed" },
  { n: "03", label: "Wallet", href: "#paid" },
  { n: "04", label: "Wolf race", href: "#wolf" },
  { n: "05", label: "WorldSpace", href: "#worldspace" },
  { n: "06", label: "Vivid", href: "#vivid" },
];

/** Matched to side-menu.css: the close is ~60% of the open. */
const OPEN_MS = 1650;
const CLOSE_MS = 520;
const FADE_MS = 200;
/** Where the menu stops being a phone menu (Tailwind's `md`). */
const DESKTOP = "(min-width: 768px)";

type Phase = "closed" | "open" | "closing";

const reducedMotion = () => typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SideMenu() {
  const [phase, setPhase] = useState<Phase>("closed");
  const [current, setCurrent] = useState<string | null>(null);
  const { user, isLoading, isAuthenticated } = useAuth();

  const phaseRef = useRef<Phase>("closed");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const released = useRef<(() => void) | null>(null);

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  /** Lock the page behind: no scroll and no wheel glide. */
  const hold = () => {
    if (released.current) return;
    const html = document.documentElement;
    const saved = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter };
    html.style.overflow = "hidden";
    html.style.scrollbarGutter = "stable";
    // The landing's wheel inertia (scroll-stage.tsx) scrolls by script, which
    // `overflow: hidden` doesn't stop. Catch the wheel before it does; the
    // sheet's own native scroll still runs.
    const stopWheel = (e: WheelEvent) => e.stopImmediatePropagation();
    addEventListener("wheel", stopWheel, { capture: true });
    html.dataset.landingMenu = "open";
    released.current = () => {
      html.style.overflow = saved.overflow;
      html.style.scrollbarGutter = saved.gutter;
      removeEventListener("wheel", stopWheel, { capture: true });
      for (const el of Array.from(document.body.querySelectorAll(":scope > [data-side-menu-inert]"))) {
        el.removeAttribute("inert");
        el.removeAttribute("data-side-menu-inert");
      }
    };
  };

  const release = () => {
    released.current?.();
    released.current = null;
  };

  const show = () => {
    if (phaseRef.current === "open") return;
    clearTimeout(timer.current);
    // Which chapter is on screen, so its word reads as "you are here".
    const probe = innerHeight * 0.4;
    let here: string | null = null;
    for (const c of CHAPTERS) {
      const r = document.getElementById(c.href.slice(1))?.getBoundingClientRect();
      if (r && r.top <= probe && r.bottom > probe) here = c.href;
    }
    setCurrent(here);
    hold();
    go("open");
  };

  /**
   * Close. `hash` glides to that section afterwards and `top` to the top of
   * the page; `route` means the page is leaving, so focus goes nowhere.
   */
  const hide = useCallback((after?: { hash?: string; top?: boolean; route?: boolean }) => {
    if (phaseRef.current !== "open") return;
    clearTimeout(timer.current);
    go("closing");
    release();
    const html = document.documentElement;
    html.dataset.landingMenu = "closing";
    const smooth = reducedMotion() ? "auto" : "smooth";

    const target = after?.hash ? document.getElementById(after.hash.slice(1)) : null;
    if (target) {
      history.replaceState(history.state, "", after!.hash);
      target.scrollIntoView({ behavior: smooth, block: "start" });
      // Hand focus to the section, so the next Tab carries on from there.
      if (!target.hasAttribute("tabindex")) {
        target.setAttribute("tabindex", "-1");
        target.setAttribute("data-side-menu-target", "");
      }
      target.focus({ preventScroll: true });
    } else if (after?.top) {
      scrollTo({ top: 0, behavior: smooth });
      triggerRef.current?.focus({ preventScroll: true });
    } else if (!after?.route) {
      triggerRef.current?.focus({ preventScroll: true });
    }

    timer.current = setTimeout(
      () => {
        delete html.dataset.landingMenu;
        go("closed");
      },
      reducedMotion() ? FADE_MS : CLOSE_MS,
    );
  }, []);

  const mounted = phase !== "closed";
  const isOpen = phase === "open";

  // Once the sheet is in the DOM: the rest of the page goes inert, focus
  // moves to Close, and anything a stalled timeline left at its first frame
  // is finished so the sheet can never hang off-screen.
  useEffect(() => {
    if (!isOpen) return;
    for (const el of Array.from(document.body.children)) {
      if (el === rootRef.current || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      el.setAttribute("data-side-menu-inert", "");
    }
    closeRef.current?.focus({ preventScroll: true });
    const guard = setTimeout(() => {
      for (const a of rootRef.current?.getAnimations({ subtree: true }) ?? []) {
        if (a.playState === "running" || a.playState === "paused") a.finish();
      }
    }, OPEN_MS + 250);
    return () => clearTimeout(guard);
  }, [isOpen]);

  // While it's up: Escape, the Tab trap, and closing if the window becomes desktop.
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (phaseRef.current !== "open") return;
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const wide = matchMedia(DESKTOP);
    const onWide = () => wide.matches && hide();
    document.addEventListener("keydown", onKey, true);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      wide.removeEventListener("change", onWide);
    };
  }, [mounted, hide]);

  // Leaving the page while it's open: give the page back.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      released.current?.();
      delete document.documentElement.dataset.landingMenu;
    },
    [],
  );

  const onChapter = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    hide({ hash: href });
  };

  /** A tap on the glass itself (not a word or a button) closes, like the scrim. */
  const onGlass = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest("a, button")) hide();
  };

  const n = CHAPTERS.length;

  return (
    <>
      <MenuToggle
        ref={triggerRef}
        onClick={show}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={mounted ? "landing-side-menu" : undefined}
        className="md:hidden"
      />

      {mounted &&
        createPortal(
          <div ref={rootRef} className="xm-root" data-state={phase} data-theme="dark">
            <div className="xm-scrim" aria-hidden onClick={() => hide()} />
            <div
              ref={panelRef}
              id="landing-side-menu"
              role="dialog"
              aria-modal="true"
              aria-labelledby="landing-side-menu-title"
              inert={!isOpen}
              className="xm-panel"
              onClick={onGlass}
            >
              <div className="xm-head">
                <Link
                  href="/"
                  className="xm-rise flex items-center gap-2.5"
                  style={{ "--d": "0ms" } as CSSProperties}
                  aria-label="Xtream home"
                  onClick={(e) => {
                    e.preventDefault();
                    hide({ top: true });
                  }}
                >
                  <BrandMark size={28} />
                  <span className="font-wide text-[21px] font-bold tracking-[-0.04em] text-foreground">Xtream</span>
                </Link>
                <h2 id="landing-side-menu-title" className="sr-only">
                  Menu
                </h2>
                <MenuToggle ref={closeRef} close onClick={() => hide()} aria-label="Close menu" />
              </div>

              <nav aria-label="Chapters" className="xm-body">
                <p className="xm-caption xm-rise caps font-mono" style={{ "--d": "180ms" } as CSSProperties} aria-hidden>
                  The story
                </p>
                <ol className="xm-list">
                  {CHAPTERS.map((c, i) => {
                    const here = c.href === current;
                    return (
                      <li key={c.href} style={{ "--i": i, "--r": n - 1 - i } as CSSProperties}>
                        <a
                          href={c.href}
                          onClick={(e) => onChapter(e, c.href)}
                          aria-current={here ? "location" : undefined}
                          className="xm-link"
                        >
                          <span className="xm-word-wrap">
                            <span className="xm-mask">
                              <span className="xm-word font-wide">{c.label}</span>
                            </span>
                            <span className="xm-line" aria-hidden />
                          </span>
                          <span className="xm-idx font-mono" aria-hidden>
                            {c.n}
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </nav>

              <div className="xm-foot">
                <div className="xm-meta xm-rise" style={{ "--d": `${300 + n * 60}ms` } as CSSProperties}>
                  <Link href="/explore" onClick={() => hide({ route: true })} className="xm-text">
                    Explore live
                    <ArrowUpRight size={15} weight="bold" />
                  </Link>
                  {!isLoading && !isAuthenticated && (
                    <a href={SIGN_IN_URL} onClick={() => hide({ route: true })} className="xm-text">
                      Sign in
                    </a>
                  )}
                  {isAuthenticated && user && (
                    <Link href="/dashboard" onClick={() => hide({ route: true })} className="xm-text">
                      <UserAvatar src={user.avatar} name={user.displayName || user.username} size={22} />
                      <span className="max-w-[9rem] truncate">Your channel</span>
                    </Link>
                  )}
                  {/* Vivid opens its own capsule, which has to live outside
                      the inert page: step out of the way first. */}
                  <div onClickCapture={() => hide()} className="xm-vivid">
                    <VividLauncher variant="pill" />
                  </div>
                </div>
                <div className="xm-rise" style={{ "--d": `${360 + n * 60}ms` } as CSSProperties}>
                  <PillLink
                    href="/studio"
                    variant="primary"
                    size="xl"
                    className="w-full"
                    trailing={<ArrowUpRight size={17} weight="bold" />}
                    onClick={() => hide({ route: true })}
                  >
                    Start streaming
                  </PillLink>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Two bars. In the nav they're the hamburger; the sheet's Close is drawn at
 * the same spot and the bars cross as the sheet arrives.
 */
function MenuToggle({
  close = false,
  className,
  ref,
  ...rest
}: {
  close?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  onClick: () => void;
  "aria-label": string;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}) {
  return (
    <button ref={ref} type="button" className={cn("xm-toggle press", close && "xm-close", className)} {...rest}>
      <span className="xm-bars" aria-hidden>
        <i />
        <i />
      </span>
    </button>
  );
}
