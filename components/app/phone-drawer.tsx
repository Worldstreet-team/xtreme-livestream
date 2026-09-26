"use client";

import { SIGN_IN_URL } from "@/lib/auth-urls";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ChartDonut,
  Wallet,
  Diamond,
  Faders,
  HeartStraight,
  ChatCircleDots,
  SignOut,
  SignIn,
  X,
  SealCheck,
} from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { useUnreadThreads } from "@/lib/messaging";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { BalancePills } from "@/components/app/balance-pills";
import { LauncherGrid } from "@/components/app/launcher-grid";

/**
 * The phone drawer: everything about *you*, sliding in from the left.
 *
 * It is not the desktop rail squeezed narrower. The tab bar already holds
 * the four places to go, so this is the account: your face and handle,
 * points and wallet as two pills you can tap, the pages that are yours
 * (channel, dashboard, wallet, rewards, notifications, settings), the rest
 * of WorldStreet as a launcher grid, and Sign out pinned at the foot. Signed out it is a
 * single invitation.
 *
 * 82% of the screen, rounded on its open edge, the studio sheet's surface
 * turned on its side. It springs in on the same overshoot curve the sheets
 * use and goes away on a backdrop tap, Escape, a swipe left, or any link.
 */

const SPRING = "cubic-bezier(0.22, 1.15, 0.36, 1)";

type Row = {
  label: string;
  href: string;
  icon: typeof Wallet;
  /** Something waiting for you there (unread threads). */
  count?: number;
};

export function PhoneDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();
  const close = () => onOpenChange(false);
  // Shared with the rail's badge: one poll between them (lib/messaging.ts).
  const unreadThreads = useUnreadThreads(Boolean(user));

  // Mount only while open or leaving, so the closed drawer costs nothing
  // and the slide-out finishes before it unmounts.
  const [present, setPresent] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setPresent(true);
      // A timer, not a frame: the closed transform has to paint first, and
      // frames don't run in a hidden tab, where a timer still does.
      const t = setTimeout(() => setShown(true), 20);
      return () => clearTimeout(t);
    }
    setShown(false);
    const t = setTimeout(() => setPresent(false), 320);
    return () => clearTimeout(t);
  }, [open]);

  // A route change closes it — reconciled during render, no extra pass.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (open) onOpenChange(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Swipe left to dismiss: a horizontal drag past 56px, or a flick.
  const drag = useRef<{ x: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, t: performance.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x;
    const v = dx / Math.max(1, performance.now() - d.t);
    if (dx < -56 || v < -0.6) close();
  };

  if (!present) return null;

  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const mine: Row[] = user
    ? [
        // Channel and dashboard are one place now (owner, 2026-09-24).
        { label: "Your channel", href: "/dashboard", icon: ChartDonut },
        { label: "Following", href: "/following", icon: HeartStraight },
        // The tab bar holds the four places to go, so on a phone this row is
        // the way into your threads.
        { label: "Messages", href: "/messages", icon: ChatCircleDots, count: unreadThreads },
        { label: "Wallet", href: "/wallet", icon: Wallet },
        { label: "Rewards", href: "/rewards", icon: Diamond },
        { label: "Settings", href: "/settings", icon: Faders },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label="Close menu"
        onClick={close}
        className="absolute inset-0 bg-black/55 transition-opacity duration-300"
        style={{ opacity: shown ? 1 : 0 }}
      />
      <div
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        className="drawer-obj absolute inset-y-0 left-0 flex w-[82vw] max-w-[340px] flex-col rounded-r-overlay pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] motion-reduce:transition-none"
        style={{
          transform: shown ? "translateX(0)" : "translateX(-104%)",
          transition: `transform ${shown ? 380 : 260}ms ${shown ? SPRING : "cubic-bezier(0.4, 0, 1, 1)"}`,
        }}
      >
        {/* Header: who you are, or the way in. */}
        {user ? (
          <div className="flex items-center gap-3.5 px-5 pt-5 pb-4">
            <span className="relative shrink-0">
              <UserAvatar src={user.avatar} name={user.displayName || user.username} size={52} className="size-[52px] ring-1 ring-white/[0.1]" />
              {user.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full bg-chili ring-2 ring-card" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="flex items-center gap-1 text-[17px] font-semibold tracking-[-0.01em] text-foreground">
                <span className="truncate">{user.displayName}</span>
                {"verified" in user && (user as { verified?: boolean }).verified && (
                  <SealCheck size={14} weight="fill" className="shrink-0 text-sky-400" />
                )}
              </span>
              <span className="truncate text-[12.5px] text-muted-foreground">@{user.username}</span>
            </span>
            <button type="button" onClick={close} aria-label="Close menu" className="press flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-foreground">
              <X size={16} weight="bold" />
            </button>
          </div>
        ) : (
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <BrandMark size={28} />
                <span className="text-[19px] font-bold tracking-tight text-foreground">Xtream</span>
              </span>
              <button type="button" onClick={close} aria-label="Close menu" className="press flex size-9 items-center justify-center rounded-full bg-white/[0.06] text-foreground">
                <X size={16} weight="bold" />
              </button>
            </div>
            {!isLoading && (
              <>
                <p className="mt-5 text-[15px] leading-snug text-foreground/85">
                  Sign in to follow channels, earn points and go live yourself.
                </p>
                <a href={SIGN_IN_URL} className="press mt-4 flex h-11 items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-black">
                  <SignIn size={17} weight="bold" />
                  Sign in
                </a>
              </>
            )}
          </div>
        )}

        {user && <BalancePills className="px-4 pb-3" />}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-none">
          {mine.length > 0 && (
            <nav className="flex flex-col gap-0.5" aria-label="You">
              {mine.map((r) => (
                <DrawerRow key={r.href} row={r} active={active(r.href)} />
              ))}
            </nav>
          )}

          <p className="px-3.5 pt-5 pb-1.5 text-[10.5px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase select-none">
            WorldStreet
          </p>
          <LauncherGrid className="px-1" />
        </div>

        {user && (
          <div className="shrink-0 px-4 pt-2 pb-4">
            <button
              type="button"
              onClick={() => logout()}
              className="press flex h-11 w-full items-center justify-center gap-2 rounded-full bg-control text-[15px] font-semibold text-foreground"
            >
              <SignOut size={17} />
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One of your pages. The one you're on is the lit row, as on the rail. */
function DrawerRow({ row, active }: { row: Row; active: boolean }) {
  return (
    <Link
      href={row.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "press relative flex items-center gap-3.5 rounded-control px-3.5 py-3 text-[15px] font-medium",
        active ? "bg-white/[0.07] text-foreground" : "text-foreground/90",
      )}
    >
      <row.icon size={22} weight={active ? "fill" : "regular"} className={cn("shrink-0", active ? "text-foreground" : "text-foreground/75")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{row.label}</span>
      {row.count ? (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-chili px-1.5 text-[11px] font-bold text-white tabular-nums">
          {row.count > 99 ? "99+" : row.count}
          <span className="sr-only"> unread</span>
        </span>
      ) : null}
      {active && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ember" />}
    </Link>
  );
}
