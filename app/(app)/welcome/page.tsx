"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, ArrowRight, SealCheck, Eye, Flame } from "@phosphor-icons/react";
import { apiFetch } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { CATEGORY_GROUPS, POPULAR_CATEGORIES, formatNumber, type Category } from "@/lib/categories";
import type { CategorySummary } from "@/lib/discovery";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { SelectField } from "@/components/ui/select-field";
import { StreamArt } from "@/components/app/stream-art";
import { FollowButton } from "@/components/app/follow-button";

/**
 * Cold start, in two screens and never more.
 *
 * This is a moment, not a page: no rail, no chrome, a slow strip of live
 * frames behind the headline, and a grid of real photographs to choose
 * from. The measured onboarding cost is unambiguous — a popularity-seeded
 * picker over two screens loses about 11% of people; seven screens lose 21%
 * — so it is two screens, seeded from what's actually popular, with Skip
 * always in reach and a home page that stands on its own for anyone who
 * takes it.
 */

const SKIP_KEY = "xtreme-welcome-seen";
const MAX_PICKS = 6;

const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["pcm", "Nigerian Pidgin"],
  ["yo", "Yorùbá"],
  ["ig", "Igbo"],
  ["ha", "Hausa"],
  ["fr", "Français"],
  ["pt", "Português"],
  ["es", "Español"],
  ["sw", "Kiswahili"],
  ["ar", "العربية"],
];

function guessLanguage() {
  if (typeof navigator === "undefined") return "en";
  const code = navigator.language.split("-")[0].toLowerCase();
  return LANGUAGES.some(([c]) => c === code) ? code : "en";
}

interface TopStreamer {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  followers: number;
  isLive: boolean;
  verified?: boolean;
  category?: string;
}

interface LiveStream {
  _id: string;
  title: string;
  category: Category;
  viewers: number;
  thumbnailUrl: string | null;
  streamerId: { _id: string; username: string; displayName: string; avatar: string; verified?: boolean };
}

export default function WelcomePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [picked, setPicked] = useState<Category[]>([]);
  const [language, setLanguage] = useState(guessLanguage);
  const [live, setLive] = useState<CategorySummary[]>([]);
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [top, setTop] = useState<TopStreamer[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ success: boolean; data: { categories: CategorySummary[] } }>(`/api/streams/categories`)
      .then((r) => setLive(r.data.categories))
      .catch(() => setLive([]));
    apiFetch<{ success: boolean; data: { streams: LiveStream[] } }>(`/api/streams?live=true&sort=viewers&limit=40`)
      .then((r) => setStreams(r.data.streams))
      .catch(() => setStreams([]));
    apiFetch<{ success: boolean; data: { streamers: TopStreamer[] } }>(`/api/users/top?limit=12`)
      .then((r) => setTop(r.data.streamers))
      .catch(() => setTop([]));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  // What's live now, biggest first, padded with popular defaults so the
  // grid is never thin. Every tile gets a real photograph either way.
  const categoryTiles = useMemo(() => {
    const liveNames = live.map((c) => c.category);
    const seen = new Set(liveNames);
    const padded = [...liveNames];
    const add = (c: Category) => {
      if (seen.has(c) || padded.length >= 18) return;
      seen.add(c);
      padded.push(c);
    };
    POPULAR_CATEGORIES.forEach(add);
    CATEGORY_GROUPS.forEach((g) => g.topics.forEach(add));
    const byName = new Map(live.map((c) => [c.category, c]));
    return padded.map((c) => ({
      name: c,
      live: byName.get(c)?.live ?? 0,
      viewers: byName.get(c)?.viewers ?? 0,
      cover: byName.get(c)?.cover ?? null,
    }));
  }, [live]);

  // Channels streaming in the picked topics first, then the biggest overall.
  const channelTiles = useMemo(() => {
    const seen = new Set<string>();
    const out: (TopStreamer & { liveTitle?: string; liveViewers?: number; thumb?: string | null; streamId?: string })[] = [];
    const push = (t: (typeof out)[number]) => {
      if (seen.has(t.username)) return;
      seen.add(t.username);
      out.push(t);
    };
    streams
      .filter((s) => picked.length === 0 || picked.includes(s.category))
      .forEach((s) =>
        push({
          id: s.streamerId._id,
          username: s.streamerId.username,
          displayName: s.streamerId.displayName,
          avatar: s.streamerId.avatar,
          followers: 0,
          isLive: true,
          verified: s.streamerId.verified,
          category: s.category,
          liveTitle: s.title,
          liveViewers: s.viewers,
          thumb: s.thumbnailUrl,
          streamId: s._id,
        })
      );
    top.forEach(push);
    return out.slice(0, 12);
  }, [streams, top, picked]);

  const remember = () => {
    try {
      window.localStorage.setItem(SKIP_KEY, "1");
    } catch {
      // Fine.
    }
  };

  const skip = () => {
    remember();
    router.replace("/explore");
  };

  const finish = async () => {
    setSaving(true);
    try {
      await apiFetch(`/api/user/me/onboarding`, {
        method: "POST",
        body: JSON.stringify({ categories: picked, language }),
      });
    } catch {
      // A failed save must not trap someone on the welcome screen.
    }
    remember();
    router.replace("/explore");
  };

  const toggle = (c: Category) =>
    setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length >= MAX_PICKS ? p : [...p, c]));

  const liveTotal = live.reduce((n, c) => n + c.live, 0);
  const firstName = user?.displayName?.split(" ")[0];
  // The marquee holds its frames twice so the loop is seamless.
  const strip = streams.slice(0, 12);

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Header: a slow strip of live frames, the brand, the question. */}
      <header className="relative overflow-hidden border-b border-white/[0.06]">
        {strip.length > 0 && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="animate-marquee flex h-full w-max gap-2 opacity-[0.28]">
              {[...strip, ...strip].map((s, i) => (
                <div key={`${s._id}-${i}`} className="relative aspect-video h-full shrink-0">
                  <StreamArt src={s.thumbnailUrl} category={s.category} alt="" seed={s._id} size={{ w: 640, h: 360 }} />
                </div>
              ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
            <div className="absolute inset-0 bg-gradient-to-r from-background via-transparent to-background" />
          </div>
        )}

        <div className="relative mx-auto flex max-w-[1400px] flex-col gap-8 px-6 pt-8 pb-12 md:px-10 md:pt-10 md:pb-16">
          <div className="flex items-center justify-between">
            <Link href="/explore" className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-sm bg-primary/15 text-primary">
                <Flame size={20} weight="fill" />
              </span>
              <span className="text-lg font-bold tracking-tight text-foreground">Xtream</span>
            </Link>
            <div className="flex items-center gap-5">
              <div className="flex items-center gap-1.5" aria-label={`Step ${step} of 2`}>
                <span className={cn("h-1.5 rounded-full transition-all duration-300", step === 1 ? "w-7 bg-foreground" : "w-1.5 bg-white/25")} />
                <span className={cn("h-1.5 rounded-full transition-all duration-300", step === 2 ? "w-7 bg-foreground" : "w-1.5 bg-white/25")} />
              </div>
              <button type="button" onClick={skip} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Skip
              </button>
            </div>
          </div>

          <div className="animate-rise max-w-2xl">
            {liveTotal > 0 && (
              <p className="mb-4 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-red-400 uppercase">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-red-500" />
                </span>
                Live now · {liveTotal} streams · {formatNumber(live.reduce((n, c) => n + c.viewers, 0))} watching
              </p>
            )}
            <h1 className="text-[34px] font-bold leading-[1.05] tracking-tight text-foreground md:text-5xl">
              {step === 1
                ? <>{firstName ? `Welcome, ${firstName}.` : "Welcome."} <span className="text-foreground/70">What do you want to watch?</span></>
                : <>Follow a few channels. <span className="text-foreground/70">They&apos;ll lead your home page whenever they&apos;re live.</span></>}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              {step === 1
                ? "Pick a few topics to start with. What you actually watch takes over from here within a session or two."
                : picked.length > 0
                  ? "Streaming in the topics you picked right now, then the biggest channels on Xtream."
                  : "The biggest channels on Xtream right now."}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-6 pt-8 md:px-10 md:pt-10">
        {step === 1 ? (
          <>
            <label className="mb-6 flex w-fit items-center gap-3 text-sm text-muted-foreground">
              Streams in
              <SelectField
                ariaLabel="Stream language"
                className="h-10!"
                value={language}
                onChange={setLanguage}
                options={LANGUAGES.map(([code, label]) => ({ value: code, label }))}
              />
            </label>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
              {categoryTiles.map((t, i) => {
                const on = picked.includes(t.name);
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => toggle(t.name)}
                    aria-pressed={on}
                    style={{ animationDelay: `${i * 25}ms` }}
                    className={cn(
                      "animate-rise group relative aspect-[4/3] overflow-hidden rounded-sm text-left ring-2 transition-all duration-200",
                      on ? "scale-[1.02] ring-red-600 shadow-[0_0_0_1px_rgba(220,38,38,.35),0_18px_40px_-16px_rgba(220,38,38,.5)]" : "ring-transparent hover:-translate-y-0.5 hover:ring-white/25"
                    )}
                  >
                    <StreamArt
                      src={t.cover}
                      category={t.name}
                      alt={t.name}
                      seed={t.name}
                      size={{ w: 640, h: 480 }}
                      imgClassName="transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                    {/* Dim via an overlay, not a filter on the image: Chrome
                        drops the image entirely when the filter is on it. */}
                    <div className={cn("absolute inset-0 bg-black/30 transition-opacity duration-300", on ? "opacity-0" : "group-hover:opacity-0")} />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
                    {t.live > 0 && (
                      <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-sm bg-red-600 px-1.5 py-0.5 text-[0.62rem] font-semibold tracking-wide text-white">
                        <span className="relative flex size-1.5">
                          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
                          <span className="relative inline-flex size-1.5 rounded-full bg-white" />
                        </span>
                        {t.live} LIVE
                      </span>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3">
                      <span className="min-w-0">
                        <span className="block truncate text-[16px] font-semibold leading-tight text-white">{t.name}</span>
                        <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-white/70 tabular-nums">
                          {t.live > 0 ? (<><Eye size={11} />{formatNumber(t.viewers)} watching</>) : "Nobody live yet"}
                        </span>
                      </span>
                      <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full transition-all", on ? "scale-110 bg-red-600 text-white" : "bg-white/15 text-white/60")}>
                        {on && <Check size={14} weight="bold" />}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3">
            {channelTiles.map((c, i) => (
              <div
                key={c.username}
                style={{ animationDelay: `${i * 30}ms` }}
                className="animate-rise relative flex items-center gap-3.5 overflow-hidden rounded-sm border border-white/[0.06] bg-white/[0.02] p-3.5"
              >
                {c.isLive && c.thumb !== undefined && (
                  <div className="pointer-events-none absolute inset-0 opacity-[0.22]" aria-hidden>
                    <StreamArt src={c.thumb} category={c.category ?? ""} alt="" seed={c.username} size={{ w: 640, h: 360 }} />
                    <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-background/20" />
                  </div>
                )}
                <Link href={`/c/${c.username}`} className="relative shrink-0">
                  <UserAvatar src={c.avatar} name={c.displayName || c.username} size={52} className={cn("size-13 ring-2", c.isLive ? "ring-red-600" : "ring-white/[0.08]")} />
                  {c.isLive && <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-red-500 ring-2 ring-background" />}
                </Link>
                <span className="relative flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1 truncate text-[15px] font-semibold text-foreground">
                    <span className="truncate">{c.displayName}</span>
                    {c.verified && <SealCheck size={13} weight="fill" className="shrink-0 text-sky-400" aria-label="Verified streamer" />}
                  </span>
                  <span className="truncate text-[12.5px] text-muted-foreground">
                    {c.isLive && c.liveTitle ? (
                      <><span className="font-semibold text-red-400">Live</span> · {c.liveTitle}</>
                    ) : c.followers > 0 ? (
                      `${formatNumber(c.followers)} followers`
                    ) : (
                      `@${c.username}`
                    )}
                  </span>
                  {c.isLive && c.liveViewers != null && (
                    <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-muted-foreground/70 tabular-nums">
                      <Eye size={11} />{formatNumber(c.liveViewers)} watching · {c.category}
                    </span>
                  )}
                </span>
                <FollowButton username={c.username} initialFollowing={false} size="sm" className="relative" />
              </div>
            ))}
            {channelTiles.length === 0 && (
              <p className="col-span-full rounded-sm border border-dashed border-white/[0.1] px-6 py-10 text-center text-sm text-muted-foreground/70">
                Nobody&apos;s live in those topics right now — you can follow channels from any stream later.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Action bar, pinned. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[oklch(0.12_0.005_285)]">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-3.5 md:px-10">
          <div className="flex items-center gap-4">
            {step === 2 && (
              <button type="button" onClick={() => setStep(1)} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                Back
              </button>
            )}
            <p className="text-sm text-muted-foreground tabular-nums">
              {step === 1
                ? picked.length === 0 ? "Pick up to six" : <><span className="font-semibold text-foreground">{picked.length}</span> of {MAX_PICKS} picked</>
                : "Follow as many as you like"}
            </p>
          </div>
          <button
            type="button"
            onClick={step === 1 ? () => setStep(2) : finish}
            disabled={saving}
            className="shine flex h-11 items-center gap-2 rounded-sm bg-primary px-6 text-[15px] font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:opacity-60"
          >
            {step === 1 ? (picked.length === 0 ? "Continue anyway" : "Continue") : saving ? "Saving…" : "Take me home"}
            <ArrowRight size={16} weight="bold" />
          </button>
        </div>
      </div>
    </div>
  );
}
