/**
 * What the studio remembers between broadcasts, in this browser: the last
 * title and category (so the next go-live is prefilled and one tap away),
 * and whether the host asked for the market tools up front.
 *
 * Browser storage only — a convenience, never state that must survive.
 * Every read and write is guarded: a private window or blocked storage just
 * starts from the defaults.
 */

const LAST_KEY = "xtream:studio:last-details";
const MARKETS_KEY = "xtream:studio:market-tools";
const RECENT_KEY = "xtream:studio:recent-categories";
const RECENT_MAX = 3;

export interface LastDetails {
  title: string;
  category: string;
}

export function readLastDetails(): LastDetails | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastDetails>;
    const title = typeof v.title === "string" ? v.title.slice(0, 100) : "";
    const category = typeof v.category === "string" ? v.category.trim().slice(0, 48) : "";
    return { title, category };
  } catch {
    return null;
  }
}

export function saveLastDetails(details: LastDetails) {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify({ title: details.title.trim(), category: details.category }));
  } catch {
    // Not remembered this time.
  }
  // Going live in a category is what "used" means for the chooser's Recent row.
  pushRecentCategory(details.category);
}

/**
 * The last few categories this browser went live in (or picked), newest
 * first — the category chooser's Recent row. At most three.
 */
export function readRecentCategories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(v)) return [];
    return v.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim().slice(0, 48)).slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function pushRecentCategory(category: string) {
  const c = category.trim().slice(0, 48);
  if (!c) return;
  try {
    const next = [c, ...readRecentCategories().filter((x) => x !== c)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Recent is a convenience; it starts empty next time.
  }
}

/** The host turned the market tools on for every stream, whatever its category. */
export function readMarketTools(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MARKETS_KEY) === "on";
  } catch {
    return false;
  }
}

export function saveMarketTools(on: boolean) {
  try {
    window.localStorage.setItem(MARKETS_KEY, on ? "on" : "off");
  } catch {
    // On for this visit only.
  }
}
