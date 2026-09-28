"use client";

import { SIGN_IN_URL } from "@/lib/auth-urls";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HouseLine,
  Compass,
  PlayCircle,
  HeartStraight,
  ChartDonut,
  Diamond,
  Faders,
  SignOut,
  Users,
  SignIn,
  DotsThree,
  Wallet,
  SidebarSimple,
  SealCheck,
  House,
  SquaresFour,
  CaretRight,
  CaretDown,
  ArrowClockwise,
  ChatCircleDots,
  ArrowUpRight,
} from "@/components/icons";
import { ECOSYSTEM } from "@/lib/ecosystem";
import { Tip } from "@/components/ui/tip";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { UnreadNumber, useUnreadBadge } from "@/components/app/messages/unread-badge";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { WolfIcon } from "@/components/ui/wolf-icon";
import { MobileTabBar } from "@/components/app/mobile-tabbar";
import { PhoneDrawer } from "@/components/app/phone-drawer";
import { BalancePills } from "@/components/app/balance-pills";
import { TopBar } from "@/components/app/topbar";
import { RightRail } from "@/components/app/right-rail";
import { StudioHost } from "@/components/app/studio/studio-host";
import { HeldStreamPill, LiveSessionCard, useHeldStream } from "@/components/app/studio/live-session-card";
import { GoLiveFab, GoLiveRailButton } from "@/components/app/go-live-fab";
import { LiveRingsBar } from "@/components/app/live-rings";
import { StudioEdgeSwipe } from "@/components/app/studio-edge-swipe";
import { TourHost } from "@/components/app/tour/tour-host";
import {
  GlassPopover,
  insideGlassPopover,
} from "@/components/ui/glass-popover";

/**
 * App shell and the rail.
 *
 * The rail follows the grammar the socials rework settled on — a 264px
 * column, big 16px labels with 22px glyphs that go solid when active,
 * uppercase eyebrow labels between sections — in Afterglow's finish (the
 * owner's calls, 2026-09-23): three groups — Discover, Create, You — so
 * every key page is one click away; the page you're on is set bold with an
 * Ember dot while the rest sit faint; only the channels *you* follow show
 * here when they're live (the home already shows what's live, so the rail
 * doesn't repeat it); the rest of WorldStreet waits behind one row; and
 * the account at the foot is a card with your points and wallet on it.
 *
 * It collapses to a 72px icon rail — by choice on wide screens, always
 * between 768 and 1024px where a 264px column would leave the page too
 * little room (the tablet band was the shell's broken breakpoint) — and
 * disappears entirely on /welcome, which is a moment rather than a page.
 *
 * Phones never see it: they get the tab bar for the four places to go and
 * the account drawer (`PhoneDrawer`) for everything about you.
 */

const noop = () => {};
const RAIL_OPEN = "16.5rem";
const RAIL_COLLAPSED = "4.5rem";
const COLLAPSE_KEY = "xtreme-rail-collapsed";
const CHROMELESS = ["/welcome"];
/** Phones only: the studio is a viewfinder, and a top bar over a camera
 *  is a bar over the picture. Desktop keeps its chrome. */
const PHONE_CHROMELESS = [
  "/studio",
  // A producer's console is a control surface, like the studio.
  "/produce/",
  // A phone that's a second camera is a viewfinder too.
  "/camera/",
  // An open thread is its own screen on a phone: its header has the way
  // back, and a tab bar under the composer would sit under the keyboard.
  "/messages/",
];
const NO_RAIL = ["/stream/", "/feed", "/studio", "/produce/", "/camera/", "/dashboard", "/settings", "/wallet", "/messages"];

/** True from the `lg` breakpoint up; false for the server paint. */
function useMinWidth(px: number) {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [px]);
  return wide;
}

const useWide = () => useMinWidth(1024);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const wide = useWide();
  const roomy = useMinWidth(1280);
  // The phone drawer: opened from the top bar, closed by any link inside it.
  const [mobileOpen, setMobileOpen] = useState(false);
  // One look for a stream that's holding without this tab: its pill and the
  // Go live button share the corner, so they share the answer too.
  const held = useHeldStream();

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
      } catch {
        // Storage blocked: stay expanded.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // The preference just won't persist.
      }
      return next;
    });

  if (CHROMELESS.includes(pathname)) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }
  const phoneChromeless = PHONE_CHROMELESS.some((p) => pathname.startsWith(p));
  // Tablets get the icon rail whether or not you asked for it — and so does
  // the studio below 1280px, where every pixel belongs to the stage.
  const narrow = collapsed || !wide || ((pathname.startsWith("/studio") || pathname.startsWith("/produce/")) && !roomy);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={narrow} onToggle={wide ? toggle : undefined} />
      <main
        data-app-main
        className={cn(
          "flex min-h-screen flex-col transition-[margin] duration-300 md:ml-[var(--rail-w)] md:pb-0",
          phoneChromeless ? "pb-0" : "pb-[calc(3.75rem+env(safe-area-inset-bottom))]",
        )}
        style={{ "--rail-w": narrow ? RAIL_COLLAPSED : RAIL_OPEN } as React.CSSProperties}
      >
        {/* The wrapper carries the stickiness: a sticky child can't outlive a
            parent exactly its own height, so the bar scrolled away. */}
        <div data-app-chrome className={cn("sticky top-0 z-30", phoneChromeless && "hidden md:block")}>
          <TopBar onMenu={() => setMobileOpen(true)} />
          {/* Phones, on Home, Browse and Messages: who's live, under the bar. */}
          <LiveRingsBar />
        </div>
        <div className="flex min-h-0 flex-1 items-start">
          <div className="min-w-0 flex-1">
            {/* The studio lives here, beside every page: it's the page on
                /studio, and once you're live it stays mounted — minimized —
                wherever you go, so browsing never takes you off the air. */}
            <StudioHost />
            {children}
          </div>
          {/* The right rail rides beside browsing pages on wide screens. The
              watch page has chat there, the feed and studio own the screen. */}
          {!NO_RAIL.some((p) => pathname.startsWith(p)) && <RightRail />}
        </div>
      </main>
      {!phoneChromeless && (
        <>
          <MobileTabBar />
          <PhoneDrawer open={mobileOpen} onOpenChange={setMobileOpen} />
          <HeldStreamPill held={held} />
          <GoLiveFab held={Boolean(held)} />
          <StudioEdgeSwipe disabled={mobileOpen} />
        </>
      )}
      {/* The walkthrough: one tour at a time, on first visits and first times. */}
      <TourHost />
    </div>
  );
}

/* ------------------------------------------------------------------ */

type NavItem = {
  label: string;
  href: string;
  icon: typeof House;
  public: boolean;
};

// Glyphs are the abstract, two-tone Phosphor set: shapes rather than
// literal pictures, filled solid on the active row.
const MAIN_NAV: NavItem[] = [
  { label: "Home", href: "/explore", icon: HouseLine, public: true },
  { label: "Browse", href: "/browse", icon: Compass, public: true },
  { label: "Live feed", href: "/feed", icon: PlayCircle, public: true },
  { label: "Following", href: "/following", icon: HeartStraight, public: false },
  { label: "Messages", href: "/messages", icon: ChatCircleDots, public: true },
];

/**
 * Making things. Go live leads the group as its own button (open to
 * everyone, so a visitor sees they could) — it offers Start now or Schedule
 * live, which is where the Studio row used to go. "Your channel" is the
 * channel and the dashboard in one place (owner, 2026-09-24); the public
 * page is a button inside it.
 */
const CREATE_NAV: NavItem[] = [
  { label: "Your channel", href: "/dashboard", icon: ChartDonut, public: false },
];

/** Yours — signed in only. Notifications live on the top bar's bell. */
function youNav(): NavItem[] {
  return [
    { label: "Wallet", href: "/wallet", icon: Wallet, public: false },
    { label: "Rewards", href: "/rewards", icon: Diamond, public: false },
    { label: "Settings", href: "/settings", icon: Faders, public: false },
  ];
}

/** Section eyebrow — the small uppercase label between groups. */
function Eyebrow({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-auto my-3 h-px w-6 bg-tint/[0.08]" />;
  return (
    <p className="px-3.5 pt-5 pb-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase select-none">
      {children}
    </p>
  );
}

export function Sidebar({
  collapsed = false,
  onToggle,
}: {
  collapsed?: boolean;
  /** Absent when the width is forced (tablets) — no toggle to show then. */
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const userRef = useRef<HTMLDivElement>(null);
  const [appsAnchor, setAppsAnchor] = useState<DOMRect | null>(null);
  const appsRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!appsAnchor) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (insideGlassPopover(t) || appsRef.current?.contains(t)) return;
      setAppsAnchor(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAppsAnchor(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [appsAnchor]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (insideGlassPopover(t)) return;
      if (!userRef.current?.contains(t)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const narrow = collapsed;
  // Threads with something new from someone else — one shared poll with
  // the phone drawer's copy (lib/messaging.ts). It pops in, rolls, and the
  // icon shakes once when another conversation becomes unread.
  const { shown: unreadThreads, iconRef: unreadIcon, badgeRef: unreadBadge } = useUnreadBadge(Boolean(user));

  // Schedule and Sponsorships live inside Your channel, so they light that row.
  const isActive = (href: string) =>
    pathname === href ||
    pathname.startsWith(href + "/") ||
    (href === "/dashboard" && (pathname.startsWith("/schedule") || pathname.startsWith("/sponsorships")));

  const renderItem = (item: NavItem, index: number, offset: number) => {
    const active = isActive(item.href);
    // Chili is for counts that need you now (design system); the Ember dot
    // still marks the page you're on.
    const messages = item.href === "/messages";
    const count = messages ? unreadThreads : 0;
    const glyph = <item.icon size={22} weight={active ? "fill" : "regular"} className="shrink-0" aria-hidden />;
    return (
      <Tip key={item.href} label={count > 0 ? `${item.label} · ${count} unread` : item.label} side="right" disabled={!narrow}>
      <Link
        href={item.href}
        data-tour={`nav-${item.href.slice(1)}`}
        aria-label={narrow ? (count > 0 ? `${item.label}, ${count} unread` : item.label) : undefined}
        aria-current={active ? "page" : undefined}
        style={{ animationDelay: `${offset + index * 30}ms` }}
        className={cn(
          "animate-rise group relative flex items-center gap-3 rounded-control py-2 transition-colors",
          narrow ? "justify-center px-0 py-2.5" : "px-3.5",
          // The page you're on is set bold and bright with its Ember dot;
          // everything else sits faint until you reach for it.
          active ? "font-bold text-foreground" : "font-medium text-foreground/60 hover:text-foreground/90"
        )}
      >
        <span className="relative shrink-0">
          {messages ? (
            <span ref={unreadIcon} className="block">
              {glyph}
            </span>
          ) : (
            glyph
          )}
          {count > 0 && narrow && (
            // On the icon rail the count shrinks to a dot on the glyph's corner.
            <span ref={unreadBadge} className="absolute -top-1 -right-1 size-2.5 rounded-full bg-chili ring-2 ring-background">
              <span className="sr-only">{count} unread</span>
            </span>
          )}
        </span>
        {!narrow && <span className="text-[16px] tracking-[-0.005em]">{item.label}</span>}
        {count > 0 && !narrow && (
          <span
            ref={unreadBadge}
            className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-chili px-1.5 text-[11px] font-bold text-white tabular-nums"
          >
            <UnreadNumber count={count} />
          </span>
        )}
        {active && !narrow && (
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full bg-ember", count > 0 ? "ml-2" : "ml-auto")} />
        )}
        {active && narrow && (
          // On the icon rail the dot sits under the glyph, as on the phone's tab bar.
          <span aria-hidden className="absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-ember" />
        )}
      </Link>
      </Tip>
    );
  };

  const mainItems = user ? MAIN_NAV : MAIN_NAV.filter((l) => l.public);
  const createItems = user ? CREATE_NAV : CREATE_NAV.filter((l) => l.public);

  return (
    <>
      <aside
        data-app-chrome
        style={{ width: narrow ? RAIL_COLLAPSED : RAIL_OPEN }}
        className="fixed inset-y-0 left-0 z-50 hidden flex-col bg-surface transition-[width] duration-300 md:flex"
      >
        {/* Brand, with the collapse control beside it — up top, where the
            rail's own controls belong (owner, 2026-09-23). */}
        <div className={cn("animate-rise flex h-16 shrink-0 items-center shadow-[inset_0_-1px_0_var(--hairline-color)]", narrow ? "flex-col justify-center gap-0.5 pt-1" : "justify-between pr-3 pl-5")}>
          <Tip label="Xtream home" side="right" disabled={!narrow}>
          <Link href="/" className="group flex items-center gap-2.5" aria-label={narrow ? "Xtream home" : undefined}>
            <span className="flex size-[38px] items-center justify-center">
              <BrandMark size={30} />
            </span>
            {!narrow && (
              <span className="text-[22px] font-bold tracking-tight text-foreground">Xtream</span>
            )}
          </Link>
          </Tip>
          {onToggle && (
            <Tip label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"} side="right">
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={collapsed}
              className="press flex size-9 items-center justify-center rounded-full text-foreground/70 transition-colors hover:bg-tint/[0.05] hover:text-foreground"
            >
              {/* Rail on the left, like ours — Solar draws it on the right. */}
              <SidebarSimple size={20} mirrored />
            </button>
            </Tip>
          )}
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10", narrow ? "px-2" : "px-3")}>
          {/* Your broadcast, while you browse — or, after a reload, the
              stream waiting for you to pick it back up. */}
          <LiveSessionCard collapsed={narrow} />
          <nav className="flex flex-col gap-px" aria-label="Main">
            {mainItems.map((item, i) => renderItem(item, i, 60))}

            <Eyebrow collapsed={narrow}>Create</Eyebrow>
            <div data-tour="go-live" className={cn("animate-rise", narrow ? "py-1" : "px-0.5 pt-0.5 pb-1.5")} style={{ animationDelay: "170ms" }}>
              <GoLiveRailButton collapsed={narrow} />
            </div>
            {createItems.map((item, i) => renderItem(item, i, 180))}

            {user && (
              <>
                <Eyebrow collapsed={narrow}>You</Eyebrow>
                {youNav().map((item, i) => renderItem(item, i, 260))}
              </>
            )}
          </nav>

          <LiveRail collapsed={narrow} pathname={pathname} onNavigate={noop} />

          <div className="flex-1" />

          {/* The rest of WorldStreet, behind one row — a panel of apps opens
              beside the rail rather than a wall of tiles inside it. */}
          <Tip label="WorldStreet apps" side="right" disabled={!narrow || Boolean(appsAnchor)}>
          <button
            ref={appsRef}
            type="button"
            onClick={(e) => {
              // Read the rect now: React clears currentTarget once the handler returns.
              const rect = e.currentTarget.getBoundingClientRect();
              setAppsAnchor((open) => (open ? null : rect));
            }}
            aria-haspopup="dialog"
            aria-expanded={Boolean(appsAnchor)}
            aria-label={narrow ? "WorldStreet apps" : undefined}
            className={cn(
              "group mt-3 flex items-center gap-3 rounded-control py-2 transition-colors",
              narrow ? "justify-center px-0 py-2.5" : "px-3.5",
              appsAnchor ? "font-bold text-foreground" : "font-medium text-foreground/60 hover:text-foreground/90",
            )}
          >
            <SquaresFour size={21} weight={appsAnchor ? "fill" : "regular"} className="shrink-0" aria-hidden />
            {!narrow && (
              <>
                <span className="text-[16px]">WorldStreet apps</span>
                <CaretRight size={13} weight="bold" className="ml-auto opacity-60" aria-hidden />
              </>
            )}
          </button>
          </Tip>
          {appsAnchor && (
            <GlassPopover anchor={appsAnchor} width={320} className="p-2">
              <p className="px-2.5 pt-1.5 pb-2 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase">More from WorldStreet</p>
              <div className="grid gap-px">
                {ECOSYSTEM.filter((app) => app.title !== "Vivid AI").map((app) => (
                  <a
                    key={app.title}
                    href={app.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setAppsAnchor(null)}
                    className="group/app flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors hover:bg-tint/[0.05]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-control text-foreground">
                      <app.icon size={18} weight="duotone" aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col leading-tight">
                      <span className="truncate text-[14px] font-semibold text-foreground">{app.title}</span>
                      <span className="truncate text-[12px] text-muted-foreground">{app.description}</span>
                    </span>
                    <ArrowUpRight size={13} className="shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/app:opacity-100" aria-hidden />
                  </a>
                ))}
              </div>
            </GlassPopover>
          )}

        </div>

        {/* The foot: the Wolf race, then the account — pinned, never scrolled
            out of view under the list. */}
        <div className={cn("shrink-0", narrow ? "border-t border-tint/[0.06] px-2 pt-1" : "px-3 pt-1")}>
          {/* The Wolf of WorldStreet race, at the foot of the rail (owner,
              2026-09-24) — the one place foil is allowed: the pelt. */}
          <Tip label="Wolf of WorldStreet: the most-backed creator wears the pelt" side="right" disabled={!narrow}>
          <a
            href="https://social.worldstreetgold.com/votes"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={narrow ? "Wolf of WorldStreet" : undefined}
            className={cn(
              "group/wolf flex items-center gap-3 rounded-panel transition-colors",
              narrow ? "justify-center py-2" : "bg-tint/[0.035] p-2.5 hover:bg-tint/[0.06]",
            )}
          >
            <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-foil text-[#1a1206]", narrow ? "size-8" : "size-9")}>
              <WolfIcon size={narrow ? 16 : 18} />
            </span>
            {!narrow && (
              <>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate text-[14.5px] font-semibold text-foreground">Wolf of WorldStreet</span>
                  <span className="truncate text-[12.5px] text-muted-foreground">Who wears the pelt?</span>
                </span>
                <ArrowUpRight size={13} className="shrink-0 text-muted-foreground/50 transition-colors group-hover/wolf:text-foreground" aria-hidden />
              </>
            )}
          </a>
          </Tip>
        </div>
        <div className={cn("shrink-0", narrow ? "p-2" : "p-3")} ref={userRef}>
          {user ? (
            <>
              {menuOpen && menuAnchor && (
                <GlassPopover anchor={menuAnchor} width={236} className="py-1">
                  <Link href={`/c/${user.username}`} data-vivid-own-channel onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/90 transition-colors hover:bg-tint/[0.04]">
                    <Users size={15} />
                    View public page
                  </Link>
                  <a href="https://dashboard.worldstreetgold.com" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/90 transition-colors hover:bg-tint/[0.04]">
                    <Wallet size={15} />
                    WorldStreet dashboard
                  </a>
                  <div className="my-1 border-t border-tint/[0.06]" />
                  <button onClick={() => logout()} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-tint/[0.04]">
                    <SignOut size={15} />
                    Log out @{user.username}
                  </button>
                </GlassPopover>
              )}
              <div className={cn(!narrow && "rounded-panel bg-tint/[0.035] p-1.5")}>
              <Tip label="Your account" side="right" disabled={!narrow || menuOpen}>
              <button
                data-tour="account-menu"
                onClick={(e) => {
                  setMenuAnchor(e.currentTarget.getBoundingClientRect());
                  setMenuOpen((v) => !v);
                }}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                aria-label={narrow ? `Your account, ${user.displayName || user.username}` : undefined}
                className={cn("group flex w-full items-center gap-3 rounded-control p-2 text-left transition-colors hover:bg-tint/[0.04]", narrow && "justify-center")}
              >
                <span className="relative shrink-0">
                  <UserAvatar src={user.avatar} name={user.displayName || user.username} size={40} className="size-10 ring-1 ring-tint/[0.08]" />
                  {user.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-chili ring-2 ring-background" />}
                </span>
                {!narrow && (
                  <>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                        <span className="truncate">{user.displayName}</span>
                        {"verified" in user && (user as { verified?: boolean }).verified && (
                          <SealCheck size={13} weight="fill" className="shrink-0 text-sky-400" />
                        )}
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground">@{user.username}</span>
                    </span>
                    <DotsThree size={20} weight="bold" className="shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                  </>
                )}
              </button>
              </Tip>
              {!narrow && <BalancePills size="sm" className="px-1 pt-0.5 pb-1" />}
              </div>
            </>
          ) : isLoading ? (
            <div className={cn("flex items-center gap-3 p-2.5", narrow && "justify-center")}>
              <div className="size-10 shrink-0 animate-pulse rounded-full bg-tint/10" />
              {!narrow && <div className="h-3 w-24 animate-pulse rounded-full bg-tint/10" />}
            </div>
          ) : (
            <div className={cn(!narrow && "px-1.5 pb-1")}>
              {!narrow && (
                <p className="mb-3 text-[14.5px] leading-snug text-foreground/85">
                  Follow creators, send gifts and earn points on every stream.
                </p>
              )}
              <Tip label="Sign in" side="right" disabled={!narrow}>
              <a
                href={SIGN_IN_URL}
                aria-label={narrow ? "Sign in" : undefined}
                className={cn(
                  "press flex items-center justify-center gap-2 rounded-full transition-[filter,background-color]",
                  narrow
                    ? "mx-auto size-10 bg-control text-foreground hover:bg-control-hover"
                    : "h-11 bg-inverse text-[15px] font-semibold text-on-inverse hover:brightness-95",
                )}
              >
                <SignIn size={16} weight="bold" />
                {!narrow && "Sign in"}
              </a>
              </Tip>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */

interface LiveRow {
  _id: string;
  title: string;
  viewers: number;
  startedAt?: string;
  streamerId?: { _id?: string; displayName?: string; username?: string; avatar?: string };
  /** Co-hosts on the stage, so the rail can say who someone is live with. */
  guests?: Array<{ username: string; avatar: string; status: string }>;
}

interface FollowedRow {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  stream: { id: string; title: string; viewers: number; startedAt?: string } | null;
}

interface RailEntry {
  key: string;
  href: string;
  /** The handle — what the row leads with, TikTok-style ("spyda767"). */
  handle: string;
  /** The nickname under it ("SPYDA 🇺🇸"). */
  name: string;
  avatar: string;
  /** The stream's title, for the tooltip. */
  subtitle: string;
  viewers: number;
  /** Whoever else is on the stage right now — the rail shows the first. */
  coHosts?: Array<{ username: string; avatar: string }>;
}

/**
 * A live creator on the rail, the way TikTok LIVE lists them: the face in
 * its heat ring with a small LIVE tag under it, the handle in bold, the
 * nickname beneath, and how many are watching on the right.
 */
function ChannelRow({ entry, collapsed, onNavigate }: { entry: RailEntry; collapsed: boolean; onNavigate: () => void }) {
  const withThem = entry.coHosts ?? [];
  const face = (size: number) => (
    <span className="relative flex shrink-0 flex-col items-center">
      <UserAvatar src={entry.avatar} name={entry.name} size={size} ring="live" ringGapClassName="bg-background" />
      <span className="absolute -bottom-1 rounded-[4px] bg-chili px-1 py-px text-[7.5px] leading-none font-bold tracking-[0.06em] text-white uppercase ring-2 ring-background">
        Live
      </span>
    </span>
  );
  if (collapsed) {
    return (
      <Tip label={`@${entry.handle} · ${formatNumber(entry.viewers)} watching`} side="right">
        <Link
          href={entry.href}
          onClick={onNavigate}
          aria-label={`@${entry.handle}, live: ${entry.subtitle}, ${formatNumber(entry.viewers)} watching`}
          className="flex justify-center rounded-control py-2 transition-colors hover:bg-tint/[0.04]"
        >
          {face(28)}
        </Link>
      </Tip>
    );
  }
  return (
    <Link href={entry.href} onClick={onNavigate} title={entry.subtitle} className="group flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors hover:bg-tint/[0.04]">
      {face(32)}
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[15px] font-bold text-foreground">{entry.handle}</span>
        <span className="truncate text-[13px] text-muted-foreground">
          {entry.name}
          {withThem[0] && <span className="text-muted-foreground/70"> · with {withThem[0].username}</span>}
        </span>
      </span>
      <span className="shrink-0 text-[13px] font-semibold text-foreground/75 tabular-nums">{formatNumber(entry.viewers)}</span>
    </Link>
  );
}

function RailSection({
  title,
  live,
  entries,
  collapsed,
  onNavigate,
  trailing,
  footer,
}: {
  title: string;
  live?: boolean;
  entries: RailEntry[];
  collapsed: boolean;
  onNavigate: () => void;
  trailing?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (entries.length === 0) return null;
  return (
    <div>
      {collapsed ? (
        <div className="mx-auto my-3 h-px w-6 bg-tint/[0.08]" title={title} />
      ) : (
        <div className="flex items-center gap-1.5 px-3.5 pt-5 pb-1.5">
          {live && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-chili opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-chili" />
            </span>
          )}
          <p className="flex-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase select-none">{title}</p>
          {trailing}
        </div>
      )}
      <div className="space-y-0.5">
        {entries.map((e) => <ChannelRow key={e.key} entry={e} collapsed={collapsed} onNavigate={onNavigate} />)}
      </div>
      {!collapsed && footer}
    </div>
  );
}

/**
 * The rail's live sections: channels you follow, then — on a watch page —
 * what this stream's audience also watches. Nothing else: what's live for
 * everyone is the home's job, and the rail doesn't repeat it.
 */
function LiveRail({ collapsed, pathname, onNavigate }: { collapsed: boolean; pathname: string; onNavigate: () => void }) {
  const { isAuthenticated } = useAuth();
  const [top, setTop] = useState<LiveRow[]>([]);
  const [followed, setFollowed] = useState<FollowedRow[]>([]);
  const [also, setAlso] = useState<LiveRow[]>([]);
  // Suggestions: how far into the pool the refresh button has turned, and
  // whether "See all" opened the longer list.
  const [turn, setTurn] = useState(0);
  const [more, setMore] = useState(false);
  const watchingId = pathname.startsWith("/stream/") ? pathname.split("/")[2] ?? null : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // The biggest rooms feed the suggestions.
        const res = await apiFetch<{ success: boolean; data: { streams: LiveRow[] } }>(`/api/streams?live=true&sort=viewers&limit=30`);
        if (cancelled) return;
        setTop(res.data.streams);
      } catch {
        // Section simply stays hidden.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 45_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);


  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ success: boolean; data: { channels: FollowedRow[] } }>(`/api/user/me/following`);
        if (!cancelled) setFollowed(res.data.channels);
      } catch {
        // Falls back to the top-live list alone.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 45_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!watchingId) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ success: boolean; data: { streams: LiveRow[] } }>(`/api/streams/${watchingId}/also-watched`);
        if (!cancelled) setAlso(res.data.streams);
      } catch {
        if (!cancelled) setAlso([]);
      }
    }
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [watchingId]);

  const toEntry = (s: LiveRow): RailEntry => ({
    key: s._id,
    href: `/stream/${s._id}`,
    handle: s.streamerId?.username || "streamer",
    name: s.streamerId?.displayName || s.streamerId?.username || "Streamer",
    avatar: s.streamerId?.avatar ?? "",
    subtitle: s.title,
    viewers: s.viewers,
    coHosts: (s.guests ?? [])
      .filter((g) => g.status === "live")
      .map((g) => ({ username: g.username, avatar: g.avatar })),
  });

  const followedLive: RailEntry[] = (isAuthenticated ? followed : [])
    .filter((c) => c.isLive && c.stream)
    .slice(0, 6)
    .map((c) => ({
      key: c.id,
      href: `/stream/${c.stream!.id}`,
      handle: c.username,
      name: c.displayName || c.username,
      avatar: c.avatar,
      subtitle: c.stream!.title,
      viewers: c.stream!.viewers,
    }));

  const shown = new Set<string>(followedLive.map((e) => e.key));
  if (watchingId) shown.add(watchingId);
  const alsoWatch = (watchingId ? also : []).filter((s) => !shown.has(s._id)).slice(0, 4).map(toEntry);
  alsoWatch.forEach((e) => shown.add(e.key));
  // Suggested live creators, TikTok's list: the biggest rooms you don't
  // follow, eight at a time; refresh turns to the next eight, See all
  // opens the longer list. The icon rail keeps only the channels you follow.
  const followedStreamers = new Set(followed.filter((c) => c.isLive).map((c) => c.id));
  const pool = top.filter((s) => !shown.has(s._id) && !followedStreamers.has(String(s.streamerId?._id ?? "")));
  const per = more ? 16 : 8;
  const start = pool.length > per ? (turn * 8) % pool.length : 0;
  const suggested = [...pool.slice(start), ...pool.slice(0, start)].slice(0, per).map(toEntry);

  if (followedLive.length + alsoWatch.length + suggested.length === 0) return null;

  return (
    <div data-tour="live-now" className="animate-rise mt-1" style={{ animationDelay: "380ms" }}>
      <RailSection title="Followed channels" live entries={followedLive} collapsed={collapsed} onNavigate={onNavigate} />
      <RailSection title="Viewers also watch" entries={alsoWatch} collapsed={collapsed} onNavigate={onNavigate} />
      {!collapsed && (
        <RailSection
          title="Suggested live"
          entries={suggested}
          collapsed={false}
          onNavigate={onNavigate}
          trailing={
            pool.length > 8 ? (
              <button
                type="button"
                onClick={() => setTurn((t) => t + 1)}
                aria-label="Show other creators"
                title="Show other creators"
                className="press -my-1 flex size-6 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-tint/[0.06] hover:text-foreground"
              >
                <ArrowClockwise size={13} weight="bold" />
              </button>
            ) : null
          }
          footer={
            pool.length > 8 ? (
              <button
                type="button"
                onClick={() => setMore((m) => !m)}
                className="mt-1 flex items-center gap-1.5 px-3.5 py-1.5 text-[12.5px] font-semibold text-ember-hi transition-colors hover:text-foreground"
              >
                <CaretDown size={12} weight="bold" className={cn("transition-transform", more && "rotate-180")} />
                {more ? "Show less" : "See all"}
              </button>
            ) : null
          }
        />
      )}
    </div>
  );
}
