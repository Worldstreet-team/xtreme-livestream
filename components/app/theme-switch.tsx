"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Monitor, MoonIcon, SunIcon } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  THEME_CHOICES,
  applyTheme,
  readChoice,
  resolveTheme,
  setThemeChoice,
  useSystemTheme,
  useThemeChoice,
  type ThemeChoice,
} from "@/lib/theme";

const ICON = { system: Monitor, light: SunIcon, dark: MoonIcon } as const;

/**
 * Keeps <html> on the chosen theme as the choice, the phone's setting or
 * the page changes (a room is always dark). The head script did the first
 * paint; this takes over after hydration.
 */
export function ThemeSync() {
  const choice = useThemeChoice();
  const system = useSystemTheme();
  const pathname = usePathname() ?? "/";
  useEffect(() => {
    applyTheme(resolveTheme(choice, pathname));
  }, [choice, system, pathname]);
  return null;
}

/** Keep the choice with the account, so every device and browser opens on it. */
function saveToAccount(choice: ThemeChoice) {
  void apiFetch("/api/user/me", { method: "PATCH", body: JSON.stringify({ settings: { theme: choice } }) }).catch(() => {
    // Offline or signed out: this browser still has it.
  });
}

/**
 * The account's side of the theme (owner, 2026-09-28: "my chosen theme
 * doesn't persist across sessions"). The browser keeps the choice for the
 * first paint; the account keeps it everywhere else. On sign-in, a choice
 * saved to the account wins here; an account that never chose takes this
 * browser's choice instead, so nobody's earlier pick is lost.
 */
export function AccountThemeSync() {
  const { user } = useAuth();
  const synced = useRef<string | null>(null);
  useEffect(() => {
    if (!user) {
      synced.current = null;
      return;
    }
    if (synced.current === user.id) return;
    synced.current = user.id;
    const saved = user.settings?.theme;
    const here = readChoice();
    if (saved) {
      if (saved !== here) setThemeChoice(saved);
    } else if (here !== "system") {
      saveToAccount(here);
    }
  }, [user]);
  return null;
}

/**
 * System · Light · Dark, as three chips: the one that's on is the neutral
 * primary, the rest quiet controls (the chip grammar).
 */
export function ThemeSwitch({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  const choice = useThemeChoice();
  const { user } = useAuth();
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("flex flex-wrap gap-2", className)}>
      {THEME_CHOICES.map((c) => {
        const on = c.id === choice;
        const Icon = ICON[c.id];
        return (
          <Pill
            key={c.id}
            role="radio"
            aria-checked={on}
            size={size}
            variant={on ? "primary" : "glass"}
            icon={<Icon size={size === "sm" ? 14 : 16} weight={on ? "fill" : "regular"} />}
            onClick={() => {
              setThemeChoice(c.id as ThemeChoice);
              if (user) saveToAccount(c.id as ThemeChoice);
            }}
          >
            {c.label}
          </Pill>
        );
      })}
    </div>
  );
}
