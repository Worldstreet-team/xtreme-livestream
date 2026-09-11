"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Broadcast, List, SignIn, X, ArrowLeft } from "@phosphor-icons/react";
import { BrandLockup } from "@/components/ui/brand-mark";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { CATEGORY_GROUPS } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { PointsChip } from "@/components/app/points-chip";
import { NotificationsBell } from "@/components/app/notifications-bell";

/**
 * The bar across the top of every page.
 *
 * Desktop: the page's name on the left, search dead centre, Go live on the
 * right — the way Kick and Twitch put it. It is always in view (sticky) and
 * it is the one place search lives; pages don't carry their own box.
 *
 * Phones: the way Twitch's app does it — the brand on the left, a short run
 * of round icons on the right (search, bell, Go live, you), and nothing
 * else. Search opens as a full-width row over the bar rather than squeezing
 * a box between the icons; the avatar opens the drawer.
 *
 * Search resolves as you type against channels (server) and categories
 * (local taxonomy); Enter hands the term to the Explore page.
 */

const SIGN_IN_URL = "https://www.worldstreetgold.com/login";

interface ChannelHit {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
}

/** What the bar calls the page you're on. */
function pageTitle(pathname: string, search: string) {
  if (pathname.startsWith("/explore")) return search ? "Explore" : "Home";
  if (pathname.startsWith("/browse")) return "Browse";
  if (pathname.startsWith("/following")) return "Following";
  if (pathname.startsWith("/feed")) return "Live feed";
  if (pathname.startsWith("/stream/")) return "Watching";
  if (pathname.startsWith("/c/")) return "Channel";
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/studio")) return "Studio";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/wallet")) return "Wallet";
  if (pathname.startsWith("/rewards")) return "Rewards";
  if (pathname.startsWith("/notifications")) return "Notifications";
  return "Xtream";
}

/** A round icon button, the phone bar's unit. */
const ICON_BTN =
  "flex size-9 shrink-0 items-center justify-center rounded-full bg-[#26262D] text-foreground transition-colors hover:bg-[#31313A]";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const [liveTotal, setLiveTotal] = useState<number | null>(null);
  const [battleCount, setBattleCount] = useState(0);
  const [gameCount, setGameCount] = useState(0);
  const [term, setTerm] = useState("");

  // The page's name lives here, not in an h1 on every page, with how much
  // is live right now under it — the one number that matters everywhere.
  useEffect(() => {
    const read = () => setTerm(new URLSearchParams(window.location.search).get("search") ?? "");
    read();
    const onSearch = (e: Event) => setTerm((e as CustomEvent<string>).detail ?? "");
    window.addEventListener("xtreme:search", onSearch);
    return () => window.removeEventListener("xtreme:search", onSearch);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        apiFetch<{ success: boolean; data: { pagination: { total: number } } }>(`/api/streams?live=true&limit=1`).then((r) => r.data.pagination.total).catch(() => null),
        apiFetch<{ success: boolean; data: { battles: unknown[] } }>(`/api/battles/live`).then((r) => r.data.battles.length).catch(() => 0),
        apiFetch<{ success: boolean; data: { items: unknown[] } }>(`/api/games/live`).then((r) => r.data.items.length).catch(() => 0),
      ]).then(([total, battles, games]) => {
        if (cancelled) return;
        if (total !== null) setLiveTotal(total);
        setBattleCount(battles);
        setGameCount(games);
      });
    void load();
    const t = setInterval(load, 45_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const title = pageTitle(pathname, term);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // Phones: the search row over the bar.
  const [searchOpen, setSearchOpen] = useState(false);
  const [channels, setChannels] = useState<ChannelHit[]>([]);
  const boxRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus();
  }, [searchOpen]);

  // A route change closes the phone search row — adjusted during render
  // against the last path seen, so there's no effect-driven second pass.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setSearchOpen(false);
    setOpen(false);
  }

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch<{ success: boolean; data: { users: ChannelHit[] } }>(`/api/users/search?q=${encodeURIComponent(term)}&limit=5`)
        .then((r) => !cancelled && setChannels(r.data.users))
        .catch(() => !cancelled && setChannels([]));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const categories = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) return [];
    return CATEGORY_GROUPS.flatMap((g) => g.topics).filter((t) => t.toLowerCase().includes(term)).slice(0, 5);
  }, [q]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    setOpen(false);
    setSearchOpen(false);
    router.push(`/explore?search=${encodeURIComponent(term)}`);
    // Already on Explore: the page won't remount, so hand it the term directly.
    window.dispatchEvent(new CustomEvent("xtreme:search", { detail: term }));
  };

  // Stale hits from a longer term are dropped rather than cleared in an effect.
  const hits = q.trim().length >= 2 ? channels : [];
  const showList = open && q.trim().length >= 2 && (hits.length > 0 || categories.length > 0);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] bg-background px-4 md:grid md:grid-cols-[1fr_minmax(0,600px)_1fr] md:gap-6 md:px-6">
      {/* Left: the brand on phones; the page text on desktop. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2 md:justify-self-start">
        <Link href="/explore" className="flex shrink-0 items-center md:hidden" aria-label="Xtream home">
          <BrandLockup size={26} wordSize={19} />
        </Link>
        <div className="hidden min-w-0 flex-col leading-tight md:flex">
          <span className="truncate text-[17px] font-semibold tracking-tight text-foreground">{title}</span>
          {liveTotal !== null && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground tabular-nums">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
              </span>
              {liveTotal} live now
              {battleCount > 0 && <span className="text-muted-foreground/60"> · {battleCount} battle{battleCount === 1 ? "" : "s"}</span>}
              {gameCount > 0 && <span className="text-muted-foreground/60"> · {gameCount} game{gameCount === 1 ? "" : "s"}</span>}
            </span>
          )}
        </div>
      </div>

      {/* Search: dead centre on desktop; a row over the whole bar on phones. */}
      <form
        ref={boxRef}
        onSubmit={submit}
        role="search"
        className={cn(
          "min-w-0 md:relative md:col-start-2 md:flex md:w-full md:items-center",
          searchOpen
            ? "animate-fade-in absolute inset-x-0 top-0 z-10 flex h-14 items-center gap-2 bg-background px-3 md:static md:h-auto md:bg-transparent md:px-0"
            : "hidden"
        )}
      >
        <button
          type="button"
          onClick={() => {
            setSearchOpen(false);
            setOpen(false);
          }}
          aria-label="Close search"
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-foreground md:hidden"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlass size={17} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search"
            aria-label="Search streams, channels and categories"
            role="combobox"
            aria-expanded={showList}
            aria-controls="topbar-typeahead"
            className="h-10 w-full rounded-full bg-white/[0.06] pr-9 pl-10 text-[15px] text-foreground transition-colors outline-none placeholder:text-muted-foreground/60 focus:bg-white/[0.09] md:rounded-sm [&::-webkit-search-cancel-button]:hidden"
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setOpen(false);
              }}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground/70 hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
          {showList && (
            <div
              id="topbar-typeahead"
              role="listbox"
              className="animate-rise absolute top-full right-0 left-0 z-40 mt-1.5 overflow-hidden rounded-sm border border-white/[0.08] bg-[oklch(0.14_0.005_285)] py-1 shadow-2xl"
            >
              {hits.map((c) => (
                <Link
                  key={c.id}
                  role="option"
                  aria-selected={false}
                  href={`/c/${c.username}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2 transition-colors hover:bg-white/[0.05]"
                >
                  <span className="relative shrink-0">
                    <UserAvatar src={c.avatar} name={c.displayName || c.username} size={28} className="size-7" />
                    {c.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-red-500 ring-2 ring-[oklch(0.14_0.005_285)]" />}
                  </span>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium text-foreground">{c.displayName || c.username}</span>
                    <span className="truncate text-xs text-muted-foreground">@{c.username}{c.isLive ? " · Live" : ""}</span>
                  </span>
                </Link>
              ))}
              {categories.map((cat) => (
                <Link
                  key={cat}
                  role="option"
                  aria-selected={false}
                  href={`/browse?category=${encodeURIComponent(cat)}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2 text-sm text-foreground/90 transition-colors hover:bg-white/[0.05]"
                >
                  <MagnifyingGlass size={14} className="shrink-0 text-muted-foreground/60" />
                  <span className="truncate">{cat}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground/60">Category</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </form>

      {/* Right: search (phones), points, bell, the one primary action, you. */}
      <div className="flex shrink-0 items-center gap-2 md:col-start-3 md:justify-self-end md:gap-3">
        <button type="button" onClick={() => setSearchOpen(true)} aria-label="Search" className={cn(ICON_BTN, "md:hidden")}>
          <MagnifyingGlass size={18} weight="bold" />
        </button>
        {user && (
          <div className="hidden md:block">
            <PointsChip />
          </div>
        )}
        {user && (
          <div className={cn(ICON_BTN, "[&>button]:size-9 [&>button]:justify-center [&>button]:rounded-full [&>button]:px-0 [&>button]:py-0")}>
            <NotificationsBell collapsed />
          </div>
        )}
        <Link
          href="/studio"
          aria-label={user?.isLive ? "On air — open the studio" : "Go live"}
          className={cn(
            "shine flex size-9 items-center justify-center gap-2 rounded-full text-sm font-semibold transition-colors md:h-9 md:w-auto md:rounded-sm md:px-4",
            user?.isLive ? "bg-red-600 text-white hover:bg-red-700" : "bg-primary text-primary-foreground hover:bg-primary/85"
          )}
        >
          {user?.isLive ? (
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-white" />
            </span>
          ) : (
            <Broadcast size={17} weight="fill" />
          )}
          <span className="hidden md:inline">{user?.isLive ? "On air" : "Go live"}</span>
        </Link>
        {user ? (
          <>
            {/* Phones: your face opens the drawer. Desktop: it opens your channel. */}
            <button type="button" onClick={onMenu} aria-label="Open menu" className="shrink-0 md:hidden">
              <UserAvatar src={user.avatar} name={user.displayName || user.username} size={34} className="size-[34px] ring-1 ring-white/[0.1]" />
            </button>
            <Link href={`/c/${user.username}`} title={user.displayName} className="hidden shrink-0 md:block">
              <UserAvatar src={user.avatar} name={user.displayName || user.username} size={34} className="size-[34px] ring-1 ring-white/[0.1]" />
            </Link>
          </>
        ) : isLoading ? (
          <div className="size-[34px] animate-pulse rounded-full bg-white/10" />
        ) : (
          <>
            <button type="button" onClick={onMenu} aria-label="Open menu" className={cn(ICON_BTN, "md:hidden")}>
              <List size={18} weight="bold" />
            </button>
            <a
              href={SIGN_IN_URL}
              className="hidden h-9 items-center gap-1.5 rounded-sm bg-white/[0.06] px-3 text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.1] md:flex"
            >
              <SignIn size={15} />
              Sign in
            </a>
          </>
        )}
      </div>
    </header>
  );
}
