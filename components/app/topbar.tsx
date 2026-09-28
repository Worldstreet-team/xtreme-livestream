"use client";

import { SIGN_IN_URL } from "@/lib/auth-urls";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, SignIn, X, ArrowLeft } from "@/components/icons";
import { VividLauncher } from "@/components/vivid/vivid-voice-control";
import { PointsChip } from "@/components/app/points-chip";
import { BrandLockup } from "@/components/ui/brand-mark";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useUnreadThreads } from "@/lib/messaging";
import { CATEGORY_GROUPS } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { NotificationsBell } from "@/components/app/notifications-bell";
import { Tip } from "@/components/ui/tip";

/**
 * The bar across the top of every page.
 *
 * Desktop: only controls (owner, 2026-09-24: "no isolated text, no live
 * now — just professional"): search dead centre with its ⌘K hint, then your
 * points, Ask Vivid, the bell and you. Go live lives in the rail, not here
 * (owner, 2026-09-24); on phones it floats above the tab bar. It is always
 * in view (sticky glass) and it is the one place search lives.
 *
 * Phones: your face (or the menu, signed out) and the brand on the left,
 * then Vivid's orb and the bell on the right — Vivid took search's
 * seat (owner's pick 3B, 2026-09-23), and search opens from Browse as a
 * full-width row over this bar. Your face opens the account drawer; the
 * four places to go are on the tab bar below.
 *
 * Tablets (768–1024px) are the phone bar's cousins: the desktop grid needs
 * the page title, a 600px search and three actions, which is more than the
 * width beside the rail can hold, so the title and the button labels wait
 * for `lg`.
 *
 * Search resolves as you type against channels (server) and categories
 * (local taxonomy); Enter hands the term to the Explore page.
 */


interface ChannelHit {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
}

/** A round icon button, the phone bar's unit. */
const ICON_BTN =
  "press flex size-9 shrink-0 items-center justify-center rounded-full bg-control text-foreground transition-colors hover:bg-control-hover md:size-10";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading } = useAuth();
  const unreadThreads = useUnreadThreads(Boolean(user));
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

  // Browse's search pill opens the row here on phones; ⌘K / Ctrl+K jumps
  // to the box anywhere.
  useEffect(() => {
    const openRow = () => setSearchOpen(true);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener("xtreme:open-search", openRow);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("xtreme:open-search", openRow);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

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
    <header className="relative flex h-14 shrink-0 items-center justify-between gap-2 bg-background/85 px-3.5 shadow-[inset_0_-1px_0_var(--hairline-color)] backdrop-blur-xl backdrop-saturate-150 md:grid md:bg-surface md:shadow-none md:backdrop-blur-none md:backdrop-saturate-100 md:h-16 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-4 md:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(200px,520px)_minmax(max-content,1fr)] lg:gap-5">
      {/* Left: you (or the menu) and the brand on phones; the page text from lg. */}
      <div className="flex min-w-0 shrink-0 items-center gap-2.5 md:justify-self-start">
        {/* The landing's two-line menu mark, not your photo (owner, 2026-09-28);
            the live and unread dots ride on it. */}
        <button
          type="button"
          onClick={onMenu}
          data-tour="account-menu"
          aria-label={user ? (unreadThreads ? `Open your menu, ${unreadThreads} unread conversations` : "Open your menu") : "Open menu"}
          className="press group relative -ml-1 flex size-10 shrink-0 items-center justify-center rounded-full text-foreground md:hidden"
        >
          <MenuBars />
          {user?.isLive && <span className="absolute right-1 bottom-1.5 size-2.5 rounded-full bg-chili ring-2 ring-background" />}
          {/* Messages live in the drawer on a phone, so the way in says when something's waiting. */}
          {user && unreadThreads > 0 && <span aria-hidden className="absolute top-1.5 right-1 size-2.5 rounded-full bg-chili ring-2 ring-background" />}
        </button>
        <Link href="/explore" className="flex shrink-0 items-center md:hidden" aria-label="Xtream home">
          <BrandLockup size={26} wordSize={19} />
        </Link>
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
          <MagnifyingGlass size={17} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground/70" />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Search streams, people, categories"
            aria-label="Search streams, channels and categories"
            role="combobox"
            aria-expanded={showList}
            aria-controls="topbar-typeahead"
            className="peer h-10 w-full rounded-full bg-tint/[0.06] pr-14 pl-11 text-[14.5px] text-foreground transition-[background-color] outline-none placeholder:text-muted-foreground/60 hover:bg-tint/[0.08] focus:bg-tint/[0.1] md:h-11 [&::-webkit-search-cancel-button]:hidden"
          />
          {!q && (
            <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-[8px] bg-tint/[0.07] px-2 py-1 font-mono text-[11px] font-semibold text-muted-foreground peer-focus:opacity-0 lg:block">
              ⌘K
            </kbd>
          )}
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
              className="animate-rise absolute top-full right-0 left-0 z-40 mt-2 overflow-hidden rounded-panel bg-popover py-1.5 shadow-popover"
            >
              {hits.map((c) => (
                <Link
                  key={c.id}
                  role="option"
                  aria-selected={false}
                  href={`/c/${c.username}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-3.5 py-2 transition-colors hover:bg-tint/[0.05]"
                >
                  <span className="relative shrink-0">
                    <UserAvatar src={c.avatar} name={c.displayName || c.username} size={28} className="size-7" />
                    {c.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-red-500 ring-2 ring-popover" />}
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
                  className="flex items-center gap-3 px-3.5 py-2 text-sm text-foreground/90 transition-colors hover:bg-tint/[0.05]"
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

      {/* Right: Vivid, the bell, the one primary action, you. */}
      <div className="flex shrink-0 items-center gap-2 md:col-start-3 md:justify-self-end md:gap-2.5">
        {/* Your points (earned by watching, games and drops) — opens Rewards. */}
        {user && (
          <div className="hidden lg:block">
            <PointsChip />
          </div>
        )}
        {/* The orb alone until there's room for its word (xl). */}
        <VividLauncher variant="orb" className="xl:hidden" />
        <VividLauncher variant="pill" className="hidden xl:flex" />
        {user && (
          <div className={cn(ICON_BTN, "[&>button]:size-9 [&>button]:justify-center [&>button]:rounded-full [&>button]:px-0 [&>button]:py-0")}>
            <NotificationsBell collapsed />
          </div>
        )}
        {user ? (
          <Tip label="Your channel" side="bottom">
            <Link href={`/c/${user.username}`} data-vivid-own-channel aria-label={`Your channel, ${user.displayName || user.username}`} className="hidden shrink-0 md:block">
              <UserAvatar src={user.avatar} name={user.displayName || user.username} size={36} className="size-9 ring-1 ring-tint/[0.1]" />
            </Link>
          </Tip>
        ) : isLoading ? (
          <div className="hidden size-[34px] animate-pulse rounded-full bg-tint/10 md:block" />
        ) : (
          <Tip label="Sign in" side="bottom">
            <a
              href={SIGN_IN_URL}
              aria-label="Sign in"
              className="press hidden h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-control px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-control-hover md:flex md:size-10 md:px-0 xl:w-auto xl:px-4"
            >
              <SignIn size={15} />
              <span className="hidden xl:inline">Sign in</span>
            </a>
          </Tip>
        )}
      </div>
    </header>
  );
}

/** Two lines, the lower one shorter and to the right: the landing's menu mark. */
function MenuBars() {
  return (
    <span aria-hidden className="relative block h-3.5 w-5">
      <i className="absolute top-1/2 left-0 block h-[1.75px] w-full -translate-y-[4.9px] rounded-full bg-current" />
      <i className="absolute top-1/2 left-0 block h-[1.75px] w-full origin-right translate-y-[3.1px] scale-x-[0.7] rounded-full bg-current transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-x-100" />
    </span>
  );
}
