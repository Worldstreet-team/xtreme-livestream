"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowRight, CalendarPlus, Check, ImageEdit, ImageSquare, Warning, X } from "@/components/icons";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { CATEGORY_GROUPS } from "@/lib/categories";
import { categoryArt } from "@/lib/category-art";
import type { RowItem } from "@/lib/discovery";
import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select-field";
import { SwitchField } from "@/components/ui/selection-controls";
import { VanishingPlaceholder } from "@/components/ui/vanishing-placeholder";
import { CalendarMonth, TimeList, dayKey, startOfDay, zoneName } from "@/components/ui/date-time-picker";
import { EventCard } from "@/components/app/event-card";
import { UpcomingCard } from "@/components/app/upcoming-card";

/**
 * Schedule — book a stream before it airs. Three tiles in the order you
 * think it: what it is (title, category, cover), when (any day in the next
 * year, any quarter hour), and a last look before you book it. Beside the
 * first, the exact cards your followers will see, updating as you type.
 * Underneath, the week ahead and every booking, each with "Go live now"
 * and a two-step cancel.
 *
 * A booking is a real upcoming stream (`POST /streams/schedule`): it shows
 * in Events, on your channel and in Following; people set reminders; and
 * going live from it keeps its link, its cover and those reminders.
 */

/** Mirrors SCHEDULE_HORIZON_MS in @xtreme/contracts — the API enforces it. */
const HORIZON_MS = 365 * 24 * 60 * 60_000;
/** The API wants a couple of minutes' notice; ask for five so the clock can't beat you. */
const MIN_LEAD_MS = 5 * 60_000;
const STEP_MIN = 15;
/** Shown one at a time in the empty title, WorldSpace-style — short enough to fit a phone. */
const PROMPTS = ["Friday night set", "Ranked to Immortal", "Charts & coffee", "Market open, live", "Weekend League grind", "Ask me anything"];

const TILE = "relative overflow-hidden rounded-panel bg-surface";
const EYEBROW = "caps font-mono text-[10.5px] text-muted-foreground";

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function at(day: Date, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h ?? 0, m ?? 0);
}

/** The first quarter hour on `day` at or after `t`, or null when the day is spent. */
function firstSlotFrom(day: Date, t: number) {
  for (let m = 0; m < 24 * 60; m += STEP_MIN) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    if (at(day, hhmm).getTime() >= t) return hhmm;
  }
  return null;
}

/** Tonight at eight if that's comfortably ahead, otherwise tomorrow at eight. */
function defaultDay() {
  const today = startOfDay(new Date());
  return at(today, "20:00").getTime() - Date.now() > 30 * 60_000 ? today : addDays(today, 1);
}

function dayLabel(d: Date, today: Date) {
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function until(iso: string, now: number) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "starting now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `in ${Math.floor(h / 24)} days`;
  if (h >= 24) return `in 1d ${h - 24}h`;
  if (h >= 1) return `in ${h}h ${String(m).padStart(2, "0")}m`;
  return `in ${Math.max(1, m)} min`;
}

/** "8:00" and "PM" apart, so the numerals can be set big and the period small. */
function clockParts(d: Date) {
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(d);
  return {
    clock: parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim(),
    period: parts.find((p) => p.type === "dayPeriod")?.value ?? "",
  };
}

/**
 * A picked image, cropped to 16:9 from the centre and made small enough for
 * the API's 200 KB image limit — it steps down in size until it fits.
 */
async function toCover(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    for (const [w, q] of [[960, 0.82], [800, 0.74], [640, 0.68]] as const) {
      const h = Math.round((w * 9) / 16);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      const data = canvas.toDataURL("image/jpeg", q);
      if (data.length < 190_000) return data;
    }
    throw new Error("too big");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function SchedulePage() {
  const { user } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const today = useMemo(() => startOfDay(new Date(now)), [now]);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Just Chatting");
  const [cover, setCover] = useState("");
  const [day, setDay] = useState(defaultDay);
  const [time, setTime] = useState("20:00");
  const [notify, setNotify] = useState(true);
  const [worldSpace, setWorldSpace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const [bookings, setBookings] = useState<RowItem[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const r = await apiFetch<{ success: boolean; data: { streams: RowItem[] } }>(
        `/api/streams?status=upcoming&streamer=${encodeURIComponent(user.username)}&limit=50`,
      );
      setBookings(r.data.streams.filter((s) => s.scheduledStartAt));
    } catch {
      setBookings([]);
    }
  }, [user]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
    };
  }, [load]);

  const earliest = now + MIN_LEAD_MS;
  const latest = useMemo(() => addDays(today, 364), [today]);
  const when = at(day, time);
  const tooSoon = when.getTime() < earliest;
  const tooLate = when.getTime() > now + HORIZON_MS - 60_000;
  const zone = zoneName(when);
  const { clock, period } = clockParts(when);
  const marked = useMemo(() => new Set((bookings ?? []).map((b) => dayKey(new Date(b.scheduledStartAt!)))), [bookings]);

  // A day whose chosen time has already gone (today, late) slides to its next free quarter hour.
  const pickDay = (d: Date) => {
    setDay(d);
    if (at(d, time).getTime() < Date.now() + MIN_LEAD_MS) {
      const next = firstSlotFrom(d, Date.now() + MIN_LEAD_MS);
      if (next) setTime(next);
    }
  };

  const draft: RowItem | null = user
    ? {
        _id: "preview",
        title: title.trim() || "Name your stream — it's the first thing people read",
        category: category as RowItem["category"],
        tags: [],
        thumbnailUrl: cover || null,
        isLive: false,
        status: "upcoming",
        viewers: 0,
        peakViewers: 0,
        velocity: 0,
        startedAt: null,
        scheduledStartAt: when.toISOString(),
        duration: "",
        streamerId: { _id: "me", username: user.username, displayName: user.displayName || user.username, avatar: user.avatar ?? "", isLive: false },
        reminded: false,
      }
    : null;

  const book = async () => {
    if (!title.trim()) {
      setNote({ ok: false, text: "Give it a title first — it's the first thing people read." });
      return;
    }
    if (tooSoon || tooLate) {
      setNote({ ok: false, text: tooSoon ? "That time's too close. Pick one at least five minutes out — or just go live now." : "Bookings go up to a year ahead. Pick an earlier day." });
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await apiFetch<{ success: boolean; data: { stream: { id: string } } }>(`/api/streams/schedule`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          category,
          tags: [],
          thumbnail: cover,
          notifyFollowers: notify,
          postToWorldSpace: worldSpace,
          scheduledStartAt: when.toISOString(),
        }),
      });
      setFresh(String(r.data.stream.id));
      setNote({
        ok: true,
        text: `Booked for ${when.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} at ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. Your followers can set a reminder now.`,
      });
      setTitle("");
      setCover("");
      await load();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Couldn't book that" });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    await apiFetch(`/api/streams/${id}/schedule`, { method: "DELETE" });
    setBookings((b) => (b ?? []).filter((s) => s._id !== id));
  };

  return (
    <div className="min-h-screen px-4 pt-6 pb-16 md:px-8 md:pt-10">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-7 md:mb-9">
          {/* Schedule lives under Your channel (owner, 2026-09-24) — no rail entry of its own. */}
          <nav aria-label="Breadcrumb" className={cn(EYEBROW, "flex items-center gap-2")}>
            <Link href="/dashboard" className="transition-colors hover:text-foreground">
              Your channel
            </Link>
            <span aria-hidden className="text-muted-foreground/40">/</span>
            <span aria-current="page" className="text-foreground/80">Schedule</span>
          </nav>
          <h1 className="mt-2 max-w-[16ch] font-wide text-[clamp(2rem,4.2vw,3.4rem)] leading-[0.98] font-bold tracking-[-0.04em] text-balance">
            Book it. They&apos;ll be there.
          </h1>
          <p className="mt-3 max-w-[54ch] text-[15px] leading-relaxed text-muted-foreground">
            A booked stream shows up in Events, on your channel and in Following. Followers set a reminder, and they hear the second you go live.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {/* ── What ─────────────────────────────────────────────────── */}
          <section aria-labelledby="what-title" className={cn(TILE, "p-6 md:p-8 lg:col-span-7")}>
            <h2 id="what-title" className="sr-only">
              The stream
            </h2>
            <label htmlFor="schedule-title" className={EYEBROW}>
              What&apos;s the stream?
            </label>
            <div className="relative mt-2">
              {!title && (
                <VanishingPlaceholder
                  texts={PROMPTS}
                  className="font-wide text-[clamp(1.35rem,2.4vw,1.75rem)] font-bold tracking-[-0.025em] text-foreground/25"
                />
              )}
              <input
                id="schedule-title"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 100))}
                autoComplete="off"
                className="relative block w-full border-0 bg-transparent p-0 font-wide text-[clamp(1.35rem,2.4vw,1.75rem)] leading-[1.3] font-bold tracking-[-0.025em] text-foreground outline-none"
              />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 font-mono text-[11px] text-muted-foreground tabular-nums">
              <span>Shows on the card, in Events and on your channel</span>
              <span>{title.length}/100</span>
            </div>

            <div className="mt-7">
              <label htmlFor="schedule-category" className={EYEBROW}>
                Where it lives
              </label>
              <div className="mt-2">
                <SelectField
                  id="schedule-category"
                  full
                  value={category}
                  onChange={setCategory}
                  searchPlaceholder="Search 170 categories"
                  art={(v) => categoryArt(v, { w: 72, h: 96 })}
                  groups={CATEGORY_GROUPS.map((g) => ({ label: g.label, options: g.topics.map((t) => ({ value: t, label: t })) }))}
                />
              </div>
            </div>

            <CoverField category={category} cover={cover} onChange={setCover} />
          </section>

          {/* ── What they see ───────────────────────────────────────── */}
          <aside aria-label="What your followers see" className="flex flex-col gap-3 lg:col-span-5">
            <div className={cn(TILE, "p-6 md:p-7")}>
              <p className={EYEBROW}>On your channel and in Following</p>
              <div className="mt-4" inert>
                {draft && <UpcomingCard item={draft} />}
              </div>
            </div>
            <div className={cn(TILE, "flex-1 p-6 md:p-7")}>
              <p className={EYEBROW}>In Events</p>
              <div className="mt-4" inert>
                {draft && <EventCard item={draft} className="bg-surface-raised" />}
              </div>
            </div>
          </aside>

          {/* ── When ─────────────────────────────────────────────────── */}
          <section aria-labelledby="when-title" className={cn(TILE, "p-6 md:p-8 lg:col-span-7")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="when-title" className={EYEBROW}>
                When
              </h2>
              <span className="rounded-full bg-control px-2.5 py-1 font-mono text-[11px] text-muted-foreground">Your time · {zone}</span>
            </div>
            {/* Side by side only when the tile has the room — measured on the tile, not the screen. */}
            <div className="@container mt-5">
              <div className="grid gap-6 @lg:grid-cols-[minmax(0,1fr)_164px] @lg:gap-8">
                <CalendarMonth value={day} onChange={pickDay} min={new Date(earliest)} max={latest} marked={marked} />
                <TimeList day={day} value={time} onChange={setTime} earliest={earliest} step={STEP_MIN} className="h-[264px] @lg:h-[330px]" />
              </div>
            </div>
            <p className="mt-5 text-[12.5px] text-muted-foreground">
              {marked.size > 0 ? "Dotted days already have a booking. " : ""}Any day in the next year — a few days out gives reminders time to find people.
            </p>
          </section>

          {/* ── Book ─────────────────────────────────────────────────── */}
          <section
            aria-labelledby="book-title"
            className="relative isolate flex flex-col overflow-hidden rounded-panel bg-ember text-on-ember p-6 md:p-8 lg:col-span-5"
          >
            <h2 id="book-title" className="caps font-mono text-[10.5px] text-on-ember/70">
              You&apos;re going live
            </h2>
            <p className="mt-4 font-wide text-[clamp(1.35rem,2.3vw,1.75rem)] leading-tight font-bold tracking-[-0.03em] text-on-ember">
              {when.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2.5 text-on-ember">
              <span className="font-money text-[clamp(3rem,6vw,4.5rem)] leading-none tabular-nums">{clock}</span>
              {period && <span className="font-wide text-[18px] font-bold text-on-ember/75">{period}</span>}
              <span className="font-mono text-[12px] text-on-ember/55">{zone}</span>
            </p>
            <p className={cn("mt-3 font-mono text-[12.5px] tabular-nums", tooSoon || tooLate ? "font-bold text-on-ember" : "text-on-ember/70")}>
              {tooSoon ? "That's too soon — pick a later time" : tooLate ? "That's more than a year out" : until(when.toISOString(), now)}
            </p>

            {/* On Ember the switches go ink: an ember track would vanish. */}
            <div className="mt-6 grid gap-1 border-t border-on-ember/15 pt-4 [&_p]:text-on-ember/70">
              <SwitchField label="Tell my followers" description="They get a nudge the moment you go live." checked={notify} onCheckedChange={setNotify} className="before:bg-on-ember/15 before:shadow-none data-[state=checked]:before:bg-on-ember data-[state=checked]:before:shadow-none" />
              <SwitchField label="Post to WorldSpace" description="Cross-post the broadcast to the WorldSpace feed when it starts." checked={worldSpace} onCheckedChange={setWorldSpace} className="before:bg-on-ember/15 before:shadow-none data-[state=checked]:before:bg-on-ember data-[state=checked]:before:shadow-none" />
            </div>

            <div className="mt-auto pt-6">
              <button
                type="button"
                onClick={book}
                disabled={busy || !user}
                className="press flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white text-[15px] font-semibold text-[#0b0708] disabled:opacity-60"
              >
                <CalendarPlus size={18} weight="bold" />
                {busy ? "Booking…" : "Book it"}
              </button>
              {note && (
                <p className={cn("mt-4 flex items-start gap-2 text-[13.5px] leading-snug", note.ok ? "text-on-ember" : "font-semibold text-on-ember")}>
                  {note.ok ? <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-on-ember" /> : <Warning size={15} className="mt-0.5 shrink-0" />}
                  {note.text}
                </p>
              )}
              <p className="mt-4 text-[12px] leading-relaxed text-on-ember/55">Your first booking pays 150 points — claim it under Rewards → Milestones.</p>
            </div>
          </section>
        </div>

        {/* ── Coming up ────────────────────────────────────────────── */}
        <section aria-labelledby="week-title" className="mt-10 md:mt-14">
          <div className="mb-5">
            <h2 id="week-title" className="font-wide text-[24px] font-bold tracking-[-0.03em]">
              Coming up
            </h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {bookings === null
                ? "Loading your bookings…"
                : bookings.length === 0
                  ? "Nothing booked yet. The first one's the hardest."
                  : `${bookings.length} booked · the next ${until(bookings[0]!.scheduledStartAt!, now)}`}
            </p>
          </div>

          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none md:mx-0 md:grid md:grid-cols-7 md:overflow-visible md:px-0">
            {Array.from({ length: 7 }, (_, i) => addDays(today, i)).map((d) => {
              const mine = (bookings ?? []).filter((b) => startOfDay(new Date(b.scheduledStartAt!)).getTime() === d.getTime());
              const isToday = d.getTime() === today.getTime();
              return (
                <div key={d.toISOString()} className={cn(TILE, "flex min-h-[150px] w-[132px] shrink-0 flex-col p-3.5 md:w-auto")}>
                  <p className={cn("text-[11.5px] font-semibold", isToday ? "text-ember-hi" : "text-muted-foreground")}>{dayLabel(d, today)}</p>
                  <p className="font-money text-[30px] leading-none tabular-nums">{d.getDate()}</p>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {mine.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground/60">Free</p>
                    ) : (
                      mine.map((b) => (
                        <div key={b._id} className={cn("rounded-[8px] bg-ember/[0.12] px-2 py-1.5", fresh === b._id && "motion-safe:animate-[xt-spring-in_.5s_var(--ease-spring)_both]")}>
                          <p className="font-mono text-[11px] font-bold text-ember-hi tabular-nums">
                            {new Date(b.scheduledStartAt!).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                          </p>
                          <p className="line-clamp-2 text-[12px] leading-snug font-semibold">{b.title}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {bookings && bookings.length > 0 && (
            <ol className="mt-6 flex flex-col gap-2">
              {bookings.map((b) => (
                <BookingRow key={b._id} booking={b} now={now} fresh={fresh === b._id} onCancel={cancel} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

/** The booking's picture: yours if you add one, otherwise the category's art stands in. */
function CoverField({ category, cover, onChange }: { category: string; cover: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const take = async (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setError("Use a JPG, PNG or WebP image.");
      return;
    }
    setWorking(true);
    try {
      onChange(await toCover(file));
      setError(null);
    } catch {
      setError("That image didn't work — try another one.");
    } finally {
      setWorking(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    void take(e.dataTransfer.files[0]);
  };

  return (
    <div className="mt-7">
      <div className="flex items-baseline justify-between gap-3">
        <p className={EYEBROW}>Cover</p>
        <p className="text-[12px] text-muted-foreground/80">16:9 · shows until you go live</p>
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn("group relative mt-2 aspect-video overflow-hidden rounded-xl bg-white/[0.04] transition-shadow", drag && "shadow-[inset_0_0_0_2px_var(--color-ember)]")}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL or remote category art */}
        <img
          src={cover || categoryArt(category, { w: 800, h: 450 })}
          alt=""
          className={cn("absolute inset-0 size-full object-cover transition-[opacity,transform] duration-500", cover ? "opacity-100" : "opacity-40 grayscale-[35%] group-hover:scale-[1.02]")}
        />
        {cover ? (
          <div className="absolute right-3 bottom-3 flex gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="press flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3.5 text-[13px] font-semibold text-white backdrop-blur-md hover:bg-black/70"
            >
              <ImageEdit size={15} />
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              aria-label="Remove cover"
              className="press flex size-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:bg-black/70"
            >
              <X size={15} weight="bold" />
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => input.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 px-6 text-center">
            <span className="press flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-semibold text-[#0b0708] shadow-glow-white">
              <ImageSquare size={17} />
              {working ? "Adding…" : "Add a cover"}
            </span>
            <span className="max-w-[36ch] text-[12.5px] leading-snug text-white/80">
              Drop an image here, or skip it — the {category} art stands in.
            </span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="mt-2 text-[12.5px] text-chili-hi">{error}</p>}
    </div>
  );
}

function BookingRow({ booking: b, now, fresh, onCancel }: { booking: RowItem; now: number; fresh: boolean; onCancel: (id: string) => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const start = new Date(b.scheduledStartAt!);
  return (
    <li className={cn(TILE, "flex flex-wrap items-center gap-4 p-4 md:flex-nowrap md:p-5", fresh && "motion-safe:animate-[xt-spring-in_.5s_var(--ease-spring)_both]")}>
      <div className="flex w-[74px] shrink-0 flex-col items-center rounded-control bg-control py-2">
        <span className="text-[11px] font-semibold text-muted-foreground">{start.toLocaleDateString(undefined, { month: "short" })}</span>
        <span className="font-money text-[26px] leading-none tabular-nums">{start.getDate()}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug font-bold">{b.title}</p>
        <p className="mt-1 font-mono text-[12px] text-muted-foreground tabular-nums">
          {start.toLocaleDateString(undefined, { weekday: "short" })} · {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {b.category} · {until(b.scheduledStartAt!, now)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {confirm ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onCancel(b._id);
                } finally {
                  setBusy(false);
                }
              }}
              className="press h-10 rounded-full bg-chili px-4 text-[13.5px] font-semibold text-white disabled:opacity-60"
            >
              {busy ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="press h-10 rounded-full bg-control px-4 text-[13.5px] font-semibold hover:bg-control-hover">
              Keep
            </button>
          </>
        ) : (
          <>
            <Link href={`/studio?scheduled=${b._id}`} className="press flex h-10 items-center gap-1.5 rounded-full bg-white px-4 text-[13.5px] font-semibold text-[#0b0708]">
              Go live now
              <ArrowRight size={14} weight="bold" />
            </Link>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              aria-label={`Cancel ${b.title}`}
              className="press flex size-10 items-center justify-center rounded-full bg-control text-muted-foreground hover:bg-control-hover hover:text-foreground"
            >
              <X size={16} weight="bold" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
