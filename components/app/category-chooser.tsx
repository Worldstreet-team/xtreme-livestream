"use client";

import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, Check, MagnifyingGlass, Plus, X } from "@/components/icons";
import { CATEGORY_GROUPS, MARKET_GROUP_LABELS } from "@/lib/categories";
import { categoryArt, type CoverTheme } from "@/lib/category-art";
import { pushRecentCategory, readRecentCategories } from "@/lib/go-live-prefs";
import { DURATION, EASE, prefersReducedMotion } from "@/lib/motion";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * The category chooser: every category as its own poster, in a grid.
 *
 * Owner, 2026-09-28, on the old dropdown of tiny thumbs and wrapping names:
 * "this section looks terrible to me, find a creative way to rep it". The
 * covers (lib/category-art) already are posters with the name set on them,
 * so the chooser is a wall of them: a search, the last few you used, the
 * families as chips, and a grid of portrait cards. Picking one lifts it,
 * and the chooser folds away while the cover flies into the field's
 * thumbnail — you watch your choice land where it lives.
 *
 * Where it opens: over the studio console when the trigger sits in one
 * (`host`), as a sheet on phones, and as a large popover under the field
 * everywhere else. One focus ring — the design system's base outline — and
 * a selected card wears a plain foreground ring only while it isn't the
 * focused one, so two rings never stack on one card.
 *
 * Motion: transform and opacity only, on lib/motion's eases; under reduced
 * motion everything is a fade and nothing flies.
 */

// ── the families, as tabs ───────────────────────────────────────────────

export interface ChooserGroup {
  id: string;
  name: string;
  topics: string[];
}

/** What most people stream first. General's topics lead it. */
const POPULAR = [
  "Just Chatting",
  "IRL",
  "Video Games",
  "Garena Free Fire",
  "Fortnite",
  "Football (Soccer)",
  "Afrobeats & Amapiano",
  "Comedy & Memes",
  "Podcasts & Talk",
  "Food & Cooking",
  "Fashion & Style",
  "Fitness & Training",
  "Beauty & Skincare",
  "Hip-Hop & Rap",
  "Movies & TV",
];

/**
 * Tab order and short names: the social app first, markets and crypto
 * last — an option on Xtream, not its premise (owner, 2026-09-28).
 */
const TABS: Array<{ name: string; labels: string[] }> = [
  { name: "Games", labels: ["Gaming", "Games"] },
  { name: "Sports", labels: ["Sports"] },
  { name: "Music", labels: ["Music & Audio"] },
  { name: "Entertainment", labels: ["Entertainment"] },
  { name: "Lifestyle", labels: ["Lifestyle"] },
  { name: "Wellness", labels: ["Health & Wellness"] },
  { name: "Creative", labels: ["Arts & Creative"] },
  { name: "Creators", labels: ["Creator & Growth"] },
  { name: "Learning", labels: ["Learning & Ideas"] },
  { name: "Tech", labels: ["Technology"] },
  { name: "News", labels: ["News & Society"] },
  { name: "Business", labels: ["Business & Money"] },
  { name: "Markets", labels: ["Markets & Trading"] },
  { name: "Crypto", labels: ["Crypto & Web3"] },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

export const CHOOSER_GROUPS: ChooserGroup[] = (() => {
  const known = new Set(CATEGORY_GROUPS.flatMap((g) => g.topics));
  const byLabel = new Map(CATEGORY_GROUPS.map((g) => [g.label, g]));
  const claimed = new Set(["General"]);
  const tab = (name: string, topics: string[]): ChooserGroup => ({ id: slug(name), name, topics: [...new Set(topics)] });
  const general = byLabel.get("General")?.topics ?? [];
  const popular = tab("Popular", [...general, ...POPULAR.filter((t) => known.has(t))]);
  const named = TABS.map((t) => {
    t.labels.forEach((l) => claimed.add(l));
    return tab(t.name, t.labels.flatMap((l) => byLabel.get(l)?.topics ?? []));
  }).filter((g) => g.topics.length > 0);
  // A family added to the taxonomy later still gets a tab, ahead of the markets.
  const extra = CATEGORY_GROUPS.filter((g) => !claimed.has(g.label)).map((g) => tab(g.label, g.topics));
  const markets = named.filter((g) => TABS.find((t) => t.name === g.name)?.labels.some((l) => MARKET_GROUP_LABELS.has(l)));
  return [popular, ...named.filter((g) => !markets.includes(g)), ...extra, ...markets];
})();

const ALL_TOPICS = [...new Set(CATEGORY_GROUPS.flatMap((g) => g.topics))];
const GAMES: ReadonlySet<string> = new Set(CATEGORY_GROUPS.find((g) => g.label === "Games")?.topics ?? []);

/** The family a category files under, for a field's second line. */
export function categoryFamily(category: string): string | null {
  return CATEGORY_GROUPS.find((g) => g.topics.includes(category))?.label ?? null;
}

// ── search ──────────────────────────────────────────────────────────────

/** Lowercase, no accents, punctuation to spaces: "Pokémon GO" → "pokemon go". */
export function foldText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Categories matching a query, best first: the name starting with it, then
 * a word in it, then anywhere in it — and a family's name brings its
 * members along after those ("music" finds every Music topic).
 */
export function searchCategories(query: string, pool: readonly string[] = ALL_TOPICS): string[] {
  const q = foldText(query);
  if (!q) return [...pool];
  const squashed = q.replace(/ /g, "");
  const scored: Array<[string, number]> = [];
  for (const c of pool) {
    const f = foldText(c);
    const flat = f.replace(/ /g, "");
    let score = -1;
    if (f.startsWith(q) || flat.startsWith(squashed)) score = 0;
    else if (f.split(" ").some((w) => w.startsWith(q))) score = 1;
    else if (f.includes(q) || flat.includes(squashed)) score = 2;
    // On a tie, a topic beats a game title ("cook" → Food & Cooking before Word Cookies).
    if (score >= 0) scored.push([c, score + (GAMES.has(c) ? 0.5 : 0)]);
  }
  const direct = scored.sort((a, b) => a[1] - b[1]).map(([c]) => c);
  const seen = new Set(direct);
  const family = CHOOSER_GROUPS.filter((g) => g.id !== "popular" && foldText(g.name).startsWith(q)).flatMap((g) => g.topics);
  for (const c of family) {
    if (seen.has(c) || !pool.includes(c)) continue;
    seen.add(c);
    direct.push(c);
  }
  return direct;
}

// ── covers ──────────────────────────────────────────────────────────────

/** The poster a card shows: name set on it. */
export const posterSrc = (c: string, theme: CoverTheme) => categoryArt(c, { w: 360, h: 480 }, theme);
/** The small cover a field shows: the mark alone (under 200px the covers drop their type). */
export const thumbSrc = (c: string, theme: CoverTheme) => categoryArt(c, { w: 72, h: 96 }, theme);

/**
 * A field's cover thumbnail — the chooser's flight lands on it. Without a
 * category it's an empty tile with a plus.
 */
export const CoverThumb = forwardRef<HTMLImageElement, { category: string; theme?: CoverTheme; className?: string }>(function CoverThumb(
  { category, theme, className },
  ref
) {
  const applied = useTheme();
  if (!category) {
    return (
      <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-[6px] bg-tint/[0.07] text-muted-foreground", className)}>
        <Plus size={16} weight="bold" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- our own generated cover, sized by the field
    <img ref={ref} src={thumbSrc(category, theme ?? applied)} alt="" draggable={false} className={cn("shrink-0 rounded-[6px] bg-tint/[0.06] object-cover", className)} />
  );
});

/**
 * Fly a cover from where it was picked into the field's thumbnail: a clone
 * on top of everything, translated and scaled (the card and the thumb are
 * both 3:4, so the scale is uniform), and the thumb fades up under it as it
 * lands.
 */
export function flyCover(src: string, from: DOMRect, to: HTMLElement | null) {
  if (!to || prefersReducedMotion()) return;
  const r = to.getBoundingClientRect();
  if (!r.width || !r.height || !from.width || !from.height) return;
  const clone = document.createElement("img");
  clone.src = src;
  clone.alt = "";
  clone.setAttribute("aria-hidden", "true");
  Object.assign(clone.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    borderRadius: "10px",
    objectFit: "cover",
    zIndex: "90",
    pointerEvents: "none",
    transformOrigin: "0 0",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(clone);
  const dx = r.left - from.left;
  const dy = r.top - from.top;
  const s = r.width / from.width;
  to.style.opacity = "0";
  const flight = clone.animate(
    [
      { transform: "translate(0, 0) scale(1)" },
      // A slight lift off the grid before it travels, so it reads as picked up.
      { transform: `translate(${dx * 0.12}px, ${dy * 0.12 - 10}px) scale(${1 + (s - 1) * 0.1})`, offset: 0.18 },
      { transform: `translate(${dx}px, ${dy}px) scale(${s})` },
    ],
    { duration: DURATION.unfold, easing: EASE.morph, fill: "forwards" }
  );
  const land = () => {
    to.style.opacity = "";
    to.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "linear" });
    clone.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: "linear", fill: "forwards" }).onfinish = () => clone.remove();
  };
  flight.onfinish = land;
  flight.oncancel = () => {
    to.style.opacity = "";
    clone.remove();
  };
}

// ── the chooser ─────────────────────────────────────────────────────────

/** A scrolling row fades out at its right edge, so a cut-off chip reads as "more this way". */
const EDGE = "[mask-image:linear-gradient(to_right,#000_calc(100%_-_28px),transparent)]";

type Mode = "cover" | "sheet" | "popover";

export interface CategoryChooserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (category: string) => void;
  /** The control that opened it: popovers hang from it, focus returns to it, the fold heads for it. */
  anchor: RefObject<HTMLElement | null>;
  /** Where the picked cover lands. Omit and nothing flies. */
  flyTo?: RefObject<HTMLElement | null>;
  /** An element to cover instead of floating (the studio console), found from the anchor. */
  resolveHost?: (anchor: HTMLElement) => HTMLElement | null;
  /** Categories not on offer (interests already picked). */
  exclude?: readonly string[];
  /** Show and remember the Recent row (streaming surfaces; not interests). */
  recent?: boolean;
  theme?: CoverTheme;
  /** The heading. */
  label?: string;
}

export function CategoryChooser(props: CategoryChooserProps) {
  const { open, anchor, resolveHost } = props;
  // Rendered from the moment it opens until its exit has played.
  const [shown, setShown] = useState(open);
  const [placement, setPlacement] = useState<{ mode: Mode; host: HTMLElement | null } | null>(null);
  if (open && !shown) setShown(true);

  useLayoutEffect(() => {
    if (!open) return;
    const a = anchor.current;
    const host = a && resolveHost ? resolveHost(a) : null;
    const phone = window.matchMedia("(max-width: 639px)").matches;
    // Measuring the page to decide where it opens: a layout read, then one render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlacement({ mode: host ? "cover" : phone ? "sheet" : "popover", host });
  }, [open, anchor, resolveHost]);

  if (!shown || !placement) return null;
  const panel = <ChooserPanel {...props} mode={placement.mode} onExited={() => setShown(false)} />;
  return createPortal(panel, placement.mode === "cover" && placement.host ? placement.host : document.body);
}

function ChooserPanel({
  open,
  onOpenChange,
  value,
  onChange,
  anchor,
  flyTo,
  exclude,
  recent: withRecent,
  theme: themeProp,
  label = "Category",
  mode,
  onExited,
}: CategoryChooserProps & { mode: Mode; onExited: () => void }) {
  const applied = useTheme();
  const theme = themeProp ?? applied;
  const uid = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const running = useRef<Animation[]>([]);
  const leaving = useRef(false);

  const offered = useMemo(() => {
    const ex = new Set(exclude ?? []);
    return (c: string) => !ex.has(c);
  }, [exclude]);
  const groups = useMemo(
    () => CHOOSER_GROUPS.map((g) => ({ ...g, topics: g.topics.filter(offered) })).filter((g) => g.topics.length > 0),
    [offered]
  );
  const [recent] = useState(() => (withRecent ? readRecentCategories().filter(offered) : []));
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState(() => {
    const popular = groups[0];
    if (!value || popular?.topics.includes(value)) return popular?.id ?? "";
    return groups.find((g) => g.topics.includes(value))?.id ?? popular?.id ?? "";
  });
  const [chosen, setChosen] = useState(value);
  const searching = query.trim().length > 0;
  const list = useMemo(
    () => (searching ? searchCategories(query, ALL_TOPICS.filter(offered)) : (groups.find((g) => g.id === tab)?.topics ?? [])),
    [searching, query, offered, groups, tab]
  );
  const [active, setActive] = useState<string | null>(null);
  const tabStop = active && list.includes(active) ? active : list.includes(chosen) ? chosen : (list[0] ?? null);

  // ── entrance ──
  const track = (a: Animation) => {
    running.current.push(a);
    return a;
  };
  const riseCards = useCallback((lead: number, gap: number) => {
    const grid = gridRef.current;
    const scroller = scrollRef.current;
    if (!grid || !scroller || prefersReducedMotion()) return;
    const view = scroller.getBoundingClientRect();
    let i = 0;
    for (const el of Array.from(grid.children) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (r.top > view.bottom) break;
      if (r.bottom < view.top) continue;
      running.current.push(
        el.animate(
          [
            { opacity: 0, transform: "translateY(18px) scale(0.96)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: DURATION.row, delay: lead + Math.min(i, 14) * gap, easing: EASE.unfold, fill: "backwards" }
        )
      );
      i++;
    }
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    // Start with the chosen card in view.
    const sel = cards.current.get(value);
    const scroller = scrollRef.current;
    if (sel && scroller) {
      const r = sel.getBoundingClientRect();
      const v = scroller.getBoundingClientRect();
      // Only when it's below the fold: a first-row pick keeps the top of the list.
      if (r.bottom > v.bottom) scroller.scrollTop += r.top - v.top - (v.height - r.height) / 2;
    }
    tabsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    const reduce = prefersReducedMotion();
    if (reduce) {
      track(panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.fade }));
    } else if (mode === "sheet") {
      track(panel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: DURATION.slide, easing: EASE.unfold }));
    } else if (mode === "cover") {
      track(
        panel.animate(
          [
            { opacity: 0, transform: "translateY(16px)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 420, easing: EASE.unfold }
        )
      );
    } else {
      track(
        panel.animate(
          [
            { opacity: 0, transform: "translateY(-8px) scale(0.98)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 420, easing: EASE.unfold }
        )
      );
    }
    if (backdropRef.current) track(backdropRef.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce ? DURATION.fade : 260, easing: "linear" }));
    riseCards(mode === "sheet" ? 150 : DURATION.rowLead, DURATION.stagger);
    // Typing is the fastest way in — except on a phone, where focusing the
    // search would throw the keyboard over the grid.
    if (window.matchMedia("(pointer: fine)").matches) searchRef.current?.focus({ preventScroll: true });
    else panel.focus({ preventScroll: true });
    const anims = running.current;
    return () => anims.forEach((a) => a.cancel());
    // Once, as it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new tab's cards rise too, quicker.
  const firstTab = useRef(true);
  useLayoutEffect(() => {
    if (firstTab.current) {
      firstTab.current = false;
      return;
    }
    if (searching) return;
    scrollRef.current?.scrollTo({ top: 0 });
    riseCards(0, 22);
  }, [tab, searching, riseCards]);

  // ── popover placement ──
  const measure = useCallback(() => {
    const a = anchor.current;
    if (!a) return null;
    const r = a.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(vw - 24, Math.max(460, Math.min(640, r.width)));
    const left = Math.min(Math.max(12, r.left), vw - width - 12);
    const below = vh - r.bottom - 16;
    const above = r.top - 16;
    const want = Math.min(600, vh - 32);
    const room = Math.min(want, 440);
    // Under the field when it fits, over it when that fits, else centred in the window.
    if (below >= room) return { left, width, height: Math.min(want, below), top: r.bottom + 8, above: false };
    if (above >= room) {
      const height = Math.min(want, above);
      return { left, width, height, top: r.top - 8 - height, above: true };
    }
    return { left, width, height: want, top: (vh - want) / 2, above: false };
  }, [anchor]);
  const [box, setBox] = useState(() => (mode === "popover" ? measure() : null));
  useEffect(() => {
    if (mode !== "popover") return;
    const place = () => setBox(measure());
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [mode, measure]);

  // ── leaving ──
  const close = useCallback(
    (opts: { returnFocus?: boolean } = {}) => {
      if (leaving.current) return;
      leaving.current = true;
      onOpenChange(false);
      const panel = panelRef.current;
      const done = () => {
        onExited();
        const a = anchor.current;
        if (opts.returnFocus !== false && a) a.focus({ preventScroll: true });
      };
      if (!panel) return done();
      const reduce = prefersReducedMotion();
      let exit: Keyframe[];
      if (reduce) exit = [{ opacity: 1 }, { opacity: 0 }];
      else if (mode === "sheet") exit = [{ transform: "none" }, { transform: "translateY(100%)" }];
      else {
        // Fold back toward the control that opened it.
        const a = anchor.current?.getBoundingClientRect();
        const p = panel.getBoundingClientRect();
        if (a) panel.style.transformOrigin = `${a.left + a.width / 2 - p.left}px ${a.top + a.height / 2 - p.top}px`;
        exit = [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "scale(0.94)" },
        ];
      }
      const dur = reduce ? DURATION.fade : mode === "sheet" ? DURATION.slideOut : DURATION.fold + 40;
      backdropRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: "linear", fill: "forwards" });
      panel.animate(exit, { duration: dur, easing: EASE.fold, fill: "forwards" }).onfinish = done;
    },
    [anchor, mode, onExited, onOpenChange]
  );

  // Closed from outside (the trigger toggled it): play the exit.
  useEffect(() => {
    if (!open && !leaving.current) close({ returnFocus: false });
  }, [open, close]);

  const pick = (c: string, from: HTMLElement | null, via: "pointer" | "keyboard") => {
    if (leaving.current) return;
    setChosen(c);
    onChange(c);
    if (withRecent) pushRecentCategory(c);
    const reduce = prefersReducedMotion();
    if (!from || reduce) {
      if (via === "pointer" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      close();
      return;
    }
    // The card lifts, then the chooser folds away and the cover flies home.
    from.animate([{ transform: "none" }, { transform: "scale(1.05)" }], { duration: 170, easing: EASE.settle, fill: "forwards" });
    const img = from.querySelector("img");
    window.setTimeout(() => {
      const rect = (img ?? from).getBoundingClientRect();
      if (flyTo?.current) {
        flyCover(posterSrc(c, theme), rect, flyTo.current);
        from.style.opacity = "0";
      }
      // Focus goes home either way; after a tap the search lets go first, so
      // the field isn't handed a keyboard ring nobody asked for.
      if (via === "pointer" && document.activeElement instanceof HTMLElement) document.activeElement.blur();
      close();
    }, 150);
  };

  // ── keyboard ──
  const focusCard = (c: string | undefined) => {
    if (!c) return;
    setActive(c);
    const el = cards.current.get(c);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  };
  const columns = () => {
    const g = gridRef.current;
    if (!g) return 1;
    return Math.max(1, getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length);
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = tabStop ? list.indexOf(tabStop) : -1;
    const cols = columns();
    const last = list.length - 1;
    const go = (j: number) => {
      e.preventDefault();
      focusCard(list[Math.max(0, Math.min(last, j))]);
    };
    switch (e.key) {
      case "ArrowRight":
        return go(i + 1);
      case "ArrowLeft":
        return go(i - 1);
      case "ArrowDown":
        return go(i + cols > last && Math.floor(i / cols) < Math.floor(last / cols) ? last : i + cols);
      case "ArrowUp":
        if (i - cols < 0) {
          e.preventDefault();
          searchRef.current?.focus();
          return;
        }
        return go(i - cols);
      case "Home":
        return go(0);
      case "End":
        return go(last);
      case "PageDown":
        return go(i + cols * 3);
      case "PageUp":
        return go(i - cols * 3);
      case "Enter":
      case " ":
        if (tabStop) {
          e.preventDefault();
          pick(tabStop, cards.current.get(tabStop) ?? null, "keyboard");
        }
        return;
      case "Backspace":
        e.preventDefault();
        setQuery((q) => q.slice(0, -1));
        searchRef.current?.focus();
        return;
    }
    // Typing from the grid goes to the search.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      setQuery((q) => q + e.key);
      searchRef.current?.focus();
    }
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCard(tabStop ?? list[0]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = searching ? list[0] : tabStop;
      if (c) pick(c, cards.current.get(c) ?? null, "keyboard");
    }
  };

  const onTabsKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = groups.findIndex((g) => g.id === tab);
    let j = -1;
    if (e.key === "ArrowRight") j = (i + 1) % groups.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + groups.length) % groups.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = groups.length - 1;
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCard(tabStop ?? list[0]);
      return;
    }
    if (j < 0) return;
    e.preventDefault();
    setTab(groups[j]!.id);
    setActive(null);
    const btn = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${groups[j]!.id}"]`);
    btn?.focus();
    btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onPanelKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Stop here: the sheet or page behind must not close with us.
      e.preventDefault();
      e.stopPropagation();
      if (searching) setQuery("");
      else close();
      return;
    }
    if (e.key !== "Tab") return;
    // Keep Tab inside the chooser while it's open.
    const panel = panelRef.current;
    if (!panel) return;
    const stops = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input, [tabindex="0"]')).filter(
      (el) => el.offsetParent !== null
    );
    if (stops.length === 0) return;
    const first = stops[0]!;
    const lastStop = stops[stops.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      lastStop.focus();
    } else if (!e.shiftKey && document.activeElement === lastStop) {
      e.preventDefault();
      first.focus();
    }
  };

  // ── drawing ──
  const listboxId = `${uid}-list`;
  const tabId = (id: string) => `${uid}-tab-${id}`;
  const optionId = (c: string) => `${uid}-opt-${slug(c)}`;
  const heading = `${uid}-heading`;
  const gridCols =
    mode === "popover" ? "grid-cols-[repeat(auto-fill,minmax(118px,1fr))]" : mode === "sheet" ? "grid-cols-3" : "grid-cols-[repeat(auto-fill,minmax(98px,1fr))]";

  const panelClass = cn(
    "flex flex-col overflow-hidden text-foreground outline-none",
    // --chooser-ground: the panel's own fill, for the gap inside a selected card's ring.
    mode === "cover" && "absolute inset-0 z-30 rounded-[inherit] bg-surface [--chooser-ground:var(--surface)]",
    mode === "sheet" && "sheet-obj fixed inset-x-0 bottom-0 z-[56] h-[min(88dvh,760px)] rounded-t-overlay pb-[env(safe-area-inset-bottom)] [--chooser-ground:var(--surface)]",
    mode === "popover" &&
      "fixed z-[56] rounded-overlay bg-popover shadow-[0_24px_64px_-16px_rgba(0,0,0,0.55),0_0_0_1px_var(--hairline-color)] [--chooser-ground:var(--popover)]"
  );

  const body = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={heading}
      tabIndex={-1}
      onKeyDown={onPanelKey}
      className={panelClass}
      style={
        mode === "popover" && box
          ? { left: box.left, top: box.top, width: box.width, height: box.height, transformOrigin: box.above ? "bottom left" : "top left" }
          : undefined
      }
    >
      {mode === "sheet" && <span aria-hidden className="mx-auto mt-2.5 mb-1 block h-1 w-9 shrink-0 rounded-full bg-tint/[0.28]" />}
      <div className={cn("flex shrink-0 items-center gap-1.5", mode === "cover" ? "px-3 pt-3" : "px-4 pt-3")}>
        {mode === "cover" && (
          <button
            type="button"
            onClick={() => close()}
            aria-label="Back"
            className="press flex size-9 items-center justify-center rounded-full text-foreground hover:bg-tint/[0.06]"
          >
            <CaretLeft size={18} weight="bold" />
          </button>
        )}
        <h2 id={heading} className="min-w-0 flex-1 truncate font-wide text-[17px] font-bold tracking-[-0.02em]">
          {label}
        </h2>
        {mode !== "cover" && (
          <button
            type="button"
            onClick={() => close()}
            aria-label="Close"
            className="press -mr-1.5 flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-tint/[0.06] hover:text-foreground"
          >
            <X size={17} weight="bold" />
          </button>
        )}
      </div>

      <div className={cn("shrink-0 pt-2.5", mode === "cover" ? "px-4" : "px-4")}>
        <label className="relative block">
          <span className="sr-only">Search categories</span>
          <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(null);
            }}
            onKeyDown={onSearchKey}
            placeholder={`Search ${ALL_TOPICS.length} categories`}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-controls={listboxId}
            // One ring: the field's own ember line, drawn inside — never the base outline on top of it.
            className="h-11 w-full rounded-full bg-tint/[0.06] pr-4 pl-10 text-[16px] text-foreground outline-none transition-[background-color,box-shadow] duration-200 placeholder:text-muted-foreground/70 hover:bg-tint/[0.08] focus-visible:bg-tint/[0.08] focus-visible:shadow-[inset_0_0_0_1.5px_var(--ring)] sm:text-[14px] [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      {recent.length > 0 && !searching && (
        <div role="group" aria-labelledby={`${uid}-recent`} className="shrink-0 pt-3">
          <p id={`${uid}-recent`} className="px-4 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Recent
          </p>
          <div className={cn("mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]", EDGE)}>
            {recent.map((c) => {
              const on = c === chosen;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={(e) => pick(c, e.currentTarget.querySelector("img"), e.detail === 0 ? "keyboard" : "pointer")}
                  aria-pressed={on}
                  className={cn(
                    "press flex h-10 shrink-0 items-center gap-2 rounded-[10px] pr-3.5 pl-1.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
                    on ? "bg-inverse text-on-inverse" : "bg-control text-foreground/90 hover:bg-control-hover hover:text-foreground"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own generated cover */}
                  <img src={thumbSrc(c, theme)} alt="" draggable={false} className="h-7 w-[21px] rounded-[4px] object-cover" />
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {searching ? (
        <p aria-live="polite" className="shrink-0 px-4 pt-3 pb-1 text-[12.5px] text-muted-foreground">
          {list.length === 0 ? "No matches" : list.length === 1 ? "1 match" : `${list.length} matches`}
        </p>
      ) : (
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="Families"
          onKeyDown={onTabsKey}
          className={cn("flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none]", EDGE)}
        >
          {groups.map((g) => {
            const on = g.id === tab;
            return (
              <button
                key={g.id}
                id={tabId(g.id)}
                data-tab={g.id}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={listboxId}
                tabIndex={on ? 0 : -1}
                onClick={() => {
                  setTab(g.id);
                  setActive(null);
                }}
                className={cn(
                  "press h-8 shrink-0 rounded-[10px] px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors",
                  on ? "bg-inverse text-on-inverse" : "bg-control text-foreground/80 hover:bg-control-hover hover:text-foreground"
                )}
              >
                {g.name}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-4 [scrollbar-width:thin] [scrollbar-color:var(--hairline-color)_transparent]"
      >
        {list.length === 0 ? (
          <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 text-center">
            <p className="text-[14px] font-semibold">Nothing called &ldquo;{query.trim()}&rdquo;</p>
            <p className="text-[12.5px] text-muted-foreground">Try one word — &ldquo;music&rdquo;, &ldquo;cook&rdquo;, a game&apos;s name.</p>
          </div>
        ) : (
          <div
            ref={gridRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={searching ? heading : tabId(tab)}
            onKeyDown={onGridKey}
            // Room for the focus outline on the outer cards.
            className={cn("grid gap-2.5 p-[5px]", gridCols)}
          >
            {list.map((c, i) => {
              const on = c === chosen;
              return (
                <div
                  key={c}
                  ref={(el) => {
                    if (el) cards.current.set(c, el);
                    else cards.current.delete(c);
                  }}
                  id={optionId(c)}
                  role="option"
                  aria-selected={on}
                  aria-label={c}
                  tabIndex={c === tabStop ? 0 : -1}
                  onFocus={() => setActive(c)}
                  onClick={(e) => pick(c, e.currentTarget, "pointer")}
                  className={cn(
                    "group/card relative aspect-[3/4] cursor-pointer rounded-[10px] bg-tint/[0.05] transition-transform duration-200 select-none hover:-translate-y-0.5",
                    // Selected: a plain foreground ring — unless it's the focused card, which wears the focus ring instead.
                    on && "[&:not(:focus-visible)]:shadow-[0_0_0_2px_var(--chooser-ground),0_0_0_4px_var(--foreground)]"
                  )}
                  style={{ transitionTimingFunction: EASE.drift }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- our own generated poster */}
                  <img
                    src={posterSrc(c, theme)}
                    alt=""
                    draggable={false}
                    loading={i < 18 ? "eager" : "lazy"}
                    decoding="async"
                    className="size-full rounded-[10px] object-cover"
                  />
                  {on && (
                    <span aria-hidden className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-ember text-on-ember">
                      <Check size={14} weight="bold" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  if (mode === "cover") return body;
  return (
    <>
      <div
        ref={backdropRef}
        aria-hidden
        onClick={() => close()}
        className={cn("fixed inset-0 z-[55]", mode === "sheet" ? "bg-black/50" : "bg-transparent")}
      />
      {body}
    </>
  );
}

// ── a field that opens it ───────────────────────────────────────────────

/**
 * A category as a form field: its cover, its name, and a quiet "Change".
 * Schedule, settings and the live details sheet use it; the studio's
 * go-live screen folds it into the title (components/app/studio/quick-setup).
 */
export function CategoryField({
  value,
  onChange,
  id,
  placeholder = "Choose a category",
  exclude,
  recent = false,
  fly = true,
  disabled,
  className,
  label,
}: {
  value: string;
  onChange: (category: string) => void;
  id?: string;
  placeholder?: string;
  exclude?: readonly string[];
  recent?: boolean;
  /** The picked cover flies into the thumbnail. Off where the field empties after a pick. */
  fly?: boolean;
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const thumb = useRef<HTMLImageElement>(null);
  const family = value ? categoryFamily(value) : null;
  return (
    <>
      <button
        ref={button}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={value ? `Category: ${value}. Change` : placeholder}
        className={cn(
          "press group flex h-16 w-full min-w-0 items-center gap-3 rounded-control bg-tint/[0.06] pr-4 pl-2 text-left shadow-[inset_0_0_0_1px_var(--hairline-color)] transition-colors hover:bg-tint/[0.08] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      >
        <CoverThumb ref={thumb} category={value} className="h-12 w-9" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[15px] font-semibold", !value && "font-medium text-muted-foreground")}>{value || placeholder}</span>
          {family && <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{family}</span>}
        </span>
        <span className="shrink-0 text-[13px] font-semibold text-muted-foreground transition-colors group-hover:text-foreground">{value ? "Change" : "Browse"}</span>
      </button>
      <CategoryChooser
        open={open}
        onOpenChange={setOpen}
        value={value}
        onChange={onChange}
        anchor={button}
        flyTo={fly ? thumb : undefined}
        exclude={exclude}
        recent={recent}
        label={label}
      />
    </>
  );
}

// ── suggestions from a title ────────────────────────────────────────────

const STOP = new Set(
  "the and with for you your our my this that from live stream streaming today tonight night day time new lets let about all get got are was were who what when how its it's just some more most very have has had not but out".split(
    " "
  )
);

/**
 * Categories a title seems to be about, for chips under the go-live field:
 * "valo" offers VALORANT, "cooking jollof" offers Food & Cooking. The word
 * being typed counts first; each word needs three letters and a category
 * word (or the whole name) starting with it. Deterministic, nothing learnt.
 */
export function suggestCategories(title: string, current: string, limit = 3): string[] {
  const words = foldText(title)
    .split(" ")
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .reverse();
  const out: string[] = [];
  for (const w of words) {
    const hits: Array<[string, number]> = [];
    for (const c of ALL_TOPICS) {
      const f = foldText(c);
      if (f.replace(/ /g, "").startsWith(w) || f.startsWith(w)) hits.push([c, 0]);
      else if (f.split(" ").some((x) => x.length >= 3 && x.startsWith(w))) hits.push([c, 1]);
    }
    hits.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length);
    for (const [c] of hits) {
      if (c !== current && !out.includes(c)) out.push(c);
      if (out.length >= limit) return out;
    }
  }
  return out;
}
