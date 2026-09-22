"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Eye,
  Fire,
  TrendUp,
  Sparkle,
  SquaresFour,
  Rows,
  Tag,
  Broadcast,
  Clock,
  X,
} from "@phosphor-icons/react";
import { StreamCard } from "@/components/app/stream-card";
import { CategoryCard } from "@/components/app/category-card";
import { UpcomingCard } from "@/components/app/upcoming-card";
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
          <p className="mb-6 hidden text-sm text-muted-foreground md:block">
            Every category ranked by who&apos;s watching, and every live channel with a sort that lets you find the small rooms.
          </p>
        )}

        {!category && (
          <PillTabs
            className="mb-6 md:mb-8"
            label="Browse"
            items={[
              { id: "categories" as const, label: "Categories", icon: SquaresFour },
              { id: "live" as const, label: "Live channels", icon: Broadcast },
              { id: "upcoming" as const, label: "Upcoming", icon: Clock },
            ]}
            value={tab}
            onChange={(id) => setParams({ tab: id === "categories" ? null : id })}
          />
        )}

        {tab === "categories" && <CategoriesTab categories={categories} />}
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
        <div className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-sm shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.1] sm:w-36">
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

function CategoriesTab({ categories }: { categories: CategorySummary[] }) {
  const [order, setOrder] = useState<"viewers" | "live" | "name">("viewers");

  const grouped = useMemo(() => {
    const byName = new Map(categories.map((c) => [c.category, c]));
    const used = new Set<string>();
    const sortFn = (a: CategorySummary, b: CategorySummary) =>
      order === "viewers" ? b.viewers - a.viewers : order === "live" ? b.live - a.live : a.category.localeCompare(b.category);

    const groups = CATEGORY_GROUPS.map((g) => {
      const items = g.topics
        .map((t) => byName.get(t))
        .filter((c): c is CategorySummary => Boolean(c));
      items.forEach((c) => used.add(c.category));
      return { label: g.label, items: items.sort(sortFn), viewers: items.reduce((n, c) => n + c.viewers, 0) };
    }).filter((g) => g.items.length > 0);

    const rest = categories.filter((c) => !used.has(c.category)).sort(sortFn);
    if (rest.length) groups.push({ label: "More", items: rest, viewers: rest.reduce((n, c) => n + c.viewers, 0) });
    // Verticals in audience order too.
    return groups.sort((a, b) => b.viewers - a.viewers);
  }, [categories, order]);

  // Everything else the platform files streams under — every topic nobody
  // is live in right now, still browsable and still with its own art. A
  // directory that only lists what's busy this minute isn't a directory.
  const quiet = useMemo(() => {
    const live = new Set(categories.map((c) => c.category));
    return CATEGORY_GROUPS.map((g) => ({
      label: g.label,
      items: g.topics
        .filter((t) => !live.has(t))
        .map((t): CategorySummary => ({ category: t, live: 0, viewers: 0, cover: null })),
    })).filter((g) => g.items.length > 0);
  }, [categories]);

  return (
    <div className="space-y-9">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground/90 tabular-nums">{categories.length}</span> categories live, grouped by vertical
        </p>
        <SortSelect
          value={order}
          onChange={(v) => setOrder(v as typeof order)}
          options={[
            ["viewers", "By viewers"],
            ["live", "By live channels"],
            ["name", "A to Z"],
          ]}
        />
      </div>

      {grouped.map((g) => (
        <section key={g.label} aria-labelledby={`vertical-${g.label}`}>
          <div className="mb-4 flex items-baseline justify-between">
            <h2 id={`vertical-${g.label}`} className="text-sm font-semibold tracking-tight text-foreground">
              {g.label}
            </h2>
            <span className="text-xs text-muted-foreground/70 tabular-nums">{formatNumber(g.viewers)} watching</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-x-4 md:gap-y-6">
            {g.items.map((c) => (
              <CategoryCard key={c.category} category={c} />
            ))}
          </div>
        </section>
      ))}

      {quiet.length > 0 && (
        <div className="space-y-9 border-t border-white/[0.06] pt-9">
          <div>
            <h2 className="text-[19px] font-semibold tracking-tight text-foreground">All categories</h2>
            <p className="mt-1 text-sm text-muted-foreground">Everything you can go live in, whether or not someone is on right now.</p>
          </div>
          {quiet.map((g) => (
            <section key={`all-${g.label}`} aria-labelledby={`all-${g.label}`}>
              <h3 id={`all-${g.label}`} className="mb-4 text-sm font-semibold tracking-tight text-foreground">
                {g.label}
              </h3>
              <div className="grid grid-cols-3 gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:gap-x-4 md:gap-y-6">
                {g.items.map((c) => (
                  <CategoryCard key={c.category} category={c} />
                ))}
              </div>
            </section>
          ))}
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-sm bg-white/[0.04]" />
            ))}
          </div>
        ) : items.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
            {items.map((item, slot) => (
              <StreamCard
                key={item._id}
                stream={toCard(item)}
                variant="badges"
                impression={{ streamId: item._id, surface: "browse", row: category ? `category:${category}` : sort, slot }}
              />
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
    { id: "hot", title: "Hot", reason: "Most watched right now", Icon: Fire, data: hot },
    { id: "rising", title: "Rising", reason: "Growing fastest, whatever the size", Icon: TrendUp, data: rising },
    { id: "new", title: "New", reason: "Just went live", Icon: Sparkle, data: fresh },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-3">
      {lanes.map((lane) => (
        <section key={lane.id} aria-labelledby={`lane-${lane.id}`} className="min-w-0">
          <div className="mb-3">
            <h3 id={`lane-${lane.id}`} className="flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <lane.Icon size={14} weight="fill" className={lane.id === "rising" ? "text-primary" : "text-muted-foreground"} />
              {lane.title}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground/70">{lane.reason}</p>
          </div>
          <div className="space-y-4">
            {lane.data.loading
              ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-sm bg-white/[0.04]" />)
              : lane.data.items.map((item, slot) => (
                  <StreamCard
                    key={item._id}
                    stream={toCard(item)}
                    variant="compact"
                    impression={{ streamId: item._id, surface: "browse", row: `lane:${lane.id}`, slot }}
                  />
                ))}
          </div>
        </section>
      ))}
    </div>
  );
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
        className="rounded-sm border border-dashed border-white/[0.1] py-12"
        icon={<Broadcast size={32} />}
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
          <div key={i} className="aspect-video animate-pulse rounded-sm bg-white/[0.04]" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty
        className="rounded-sm border border-dashed border-white/[0.1] py-14"
        icon={<Clock size={32} />}
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-x-4 gap-y-6">
            {list.map((item, slot) => (
              <UpcomingCard key={item._id} item={item} impression={{ streamId: item._id, surface: "browse", row: "upcoming", slot }} />
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
