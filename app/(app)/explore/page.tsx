"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import {
  FunnelSimple,
  Broadcast,
  TrendUp,
  Sparkle,
  Clock,
  SquaresFour,
  ListBullets,
} from "@phosphor-icons/react";
import { Empty } from "@/components/app/empty";
import { SelectField } from "@/components/ui/select-field";
import { StreamCard } from "@/components/app/stream-card";
import { UpcomingCard } from "@/components/app/upcoming-card";
import { CategoryCard } from "@/components/app/category-card";
import { ChannelCard } from "@/components/app/channel-card";
import { Shelf, LiveDot } from "@/components/app/shelf";
import { Leads } from "@/components/app/leads";
import { PillTabs } from "@/components/ui/tabs";
import { HomeBanners } from "@/components/app/promo-banner";
import { BattlesRow } from "@/components/app/battles-row";
import { AvatarRingsRow, type RingItem } from "@/components/app/avatar-rings-row";
import {
  POPULAR_CATEGORIES,
  CATEGORIES,
  type Category,
} from "@/lib/categories";
import {
  toCard,
  type CategorySummary,
  type HomePage,
  type HomeRow,
} from "@/lib/discovery";
import { resetImpressions } from "@/lib/impressions";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

/**
 * Home.
 *
 * Two modes. Unfiltered, the page is an ordered list of rows from the rows
 * engine — each owned by one rule, deduplicated against the rows above it —
 * led by up to three leads with honest reasons. Once the viewer searches or
 * picks a category they've said what they want, and the page becomes a
 * plain grid answering exactly that; promoting anything over their own
 * filter would be noise.
 *
 * Search is typed: a name finds the person, a word finds the category, a
 * phrase finds the stream. The typeahead says which before you commit.
 */

type SortOption = "viewers" | "recent" | "trending";
type ResultTab = "all" | "channels" | "live" | "categories";
type ResultView = "grid" | "list";

const REFRESH_MS = 30_000;
const VIEWER_REFRESH_MS = 15_000;

interface APIStream {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  thumbnailUrl: string | null;
  isLive: boolean;
  viewers: number;
  peakViewers: number;
  startedAt: string;
  duration: string;
  streamerId: {
    _id: string;
    username: string;
    displayName: string;
    avatar: string;
    isLive: boolean;
    verified?: boolean;
  };
  guests?: Array<{
    userId: string;
    username: string;
    avatar: string;
    status: "requested" | "live";
  }>;
}

interface ChannelResult {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio: string;
  followers: number;
  verified: boolean;
  isLive: boolean;
  stream: { id: string; title: string; viewers: number } | null;
}

interface FollowedChannel {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isLive: boolean;
  stream: { id: string; viewers: number } | null;
}

function toStreamCard(s: APIStream) {
  return {
    id: s._id,
    title: s.title,
    category: s.category,
    tags: s.tags,
    thumbnailUrl: apiUrl(s.thumbnailUrl),
    liveGuests: (s.guests ?? [])
      .filter((g) => g.status === "live")
      .map((g) => ({ username: g.username, avatar: g.avatar })),
    isLive: s.isLive,
    viewers: s.viewers,
    peakViewers: s.peakViewers,
    startedAt: s.startedAt,
    duration: s.duration,
    streamer: {
      id: s.streamerId._id,
      username: s.streamerId.username,
      displayName: s.streamerId.displayName,
      avatar: s.streamerId.avatar,
      isLive: s.streamerId.isLive,
      verified: s.streamerId.verified ?? false,
    },
  };
}

/** Which shelf treatment a row gets. The followed row earns the large cards. */
function shelfSize(row: HomeRow) {
  if (row.id === "followed-live") return "large" as const;
  return "standard" as const;
}

function shelfAccent(row: HomeRow) {
  if (row.id === "followed-live") return <LiveDot />;
  if (row.id === "trending") return <TrendUp size={14} weight="bold" className="text-primary" />;
  if (row.id === "rising") return <Sparkle size={14} weight="fill" className="text-primary" />;
  if (row.kind === "upcoming") return <Clock size={14} weight="bold" className="text-muted-foreground" />;
  return null;
}

/** Categories whose name contains the term — live ones first, then the taxonomy. */
function matchCategories(term: string, live: CategorySummary[], limit = 6) {
  const q = term.trim().toLowerCase();
  if (!q) return [] as string[];
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (c: string) => {
    if (!c.toLowerCase().includes(q) || seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  live.forEach((c) => add(c.category));
  CATEGORIES.forEach(add);
  return out.slice(0, limit);
}

export default function ExplorePage() {
  const { isAuthenticated } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | "All">("All");
  const [sort, setSort] = useState<SortOption>("viewers");
  const [resultTab, setResultTab] = useState<ResultTab>("all");
  const [resultView, setResultView] = useState<ResultView>("grid");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Rows mode
  const [home, setHome] = useState<HomePage | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [followed, setFollowed] = useState<FollowedChannel[]>([]);

  // Grid mode
  const [streams, setStreams] = useState<ReturnType<typeof toStreamCard>[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [channels, setChannels] = useState<ChannelResult[]>([]);

  const [liveCategories, setLiveCategories] = useState<CategorySummary[]>([]);

  const filtered = Boolean(search.trim()) || selectedCategory !== "All";

  // Pick up ?search= from the landing-page search bar, and ?category= from
  // the category link on every stream card.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("search");
    if (q) setSearch(q);
    const category = params.get("category");
    if (category) setSelectedCategory(category);
    // The top bar owns search; when it submits while this page is already
    // mounted, the term arrives as an event rather than a fresh page.
    const onSearch = (e: Event) => setSearch((e as CustomEvent<string>).detail ?? "");
    window.addEventListener("xtreme:search", onSearch);
    return () => window.removeEventListener("xtreme:search", onSearch);
  }, []);

  // A mode switch is a new page view as far as impressions are concerned.
  useEffect(() => {
    resetImpressions();
  }, [filtered, resultTab]);

  // Close the typeahead on outside click or Escape.
  useEffect(() => {
    if (!searchOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!searchRef.current?.contains(e.target as Node)) setSearchOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSearchOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [searchOpen]);

  /* ---------------- rows mode ---------------- */

  const fetchHome = useCallback(async (silent = false) => {
    if (!silent) setHomeLoading(true);
    try {
      const res = await apiFetch<{ success: boolean; data: HomePage }>(`/api/home`);
      setHome(res.data);
    } catch {
      if (!silent) setHome({ rows: [], leads: [] });
    } finally {
      if (!silent) setHomeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (filtered) return;
    void fetchHome();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchHome(true);
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [filtered, fetchHome, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ success: boolean; data: { channels: FollowedChannel[] } }>(
          `/api/user/me/following`
        );
        if (!cancelled) setFollowed(res.data.channels);
      } catch {
        // Rings row simply doesn't render.
      }
    }
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  /* ---------------- grid mode ---------------- */

  const fetchStreams = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("live", "true");
      if (selectedCategory !== "All") params.set("category", selectedCategory);
      if (search) params.set("search", search);
      params.set("sort", sort);
      params.set("limit", "40");

      const res = await apiFetch<{
        success: boolean;
        data: { streams: APIStream[]; pagination: { total: number } };
      }>(`/api/streams?${params.toString()}`);

      setStreams(res.data.streams.map(toStreamCard));
      setTotal(res.data.pagination.total);
    } catch {
      if (!silent) {
        setStreams([]);
        setTotal(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, selectedCategory, sort]);

  useEffect(() => {
    if (!filtered) return;
    const timer = setTimeout(fetchStreams, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [filtered, fetchStreams, search]);

  useEffect(() => {
    if (!filtered) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") fetchStreams(true);
    }, VIEWER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [filtered, fetchStreams]);

  // Channel results, on the same debounce as the grid — and they also feed
  // the typeahead, so a name search finds the person before you press enter.
  useEffect(() => {
    const term = search.trim();
    if (!term) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ success: boolean; data: { channels: ChannelResult[] } }>(
          `/api/users/search?q=${encodeURIComponent(term)}&limit=8`
        );
        if (!cancelled) setChannels(res.data.channels);
      } catch {
        if (!cancelled) setChannels([]);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  /* ---------------- categories (both modes) ---------------- */

  useEffect(() => {
    let cancelled = false;
    async function loadCategories() {
      try {
        const res = await apiFetch<{ success: boolean; data: { categories: CategorySummary[] } }>(
          `/api/streams/categories`
        );
        if (!cancelled) setLiveCategories(res.data.categories);
      } catch {
        // Fall back to the popular defaults already rendered.
      }
    }
    void loadCategories();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadCategories();
    }, VIEWER_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const liveByName = new Map(liveCategories.map((c) => [c.category, c.live]));
  const chipNames =
    liveCategories.length > 0 ? liveCategories.map((c) => c.category) : POPULAR_CATEGORIES;
  const chips =
    selectedCategory !== "All" && !chipNames.includes(selectedCategory)
      ? [selectedCategory, ...chipNames]
      : chipNames;

  const rings: RingItem[] = followed
    .filter((c) => c.isLive)
    .map((c) => ({
      id: c.id,
      username: c.username,
      displayName: c.displayName,
      avatar: c.avatar,
      isLive: true,
      href: c.stream ? `/stream/${c.stream.id}` : `/c/${c.username}`,
      viewers: c.stream?.viewers ?? null,
    }));

  const suggestedCategories = matchCategories(search, liveCategories);

  // Category chips — strictly what is live right now, busiest first by
  // audience. When nothing is live the row is not rendered at all (owner,
  // 2026-09-11): a rail of categories nobody is streaming in is a row of
  // dead ends. The exception is a category the viewer has already picked,
  // which has to stay on screen so they can get back out of it.
  const chipRow =
    liveCategories.length === 0 && selectedCategory === "All" ? null : (
    <div className="-mx-4 mb-8 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
      {(["All" as const, ...chips]).map((cat) => {
        const isActive = selectedCategory === cat;
        const live = cat === "All" ? undefined : liveByName.get(cat);
        return (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            aria-pressed={isActive}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm transition-colors",
              isActive
                ? "bg-white font-semibold text-neutral-950"
                : "bg-[#26262D] font-medium text-foreground/90 hover:bg-[#31313A]"
            )}
          >
            {cat === "All" ? "For you" : cat}
            {live !== undefined && live > 0 && (
              <span className={cn("flex items-center gap-1 text-xs tabular-nums", isActive ? "text-background/70" : "text-muted-foreground")}>
                <LiveDot />
                {live}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="w-full">
        {/* Header + toolbar on one line; stacks on small screens */}
        <div className={cn("mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", !filtered && "hidden md:flex")}>
          {/* The page's name and live count live in the top bar; only a
              search's own result count is worth a line here. */}
          {filtered ? (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              {total > 0 && <LiveDot />}
              {loading ? "Loading…" : `${total} live ${search.trim() ? `for “${search.trim()}”` : selectedCategory !== "All" ? `in ${selectedCategory}` : "now"}`}
            </p>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">

            {filtered && (
              <SelectField
                size="sm"
                ariaLabel="Sort streams"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                value={sort}
                onChange={(v) => setSort(v as SortOption)}
                options={[
                  { value: "viewers", label: "Most viewers" },
                  { value: "trending", label: "Trending" },
                  { value: "recent", label: "Most recent" },
                ]}
              />
            )}
          </div>
        </div>

        {/* Filtered mode has no hero, so the chips lead the results. On Home
            they sit under the hero instead — the title and the hero come first. */}
        {filtered && chipRow}

        {!filtered ? (
          <RowsHome home={home} loading={homeLoading} rings={rings} categories={liveCategories} chips={chipRow} />
        ) : (
          <FilteredResults
            search={search}
            channels={channels}
            streams={streams}
            loading={loading}
            categories={liveCategories}
            suggestedCategories={suggestedCategories}
            tab={resultTab}
            onTab={setResultTab}
            view={resultView}
            onView={setResultView}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RowsHome({
  home,
  loading,
  rings,
  categories,
  chips,
}: {
  home: HomePage | null;
  loading: boolean;
  rings: RingItem[];
  categories: CategorySummary[];
  /** The category chip row — rendered under the hero, not above it. */
  chips: ReactNode;
}) {
  if (loading || !home) {
    return (
      <div className="space-y-8">
        <div className="aspect-[16/6] animate-pulse rounded-sm bg-white/[0.04]" />
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="mb-3 h-4 w-40 animate-pulse rounded bg-white/[0.04]" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="aspect-video animate-pulse rounded-sm bg-white/[0.04]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const popular = home.rows.find((r) => r.id === "popular");
  const shelves = home.rows.filter((r) => r.id !== "popular");

  // A quiet hour is not an empty page: the hero still carries the house
  // promos and the chips still lead somewhere, so only the rows go missing.
  const nothingLive = home.rows.length === 0;

  const categoryRail =
    categories.length >= 4 ? (
      <Shelf id="categories" title="Categories" href="/browse" size="compact" fullBleed>
        {categories.slice(0, 12).map((c) => (
          <CategoryCard key={c.category} category={c} />
        ))}
      </Shelf>
    ) : null;

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Phones open on the chips and the feed, the way Twitch's app does;
          the hero deck, the banner and the battles strip are desktop-only. */}
      <div className="hidden md:block">
        <Leads leads={home.leads} rows={home.rows} />
      </div>

      {chips}

      {/* The banner strip: a battle in progress, the Wolf race, the biggest room. */}
      <div className="hidden md:block">
        <HomeBanners />
      </div>

      {/* Battles, live and booked. Renders nothing when there are none. */}
      <div className="hidden md:block">
        <BattlesRow />
      </div>

      {rings.length > 0 && (
        <section aria-label="Your channels, live now">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
            <LiveDot />
            Your channels
          </h2>
          <AvatarRingsRow items={rings} />
        </section>
      )}

      {nothingLive && (
        <Empty
          icon={<Broadcast size={36} />}
          title="Nobody's live right now"
          body="The whole platform is quiet — which makes this a good minute to be the one on air."
          action={{ label: "Browse categories", href: "/browse" }}
        />
      )}

      {shelves.map((row, i) => (
        <RowShelfWithRail key={row.id} row={row} rail={i === 1 ? categoryRail : null} />
      ))}
      {shelves.length < 2 && categoryRail}

      {popular && popular.items.length > 0 && (
        <section aria-labelledby="popular-grid">
          <h2 id="popular-grid" className="mb-4 text-sm font-semibold tracking-tight text-foreground">Live channels</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
            {popular.items.map((item, slot) => (
              <StreamCard key={item._id} stream={toCard(item)} impression={{ streamId: item._id, surface: "home", row: "popular", slot }} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function RowShelfWithRail({ row, rail }: { row: HomeRow; rail: React.ReactNode }) {
  return (
    <>
      <Shelf
        id={row.id}
        title={row.title}
        reason={row.reason}
        size={shelfSize(row)}
        accent={shelfAccent(row)}
        href={row.kind === "upcoming" ? "/browse?tab=upcoming" : undefined}
      >
        {row.items.map((item, slot) =>
          row.kind === "upcoming" ? (
            <UpcomingCard key={item._id} item={item} impression={{ streamId: item._id, surface: "home", row: row.id, slot }} />
          ) : (
            <StreamCard
              key={item._id}
              stream={toCard(item)}
              variant={row.id === "followed-live" ? "large" : "badges"}
              impression={{ streamId: item._id, surface: "home", row: row.id, slot, explore: row.explore ?? false }}
            />
          )
        )}
      </Shelf>
      {rail}
    </>
  );
}

/* ------------------------------------------------------------------ */

function FilteredResults({
  search,
  channels,
  streams,
  loading,
  categories,
  suggestedCategories,
  tab,
  onTab,
  view,
  onView,
}: {
  search: string;
  channels: ChannelResult[];
  streams: ReturnType<typeof toStreamCard>[];
  loading: boolean;
  categories: CategorySummary[];
  suggestedCategories: string[];
  tab: ResultTab;
  onTab: (t: ResultTab) => void;
  view: ResultView;
  onView: (v: ResultView) => void;
}) {
  const searching = Boolean(search.trim());
  const matchedCategories = categories.filter((c) => suggestedCategories.includes(c.category));

  const TABS: [ResultTab, string, number | null][] = [
    ["all", "All", null],
    ["channels", "Channels", searching ? channels.length : null],
    ["live", "Live streams", streams.length],
    ["categories", "Categories", searching ? matchedCategories.length : null],
  ];
  const visibleTabs = searching ? TABS : TABS.filter(([id]) => id === "all" || id === "live");

  const streamGrid = (surface: "explore") =>
    loading ? (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="aspect-video animate-pulse rounded-sm bg-white/[0.04]" />
            <div className="mt-2.5 flex gap-2.5">
              <div className="size-8 shrink-0 animate-pulse rounded-full bg-white/[0.04]" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : streams.length > 0 ? (
      view === "list" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {streams.map((stream, slot) => (
            <StreamCard key={stream.id} stream={stream} variant="compact" impression={{ streamId: stream.id, surface, slot }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
          {streams.map((stream, slot) => (
            <StreamCard key={stream.id} stream={stream} variant="badges" impression={{ streamId: stream.id, surface, slot }} />
          ))}
        </div>
      )
    ) : (
      <Empty
        className={searching && channels.length > 0 ? "py-10" : "py-24"}
        icon={<FunnelSimple size={36} />}
        title={searching && channels.length > 0 ? "No stream titles match that" : "No streams found"}
        body={
          !(searching && channels.length > 0)
            ? "Try a different search or category."
            : channels.some((c) => c.isLive)
              ? "Open one of the live channels above to watch now."
              : "None of those channels are live — follow one to hear when they are."
        }
      />
    );

  const channelGrid = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
      {channels.map((c) => (
        <ChannelCard
          key={c.id}
          channel={{
            id: c.id,
            username: c.username,
            displayName: c.displayName,
            avatar: c.avatar,
            bio: c.bio,
            followers: c.followers,
            verified: c.verified,
            isLive: c.isLive,
            liveTitle: c.stream?.title ?? null,
            liveViewers: c.stream?.viewers ?? null,
          }}
        />
      ))}
    </div>
  );

  const categoryGrid = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
      {matchedCategories.map((c) => (
        <CategoryCard key={c.category} category={c} />
      ))}
    </div>
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          label="Results"
          items={visibleTabs.map(([id, label, count]) => ({ id, label, count }))}
          value={tab}
          onChange={onTab}
        />
        <div className="mb-1.5 flex rounded-sm bg-white/[0.05] p-0.5">
          {(
            [
              ["grid", SquaresFour, "Grid"],
              ["list", ListBullets, "List"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onView(id)}
              aria-pressed={view === id}
              title={label}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-xs transition-colors",
                view === id ? "bg-white/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={14} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "channels" && (channels.length > 0 ? channelGrid : <Empty icon={<FunnelSimple size={36} />} title="No channels match that name." />)}
      {tab === "categories" && (matchedCategories.length > 0 ? categoryGrid : <Empty icon={<FunnelSimple size={36} />} title="No live categories match that." />)}
      {tab === "live" && streamGrid("explore")}
      {tab === "all" && (
        <>
          {searching && channels.length > 0 && (
            <section className="mb-10">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Channels</h2>
                {channels.length > 4 && (
                  <button type="button" onClick={() => onTab("channels")} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
                    See all {channels.length}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                {channels.slice(0, 4).map((c) => (
                  <ChannelCard
                    key={c.id}
                    channel={{
                      id: c.id,
                      username: c.username,
                      displayName: c.displayName,
                      avatar: c.avatar,
                      bio: c.bio,
                      followers: c.followers,
                      verified: c.verified,
                      isLive: c.isLive,
                      liveTitle: c.stream?.title ?? null,
                      liveViewers: c.stream?.viewers ?? null,
                    }}
                  />
                ))}
              </div>
            </section>
          )}
          {searching && matchedCategories.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">Categories</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
                {matchedCategories.slice(0, 6).map((c) => (
                  <CategoryCard key={c.category} category={c} />
                ))}
              </div>
            </section>
          )}
          {searching && (channels.length > 0 || matchedCategories.length > 0) && !loading && streams.length > 0 && (
            <h2 className="mb-4 text-sm font-semibold tracking-tight text-foreground">Live streams</h2>
          )}
          {streamGrid("explore")}
        </>
      )}
    </>
  );
}

