"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HouseLine, Compass, PlayCircle, ChatCircleDots } from "@/components/icons";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { UnreadNumber, useUnreadBadge } from "@/components/app/messages/unread-badge";

/**
 * The phone's primary navigation: four tabs — Home, Browse, Live feed,
 * Messages. Following lives in the drawer (owner, 2026-09-24), and Go live
 * is not a tab: it floats above the bar's right end (`GoLiveFab`), where it
 * reads as the one action rather than another place to go, and opens a
 * choice of Start now or Schedule live.
 *
 * The bar wears the search button's tone as frosted glass (the owner's one
 * ask for blur, 2026-09-22) so the page shows through beneath it, and it
 * sits over the content rather than pushing it up. Glyphs are Phosphor
 * regular, 22px, and fill only when their tab is the page you're on — which
 * also wears a small Ember dot under its label (owner's pick, 2026-09-23).
 * Messages carries the unread count: it pops in, then rolls, and the icon
 * shakes once when another conversation becomes unread (owner's pick,
 * 2026-09-26).
 */

const TABS = [
  { label: "Home", href: "/explore", icon: HouseLine },
  { label: "Browse", href: "/browse", icon: Compass },
  { label: "Live feed", href: "/feed", icon: PlayCircle },
  { label: "Messages", href: "/messages", icon: ChatCircleDots },
] as const;

export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const unread = useUnreadBadge(Boolean(user));

  // No bar on the watch page or the feed — the picture owns the screen.
  if (pathname.startsWith("/stream/") || pathname === "/feed") return null;

  const is = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      aria-label="Primary"
      className="tabbar-glass fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {TABS.map((t) => {
        const active = is(t.href);
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
            {t.href === "/messages" ? (
              <span className="relative">
                <span ref={unread.iconRef} className="block">
                  <t.icon size={23} weight={active ? "fill" : "regular"} aria-hidden />
                </span>
                {unread.shown > 0 && (
                  <span
                    ref={unread.badgeRef}
                    className="absolute -top-1.5 left-[13px] flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-chili px-1 text-[10px] leading-none font-bold text-white tabular-nums ring-2 ring-background"
                  >
                    <UnreadNumber count={unread.shown} />
                  </span>
                )}
              </span>
            ) : (
              <t.icon size={23} weight={active ? "fill" : "regular"} aria-hidden />
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
