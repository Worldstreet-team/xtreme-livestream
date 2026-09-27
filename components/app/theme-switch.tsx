"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Monitor, MoonIcon, SunIcon } from "@/components/icons";
import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";
import {
  THEME_CHOICES,
  applyTheme,
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

/**
 * System · Light · Dark, as three chips: the one that's on is the neutral
 * primary, the rest quiet controls (the chip grammar).
 */
export function ThemeSwitch({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  const choice = useThemeChoice();
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
            onClick={() => setThemeChoice(c.id as ThemeChoice)}
          >
            {c.label}
          </Pill>
        );
      })}
    </div>
  );
}
