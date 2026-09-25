"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HouseLine, Compass, PlayCircle, Broadcast, ChatCircleDots } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * The phone's primary navigation: five tabs, Go live in the middle
 * (owner, 2026-09-24: Go live left the top bar; Following moved to the
 * drawer, Messages joined the bar).
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
 * regular, 22px, and fill only when their tab is the page you're on — which
 * also wears a small Ember dot under its label (owner's pick, 2026-09-23).
 */

const TABS = [
  { label: "Home", href: "/explore", icon: HouseLine },
  { label: "Browse", href: "/browse", icon: Compass },
  { label: "Go live", href: "/studio", icon: Broadcast, create: true },
  { label: "Live feed", href: "/feed", icon: PlayCircle, live: true },
  { label: "Messages", href: "/messages", icon: ChatCircleDots },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = useAuth();

  // No bar on the watch page or the feed — the picture owns the screen.
  if (pathname.startsWith("/stream/") || pathname === "/feed") return null;

  const is = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      aria-label="Primary"
      className="tabbar-glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((t) => {
        const active = is(t.href);
        if ("create" in t) {
          // Go live, in the middle, in heat — solid Chili once you're on air.
          const live = user?.isLive ?? false;
          return (
            <Link key={t.href} href={t.href} aria-label={live ? "On air — open the studio" : "Go live"} className="press flex h-[58px] items-center justify-center">
              <span
                className={cn(
                  "flex h-9 w-12 items-center justify-center rounded-[12px] text-white",
                  "bg-chili",
                )}
              >
                <t.icon size={20} weight="fill" aria-hidden />
              </span>
            </Link>
          );
        }
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "press relative flex h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-semibold tracking-[0.01em]",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <t.icon size={23} weight={active ? "fill" : "regular"} aria-hidden />
            {"live" in t && t.live && !active && (
              // A broadcast dot: streams are happening now, not a backlog.
              <span className="absolute top-2.5 right-[calc(50%-16px)] size-1.5 rounded-full bg-chili" aria-hidden />
            )}
            {t.label}
            {active && (
              <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-ember motion-safe:animate-[xt-pop_.35s_var(--ease-spring)_both]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
