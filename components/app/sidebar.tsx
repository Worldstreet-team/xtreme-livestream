"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Flame,
  Compass,
  VideoCamera,
  ChartLineUp,
  Gear,
  SignOut,
  List,
  X,
  CaretLeft,
  CaretRight,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { useState } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";

const sidebarLinks = [
  { label: "Explore", href: "/explore", icon: Compass },
  { label: "Go Live", href: "/studio", icon: VideoCamera },
  { label: "Dashboard", href: "/dashboard", icon: ChartLineUp },
  { label: "Settings", href: "/settings", icon: Gear },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile toggle button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 flex size-9 items-center justify-center rounded-lg border border-white/10 bg-background/80 text-muted-foreground backdrop-blur-sm md:hidden"
      >
        <List size={20} />
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-white/5 bg-background/95 backdrop-blur-xl transition-all duration-300",
          collapsed ? "w-[68px]" : "w-60",
          mobileOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b border-white/5 px-4">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <Flame size={18} weight="fill" />
            </div>
            {!collapsed && (
              <span className="text-sm font-bold tracking-tight text-foreground">
                Xtreme <span className="text-primary">WS</span>
              </span>
            )}
          </Link>
          {/* Mobile close */}
          <button
            onClick={() => setMobileOpen(false)}
            className="text-muted-foreground md:hidden"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 space-y-1 px-2 py-4">
          {sidebarLinks.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                )}
              >
                <link.icon
                  size={20}
                  weight={isActive ? "fill" : "regular"}
                  className="shrink-0"
                />
                {!collapsed && <span>{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle (desktop only) */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden border-t border-white/5 p-3 text-muted-foreground transition-colors hover:text-foreground md:flex md:items-center md:justify-center"
        >
          {collapsed ? <CaretRight size={16} /> : <CaretLeft size={16} />}
        </button>

        {/* User info */}
        <div className="border-t border-white/5 p-3">
          <div className="flex items-center gap-3">
            {user ? (
              <UserAvatar
                src={user.avatar}
                name={user.displayName || user.username}
                size={32}
                className="size-8"
              />
            ) : (
              <div className="size-8 shrink-0 animate-pulse rounded-full bg-white/10" />
            )}
            {!collapsed && user && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.displayName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  @{user.username}
                </p>
              </div>
            )}
            {!collapsed && (
              <div className="flex items-center gap-2">
                <a
                  href="https://dashboard.worldstreetgold.com"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[0.65rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Dashboard
                </a>
                <button className="text-muted-foreground transition-colors hover:text-foreground">
                  <SignOut size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
