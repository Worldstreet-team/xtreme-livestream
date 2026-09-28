"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DropdownMenu as Menu } from "radix-ui";
import { Broadcast, CalendarPlus } from "@/components/icons";
import { Tip } from "@/components/ui/tip";
import { useAuth } from "@/lib/auth-context";
import { signInHref } from "@/lib/auth-urls";
import { useLiveSession } from "@/lib/live-session";
import { cn } from "@/lib/utils";

/**
 * Go live, as one floating action with two ways in: Start now (the studio)
 * or Schedule live (the booking form on /schedule). On phones it's a round
 * Chili button over the bottom-right of the page, above the tab bar; on
 * wider screens it's the rail's Go live button, and the menu floats beside
 * it. Solid Chili, not heat (owner, 2026-09-24: "make it one solid color").
 *
 * Once you're on air there's nothing to choose, so it shows the live state
 * and opens the studio. Signed out, it's the way to sign in and come back
 * to the studio.
 */

const START = { href: "/studio", label: "Start now", hint: "Open the studio and go on air" };
// The schedule page opens on its booking form — that's the "new booking".
const SCHEDULE = { href: "/schedule", label: "Schedule live", hint: "Book it so Allies can set a reminder" };

/** Your broadcast here (the studio's session) or anywhere (the account says so). */
export function useOnAir() {
  const { user } = useAuth();
  const session = useLiveSession();
  return { session, live: Boolean(session) || Boolean(user?.isLive) };
}

/** The pulsing white dot that stands in for the icon while you're on air. */
function AirDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative flex size-2.5", className)}>
      <span className="absolute inline-flex size-full rounded-full bg-white opacity-75 motion-safe:animate-ping" />
      <span className="relative inline-flex size-2.5 rounded-full bg-white" />
    </span>
  );
}

/** One row of the menu: a glyph tile, the action, and why you'd pick it. */
function OptionBody({ start, label, hint }: { start: boolean; label: string; hint: string }) {
  const Glyph = start ? Broadcast : CalendarPlus;
  return (
    <>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-[10px]",
          start ? "bg-chili text-white" : "bg-control text-foreground",
        )}
      >
        <Glyph size={19} weight="fill" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="text-[15px] font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 text-[12.5px] text-muted-foreground">{hint}</span>
      </span>
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Phones: the floating button, bottom-right above the tab bar and the
 * home indicator. It steps aside wherever the screen is already somebody's
 * — the studio, a producer's console, a second camera and an open thread
 * (the shell drops it there with the rest of the phone chrome), the watch
 * page and the live feed — and while the minimized studio or the "your
 * stream is holding" pill already sits down there: both are your live
 * state, and both open the studio.
 */
const FLOATING = false;

/**
 * Go live as the middle tab of the phone's tab bar: a solid Chili tile with
 * the play mark, opening the same Start now / Schedule live sheet. On air
 * it reads "On air" and goes straight back to the studio; signed out it
 * goes to sign in first.
 */
export function GoLiveTab() {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { live } = useOnAir();
  const [open, setOpen] = useState(false);
  const fresh = useStudioNew();
  const tabRef = useRef<HTMLButtonElement>(null);

  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }

  const cell = "press relative flex h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-semibold tracking-[0.01em] text-foreground";
  // A raised circle, like the floating button it replaced (owner, 2026-09-28: "maintain its circular shape").
  const tile =
    "relative -mt-4 flex size-12 items-center justify-center rounded-full bg-chili text-white shadow-[0_8px_18px_-8px_rgba(0,0,0,0.6)] ring-4 ring-background";

  if (isLoading) {
    return (
      <span className={cell} aria-hidden>
        <span className={cn(tile, "bg-control")} />
        Go live
      </span>
    );
  }
  if (!user) {
    return (
      <a href={signInHref("/studio")} data-tour="go-live" aria-label="Sign in to go live" className={cell}>
        <span className={tile}>
          <Broadcast size={21} weight="fill" aria-hidden />
        </span>
        Go live
      </a>
    );
  }
  if (live) {
    return (
      <Link href="/studio" data-tour="go-live" aria-label="On air — open the studio" className={cell}>
        <span className={tile}>
          <AirDot />
        </span>
        On air
      </Link>
    );
  }
  return (
    <>
      <button
        ref={tabRef}
        type="button"
        data-tour="go-live"
        onClick={() => setOpen(true)}
        aria-label={fresh ? "Go live, new" : "Go live"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cell}
      >
        <span className={tile}>
          <Broadcast size={21} weight="fill" aria-hidden />
          {fresh && <NewBadge className="absolute -top-1.5 -right-4" />}
        </span>
        Go live
      </button>
      {open && (
        <GoLiveSheet
          onDismiss={() => {
            setOpen(false);
            tabRef.current?.focus();
          }}
          onPick={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function GoLiveFab({ held = false }: { held?: boolean }) {
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const { session, live } = useOnAir();
  const [open, setOpen] = useState(false);
  const fresh = useStudioNew();
  const fabRef = useRef<HTMLButtonElement>(null);

  // A new page closes the sheet — adjusted during render against the last
  // path seen, so there's no effect-driven second pass.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) setOpen(false);
  }

  // Go live moved into the middle of the tab bar (owner, 2026-09-28); the
  // floating button stays retired unless it's asked for again.
  if (!FLOATING) return null;
  if (isLoading) return null;
  if (pathname.startsWith("/stream/") || pathname === "/feed") return null;
  if (session || held) return null;

  const place =
    "fixed right-4 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+1rem)] z-40 md:hidden";
  const face =
    "press flex items-center justify-center rounded-full bg-chili text-white shadow-[0_10px_24px_-8px_rgba(0,0,0,0.55)] transition-[filter] hover:brightness-110 motion-safe:animate-[pop-in_320ms_var(--ease-spring)_both]";

  if (!user) {
    return (
      <a href={signInHref("/studio")} data-tour="go-live" aria-label="Sign in to go live" className={cn(place, face, "size-14")}>
        <Broadcast size={24} weight="fill" aria-hidden />
      </a>
    );
  }

  if (live) {
    return (
      <Link href="/studio" data-tour="go-live" aria-label="On air — open the studio" className={cn(place, face, "h-12 gap-2 px-4 text-[14px] font-semibold")}>
        <AirDot />
        On air
      </Link>
    );
  }

  return (
    <>
      <button
        ref={fabRef}
        data-tour="go-live"
        type="button"
        onClick={() => setOpen(true)}
        aria-label={fresh ? "Go live, new" : "Go live"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(place, face, "size-14")}
      >
        <Broadcast size={24} weight="fill" aria-hidden />
        {fresh && <NewBadge className="absolute -top-1 -left-2.5" />}
      </button>
      {open && (
        <GoLiveSheet
          onDismiss={() => {
            setOpen(false);
            fabRef.current?.focus();
          }}
          onPick={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The phone's menu: a sheet from the foot of the screen, the app's sheet
 * grammar (scrim, thumb, rounded top) with menu semantics — focus lands on
 * the first option, the arrows move between them, Escape (or Tab, or a
 * tap on the scrim) plays the exit and hands focus back to the button.
 */
export function GoLiveSheet({ onDismiss, onPick }: { onDismiss: () => void; onPick: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  // The exit plays before unmounting; a hidden tab never ends an
  // animation, so a timer lands it anyway.
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onDismiss, 320);
    return () => clearTimeout(t);
  }, [closing, onDismiss]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      setClosing(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  // Portaled: the rings row opens it from inside the sticky chrome, whose
  // stacking context would otherwise put the tab bar over the sheet.
  return createPortal(
    <div
      className={cn("fixed inset-0 z-[60] flex items-end bg-black/65 md:hidden", closing ? "animate-fade-out" : "animate-fade-in")}
      onClick={() => setClosing(true)}
    >
      <div
        ref={menuRef}
        role="menu"
        aria-label="Go live"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        onAnimationEnd={(e) => closing && e.target === e.currentTarget && onDismiss()}
        className={cn(
          "w-full rounded-t-overlay bg-popover px-3 pt-2 pb-[max(env(safe-area-inset-bottom),14px)] shadow-overlay",
          closing ? "animate-sheet-down" : "animate-sheet-up",
        )}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/40" />
        <p className="px-3 pb-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Go live</p>
        {[START, SCHEDULE].map((o) => (
          <Link
            key={o.href}
            href={o.href}
            role="menuitem"
            onClick={onPick}
            className="flex h-[64px] w-full items-center gap-3.5 rounded-control px-3 transition-colors outline-none hover:bg-control focus-visible:bg-control"
          >
            <OptionBody start={o === START} label={o.label} hint={o.hint} />
          </Link>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */

/**
 * Wider screens: Go live in the rail — a Chili pill, or a round button on
 * the icon rail — and its menu, a popover beside it (Radix: menu roles,
 * arrow keys, Escape, focus back on the button).
 */
/* ---------- the New badge: the studio changed, until you've been ---------- */

const STUDIO_SEEN = "xtream:studio-new-seen";
const STUDIO_SEEN_EVENT = "xtream:studio-new-seen";

function readStudioSeen() {
  try {
    return localStorage.getItem(STUDIO_SEEN) === "1";
  } catch {
    return true; // Storage blocked: no badge rather than one that never goes.
  }
}

/**
 * Whether to show "New" on the studio's way in (owner, 2026-09-28: "in the
 * studio nav show a new badge"). It goes the first time you open the studio.
 */
function useStudioNew() {
  const pathname = usePathname() ?? "";
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    const sync = () => setFresh(!readStudioSeen());
    const frame = requestAnimationFrame(sync);
    window.addEventListener(STUDIO_SEEN_EVENT, sync);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(STUDIO_SEEN_EVENT, sync);
    };
  }, []);
  useEffect(() => {
    if (!pathname.startsWith("/studio")) return;
    try {
      localStorage.setItem(STUDIO_SEEN, "1");
    } catch {
      // Fine: it just shows again next time.
    }
    window.dispatchEvent(new Event(STUDIO_SEEN_EVENT));
  }, [pathname]);
  return fresh;
}

function NewBadge({ className }: { className?: string }) {
  return (
    <span className={cn("pointer-events-none rounded-full bg-inverse px-1.5 py-[3px] text-[10px] leading-none font-bold tracking-[0.02em] text-on-inverse uppercase motion-safe:animate-[pop-in_320ms_var(--ease-spring)_both]", className)}>
      New
    </span>
  );
}

export function GoLiveRailButton({ collapsed = false, className }: { collapsed?: boolean; className?: string }) {
  const { user, isLoading } = useAuth();
  const { live } = useOnAir();
  const fresh = useStudioNew();

  const face = cn(
    "press relative flex shrink-0 items-center justify-center gap-2 rounded-full bg-chili font-semibold whitespace-nowrap text-white transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    collapsed ? "mx-auto size-10" : "h-11 w-full text-[15px]",
    className,
  );

  if (isLoading) return <div aria-hidden className={cn(face, "animate-pulse bg-control")} />;

  if (!user) {
    return (
      <Tip label="Sign in to go live" side="right" disabled={!collapsed}>
        <a href={signInHref("/studio")} aria-label="Sign in to go live" className={face}>
          <Broadcast size={17} weight="fill" aria-hidden />
          {!collapsed && "Go live"}
        </a>
      </Tip>
    );
  }

  if (live) {
    return (
      <Tip label="You're on air — open the studio" side="right" disabled={!collapsed}>
        <Link href="/studio" aria-label="On air — open the studio" className={face}>
          <AirDot className="size-2 [&>span]:size-2" />
          {!collapsed && "On air"}
        </Link>
      </Tip>
    );
  }

  return (
    <Menu.Root>
      {/* The tip wraps the trigger, so the menu's own handlers and the tip's both reach the button. */}
      <Tip label="Go live" side="right" disabled={!collapsed}>
        <Menu.Trigger asChild>
          <button type="button" aria-label={fresh ? "Go live, new" : "Go live"} className={face}>
            <Broadcast size={17} weight="fill" aria-hidden />
            {!collapsed && "Go live"}
            {fresh && <NewBadge className={collapsed ? "absolute -top-1.5 -right-2" : "ml-0.5"} />}
          </button>
        </Menu.Trigger>
      </Tip>
      <Menu.Portal>
        <Menu.Content
          side="right"
          align="start"
          sideOffset={14}
          collisionPadding={12}
          aria-label="Go live"
          className="z-[70] w-[320px] rounded-panel bg-popover p-1.5 shadow-popover outline-none motion-safe:animate-[pop-in_220ms_var(--ease-spring)_both]"
        >
          {[START, SCHEDULE].map((o) => (
            <Menu.Item key={o.href} asChild>
              <Link
                href={o.href}
                className="flex w-full cursor-pointer items-center gap-3 rounded-control px-2.5 py-2 transition-colors outline-none data-[highlighted]:bg-control"
              >
                <OptionBody start={o === START} label={o.label} hint={o.hint} />
              </Link>
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
