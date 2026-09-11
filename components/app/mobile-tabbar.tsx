"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  House,
  GridFour,
  Heart,
  User as UserIcon,
  Broadcast,
  X,
  Eye,
  Play,
} from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatNumber } from "@/lib/categories";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GoLiveButton } from "@/components/app/empty";

/**
 * The phone's primary navigation. Three-quarters of new viewers on the big
 * platforms arrive on mobile, so the bottom bar is the front door: Home,
 * Feed, Browse, Following, You. Following opens as a drawer over whatever
 * is on screen — the returning viewer's people are one tap away from
 * anywhere, not a route change.
 */

interface FollowedChannel {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  stream: { id: string; title: string; viewers: number } | null;
}

export function MobileTabBar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [drawer, setDrawer] = useState(false);

  // No bar on the watch page — the player and chat own the whole screen.
  if (pathname.startsWith("/stream/") || pathname === "/feed") return null;

  const is = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/[0.06] bg-[oklch(0.12_0.005_285)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <TabLink href="/explore" label="Home" icon={House} active={is("/explore")} />
        <TabLink href="/feed" label="Live" icon={Play} active={is("/feed")} live />
        <TabLink href="/browse" label="Browse" icon={GridFour} active={is("/browse")} />
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-haspopup="dialog"
          aria-expanded={drawer}
          className={cn(
            "flex flex-col items-center justify-center gap-0.5 py-2 text-[0.62rem]",
            drawer || is("/following") ? "text-foreground" : "text-muted-foreground"
          )}
        >
          <Heart size={20} weight={drawer || is("/following") ? "fill" : "regular"} />
          Following
        </button>
        <TabLink
          href={user ? "/dashboard" : "https://www.worldstreetgold.com/login"}
          label={user ? "You" : "Sign in"}
          icon={UserIcon}
          active={is("/dashboard") || is("/settings")}
        />
      </nav>

      {drawer && <FollowingDrawer onClose={() => setDrawer(false)} />}
    </>
  );
}

function TabLink({
  href,
  label,
  icon: Icon,
  active,
  live = false,
}: {
  href: string;
  label: string;
  icon: typeof House;
  active: boolean;
  live?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 py-2 text-[0.62rem]",
        active ? "text-foreground" : "text-muted-foreground"
      )}
    >
      <Icon size={20} weight={active ? "fill" : "regular"} />
      {live && <span className="absolute top-1.5 right-[calc(50%-14px)] size-1.5 rounded-full bg-red-500" />}
      {label}
    </Link>
  );
}

/**
 * Followed channels, live first, sliding up over the page. Signed-out
 * visitors get the nudge that makes following worth it.
 */
function FollowingDrawer({ onClose: dismiss }: { onClose: () => void }) {
  const { isAuthenticated } = useAuth();
  const [channels, setChannels] = useState<FollowedChannel[] | null>(null);
  // The sheet slides down before it unmounts: closing only starts the exit
  // animation, and the panel's animationend hands control back.
  const [closing, setClosing] = useState(false);
  const onClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    apiFetch<{ success: boolean; data: { channels: FollowedChannel[] } }>(`/api/user/me/following`)
      .then((r) => !cancelled && setChannels(r.data.channels))
      .catch(() => !cancelled && setChannels([]));
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const live = (channels ?? []).filter((c) => c.isLive && c.stream);
  const offline = (channels ?? []).filter((c) => !c.isLive);

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Following">
      <button type="button" aria-label="Close" onClick={onClose} className={cn("absolute inset-0 bg-black/60", closing ? "animate-fade-out" : "animate-fade-in")} />
      <div
        onAnimationEnd={() => closing && dismiss()}
        className={cn(
          "absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-2xl border-t border-white/[0.08] bg-[oklch(0.12_0.005_285)] pb-[env(safe-area-inset-bottom)]",
          closing ? "animate-sheet-down" : "animate-sheet-up"
        )}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-white/[0.06] bg-[oklch(0.12_0.005_285)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Heart size={15} weight="fill" className="text-primary" />
            Following
            {live.length > 0 && (
              <span className="rounded bg-red-600 px-1.5 py-0.5 text-[0.6rem] font-bold text-white tabular-nums">
                {live.length} LIVE
              </span>
            )}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        {!isAuthenticated ? (
          <div className="px-6 py-12 text-center">
            <Heart size={32} className="mx-auto mb-3 text-muted-foreground/25" />
            <p className="text-sm font-medium text-foreground/85">Follow channels to see them here</p>
            <p className="mt-1 text-sm text-muted-foreground/70">Live ones first, the moment they go on.</p>
            <a href="https://www.worldstreetgold.com/login" className="mt-5 inline-flex h-9 items-center rounded-sm bg-primary px-4 text-sm font-medium text-primary-foreground">
              Sign in
            </a>
          </div>
        ) : channels === null ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-sm bg-white/[0.04]" />
            ))}
          </div>
        ) : channels.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground/85">You don&apos;t follow anyone yet</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <GoLiveButton onClick={onClose} />
              <Link href="/explore" onClick={onClose} className="flex h-9 items-center rounded-sm bg-white/[0.06] px-4 text-sm font-medium text-foreground">
                Find channels
              </Link>
            </div>
          </div>
        ) : (
          <div className="p-2">
            {live.length > 0 && (
              <p className="px-3 pt-2 pb-1 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">Live now</p>
            )}
            {live.map((c) => (
              <Link key={c.id} href={`/stream/${c.stream!.id}`} onClick={onClose} className="flex items-center gap-3 rounded-sm px-3 py-2.5 hover:bg-white/[0.04]">
                <span className="relative shrink-0">
                  <UserAvatar src={c.avatar} name={c.displayName || c.username} size={40} className="size-10 ring-2 ring-red-600" />
                  <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-[oklch(0.12_0.005_285)]" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{c.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground/70">{c.stream!.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
                  <Eye size={12} />
                  {formatNumber(c.stream!.viewers)}
                </span>
              </Link>
            ))}
            {offline.length > 0 && (
              <p className="px-3 pt-4 pb-1 text-[0.65rem] font-medium tracking-wider text-muted-foreground/60 uppercase">Offline</p>
            )}
            {offline.map((c) => (
              <Link key={c.id} href={`/c/${c.username}`} onClick={onClose} className="flex items-center gap-3 rounded-sm px-3 py-2 hover:bg-white/[0.04]">
                <UserAvatar src={c.avatar} name={c.displayName || c.username} size={32} className="size-8 opacity-70" />
                <span className="truncate text-sm text-foreground/80">{c.displayName}</span>
              </Link>
            ))}
            <Link href="/following" onClick={onClose} className="mt-2 flex items-center justify-center gap-2 rounded-sm bg-white/[0.05] px-3 py-2.5 text-sm text-foreground/85">
              <Broadcast size={14} />
              Open Following
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
