"use client";

import { useSyncExternalStore } from "react";
import { DARK_ROOMS, THEME_CHOICES, THEME_EVENT as EVENT, THEME_KEY as KEY, isDarkRoom, type Theme, type ThemeChoice } from "@/lib/theme-script";

export { DARK_ROOMS, THEME_CHOICES, isDarkRoom, type Theme, type ThemeChoice };

/**
 * Light or dark (2026-09-27). The choice is System, Light or Dark and stays
 * with this browser; System follows the phone's own setting as it changes.
 * The result lands on <html> as `data-theme` (plus `color-scheme`, and the
 * `dark` class for the few `dark:` variants), and the tokens in
 * app/globals.css do the rest.
 *
 * Rooms stay dark: watching, the studio, the producer console and a phone
 * used as a camera are about the picture, and those screens are drawn for
 * a dark room. The list is paths, so it can shrink as each room learns to
 * sit on paper.
 */

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Storage blocked: follow the system.
  }
  return "system";
}

function systemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function resolveTheme(choice: ThemeChoice, pathname?: string): Theme {
  if (pathname && isDarkRoom(pathname)) return "dark";
  return choice === "system" ? systemTheme() : choice;
}

/** Put the theme on <html>. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  mq?.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    mq?.removeEventListener("change", onChange);
  };
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Kept for this page only.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The stored choice, the same in every component and tab. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice, () => "system");
}

/** What System resolves to right now (re-renders when the phone flips). */
export function useSystemTheme(): Theme {
  return useSyncExternalStore(subscribe, systemTheme, () => "dark");
}

function readApplied(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribeApplied(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/**
 * The theme the page is actually wearing (a room is always dark), for the
 * few things drawn outside CSS — category covers, canvases. The server and
 * the first client render say dark; it settles right after hydration.
 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribeApplied, readApplied, () => "dark");
}
