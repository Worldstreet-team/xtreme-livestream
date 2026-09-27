"use client";

import { SIGN_IN_URL } from "@/lib/auth-urls";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SideMenu } from "./side-menu";
import { BrandMark } from "@/components/ui/brand-mark";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/ui/user-avatar";
import { GoLiveLink } from "@/components/app/go-live-link";
import { VividLauncher } from "@/components/vivid/vivid-voice-control";
import { cn } from "@/lib/utils";

/** The chapters, in the order the page tells them. */
const navLinks = [
  { label: "Studio", href: "#go-live" },
  { label: "Battles", href: "#backed" },
  { label: "Wallet", href: "#paid" },
  { label: "Wolf race", href: "#wolf" },
  { label: "Vivid", href: "#vivid" },
  { label: "Explore", href: "/explore" },
];

/**
 * The landing nav. It floats on the hero film with no ground of its own,
 * and picks up glass (the one place Afterglow allows it, a sticky header)
 * once the page moves under it. Ask Vivid is the real launcher: the same
 * session, capsule and sign-in hand-off as the app's top bar. On phones
 * the links live in a frosted sheet that slides in from the side, with the
 * chapters set in display type (side-menu.tsx).
 */
export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { user, isLoading, isAuthenticated } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      data-landing-nav
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background-color,backdrop-filter,border-color] duration-300",
        scrolled ? "border-b border-hairline bg-ground/75 backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[90rem] items-center justify-between gap-6 px-5 sm:px-8 lg:px-20">
        <div className="flex items-center gap-12">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Xtream home">
            <BrandMark size={28} />
            <span className="font-wide text-[21px] font-bold tracking-[-0.04em] text-foreground">Xtream</span>
          </Link>
          <div className="hidden items-center gap-7 lg:flex">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="text-[14px] font-medium text-foreground/75 transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <VividLauncher variant="pill" />
          {!isLoading && !isAuthenticated && (
            <a
              href={SIGN_IN_URL}
              className="press flex h-11 items-center rounded-full px-4 text-[14px] font-semibold text-foreground hover:bg-white/[0.06]"
            >
              Sign in
            </a>
          )}
          {isAuthenticated && user && (
            <Link
              href="/dashboard"
              aria-label="Your channel"
              className="press flex h-11 items-center gap-2 rounded-full bg-control py-1 pr-4 pl-1 hover:bg-control-hover"
            >
              <UserAvatar src={user.avatar} name={user.displayName || user.username} size={32} />
              <span className="max-w-[10rem] truncate text-[14px] font-semibold">{user.displayName || user.username}</span>
            </Link>
          )}
          {isLoading && <div className="size-9 animate-pulse rounded-full bg-white/10" />}
          <GoLiveLink className="w-auto px-5" />
        </div>

        {/* Phones: the hamburger opens the frosted menu (side-menu.tsx). */}
        <SideMenu />
      </div>
    </nav>
  );
}
