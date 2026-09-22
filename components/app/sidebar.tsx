"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HouseLine,
  Compass,
  Pulse,
  HeartStraight,
  ChartDonut,
  Diamond,
  Faders,
  SignOut,
  X,
  Users,
  SignIn,
  ArrowUpRight,
  DotsThree,
  SquaresFour,
  Wallet,
  Eye,
  CaretDown,
  CaretDoubleLeft,
  CaretDoubleRight,
  SealCheck,
  House,
} from "@phosphor-icons/react";
import { ECOSYSTEM } from "@/lib/ecosystem";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api-client";
import { formatNumber } from "@/lib/categories";
import { formatUptime } from "@/lib/discovery";
import { useNow } from "@/lib/use-now";
import { useEffect, useRef, useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { BrandMark } from "@/components/ui/brand-mark";
import { MobileTabBar } from "@/components/app/mobile-tabbar";
import { TopBar } from "@/components/app/topbar";
import { RightRail } from "@/components/app/right-rail";
import {
  GlassPopover,
  insideGlassPopover,
} from "@/components/ui/glass-popover";

/**
 * App shell and the rail.
 *
 * The rail follows the grammar the socials rework settled on: a 264px
 * column, big 16px labels with 22px glyphs that go solid when active,
 * uppercase eyebrow labels between sections, the ecosystem as an inline
 * accordion rather than a hidden popover, one tall primary action with a
 * highlight that sweeps every few seconds, and the account as a proper
 * block at the foot — avatar, name, handle. Corners stay square-ish
 * throughout; the modern feel is the type scale and the rhythm, not radius.
 *
 * It collapses to a 72px icon rail, and disappears entirely on /welcome,
 * which is a moment rather than a page.
 */

const RAIL_OPEN = "16.5rem";
const RAIL_COLLAPSED = "4.5rem";
const COLLAPSE_KEY = "xtreme-rail-collapsed";
const CHROMELESS = ["/welcome"];
/** Phones only: the studio is a viewfinder, and a top bar over a camera
 *  is a bar over the picture. Desktop keeps its chrome. */
const PHONE_CHROMELESS = ["/studio"];
const NO_RAIL = ["/stream/", "/feed", "/studio", "/dashboard", "/settings", "/wallet"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  // The phone drawer: opened from the top bar, closed by any link inside it.
  const [mobileOpen, setMobileOpen] = useState(false);

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

  return (
    <div className="min-h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggle={toggle} mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <main
        className={cn(
          "flex min-h-screen flex-col transition-[margin] duration-300 md:ml-[var(--rail-w)] md:pb-0",
          phoneChromeless ? "pb-0" : "pb-16",
        )}
        style={{ "--rail-w": collapsed ? RAIL_COLLAPSED : RAIL_OPEN } as React.CSSProperties}
      >
        <div className={cn(phoneChromeless && "hidden md:block")}>
          <TopBar onMenu={() => setMobileOpen(true)} />
        </div>
        <div className="flex min-h-0 flex-1 items-start">
          <div className="min-w-0 flex-1">{children}</div>
          {/* The right rail rides beside browsing pages on wide screens. The
              watch page has chat there, the feed and studio own the screen. */}
          {!NO_RAIL.some((p) => pathname.startsWith(p)) && <RightRail />}
        </div>
      </main>
      {!phoneChromeless && <MobileTabBar />}
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
  { label: "Live feed", href: "/feed", icon: Pulse, public: true },
  { label: "Following", href: "/following", icon: HeartStraight, public: false },
];

const YOU_NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: ChartDonut, public: false },
  { label: "Wallet", href: "/wallet", icon: Wallet, public: false },
  { label: "Rewards", href: "/rewards", icon: Diamond, public: false },
  { label: "Settings", href: "/settings", icon: Faders, public: false },
];

/** Section eyebrow — the small uppercase label between groups. */
function Eyebrow({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  if (collapsed) return <div className="mx-auto my-3 h-px w-6 bg-white/[0.08]" />;
  return (
    <p className="px-3.5 pt-5 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase select-none">
      {children}
    </p>
  );
}

export function Sidebar({
  collapsed = false,
  onToggle,
  mobileOpen = false,
  onMobileOpenChange,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const setMobileOpen = (open: boolean) => onMobileOpenChange?.(open);
  const { user, isLoading, logout } = useAuth();
  const [productsOpen, setProductsOpen] = useState(false);
  const [liveCount, setLiveCount] = useState(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const userRef = useRef<HTMLDivElement>(null);

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

  const closeMobile = () => setMobileOpen(false);
  const narrow = collapsed && !mobileOpen;

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const renderItem = (item: NavItem, index: number, offset: number) => {
    const active = isActive(item.href);
    const showLiveDot = item.href === "/feed" && liveCount > 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={closeMobile}
        title={narrow ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        style={{ animationDelay: `${offset + index * 30}ms` }}
        className={cn(
          "animate-rise group relative flex items-center gap-3 rounded-sm py-2.5 transition-colors",
          narrow ? "justify-center px-0" : "px-3.5",
          // Inactive rows stay fully legible — the active one is marked by
          // its fill, not by dimming everything else.
          active
            ? "bg-white/[0.07] font-semibold text-foreground"
            : "text-foreground/85 hover:bg-white/[0.04] hover:text-foreground"
        )}
      >
        <item.icon size={22} weight={active ? "fill" : "duotone"} className="shrink-0" aria-hidden />
        {!narrow && <span className="text-[16px]">{item.label}</span>}
        {showLiveDot && (
          // A broadcast dot, not a count: streams are happening now, they
          // aren't a backlog.
          <span
            className={cn("relative flex size-2 shrink-0", narrow ? "absolute top-2 right-2.5" : "ml-auto")}
            title={`${liveCount} live now`}
          >
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
        )}
      </Link>
    );
  };

  const mainItems = user ? MAIN_NAV : MAIN_NAV.filter((l) => l.public);

  return (
    <>
      {mobileOpen && (
        <div className="animate-fade-in fixed inset-0 z-40 bg-black/60 md:hidden" onClick={closeMobile} />
      )}

      <aside
        style={{ width: narrow ? RAIL_COLLAPSED : RAIL_OPEN }}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/[0.06] bg-[oklch(0.12_0.005_285)] transition-[transform,width] duration-300",
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
          "max-md:!w-[16.5rem]"
        )}
      >
        {/* Brand */}
        <div className={cn("animate-rise flex h-[76px] shrink-0 items-center", narrow ? "justify-center" : "justify-between px-5")}>
          <Link href="/" className="group flex items-center gap-2.5" title="Xtream">
            <span className="flex size-[38px] items-center justify-center">
              <BrandMark size={30} />
            </span>
            {!narrow && (
              <span className="text-[22px] font-bold tracking-tight text-foreground">Xtream</span>
            )}
          </Link>
          <button onClick={closeMobile} aria-label="Close menu" className="text-muted-foreground transition-colors hover:text-foreground md:hidden">
            <X size={18} />
          </button>
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto pb-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10", narrow ? "px-2" : "px-3")}>
          <nav className="flex flex-col gap-0.5">
            {mainItems.map((item, i) => renderItem(item, i, 60))}

            {user && (
              <>
                <Eyebrow collapsed={narrow}>You</Eyebrow>
                {YOU_NAV.map((item, i) => renderItem(item, i, 220))}
              </>
            )}

            {/* Products expands inline so the ecosystem is one glance away. */}
            <div className="animate-rise" style={{ animationDelay: "300ms" }}>
              <button
                type="button"
                onClick={() => setProductsOpen((v) => !v)}
                aria-expanded={productsOpen}
                title={narrow ? "More from WorldStreet" : undefined}
                className={cn(
                  "flex w-full items-center gap-3 rounded-sm py-2.5 text-left transition-colors",
                  narrow ? "justify-center px-0" : "px-3.5",
                  productsOpen ? "text-foreground" : "text-foreground/85 hover:bg-white/[0.04] hover:text-foreground"
                )}
              >
                <SquaresFour size={22} weight={productsOpen ? "fill" : "duotone"} className="shrink-0" />
                {!narrow && (
                  <>
                    <span className="flex-1 text-[16px]">Products</span>
                    <CaretDown size={14} className={cn("text-muted-foreground/60 transition-transform", productsOpen && "rotate-180")} />
                  </>
                )}
              </button>
              {!narrow && (
                <div className={cn("grid transition-[grid-template-rows] duration-200", productsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="overflow-hidden">
                    <div className="flex flex-col py-0.5 pl-3">
                      {ECOSYSTEM.map((app) => (
                        <a
                          key={app.title}
                          href={app.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group/app relative flex items-center gap-2.5 rounded-sm py-2 pr-7 pl-3 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
                        >
                          <app.icon size={16} className="shrink-0 opacity-70 transition-opacity group-hover/app:opacity-100" />
                          <span className="flex min-w-0 flex-1 flex-col leading-tight">
                            <span className="truncate text-[13.5px]">{app.title}</span>
                            <span className="truncate text-[11px] text-muted-foreground/60">{app.description}</span>
                          </span>
                          <ArrowUpRight size={12} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground/50 opacity-0 transition-opacity group-hover/app:opacity-100" />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

          </nav>

          <LiveRail collapsed={narrow} pathname={pathname} onNavigate={closeMobile} onLiveCount={setLiveCount} />

          <div className="flex-1" />

          {onToggle && (
            <button
              type="button"
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={collapsed}
              className={cn(
                "mt-3 hidden items-center gap-3 rounded-sm py-2 text-[13px] text-muted-foreground/60 transition-colors hover:text-foreground md:flex",
                narrow ? "justify-center px-0" : "px-3.5"
              )}
            >
              {collapsed ? <CaretDoubleRight size={16} /> : (<><CaretDoubleLeft size={16} /> Collapse</>)}
            </button>
          )}
        </div>

        {/* Account */}
        <div className={cn("shrink-0 border-t border-white/[0.06]", narrow ? "p-2" : "p-3")} ref={userRef}>
          {user ? (
            <>
              {menuOpen && menuAnchor && (
                <GlassPopover anchor={menuAnchor} width={236} className="py-1">
                  <Link href={`/c/${user.username}`} data-vivid-own-channel onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/90 transition-colors hover:bg-white/[0.04]">
                    <Users size={15} />
                    Your channel
                  </Link>
                  <a href="https://dashboard.worldstreetgold.com" target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/90 transition-colors hover:bg-white/[0.04]">
                    <Wallet size={15} />
                    WorldStreet dashboard
                  </a>
                  <div className="my-1 border-t border-white/[0.06]" />
                  <button onClick={() => logout()} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-red-400 transition-colors hover:bg-white/[0.04]">
                    <SignOut size={15} />
                    Log out @{user.username}
                  </button>
                </GlassPopover>
              )}
              <button
                onClick={(e) => {
                  setMenuAnchor(e.currentTarget.getBoundingClientRect());
                  setMenuOpen((v) => !v);
                }}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                title={narrow ? user.displayName : undefined}
                className={cn("group flex w-full items-center gap-3 rounded-sm p-2.5 text-left transition-colors hover:bg-white/[0.04]", narrow && "justify-center")}
              >
                <span className="relative shrink-0">
                  <UserAvatar src={user.avatar} name={user.displayName || user.username} size={40} className="size-10 ring-1 ring-white/[0.08]" />
                  {user.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-red-500 ring-2 ring-[oklch(0.12_0.005_285)]" />}
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
            </>
          ) : isLoading ? (
            <div className={cn("flex items-center gap-3 p-2.5", narrow && "justify-center")}>
              <div className="size-10 shrink-0 animate-pulse rounded-full bg-white/10" />
              {!narrow && <div className="h-3 w-24 animate-pulse rounded-full bg-white/10" />}
            </div>
          ) : (
            <a
              href="https://www.worldstreetgold.com/login"
              title={narrow ? "Sign in" : undefined}
              className="flex h-11 items-center justify-center gap-2 rounded-sm bg-white/[0.06] text-[15px] font-semibold text-foreground transition-colors hover:bg-white/[0.09]"
            >
              <SignIn size={16} />
              {!narrow && "Sign in"}
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
  name: string;
  avatar: string;
  subtitle: string;
  viewers: number;
  startedAt?: string;
  /** Whoever else is on the stage right now — the rail shows the first. */
  coHosts?: Array<{ username: string; avatar: string }>;
}

function ChannelRow({ entry, now, collapsed, onNavigate }: { entry: RailEntry; now: number; collapsed: boolean; onNavigate: () => void }) {
  const uptime = entry.startedAt ? formatUptime(entry.startedAt, now) : "";
  const withThem = entry.coHosts ?? [];
  if (collapsed) {
    return (
      <Link href={entry.href} onClick={onNavigate} title={`${entry.name} — ${entry.subtitle} · ${formatNumber(entry.viewers)} watching`} className="flex justify-center rounded-sm py-1.5 transition-colors hover:bg-white/[0.04]">
        <span className="relative shrink-0">
          <UserAvatar src={entry.avatar} name={entry.name} size={30} className="size-[30px]" />
          <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-red-500 ring-2 ring-[oklch(0.12_0.005_285)]" />
        </span>
      </Link>
    );
  }
  return (
    <Link href={entry.href} onClick={onNavigate} className="flex items-center gap-2.5 rounded-sm px-3.5 py-2 transition-colors hover:bg-white/[0.04]">
      {/* Two faces when the stage is shared — the co-host sits behind. */}
      <span className="relative flex shrink-0 -space-x-2">
        <UserAvatar src={entry.avatar} name={entry.name} size={30} className="relative z-10 size-[30px]" />
        {withThem[0] && (
          <UserAvatar src={withThem[0].avatar} name={withThem[0].username} size={30} className="size-[30px]" />
        )}
        <span className="absolute -right-0.5 -bottom-0.5 z-20 size-2 rounded-full bg-red-500 ring-2 ring-[oklch(0.12_0.005_285)]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13.5px] font-medium text-foreground/90">
          {entry.name}
          {withThem[0] && (
            <span className="text-muted-foreground/70">
              {" "}with {withThem[0].username}
              {withThem.length > 1 && ` +${withThem.length - 1}`}
            </span>
          )}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground/70">{entry.subtitle}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end leading-tight text-[11px] text-muted-foreground tabular-nums">
        <span className="flex items-center gap-1"><Eye size={11} />{formatNumber(entry.viewers)}</span>
        {uptime && <span className="text-muted-foreground/50">{uptime}</span>}
      </span>
    </Link>
  );
}

function RailSection({ title, live, entries, now, collapsed, onNavigate }: { title: string; live?: boolean; entries: RailEntry[]; now: number; collapsed: boolean; onNavigate: () => void }) {
  if (entries.length === 0) return null;
  return (
    <div>
      {collapsed ? (
        <div className="mx-auto my-3 h-px w-6 bg-white/[0.08]" title={title} />
      ) : (
        <p className="flex items-center gap-1.5 px-3.5 pt-5 pb-1.5 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase select-none">
          {live && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
            </span>
          )}
          {title}
        </p>
      )}
      <div className="space-y-0.5">
        {entries.map((e) => <ChannelRow key={e.key} entry={e} now={now} collapsed={collapsed} onNavigate={onNavigate} />)}
      </div>
    </div>
  );
}

/**
 * The rail's live sections: channels you follow, then — on a watch page —
 * what this stream's audience also watches, then what else is live. Never
 * empty, even signed out.
 */
function LiveRail({ collapsed, pathname, onNavigate, onLiveCount }: { collapsed: boolean; pathname: string; onNavigate: () => void; onLiveCount: (n: number) => void }) {
  const { isAuthenticated } = useAuth();
  const [top, setTop] = useState<LiveRow[]>([]);
  const [total, setTotal] = useState(0);
  const [followed, setFollowed] = useState<FollowedRow[]>([]);
  const [also, setAlso] = useState<LiveRow[]>([]);
  const now = useNow(true);
  const watchingId = pathname.startsWith("/stream/") ? pathname.split("/")[2] ?? null : null;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ success: boolean; data: { streams: LiveRow[]; pagination: { total: number } } }>(`/api/streams?live=true&limit=8&sort=viewers`);
        if (cancelled) return;
        setTop(res.data.streams);
        setTotal(res.data.pagination.total);
      } catch {
        // Section simply stays hidden.
      }
    }
    void load();
    const timer = setInterval(() => void load(), 45_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => { onLiveCount(total); }, [total, onLiveCount]);

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
    name: s.streamerId?.displayName || s.streamerId?.username || "Streamer",
    avatar: s.streamerId?.avatar ?? "",
    subtitle: s.title,
    viewers: s.viewers,
    ...(s.startedAt ? { startedAt: s.startedAt } : {}),
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
      name: c.displayName || c.username,
      avatar: c.avatar,
      subtitle: c.stream!.title,
      viewers: c.stream!.viewers,
      ...(c.stream!.startedAt ? { startedAt: c.stream!.startedAt } : {}),
    }));

  const shown = new Set<string>(followedLive.map((e) => e.key));
  if (watchingId) shown.add(watchingId);
  const alsoWatch = (watchingId ? also : []).filter((s) => !shown.has(s._id)).slice(0, 4).map(toEntry);
  alsoWatch.forEach((e) => shown.add(e.key));
  const followedStreamers = new Set(followed.filter((c) => c.isLive).map((c) => c.id));
  const recommended = top
    .filter((s) => !shown.has(s._id) && !followedStreamers.has(String(s.streamerId?._id ?? "")))
    .slice(0, followedLive.length + alsoWatch.length > 0 ? 3 : 6)
    .map(toEntry);

  if (followedLive.length + alsoWatch.length + recommended.length === 0) return null;

  return (
    <div className="animate-rise mt-1" style={{ animationDelay: "380ms" }}>
      <RailSection title="Followed channels" live entries={followedLive} now={now} collapsed={collapsed} onNavigate={onNavigate} />
      <RailSection title="Viewers also watch" entries={alsoWatch} now={now} collapsed={collapsed} onNavigate={onNavigate} />
      <RailSection
        title={followedLive.length > 0 || alsoWatch.length > 0 ? "Recommended" : "Live now"}
        live={followedLive.length === 0 && alsoWatch.length === 0}
        entries={recommended}
        now={now}
        collapsed={collapsed}
        onNavigate={onNavigate}
      />
    </div>
  );
}
