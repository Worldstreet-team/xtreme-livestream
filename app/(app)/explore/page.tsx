"use client";

import { useState, useEffect, useCallback } from "react";
import { MagnifyingGlass, FunnelSimple, SortAscending } from "@phosphor-icons/react";
import { StreamCard } from "@/components/app/stream-card";
import { CATEGORIES, CATEGORY_COLORS, type Category } from "@/lib/mock-data";
import { apiFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type SortOption = "viewers" | "recent" | "trending";

interface APIStream {
  _id: string;
  title: string;
  category: Category;
  tags: string[];
  thumbnail: string;
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
  };
}

// Map API stream to the shape StreamCard expects
function toStreamCard(s: APIStream) {
  return {
    id: s._id,
    title: s.title,
    category: s.category,
    tags: s.tags,
    thumbnail: s.thumbnail || "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?q=80&w=800&auto=format&fit=crop",
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
      bio: "",
      followers: 0,
      following: 0,
      totalViews: 0,
      joinedAt: "",
    },
  };
}

export default function ExplorePage() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<Category | "All">("All");
  const [sort, setSort] = useState<SortOption>("viewers");
  const [showLiveOnly, setShowLiveOnly] = useState(true);
  const [streams, setStreams] = useState<ReturnType<typeof toStreamCard>[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const fetchStreams = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showLiveOnly) params.set("live", "true");
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
      setStreams([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, selectedCategory, sort, showLiveOnly]);

  useEffect(() => {
    // Debounce search, instant for other filters
    const timer = setTimeout(fetchStreams, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchStreams, search]);

  const liveCount = streams.filter((s) => s.isLive).length;

  return (
    <div className="min-h-screen p-4 pt-16 md:p-6 md:pt-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Explore Streams</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {loading ? "Loading..." : showLiveOnly ? `${liveCount} streams live now` : `${total} streams`}
        </p>
      </div>

      {/* Search & Filters bar */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-md flex-1">
          <MagnifyingGlass
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            placeholder="Search streams, streamers, tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-lg border border-white/10 bg-white/5 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Live only toggle */}
          <button
            onClick={() => setShowLiveOnly(!showLiveOnly)}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors",
              showLiveOnly
                ? "border-red-500/30 bg-red-500/10 text-red-400"
                : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
            )}
          >
            <span className="relative flex size-2">
              <span
                className={cn(
                  "absolute inline-flex size-full rounded-full opacity-75",
                  showLiveOnly ? "animate-ping bg-red-500" : "bg-muted-foreground"
                )}
              />
              <span
                className={cn(
                  "relative inline-flex size-2 rounded-full",
                  showLiveOnly ? "bg-red-500" : "bg-muted-foreground"
                )}
              />
            </span>
            Live Only
          </button>

          {/* Sort */}
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortOption)}
              className="h-9 appearance-none rounded-lg border border-white/10 bg-white/5 pl-3 pr-8 text-sm text-muted-foreground focus:border-primary/50 focus:outline-none cursor-pointer"
            >
              <option value="viewers">Most Viewers</option>
              <option value="recent">Most Recent</option>
              <option value="trending">Trending</option>
            </select>
            <SortAscending
              size={14}
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="mb-6 flex gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => setSelectedCategory("All")}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            selectedCategory === "All"
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
          )}
        >
          All Categories
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              selectedCategory === cat
                ? CATEGORY_COLORS[cat]
                : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Stream grid */}
      {loading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-white/5 bg-white/[0.02]">
              <div className="aspect-video animate-pulse bg-white/5" />
              <div className="flex gap-3 p-3">
                <div className="size-9 shrink-0 animate-pulse rounded-full bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-white/5" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-white/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : streams.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {streams.map((stream) => (
            <StreamCard key={stream.id} stream={stream} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FunnelSimple size={48} className="text-muted-foreground/30 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">
            No streams found
          </p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Try adjusting your filters or search query
          </p>
        </div>
      )}
    </div>
  );
}
