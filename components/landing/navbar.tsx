"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Flame, List, X } from "@phosphor-icons/react";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/ui/user-avatar";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Explore", href: "/explore" },
  { label: "Top Streamers", href: "#top-streamers" },
  { label: "About", href: "#about" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, isLoading, isAuthenticated } = useAuth();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/20 text-primary transition-colors group-hover:bg-primary/30">
            <Flame size={22} weight="fill" />
          </div>
          <span className="text-lg font-bold tracking-tight text-foreground">
            Xtreme <span className="text-primary">Worldstreet</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-white/5"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Desktop CTAs + User */}
        <div className="hidden items-center gap-3 md:flex">
          <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/80">
            <Link href="/studio">Start Streaming</Link>
          </Button>

          {/* User avatar */}
          {isAuthenticated && user && (
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 transition-all hover:border-white/20 hover:bg-white/10"
            >
              <UserAvatar
                src={user.avatar}
                name={user.displayName || user.username}
                size={28}
                className="size-7"
              />
              <span className="text-sm font-medium text-foreground">
                {user.displayName}
              </span>
            </Link>
          )}
          {isLoading && (
            <div className="size-7 animate-pulse rounded-full bg-white/10" />
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={22} /> : <List size={22} />}
        </button>
      </div>

      {/* Mobile Nav */}
      {mobileOpen && (
        <div className="border-t border-white/5 bg-background/95 backdrop-blur-xl md:hidden">
          <div className="flex flex-col gap-1 px-4 py-4">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-white/5"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}

            {/* Mobile user info */}
            {isAuthenticated && user && (
              <Link
                href="/dashboard"
                className="mt-3 flex items-center gap-3 rounded-lg border-t border-white/5 px-3 py-3"
                onClick={() => setMobileOpen(false)}
              >
                <UserAvatar
                  src={user.avatar}
                  name={user.displayName || user.username}
                  size={32}
                  className="size-8"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {user.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    @{user.username}
                  </p>
                </div>
              </Link>
            )}

            <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
              <Button asChild size="sm" className="bg-primary text-primary-foreground hover:bg-primary/80">
                <Link href="/studio">Start Streaming</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
