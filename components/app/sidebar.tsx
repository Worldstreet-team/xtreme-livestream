"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Flame,
  Compass,
  ChartLineUp,
  Gear,
  SignOut,
  List,
  X,
  Users,
  Storefront,
  GraduationCap,
  SignIn,
  ArrowUpRight,
  DotsThree,
  SquaresFour,
  Wallet,
  Eye,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { NotificationsBell } from "@/components/app/notifications-bell";
import {
  GlassPopover,
  insideGlassPopover,
} from "@/components/ui/glass-popover";
import { formatNumber } from "@/lib/categories";

/**
 * App shell: a full-height glass column.
 *
 * Restraint is the design: one hairline on the right edge, small radii
 * (rounded-lg), compact controls, generous vertical rhythm, and red spent
 * only where it means something — the Go Live action and live signals.
 * Depth comes from tint and blur, never from borders or shadows inside the
 * column. No gradients anywhere.
 */

const RAIL_WIDTH = "16rem"; // w-64

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main
        className="min-h-screen md:ml-[var(--rail-w)]"
        style={{ "--rail-w": RAIL_WIDTH } as React.CSSProperties}
      >
        {children}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Dashboard", href: "/dashboard", icon: ChartLineUp },
  { label: "Settings", href: "/settings", icon: Gear },
];

/** The rest of the WorldStreet ecosystem — one popover, not four rows. */
const ECOSYSTEM = [
  {
    title: "Worldspace",
    description: "The WorldStreet social feed",
    href: "https://social.worldstreetgold.com",
    icon: Users,
  },
  {
    title: "Shop",
    description: "Merch and gear marketplace",
    href: "https://shop.worldstreetgold.com",
    icon: Storefront,
  },
  {
    title: "Academy",
    description: "Courses and certifications",
    href: "https://academy.worldstreetgold.com",
    icon: GraduationCap,
  },
  {
    title: "Dashboard",
    description: "Wallet, portfolio and settings",
    href: "https://dashboard.worldstreetgold.com",
    icon: Wallet,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isLoading, logout } = useAuth();

  // Popovers: "more" (ecosystem) and "user" (account menu). Panels are
  // portaled beside the column, anchored to the trigger's rect at open time.
  const [openMenu, setOpenMenu] = useState<"more" | "user" | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  const toggleMenu = (
    which: "more" | "user",
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (openMenu === which) {
      setOpenMenu(null);
      return;
    }
    setMenuAnchor(e.currentTarget.getBoundingClientRect());
    setOpenMenu(which);
  };

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (insideGlassPopover(t)) return;
      if (!moreRef.current?.contains(t) && !userRef.current?.contains(t)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  const closeMobile = () => setMobileOpen(false);

  // ---- Sliding active indicator ----
  // One quiet tint glides between nav rows instead of each row painting its
  // own active state.
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{
    top: number;
    height: number;
  } | null>(null);

  const visibleLinks = user ? NAV_LINKS : NAV_LINKS.slice(0, 1);
  const activeHref = visibleLinks.find(
    (l) => pathname === l.href || pathname.startsWith(l.href + "/")
  )?.href;

  useEffect(() => {
    // Measure on the next frame: layout has settled by then, and the lint
    // rule about synchronous setState in effects stays honest.
    const frame = requestAnimationFrame(() => {
      const nav = navRef.current;
      if (!nav) return;
      const el = nav.querySelector<HTMLElement>('[data-active="true"]');
      setIndicator(
        el ? { top: el.offsetTop, height: el.offsetHeight } : null
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [activeHref, user, mobileOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="fixed top-4 left-4 z-50 flex size-9 items-center justify-center rounded-lg border border-white/[0.08] bg-background/70 text-muted-foreground backdrop-blur-xl transition-colors hover:text-foreground md:hidden"
      >
        <List size={18} />
      </button>

      {/* The column */}
      <aside
        style={{ width: RAIL_WIDTH }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.06] bg-[oklch(0.12_0.005_285)]/80 backdrop-blur-2xl transition-transform duration-300",
          // Transform only below md: a desktop transform would turn every
          // fixed descendant's containing block into the column itself.
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="animate-rise flex h-16 shrink-0 items-center justify-between px-5">
          <Link href="/" className="group flex items-center gap-2">
            <Flame
              size={20}
              weight="fill"
              className="shrink-0 text-primary transition-opacity group-hover:opacity-80"
            />
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Xtreme
            </span>
          </Link>
          <button
            onClick={closeMobile}
            aria-label="Close menu"
            className="text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {/* Primary action — compact, deliberate, the only solid red here */}
          <Link
            href="/studio"
            onClick={closeMobile}
            className={cn(
              "animate-rise mt-2 mb-8 flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors",
              user?.isLive
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-primary text-primary-foreground hover:bg-primary/85"
            )}
            style={{ animationDelay: "40ms" }}
          >
            {user?.isLive && (
              <span className="relative flex size-1.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-white" />
              </span>
            )}
            {user?.isLive ? "On air" : "Go live"}
          </Link>

          {/* Nav — rows are quiet; the indicator does the talking */}
          <nav ref={navRef} className="relative">
            {indicator && (
              <div
                aria-hidden
                className="absolute inset-x-0 z-0 rounded-lg bg-white/[0.06] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{ top: indicator.top, height: indicator.height }}
              />
            )}

            <div className="relative z-10 space-y-0.5">
              {visibleLinks.map((link, index) => {
                const isActive = link.href === activeHref;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={closeMobile}
                    data-active={isActive}
                    className={cn(
                      "animate-rise flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    style={{ animationDelay: `${80 + index * 30}ms` }}
                  >
                    <link.icon
                      size={18}
                      weight={isActive ? "fill" : "regular"}
                      className="shrink-0"
                    />
                    {link.label}
                  </Link>
                );
              })}

              <div className="animate-rise" style={{ animationDelay: "150ms" }}>
                <NotificationsBell onNavigate={closeMobile} />
              </div>
            </div>
          </nav>

          {/* Live now */}
          <LiveNow onNavigate={closeMobile} />

          <div className="flex-1" />

          {/* Ecosystem popover */}
          <div ref={moreRef}>
            <button
              onClick={(e) => toggleMenu("more", e)}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                openMenu === "more"
                  ? "font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <SquaresFour size={18} className="shrink-0" />
              More
            </button>

            {openMenu === "more" && menuAnchor && (
              <GlassPopover anchor={menuAnchor} width={296} className="py-1.5">
                <p className="px-4 pt-2.5 pb-1.5 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
                  More from WorldStreet
                </p>
                {ECOSYSTEM.map((app) => (
                  <a
                    key={app.title}
                    href={app.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setOpenMenu(null)}
                    className="group/app flex items-center gap-3 px-3.5 py-2 transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-foreground/80">
                      <app.icon size={17} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm text-foreground">
                        {app.title}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {app.description}
                      </span>
                    </span>
                    <ArrowUpRight
                      size={14}
                      className="shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover/app:opacity-100"
                    />
                  </a>
                ))}
                <p className="mt-1 border-t border-white/[0.06] px-4 pt-2 pb-1.5 text-[0.7rem] text-muted-foreground/50">
                  One account works everywhere.
                </p>
              </GlassPopover>
            )}
          </div>
        </div>

        {/* User */}
        <div
          className="shrink-0 border-t border-white/[0.06] p-3"
          ref={userRef}
        >
          {user ? (
            <>
              {openMenu === "user" && menuAnchor && (
                <GlassPopover anchor={menuAnchor} width={224} className="py-1">
                  <a
                    href="https://dashboard.worldstreetgold.com"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setOpenMenu(null)}
                    className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-foreground/90 transition-colors hover:bg-white/[0.04]"
                  >
                    <Wallet size={15} />
                    WorldStreet dashboard
                  </a>
                  <button
                    onClick={() => logout()}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-red-400 transition-colors hover:bg-white/[0.04]"
                  >
                    <SignOut size={15} />
                    Log out @{user.username}
                  </button>
                </GlassPopover>
              )}
              <button
                onClick={(e) => toggleMenu("user", e)}
                className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-white/[0.04]"
              >
                <span className="relative shrink-0">
                  <UserAvatar
                    src={user.avatar}
                    name={user.displayName || user.username}
                    size={30}
                    className="size-[30px]"
                  />
                  {user.isLive && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-[oklch(0.12_0.005_285)]" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {user.displayName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    @{user.username}
                  </span>
                </span>
                <DotsThree
                  size={18}
                  weight="bold"
                  className="shrink-0 text-muted-foreground/60"
                />
              </button>
            </>
          ) : isLoading ? (
            <div className="flex items-center gap-2.5 p-2">
              <div className="size-[30px] shrink-0 animate-pulse rounded-full bg-white/10" />
              <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />
            </div>
          ) : (
            <a
              href="https://www.worldstreetgold.com/login"
              className="flex h-9 items-center justify-center gap-2 rounded-lg bg-white/[0.06] text-sm font-medium text-foreground transition-colors hover:bg-white/[0.09]"
            >
              <SignIn size={15} />
              Sign in
            </a>
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
  streamerId?: {
    displayName?: string;
    username?: string;
    avatar?: string;
  };
  guests?: Array<{ username: string; avatar: string; status: string }>;
}

/**
 * Who's live right now — the one thing worth glancing at a sidebar for.
 * Hidden entirely when nobody's on.
 */
function LiveNow({ onNavigate }: { onNavigate: () => void }) {
  const [rows, setRows] = useState<LiveRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { streams: LiveRow[] };
        }>(`/api/streams?live=true&limit=5&sort=viewers`);
        if (!cancelled) setRows(res.data.streams);
      } catch {
        // Section simply stays hidden.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 45_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (rows.length === 0) return null;

  return (
    <div className="animate-rise mt-8" style={{ animationDelay: "200ms" }}>
      <p className="flex items-center gap-1.5 px-3 pb-2 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
        </span>
        Live now
      </p>
      <div className="space-y-0.5">
        {rows.map((s) => {
          const name =
            s.streamerId?.displayName || s.streamerId?.username || "Streamer";
          const live = (s.guests ?? []).filter((g) => g.status === "live");
          return (
            <Link
              key={s._id}
              href={`/stream/${s._id}`}
              onClick={onNavigate}
              className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 transition-colors hover:bg-white/[0.04]"
            >
              <span className="relative flex shrink-0 -space-x-2">
                <UserAvatar
                  src={s.streamerId?.avatar ?? ""}
                  name={name}
                  size={24}
                  className="relative z-10 size-6 rounded-full"
                />
                {live[0] && (
                  <UserAvatar
                    src={live[0].avatar}
                    name={live[0].username}
                    size={24}
                    className="size-6 rounded-full"
                  />
                )}
                <span className="absolute -right-0.5 -bottom-0.5 z-20 size-2 rounded-full bg-red-500 ring-2 ring-[oklch(0.12_0.005_285)]" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-xs font-medium text-foreground/90">
                  {name}
                  {live.length > 0 && (
                    <span className="text-muted-foreground/70">
                      {" "}
                      with {live[0].username}
                      {live.length > 1 && ` +${live.length - 1}`}
                    </span>
                  )}
                </span>
                <span className="truncate text-[0.65rem] text-muted-foreground/70">
                  {s.title}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-[0.62rem] text-muted-foreground tabular-nums">
                <Eye size={10} />
                {formatNumber(s.viewers)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
