/**
 * The server-safe half of the theme (no React): the choices, the rooms that
 * stay dark, and the head script that paints the right theme first. The
 * root layout imports this; components use lib/theme.ts.
 */

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "xtream:theme";
export const THEME_EVENT = "xtream:theme";

/** Paths that are always dark, whatever the choice. */
export const DARK_ROOMS = ["/stream/", "/studio", "/produce", "/camera/", "/feed"];

export const THEME_CHOICES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function isDarkRoom(pathname: string) {
  return DARK_ROOMS.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

/**
 * Runs in <head> before first paint, so a light page never flashes dark
 * (and the other way round). Kept in step with readChoice/resolveTheme.
 */
export const THEME_SCRIPT = `(function(){try{var c="system";try{c=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system"}catch(e){}var p=location.pathname,r=${JSON.stringify(DARK_ROOMS)}.some(function(x){return p===x.replace(/\\/$/,"")||p.indexOf(x)===0});var t=r?"dark":c==="light"||c==="dark"?c:(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;d.classList.toggle("dark",t==="dark")}catch(e){}})();`;
