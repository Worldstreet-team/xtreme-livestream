"use client";

import { useState, useEffect, useCallback } from "react";
import { MagnifyingGlass, FunnelSimple, CaretDown } from "@phosphor-icons/react";
import { StreamCard } from "@/components/app/stream-card";
import { POPULAR_CATEGORIES, type Category } from "@/lib/categories";
import { apiFetch, apiUrl } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type SortOption = "viewers" | "recent" | "trending";

/** How often the live grid re-polls so viewer counts stay current. */
const VIEWER_REFRESH_MS = 15_000;

interface APIStream {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  /** API-relative path, or null when the stream has no thumbnail. */
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
}

// Map API stream to the shape StreamCard expects
function toStreamCard(s: APIStream) {
  return {
    id: s._id,
    title: s.title,
    category: s.category,
    tags: s.tags,
    thumbnailUrl: apiUrl(s.thumbnailUrl),
    isLive: s.isLive,
    viewers: s.viewers,
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

export default function ExplorePage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | "All">("All");
  const [sort, setSort] = useState<SortOption>("viewers");
  const [streams, setStreams] = useState<ReturnType<typeof toStreamCard>[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  /** What's actually being streamed right now — drives the filter chips. */
  const [liveCategories, setLiveCategories] = useState<
    Array<{ category: Category; live: number }>
  >([]);

  // Pick up ?search= from the landing-page search bar
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("search");
    if (q) setSearch(q);
  }, []);

  // `silent` powers the background refresh: it must not flash the skeleton or
  // clear the grid on a transient failure, otherwise the page flickers every
  // time viewer counts are polled.
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
      // Keep the current grid on a failed background refresh — only a
      // user-initiated load should surface the empty state.
      if (!silent) {
        setStreams([]);
        setTotal(0);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, selectedCategory, sort]);

  useEffect(() => {
    // Debounce search, instant for other filters
    const timer = setTimeout(fetchStreams, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchStreams, search]);

  // The chip row is dynamic: categories people are streaming in right now,
  // busiest first. Polled on the same cadence as the grid.
  useEffect(() => {
    let cancelled = false;
    async function loadCategories() {
      try {
        const res = await apiFetch<{
          success: boolean;
          data: { categories: Array<{ category: Category; live: number }> };
        }>(`/api/streams/categories`);
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

  // Viewer counts change constantly while streams are live, so the grid has to
  // re-poll — a single fetch on mount goes stale the moment it renders. Paused
  // while the tab is hidden to avoid pointless background traffic.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") fetchStreams(true);
    }, VIEWER_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchStreams]);

  return (
    <div className="min-h-screen p-4 pt-16 md:p-8">
      <div className="mx-auto max-w-[1500px]">
        {/* Header + toolbar on one line; stacks on small screens */}
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Explore
            </h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              {!loading && total > 0 && (
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
                </span>
              )}
              {loading ? "Loading…" : `${total} live now`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-72">
              <MagnifyingGlass
                size={16}
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground/70"
              />
              <input
                type="text"
                placeholder="Search streams…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full rounded-lg bg-white/[0.05] pr-3 pl-9 text-sm text-foreground transition-colors outline-none placeholder:text-muted-foreground/70 focus:bg-white/[0.07]"
              />
            </div>

            <div className="relative shrink-0">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="h-9 cursor-pointer appearance-none rounded-lg bg-white/[0.05] pr-8 pl-3 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus:bg-white/[0.07]"
              >
                <option className="bg-background text-foreground" value="viewers">
                  Most viewers
                </option>
                <option className="bg-background text-foreground" value="recent">
                  Most recent
                </option>
                <option className="bg-background text-foreground" value="trending">
                  Trending
                </option>
              </select>
              <CaretDown
                size={12}
                className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground/70"
              />
            </div>
          </div>
        </div>

        {/* Category filter — dynamic: whatever is live right now, busiest
            first, with popular topics as the quiet fallback. */}
        <div className="mb-8 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {(() => {
            const liveByName = new Map(
              liveCategories.map((c) => [c.category, c.live])
            );
            const names =
              liveCategories.length > 0
                ? liveCategories.map((c) => c.category)
                : POPULAR_CATEGORIES;
            // A selected category must stay visible even after its last
            // stream ends — otherwise the active filter becomes unfindable.
            const chips =
              selectedCategory !== "All" && !names.includes(selectedCategory)
                ? [selectedCategory, ...names]
                : names;
            return ["All" as const, ...chips].map((cat) => {
              const isActive = selectedCategory === cat;
              const live = cat === "All" ? undefined : liveByName.get(cat);
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={cn(
                    "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs transition-colors",
                    isActive
                      ? "bg-white/[0.08] font-medium text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                  )}
                >
                  {cat}
                  {live !== undefined && live > 0 && (
                    <span
                      className={cn(
                        "text-[0.62rem] tabular-nums",
                        isActive
                          ? "text-muted-foreground"
                          : "text-muted-foreground/50"
                      )}
                    >
                      {live}
                    </span>
                  )}
                </button>
              );
            });
          })()}
        </div>

        {/* Stream grid */}
        {loading ? (
          <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <div className="aspect-video animate-pulse rounded-lg bg-white/[0.04]" />
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
          <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {streams.map((stream) => (
              <StreamCard key={stream.id} stream={stream} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <FunnelSimple size={36} className="mb-4 text-muted-foreground/25" />
            <p className="text-sm font-medium text-foreground/80">
              No streams found
            </p>
            <p className="mt-1 text-sm text-muted-foreground/70">
              Try a different search or category.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
