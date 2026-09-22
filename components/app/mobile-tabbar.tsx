"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HouseLine, Compass, Pulse, HeartStraight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * The phone's primary navigation: four tabs, one row.
 *
 * Home, Browse, Live feed, Following — the same four the desktop rail
 * leads with, so a viewer moving between a laptop and a phone finds the
 * same doors in the same order. Go live is not here: it is the red pill in
 * the top bar, where it reads as the one action rather than a fifth place
 * to go. Everything about you lives in the drawer the top bar opens.
 *
 * The bar wears the search button's tone as frosted glass (the owner's one
 * ask for blur, 2026-09-22) so the page shows through beneath it, and it
 * sits over the content rather than pushing it up. Glyphs are Phosphor
 * regular, 22px, and fill only when their tab is the page you're on.
 */

const TABS = [
  { label: "Home", href: "/explore", icon: HouseLine },
  { label: "Browse", href: "/browse", icon: Compass },
  { label: "Live feed", href: "/feed", icon: Pulse, live: true },
  { label: "Following", href: "/following", icon: HeartStraight },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();

  // No bar on the watch page or the feed — the picture owns the screen.
  if (pathname.startsWith("/stream/") || pathname === "/feed") return null;

  const is = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      aria-label="Primary"
      className="tabbar-glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 rounded-t-[18px] pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((t) => {
        const active = is(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press relative flex h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-semibold tracking-[0.01em]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <t.icon size={22} weight={active ? "fill" : "regular"} aria-hidden />
            {"live" in t && t.live && !active && (
              // A broadcast dot: streams are happening now, not a backlog.
              <span className="absolute top-2.5 right-[calc(50%-16px)] size-1.5 rounded-full bg-chili" aria-hidden />
            )}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
