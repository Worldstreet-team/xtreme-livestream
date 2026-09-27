"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  SquaresFour,
  Rows,
  Tag,
  Broadcast,
  Clock,
  X,
  MagnifyingGlass,
  CaretDown,
} from "@/components/icons";
import { StreamCard } from "@/components/app/stream-card";
import { CategoryCard } from "@/components/app/category-card";
import { Shelf } from "@/components/app/shelf";
import { EventCard } from "@/components/app/event-card";
import { StreamArt } from "@/components/app/stream-art";
import { SelectField } from "@/components/ui/select-field";
import { Empty } from "@/components/app/empty";
import { Pill, PillLink } from "@/components/ui/pill";
import { PillTabs } from "@/components/ui/tabs";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import {
  CATEGORY_GROUPS,
  formatNumber,
  type Category,
} from "@/lib/categories";
import { toCard, type CategorySummary, type RowItem } from "@/lib/discovery";
import { resetImpressions } from "@/lib/impressions";
import { cn } from "@/lib/utils";

/**
 * Browse — the directory.
 *
 * Categories first, grouped by vertical and ranked by audience (not by how
 * many streams). Then live channels with the sort controls Twitch's public
 * browse never shipped: ascending viewers, so the small rooms are findable,
 * and "recently started". A lanes view puts Hot, Rising and New side by
 * side — three rankers, three answers, no single leaderboard.
 */

type Tab = "categories" | "live" | "upcoming";
type Sort = "trending" | "viewers" | "viewers_asc" | "recent";
type View = "grid" | "lanes";

const SORT_LABEL: Record<Sort, string> = {
  trending: "Trending",
  viewers: "Viewers, high to low",
  viewers_asc: "Viewers, low to high",
  recent: "Recently started",
};

const REFRESH_MS = 20_000;

/** Stands in for "no category filter" inside the select. */
const ALL = "all";

function useSummaries() {
  const [categories, setCategories] = useState<CategorySummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<{ success: boolean; data: { categories: CategorySummary[] } }>(
          `/api/streams/categories`
        );
        if (!cancelled) setCategories(res.data.categories);
      } catch {
        // Empty directory rather than an error wall.
      }
    }
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return categories;
}

function useStreams(params: Record<string, string | undefined>, enabled = true) {
  const [items, setItems] = useState<RowItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params);

  const load = useCallback(
    async (silent = false) => {
      if (!enabled) return;
      if (!silent) setLoading(true);
      try {
        const qs = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => v && qs.set(k, v));
        const res = await apiFetch<{
          success: boolean;
          data: { streams: RowItem[]; pagination: { total: number } };
        }>(`/api/streams?${qs.toString()}`);
        setItems(res.data.streams);
        setTotal(res.data.pagination.total);
      } catch {
        if (!silent) {
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, enabled]
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  return { items, total, loading };
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<div className="min-h-screen p-4 md:p-6" />}>
      <Browse />
    </Suspense>
  );
}

function Browse() {
  const router = useRouter();
  const sp = useSearchParams();

  const category = (sp.get("category") ?? "") as Category | "";
  const tab: Tab = category
    ? "live"
    : sp.get("tab") === "live" || sp.get("tab") === "upcoming"
      ? (sp.get("tab") as Tab)
      : "categories";
  const sort = (sp.get("sort") as Sort) || "trending";
  const view = (sp.get("view") as View) || "grid";
  const tag = sp.get("tag") ?? "";

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString());
      Object.entries(patch).forEach(([k, v]) => (v === null || v === "" ? next.delete(k) : next.set(k, v)));
      router.replace(`/browse${next.toString() ? `?${next}` : ""}`, { scroll: false });
    },
    [router, sp]
  );

  useEffect(() => {
    resetImpressions();
  }, [tab, category, sort, tag, view]);

  const categories = useSummaries();
  const summary = category ? categories.find((c) => c.category === category) : undefined;

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="w-full">
        {category ? (
          <CategoryHeader category={category} summary={summary} onClear={() => setParams({ category: null, tag: null })} />
        ) : (
          <>
            {/* Phones: search lives here — Vivid has its seat in the top bar.
                The pill opens the bar's own search row, typeahead and all. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event("xtreme:open-search"))}
              className="press mb-5 flex h-11 w-full items-center gap-2.5 rounded-full bg-tint/[0.06] px-4 text-left text-[15px] text-muted-foreground/80 shadow-[inset_0_0_0_1px_var(--hairline-color)] md:hidden"
            >
              <MagnifyingGlass size={17} aria-hidden />
              Search streams, people, categories
            </button>
          </>
        )}

        {!category && (
          <PillTabs
            className="mb-6 md:mb-8"
            label="Browse"
            items={[
              { id: "categories" as const, label: "Categories", icon: SquaresFour },
              { id: "live" as const, label: "Live channels", icon: Broadcast },
              { id: "upcoming" as const, label: "Events", icon: Clock },
            ]}
            value={tab}
            onChange={(id) => setParams({ tab: id === "categories" ? null : id })}
          />
        )}

        {tab === "categories" && (
          <CategoriesTab
            key={sp.get("vertical") ?? "all"}
            categories={categories}
            vertical={sp.get("vertical") ?? ""}
            setParams={setParams}
          />
        )}
        {tab === "live" && (
          <LiveTab
            category={category}
            sort={sort}
            view={view}
            tag={tag}
            categories={categories}
            setParams={setParams}
          />
        )}
        {tab === "upcoming" && <UpcomingTab />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function CategoryHeader({
  category,
  summary,
  onClear,
}: {
  category: string;
  summary?: CategorySummary;
  onClear: () => void;
}) {
  // A category is a place, not a filter: it gets a banner of its own art,
  // the numbers that matter, and a way back — never a "clear filter" link.
  return (
    <div className="relative mb-8 overflow-hidden rounded-sm">
      <div className="absolute inset-0 scale-110 opacity-40 blur-3xl" aria-hidden>
        <StreamArt src={summary?.cover ?? null} category={category} alt="" seed={category} size={{ w: 640, h: 360 }} />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/70 to-background/40" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />

      <div className="relative flex items-end gap-6 p-5 md:p-7">
        <div className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-sm shadow-popover ring-1 ring-tint/[0.1] sm:w-36">
          <StreamArt src={summary?.cover ?? null} category={category} alt={category} seed={category} size={{ w: 480, h: 640 }} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground/70 uppercase">Category</p>
          <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-foreground md:text-4xl">{category}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(summary?.live ?? 0) > 0 ? <LiveBadge size="md">{` · ${summary?.live}`}</LiveBadge> : <Badge variant="muted" size="md">Nobody live yet</Badge>}
            <Badge variant="glass" size="md" icon={<Eye size={13} weight="bold" />}>
              {formatNumber(summary?.viewers ?? 0)} watching
            </Badge>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <PillLink href="/browse" size="sm" variant="glass" icon={<SquaresFour size={14} />}>
              All categories
            </PillLink>
            <Pill size="sm" variant="ghost" icon={<X size={13} weight="bold" />} onClick={onClear}>
              Close
            </Pill>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** How many columns an auto-fill grid of `min`-wide cells lays out — for "two rows, then Show more". */
function useGridColumns(min: number, gap: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(6);
  useEffect(() => {
    if (!el) return;
    const measure = () => setColumns(Math.max(1, Math.floor((el.clientWidth + gap) / (min + gap))));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, min, gap]);
  return { ref: setEl, columns };
}

const ALL_PAGE = 36;

/**
 * Categories, TikTok LIVE's way (owner, 2026-09-24): verticals as chips
 * along the top, then an even grid of box art — the name and how many are
 * watching under each, the busiest first and the quiet ones after, so it
 * reads as a directory rather than a leaderboard. Pick a vertical and the
 * grid shows two rows with "Show more", and that vertical's live streams
 * follow underneath.
 */
function CategoriesTab({
  categories,
  vertical,
  setParams,
}: {
  categories: CategorySummary[];
  vertical: string;
  setParams: (patch: Record<string, string | null>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [pages, setPages] = useState(1);
  const { ref, columns } = useGridColumns(150, 16);

  const group = CATEGORY_GROUPS.find((g) => g.label === vertical) ?? null;

  // Verticals with something live, busiest first — the chips.
  const verticals = useMemo(() => {
    const byName = new Map(categories.map((c) => [c.category, c.viewers]));
    return CATEGORY_GROUPS.map((g) => ({
      label: g.label,
      viewers: g.topics.reduce((n, t) => n + (byName.get(t) ?? 0), 0),
      live: g.topics.some((t) => byName.has(t)),
    }))
      .filter((v) => v.live)
      .sort((a, b) => b.viewers - a.viewers);
  }, [categories]);

  // The cards: live categories by audience, then everything else in the taxonomy.
  const cards = useMemo(() => {
    const live = categories
      .filter((c) => !group || group.topics.includes(c.category))
      .sort((a, b) => b.viewers - a.viewers);
    const liveNames = new Set(live.map((c) => c.category));
    const topics = group ? group.topics : CATEGORY_GROUPS.flatMap((g) => g.topics);
    const quiet = topics
      .filter((t) => !liveNames.has(t) && !categories.some((c) => c.category === t))
      .map((t): CategorySummary => ({ category: t, live: 0, viewers: 0, cover: null }));
    return [...live, ...quiet];
  }, [categories, group]);

  const limit = group ? (expanded ? cards.length : columns * 2) : pages * ALL_PAGE;
  const visible = cards.slice(0, limit);
  const more = cards.length > visible.length;

  const { items: streams, loading } = useStreams({ live: "true", sort: "viewers", limit: "50" }, Boolean(group));
  const groupStreams = group ? streams.filter((s) => group.topics.includes(s.category)) : [];

  const chip = (active: boolean) =>
    cn(
      "press flex h-9 shrink-0 items-center rounded-[10px] px-4 text-[13.5px] font-semibold transition-colors",
      active ? "bg-inverse text-on-inverse" : "bg-control text-foreground/86 hover:bg-control-hover",
    );

  return (
    <div>
      <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
        <button type="button" aria-pressed={!group} onClick={() => setParams({ vertical: null })} className={chip(!group)}>
          All categories
        </button>
        {verticals.map((v) => (
          <button key={v.label} type="button" aria-pressed={group?.label === v.label} onClick={() => setParams({ vertical: v.label })} className={chip(group?.label === v.label)}>
            {v.label}
          </button>
        ))}
      </div>

      <div ref={ref} className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-7">
        {visible.map((c) => (
          <CategoryCard key={c.category} category={c} />
        ))}
      </div>

      {(more || (group && expanded && cards.length > columns * 2)) && (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => (group ? setExpanded((e) => !e) : setPages((n) => n + 1))}
            className="press flex items-center gap-1.5 rounded-full px-4 py-2 text-[14px] font-semibold text-foreground/80 transition-colors hover:bg-tint/[0.05] hover:text-foreground"
          >
            {group && expanded ? "Show less" : "Show more"}
            <CaretDown size={14} weight="bold" className={cn("transition-transform", group && expanded && "rotate-180")} />
          </button>
        </div>
      )}

      {group && (
        <div className="mt-12">
          {loading ? (
            <RowSkeleton />
          ) : groupStreams.length > 0 ? (
            <Shelf id="vertical-live" title="LIVE streams">
              {groupStreams.map((item, slot) => (
                <StreamCard key={item._id} stream={toCard(item)} impression={{ streamId: item._id, surface: "browse", row: `vertical-${group.label}`, slot }} />
              ))}
            </Shelf>
          ) : (
            <p className="text-[14px] text-muted-foreground">Nobody in {group.label} is live right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LiveTab({
  category,
  sort,
  view,
  tag,
  categories,
  setParams,
}: {
  category: string;
  sort: Sort;
  view: View;
  tag: string;
  categories: CategorySummary[];
  setParams: (patch: Record<string, string | null>) => void;
}) {
  const { items, total, loading } = useStreams(
    { live: "true", category: category || undefined, sort, tag: tag || undefined, limit: "48" },
    view === "grid"
  );

  // Tag chips come from what's actually live in this scope, most-used first.
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    items.forEach((s) => s.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t]) => t);
    return tag && !top.includes(tag) ? [tag, ...top] : top;
  }, [items, tag]);

  return (
    <div>
      {/* No filter pane. A category is the page you're on; sort and view
          are one row of controls, and tags are chips under it. */}
      <div className="min-w-0">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading…" : (
              <>
                <span className="font-medium text-foreground/90 tabular-nums">{total}</span> live
                {tag && <> tagged <span className="text-foreground/90">#{tag}</span></>}
              </>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!category && (
              <SortSelect
                // "" is reserved by the select for "nothing chosen", so the
                // everything option travels as a word and converts at the edge.
                value={category || ALL}
                onChange={(v) => setParams({ category: v === ALL ? null : v, tag: null })}
                options={[[ALL, "All categories"], ...categories.map((c) => [c.category, `${c.category} · ${c.live}`] as [string, string])]}
              />
            )}
            <SortSelect
              value={sort}
              onChange={(v) => setParams({ sort: v === "trending" ? null : v })}
              options={Object.entries(SORT_LABEL) as [Sort, string][]}
            />
            <PillTabs
              size="sm"
              label="View"
              items={[
                { id: "grid" as const, label: "Grid", icon: SquaresFour },
                { id: "lanes" as const, label: "Hot · Rising · New", icon: Rows },
              ]}
              value={view}
              onChange={(id) => setParams({ view: id === "grid" ? null : id })}
            />
          </div>
        </div>

        {tags.length > 0 && (
          <div className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:px-0">
            {tags.map((t) => (
              <Pill
                key={t}
                size="sm"
                variant={tag === t ? "soft" : "glass"}
                tone={tag === t ? "red" : "neutral"}
                aria-pressed={tag === t}
                onClick={() => setParams({ tag: tag === t ? null : t })}
                icon={<Tag size={13} weight={tag === t ? "fill" : "regular"} />}
              >
                {t}
              </Pill>
            ))}
          </div>
        )}

        {view === "lanes" ? (
          <Lanes category={category} tag={tag} />
        ) : loading ? (
          <RowSkeleton />
        ) : items.length > 0 ? (
          // Rows, never a stacked wall (owner, 2026-09-24): one sliding row
          // per vertical, or a single row inside a category.
          <div className="space-y-9">
            {(category ? [{ label: "LIVE streams", items }] : byVertical(items)).map((row) => (
              <Shelf key={row.label} id={`live-${row.label}`} title={row.label}>
                {row.items.map((item, slot) => (
                  <StreamCard
                    key={item._id}
                    stream={toCard(item)}
                    impression={{ streamId: item._id, surface: "browse", row: category ? `category:${category}` : `${sort}:${row.label}`, slot }}
                  />
                ))}
              </Shelf>
            ))}
          </div>
        ) : (
          <EmptyCategory category={category} categories={categories} tag={tag} onClearTag={() => setParams({ tag: null })} />
        )}
      </div>
    </div>
  );
}

function Lanes({ category, tag }: { category: string; tag: string }) {
  const base = { live: "true", category: category || undefined, tag: tag || undefined, limit: "8" };
  const hot = useStreams({ ...base, sort: "viewers" });
  const rising = useStreams({ ...base, sort: "trending" });
  const fresh = useStreams({ ...base, sort: "recent" });

  const lanes = [
    { id: "hot", title: "Hot", reason: "Most watched right now", data: hot },
    { id: "rising", title: "Rising", reason: "Growing fastest, whatever the size", data: rising },
    { id: "new", title: "New", reason: "Just went live", data: fresh },
  ];

  return (
    <div className="space-y-9">
      {lanes.map((lane) =>
        lane.data.loading ? (
          <RowSkeleton key={lane.id} />
        ) : lane.data.items.length > 0 ? (
          <Shelf key={lane.id} id={`lane-${lane.id}`} title={lane.title} reason={lane.reason}>
            {lane.data.items.map((item, slot) => (
              <StreamCard key={item._id} stream={toCard(item)} impression={{ streamId: item._id, surface: "browse", row: `lane:${lane.id}`, slot }} />
            ))}
          </Shelf>
        ) : null,
      )}
    </div>
  );
}

/** A row's worth of placeholders while streams load. */
function RowSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="aspect-video w-[300px] shrink-0 animate-pulse rounded-sm bg-tint/[0.04]" />
      ))}
    </div>
  );
}

/** Live streams gathered under their vertical, busiest vertical first. */
function byVertical(items: RowItem[]) {
  const verticalOf = new Map<string, string>();
  CATEGORY_GROUPS.forEach((g) => g.topics.forEach((t) => verticalOf.set(t, g.label)));
  const rows = new Map<string, RowItem[]>();
  items.forEach((it) => {
    const label = verticalOf.get(it.category) ?? "More live";
    rows.set(label, [...(rows.get(label) ?? []), it]);
  });
  return [...rows.entries()]
    .map(([label, list]) => ({ label, items: list, viewers: list.reduce((n, it) => n + it.viewers, 0) }))
    .sort((a, b) => b.viewers - a.viewers);
}

function EmptyCategory({
  category,
  categories,
  tag,
  onClearTag,
}: {
  category: string;
  categories: CategorySummary[];
  tag: string;
  onClearTag: () => void;
}) {
  const group = CATEGORY_GROUPS.find((g) => g.topics.includes(category));
  const related = categories
    .filter((c) => c.category !== category && (!group || group.topics.includes(c.category)))
    .slice(0, 6);
  const fallback = related.length > 0 ? related : categories.filter((c) => c.category !== category).slice(0, 6);

  return (
    <div className="py-6">
      <Empty
        className="rounded-sm border border-dashed border-tint/[0.1] py-12"
        scene={tag ? "search" : "live"}
        title={tag ? `Nobody live with #${tag}${category ? ` in ${category}` : ""}` : category ? `Nobody live in ${category} right now` : "Nobody live right now"}
        body={
          tag
            ? "Try without the tag, or pick a related category."
            : category
              ? `An empty category is an open one — go live in ${category} and you have it to yourself.`
              : "Live inventory changes by the hour — here's what's on nearby."
        }
        {...(tag ? { action: { label: "Clear tag", onClick: onClearTag } } : {})}
      />
      {fallback.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-4 text-sm font-semibold tracking-tight text-foreground">
            {related.length > 0 && group ? `More in ${group.label}` : "Live now elsewhere"}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
            {fallback.map((c) => (
              <CategoryCard key={c.category} category={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function UpcomingTab() {
  const { items, loading } = useStreams({ status: "upcoming", limit: "48" });

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-video animate-pulse rounded-sm bg-tint/[0.04]" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty
        className="rounded-sm border border-dashed border-tint/[0.1] py-14"
        scene="scheduled"
        title="Nothing scheduled yet"
        body="When a channel schedules a broadcast it shows up here — or skip the calendar and start now."
      />
    );
  }

  // Group by day so a week of schedule reads as a calendar, not a list.
  const days = new Map<string, RowItem[]>();
  items.forEach((i) => {
    const d = i.scheduledStartAt ? new Date(i.scheduledStartAt) : new Date();
    const key = d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    (days.get(key) ?? days.set(key, []).get(key)!).push(i);
  });

  return (
    <div className="space-y-10">
      {[...days.entries()].map(([day, list]) => (
        <section key={day} aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className="mb-4 text-sm font-semibold tracking-tight text-foreground">
            {day}
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
            {list.map((item, slot) => (
              <EventCard key={item._id} item={item} impression={{ streamId: item._id, surface: "browse", row: "upcoming", slot }} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SortSelect({
  value,
  onChange,
  options,
  full = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  full?: boolean;
}) {
  return (
    <SelectField
      size="sm"
      full={full}
      className={full ? undefined : "shrink-0"}
      value={value}
      onChange={onChange}
      options={options.map(([v, label]) => ({ value: v, label }))}
    />
  );
}
