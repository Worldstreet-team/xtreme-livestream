"use client";

import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { FunnelSimple, SquaresFour, ListBullets } from "@/components/icons";
import { Empty } from "@/components/app/empty";
import { SelectField } from "@/components/ui/select-field";
import { StreamCard } from "@/components/app/stream-card";
import { EventCard } from "@/components/app/event-card";
import { CategoryCard } from "@/components/app/category-card";
import { ChannelCard } from "@/components/app/channel-card";
import { Shelf, LiveDot } from "@/components/app/shelf";
import { HomeStage } from "@/components/app/home-stage";
import { PillTabs } from "@/components/ui/tabs";
import { BattlesRow } from "@/components/app/battles-row";
import {
  POPULAR_CATEGORIES,
  CATEGORIES,
  CATEGORY_GROUPS,
  type Category,
} from "@/lib/categories";
import {
  toCard,
  type CategorySummary,
  type HomePage,
  type RowItem,
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

  const chipNames =
    liveCategories.length > 0 ? liveCategories.map((c) => c.category) : POPULAR_CATEGORIES;
  const chips =
    selectedCategory !== "All" && !chipNames.includes(selectedCategory)
      ? [selectedCategory, ...chipNames]
      : chipNames;

  const suggestedCategories = matchCategories(search, liveCategories);

  // Category chips — strictly what is live right now, busiest first by
  // audience. When nothing is live the row is not rendered at all (owner,
  // 2026-09-11): a rail of categories nobody is streaming in is a row of
  // dead ends. The exception is a category the viewer has already picked,
  // which has to stay on screen so they can get back out of it.
  const chipRow =
    liveCategories.length === 0 && selectedCategory === "All" ? null : (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
      {/* Just the names (owner, 2026-09-24): no live counts, no edge. */}
      {(["All" as const, ...chips]).map((cat) => {
        const isActive = selectedCategory === cat;
        return (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            aria-pressed={isActive}
            className={cn(
              "press flex h-9 shrink-0 items-center rounded-[10px] px-4 text-[13.5px] font-semibold transition-colors",
              isActive ? "bg-inverse text-on-inverse" : "bg-control text-foreground/86 hover:bg-control-hover"
            )}
          >
            {cat === "All" ? "For you" : cat}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="w-full">
        {/* Header + toolbar on one line; stacks on small screens */}
        <div className={cn("mb-6 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", !filtered && "hidden")}>
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

        {/* Filtered mode: the chips lead the results, so you can switch or
            get back out. The home itself has no chips — its categories are
            the box-art row under the stage (owner, 2026-09-23). */}
        {/* The chips lead the page in both modes (owner, 2026-09-24:
            "I wanted them above"): on Home they sit over the stage. */}
        {chipRow && <div className={filtered ? "mb-8" : "mb-5"}>{chipRow}</div>}

        {!filtered ? (
          <RowsHome home={home} loading={homeLoading} />
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

function RowsHome({ home, loading }: { home: HomePage | null; loading: boolean }) {
  const feed = useMemo(() => (home ? buildFeed(home) : null), [home]);

  if (loading || !home || !feed) {
    return (
      <div className="space-y-8">
        <div className="aspect-[16/6] animate-pulse rounded-xl bg-tint/[0.04]" />
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="mb-3 h-4 w-40 animate-pulse rounded bg-tint/[0.04]" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="aspect-video animate-pulse rounded-sm bg-tint/[0.04]" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // A quiet hour is not an empty page: the stage still carries what's
  // booked and the house promos, so only the feed goes missing.
  const nothingLive = home.rows.length === 0;

  const eventsShelf =
    feed.events.length > 0 ? (
      <Shelf id="events" title="Events" size="large" peek>
        {feed.events.map((item, slot) => (
          <EventCard key={item._id} item={item} impression={{ streamId: item._id, surface: "home", row: "events", slot }} />
        ))}
      </Shelf>
    ) : null;

  return (
    <div className="space-y-7 md:space-y-10">
      {/* Phones open on the live rings (the shell puts them under the top
          bar — components/app/live-rings.tsx), then the chips and the feed —
          no hero under 768 (owner, 2026-09-07). The stage and battles are
          desktop-only; the Wolf race lives on the rail. */}
      <div className="hidden md:block">
        <HomeStage leads={home.leads} rows={home.rows} />
      </div>

      {/* Battles, live and booked. Renders nothing when there are none. */}
      <div className="hidden md:block">
        <BattlesRow />
      </div>

      {/* Desktop's stage already carries a quiet night; phones get the
          empty state, without a second Go live — that floats over the tab bar. */}
      {nothingLive && (
        <Empty
          className="md:hidden"
          goLive={false}
          artwork={{ src: "/images/empty-states/quiet-orbit.png" }}
          title="Nobody's live right now"
          body="The whole platform is quiet — which makes this a good minute to be the one on air."
          action={{ label: "Browse categories", href: "/browse" }}
        />
      )}

      {feed.following.length > 0 && (
        <Shelf id="followed-live" title="Following" size="large">
          {feed.following.map((item, slot) => (
            <StreamCard key={item._id} stream={toCard(item)} variant="large" impression={{ streamId: item._id, surface: "home", row: "followed-live", slot }} />
          ))}
        </Shelf>
      )}

      {/* The feed, under category headers — two rows deep on desktop —
          with the events slotted in after the second section (owner:
          "events should appear in between feeds"), or at the end when
          there's less than that. */}
      {feed.sections.map((sec, i) => (
        <Fragment key={sec.label}>
          <Shelf id={`cat-${sec.label}`} title={sec.label} rows={2}>
            {sec.items.map((item, slot) => (
              <StreamCard key={item._id} stream={toCard(item)} impression={{ streamId: item._id, surface: "home", row: `cat-${sec.label}`, slot }} />
            ))}
          </Shelf>
          {i === Math.min(1, feed.sections.length - 1) && eventsShelf}
        </Fragment>
      ))}
      {feed.sections.length === 0 && eventsShelf}
    </div>
  );
}

/**
 * The home feed, regrouped from the rows engine's output: the channels you
 * follow first, then every other live room under its category's vertical
 * ("Gaming", "Sports", "Music & Audio"…) busiest first, and the booked
 * streams as events. Each room appears once.
 */
function buildFeed(home: HomePage) {
  const verticalOf = new Map<string, string>();
  CATEGORY_GROUPS.forEach((g) => g.topics.forEach((t) => verticalOf.set(t, g.label)));

  const seen = new Set<string>();
  const once = (it: RowItem) => (seen.has(it._id) ? false : (seen.add(it._id), true));

  const following = (home.rows.find((r) => r.id === "followed-live")?.items ?? []).filter((it) => it.isLive && once(it));

  const byVertical = new Map<string, RowItem[]>();
  home.rows
    .filter((r) => r.kind === "streams" && r.id !== "followed-live")
    .flatMap((r) => r.items)
    .filter((it) => it.isLive && once(it))
    .forEach((it) => {
      const label = verticalOf.get(it.category) ?? "More live";
      byVertical.set(label, [...(byVertical.get(label) ?? []), it]);
    });
  // A vertical with a single room doesn't earn a header of its own; those
  // rooms gather in "More live" at the end, so every section reads as a feed.
  const MORE = "More live";
  const loose = byVertical.get(MORE) ?? [];
  byVertical.delete(MORE);
  for (const [label, items] of [...byVertical.entries()]) {
    if (items.length < 2) {
      loose.push(...items);
      byVertical.delete(label);
    }
  }
  const sections = [...byVertical.entries()]
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => b.viewers - a.viewers),
      viewers: items.reduce((n, it) => n + it.viewers, 0),
    }))
    .sort((a, b) => b.viewers - a.viewers);
  if (loose.length > 0) {
    sections.push({ label: MORE, items: loose.sort((a, b) => b.viewers - a.viewers), viewers: loose.reduce((n, it) => n + it.viewers, 0) });
  }

  const events = home.rows
    .filter((r) => r.kind === "upcoming")
    .flatMap((r) => r.items)
    .filter((it) => it.scheduledStartAt && once(it))
    .sort((a, b) => Date.parse(a.scheduledStartAt!) - Date.parse(b.scheduledStartAt!));

  return { following, sections, events };
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
            <div className="aspect-video animate-pulse rounded-sm bg-tint/[0.04]" />
            <div className="mt-2.5 flex gap-2.5">
              <div className="size-8 shrink-0 animate-pulse rounded-full bg-tint/[0.04]" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-tint/[0.04]" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-tint/[0.04]" />
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
        <div className="mb-1.5 flex rounded-sm bg-tint/[0.05] p-0.5">
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
                view === id ? "bg-tint/[0.1] text-foreground" : "text-muted-foreground hover:text-foreground"
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
